/**
 * notification-engine.ts
 *
 * Motor central de notificaciones.
 *
 * Flujo:
 *  dispatch(event)
 *    → registra el evento en notification_events
 *    → si el tipo es inmediato: evalúa preferencias del usuario
 *    → verifica deduplicación (dedupe_key + ventana 24h)
 *    → envía via email-provider
 *    → registra delivery en notification_deliveries
 *
 * Tipos de eventos:
 *   forgot_password     — siempre se envía (no respeta prefs, es transaccional)
 *   password_changed    — siempre se envía
 *   login               — según loginEnabled + loginEveryAccess/loginNewDeviceOnly
 *   login_suspicious    — siempre se envía (seguridad)
 *   due_date            — según dueDateEnabled
 *   news                — según newsEnabled
 *   dollar              — según dollarEnabled
 *   test                — siempre se envía
 */

import { db } from "@workspace/db";
import {
  notificationEventsTable, notificationDeliveriesTable,
  userNotificationPrefsTable, usersTable,
} from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { sendTemplateEmail, type SendResult } from "./email-provider.service.js";
import type { TemplateKey } from "./email-templates.js";
import { logger } from "../lib/logger.js";

// ── Event types ───────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "forgot_password"
  | "password_changed"
  | "login"
  | "login_suspicious"
  | "due_date"
  | "news"
  | "dollar"
  | "test";

export interface DispatchOptions {
  userId?: number;
  eventType: NotificationEventType;
  eventSubtype?: string;
  payload: Record<string, unknown>;
  recipientEmail: string;
  dedupeKey?: string;
  dedupeWindowMs?: number;    // default: 12h for logins, 24h for others
}

// ── Event → Template mapping ──────────────────────────────────────────────────

function getTemplateKey(eventType: NotificationEventType): TemplateKey {
  const map: Record<NotificationEventType, TemplateKey> = {
    forgot_password:  "forgot_password_request",
    password_changed: "password_changed",
    login:            "login_alert",
    login_suspicious: "login_alert",
    due_date:         "due_date_alert",
    news:             "news_alert",
    dollar:           "dollar_alert",
    test:             "test_email",
  };
  return map[eventType];
}

// ── Transactional events (ignore user prefs) ──────────────────────────────────

const TRANSACTIONAL_EVENTS: NotificationEventType[] = [
  "forgot_password",
  "password_changed",
  "login_suspicious",
  "test",
];

// ── Deduplication ─────────────────────────────────────────────────────────────

