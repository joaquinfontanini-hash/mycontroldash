import { Router, type IRouter } from "express";
import { eq, and, desc, or, ne, sql, gte, lte } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  dashboardsTable,
  dashboardLayoutsTable,
  dashboardWidgetsTable,
  dashboardPermissionsTable,
  dashboardTemplatesTable,
  dashboardRunsTable,
  dashboardFiltersTable,
  widgetDefinitionsTable,
  auditLogsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireModule, getCurrentUserId, getCurrentUserIdNum, assertOwnership } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";
import { DATA_SOURCE_CATALOG, resolveDataSource } from "../services/studio-data-sources.js";
import {
  generateFromPrompt,
  generateFromTemplate,
  generateFromWizard,
  buildDefaultLayouts,
  type WizardInput,
} from "../services/studio-engine.js";
import { buildSmartSummary, type SmartSummaryContext } from "../services/studio-smart-summary.js";

const router: IRouter = Router();

// All studio routes require auth + dashboard_studio module
const studioAuth = [requireAuth, requireModule("dashboard_studio")];

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function uniqueSlug(base: string, userId: number, excludeId?: number): Promise<string> {
  let slug = slugify(base);
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const [exists] = await db
      .select({ id: dashboardsTable.id })
      .from(dashboardsTable)
      .where(and(
        eq(dashboardsTable.slug, candidate),
        eq(dashboardsTable.ownerUserId, userId),
        excludeId ? ne(dashboardsTable.id, excludeId) : undefined,
      ));
    if (!exists) return candidate;
    attempt++;
  }
}

async function auditLog(action: string, detail: string, userId?: number) {
  try {
    await db.insert(auditLogsTable).values({
      action,
      detail,
      userId: userId ? String(userId) : null,
      createdAt: new Date(),
    });
  } catch {}
}

/**
 * Check if a user has access to a dashboard.
 * Returns the permission level: 'owner' | 'admin' | 'edit' | 'view' | null
 */
async function getDashboardAccess(
  dashId: number,
  userId: number,
  dbUser?: { role?: string }
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const [dash] = await db.select({ ownerUserId: dashboardsTable.ownerUserId })
    .from(dashboardsTable)
    .where(eq(dashboardsTable.id, dashId));
  if (!dash) return null;
  if (dash.ownerUserId === userId) return "owner";
  if (dbUser?.role === "super_admin") return "admin";
  const [perm] = await db.select({ permissionLevel: dashboardPermissionsTable.permissionLevel })
    .from(dashboardPermissionsTable)
    .where(and(
      eq(dashboardPermissionsTable.dashboardId, dashId),
      eq(dashboardPermissionsTable.subjectType, "user"),
      eq(dashboardPermissionsTable.subjectId, userId),
    ));
  if (perm) return perm.permissionLevel as "admin" | "edit" | "view";
  return null;
}

async function insertWidgetsAndFilters(
  dashboardId: number,
  widgets: Array<{ type: string; title: string; dataSourceKey?: string | null; configJson?: Record<string, unknown>; orderIndex: number; subtitle?: string }>,
  filters: Array<{ key: string; label: string; type: string; defaultValueJson?: unknown; orderIndex?: number }>
): Promise<Array<{ id: number; orderIndex: number | null }>> {
  let insertedWidgets: Array<{ id: number; orderIndex: number | null }> = [];
  if (widgets.length > 0) {
    insertedWidgets = await db.insert(dashboardWidgetsTable).values(
      widgets.map(w => ({
        dashboardId,
        type: w.type,
        title: w.title,
        subtitle: w.subtitle ?? null,
        dataSourceKey: w.dataSourceKey ?? null,
        configJson: w.configJson ?? {},
        orderIndex: w.orderIndex,
      }))
    ).returning({ id: dashboardWidgetsTable.id, orderIndex: dashboardWidgetsTable.orderIndex });
  }
  if (filters.length > 0) {
    await db.insert(dashboardFiltersTable).values(
      filters.map((f, i) => ({
        dashboardId,
        key: f.key,
        label: f.label,
        type: f.type,
        configJson: {},
        defaultValueJson: f.defaultValueJson ?? null,
        orderIndex: f.orderIndex ?? i,
      }))
    );
  }
  return insertedWidgets;
}

async function insertLayouts(dashboardId: number, layoutData: { desktop: unknown[]; mobile: unknown[] }) {
  await db.insert(dashboardLayoutsTable).values([
    { dashboardId, breakpoint: "desktop", layoutJson: layoutData.desktop },
    { dashboardId, breakpoint: "mobile",  layoutJson: layoutData.mobile },
  ]);
}

// ── GET /api/studio/dashboards ────────────────────────────────────────────────

