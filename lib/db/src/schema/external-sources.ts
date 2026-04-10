import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const externalFileSourcesTable = pgTable("external_file_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("excel"),
  url: text("url"),
  identifier: text("identifier"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  userId: text("user_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExternalFileSourceSchema = createInsertSchema(externalFileSourcesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExternalFileSource = z.infer<typeof insertExternalFileSourceSchema>;
export type ExternalFileSource = typeof externalFileSourcesTable.$inferSelect;
