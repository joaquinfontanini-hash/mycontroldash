import { db, inAppNotificationsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export type NotifType = "due_date" | "news" | "finance" | "system" | "task";
export type NotifSeverity = "info" | "warning" | "critical";

export interface EmitOptions {
  userId: number;
  type: NotifType;
  title: string;
  body: string;
  severity?: NotifSeverity;
  linkUrl?: string;
  payload?: Record<string, unknown>;
}

export async function emitNotification(opts: EmitOptions): Promise<void> {
  try {
    await db.insert(inAppNotificationsTable).values({
      userId: opts.userId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      severity: opts.severity ?? "info",
      linkUrl: opts.linkUrl ?? null,
      payloadJson: opts.payload ? JSON.stringify(opts.payload) : null,
    });
  } catch (err) {
    logger.warn({ err, userId: opts.userId, type: opts.type }, "notification-emitter: failed to emit notification");
  }
}

export async function emitToAll(userIds: number[], opts: Omit<EmitOptions, "userId">): Promise<void> {
  for (const userId of userIds) {
    await emitNotification({ ...opts, userId });
  }
}

// Convenience helpers

export async function notifyDueDate(userId: number, title: string, body: string, severity: NotifSeverity = "warning"): Promise<void> {
  await emitNotification({ userId, type: "due_date", title, body, severity, linkUrl: "/dashboard/due-dates" });
}

export async function notifyFinance(userId: number, title: string, body: string, severity: NotifSeverity = "info"): Promise<void> {
  await emitNotification({ userId, type: "finance", title, body, severity, linkUrl: "/dashboard/finance" });
}

export async function notifyTask(userId: number, title: string, body: string, severity: NotifSeverity = "info"): Promise<void> {
  await emitNotification({ userId, type: "task", title, body, severity, linkUrl: "/dashboard/tasks" });
}

export async function notifySystem(userId: number, title: string, body: string, severity: NotifSeverity = "info"): Promise<void> {
  await emitNotification({ userId, type: "system", title, body, severity });
}
