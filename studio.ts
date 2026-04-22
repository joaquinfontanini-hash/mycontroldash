import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, or, ne, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  dashboardsTable,
  dashboardLayoutsTable,
  dashboardWidgetsTable,
  dashboardPermissionsTable,
  dashboardTemplatesTable,
  widgetDefinitionsTable,
  auditLogsTable,
  usersTable,
} from "@workspace/db";
import {
  requireAuth,
  requireModule,
  getCurrentUserId,
  getCurrentUserIdNum,
  type AuthenticatedRequest,
} from "../middleware/require-auth.js";
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

// Todos los endpoints de Studio requieren auth + módulo habilitado
const studioAuth = [requireAuth, requireModule("dashboard_studio")];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Helper tipado para acceder a dbUser — elimina todos los (req as any).dbUser
function getDbUser(req: Request): AuthenticatedRequest["dbUser"] {
  return (req as AuthenticatedRequest).dbUser;
}

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

async function uniqueSlug(
  base: string,
  userId: number,
  excludeId?: number,
): Promise<string> {
  let slug    = slugify(base);
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const [exists]  = await db
      .select({ id: dashboardsTable.id })
      .from(dashboardsTable)
      .where(
        and(
          eq(dashboardsTable.slug, candidate),
          eq(dashboardsTable.ownerUserId, userId),
          excludeId ? ne(dashboardsTable.id, excludeId) : undefined,
        ),
      );
    if (!exists) return candidate;
    attempt++;
  }
}

async function auditLog(
  action: string,
  detail: string,
  userId?: number,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      module:  "dashboard_studio",
      entity:  "dashboard",
      action,
      detail,
      userId: userId != null ? String(userId) : null,
    });
  } catch {
    // auditLog nunca debe romper el flujo principal
  }
}

