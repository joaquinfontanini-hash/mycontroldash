import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, fiscalUpdatesTable, discardLogsTable } from "@workspace/db";
import {
  GetFiscalUpdateParams,
  ToggleFiscalSavedParams,
  ListFiscalUpdatesQueryParams,
} from "@workspace/api-zod";
import { refreshFiscalSources, ensureFiscalUpToDate, FISCAL_RSS_SOURCES } from "../services/fiscal.service.js";
import { getLastSync } from "../services/sync.service.js";
import { DEFAULT_QUALITY_THRESHOLD } from "../services/data-quality.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/fiscal/metrics", async (_req, res): Promise<void> => {
  const all = await db.select().from(fiscalUpdatesTable);
  const visible = all.filter(f => !f.isHidden && (f.qualityScore ?? 70) >= DEFAULT_QUALITY_THRESHOLD);
  res.json({
    total: visible.length,
    highImpact: visible.filter(f => f.impact === "high").length,
    requiresAction: visible.filter(f => f.requiresAction).length,
    normative: visible.filter(f => f.isNormative).length,
    needsReview: all.filter(f => f.needsReview).length,
    discarded: all.filter(f => (f.qualityScore ?? 70) < DEFAULT_QUALITY_THRESHOLD).length,
    avgQualityScore: visible.length
      ? Math.round(visible.reduce((acc, f) => acc + (f.qualityScore ?? 70), 0) / visible.length)
      : 0,
  });
});

router.get("/fiscal/saved", async (_req, res): Promise<void> => {
  const saved = await db.select().from(fiscalUpdatesTable).where(eq(fiscalUpdatesTable.isSaved, true));
  res.json(saved);
});

router.get("/fiscal/sources", async (_req, res): Promise<void> => {
  res.json(FISCAL_RSS_SOURCES.map(s => ({
    name: s.name,
    organism: s.organism,
    category: s.category,
    enabled: s.enabled,
  })));
});

router.get("/fiscal/discards", async (req, res): Promise<void> => {
  try {
    const module = typeof req.query.module === "string" ? req.query.module : undefined;
    let logs = await db.select().from(discardLogsTable).orderBy(desc(discardLogsTable.discardedAt));
    if (module) logs = logs.filter(l => l.module === module);
    res.json(logs.slice(0, 100));
  } catch (err) {
    logger.error({ err }, "Discard logs fetch error");
    res.status(500).json({ error: "Error al obtener logs de descarte" });
  }
});

router.get("/fiscal", async (req, res): Promise<void> => {
  try {
    ensureFiscalUpToDate().catch(() => {});

    const query = ListFiscalUpdatesQueryParams.safeParse(req.query);
    const rawThreshold = req.query.qualityMin;
    const qualityMin = rawThreshold != null && !isNaN(Number(rawThreshold))
      ? Number(rawThreshold)
      : DEFAULT_QUALITY_THRESHOLD;

    let items = await db.select().from(fiscalUpdatesTable).orderBy(fiscalUpdatesTable.createdAt);

    // Always filter hidden
    items = items.filter(f => !f.isHidden);

    // Quality threshold
    items = items.filter(f => (f.qualityScore ?? 70) >= qualityMin);

    const rawSources = req.query.sources;
    const activeSources = rawSources
      ? (Array.isArray(rawSources) ? rawSources : [rawSources]) as string[]
      : [];

    if (query.success) {
      const { jurisdiction, category, impact, requiresAction, search } = query.data;
      if (jurisdiction) items = items.filter(f => f.jurisdiction === jurisdiction);
      if (category) items = items.filter(f => f.category === category);
      if (impact) items = items.filter(f => f.impact === impact);
      if (requiresAction === "true") items = items.filter(f => f.requiresAction === true);
      if (requiresAction === "false") items = items.filter(f => f.requiresAction === false);
      if (search) {
        const s = search.toLowerCase();
        items = items.filter(f =>
          f.title.toLowerCase().includes(s) ||
          f.summary.toLowerCase().includes(s) ||
          f.organism.toLowerCase().includes(s)
        );
      }
    }

    if (activeSources.length > 0) {
      items = items.filter(f => f.source != null && activeSources.includes(f.source));
    }

    res.json(items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  } catch (err) {
    logger.error({ err }, "Fiscal route error");
    res.status(500).json({ error: "Error al cargar monitor fiscal", items: [] });
  }
});

router.post("/fiscal/refresh", async (_req, res): Promise<void> => {
  try {
    const count = await refreshFiscalSources();
    const lastSync = await getLastSync("fiscal");
    res.json({ ok: true, newItems: count, lastSync: lastSync?.startedAt ?? null });
  } catch (err) {
    logger.error({ err }, "Fiscal refresh error");
    res.status(500).json({ error: "Error al actualizar monitor fiscal" });
  }
});

router.get("/fiscal/:id", async (req, res): Promise<void> => {
  const params = GetFiscalUpdateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.select().from(fiscalUpdatesTable).where(eq(fiscalUpdatesTable.id, params.data.id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(item);
});

router.patch("/fiscal/:id/save", async (req, res): Promise<void> => {
  const params = ToggleFiscalSavedParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(fiscalUpdatesTable).where(eq(fiscalUpdatesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db
    .update(fiscalUpdatesTable)
    .set({ isSaved: !existing.isSaved })
    .where(eq(fiscalUpdatesTable.id, params.data.id))
    .returning();
  res.json(updated);
});

export default router;
