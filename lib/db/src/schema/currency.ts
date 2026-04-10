import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const currencyRatesTable = pgTable("currency_rates", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  buy: numeric("buy", { precision: 12, scale: 2 }),
  sell: numeric("sell", { precision: 12, scale: 2 }),
  avg: numeric("avg", { precision: 12, scale: 2 }),
  source: text("source").notNull().default(""),
  sourceUrl: text("source_url"),
  status: text("status").notNull().default("ok"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCurrencyRateSchema = createInsertSchema(currencyRatesTable).omit({ id: true, fetchedAt: true });
export type InsertCurrencyRate = z.infer<typeof insertCurrencyRateSchema>;
export type CurrencyRate = typeof currencyRatesTable.$inferSelect;
