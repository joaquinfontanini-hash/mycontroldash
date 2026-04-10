import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fiscalUpdatesTable = pgTable("fiscal_updates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  category: text("category").notNull(),
  organism: text("organism").notNull(),
  date: text("date").notNull(),
  impact: text("impact").notNull().default("medium"),
  summary: text("summary").notNull(),
  requiresAction: boolean("requires_action").notNull().default(false),
  isSaved: boolean("is_saved").notNull().default(false),
  sourceUrl: text("source_url"),
  fingerprint: text("fingerprint"),
  tags: text("tags"),
  isNormative: boolean("is_normative").notNull().default(false),
  qualityScore: integer("quality_score").notNull().default(70),
  qualityIssues: text("quality_issues"),
  needsReview: boolean("needs_review").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFiscalUpdateSchema = createInsertSchema(fiscalUpdatesTable).omit({ id: true, createdAt: true });
export type InsertFiscalUpdate = z.infer<typeof insertFiscalUpdateSchema>;
export type FiscalUpdate = typeof fiscalUpdatesTable.$inferSelect;
