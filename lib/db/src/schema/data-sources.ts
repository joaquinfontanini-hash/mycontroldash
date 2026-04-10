import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataSourcesTable = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: text("module").notNull(),
  type: text("type").notNull().default("rss"),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(5),
  method: text("method").notNull().default("rss"),
  notes: text("notes"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastStatus: text("last_status").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataSourceSchema = createInsertSchema(dataSourcesTable).omit({ id: true, createdAt: true });
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type DataSource = typeof dataSourcesTable.$inferSelect;
