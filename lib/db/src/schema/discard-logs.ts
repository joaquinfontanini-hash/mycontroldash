import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const discardLogsTable = pgTable("discard_logs", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  source: text("source").notNull().default(""),
  title: text("title").notNull().default(""),
  sourceUrl: text("source_url"),
  reason: text("reason").notNull(),
  rawData: text("raw_data"),
  discardedAt: timestamp("discarded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscardLogSchema = createInsertSchema(discardLogsTable).omit({ id: true, discardedAt: true });
export type InsertDiscardLog = z.infer<typeof insertDiscardLogSchema>;
export type DiscardLog = typeof discardLogsTable.$inferSelect;
