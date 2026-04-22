/**
 * scheduler.ts — cron jobs de background
 *
 * Principio de aislamiento: cada job está envuelto en withJobLog() + .catch()
 * separados, de forma que el fallo de un job nunca afecta la ejecución de los demás.
 *
 * Todos los jobs exportan funciones runJobManually() y getJobHealth()
 * para que el panel de admin (routes/admin.ts) pueda inspeccionarlos y
 * ejecutarlos manualmente.
 */

import cron from "node-cron";
import { refreshWeather }          from "../services/weather.service.js";
import { refreshNews }             from "../services/news.service.js";
import { refreshFiscalSources }    from "../services/fiscal.service.js";
import { refreshCurrencyRates }    from "../services/currency.service.js";
import { refreshBcraIndicators }   from "../services/bcra.service.js";
import { updateAllTrafficLights }  from "../services/afip-engine.js";
import { runDailyAlertJob }        from "../services/email-alert.service.js";
import { runDueProfiles }          from "../services/travelSearchService.js";
import { withJobLog, JOB_NAMES }   from "../services/job-logger.js";
import { logger }                  from "../lib/logger.js";

// ── Estado del scheduler ───────────────────────────────────────────────────────

let started       = false;
let travelLastRun: Date | null = null;

// Registro de último resultado por job — para getJobHealth()
const jobLastResult: Record<string, {
  lastRunAt:  Date | null;
  lastStatus: "success" | "error" | "never";
  lastError:  string | null;
}> = {};

function recordJobResult(name: string, status: "success" | "error", error?: string): void {
  jobLastResult[name] = {
    lastRunAt:  new Date(),
    lastStatus: status,
    lastError:  error ?? null,
  };
}

// ── Helper: wrapper aislado ────────────────────────────────────────────────────
// Garantiza que el fallo de un job quede contenido y no propague excepciones
// al scheduler. El .catch() en cada cron.schedule es la segunda línea de defensa;
// este wrapper es la primera.
async function runIsolated(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    recordJobResult(name, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordJobResult(name, "error", message);
    // Loguear con el nombre del job para correlacionar en Railway
    logger.error({ err, job: name }, `Cron job "${name}" falló`);
    // No relanzar — aislamiento garantizado
  }
}

// ── getTravelSchedulerStatus ───────────────────────────────────────────────────
export function getTravelSchedulerStatus(): {
  isRunning: boolean;
  lastRun:   Date | null;
  nextRun:   Date;
} {
  const next = new Date();
  next.setMinutes(45, 0, 0);
  if (next <= new Date()) next.setHours(next.getHours() + 1);
  return { isRunning: started, lastRun: travelLastRun, nextRun: next };
}

// ── getJobHealth ───────────────────────────────────────────────────────────────
// Exportado para routes/admin.ts (GET /admin/jobs/health)
export function getJobHealth(): Record<string, {
  lastRunAt:  Date | null;
  lastStatus: "success" | "error" | "never";
  lastError:  string | null;
  schedulerRunning: boolean;
}> {
  const allJobs = [
    JOB_NAMES.WEATHER,
    JOB_NAMES.NEWS,
    JOB_NAMES.FISCAL,
    JOB_NAMES.CURRENCY,
    JOB_NAMES.SEMAFOROS,
    JOB_NAMES.BCRA,
    JOB_NAMES.EMAIL_ALERTS,
    "travel",
  ];

  return Object.fromEntries(
    allJobs.map((name) => [
      name,
      {
        schedulerRunning: started,
        ...(jobLastResult[name] ?? {
          lastRunAt:  null,
          lastStatus: "never" as const,
          lastError:  null,
        }),
      },
    ]),
  );
}

// ── runJobManually ─────────────────────────────────────────────────────────────
// Exportado para routes/admin.ts (POST /admin/jobs/:name/run)
export async function runJobManually(jobName: string): Promise<{ ran: string }> {
  const JOBS: Record<string, () => Promise<void>> = {
    [JOB_NAMES.WEATHER]:      async () => { await refreshWeather(); },
    [JOB_NAMES.NEWS]:         async () => { await refreshNews(); },
    [JOB_NAMES.FISCAL]:       async () => { await refreshFiscalSources(); },
    [JOB_NAMES.CURRENCY]:     async () => { await refreshCurrencyRates(); },
    [JOB_NAMES.SEMAFOROS]:    async () => { await updateAllTrafficLights(); },
    [JOB_NAMES.BCRA]:         async () => { await refreshBcraIndicators(); },
    [JOB_NAMES.EMAIL_ALERTS]: async () => { await runDailyAlertJob(); },
    travel:                    async () => { await runDueProfiles(); },
  };

  const fn = JOBS[jobName];
  if (!fn) throw new Error(`Job "${jobName}" no encontrado. Disponibles: ${Object.keys(JOBS).join(", ")}`);

  logger.info({ job: jobName }, "Manual job run triggered");
  await runIsolated(jobName, fn);
  return { ran: jobName };
}

