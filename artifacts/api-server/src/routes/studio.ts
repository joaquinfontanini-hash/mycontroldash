import { Router, type IRouter } from "express";
import { eq, and, desc, or, ne } from "drizzle-orm";
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
} from "@workspace/db";
import { requireAuth, getCurrentUserId, getCurrentUserIdNum, assertOwnership } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";
import { DATA_SOURCE_CATALOG, resolveDataSource } from "../services/studio-data-sources.js";
import {
  generateFromPrompt,
  generateFromTemplate,
  generateFromWizard,
  buildDefaultLayouts,
  type WizardInput,
} from "../services/studio-engine.js";

const router: IRouter = Router();

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
      userId: userId ?? null,
      createdAt: new Date(),
    });
  } catch {}
}

async function insertWidgetsAndFilters(
  dashboardId: number,
  widgets: Array<{ type: string; title: string; dataSourceKey?: string | null; configJson?: Record<string, unknown>; orderIndex: number; subtitle?: string }>,
  filters: Array<{ key: string; label: string; type: string; defaultValueJson?: unknown; orderIndex?: number }>
) {
  if (widgets.length > 0) {
    await db.insert(dashboardWidgetsTable).values(
      widgets.map(w => ({
        dashboardId,
        type: w.type,
        title: w.title,
        subtitle: w.subtitle ?? null,
        dataSourceKey: w.dataSourceKey ?? null,
        configJson: w.configJson ?? {},
        orderIndex: w.orderIndex,
      }))
    );
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
}

async function insertLayouts(dashboardId: number, layoutData: { desktop: unknown[]; mobile: unknown[] }) {
  await db.insert(dashboardLayoutsTable).values([
    { dashboardId, breakpoint: "desktop", layoutJson: layoutData.desktop },
    { dashboardId, breakpoint: "mobile", layoutJson: layoutData.mobile },
  ]);
}

// ── GET /api/studio/dashboards ────────────────────────────────────────────────

router.get("/studio/dashboards", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { tab = "mine" } = req.query as { tab?: string };

    let query = db.select().from(dashboardsTable);

    if (tab === "mine") {
      const rows = await db.select().from(dashboardsTable)
        .where(and(eq(dashboardsTable.ownerUserId, userId), ne(dashboardsTable.status, "archived")))
        .orderBy(desc(dashboardsTable.updatedAt));
      res.json(rows);
      return;
    }

    if (tab === "archived") {
      const rows = await db.select().from(dashboardsTable)
        .where(and(eq(dashboardsTable.ownerUserId, userId), eq(dashboardsTable.status, "archived")))
        .orderBy(desc(dashboardsTable.archivedAt));
      res.json(rows);
      return;
    }

    if (tab === "shared") {
      const perms = await db.select({ dashboardId: dashboardPermissionsTable.dashboardId })
        .from(dashboardPermissionsTable)
        .where(eq(dashboardPermissionsTable.subjectId, userId) as any);
      const ids = perms.map(p => p.dashboardId);
      if (ids.length === 0) { res.json([]); return; }
      const rows = await db.select().from(dashboardsTable)
        .where(and(
          or(...ids.map(id => eq(dashboardsTable.id, id))),
          ne(dashboardsTable.ownerUserId, userId),
        ))
        .orderBy(desc(dashboardsTable.updatedAt));
      res.json(rows);
      return;
    }

    // Default: mine
    const rows = await db.select().from(dashboardsTable)
      .where(and(eq(dashboardsTable.ownerUserId, userId), ne(dashboardsTable.status, "archived")))
      .orderBy(desc(dashboardsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: list dashboards error");
    res.status(500).json({ error: "Error al cargar dashboards" });
  }
});

// ── POST /api/studio/dashboards ───────────────────────────────────────────────

router.post("/studio/dashboards", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { name, description, icon, color, category, sourceType = "manual" } = req.body;
    if (!name) { res.status(400).json({ error: "name es requerido" }); return; }

    const slug = await uniqueSlug(name, userId);
    const [dash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name,
      slug,
      description: description ?? null,
      icon: icon ?? "📊",
      color: color ?? "#6b7280",
      category: category ?? "general",
      sourceType,
      status: "draft",
    }).returning();

    await insertLayouts(dash.id, { desktop: [], mobile: [] });
    await auditLog("studio_dashboard_created", `Dashboard "${name}" creado (manual)`, userId);

    res.status(201).json(dash);
  } catch (err) {
    logger.error({ err }, "studio: create dashboard error");
    res.status(500).json({ error: "Error al crear dashboard" });
  }
});

// ── GET /api/studio/dashboards/:id ───────────────────────────────────────────