router.get("/studio/dashboards", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const tab = (req.query.tab as string) ?? "mine";

    let dashboards;

    if (tab === "mine") {
      dashboards = await db.select().from(dashboardsTable)
        .where(and(
          eq(dashboardsTable.ownerUserId, userId),
          ne(dashboardsTable.status, "archived"),
        ))
        .orderBy(desc(dashboardsTable.updatedAt));

    } else if (tab === "shared") {
      const perms = await db.select({ dashboardId: dashboardPermissionsTable.dashboardId })
        .from(dashboardPermissionsTable)
        .where(and(
          eq(dashboardPermissionsTable.subjectType, "user"),
          eq(dashboardPermissionsTable.subjectId, userId),
        ));
      const ids = perms.map(p => p.dashboardId);
      if (ids.length === 0) {
        dashboards = [];
      } else {
        dashboards = await db.select().from(dashboardsTable)
          .where(and(
            or(...ids.map(id => eq(dashboardsTable.id, id))),
            ne(dashboardsTable.ownerUserId, userId),
          ))
          .orderBy(desc(dashboardsTable.updatedAt));
      }

    } else if (tab === "favorites") {
      dashboards = await db.select().from(dashboardsTable)
        .where(and(
          eq(dashboardsTable.ownerUserId, userId),
          eq(dashboardsTable.isFavorite, true),
        ))
        .orderBy(desc(dashboardsTable.updatedAt));

    } else if (tab === "archived") {
      dashboards = await db.select().from(dashboardsTable)
        .where(and(
          eq(dashboardsTable.ownerUserId, userId),
          eq(dashboardsTable.status, "archived"),
        ))
        .orderBy(desc(dashboardsTable.archivedAt));

    } else if (tab === "templates") {
      const templates = await db.select().from(dashboardTemplatesTable)
        .where(eq(dashboardTemplatesTable.isActive, true))
        .orderBy(dashboardTemplatesTable.name);
      res.json(templates);
      return;

    } else {
      dashboards = await db.select().from(dashboardsTable)
        .where(eq(dashboardsTable.ownerUserId, userId))
        .orderBy(desc(dashboardsTable.updatedAt));
    }

    res.json(dashboards);
  } catch (err) {
    logger.error({ err }, "studio: list dashboards error");
    res.status(500).json({ error: "Error al cargar dashboards" });
  }
});

// ── POST /api/studio/dashboards ───────────────────────────────────────────────

router.post("/studio/dashboards", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { name, description, icon, color, category } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name es requerido" }); return;
    }
    const slug = await uniqueSlug(name.trim(), userId);
    const [dash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: name.trim(),
      slug,
      description: description ?? null,
      icon: icon ?? "📊",
      color: color ?? "#6b7280",
      category: category ?? "general",
      status: "draft",
    }).returning();

    await auditLog("studio_dashboard_created", `Dashboard "${name}" creado (manual)`, userId);
    res.status(201).json(dash);
  } catch (err) {
    logger.error({ err }, "studio: create dashboard error");
    res.status(500).json({ error: "Error al crear dashboard" });
  }
});

// ── GET /api/studio/dashboards/:id ───────────────────────────────────────────

router.get("/studio/dashboards/:id", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId  = getCurrentUserIdNum(req);
    const dbUser  = (req as any).dbUser;
    const id      = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [widgets, filters, layouts] = await Promise.all([
      db.select().from(dashboardWidgetsTable)
        .where(eq(dashboardWidgetsTable.dashboardId, id))
        .orderBy(dashboardWidgetsTable.orderIndex),
      db.select().from(dashboardFiltersTable)
        .where(eq(dashboardFiltersTable.dashboardId, id))
        .orderBy(dashboardFiltersTable.orderIndex),
      db.select().from(dashboardLayoutsTable)
        .where(eq(dashboardLayoutsTable.dashboardId, id)),
    ]);

    res.json({ ...dash, widgets, filters, layouts, _access: access });
  } catch (err) {
    logger.error({ err }, "studio: get dashboard error");
    res.status(500).json({ error: "Error al cargar dashboard" });
  }
});

// ── PATCH /api/studio/dashboards/:id ─────────────────────────────────────────