// ── getDashboardAccess ────────────────────────────────────────────────────────
// Retorna el nivel de acceso del usuario sobre un dashboard.
// Orden de prioridad: owner → super_admin → permisos explícitos → null (sin acceso)
//
// La función usa `dashboardPermissionsTable` que es la tabla canónica para
// accesos compartidos — un usuario solo puede ver o modificar dashboards
// de otro usuario si tiene un registro en esa tabla.
async function getDashboardAccess(
  dashId: number,
  userId: number,
  dbUser?: AuthenticatedRequest["dbUser"],
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const [dash] = await db
    .select({ ownerUserId: dashboardsTable.ownerUserId })
    .from(dashboardsTable)
    .where(eq(dashboardsTable.id, dashId));

  if (!dash) return null;
  if (dash.ownerUserId === userId) return "owner";
  if (dbUser?.role === "super_admin") return "admin";

  // Verificar permiso explícito en dashboard_permissions
  const [perm] = await db
    .select({ permissionLevel: dashboardPermissionsTable.permissionLevel })
    .from(dashboardPermissionsTable)
    .where(
      and(
        eq(dashboardPermissionsTable.dashboardId, dashId),
        eq(dashboardPermissionsTable.subjectType, "user"),
        eq(dashboardPermissionsTable.subjectId, userId),
      ),
    );

  if (perm) return perm.permissionLevel as "admin" | "edit" | "view";

  // Sin acceso — no es owner, no es super_admin, no tiene permiso explícito
  return null;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateDashboardSchema = z.object({
  name:        z.string().trim().min(1, "El nombre es requerido").max(200),
  description: z.string().max(500).optional().nullable(),
  icon:        z.string().max(10).optional().default("📊"),
  color:       z.string().max(20).optional().default("#6b7280"),
  category:    z.string().max(50).optional().default("general"),
});

const UpdateDashboardSchema = z.object({
  name:                    z.string().trim().min(1).max(200).optional(),
  description:             z.string().max(500).optional().nullable(),
  icon:                    z.string().max(10).optional().nullable(),
  color:                   z.string().max(20).optional().nullable(),
  category:                z.string().max(50).optional().nullable(),
  status:                  z.enum(["draft", "active", "archived"]).optional(),
  isFavorite:              z.boolean().optional(),
  refreshIntervalSeconds:  z.number().int().min(30).max(86400).optional().nullable(),
}).strict();

const UpdateLayoutSchema = z.object({
  breakpoint: z.enum(["desktop", "tablet", "mobile"]),
  layoutJson: z.array(z.unknown()),
});

const SaveDashboardSchema = z.object({
  name:                   z.string().trim().min(1).max(200).optional(),
  status:                 z.enum(["draft", "active", "archived"]).optional(),
  refreshIntervalSeconds: z.number().int().optional().nullable(),
  widgetOrder:            z.array(z.object({
    id:         z.number().int().positive(),
    orderIndex: z.number().int().min(0),
  })).optional(),
  layout: z.object({
    breakpoint: z.enum(["desktop", "tablet", "mobile"]),
    layoutJson: z.array(z.unknown()),
  }).optional(),
});

const PermissionPatchSchema = z.object({
  op:             z.enum(["grant", "revoke", "update"]),
  subjectType:    z.enum(["user", "role"]),
  subjectId:      z.number().int().positive().optional(),
  subjectRoleKey: z.string().optional(),
  permissionLevel: z.enum(["view", "edit", "admin"]).optional(),
});

const CreateWidgetSchema = z.object({
  type:                   z.string().trim().min(1),
  title:                  z.string().trim().min(1).max(200),
  subtitle:               z.string().max(200).optional().nullable(),
  dataSourceKey:          z.string().optional().nullable(),
  configJson:             z.record(z.unknown()).optional().default({}),
  orderIndex:             z.number().int().min(0).optional().default(0),
  refreshIntervalSeconds: z.number().int().min(10).optional().nullable(),
});

const UpdateWidgetSchema = CreateWidgetSchema.partial();

// Tipo para remap de layout en duplicate — elimina (item: any)
type LayoutItem = {
  widgetId?: number;
  [key: string]: unknown;
};

// ── GET /studio/dashboards ────────────────────────────────────────────────────
router.get("/studio/dashboards", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const tab    = typeof req.query["tab"] === "string" ? req.query["tab"] : "mine";

    if (tab === "templates") {
      const templates = await db
        .select()
        .from(dashboardTemplatesTable)
        .where(eq(dashboardTemplatesTable.isActive, true))
        .orderBy(dashboardTemplatesTable.name);
      res.json(templates);
      return;
    }

    let dashboards: (typeof dashboardsTable.$inferSelect)[] = [];

    if (tab === "shared") {
      const perms = await db
        .select({ dashboardId: dashboardPermissionsTable.dashboardId })
        .from(dashboardPermissionsTable)
        .where(
          and(
            eq(dashboardPermissionsTable.subjectType, "user"),
            eq(dashboardPermissionsTable.subjectId, userId),
          ),
        );
      const ids = perms.map((p) => p.dashboardId);
      if (ids.length === 0) {
        res.json([]);
        return;
      }
      dashboards = await db
        .select()
        .from(dashboardsTable)
        .where(
          and(
            inArray(dashboardsTable.id, ids),
            ne(dashboardsTable.ownerUserId, userId),
          ),
        )
        .orderBy(desc(dashboardsTable.updatedAt));
    } else if (tab === "favorites") {
      dashboards = await db
        .select()
        .from(dashboardsTable)
        .where(
          and(
            eq(dashboardsTable.ownerUserId, userId),
            eq(dashboardsTable.isFavorite, true),
          ),
        )
        .orderBy(desc(dashboardsTable.updatedAt));
    } else if (tab === "archived") {
      dashboards = await db
        .select()
        .from(dashboardsTable)
        .where(
          and(
            eq(dashboardsTable.ownerUserId, userId),
            eq(dashboardsTable.status, "archived"),
          ),
        )
        .orderBy(desc(dashboardsTable.updatedAt));
    } else {
      // "mine" y cualquier otro tab desconocido
      dashboards = await db
        .select()
        .from(dashboardsTable)
        .where(
          and(
            eq(dashboardsTable.ownerUserId, userId),
            ne(dashboardsTable.status, "archived"),
          ),
        )
        .orderBy(desc(dashboardsTable.updatedAt));
    }

    res.json(dashboards);
  } catch (err) {
    logger.error({ err }, "studio: list dashboards error");
    res.status(500).json({ error: "Error al cargar dashboards" });
  }
});

// ── POST /studio/dashboards ───────────────────────────────────────────────────
router.post("/studio/dashboards", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const parsed = CreateDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const d    = parsed.data;
    const slug = await uniqueSlug(d.name, userId);

    const [dash] = await db
      .insert(dashboardsTable)
      .values({
        ownerUserId: userId,
        name:        d.name,
        slug,
        description: d.description ?? null,
        icon:        d.icon,
        color:       d.color,
        category:    d.category,
        status:      "draft",
      })
      .returning();

    await auditLog("studio_dashboard_created", `Dashboard "${d.name}" creado (manual)`, userId);
    res.status(201).json(dash);
  } catch (err) {
    logger.error({ err }, "studio: create dashboard error");
    res.status(500).json({ error: "Error al crear dashboard" });
  }
});

