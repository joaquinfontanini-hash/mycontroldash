import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shortcutsTable = pgTable("shortcuts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  category: text("category"),
  icon: text("icon"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShortcutSchema = createInsertSchema(shortcutsTable).omit({ id: true, createdAt: true });
export type InsertShortcut = z.infer<typeof insertShortcutSchema>;
export type Shortcut = typeof shortcutsTable.$inferSelect;
