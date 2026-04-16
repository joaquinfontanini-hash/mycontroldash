import { Router, type IRouter, type Request } from "express";
import {
  getNews, refreshNews, ensureNewsUpToDate, RSS_SOURCES,
  saveNews, unsaveNews, getSavedNews,
  getUserAlerts, createUserAlert, updateUserAlert, deleteUserAlert,
} from "../services/news.service.js";
import { getLastSync } from "../services/sync.service.js";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/require-auth.js";
import { z } from "zod/v4";

const router: IRouter = Router();

// Helper to get userId from session (same pattern as tasks routes)
function getCurrentUserId(req: Request): number {
  return (req as unknown as { dbUser: { id: number } }).dbUser.id;
}

// ── GET /news ─────────────────────────────────────────────────────────────────
// Public-ish endpoint — returns news. Optionally enriched with saved status if authenticated.

router.get("/news", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    ensureNewsUpToDate().catch((err) => {
      logger.warn({ err }, "ensureNewsUpToDate background refresh failed");
    });

    const regionLevel = typeof req.query.regionLevel === "string" ? req.query.regionLevel : undefined;
    const newsCategory = typeof req.query.newsCategory === "string" ? req.query.newsCategory : undefined;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const limit = parseInt(String(req.query.limit ?? "100"), 10);

    let userId: number | undefined;
    try { userId = getCurrentUserId(req); } catch { /* not authenticated */ }

    logger.info({ regionLevel, newsCategory, source, limit, userId }, "News GET: querying articles");

    const news = await getNews({ regionLevel, newsCategory, source, limit, search, userId });

    logger.info({ count: news.length, userId }, "News GET: returning articles");

    res.json(news.map(n => ({
      id: n.id,
      title: n.title,
      source: n.source,
      regionLevel: n.regionLevel,
      newsCategory: n.newsCategory,
      tags: n.tags ?? [],
      impactLevel: n.impactLevel,
      priorityScore: n.priorityScore,
      date: n.publishedAt ?? n.fetchedAt,
      summary: n.summary,
      url: n.url ?? "",
      imageUrl: n.imageUrl,
      savedByUser: n.savedByUser ?? false,
    })));
  } catch (err) {
    logger.error({ err }, "News GET: failed to fetch articles");
    res.status(500).json({ error: "Error al obtener noticias" });
  }
});

// ── POST /news/refresh ────────────────────────────────────────────────────────

router.post("/news/refresh", requireAuth, async (_req, res): Promise<void> => {
  try {
    const count = await refreshNews();
    const lastSync = await getLastSync("news");
    res.json({ ok: true, newItems: count, lastSync: lastSync?.startedAt ?? null });
  } catch (err) {
    logger.error({ err }, "News refresh error");
    res.status(500).json({ error: "Error al actualizar noticias" });
  }
});

// ── GET /news/sources ─────────────────────────────────────────────────────────

router.get("/news/sources", requireAuth, async (_req, res): Promise<void> => {
  res.json(RSS_SOURCES.map(s => ({
    name: s.name,
    url: s.url,
    category: s.category,
    enabled: s.enabled,
  })));
});

// ── GET /news/saved ───────────────────────────────────────────────────────────

router.get("/news/saved", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const saved = await getSavedNews(userId);
    res.json(saved.map(n => ({
      id: n!.id,
      title: n!.title,
      source: n!.source,
      regionLevel: n!.regionLevel,
      newsCategory: n!.newsCategory,
      tags: n!.tags ?? [],
      impactLevel: n!.impactLevel,
      priorityScore: n!.priorityScore,
      date: n!.publishedAt ?? n!.fetchedAt,
      summary: n!.summary,
      url: n!.url ?? "",
      imageUrl: n!.imageUrl,
      savedByUser: true,
      savedAt: (n as unknown as { savedAt: string }).savedAt,
    })));
  } catch (err) {
    logger.error({ err }, "News saved get error");
    res.status(500).json({ error: "Error al obtener noticias guardadas" });
  }
});

// ── POST /news/:id/save ───────────────────────────────────────────────────────

router.post("/news/:id/save", requireAuth, async (req: Request, res): Promise<void> => {
  const newsId = parseInt(req.params["id"] as string);
  if (isNaN(newsId)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const userId = getCurrentUserId(req);
    await saveNews(userId, newsId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News save error");
    res.status(500).json({ error: "Error al guardar noticia" });
  }
});

// ── DELETE /news/:id/save ─────────────────────────────────────────────────────

router.delete("/news/:id/save", requireAuth, async (req: Request, res): Promise<void> => {
  const newsId = parseInt(req.params["id"] as string);
  if (isNaN(newsId)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const userId = getCurrentUserId(req);
    await unsaveNews(userId, newsId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News unsave error");
    res.status(500).json({ error: "Error al quitar noticia guardada" });
  }
});

// ── GET /news/alerts ──────────────────────────────────────────────────────────

router.get("/news/alerts", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const alerts = await getUserAlerts(userId);
    res.json(alerts);
  } catch (err) {
    logger.error({ err }, "News alerts get error");
    res.status(500).json({ error: "Error al obtener alertas" });
  }
});

const CreateAlertBody = z.object({
  regionLevel: z.string().nullable().optional(),
  newsCategory: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});

// ── POST /news/alerts ─────────────────────────────────────────────────────────

router.post("/news/alerts", requireAuth, async (req: Request, res): Promise<void> => {
  const parsed = CreateAlertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Datos inválidos" }); return; }

  try {
    const userId = getCurrentUserId(req);
    const alert = await createUserAlert(userId, parsed.data);
    res.status(201).json(alert);
  } catch (err) {
    logger.error({ err }, "News alert create error");
    res.status(500).json({ error: "Error al crear alerta" });
  }
});

const UpdateAlertBody = z.object({
  active: z.boolean().optional(),
  label: z.string().nullable().optional(),
});

// ── PATCH /news/alerts/:id ────────────────────────────────────────────────────

router.patch("/news/alerts/:id", requireAuth, async (req: Request, res): Promise<void> => {
  const alertId = parseInt(req.params["id"] as string);
  if (isNaN(alertId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const parsed = UpdateAlertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Datos inválidos" }); return; }

  try {
    const userId = getCurrentUserId(req);
    const alert = await updateUserAlert(userId, alertId, parsed.data);
    if (!alert) { res.status(404).json({ error: "Alerta no encontrada" }); return; }
    res.json(alert);
  } catch (err) {
    logger.error({ err }, "News alert update error");
    res.status(500).json({ error: "Error al actualizar alerta" });
  }
});

// ── DELETE /news/alerts/:id ───────────────────────────────────────────────────

router.delete("/news/alerts/:id", requireAuth, async (req: Request, res): Promise<void> => {
  const alertId = parseInt(req.params["id"] as string);
  if (isNaN(alertId)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const userId = getCurrentUserId(req);
    await deleteUserAlert(userId, alertId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News alert delete error");
    res.status(500).json({ error: "Error al eliminar alerta" });
  }
});

export default router;