// ── GET /studio/dashboards/:id ────────────────────────────────────────────────
// getDashboardAccess() verifica ownership O permiso explícito en dashboard_permissions.
// Un usuario sin acceso obtiene 404 (no 403) — no revelamos que el dashboard existe.
router.get("/studio/dashboards/:id", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const dbUser = getDbUser(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, dbUser);
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [dash] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [widgets, layouts] = await Promise.all([
      db
        .select()
        .from(dashboardWidgetsTable)
        .where(eq(dashboardWidgetsTable.dashboardId, id))
        .orderBy(dashboardWidgetsTable.orderIndex),
      db
        .select()
        .from(dashboardLayoutsTable)
        .where(eq(dashboardLayoutsTable.dashboardId, id)),
    ]);

    res.json({ ...dash, widgets, layouts, _access: access });
  } catch (err) {
    logger.error({ err }, "studio: get dashboard error");
    res.status(500).json({ error: "Error al cargar dashboard" });
  }
});

// ── PATCH /studio/dashboards/:id ─────────────────────────────────────────────
router.patch("/studio/dashboards/:id", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const dbUser = getDbUser(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, dbUser);
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    const parsed = UpdateDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [dash] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const d = parsed.data;
    const updates: Partial<typeof dashboardsTable.$inferInsert> & {
      updatedAt: Date;
      version: number;
    } = {
      updatedAt: new Date(),
      version:   (dash.version ?? 0) + 1,
    };

    if (d.name !== undefined)                  updates.name = d.name;
    if (d.description !== undefined)           updates.description = d.description;
    if (d.icon !== undefined)                  updates.icon = d.icon;
    if (d.color !== undefined)                 updates.color = d.color;
    if (d.category !== undefined)              updates.category = d.category;
    if (d.status !== undefined)                updates.status = d.status;
    if (d.isFavorite !== undefined)            updates.isFavorite = d.isFavorite;
    if (d.refreshIntervalSeconds !== undefined) updates.refreshIntervalSeconds = d.refreshIntervalSeconds;

    if (d.name && d.name !== dash.name) {
      updates.slug = await uniqueSlug(d.name, userId, id);
    }

    const [updated] = await db
      .update(dashboardsTable)
      .set(updates)
      .where(eq(dashboardsTable.id, id))
      .returning();

    await auditLog("studio_dashboard_updated", `Dashboard "${dash.name}" actualizado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update dashboard error");
    res.status(500).json({ error: "Error al actualizar dashboard" });
  }
});

// ── POST /studio/dashboards/:id/duplicate ────────────────────────────────────
router.post("/studio/dashboards/:id/duplicate", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [source] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!source) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const [widgets, layouts] = await Promise.all([
      db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, id)),
      db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id)),
    ]);

    const newName = (req.body.name as string | undefined) ?? `${source.name} (copia)`;
    const newSlug = await uniqueSlug(newName, userId);

    const [newDash] = await db
      .insert(dashboardsTable)
      .values({
        ownerUserId: userId,
        name:        newName,
        slug:        newSlug,
        description: source.description,
        icon:        source.icon,
        color:       source.color,
        category:    source.category,
        status:      "draft",
      })
      .returning();

    // Duplicar widgets y construir mapa de IDs para remap en layouts
    const widgetIdMap = new Map<number, number>();
    if (widgets.length > 0) {
      const newWidgets = await db
        .insert(dashboardWidgetsTable)
        .values(
          widgets.map((w) => ({
            dashboardId:            newDash.id,
            type:                   w.type,
            title:                  w.title,
            subtitle:               w.subtitle,
            dataSourceKey:          w.dataSourceKey,
            configJson:             w.configJson,
            orderIndex:             w.orderIndex,
            visible:                w.visible,
            refreshIntervalSeconds: w.refreshIntervalSeconds ?? null,
          })),
        )
        .returning({ id: dashboardWidgetsTable.id });

      widgets.forEach((oldW, i) => {
        if (newWidgets[i]) widgetIdMap.set(oldW.id, newWidgets[i].id);
      });
    }

    // Remap de widgetId en layouts — tipado explícito, sin (item: any)
    if (layouts.length > 0) {
      await db.insert(dashboardLayoutsTable).values(
        layouts.map((l) => {
          const rawItems = Array.isArray(l.layoutJson) ? (l.layoutJson as LayoutItem[]) : [];
          const remapped = rawItems.map((item) => ({
            ...item,
            widgetId:
              item.widgetId != null
                ? (widgetIdMap.get(item.widgetId) ?? item.widgetId)
                : item.widgetId,
          }));
          return {
            dashboardId: newDash.id,
            breakpoint:  l.breakpoint,
            layoutJson:  remapped,
          };
        }),
      );
    }

    await auditLog(
      "studio_dashboard_duplicated",
      `Dashboard "${source.name}" duplicado como "${newName}"`,
      userId,
    );
    res.status(201).json(newDash);
  } catch (err) {
    logger.error({ err }, "studio: duplicate dashboard error");
    res.status(500).json({ error: "Error al duplicar dashboard" });
  }
});

// ── POST /studio/dashboards/:id/archive ──────────────────────────────────────
router.post("/studio/dashboards/:id/archive", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) {
      res.status(403).json({ error: "Solo el propietario puede archivar este dashboard" });
      return;
    }

    const [updated] = await db
      .update(dashboardsTable)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(dashboardsTable.id, id))
      .returning();

    await auditLog("studio_dashboard_archived", `Dashboard "${dash.name}" archivado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: archive dashboard error");
    res.status(500).json({ error: "Error al archivar dashboard" });
  }
});