async function isDuplicate(dedupeKey: string, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: notificationDeliveriesTable.id })
    .from(notificationDeliveriesTable)
    .innerJoin(notificationEventsTable, eq(notificationDeliveriesTable.notificationEventId, notificationEventsTable.id))
    .where(
      and(
        eq(notificationEventsTable.dedupeKey, dedupeKey),
        gte(notificationDeliveriesTable.createdAt, since),
        eq(notificationDeliveriesTable.deliveryStatus, "sent"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ── User preferences evaluation ───────────────────────────────────────────────

async function shouldSendForUser(
  userId: number,
  eventType: NotificationEventType,
  eventSubtype?: string,
): Promise<{ allowed: boolean; reason: string }> {
  // Transactional events bypass prefs
  if (TRANSACTIONAL_EVENTS.includes(eventType)) {
    return { allowed: true, reason: "transactional" };
  }

  const [prefs] = await db
    .select()
    .from(userNotificationPrefsTable)
    .where(eq(userNotificationPrefsTable.userId, userId));

  if (!prefs) return { allowed: true, reason: "no_prefs_default_true" };
  if (!prefs.emailEnabled) return { allowed: false, reason: "email_disabled_globally" };

  switch (eventType) {
    case "due_date":
      if (!prefs.dueDateEnabled) return { allowed: false, reason: "due_date_disabled" };
      return { allowed: true, reason: "due_date_enabled" };

    case "news":
      if (!prefs.newsEnabled) return { allowed: false, reason: "news_disabled" };
      return { allowed: true, reason: "news_enabled" };

    case "dollar":
      if (!prefs.dollarEnabled) return { allowed: false, reason: "dollar_disabled" };
      return { allowed: true, reason: "dollar_enabled" };

    case "login": {
      if (!prefs.loginEnabled) return { allowed: false, reason: "login_disabled" };
      if (prefs.loginEveryAccess) return { allowed: true, reason: "login_every_access" };
      if (prefs.loginNewDeviceOnly && eventSubtype === "new_device") return { allowed: true, reason: "new_device" };
      if (prefs.loginSuspiciousOnly && eventSubtype === "suspicious") return { allowed: true, reason: "suspicious" };
      if (!prefs.loginEveryAccess && !prefs.loginNewDeviceOnly && !prefs.loginSuspiciousOnly) {
        return { allowed: false, reason: "login_no_active_rule" };
      }
      return { allowed: false, reason: "login_not_matching_rule" };
    }

    default:
      return { allowed: true, reason: "default" };
  }
}

// ── Main dispatch function ────────────────────────────────────────────────────

export async function dispatch(opts: DispatchOptions): Promise<{
  sent: boolean;
  reason: string;
  eventId?: number;
  deliveryId?: number;
}> {
  const windowMs = opts.dedupeWindowMs ?? (opts.eventType === "login" ? 12 * 3600_000 : 24 * 3600_000);

  // Deduplication check (before creating the event record)
  if (opts.dedupeKey) {
    const dup = await isDuplicate(opts.dedupeKey, windowMs);
    if (dup) {
      logger.debug({ eventType: opts.eventType, dedupeKey: opts.dedupeKey }, "notification-engine: duplicate, skipped");
      return { sent: false, reason: "deduplicated" };
    }
  }

  // User preference check
  if (opts.userId) {
    const { allowed, reason } = await shouldSendForUser(opts.userId, opts.eventType, opts.eventSubtype);
    if (!allowed) {
      logger.debug({ eventType: opts.eventType, userId: opts.userId, reason }, "notification-engine: skipped by preference");
      return { sent: false, reason };
    }
  }

  // Create event record
  const [event] = await db.insert(notificationEventsTable).values({
    userId:       opts.userId ?? null,
    eventType:    opts.eventType,
    eventSubtype: opts.eventSubtype ?? null,
    payloadJson:  JSON.stringify(opts.payload),
    dedupeKey:    opts.dedupeKey ?? null,
    processedAt:  new Date(),
  }).returning();

  const eventId = event?.id;

  // Send email
  const templateKey = getTemplateKey(opts.eventType);
  let result: SendResult;
  try {
    result = await sendTemplateEmail(
      templateKey,
      opts.payload,
      opts.recipientEmail,
      { userId: opts.userId },
    );
  } catch (err) {
    result = { ok: false, status: "failed", error: String(err) };
  }

  // Record delivery
  const [delivery] = await db.insert(notificationDeliveriesTable).values({
    notificationEventId: eventId ?? null,
    userId:              opts.userId ?? null,
    channel:             "email",
    provider:            "smtp",
    deliveryStatus:      result.ok ? "sent" : result.status,
    retryCount:          0,
    providerMessageId:   result.messageId ?? null,
    errorMessage:        result.error ?? null,
    sentAt:              result.ok ? new Date() : null,
  }).returning();

  const deliveryId = delivery?.id;

  if (!result.ok) {
    logger.warn({ eventType: opts.eventType, error: result.error, status: result.status }, "notification-engine: send failed");
    return { sent: false, reason: result.status, eventId, deliveryId };
  }

  logger.info({ eventType: opts.eventType, to: opts.recipientEmail, eventId }, "notification-engine: sent");
  return { sent: true, reason: "sent", eventId, deliveryId };
}

// ── Retry failed deliveries ───────────────────────────────────────────────────

export async function retryDelivery(deliveryId: number): Promise<{ ok: boolean; message: string }> {
  const [delivery] = await db
    .select()
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.id, deliveryId));
  if (!delivery) return { ok: false, message: "Delivery no encontrado" };
  if (delivery.deliveryStatus === "sent") return { ok: false, message: "Ya fue enviado" };
  if (delivery.retryCount >= 3) return { ok: false, message: "Máximo de reintentos alcanzado" };

  const [event] = await db
    .select()
    .from(notificationEventsTable)
    .where(eq(notificationEventsTable.id, delivery.notificationEventId ?? -1));
  if (!event) return { ok: false, message: "Evento no encontrado" };

  // Get recipient email
  let recipientEmail = "";
  if (event.userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, event.userId));
    recipientEmail = user?.email ?? "";
  }
  if (!recipientEmail) return { ok: false, message: "Sin email de destinatario" };

  const payload = JSON.parse(event.payloadJson ?? "{}");
  const templateKey = getTemplateKey(event.eventType as NotificationEventType);
  const result = await sendTemplateEmail(templateKey, payload, recipientEmail, { userId: event.userId ?? undefined });

  await db.update(notificationDeliveriesTable).set({
    deliveryStatus:    result.ok ? "sent" : "failed",
    retryCount:        delivery.retryCount + 1,
    errorMessage:      result.error ?? null,
    sentAt:            result.ok ? new Date() : null,
    providerMessageId: result.messageId ?? null,
  }).where(eq(notificationDeliveriesTable.id, deliveryId));

  return { ok: result.ok, message: result.ok ? "Reenviado correctamente" : (result.error ?? "Error al reenviar") };
}

// ── Get user prefs (with defaults) ───────────────────────────────────────────

export async function getUserNotificationPrefs(userId: number) {
  const [prefs] = await db
    .select()
    .from(userNotificationPrefsTable)
    .where(eq(userNotificationPrefsTable.userId, userId));
  return prefs ?? null;
}

/** Upsert user notification preferences */
export async function upsertUserNotificationPrefs(
  userId: number,
  data: Partial<Omit<typeof userNotificationPrefsTable.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt">>,
): Promise<typeof userNotificationPrefsTable.$inferSelect> {
  const existing = await getUserNotificationPrefs(userId);
  if (!existing) {
    const [row] = await db.insert(userNotificationPrefsTable)
      .values({ userId, ...data } as any)
      .returning();
    return row!;
  }
  const [row] = await db.update(userNotificationPrefsTable)
    .set(data)
    .where(eq(userNotificationPrefsTable.userId, userId))
    .returning();
  return row!;
}
