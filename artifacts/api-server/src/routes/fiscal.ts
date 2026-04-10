import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, fiscalUpdatesTable } from "@workspace/db";
import {
  GetFiscalUpdateParams,
  ToggleFiscalSavedParams,
  ListFiscalUpdatesQueryParams,
} from "@workspace/api-zod";
import { refreshFiscalSources, ensureFiscalUpToDate, FISCAL_RSS_SOURCES } from "../services/fiscal.service.js";
import { getLastSync } from "../services/sync.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/fiscal/metrics", async (_req, res): Promise<void> => {
  const all = await db.select().from(fiscalUpdatesTable);
  res.json({
    total: all.length,
    highImpact: all.filter(f => f.impact === "high").length,
    requiresAction: all.filter(f => f.requiresAction).length,
    normative: all.filter(f => (f as any).isNormative).length,
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

router.get("/fiscal", async (req, res): Promise<void> => {
  try {
    ensureFiscalUpToDate().catch(() => {});

    const query = ListFiscalUpdatesQueryParams.safeParse(req.query);
    let items = await db.select().from(fiscalUpdatesTable).orderBy(fiscalUpdatesTable.createdAt);

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