// ── POST /studio/dashboards/:id/restore ──────────────────────────────────────
router.post("/studio/dashboards/:id/restore", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) {
      res.status(403).json({ error: "Solo el propietario puede restaurar este dashboard" });
      return;
    }

    const [updated] = await db
      .update(dashboardsTable)
      .set({ status: "draft", archivedAt: null, updatedAt: new Date() })
      .where(eq(dashboardsTable.id, id))
      .returning();

    await auditLog("studio_dashboard_restored", `Dashboard "${dash.name}" restaurado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: restore dashboard error");
    res.status(500).json({ error: "Error al restaurar dashboard" });
  }
});

// ── DELETE /studio/dashboards/:id ────────────────────────────────────────────
router.delete("/studio/dashboards/:id", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) {
      res.status(403).json({ error: "Solo el propietario puede eliminar este dashboard" });
      return;
    }
    if (dash.isSystem) {
      res.status(403).json({ error: "No se pueden eliminar dashboards del sistema" });
      return;
    }

    await db.delete(dashboardsTable).where(eq(dashboardsTable.id, id));
    await auditLog("studio_dashboard_deleted", `Dashboard "${dash.name}" eliminado`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete dashboard error");
    res.status(500).json({ error: "Error al eliminar dashboard" });
  }
});

// ── GET /studio/dashboards/:id/layouts ───────────────────────────────────────
router.get("/studio/dashboards/:id/layouts", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const rows = await db
      .select()
      .from(dashboardLayoutsTable)
      .where(eq(dashboardLayoutsTable.dashboardId, id));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: get layouts error");
    res.status(500).json({ error: "Error al cargar layouts" });
  }
});

// ── PATCH /studio/dashboards/:id/layouts ─────────────────────────────────────
router.patch("/studio/dashboards/:id/layouts", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    const parsed = UpdateLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const { breakpoint, layoutJson } = parsed.data;

    const [existing] = await db
      .select()
      .from(dashboardLayoutsTable)
      .where(
        and(
          eq(dashboardLayoutsTable.dashboardId, id),
          eq(dashboardLayoutsTable.breakpoint, breakpoint),
        ),
      );

    if (existing) {
      await db
        .update(dashboardLayoutsTable)
        .set({
          layoutJson,
          updatedAt: new Date(),
          version:   (existing.version ?? 0) + 1,
        })
        .where(eq(dashboardLayoutsTable.id, existing.id));
    } else {
      await db.insert(dashboardLayoutsTable).values({
        dashboardId: id,
        breakpoint,
        layoutJson,
      });
    }

    await auditLog(
      "studio_layout_updated",
      `Layout ${breakpoint} actualizado para dashboard #${id}`,
      userId,
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: update layout error");
    res.status(500).json({ error: "Error al actualizar layout" });
  }
});

