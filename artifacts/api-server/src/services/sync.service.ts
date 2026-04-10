import { db, syncLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export type SyncModule = "weather" | "news" | "fiscal" | "travel" | "emails";
export type SyncStatus = "success" | "error" | "partial";

export interface SyncResult {
  module: SyncModule;
  status: SyncStatus;
  recordsCount: number;
  message?: string;
  durationMs: number;
}

export async function logSync(result: SyncResult): Promise<void> {
  try {
    await db.insert(syncLogsTable).values({
      module: result.module,
      status: result.status,
      recordsCount: result.recordsCount,
      message: result.message,
      durationMs: result.durationMs,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write sync log");
  }
}

export async function getLastSync(module: SyncModule) {
  const logs = await db
    .select()
    .from(syncLogsTable)
    .orderBy(syncLogsTable.startedAt);

  const filtered = logs
    .filter(l => l.module === module && l.status === "success")
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return filtered[0] ?? null;
}

export async function getRecentSyncLogs(module?: SyncModule, limit = 20) {
  const all = await db.select().from(syncLogsTable).orderBy(syncLogsTable.startedAt);
  const filtered = module ? all.filter(l => l.module === module) : all;
  return filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, limit);
}

export async function withSyncLog<T>(
  module: SyncModule,
  fn: () => Promise<{ count: number; result: T }>
): Promise<T> {
  const start = Date.now();
  try {
    const { count, result } = await fn();
    await logSync({
      module,
      status: "success",
      recordsCount: count,
      durationMs: Date.now() - start,
    });
    return result;
  } catch (err: any) {
    await logSync({
      module,
      status: "error",
      recordsCount: 0,
      message: err?.message ?? "Unknown error",
      durationMs: Date.now() - start,
    });
    throw err;
  }
}