router.patch("/studio/dashboards/:id", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const dbUser = (req as any).dbUser;
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const { name, description, icon, color, category, status, isFavorite, refreshIntervalSeconds } = req.body;

    // D3: Validate status enum
    if (status !== undefined && !["draft", "active", "archived"].includes(status)) {
      res.status(400).json({ error: "status inválido: debe ser draft, active o archived" }); return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date(), version: dash.version + 1 };
    if (name                   !== undefined) updates.name                   = name;
    if (description            !== undefined) updates.description            = description;
    if (icon                   !== undefined) updates.icon                   = icon;
    if (color                  !== undefined) updates.color                  = color;
    if (category               !== undefined) updates.category               = category;
    if (status                 !== undefined) updates.status                 = status;
    if (isFavorite             !== undefined) updates.isFavorite             = isFavorite;
    if (refreshIntervalSeconds !== undefined) updates.refreshIntervalSeconds = refreshIntervalSeconds;

    if (name && name !== dash.name) {
      updates.slug = await uniqueSlug(name, userId, id);
    }

    const [updated] = await db.update(dashboardsTable).set(updates)
      .where(eq(dashboardsTable.id, id)).returning();

    await auditLog("studio_dashboard_updated", `Dashboard "${dash.name}" actualizado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update dashboard error");
    res.status(500).json({ error: "Error al actualizar dashboard" });
  }
});

// ── POST /api/studio/dashboards/:id/duplicate ────────────────────────────────

router.post("/studio/dashboards/:id/duplicate", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [source] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!source) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [widgets, filters, layouts] = await Promise.all([
      db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, id)),
      db.select().from(dashboardFiltersTable).where(eq(dashboardFiltersTable.dashboardId, id)),
      db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id)),
    ]);

    const newName = (req.body.name as string | undefined) ?? `${source.name} (copia)`;
    const newSlug = await uniqueSlug(newName, userId);

    const [newDash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: newName,
      slug: newSlug,
      description: source.description,
      icon: source.icon,
      color: source.color,
      category: source.category,
      sourceType: "duplicate",
      status: "draft",
    }).returning();

    // Duplicate widgets and remap IDs for layouts
    const widgetIdMap: Record<number, number> = {};
    if (widgets.length > 0) {
      const newWidgets = await db.insert(dashboardWidgetsTable).values(
        widgets.map(w => ({
          dashboardId: newDash.id,
          type: w.type,
          title: w.title,
          subtitle: w.subtitle,
          dataSourceKey: w.dataSourceKey,
          configJson: w.configJson,
          orderIndex: w.orderIndex,
          visible: w.visible,
          refreshIntervalSeconds: w.refreshIntervalSeconds ?? null,
        }))
      ).returning({ id: dashboardWidgetsTable.id });

      widgets.forEach((oldW, i) => {
        widgetIdMap[oldW.id] = newWidgets[i].id;
      });
    }

    if (filters.length > 0) {
      await db.insert(dashboardFiltersTable).values(
        filters.map(f => ({
          dashboardId: newDash.id,
          key: f.key,
          label: f.label,
          type: f.type,
          configJson: f.configJson,
          defaultValueJson: f.defaultValueJson,
          orderIndex: f.orderIndex,
        }))
      );
    }

    // Remap widgetId references in layout JSON
    if (layouts.length > 0) {
      await db.insert(dashboardLayoutsTable).values(
        layouts.map(l => {
          const remapped = (Array.isArray(l.layoutJson) ? l.layoutJson : []).map((item: any) => ({
            ...item,
            widgetId: widgetIdMap[item.widgetId] ?? item.widgetId,
          }));
          return { dashboardId: newDash.id, breakpoint: l.breakpoint, layoutJson: remapped };
        })
      );
    }

    await auditLog("studio_dashboard_duplicated", `Dashboard "${source.name}" duplicado como "${newName}"`, userId);
    res.status(201).json(newDash);
  } catch (err) {
    logger.error({ err }, "studio: duplicate dashboard error");
    res.status(500).json({ error: "Error al duplicar dashboard" });
  }
});

// ── POST /api/studio/dashboards/:id/archive ──────────────────────────────────

router.post("/studio/dashboards/:id/archive", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { res.status(403).json({ error: "Solo el propietario puede archivar este dashboard" }); return; }

    const [updated] = await db.update(dashboardsTable)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(dashboardsTable.id, id)).returning();

    await auditLog("studio_dashboard_archived", `Dashboard "${dash.name}" archivado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: archive dashboard error");
    res.status(500).json({ error: "Error al archivar dashboard" });
  }
});

// ── POST /api/studio/dashboards/:id/restore ──────────────────────────────────

router.post("/studio/dashboards/:id/restore", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { res.status(403).json({ error: "Solo el propietario puede restaurar este dashboard" }); return; }

    const [updated] = await db.update(dashboardsTable)
      .set({ status: "draft", archivedAt: null, updatedAt: new Date() })
      .where(eq(dashboardsTable.id, id)).returning();

    await auditLog("studio_dashboard_restored", `Dashboard "${dash.name}" restaurado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: restore dashboard error");
    res.status(500).json({ error: "Error al restaurar dashboard" });
  }
});

// ── DELETE /api/studio/dashboards/:id ────────────────────────────────────────

router.delete("/studio/dashboards/:id", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { res.status(403).json({ error: "Solo el propietario puede eliminar este dashboard" }); return; }
    if (dash.isSystem)  { res.status(403).json({ error: "No se pueden eliminar dashboards del sistema" }); return; }

    await db.delete(dashboardsTable).where(eq(dashboardsTable.id, id));
    await auditLog("studio_dashboard_deleted", `Dashboard "${dash.name}" eliminado`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete dashboard error");
    res.status(500).json({ error: "Error al eliminar dashboard" });
  }
});

// ── GET /api/studio/dashboards/:id/layouts ───────────────────────────────────

router.get("/studio/dashboards/:id/layouts", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const rows = await db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: get layouts error");
    res.status(500).json({ error: "Error al cargar layouts" });
  }
});

// ── PATCH /api/studio/dashboards/:id/layouts ─────────────────────────────────

router.patch("/studio/dashboards/:id/layouts", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    const { breakpoint, layoutJson } = req.body;
    if (!breakpoint || !Array.isArray(layoutJson)) {
      res.status(400).json({ error: "breakpoint (string) y layoutJson (array) son requeridos" }); return;
    }
    if (!["desktop", "tablet", "mobile"].includes(breakpoint)) {
      res.status(400).json({ error: "breakpoint debe ser desktop, tablet o mobile" }); return;
    }

    const [existing] = await db.select().from(dashboardLayoutsTable)
      .where(and(eq(dashboardLayoutsTable.dashboardId, id), eq(dashboardLayoutsTable.breakpoint, breakpoint)));

    if (existing) {
      await db.update(dashboardLayoutsTable)
        .set({ layoutJson, updatedAt: new Date(), version: existing.version + 1 })
        .where(eq(dashboardLayoutsTable.id, existing.id));
    } else {
      await db.insert(dashboardLayoutsTable).values({ dashboardId: id, breakpoint, layoutJson });
    }

    await auditLog("studio_layout_updated", `Layout ${breakpoint} actualizado para dashboard #${id}`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: update layout error");
    res.status(500).json({ error: "Error al actualizar layout" });
  }
});

