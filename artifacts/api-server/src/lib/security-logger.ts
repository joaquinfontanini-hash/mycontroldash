import { db, securityLogsTable } from "@workspace/db";
import { logger } from "./logger.js";

interface SecurityLogEntry {
  actorClerkId?: string | null;
  actorEmail?: string | null;
  targetClerkId?: string | null;
  targetEmail?: string | null;
  action: string;
  module?: string | null;
  result?: "success" | "failure";
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logSecurityEvent(entry: SecurityLogEntry): Promise<void> {
  try {
    await db.insert(securityLogsTable).values({
      actorClerkId: entry.actorClerkId ?? null,
      actorEmail: entry.actorEmail ?? null,
      targetClerkId: entry.targetClerkId ?? null,
      targetEmail: entry.targetEmail ?? null,
      action: entry.action,
      module: entry.module ?? null,
      result: entry.result ?? "success",
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write security log");
  }
}

export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
  return req.ip ?? null;
}
