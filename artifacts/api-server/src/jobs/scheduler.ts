import cron from "node-cron";
import { refreshWeather } from "../services/weather.service.js";
import { refreshNews } from "../services/news.service.js";
import { refreshFiscalSources } from "../services/fiscal.service.js";
import { updateAllTrafficLights } from "../services/afip-engine.js";
import { runDailyAlertJob } from "../services/email-alert.service.js";
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

  // Semáforos: recalculate every day at 07:00 (before email alerts)
  cron.schedule("0 7 * * *", async () => {
    logger.info("Cron: recalculating semáforos...");
    try {
      const result = await updateAllTrafficLights();
      logger.info({ updated: result.updated }, "Cron: semáforos recalculated");
    } catch (err) {
      logger.error({ err }, "Cron semáforos recalculation failed");
    }
  });

  // Email alerts: send daily reminders at 08:00
  cron.schedule("0 8 * * *", async () => {
    logger.info("Cron: running daily email alert job...");
    try {
      const result = await runDailyAlertJob();
      logger.info(result, "Cron: daily email alerts completed");
    } catch (err) {
      logger.error({ err }, "Cron daily email alerts failed");
    }
  });

  logger.info("Scheduler started: weather(2h), news(1h), fiscal(3h), semáforos(7:00), alerts(8:00)");
}
