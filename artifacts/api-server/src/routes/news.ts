import { Router, type IRouter } from "express";
import { getNews, refreshNews, ensureNewsUpToDate, RSS_SOURCES } from "../services/news.service.js";
import { getLastSync } from "../services/sync.service.js";
import { ListNewsQueryParams } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/news", async (req, res): Promise<void> => {
  try {
    ensureNewsUpToDate().catch(() => {});

    const query = ListNewsQueryParams.safeParse(req.query);
    const category = query.success ? query.data.category : undefined;
    const limit = query.success ? (query.data.limit ?? 20) : 20;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;

    const news = await getNews({ category, source, limit });

    res.json(news.map(n => ({
      id: n.id,
      title: n.title,
      source: n.source,
      category: n.category,
      date: n.publishedAt ?? n.fetchedAt,
      summary: n.summary,
      url: n.url ?? "",
      imageUrl: n.imageUrl,
    })));
  } catch (err) {
    logger.error({ err }, "News route error");
    res.status(500).json({ error: "Error al obtener noticias", items: [] });
  }
});

router.post("/news/refresh", async (_req, res): Promise<void> => {
  try {
    const count = await refreshNews();
    const lastSync = await getLastSync("news");
    res.json({ ok: true, newItems: count, lastSync: lastSync?.startedAt ?? null });
  } catch (err) {
    logger.error({ err }, "News refresh error");
    res.status(500).json({ error: "Error al actualizar noticias" });
  }
});

router.get("/news/sources", async (_req, res): Promise<void> => {
  res.json(RSS_SOURCES.map(s => ({
    name: s.name,
    url: s.url,
    category: s.category,
    enabled: s.enabled,
  })));
});

export default router;
