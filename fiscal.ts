import { Router, type IRouter } from "express";
import { eq, desc, and, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db, fiscalUpdatesTable, discardLogsTable } from "@workspace/db";
import {
  GetFiscalUpdateParams,
  ToggleFiscalSavedParams,
} from "@workspace/api-zod";
import {
  refreshFiscalSources,
  ensureFiscalUpToDate,
  FISCAL_RSS_SOURCES,
} from "../services/fiscal.service.js";
import { getLastSync } from "../services/sync.service.js";
import { DEFAULT_QUALITY_THRESHOLD } from "../services/data-quality.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Schema de query params para GET /fiscal ───────────────────────────────────
const FiscalQuerySchema = z.object({
  jurisdiction:    z.string().optional(),
  category:        z.string().optional(),
  impact:          z.enum(["low", "medium", "high", "critical"]).optional(),
  requiresAction:  z.enum(["true", "false"]).optional(),
  search:          z.string().max(200).optional(),
  qualityMin:      z.coerce.number().int().min(0).max(100).optional(),
  sources:         z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});

// ── GET /fiscal/metrics ───────────────────────────────────────────────────────
// Métricas de resumen del monitor fiscal (cargadas en JS — tabla pequeña)
router.get("/fiscal/metrics", async (_req, res): Promise<void> => {
  try {
    const all = await db.select().from(fiscalUpdatesTable);
    const threshold = DEFAULT_QUALITY_THRESHOLD;
    const visible = all.filter(
      (f) => !f.isHidden && (f.qualityScore ?? 70) >= threshold,
    );

    res.json({
      total:           visible.length,
      highImpact:      visible.filter((f) => f.impact === "high").length,
      requiresAction:  visible.filter((f) => f.requiresAction).length,
      normative:       visible.filter((f) => f.isNormative).length,
      needsReview:     all.filter((f) => f.needsReview).length,
      discarded:       all.filter((f) => (f.qualityScore ?? 70) < threshold).length,
      avgQualityScore:
        visible.length
          ? Math.round(
              visible.reduce((acc, f) => acc + (f.qualityScore ?? 70), 0) /
                visible.length,
            )
          : 0,
    });
  } catch (err) {
    logger.error({ err }, "Fiscal metrics error");
    res.status(500).json({ error: "Error al calcular métricas fiscales" });
  }
});

// ── GET /fiscal/saved ─────────────────────────────────────────────────────────
router.get("/fiscal/saved", async (_req, res): Promise<void> => {
  try {
    const saved = await db
      .select()
      .from(fiscalUpdatesTable)
      .where(eq(fiscalUpdatesTable.isSaved, true))
      .orderBy(desc(fiscalUpdatesTable.createdAt));
    res.json(saved);
  } catch (err) {
    logger.error({ err }, "Fiscal saved fetch error");
    res.status(500).json({ error: "Error al cargar actualizaciones guardadas" });
  }
});

