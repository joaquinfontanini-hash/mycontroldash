import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dueDateCategoriesTable = pgTable("due_date_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dueDatesTable = pgTable("due_dates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("general"),
  dueDate: text("due_date").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  alertEnabled: boolean("alert_enabled").notNull().default(true),
  recurrenceType: text("recurrence_type").notNull().default("none"),
  recurrenceRule: text("recurrence_rule"),
  recurrenceEndDate: text("recurrence_end_date"),
  parentId: integer("parent_id"),
  isRecurrenceParent: boolean("is_recurrence_parent").notNull().default(false),
  source: text("source").notNull().default("manual"),
  clientId: integer("client_id"),
  calendarRuleId: integer("calendar_rule_id"),
  userId: text("user_id"),

  // ── Semáforo v2 fields ────────────────────────────────────────────────────
  // trafficLight: verde | amarillo | rojo | gris
  // Calculated dynamically but stored for audit/history purposes
  trafficLight: text("traffic_light").notNull().default("gris"),

  // CUIT-group details for traceability
  cuitGroup: text("cuit_group"),        // e.g. "2-3", "4 a 6", "any"
  cuitTermination: integer("cuit_termination"), // last digit of client CUIT

  // Tax code (normalized from homologation)
  taxCode: text("tax_code"),            // e.g. "iva", "ganancias"

  // Full traceability JSON: origin, calendar version, rule applied, etc.
  classificationReason: text("classification_reason").notNull().default(""),

  // Alert tracking
  alertGenerated: boolean("alert_generated").notNull().default(false),
  lastAlertSentAt: text("last_alert_sent_at"),

  // Semáforo override (manual)
  manualReview: boolean("manual_review").notNull().default(false),
  reviewNotes: text("review_notes"),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDueDateCategorySchema = createInsertSchema(dueDateCategoriesTable).omit({ id: true, createdAt: true });
export type InsertDueDateCategory = z.infer<typeof insertDueDateCategorySchema>;
export type DueDateCategory = typeof dueDateCategoriesTable.$inferSelect;

export const insertDueDateSchema = createInsertSchema(dueDatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDueDate = z.infer<typeof insertDueDateSchema>;
export type DueDate = typeof dueDatesTable.$inferSelect;