// ── POST /api/studio/dashboards/:id/save ─────────────────────────────────────
// D2: Atomic batch save — name + status + widget order + layout in one transaction

router.post("/studio/dashboards/:id/save", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    const {
      name,
      status,
      refreshIntervalSeconds,
      widgetOrder,   // Array<{ id: number; orderIndex: number }>
      layout,        // { breakpoint: string; layoutJson: LayoutItem[] }
    } = req.body;

    await db.transaction(async (tx) => {
      // 1) Update dashboard metadata
      const [dash] = await tx.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
      if (!dash) throw new Error("Dashboard no encontrado");

      const updates: Record<string, unknown> = { updatedAt: new Date(), version: dash.version + 1 };
      if (name !== undefined) updates.name = name;
      if (status !== undefined) updates.status = status;
      if (refreshIntervalSeconds !== undefined) updates.refreshIntervalSeconds = refreshIntervalSeconds;
      if (name && name !== dash.name) {
        updates.slug = await uniqueSlug(name, userId, id);
      }
      await tx.update(dashboardsTable).set(updates).where(eq(dashboardsTable.id, id));

      // 2) Batch update widget order
      if (Array.isArray(widgetOrder) && widgetOrder.length > 0) {
        await Promise.all(
          widgetOrder.map(({ id: wId, orderIndex }: { id: number; orderIndex: number }) =>
            tx.update(dashboardWidgetsTable)
              .set({ orderIndex })
              .where(and(eq(dashboardWidgetsTable.id, wId), eq(dashboardWidgetsTable.dashboardId, id)))
          )
        );
      }

      // 3) Upsert layout
      if (layout?.breakpoint && Array.isArray(layout.layoutJson)) {
        const [existing] = await tx.select().from(dashboardLayoutsTable)
          .where(and(eq(dashboardLayoutsTable.dashboardId, id), eq(dashboardLayoutsTable.breakpoint, layout.breakpoint)));
        if (existing) {
          await tx.update(dashboardLayoutsTable)
            .set({ layoutJson: layout.layoutJson, updatedAt: new Date(), version: existing.version + 1 })
            .where(eq(dashboardLayoutsTable.id, existing.id));
        } else {
          await tx.insert(dashboardLayoutsTable).values({ dashboardId: id, breakpoint: layout.breakpoint, layoutJson: layout.layoutJson });
        }
      }
    });

    await auditLog("studio_dashboard_saved", `Dashboard #${id} guardado (batch)`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: batch save error");
    res.status(500).json({ error: "Error al guardar dashboard" });
  }
});

// ── GET /api/studio/dashboards/:id/permissions ───────────────────────────────

router.get("/studio/dashboards/:id/permissions", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view" || access === "edit") {
      res.status(403).json({ error: "Solo el propietario puede ver los permisos" }); return;
    }

    const perms = await db.select().from(dashboardPermissionsTable)
      .where(eq(dashboardPermissionsTable.dashboardId, id));

    // Batch-load users in a single query (eliminates N+1)
    const userIds = perms
      .filter(p => p.subjectType === "user" && p.subjectId)
      .map(p => p.subjectId as number);

    const usersMap: Record<number, { id: number; email: string | null; name: string | null }> = {};
    if (userIds.length > 0) {
      const users = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
      for (const u of users) usersMap[u.id] = u;
    }

    const enriched = perms.map(p => ({
      ...p,
      user: (p.subjectType === "user" && p.subjectId ? usersMap[p.subjectId] ?? null : null),
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "studio: get permissions error");
    res.status(500).json({ error: "Error al cargar permisos" });
  }
});

// ── PATCH /api/studio/dashboards/:id/permissions ─────────────────────────────
// Body: { op: 'grant' | 'revoke' | 'update', subjectType: 'user' | 'role', subjectId?: number, subjectRoleKey?: string, permissionLevel?: 'view' | 'edit' | 'admin' }

