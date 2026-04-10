import { Router, type IRouter } from "express";
import { getWeatherForecast, refreshWeather } from "../services/weather.service.js";
import { getLastSync } from "../services/sync.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/weather", async (_req, res): Promise<void> => {
  try {
    const result = await getWeatherForecast();
    res.json(result.forecast);
  } catch (err) {
    logger.error({ err }, "Weather route error");
    res.status(500).json([]);
  }
});

router.post("/weather/refresh", async (_req, res): Promise<void> => {
  try {
    const result = await refreshWeather();
    res.json({ ok: true, fetchedAt: result.fetchedAt, count: result.forecast.length });
  } catch (err) {
    logger.error({ err }, "Weather refresh error");
    res.status(500).json({ error: "Error al actualizar el clima" });
  }
});

export default router;
