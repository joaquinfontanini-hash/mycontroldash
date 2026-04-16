import cron from "node-cron";
import { refreshWeather } from "../services/weather.service.js";
import { refreshNews } from "../services/news.service.js";
import { refreshFiscalSources } from "../services/fiscal.service.js";
import { refreshCurrencyRates } from "../services/currency.service.js";
import { updateAllTrafficLights } from "../services/afip-engine.js";
import { runDailyAlertJob } from "../services/email-alert.service.js";
import { runDueProfiles } from "../services/travelSearchService.js";
import { withJobLog, JOB_NAMES } from "../services/job-logger.js";
import { logger } from "../lib/logger.js";

let started = false;
let travelLastRun: Date | null = null;

export function getTravelSchedulerStatus() {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    isRunning: started,
    lastRun: travelLastRun,
    nextRun: next,
  };
}

export function startScheduler() {
  if (started) return;
  started = true;
  logger.info("Starting background job scheduler...");

  // Weather: every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    await withJobLog(JOB_NAMES.WEATHER, async () => {
      await refreshWeather();
      return { records: 1, result: undefined };
    }).catch(err => logger.error({ err }, "Cron weather refresh failed"));
  });

  // News: every hour
  cron.schedule("15 * * * *", async () => {
    await withJobLog(JOB_NAMES.NEWS, async () => {
      const count = await refreshNews();
      return { records: count ?? 0, result: undefined };
    }).catch(err => logger.error({ err }, "Cron news refresh failed"));
  });

  // Fiscal: every 3 hours
  cron.schedule("30 */3 * * *", async () => {
    await withJobLog(JOB_NAMES.FISCAL, async () => {
      await refreshFiscalSources();
      return { records: 1, result: undefined };
    }).catch(err => logger.error({ err }, "Cron fiscal refresh failed"));
  });

  // Currency: every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    await withJobLog(JOB_NAMES.CURRENCY, async () => {
      const count = await refreshCurrencyRates();
      return { records: count, result: undefined };
    }).catch(err => logger.error({ err }, "Cron currency refresh failed"));
  });

  // Semáforos: recalculate every day at 07:00
  cron.schedule("0 7 * * *", async () => {
    await withJobLog(JOB_NAMES.SEMAFOROS, async () => {
      const result = await updateAllTrafficLights();
      return { records: result.updated ?? 0, result: undefined };
    }).catch(err => logger.error({ err }, "Cron semáforos recalculation failed"));
  });

  // Email alerts: daily at 08:00
  cron.schedule("0 8 * * *", async () => {
    await withJobLog(JOB_NAMES.EMAIL_ALERTS, async () => {
      const result = await runDailyAlertJob();
      return { records: result?.sent ?? 0, result: undefined };
    }).catch(err => logger.error({ err }, "Cron daily email alerts failed"));
  });

  // Travel search: every hour at :45
  cron.schedule("45 * * * *", async () => {
    logger.info("[TravelScheduler] Verificando perfiles activos...");
    travelLastRun = new Date();
    await runDueProfiles().catch(err => logger.error({ err }, "Cron travel search failed"));
  });

  logger.info("Scheduler started: weather(2h), news(1h), fiscal(3h), currency(30m), semáforos(7:00), alerts(8:00), travel(1h)");
}