router.patch("/studio/dashboards/:id/permissions", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access !== "owner" && access !== "admin") {
      res.status(403).json({ error: "Solo el propietario o administradores pueden cambiar permisos" }); return;
    }

    const { op, subjectType, subjectId, subjectRoleKey, permissionLevel } = req.body;
    if (!op || !subjectType) { res.status(400).json({ error: "op y subjectType son requeridos" }); return; }
    if (!["user", "role"].includes(subjectType)) { res.status(400).json({ error: "subjectType inválido" }); return; }
    if (!["grant", "revoke", "update"].includes(op)) { res.status(400).json({ error: "op inválido: grant | revoke | update" }); return; }

    if (subjectType === "user") {
      if (!subjectId) { res.status(400).json({ error: "subjectId (user ID) requerido" }); return; }
      // Prevent self-permission modification by owner for safety
      if (subjectId === userId) { res.status(400).json({ error: "No podés modificar tus propios permisos" }); return; }
      // Verify user exists
      const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, subjectId));
      if (!targetUser) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    }

    if (op === "revoke") {
      const where = subjectType === "user"
        ? and(eq(dashboardPermissionsTable.dashboardId, id), eq(dashboardPermissionsTable.subjectType, "user"), eq(dashboardPermissionsTable.subjectId, subjectId))
        : and(eq(dashboardPermissionsTable.dashboardId, id), eq(dashboardPermissionsTable.subjectType, "role"), eq(dashboardPermissionsTable.subjectRoleKey, subjectRoleKey));
      await db.delete(dashboardPermissionsTable).where(where!);
      await auditLog("studio_permission_revoked", `Permiso revocado para ${subjectType} en dashboard #${id}`, userId);
      res.json({ ok: true });
      return;
    }

    if (!permissionLevel || !["view", "edit", "admin"].includes(permissionLevel)) {
      res.status(400).json({ error: "permissionLevel inválido: view | edit | admin" }); return;
    }

    // Prevent privilege escalation: non-super-admin cannot grant admin
    if (permissionLevel === "admin" && access !== "owner" && (req as any).dbUser?.role !== "super_admin") {
      res.status(403).json({ error: "Solo el propietario puede otorgar permisos de admin" }); return;
    }

    // Upsert permission
    const existingWhere = subjectType === "user"
      ? and(eq(dashboardPermissionsTable.dashboardId, id), eq(dashboardPermissionsTable.subjectType, "user"), eq(dashboardPermissionsTable.subjectId, subjectId))
      : and(eq(dashboardPermissionsTable.dashboardId, id), eq(dashboardPermissionsTable.subjectType, "role"), eq(dashboardPermissionsTable.subjectRoleKey, subjectRoleKey));

    const [existing] = await db.select().from(dashboardPermissionsTable).where(existingWhere!);

    if (existing) {
      await db.update(dashboardPermissionsTable)
        .set({ permissionLevel, updatedAt: new Date() })
        .where(eq(dashboardPermissionsTable.id, existing.id));
    } else {
      await db.insert(dashboardPermissionsTable).values({
        dashboardId: id,
        grantedBy: userId,
        subjectType,
        subjectId: subjectType === "user" ? subjectId : null,
        subjectRoleKey: subjectType === "role" ? subjectRoleKey : null,
        permissionLevel,
      });
    }

    await auditLog("studio_permission_granted", `Permiso ${permissionLevel} otorgado a ${subjectType} en dashboard #${id}`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: update permissions error");
    res.status(500).json({ error: "Error al actualizar permisos" });
  }
});

// ── GET /api/studio/templates ─────────────────────────────────────────────────

router.get("/studio/templates", studioAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(dashboardTemplatesTable)
      .where(eq(dashboardTemplatesTable.isActive, true))
      .orderBy(dashboardTemplatesTable.name);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: list templates error");
    res.status(500).json({ error: "Error al cargar plantillas" });
  }
});

// ── GET /api/studio/widget-definitions ───────────────────────────────────────

router.get("/studio/widget-definitions", studioAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(widgetDefinitionsTable)
      .where(eq(widgetDefinitionsTable.isActive, true))
      .orderBy(widgetDefinitionsTable.category, widgetDefinitionsTable.name);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: list widget definitions error");
    res.status(500).json({ error: "Error al cargar widgets" });
  }
});

// ── GET /api/studio/data-sources ─────────────────────────────────────────────

router.get("/studio/data-sources", studioAuth, async (req, res): Promise<void> => {
  const isAdmin = (req as any).dbUser?.role === "super_admin";
  const catalog = isAdmin ? DATA_SOURCE_CATALOG : DATA_SOURCE_CATALOG.filter(d => d.category !== "admin");
  res.json(catalog);
});

// ── POST /api/studio/generate-from-prompt ────────────────────────────────────