router.get("/studio/dashboards/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const dbUser = (req as any).dbUser;
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    // ownership or shared permission
    if (dash.ownerUserId !== userId && dbUser?.role !== "super_admin") {
      const [perm] = await db.select().from(dashboardPermissionsTable)
        .where(and(
          eq(dashboardPermissionsTable.dashboardId, id),
          eq(dashboardPermissionsTable.subjectType, "user"),
          eq(dashboardPermissionsTable.subjectId, userId) as any,
        ));
      if (!perm) { res.status(403).json({ error: "Sin acceso a este dashboard" }); return; }
    }

    const [widgets, layouts, filters] = await Promise.all([
      db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, id)),
      db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id)),
      db.select().from(dashboardFiltersTable).where(eq(dashboardFiltersTable.dashboardId, id)),
    ]);

    res.json({ ...dash, widgets, layouts, filters });
  } catch (err) {
    logger.error({ err }, "studio: get dashboard error");
    res.status(500).json({ error: "Error al cargar dashboard" });
  }
});

// ── PATCH /api/studio/dashboards/:id ─────────────────────────────────────────

router.patch("/studio/dashboards/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const { name, description, icon, color, category, status, isFavorite } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) {
      updates.name = name;
      updates.slug = await uniqueSlug(name, userId, id);
    }
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (color !== undefined) updates.color = color;
    if (category !== undefined) updates.category = category;
    if (status !== undefined) updates.status = status;
    if (isFavorite !== undefined) updates.isFavorite = isFavorite;

    const [updated] = await db.update(dashboardsTable).set(updates).where(eq(dashboardsTable.id, id)).returning();
    await auditLog("studio_dashboard_updated", `Dashboard "${dash.name}" actualizado`, userId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update dashboard error");
    res.status(500).json({ error: "Error al actualizar dashboard" });
  }
});

// ── POST /api/studio/dashboards/:id/duplicate ────────────────────────────────

router.post("/studio/dashboards/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [source] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!source) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }

    const newName = `${source.name} (copia)`;
    const slug = await uniqueSlug(newName, userId);

    const [newDash] = await db.insert(dashboardsTable).values({
      ownerUserId: userId,
      name: newName,
      slug,
      description: source.description,
      icon: source.icon,
      color: source.color,
      category: source.category,
      sourceType: source.sourceType,
      templateKey: source.templateKey,
      status: "draft",
    }).returning();

    // Copy widgets
    const widgets = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, id));
    if (widgets.length > 0) {
      await db.insert(dashboardWidgetsTable).values(
        widgets.map(w => ({
          dashboardId: newDash.id,
          type: w.type,
          title: w.title,
          subtitle: w.subtitle,
          dataSourceKey: w.dataSourceKey,
          configJson: w.configJson,
          orderIndex: w.orderIndex,
        }))
      );
    }

    // Copy layouts
    const layouts = await db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id));
    if (layouts.length > 0) {
      await db.insert(dashboardLayoutsTable).values(
        layouts.map(l => ({ dashboardId: newDash.id, breakpoint: l.breakpoint, layoutJson: l.layoutJson }))
      );
    } else {
      await insertLayouts(newDash.id, { desktop: [], mobile: [] });
    }

    // Copy filters
    const filters = await db.select().from(dashboardFiltersTable).where(eq(dashboardFiltersTable.dashboardId, id));
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

    await auditLog("studio_dashboard_duplicated", `Dashboard "${source.name}" duplicado como "${newName}"`, userId);
    res.status(201).json(newDash);
  } catch (err) {
    logger.error({ err }, "studio: duplicate dashboard error");
    res.status(500).json({ error: "Error al duplicar dashboard" });
  }
});

// ── POST /api/studio/dashboards/:id/archive ──────────────────────────────────

router.post("/studio/dashboards/:id/archive", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const [updated] = await db.update(dashboardsTable)
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

// ── POST /api/studio/dashboards/:id/restore ──────────────────────────────────

router.post("/studio/dashboards/:id/restore", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const [updated] = await db.update(dashboardsTable)
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

// ── DELETE /api/studio/dashboards/:id ────────────────────────────────────────

router.delete("/studio/dashboards/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }
    if (dash.isSystem) { res.status(403).json({ error: "No se pueden eliminar dashboards del sistema" }); return; }

    await db.delete(dashboardsTable).where(eq(dashboardsTable.id, id));
    await auditLog("studio_dashboard_deleted", `Dashboard "${dash.name}" eliminado`, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete dashboard error");
    res.status(500).json({ error: "Error al eliminar dashboard" });
  }
});

// ── GET /api/studio/dashboards/:id/layouts ───────────────────────────────────

router.get("/studio/dashboards/:id/layouts", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const rows = await db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.dashboardId, id));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "studio: get layouts error");
    res.status(500).json({ error: "Error al cargar layouts" });
  }
});

// ── PATCH /api/studio/dashboards/:id/layouts ─────────────────────────────────

