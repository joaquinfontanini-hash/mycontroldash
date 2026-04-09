import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  dashboardName: text("dashboard_name").notNull().default("Dashboard Personal"),
  headerText: text("header_text").notNull().default("Dashboard Personal"),
  theme: text("theme").notNull().default("dark"),
  weatherLocation: text("weather_location").notNull().default("Neuquen"),
  newsCount: integer("news_count").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