// ── POST /studio/dashboards/:id/save — guardado atómico ──────────────────────
// Actualiza metadata + orden de widgets + layout en una sola transacción.
router.post("/studio/dashboards/:id/save", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    const parsed = SaveDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const { name, status, refreshIntervalSeconds, widgetOrder, layout } = parsed.data;

    await db.transaction(async (tx) => {
      const [dash] = await tx
        .select()
        .from(dashboardsTable)
        .where(eq(dashboardsTable.id, id));
      if (!dash) throw new Error("Dashboard no encontrado");

      const updates: Partial<typeof dashboardsTable.$inferInsert> & {
        updatedAt: Date;
        version: number;
      } = {
        updatedAt: new Date(),
        version:   (dash.version ?? 0) + 1,
      };

      if (name !== undefined)                  updates.name = name;
      if (status !== undefined)                updates.status = status;
      if (refreshIntervalSeconds !== undefined) updates.refreshIntervalSeconds = refreshIntervalSeconds;

      if (name && name !== dash.name) {
        updates.slug = await uniqueSlug(name, userId, id);
      }

      await tx.update(dashboardsTable).set(updates).where(eq(dashboardsTable.id, id));

      // Actualizar orden de widgets en paralelo
      if (widgetOrder && widgetOrder.length > 0) {
        await Promise.all(
          widgetOrder.map(({ id: wId, orderIndex }) =>
            tx
              .update(dashboardWidgetsTable)
              .set({ orderIndex })
              .where(
                and(
                  eq(dashboardWidgetsTable.id, wId),
                  eq(dashboardWidgetsTable.dashboardId, id),
                ),
              ),
          ),
        );
      }

      // Upsert layout
      if (layout?.breakpoint && Array.isArray(layout.layoutJson)) {
        const [existing] = await tx
          .select()
          .from(dashboardLayoutsTable)
          .where(
            and(
              eq(dashboardLayoutsTable.dashboardId, id),
              eq(dashboardLayoutsTable.breakpoint, layout.breakpoint),
            ),
          );

        if (existing) {
          await tx
            .update(dashboardLayoutsTable)
            .set({
              layoutJson: layout.layoutJson,
              updatedAt:  new Date(),
              version:    (existing.version ?? 0) + 1,
            })
            .where(eq(dashboardLayoutsTable.id, existing.id));
        } else {
          await tx.insert(dashboardLayoutsTable).values({
            dashboardId: id,
            breakpoint:  layout.breakpoint,
            layoutJson:  layout.layoutJson,
          });
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

// ── GET /studio/dashboards/:id/permissions ───────────────────────────────────
router.get("/studio/dashboards/:id/permissions", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)                             { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view" || access === "edit") {
      res.status(403).json({ error: "Solo el propietario puede ver los permisos" });
      return;
    }

    const perms    = await db
      .select()
      .from(dashboardPermissionsTable)
      .where(eq(dashboardPermissionsTable.dashboardId, id));

    // Batch-load users — inArray en lugar de sql.join manual
    const userIds = perms
      .filter((p) => p.subjectType === "user" && p.subjectId != null)
      .map((p) => p.subjectId as number);

    const usersMap = new Map<number, { id: number; email: string | null; name: string | null }>();
    if (userIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of users) usersMap.set(u.id, u);
    }

    const enriched = perms.map((p) => ({
      ...p,
      user:
        p.subjectType === "user" && p.subjectId != null
          ? (usersMap.get(p.subjectId) ?? null)
          : null,
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "studio: get permissions error");
    res.status(500).json({ error: "Error al cargar permisos" });
  }
});

// ── PATCH /studio/dashboards/:id/permissions ─────────────────────────────────
router.patch("/studio/dashboards/:id/permissions", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)                                 { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access !== "owner" && access !== "admin") { res.status(403).json({ error: "Solo el propietario o administradores pueden cambiar permisos" }); return; }

    const parsed = PermissionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const { op, subjectType, subjectId, subjectRoleKey, permissionLevel } = parsed.data;

    if (subjectType === "user") {
      if (!subjectId) { res.status(400).json({ error: "subjectId (user ID) requerido" }); return; }
      if (subjectId === userId) { res.status(400).json({ error: "No podés modificar tus propios permisos" }); return; }

      const [targetUser] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, subjectId));
      if (!targetUser) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    }

    if (op === "revoke") {
      const where =
        subjectType === "user"
          ? and(
              eq(dashboardPermissionsTable.dashboardId, id),
              eq(dashboardPermissionsTable.subjectType, "user"),
              eq(dashboardPermissionsTable.subjectId, subjectId!),
            )
          : and(
              eq(dashboardPermissionsTable.dashboardId, id),
              eq(dashboardPermissionsTable.subjectType, "role"),
              eq(dashboardPermissionsTable.roleKey, subjectRoleKey!),
            );
      await db.delete(dashboardPermissionsTable).where(where!);
      await auditLog(`studio_permission_revoked`, `Permiso revocado para ${subjectType} en dashboard #${id}`, userId);
      res.json({ ok: true });
      return;
    }

    if (!permissionLevel) {
      res.status(400).json({ error: "permissionLevel requerido para grant/update" });
      return;
    }

    // Prevenir escalada de privilegios: solo owner puede otorgar "admin"
    if (
      permissionLevel === "admin" &&
      access !== "owner" &&
      getDbUser(req)?.role !== "super_admin"
    ) {
      res.status(403).json({ error: "Solo el propietario puede otorgar permisos de admin" });
      return;
    }

    // Upsert del permiso
    const existingWhere =
      subjectType === "user"
        ? and(
            eq(dashboardPermissionsTable.dashboardId, id),
            eq(dashboardPermissionsTable.subjectType, "user"),
            eq(dashboardPermissionsTable.subjectId, subjectId!),
          )
        : and(
            eq(dashboardPermissionsTable.dashboardId, id),
            eq(dashboardPermissionsTable.subjectType, "role"),
            eq(dashboardPermissionsTable.roleKey, subjectRoleKey!),
          );

    const [existing] = await db
      .select()
      .from(dashboardPermissionsTable)
      .where(existingWhere!);

    if (existing) {
      await db
        .update(dashboardPermissionsTable)
        .set({ permissionLevel })
        .where(eq(dashboardPermissionsTable.id, existing.id));
    } else {
      await db.insert(dashboardPermissionsTable).values({
        dashboardId:     id,
        subjectType,
        subjectId:       subjectType === "user" ? subjectId ?? null : null,
        roleKey:         subjectType === "role" ? subjectRoleKey ?? null : null,
        permissionLevel,
      });
    }

    await auditLog(
      "studio_permission_granted",
      `Permiso ${permissionLevel} otorgado a ${subjectType} en dashboard #${id}`,
      userId,
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: update permissions error");
    res.status(500).json({ error: "Error al actualizar permisos" });
  }
});

