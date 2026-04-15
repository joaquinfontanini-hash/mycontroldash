/**
 * notifications.ts
 *
 * Schema para el sistema completo de notificaciones, email transaccional y alertas.
 *
 * Tablas:
 *  1. password_reset_tokens    — tokens seguros one-time-use para forgot password
 *  2. system_email_provider    — configuración global del proveedor de email
 *  3. user_notification_prefs  — preferencias de alertas por usuario
 *  4. notification_events      — eventos disparadores (inmutables)
 *  5. notification_deliveries  — intentos de entrega por canal
 *  6. email_logs               — log completo de todos los emails enviados
 */
import {
  pgTable, text, serial, timestamp, boolean, integer, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// 1. password_reset_tokens
// ─────────────────────────────────────────────────────────────────────────────

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id:                 serial("id").primaryKey(),
  userId:             integer("user_id").notNull(),
  tokenHash:          text("token_hash").notNull(),         // SHA-256 hex, never store plain token
  expiresAt:          timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt:             timestamp("used_at", { withTimezone: true }),
  requestedIp:        text("requested_ip"),
  requestedUserAgent: text("requested_user_agent"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("prt_user_id_idx").on(t.userId),
  index("prt_token_hash_idx").on(t.tokenHash),
]);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// 2. system_email_provider
// ─────────────────────────────────────────────────────────────────────────────
// Only one active row; always upsert by id=1.
// Credentials stored AES-256-GCM encrypted (see email-crypto.ts).
// providerType: "smtp" | "smtp_gmail" | "sendgrid" | "resend"