router.post("/studio/generate-from-prompt", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { prompt, save = false } = req.body;
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
      res.status(400).json({ error: "Prompt demasiado corto (mínimo 5 caracteres)" }); return;
    }

    const generated = generateFromPrompt(prompt.trim());

    const [run] = await db.insert(dashboardRunsTable).values({
      userId,
      inputType: "prompt",
      promptText: prompt.trim(),
      parsedIntentJson: generated.parsedIntent,
      generatedConfigJson: generated,
      status: "success",
    }).returning();

    if (!save) {
      const layouts = buildDefaultLayouts(generated.widgets.map((w, i) => ({ id: i + 1, orderIndex: w.orderIndex })));
      res.json({ preview: true, run: { id: run.id }, generated, layouts });
      return;
    }

    const slug = await uniqueSlug(generated.name, userId);
    const [dash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: generated.name,
      slug,
      description: generated.description,
      icon: generated.icon,
      color: generated.color,
      category: generated.category,
      sourceType: "prompt",
      promptText: prompt.trim(),
      status: "draft",
    }).returning();

    const insertedWidgets = await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    const layouts = buildDefaultLayouts(insertedWidgets);
    await insertLayouts(dash.id, layouts);

    await auditLog("studio_generate_prompt", `Dashboard "${generated.name}" generado desde prompt`, userId);
    res.status(201).json({ preview: false, run: { id: run.id }, dashboard: dash, generated, layouts });
  } catch (err) {
    logger.error({ err }, "studio: generate from prompt error");
    try {
      const uid = getCurrentUserIdNum(req);
      await db.insert(dashboardRunsTable).values({
        userId: uid, inputType: "prompt", promptText: req.body?.prompt ?? null,
        parsedIntentJson: null, generatedConfigJson: null, status: "error", errorMessage: String(err),
      });
    } catch {}
    res.status(500).json({ error: "Error al generar dashboard desde prompt" });
  }
});

// ── POST /api/studio/generate-from-template ──────────────────────────────────

router.post("/studio/generate-from-template", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { templateKey, name } = req.body;
    if (!templateKey) { res.status(400).json({ error: "templateKey es requerido" }); return; }

    const [tmpl] = await db.select().from(dashboardTemplatesTable)
      .where(and(eq(dashboardTemplatesTable.key, templateKey), eq(dashboardTemplatesTable.isActive, true)));
    if (!tmpl) { res.status(404).json({ error: "Plantilla no encontrada" }); return; }

    const config = tmpl.configJson as { widgets?: unknown[]; filters?: unknown[] };
    const generated = generateFromTemplate(
      {
        widgets: (config.widgets ?? []) as Parameters<typeof generateFromTemplate>[0]["widgets"],
        filters: (config.filters ?? []) as Parameters<typeof generateFromTemplate>[0]["filters"],
      },
      {
        name:        tmpl.name,
        icon:        tmpl.icon ?? undefined,
        color:       tmpl.color ?? undefined,
        category:    tmpl.category ?? undefined,
        description: tmpl.description ?? undefined,
      }
    );

    const dashName = (name as string | undefined)?.trim() || tmpl.name;
    const slug = await uniqueSlug(dashName, userId);
    const [dash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: dashName,
      slug,
      description: tmpl.description,
      icon: tmpl.icon,
      color: tmpl.color,
      category: tmpl.category,
      sourceType: "template",
      templateKey,
      status: "draft",
    }).returning();

    const insertedWidgets = await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    const layouts = buildDefaultLayouts(insertedWidgets);
    await insertLayouts(dash.id, layouts);

    await db.insert(dashboardRunsTable).values({
      userId, inputType: "template",
      parsedIntentJson: generated.parsedIntent, generatedConfigJson: generated, status: "success",
    });

    await auditLog("studio_generate_template", `Dashboard "${dashName}" generado desde plantilla "${tmpl.name}"`, userId);
    res.status(201).json({ dashboard: dash });
  } catch (err) {
    logger.error({ err }, "studio: generate from template error");
    res.status(500).json({ error: "Error al generar dashboard desde plantilla" });
  }
});

// ── POST /api/studio/generate-from-wizard ────────────────────────────────────

router.post("/studio/generate-from-wizard", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const input  = req.body as WizardInput;
    if (!input.name || !input.selectedWidgets?.length) {
      res.status(400).json({ error: "name y al menos un widget son requeridos" }); return;
    }

    const generated = generateFromWizard(input);
    const slug = await uniqueSlug(input.name, userId);
    const [dash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: input.name,
      slug,
      description: input.description ?? null,
      icon: input.icon ?? "📊",
      color: input.color ?? "#6b7280",
      category: input.category,
      sourceType: "wizard",
      status: "draft",
    }).returning();

    const insertedWidgets = await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    const layouts = buildDefaultLayouts(insertedWidgets);
    await insertLayouts(dash.id, layouts);

    await db.insert(dashboardRunsTable).values({
      userId, inputType: "wizard",
      parsedIntentJson: generated.parsedIntent, generatedConfigJson: generated, status: "success",
    });

    await auditLog("studio_generate_wizard", `Dashboard "${input.name}" generado desde wizard`, userId);
    res.status(201).json({ dashboard: dash });
  } catch (err) {
    logger.error({ err }, "studio: generate from wizard error");
    res.status(500).json({ error: "Error al generar dashboard desde wizard" });
  }
});

// ── POST /api/studio/dashboards/:id/widgets ──────────────────────────────────

