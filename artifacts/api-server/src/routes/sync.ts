import { Router, type IRouter } from "express";
import { refreshWeather } from "../services/weather.service.js";
import { refreshNews } from "../services/news.service.js";
import { refreshFiscalSources } from "../services/fiscal.service.js";
import { getRecentSyncLogs, getLastSync } from "../services/sync.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/sync/status", async (_req, res): Promise<void> => {
  try {
    const [weather, news, fiscal] = await Promise.all([
      getLastSync("weather"),
      getLastSync("news"),
      getLastSync("fiscal"),
    ]);

    res.json({
      weather: weather ? { lastSync: weather.startedAt, status: weather.status } : null,
      news: news ? { lastSync: news.startedAt, status: news.status } : null,
      fiscal: fiscal ? { lastSync: fiscal.startedAt, status: fiscal.status } : null,
    });
  } catch (err) {
    logger.error({ err }, "Sync status error");
    res.status(500).json({ error: "Error al obtener estado de sincronización" });
  }
});

router.get("/sync/logs", async (req, res): Promise<void> => {
  try {
    const module = req.query.module as string | undefined;
    const limit = Number(req.query.limit) || 50;
    const validModules = ["weather", "news", "fiscal", "travel", "emails"];
    const mod = validModules.includes(module ?? "") ? (module as any) : undefined;
    const logs = await getRecentSyncLogs(mod, limit);
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "Sync logs error");
    res.status(500).json({ error: "Error al obtener logs" });
  }
});

router.post("/sync/:module", async (req, res): Promise<void> => {
  const { module } = req.params;

  try {
    switch (module) {
      case "weather": {
        const result = await refreshWeather();
        res.json({ ok: true, module: "weather", count: result.forecast.length, fetchedAt: result.fetchedAt });
        break;
      }
      case "news": {
        const count = await refreshNews();
        res.json({ ok: true, module: "news", newItems: count });
        break;
      }
      case "fiscal": {
        const count = await refreshFiscalSources();
        res.json({ ok: true, module: "fiscal", newItems: count });
        break;
      }
      case "all": {
        const [weatherResult, newsCount, fiscalCount] = await Promise.allSettled([
          refreshWeather(),
          refreshNews(),
          refreshFiscalSources(),
        ]);
        res.json({
          ok: true,
          weather: weatherResult.status === "fulfilled" ? "ok" : "error",
          news: newsCount.status === "fulfilled" ? newsCount.value : "error",
          fiscal: fiscalCount.status === "fulfilled" ? fiscalCount.value : "error",
        });
        break;
      }
      default:
        res.status(400).json({ error: `Unknown module: ${module}` });
    }
  } catch (err: any) {
    logger.error({ err, module }, "Manual sync error");
    res.status(500).json({ error: err?.message ?? "Sync failed", module });
  }
});

export default router;
