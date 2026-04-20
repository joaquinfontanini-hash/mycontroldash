import { db, jobLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type JobStatus = "running" | "success" | "failed" | "skipped";

export const JOB_NAMES = {
  WEATHER:     "weather",
  NEWS:        "news",
  FISCAL:      "fiscal",
  SEMAFOROS:   "semaforos",
  EMAIL_ALERTS:"email_alerts",
  CURRENCY:    "currency",
  BCRA:        "bcra",
} as const;

export async function startJob(jobName: string): Promise<number> {
  try {
    const [row] = await db
      .insert(jobLogsTable)
      .values({ jobName, status: "running", startedAt: new Date() })
      .returning({ id: jobLogsTable.id });
    return row?.id ?? -1;
  } catch (err) {
    logger.warn({ err, jobName }, "job-logger: failed to start job log");
    return -1;
  }
}

export async function finishJob(
  id: number,
  status: JobStatus,
  opts: { recordsAffected?: number; errorMessage?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  if (id < 0) return;
  const finished = new Date();
  try {
    const [existing] = await db.select({ startedAt: jobLogsTable.startedAt }).from(jobLogsTable).where(eq(jobLogsTable.id, id));
    const durationMs = existing ? finished.getTime() - new Date(existing.startedAt).getTime() : undefined;
    await db
      .update(jobLogsTable)
      .set({
        status,
        finishedAt: finished,
        durationMs,
        recordsAffected: opts.recordsAffected ?? 0,
        errorMessage: opts.errorMessage ?? null,
        metaJson: opts.meta ? JSON.stringify(opts.meta) : null,
      })
      .where(eq(jobLogsTable.id, id));
  } catch (err) {
    logger.warn({ err, id, jobName: "?" }, "job-logger: failed to finish job log");
  }
}

export async function withJobLog<T>(
  jobName: string,
  fn: () => Promise<{ records?: number; meta?: Record<string, unknown>; result: T }>,
): Promise<T> {
  const id = await startJob(jobName);
  try {
    const { records = 0, meta, result } = await fn();
    await finishJob(id, "success", { recordsAffected: records, meta });
    return result;
  } catch (err: any) {
    await finishJob(id, "failed", { errorMessage: err?.message ?? "Unknown error" });
    throw err;
  }
}

export async function getJobSummary() {
  const rows = await db
    .select()
    .from(jobLogsTable)
    .orderBy(desc(jobLogsTable.startedAt));

  const byJob: Record<string, (typeof rows)[0][]> = {};
  for (const row of rows) {
    if (!byJob[row.jobName]) byJob[row.jobName] = [];
    byJob[row.jobName].push(row);
  }

  return Object.entries(byJob).map(([jobName, logs]) => {
    const last = logs[0];
    const last7 = logs.slice(0, 7);
    const successRate = last7.length
      ? Math.round((last7.filter(l => l.status === "success").length / last7.length) * 100)
      : null;
    return {
      jobName,
      lastStatus: last.status,
      lastRunAt: last.startedAt,
      lastFinishedAt: last.finishedAt,
      lastDurationMs: last.durationMs,
      lastError: last.errorMessage,
      successRate,
      recentRuns: last7.map(l => ({
        id: l.id,
        status: l.status,
        startedAt: l.startedAt,
        durationMs: l.durationMs,
        errorMessage: l.errorMessage,
        recordsAffected: l.recordsAffected,
      })),
    };
  });
}