router.post("/studio/dashboards/:id/widgets", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId      = getCurrentUserIdNum(req);
    const dashboardId = parseInt(req.params.id);
    if (isNaN(dashboardId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(dashboardId, userId, (req as any).dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    // D4: Widget limit — max 20 widgets per dashboard
    const MAX_WIDGETS_PER_DASHBOARD = 20;
    const [widgetCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, dashboardId));
    if ((widgetCount?.count ?? 0) >= MAX_WIDGETS_PER_DASHBOARD) {
      res.status(400).json({ error: `Límite alcanzado: máximo ${MAX_WIDGETS_PER_DASHBOARD} widgets por dashboard` });
      return;
    }

    const { type, title, subtitle, dataSourceKey, configJson, orderIndex = 0 } = req.body;
    if (!type || !title) { res.status(400).json({ error: "type y title son requeridos" }); return; }

    const [widget] = await db.insert(dashboardWidgetsTable).values({
      dashboardId,
      type,
      title,
      subtitle: subtitle ?? null,
      dataSourceKey: dataSourceKey ?? null,
      configJson: configJson ?? {},
      orderIndex,
    }).returning();

    await auditLog("studio_widget_added", `Widget "${title}" (${type}) agregado al dashboard #${dashboardId}`, userId);
    res.status(201).json(widget);
  } catch (err) {
    logger.error({ err }, "studio: add widget error");
    res.status(500).json({ error: "Error al agregar widget" });
  }
});

// ── PATCH /api/studio/widgets/:widgetId ──────────────────────────────────────

router.patch("/studio/widgets/:widgetId", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId   = getCurrentUserIdNum(req);
    const widgetId = parseInt(req.params.widgetId);
    if (isNaN(widgetId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    if (!widget) { res.status(404).json({ error: "Widget no encontrado" }); return; }

    const access = await getDashboardAccess(widget.dashboardId, userId, (req as any).dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    const { title, subtitle, configJson, visible, orderIndex, dataSourceKey } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title         !== undefined) updates.title         = title;
    if (subtitle      !== undefined) updates.subtitle      = subtitle;
    if (configJson    !== undefined) updates.configJson    = configJson;
    if (visible       !== undefined) updates.visible       = visible;
    if (orderIndex    !== undefined) updates.orderIndex    = orderIndex;
    if (dataSourceKey !== undefined) updates.dataSourceKey = dataSourceKey;

    // Invalidate snapshot if data-affecting fields changed
    if (configJson !== undefined || dataSourceKey !== undefined) {
      updates.snapshotStatus = "stale";
      updates.lastDataSnapshotJson = null;
    }

    const [updated] = await db.update(dashboardWidgetsTable).set(updates)
      .where(eq(dashboardWidgetsTable.id, widgetId)).returning();

    await auditLog("studio_widget_updated", `Widget "${widget.title}" actualizado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update widget error");
    res.status(500).json({ error: "Error al actualizar widget" });
  }
});

// ── DELETE /api/studio/widgets/:widgetId ─────────────────────────────────────

router.delete("/studio/widgets/:widgetId", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId   = getCurrentUserIdNum(req);
    const widgetId = parseInt(req.params.widgetId);
    if (isNaN(widgetId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    if (!widget) { res.status(404).json({ error: "Widget no encontrado" }); return; }

    const access = await getDashboardAccess(widget.dashboardId, userId, (req as any).dbUser);
    if (!access || access === "view") {
      res.status(access ? 403 : 404).json({ error: access ? "Sin permiso de edición" : "Dashboard no encontrado" });
      return;
    }

    await db.delete(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    await auditLog("studio_widget_deleted", `Widget "${widget.title}" eliminado del dashboard #${widget.dashboardId}`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete widget error");
    res.status(500).json({ error: "Error al eliminar widget" });
  }
});

// ── POST /api/studio/widgets/:widgetId/refresh-snapshot ──────────────────────

router.post("/studio/widgets/:widgetId/refresh-snapshot", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId   = getCurrentUserIdNum(req);
    const widgetId = parseInt(req.params.widgetId);
    if (isNaN(widgetId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    if (!widget) { res.status(404).json({ error: "Widget no encontrado" }); return; }

    const access = await getDashboardAccess(widget.dashboardId, userId, (req as any).dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    // Mark as refreshing
    await db.update(dashboardWidgetsTable)
      .set({ snapshotStatus: "refreshing" })
      .where(eq(dashboardWidgetsTable.id, widgetId));

    let freshData: unknown = null;
    let snapshotStatus: string = "fresh";
    try {
      if (widget.dataSourceKey) {
        freshData = await resolveDataSource(
          widget.dataSourceKey,
          userId,
          (widget.configJson as Record<string, unknown>) ?? {}
        );
      }
    } catch {
      snapshotStatus = "error";
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min TTL

    // E2: Compute dataSignature — sha256 of (dataSourceKey + configJson)
    const sigInput = JSON.stringify({ k: widget.dataSourceKey, c: widget.configJson });
    const dataSignature = createHash("sha256").update(sigInput).digest("hex").slice(0, 16);

    await db.update(dashboardWidgetsTable).set({
      lastDataSnapshotJson: freshData,
      lastDataSnapshotAt: now,
      snapshotExpiresAt: expiresAt,
      snapshotStatus,
      snapshotVersion: widget.snapshotVersion + 1,
      dataSignature,
    }).where(eq(dashboardWidgetsTable.id, widgetId));

    await auditLog("studio_snapshot_refreshed", `Snapshot refrescado para widget #${widgetId}`, userId);
    res.json({ ok: true, snapshotStatus, lastDataSnapshotAt: now, snapshotExpiresAt: expiresAt, data: freshData });
  } catch (err) {
    logger.error({ err }, "studio: refresh snapshot error");
    res.status(500).json({ error: "Error al refrescar snapshot" });
  }
});

// ── GET /api/studio/dashboards/:id/data ──────────────────────────────────────

router.get("/studio/dashboards/:id/data", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(403).json({ error: "Sin acceso" }); return; }

    // T003: Parse global filter params from query string
    let globalFilters: Record<string, unknown> = {};
    if (req.query.filters) {
      try { globalFilters = JSON.parse(req.query.filters as string); } catch {}
    }

    const widgets = await db.select().from(dashboardWidgetsTable)
      .where(and(eq(dashboardWidgetsTable.dashboardId, id), eq(dashboardWidgetsTable.visible, true)));

    const results: Record<number, { data: unknown; fromSnapshot: boolean; snapshotAt?: string; snapshotStatus?: string }> = {};

    await Promise.all(
      widgets.map(async (w) => {
        // Serve from snapshot only if no global filters active (filters bypass cache for accuracy)
        const hasActiveFilters = Object.keys(globalFilters).length > 0;
        const snapshotFresh =
          !hasActiveFilters &&
          w.lastDataSnapshotJson !== null &&
          w.snapshotExpiresAt !== null &&
          new Date(w.snapshotExpiresAt) > new Date() &&
          w.snapshotStatus === "fresh";

        if (snapshotFresh) {
          results[w.id] = {
            data: w.lastDataSnapshotJson,
            fromSnapshot: true,
            snapshotAt: w.lastDataSnapshotAt?.toISOString(),
            snapshotStatus: "fresh",
          };
        } else if (w.dataSourceKey) {
          // C2: Gate admin-only data sources by role
          if (w.dataSourceKey === "admin.jobs.health" && (req as any).dbUser?.role !== "super_admin") {
            results[w.id] = { data: null, fromSnapshot: false };
            return;
          }
          // Merge widget configJson with global filters
          const params = { ...(w.configJson as Record<string, unknown>) ?? {}, ...globalFilters };
          const data = await resolveDataSource(w.dataSourceKey, userId, params);
          results[w.id] = { data, fromSnapshot: false };

          // Async update snapshot for eligible sources
          const meta = DATA_SOURCE_CATALOG.find(d => d.key === w.dataSourceKey);
          if (meta?.supportsSnapshot && data !== null) {
            const now = new Date();
            const sigInput = JSON.stringify({ k: w.dataSourceKey, c: w.configJson });
            const dataSignature = createHash("sha256").update(sigInput).digest("hex").slice(0, 16);
            db.update(dashboardWidgetsTable).set({
              lastDataSnapshotJson: data,
              lastDataSnapshotAt: now,
              snapshotExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
              snapshotStatus: "fresh",
              snapshotVersion: w.snapshotVersion + 1,
              dataSignature,
            }).where(eq(dashboardWidgetsTable.id, w.id)).catch(() => {});
          }
        } else {
          results[w.id] = { data: null, fromSnapshot: false };
        }
      })
    );

    res.json(results);
  } catch (err) {
    logger.error({ err }, "studio: resolve widget data error");
    res.status(500).json({ error: "Error al cargar datos de widgets" });
  }
});