// ── GET /studio/dashboards/:id/widgets ───────────────────────────────────────
router.get("/studio/dashboards/:id/widgets", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const widgets = await db
      .select()
      .from(dashboardWidgetsTable)
      .where(eq(dashboardWidgetsTable.dashboardId, id))
      .orderBy(dashboardWidgetsTable.orderIndex);
    res.json(widgets);
  } catch (err) {
    logger.error({ err }, "studio: get widgets error");
    res.status(500).json({ error: "Error al cargar widgets" });
  }
});

// ── POST /studio/dashboards/:id/widgets ──────────────────────────────────────
router.post("/studio/dashboards/:id/widgets", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    const parsed = CreateWidgetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const d = parsed.data;

    const [widget] = await db
      .insert(dashboardWidgetsTable)
      .values({
        dashboardId:            id,
        type:                   d.type,
        title:                  d.title,
        subtitle:               d.subtitle ?? null,
        dataSourceKey:          d.dataSourceKey ?? null,
        configJson:             d.configJson,
        orderIndex:             d.orderIndex,
        refreshIntervalSeconds: d.refreshIntervalSeconds ?? null,
      })
      .returning();

    res.status(201).json(widget);
  } catch (err) {
    logger.error({ err }, "studio: create widget error");
    res.status(500).json({ error: "Error al crear widget" });
  }
});

// ── PATCH /studio/dashboards/:id/widgets/:wid ────────────────────────────────
router.patch("/studio/dashboards/:id/widgets/:wid", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    const wid    = parseId(req.params["wid"]);
    if (!id || !wid) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    const parsed = UpdateWidgetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [updated] = await db
      .update(dashboardWidgetsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardWidgetsTable.id, wid),
          eq(dashboardWidgetsTable.dashboardId, id),
        ),
      )
      .returning();

    if (!updated) { res.status(404).json({ error: "Widget no encontrado" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update widget error");
    res.status(500).json({ error: "Error al actualizar widget" });
  }
});

