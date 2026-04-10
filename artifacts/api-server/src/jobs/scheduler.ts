import cron from "node-cron";
import { refreshWeather } from "../services/weather.service.js";
import { refreshNews } from "../services/news.service.js";
import { refreshFiscalSources } from "../services/fiscal.service.js";
import { logger } from "../lib/logger.js";

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;
  logger.info("Starting background job scheduler...");

  // Weather: every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    logger.info("Cron: refreshing weather...");
    try { await refreshWeather(); }
    catch (err) { logger.error({ err }, "Cron weather refresh failed"); }
  });

  // News: every hour
  cron.schedule("15 * * * *", async () => {
    logger.info("Cron: refreshing news...");
    try { await refreshNews(); }
    catch (err) { logger.error({ err }, "Cron news refresh failed"); }
  });

  // Fiscal: every 3 hours
  cron.schedule("30 */3 * * *", async () => {
    logger.info("Cron: refreshing fiscal sources...");
    try { await refreshFiscalSources(); }
    catch (err) { logger.error({ err }, "Cron fiscal refresh failed"); }
  });

  logger.info("Scheduler started: weather(2h), news(1h), fiscal(3h)");
}