export const systemEmailProviderTable = pgTable("system_email_provider", {
  id:                   serial("id").primaryKey(),
  providerType:         text("provider_type").notNull().default("smtp_gmail"),
  senderEmail:          text("sender_email"),
  senderName:           text("sender_name").notNull().default("Sistema Dashboard"),
  replyTo:              text("reply_to"),
  isActive:             boolean("is_active").notNull().default(false),
  connectionStatus:     text("connection_status").notNull().default("not_configured"),
  // encrypted fields (AES-256-GCM, base64)
  encSmtpHost:          text("enc_smtp_host"),
  encSmtpPort:          text("enc_smtp_port"),
  encSmtpUser:          text("enc_smtp_user"),
  encSmtpPass:          text("enc_smtp_pass"),
  // stats
  sentToday:            integer("sent_today").notNull().default(0),
  failedToday:          integer("failed_today").notNull().default(0),
  sentTodayDate:        text("sent_today_date"),   // "YYYY-MM-DD"
  // timestamps
  lastConnectedAt:      timestamp("last_connected_at", { withTimezone: true }),
  lastSuccessAt:        timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt:          timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage:     text("last_error_message"),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SystemEmailProvider = typeof systemEmailProviderTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// 3. user_notification_prefs
// ─────────────────────────────────────────────────────────────────────────────

export const userNotificationPrefsTable = pgTable("user_notification_prefs", {
  id:                    serial("id").primaryKey(),
  userId:                integer("user_id").notNull().unique(),

  // Global toggle
  emailEnabled:          boolean("email_enabled").notNull().default(true),

  // A. Vencimientos
  dueDateEnabled:        boolean("due_date_enabled").notNull().default(true),
  dueDateDaysBefore:     text("due_date_days_before").notNull().default("7,3,1"),  // csv: "7,3,1"
  dueDateSameDay:        boolean("due_date_same_day").notNull().default(true),
  dueDateSummaryOnly:    boolean("due_date_summary_only").notNull().default(false),

  // B. Noticias
  newsEnabled:           boolean("news_enabled").notNull().default(false),
  newsFrequency:         text("news_frequency").notNull().default("daily"),   // immediate | daily | weekly
  newsMinPriority:       text("news_min_priority").notNull().default("high"), // low | medium | high
  newsCategories:        text("news_categories").notNull().default(""),       // csv of category keys
  newsMaxPerDay:         integer("news_max_per_day").notNull().default(3),

  // C. Dólar
  dollarEnabled:         boolean("dollar_enabled").notNull().default(false),
  dollarUpThreshold:     text("dollar_up_threshold"),    // e.g. "5" (%)
  dollarDownThreshold:   text("dollar_down_threshold"),
  dollarMarket:          text("dollar_market").notNull().default("blue"),     // blue | mep | oficial
  dollarDailySummary:    boolean("dollar_daily_summary").notNull().default(false),

  // D. Login / Acceso
  loginEnabled:          boolean("login_enabled").notNull().default(true),
  loginEveryAccess:      boolean("login_every_access").notNull().default(false),
  loginNewDeviceOnly:    boolean("login_new_device_only").notNull().default(true),
  loginSuspiciousOnly:   boolean("login_suspicious_only").notNull().default(false),
  loginPasswordChange:   boolean("login_password_change").notNull().default(true),

  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  index("unp_user_id_idx").on(t.userId),
]);

export const insertUserNotificationPrefsSchema = createInsertSchema(userNotificationPrefsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserNotificationPrefs = z.infer<typeof insertUserNotificationPrefsSchema>;
export type UserNotificationPrefs = typeof userNotificationPrefsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// 4. notification_events — immutable event log
// ─────────────────────────────────────────────────────────────────────────────

export const notificationEventsTable = pgTable("notification_events", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id"),
  eventType:      text("event_type").notNull(),     // forgot_password | password_changed | login | login_suspicious | due_date | news | dollar | test
  eventSubtype:   text("event_subtype"),            // e.g. "new_device", "reminder_7d"
  payloadJson:    text("payload_json"),             // serialized event data
  dedupeKey:      text("dedupe_key"),               // prevents duplicate sends within a window
  scheduledFor:   timestamp("scheduled_for", { withTimezone: true }),
  processedAt:    timestamp("processed_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ne_user_id_idx").on(t.userId),
  index("ne_event_type_idx").on(t.eventType),
  index("ne_dedupe_key_idx").on(t.dedupeKey),
]);

export type NotificationEvent = typeof notificationEventsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// 5. notification_deliveries — one row per delivery attempt
// ─────────────────────────────────────────────────────────────────────────────

export const notificationDeliveriesTable = pgTable("notification_deliveries", {
  id:                    serial("id").primaryKey(),
  notificationEventId:   integer("notification_event_id"),
  userId:                integer("user_id"),
  channel:               text("channel").notNull().default("email"),
  provider:              text("provider"),
  deliveryStatus:        text("delivery_status").notNull().default("pending"),  // pending | sent | failed | skipped
  retryCount:            integer("retry_count").notNull().default(0),
  providerMessageId:     text("provider_message_id"),
  errorMessage:          text("error_message"),
  sentAt:                timestamp("sent_at", { withTimezone: true }),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  index("nd_event_id_idx").on(t.notificationEventId),
  index("nd_user_id_idx").on(t.userId),
]);

export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// 6. email_logs — complete log of every email attempt
// ─────────────────────────────────────────────────────────────────────────────

export const emailLogsTable = pgTable("email_logs", {
  id:                  serial("id").primaryKey(),
  userId:              integer("user_id"),
  templateKey:         text("template_key"),       // forgot_password_request | login_alert | etc.
  recipientEmail:      text("recipient_email").notNull(),
  subject:             text("subject").notNull(),
  provider:            text("provider"),
  status:              text("status").notNull().default("pending"),  // pending | sent | failed | skipped
  errorMessage:        text("error_message"),
  providerMessageId:   text("provider_message_id"),
  metadataJson:        text("metadata_json"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("el_user_id_idx").on(t.userId),
  index("el_status_idx").on(t.status),
  index("el_created_at_idx").on(t.createdAt),
]);

export type EmailLog = typeof emailLogsTable.$inferSelect;