// ── startScheduler ─────────────────────────────────────────────────────────────
export function startScheduler(): void {
  if (started) return;
  started = true;
  logger.info("Iniciando scheduler de jobs en background...");

  // ── Clima: cada 2 horas ────────────────────────────────────────────────────
  cron.schedule("0 */2 * * *", () => {
    void runIsolated(JOB_NAMES.WEATHER, async () => {
      await withJobLog(JOB_NAMES.WEATHER, async () => {
        await refreshWeather();
        return { records: 1, result: undefined };
      });
    });
  });

  // ── Noticias: cada hora a :15 ─────────────────────────────────────────────
  cron.schedule("15 * * * *", () => {
    void runIsolated(JOB_NAMES.NEWS, async () => {
      await withJobLog(JOB_NAMES.NEWS, async () => {
        const count = await refreshNews();
        return { records: count ?? 0, result: undefined };
      });
    });
  });

  // ── Fiscal: cada 3 horas a :30 ────────────────────────────────────────────
  cron.schedule("30 */3 * * *", () => {
    void runIsolated(JOB_NAMES.FISCAL, async () => {
      await withJobLog(JOB_NAMES.FISCAL, async () => {
        await refreshFiscalSources();
        return { records: 1, result: undefined };
      });
    });
  });

  // ── Cotizaciones: cada 30 minutos ─────────────────────────────────────────
  cron.schedule("*/30 * * * *", () => {
    void runIsolated(JOB_NAMES.CURRENCY, async () => {
      await withJobLog(JOB_NAMES.CURRENCY, async () => {
        const count = await refreshCurrencyRates();
        return { records: count, result: undefined };
      });
    });
  });

  // ── Semáforos AFIP: diario a las 07:00 ───────────────────────────────────
  cron.schedule("0 7 * * *", () => {
    void runIsolated(JOB_NAMES.SEMAFOROS, async () => {
      await withJobLog(JOB_NAMES.SEMAFOROS, async () => {
        const result = await updateAllTrafficLights();
        return { records: result.updated ?? 0, result: undefined };
      });
    });
  });

  // ── Indicadores BCRA: diario a las 08:30 ─────────────────────────────────
  cron.schedule("30 8 * * *", () => {
    void runIsolated(JOB_NAMES.BCRA, async () => {
      await withJobLog(JOB_NAMES.BCRA, async () => {
        const fetched = await refreshBcraIndicators();
        return { records: fetched, result: undefined };
      });
    });
  });

  // ── Alertas email: diario a las 08:00 ────────────────────────────────────
  cron.schedule("0 8 * * *", () => {
    void runIsolated(JOB_NAMES.EMAIL_ALERTS, async () => {
      await withJobLog(JOB_NAMES.EMAIL_ALERTS, async () => {
        const result = await runDailyAlertJob();
        return { records: result?.sent ?? 0, result: undefined };
      });
    });
  });

  // ── Búsqueda de viajes: cada hora a :45 ──────────────────────────────────
  // Usa withJobLog para que el job de viajes quede registrado en job_logs
  // igual que los demás (el original lo omitía)
  cron.schedule("45 * * * *", () => {
    travelLastRun = new Date();
    void runIsolated("travel", async () => {
      await withJobLog("travel", async () => {
        await runDueProfiles();
        return { records: 1, result: undefined };
      });
    });
  });

  logger.info(
    "Scheduler iniciado: " +
    "clima(2h @:00), " +
    "noticias(1h @:15), " +
    "fiscal(3h @:30), " +
    "cotizaciones(30m), " +
    "semáforos(07:00 diario), " +
    "bcra(08:30 diario), " +
    "alertas(08:00 diario), " +
    "viajes(1h @:45)",
  );
}