router.patch("/studio/dashboards/:id/layouts", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const { breakpoint, layoutJson } = req.body;
    if (!breakpoint || !layoutJson) { res.status(400).json({ error: "breakpoint y layoutJson son requeridos" }); return; }

    const existing = await db.select().from(dashboardLayoutsTable)
      .where(and(eq(dashboardLayoutsTable.dashboardId, id), eq(dashboardLayoutsTable.breakpoint, breakpoint)));

    if (existing.length > 0) {
      await db.update(dashboardLayoutsTable)
        .set({ layoutJson, updatedAt: new Date(), version: existing[0].version + 1 })
        .where(eq(dashboardLayoutsTable.id, existing[0].id));
    } else {
      await db.insert(dashboardLayoutsTable).values({ dashboardId: id, breakpoint, layoutJson });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: update layout error");
    res.status(500).json({ error: "Error al actualizar layout" });
  }
});

// ── GET /api/studio/templates ─────────────────────────────────────────────────

router.get("/studio/templates", requireAuth, async (req, res): Promise<void> => {
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

router.get("/studio/widget-definitions", requireAuth, async (req, res): Promise<void> => {
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

router.get("/studio/data-sources", requireAuth, async (req, res): Promise<void> => {
  res.json(DATA_SOURCE_CATALOG);
});

// ── POST /api/studio/generate-from-prompt ────────────────────────────────────

router.post("/studio/generate-from-prompt", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { prompt, save = false } = req.body;
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
      res.status(400).json({ error: "Prompt demasiado corto (mínimo 5 caracteres)" });
      return;
    }

    const generated = generateFromPrompt(prompt.trim());
    const layouts = buildDefaultLayouts(generated.widgets);

    // Record run
    const [run] = await db.insert(dashboardRunsTable).values({
      userId,
      inputType: "prompt",
      promptText: prompt.trim(),
      parsedIntentJson: generated.parsedIntent,
      generatedConfigJson: generated,
      status: "success",
    }).returning();

    if (!save) {
      // Return preview without persisting
      res.json({ preview: true, run: { id: run.id }, generated, layouts });
      return;
    }

    // Persist
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

    await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    await insertLayouts(dash.id, layouts);

    await auditLog("studio_generate_prompt", `Dashboard "${generated.name}" generado desde prompt`, userId);
    res.status(201).json({ preview: false, run: { id: run.id }, dashboard: dash, generated, layouts });
  } catch (err) {
    logger.error({ err }, "studio: generate from prompt error");
    // Record failed run
    try {
      const userId = getCurrentUserIdNum(req);
      await db.insert(dashboardRunsTable).values({
        userId,
        inputType: "prompt",
        promptText: req.body?.prompt ?? null,
        parsedIntentJson: null,
        generatedConfigJson: null,
        status: "error",
        errorMessage: String(err),
      });
    } catch {}
    res.status(500).json({ error: "Error al generar dashboard desde prompt" });
  }
});

// ── POST /api/studio/generate-from-template ──────────────────────────────────

router.post("/studio/generate-from-template", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const { templateKey, name } = req.body;
    if (!templateKey) { res.status(400).json({ error: "templateKey es requerido" }); return; }

    const [tmpl] = await db.select().from(dashboardTemplatesTable)
      .where(and(eq(dashboardTemplatesTable.key, templateKey), eq(dashboardTemplatesTable.isActive, true)));
    if (!tmpl) { res.status(404).json({ error: "Plantilla no encontrada" }); return; }

    const config = tmpl.configJson as { widgets?: unknown[]; filters?: unknown[]; metadata?: Record<string, unknown> };
    const generated = generateFromTemplate({
      widgets: (config.widgets ?? []) as Parameters<typeof generateFromTemplate>[0]["widgets"],
      filters: (config.filters ?? []) as Parameters<typeof generateFromTemplate>[0]["filters"],
      metadata: config.metadata,
    });

    const dashName = name ?? tmpl.name;
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

    const layouts = buildDefaultLayouts(generated.widgets);
    await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    await insertLayouts(dash.id, layouts);

    await db.insert(dashboardRunsTable).values({
      userId,
      inputType: "template",
      parsedIntentJson: generated.parsedIntent,
      generatedConfigJson: generated,
      status: "success",
    });

    await auditLog("studio_generate_template", `Dashboard "${dashName}" generado desde plantilla "${tmpl.name}"`, userId);
    res.status(201).json({ dashboard: dash });
  } catch (err) {
    logger.error({ err }, "studio: generate from template error");
    res.status(500).json({ error: "Error al generar dashboard desde plantilla" });
  }
});

// ── POST /api/studio/generate-from-wizard ────────────────────────────────────

