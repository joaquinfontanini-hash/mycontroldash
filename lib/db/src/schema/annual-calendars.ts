import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const annualDueCalendarsTable = pgTable("annual_due_calendars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  uploadedFile: text("uploaded_file"),
  parseStatus: text("parse_status").notNull().default("pending"),
  parseErrors: text("parse_errors"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const annualDueCalendarRulesTable = pgTable("annual_due_calendar_rules", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull(),
  taxType: text("tax_type").notNull(),
  month: integer("month").notNull(),
  cuitTermination: text("cuit_termination").notNull().default("any"),
  dueDay: integer("due_day").notNull(),
  notes: text("notes"),
  isManualOverride: boolean("is_manual_override").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const annualDueCalendarNotesTable = pgTable("annual_due_calendar_notes", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull(),
  taxType: text("tax_type"),
  month: integer("month"),
  note: text("note").notNull(),
  requiresManualReview: boolean("requires_manual_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const uploadedDueFilesTable = pgTable("uploaded_due_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull().default("pdf"),
  year: integer("year"),
  status: text("status").notNull().default("pending"),
  parseStatus: text("parse_status").notNull().default("pending"),
  parseErrors: text("parse_errors"),
  calendarId: integer("calendar_id"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnnualDueCalendarSchema = createInsertSchema(annualDueCalendarsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnnualDueCalendar = z.infer<typeof insertAnnualDueCalendarSchema>;
export type AnnualDueCalendar = typeof annualDueCalendarsTable.$inferSelect;

export const insertAnnualDueCalendarRuleSchema = createInsertSchema(annualDueCalendarRulesTable).omit({ id: true, createdAt: true });
export type InsertAnnualDueCalendarRule = z.infer<typeof insertAnnualDueCalendarRuleSchema>;
export type AnnualDueCalendarRule = typeof annualDueCalendarRulesTable.$inferSelect;

export const insertUploadedDueFileSchema = createInsertSchema(uploadedDueFilesTable).omit({ id: true, createdAt: true });
export type InsertUploadedDueFile = z.infer<typeof insertUploadedDueFileSchema>;
export type UploadedDueFile = typeof uploadedDueFilesTable.$inferSelect;