// ── GET /fiscal/sources ───────────────────────────────────────────────────────
router.get("/fiscal/sources", async (_req, res): Promise<void> => {
  try {
    res.json(
      FISCAL_RSS_SOURCES.map((s) => ({
        name:     s.name,
        organism: s.organism,
        category: s.category,
        enabled:  s.enabled,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Fiscal sources error");
    res.status(500).json({ error: "Error al cargar fuentes fiscales" });
  }
});

// ── GET /fiscal/discards ──────────────────────────────────────────────────────
router.get("/fiscal/discards", async (req, res): Promise<void> => {
  try {
    const module =
      typeof req.query["module"] === "string" ? req.query["module"] : undefined;

    const query = db
      .select()
      .from(discardLogsTable)
      .orderBy(desc(discardLogsTable.discardedAt))
      .limit(100);

    const logs = module
      ? await db
          .select()
          .from(discardLogsTable)
          .where(eq(discardLogsTable.module, module))
          .orderBy(desc(discardLogsTable.discardedAt))
          .limit(100)
      : await query;

    res.json(logs);
  } catch (err) {
    logger.error({ err }, "Discard logs fetch error");
    res.status(500).json({ error: "Error al obtener logs de descarte" });
  }
});

// ── GET /fiscal ───────────────────────────────────────────────────────────────
// Lista principal del monitor fiscal con filtros.
// La actualización background se dispara pero no bloquea la respuesta.
router.get("/fiscal", async (req, res): Promise<void> => {
  try {
    // Disparar actualización en background — loguear si falla, nunca bloquear
    ensureFiscalUpToDate().catch((err: unknown) => {
      logger.warn({ err }, "ensureFiscalUpToDate background update failed");
    });

    const queryParsed = FiscalQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({
        error: queryParsed.error.issues[0]?.message ?? "Query params inválidos",
      });
      return;
    }

    const {
      jurisdiction,
      category,
      impact,
      requiresAction,
      search,
      qualityMin = DEFAULT_QUALITY_THRESHOLD,
      sources = [],
    } = queryParsed.data;

    // ── Filtros SQL (ejecutados en DB, no en JS) ───────────────────────────────
    // Los filtros principales se aplican en la query para evitar cargar toda la
    // tabla en memoria. El filtro de `search` usa ilike de Drizzle (case-insensitive).
    const conditions = [
      eq(fiscalUpdatesTable.isHidden, false),
    ];

    if (jurisdiction) {
      conditions.push(eq(fiscalUpdatesTable.jurisdiction, jurisdiction));
    }
    if (category) {
      conditions.push(eq(fiscalUpdatesTable.category, category));
    }
    if (impact) {
      conditions.push(eq(fiscalUpdatesTable.impact, impact));
    }
    if (requiresAction === "true") {
      conditions.push(eq(fiscalUpdatesTable.requiresAction, true));
    } else if (requiresAction === "false") {
      conditions.push(eq(fiscalUpdatesTable.requiresAction, false));
    }
    if (search) {
      conditions.push(
        or(
          ilike(fiscalUpdatesTable.title, `%${search}%`),
          ilike(fiscalUpdatesTable.summary, `%${search}%`),
          ilike(fiscalUpdatesTable.organism, `%${search}%`),
        )!,
      );
    }

    let items = await db
      .select()
      .from(fiscalUpdatesTable)
      .where(and(...conditions))
      .orderBy(desc(fiscalUpdatesTable.createdAt));

    // ── Filtros post-query (no expresables directamente en Drizzle ORM) ────────
    // qualityScore y sources requieren lógica no trivial en SQL — se aplican en JS
    // sobre el resultado ya filtrado (que es mucho más pequeño que la tabla completa)
    items = items.filter((f) => (f.qualityScore ?? 70) >= qualityMin);

    if (sources.length > 0) {
      items = items.filter(
        (f) => f.source != null && sources.includes(f.source),
      );
    }

    // Ordenar por fecha de la noticia (no de creación en DB)
    items.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    res.json(items);
  } catch (err) {
    logger.error({ err }, "Fiscal route error");
    res.status(500).json({ error: "Error al cargar monitor fiscal", items: [] });
  }
});

// ── POST /fiscal/refresh ──────────────────────────────────────────────────────
router.post("/fiscal/refresh", async (_req, res): Promise<void> => {
  try {
    const count = await refreshFiscalSources();
    const lastSync = await getLastSync("fiscal");
    res.json({
      ok:       true,
      newItems: count,
      lastSync: lastSync?.startedAt ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Fiscal refresh error");
    res.status(500).json({ error: "Error al actualizar monitor fiscal" });
  }
});

// ── GET /fiscal/:id ───────────────────────────────────────────────────────────
router.get("/fiscal/:id", async (req, res): Promise<void> => {
  try {
    const params = GetFiscalUpdateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "ID inválido" });
      return;
    }
    const [item] = await db
      .select()
      .from(fiscalUpdatesTable)
      .where(eq(fiscalUpdatesTable.id, params.data.id));
    if (!item) { res.status(404).json({ error: "Actualización fiscal no encontrada" }); return; }
    res.json(item);
  } catch (err) {
    logger.error({ err }, "Fiscal get by id error");
    res.status(500).json({ error: "Error al cargar actualización fiscal" });
  }
});

// ── PATCH /fiscal/:id/save ────────────────────────────────────────────────────
router.patch("/fiscal/:id/save", async (req, res): Promise<void> => {
  try {
    const params = ToggleFiscalSavedParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "ID inválido" });
      return;
    }
    const [existing] = await db
      .select()
      .from(fiscalUpdatesTable)
      .where(eq(fiscalUpdatesTable.id, params.data.id));
    if (!existing) { res.status(404).json({ error: "Actualización fiscal no encontrada" }); return; }

    const [updated] = await db
      .update(fiscalUpdatesTable)
      .set({ isSaved: !existing.isSaved })
      .where(eq(fiscalUpdatesTable.id, params.data.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Fiscal toggle save error");
    res.status(500).json({ error: "Error al guardar/desguardar actualización" });
  }
});

export default router;
