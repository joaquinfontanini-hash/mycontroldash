import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getNews,
  refreshNews,
  ensureNewsUpToDate,
  RSS_SOURCES,
  saveNews,
  unsaveNews,
  getSavedNews,
  getUserAlerts,
  createUserAlert,
  updateUserAlert,
  deleteUserAlert,
} from "../services/news.service.js";
import { getLastSync } from "../services/sync.service.js";
import { logger } from "../lib/logger.js";
import {
  requireAuth,
  getCurrentUserId,
} from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Normaliza un artículo al shape que espera el frontend
// El tipo del parámetro es inferido del servicio — no usamos `any`
function formatNewsItem(n: Awaited<ReturnType<typeof getNews>>[number], savedByUser = false) {
  return {
    id:            n.id,
    title:         n.title,
    source:        n.source,
    regionLevel:   n.regionLevel,
    newsCategory:  n.newsCategory,
    tags:          n.tags ?? [],
    impactLevel:   n.impactLevel,
    priorityScore: n.priorityScore,
    date:          n.publishedAt ?? n.fetchedAt,
    summary:       n.summary,
    url:           n.url ?? "",
    imageUrl:      n.imageUrl,
    savedByUser:   (n as { savedByUser?: boolean }).savedByUser ?? savedByUser,
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const NewsQuerySchema = z.object({
  regionLevel:  z.string().optional(),
  newsCategory: z.string().optional(),
  source:       z.string().optional(),
  search:       z.string().max(200).optional(),
  limit:        z.coerce.number().int().min(1).max(500).optional().default(100),
});

const CreateAlertSchema = z.object({
  regionLevel:  z.string().optional().nullable(),
  newsCategory: z.string().optional().nullable(),
  label:        z.string().max(100).optional().nullable(),
});

const UpdateAlertSchema = z.object({
  active: z.boolean().optional(),
  label:  z.string().max(100).optional().nullable(),
});

// ── GET /news ─────────────────────────────────────────────────────────────────
// Devuelve artículos con enrichment de saved status si el usuario está autenticado.
// ensureNewsUpToDate() dispara en background sin bloquear la respuesta.
router.get("/news", requireAuth, async (req, res): Promise<void> => {
  try {
    ensureNewsUpToDate().catch((err: unknown) => {
      logger.warn({ err }, "ensureNewsUpToDate background refresh failed");
    });

    const q = NewsQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query params inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const news = await getNews({ ...q.data, userId });

    res.json(news.map((n) => formatNewsItem(n)));
  } catch (err) {
    logger.error({ err }, "News GET error");
    res.status(500).json({ error: "Error al obtener noticias" });
  }
});

// ── POST /news/refresh ────────────────────────────────────────────────────────
router.post("/news/refresh", requireAuth, async (_req, res): Promise<void> => {
  try {
    const count    = await refreshNews();
    const lastSync = await getLastSync("news");
    res.json({ ok: true, newItems: count, lastSync: lastSync?.startedAt ?? null });
  } catch (err) {
    logger.error({ err }, "News refresh error");
    res.status(500).json({ error: "Error al actualizar noticias" });
  }
});

// ── GET /news/sources ─────────────────────────────────────────────────────────
router.get("/news/sources", requireAuth, async (_req, res): Promise<void> => {
  try {
    res.json(
      RSS_SOURCES.map((s) => ({
        name:     s.name,
        url:      s.url,
        category: s.category,
        enabled:  s.enabled,
      })),
    );
  } catch (err) {
    logger.error({ err }, "News sources error");
    res.status(500).json({ error: "Error al cargar fuentes" });
  }
});

// ── GET /news/saved ───────────────────────────────────────────────────────────
router.get("/news/saved", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const saved  = await getSavedNews(userId);
    res.json(
      saved.map((n) => ({
        ...formatNewsItem(n!, true),
        savedAt: (n as { savedAt?: string }).savedAt,
      })),
    );
  } catch (err) {
    logger.error({ err }, "News saved get error");
    res.status(500).json({ error: "Error al obtener noticias guardadas" });
  }
});

// ── POST /news/:id/save ───────────────────────────────────────────────────────
router.post("/news/:id/save", requireAuth, async (req, res): Promise<void> => {
  try {
    const newsId = parseId(req.params["id"]);
    if (!newsId) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    await saveNews(userId, newsId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News save error");
    res.status(500).json({ error: "Error al guardar noticia" });
  }
});

// ── DELETE /news/:id/save ─────────────────────────────────────────────────────
router.delete("/news/:id/save", requireAuth, async (req, res): Promise<void> => {
  try {
    const newsId = parseId(req.params["id"]);
    if (!newsId) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    await unsaveNews(userId, newsId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News unsave error");
    res.status(500).json({ error: "Error al quitar noticia guardada" });
  }
});

// ── GET /news/alerts ──────────────────────────────────────────────────────────
router.get("/news/alerts", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const alerts = await getUserAlerts(userId);
    res.json(alerts);
  } catch (err) {
    logger.error({ err }, "News alerts get error");
    res.status(500).json({ error: "Error al obtener alertas" });
  }
});

// ── POST /news/alerts ─────────────────────────────────────────────────────────
router.post("/news/alerts", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = CreateAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const alert  = await createUserAlert(userId, parsed.data);
    res.status(201).json(alert);
  } catch (err) {
    logger.error({ err }, "News alert create error");
    res.status(500).json({ error: "Error al crear alerta" });
  }
});

// ── PATCH /news/alerts/:id ────────────────────────────────────────────────────
router.patch("/news/alerts/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const alertId = parseId(req.params["id"]);
    if (!alertId) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = UpdateAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const alert  = await updateUserAlert(userId, alertId, parsed.data);
    if (!alert) { res.status(404).json({ error: "Alerta no encontrada" }); return; }
    res.json(alert);
  } catch (err) {
    logger.error({ err }, "News alert update error");
    res.status(500).json({ error: "Error al actualizar alerta" });
  }
});

// ── DELETE /news/alerts/:id ───────────────────────────────────────────────────
router.delete("/news/alerts/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const alertId = parseId(req.params["id"]);
    if (!alertId) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    await deleteUserAlert(userId, alertId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "News alert delete error");
    res.status(500).json({ error: "Error al eliminar alerta" });
  }
});

export default router;
