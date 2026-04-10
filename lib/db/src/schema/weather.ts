import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weatherSnapshotsTable = pgTable("weather_snapshots", {
  id: serial("id").primaryKey(),
  location: text("location").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  forecast: jsonb("forecast").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWeatherSnapshotSchema = createInsertSchema(weatherSnapshotsTable).omit({ id: true, fetchedAt: true });
export type InsertWeatherSnapshot = z.infer<typeof insertWeatherSnapshotSchema>;
export type WeatherSnapshot = typeof weatherSnapshotsTable.$inferSelect;
