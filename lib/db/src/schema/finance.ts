import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financeAccountsTable = pgTable("finance_accounts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("ARS"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeConfigTable = pgTable("finance_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFinanceAccountSchema = createInsertSchema(financeAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFinanceAccount = z.infer<typeof insertFinanceAccountSchema>;
export type FinanceAccount = typeof financeAccountsTable.$inferSelect;

export const insertFinanceConfigSchema = createInsertSchema(financeConfigTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertFinanceConfig = z.infer<typeof insertFinanceConfigSchema>;
export type FinanceConfig = typeof financeConfigTable.$inferSelect;