router.post("/studio/generate-from-wizard", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const input = req.body as WizardInput;
    if (!input.name || !input.selectedWidgets?.length) {
      res.status(400).json({ error: "name y al menos un widget son requeridos" });
      return;
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

    const layouts = buildDefaultLayouts(generated.widgets);
    await insertWidgetsAndFilters(dash.id, generated.widgets, generated.filters);
    await insertLayouts(dash.id, layouts);

    await db.insert(dashboardRunsTable).values({
      userId,
      inputType: "wizard",
      parsedIntentJson: generated.parsedIntent,
      generatedConfigJson: generated,
      status: "success",
    });

    await auditLog("studio_generate_wizard", `Dashboard "${input.name}" generado desde wizard`, userId);
    res.status(201).json({ dashboard: dash });
  } catch (err) {
    logger.error({ err }, "studio: generate from wizard error");
    res.status(500).json({ error: "Error al generar dashboard desde wizard" });
  }
});

// ── POST /api/studio/dashboards/:id/widgets ──────────────────────────────────

router.post("/studio/dashboards/:id/widgets", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const dashboardId = parseInt(req.params.id);
    if (isNaN(dashboardId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, dashboardId));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const { type, title, dataSourceKey, configJson, orderIndex = 0 } = req.body;
    if (!type || !title) { res.status(400).json({ error: "type y title son requeridos" }); return; }

    const [widget] = await db.insert(dashboardWidgetsTable).values({
      dashboardId,
      type,
      title,
      dataSourceKey: dataSourceKey ?? null,
      configJson: configJson ?? {},
      orderIndex,
    }).returning();

    res.status(201).json(widget);
  } catch (err) {
    logger.error({ err }, "studio: add widget error");
    res.status(500).json({ error: "Error al agregar widget" });
  }
});

// ── PATCH /api/studio/widgets/:widgetId ──────────────────────────────────────

router.patch("/studio/widgets/:widgetId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const widgetId = parseInt(req.params.widgetId);
    if (isNaN(widgetId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    if (!widget) { res.status(404).json({ error: "Widget no encontrado" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, widget.dashboardId));
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    const { title, subtitle, configJson, visible, orderIndex, dataSourceKey } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (subtitle !== undefined) updates.subtitle = subtitle;
    if (configJson !== undefined) updates.configJson = configJson;
    if (visible !== undefined) updates.visible = visible;
    if (orderIndex !== undefined) updates.orderIndex = orderIndex;
    if (dataSourceKey !== undefined) updates.dataSourceKey = dataSourceKey;

    const [updated] = await db.update(dashboardWidgetsTable).set(updates)
      .where(eq(dashboardWidgetsTable.id, widgetId)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "studio: update widget error");
    res.status(500).json({ error: "Error al actualizar widget" });
  }
});

// ── DELETE /api/studio/widgets/:widgetId ─────────────────────────────────────

router.delete("/studio/widgets/:widgetId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const widgetId = parseInt(req.params.widgetId);
    if (isNaN(widgetId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    if (!widget) { res.status(404).json({ error: "Widget no encontrado" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, widget.dashboardId));
    if (dash.ownerUserId !== userId) { assertOwnership(req, res, String(dash.ownerUserId)); return; }

    await db.delete(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.id, widgetId));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "studio: delete widget error");
    res.status(500).json({ error: "Error al eliminar widget" });
  }
});

// ── GET /api/studio/dashboards/:id/data ──────────────────────────────────────
// Resolve all widget data sources for a dashboard in parallel

router.get("/studio/dashboards/:id/data", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserIdNum(req);
    const strUserId = getCurrentUserId(req);
    const dbUser = (req as any).dbUser;
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [dash] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!dash) { res.status(404).json({ error: "Dashboard no encontrado" }); return; }
    if (dash.ownerUserId !== userId && dbUser?.role !== "super_admin") {
      const [perm] = await db.select().from(dashboardPermissionsTable)
        .where(and(
          eq(dashboardPermissionsTable.dashboardId, id),
          eq(dashboardPermissionsTable.subjectType, "user"),
          eq(dashboardPermissionsTable.subjectId, userId) as any,
        ));
      if (!perm) { res.status(403).json({ error: "Sin acceso" }); return; }
    }

    const widgets = await db.select().from(dashboardWidgetsTable)
      .where(and(eq(dashboardWidgetsTable.dashboardId, id), eq(dashboardWidgetsTable.visible, true)));

    const results: Record<number, unknown> = {};
    await Promise.all(
      widgets.map(async (w) => {
        if (w.dataSourceKey) {
          results[w.id] = await resolveDataSource(w.dataSourceKey, strUserId, w.configJson as Record<string, unknown>);
        }
      })
    );

    res.json(results);
  } catch (err) {
    logger.error({ err }, "studio: resolve widget data error");
    res.status(500).json({ error: "Error al cargar datos de widgets" });
  }
});

export default router;
