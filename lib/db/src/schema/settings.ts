import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  dashboardName: text("dashboard_name").notNull().default("Dashboard Personal"),
  headerText: text("header_text").notNull().default("Dashboard Personal"),
  theme: text("theme").notNull().default("dark"),
  weatherLocation: text("weather_location").notNull().default("Neuquen"),
  weatherLatitude: text("weather_latitude").notNull().default("-38.9516"),
  weatherLongitude: text("weather_longitude").notNull().default("-68.0591"),
  newsCount: integer("news_count").notNull().default(20),
  newsRefreshMinutes: integer("news_refresh_minutes").notNull().default(60),
  weatherRefreshMinutes: integer("weather_refresh_minutes").notNull().default(120),
  fiscalRefreshMinutes: integer("fiscal_refresh_minutes").notNull().default(180),
  travelBudgetMax: integer("travel_budget_max").notNull().default(500000),
  travelAudience: text("travel_audience").notNull().default("todos"),
  enableNewsJob: boolean("enable_news_job").notNull().default(true),
  enableWeatherJob: boolean("enable_weather_job").notNull().default(true),
  enableFiscalJob: boolean("enable_fiscal_job").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