// ── DELETE /studio/dashboards/:id/widgets/:wid ───────────────────────────────
router.delete("/studio/dashboards/:id/widgets/:wid", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    const wid    = parseId(req.params["wid"]);
    if (!id || !wid) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access)          { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (access === "view") { res.status(403).json({ error: "Sin permiso de edición" }); return; }

    await db
      .delete(dashboardWidgetsTable)
      .where(
        and(
          eq(dashboardWidgetsTable.id, wid),
          eq(dashboardWidgetsTable.dashboardId, id),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete widget error");
    res.status(500).json({ error: "Error al eliminar widget" });
  }
});

// ── GET /studio/widget-definitions ───────────────────────────────────────────
router.get("/studio/widget-definitions", studioAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const defs = await db
      .select()
      .from(widgetDefinitionsTable)
      .where(eq(widgetDefinitionsTable.isActive, true))
      .orderBy(widgetDefinitionsTable.name);
    res.json(defs);
  } catch (err) {
    logger.error({ err }, "studio: widget definitions error");
    res.status(500).json({ error: "Error al cargar definiciones de widgets" });
  }
});

// ── GET /studio/data-sources ──────────────────────────────────────────────────
router.get("/studio/data-sources", studioAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(DATA_SOURCE_CATALOG);
  } catch (err) {
    logger.error({ err }, "studio: data sources error");
    res.status(500).json({ error: "Error al cargar fuentes de datos" });
  }
});

// ── POST /studio/data-sources/:key/resolve ───────────────────────────────────
// Resuelve los datos de una fuente para previsualización en el builder.
// Requiere acceso a un dashboard para evitar que cualquier usuario resuelva
// fuentes de datos sin contexto.
router.post("/studio/data-sources/:key/resolve", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const key    = req.params["key"];
    const userId = getCurrentUserIdNum(req);
    if (!key) { res.status(400).json({ error: "key requerido" }); return; }

    const data = await resolveDataSource(key, userId, req.body ?? {});
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al resolver fuente";
    logger.error({ err }, "studio: data source resolve error");
    res.status(500).json({ error: msg });
  }
});

// ── GET /studio/templates ─────────────────────────────────────────────────────
router.get("/studio/templates", studioAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const templates = await db
      .select()
      .from(dashboardTemplatesTable)
      .where(eq(dashboardTemplatesTable.isActive, true))
      .orderBy(dashboardTemplatesTable.name);
    res.json(templates);
  } catch (err) {
    logger.error({ err }, "studio: templates list error");
    res.status(500).json({ error: "Error al cargar plantillas" });
  }
});

// ── POST /studio/generate/prompt ─────────────────────────────────────────────
router.post("/studio/generate/prompt", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const prompt = z.string().trim().min(5).max(500).safeParse(req.body?.prompt);
    if (!prompt.success) {
      res.status(400).json({ error: "El prompt debe tener entre 5 y 500 caracteres" });
      return;
    }
    const result = await generateFromPrompt(prompt.data, userId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "studio: generate from prompt error");
    res.status(500).json({ error: "Error al generar dashboard desde prompt" });
  }
});

// ── POST /studio/generate/template ───────────────────────────────────────────
router.post("/studio/generate/template", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId     = getCurrentUserIdNum(req);
    const templateId = parseId(req.body?.templateId);
    if (!templateId) { res.status(400).json({ error: "templateId requerido" }); return; }
    const result = await generateFromTemplate(templateId, userId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "studio: generate from template error");
    res.status(500).json({ error: "Error al generar dashboard desde plantilla" });
  }
});

// ── POST /studio/generate/wizard ─────────────────────────────────────────────
router.post("/studio/generate/wizard", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const result = await generateFromWizard(req.body as WizardInput, userId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "studio: generate from wizard error");
    res.status(500).json({ error: "Error al generar dashboard desde wizard" });
  }
});

// ── POST /studio/dashboards/:id/smart-summary ────────────────────────────────
router.post("/studio/dashboards/:id/smart-summary", studioAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id     = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const access = await getDashboardAccess(id, userId, getDbUser(req));
    if (!access) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const context: SmartSummaryContext = { dashboardId: id, userId, ...(req.body ?? {}) };
    const summary = await buildSmartSummary(context);
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "studio: smart summary error");
    res.status(500).json({ error: "Error al generar resumen inteligente" });
  }
});

export default router;