// ── POST /api/studio/dashboards/:id/smart-summary ────────────────────────────

// D5: In-memory cache for smart summary (2-minute TTL per user)
const smartSummaryCache = new Map<number, { data: unknown; expiresAt: number }>();
const SMART_SUMMARY_TTL_MS = 2 * 60 * 1000; // 2 minutes

router.post("/studio/dashboards/:id/smart-summary", studioAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, (req as any).dbUser);
    if (!access) { res.status(403).json({ error: "Sin acceso" }); return; }

    // Serve from cache if fresh
    const cached = smartSummaryCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    // Resolve relevant data sources in parallel
    const [dueDates, upcomingDueDates, financeSummary, financeTransactions, tasks, newsPriority, systemNotifications] =
      await Promise.all([
        resolveDataSource("dueDates.trafficLight", userId),
        resolveDataSource("dueDates.upcoming", userId),
        resolveDataSource("finance.summary", userId),
        resolveDataSource("finance.transactions.recent", userId),
        resolveDataSource("tasks.myOpen", userId),
        resolveDataSource("news.priority", userId),
        resolveDataSource("system.notifications", userId),
      ]);

    const ctx: SmartSummaryContext = {
      dueDates:            dueDates as any,
      upcomingDueDates:    Array.isArray(upcomingDueDates) ? upcomingDueDates as any : undefined,
      financeSummary:      financeSummary as any,
      financeTransactions: Array.isArray(financeTransactions) ? financeTransactions as any : undefined,
      tasks:               Array.isArray(tasks) ? tasks as any : undefined,
      newsPriority:        Array.isArray(newsPriority) ? newsPriority as any : undefined,
      systemNotifications: Array.isArray(systemNotifications) ? systemNotifications as any : undefined,
    };

    const summary = buildSmartSummary(ctx);
    smartSummaryCache.set(userId, { data: summary, expiresAt: Date.now() + SMART_SUMMARY_TTL_MS });
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "studio: smart summary error");
    res.status(500).json({ error: "Error al generar resumen inteligente" });
  }
});

export default router;
