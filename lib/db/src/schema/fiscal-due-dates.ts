/**
 * fiscal-due-dates.ts
 *
 * New tables for the Vencimientos + Alertas + Semáforos system:
 *  - taxHomologationTable    — mapping between client tax names and calendar codes
 *  - alertLogsTable          — history of all email alert attempts
 *  - auditLogsTable          — full audit trail for all system actions
 *  - semáforoRulesTable      — configurable traffic-light threshold rules
 */
import {
  pgTable, text, serial, timestamp, boolean, integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── tax_homologation ──────────────────────────────────────────────────────────
// Maps free-text tax names (as written on clients) to normalized internal codes.
// e.g. "IVA", "IVA DDJJ", "Impuesto al Valor Agregado" → "iva"
//
// Rules:
//  - No automatic equivalence is assumed without an explicit record here.
//  - Every mapping is visible, editable, and auditable.
//  - A disabled mapping is ignored by the engine.

export const taxHomologationTable = pgTable("tax_homologation", {
  id: serial("id").primaryKey(),
  originalName: text("original_name").notNull(),     // "IVA DDJJ", "Impuesto al Valor Agregado"
  normalizedCode: text("normalized_code").notNull(), // "iva", "ganancias", "monotributo", etc.
  aliases: text("aliases"),                          // comma-separated alternative names
  status: text("status").notNull().default("active"), // active | inactive
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaxHomologationSchema = createInsertSchema(taxHomologationTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxHomologation = z.infer<typeof insertTaxHomologationSchema>;
export type TaxHomologation = typeof taxHomologationTable.$inferSelect;

// ── alert_logs ────────────────────────────────────────────────────────────────
// Records every email alert attempt (sent, failed, skipped, preview).
// Enables: deduplication, manual resend, history, audit.

export const alertLogsTable = pgTable("alert_logs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"),                    // client the alert is about
  dueDateId: integer("due_date_id"),                 // specific due date (nullable for system alerts)
  alertType: text("alert_type").notNull(),
  // "reminder_7d" | "reminder_3d" | "reminder_1d" | "due_today" | "overdue" | "error" | "system"
  recipient: text("recipient").notNull(),            // email address
  subject: text("subject").notNull(),
  bodyHtml: text("body_html"),                       // rendered HTML body
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sendStatus: text("send_status").notNull().default("pending"),
  // "pending" | "sent" | "failed" | "skipped" | "preview"
  errorMessage: text("error_message"),               // SMTP error or skip reason
  isAutomatic: boolean("is_automatic").notNull().default(true),
  retriggeredBy: text("retriggered_by"),             // userId who manually resent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlertLogSchema = createInsertSchema(alertLogsTable).omit({ id: true, createdAt: true });
export type InsertAlertLog = z.infer<typeof insertAlertLogSchema>;
export type AlertLog = typeof alertLogsTable.$inferSelect;

// ── audit_logs ────────────────────────────────────────────────────────────────
// Append-only audit trail. Records every significant system action.
// Modules: "calendar" | "clients" | "due_dates" | "alerts" | "homologation"
// Actions: "create" | "update" | "delete" | "generate" | "recalculate" | "approve" | "reject" | "send" | "upload"

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),                  // which subsystem
  entity: text("entity").notNull(),                  // table/entity name
  entityId: text("entity_id"),                       // id of the affected record
  action: text("action").notNull(),                  // what happened
  detail: text("detail"),                            // human-readable description
  before: text("before"),                            // JSON snapshot before change
  after: text("after"),                              // JSON snapshot after change
  userId: text("user_id"),                           // who did it (null = system/automated)
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;

// ── semaforo_rules ────────────────────────────────────────────────────────────
// Configurable traffic-light threshold rules.
// Rules are matched in order; first matching rule wins.
// Defaults: verde > 7d, amarillo 3-7d, rojo 0-2d, gris = no date or error.

export const semaforoRulesTable = pgTable("semaforo_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                      // display label
  color: text("color").notNull(),                    // "verde" | "amarillo" | "rojo" | "gris"
  minDaysAhead: integer("min_days_ahead"),            // null = no lower bound (overdue)
  maxDaysAhead: integer("max_days_ahead"),            // null = no upper bound
  // Condition: daysRemaining >= minDaysAhead AND daysRemaining <= maxDaysAhead
  // For overdue: minDaysAhead = null (negative), maxDaysAhead = -1
  conditions: text("conditions"),                    // JSON: extra conditions (e.g. tax type, priority)
  priority: integer("priority").notNull().default(0), // evaluation order (lower = checked first)
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSemaforoRuleSchema = createInsertSchema(semaforoRulesTable).omit({ id: true, createdAt: true });
export type InsertSemaforoRule = z.infer<typeof insertSemaforoRuleSchema>;
export type SemaforoRule = typeof semaforoRulesTable.$inferSelect;
