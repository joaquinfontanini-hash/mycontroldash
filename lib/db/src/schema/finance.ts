import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financeAccountsTable = pgTable("finance_accounts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
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

export const financeCategoriesTable = pgTable("finance_categories", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  type: text("type").notNull(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("circle"),
  color: text("color").notNull().default("#6b7280"),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeRecurringRulesTable = pgTable("finance_recurring_rules", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  categoryId: integer("category_id"),
  accountId: integer("account_id"),
  frequency: text("frequency").notNull(),
  dayOfMonth: integer("day_of_month"),
  nextDate: text("next_date"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const financeTransactionsTable = pgTable("finance_transactions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  categoryId: integer("category_id"),
  accountId: integer("account_id"),
  date: text("date").notNull(),
  status: text("status").notNull().default("confirmed"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  isFixed: boolean("is_fixed").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringRuleId: integer("recurring_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const insertFinanceCategorySchema = createInsertSchema(financeCategoriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFinanceCategory = z.infer<typeof insertFinanceCategorySchema>;
export type FinanceCategory = typeof financeCategoriesTable.$inferSelect;

export const insertFinanceRecurringRuleSchema = createInsertSchema(financeRecurringRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFinanceRecurringRule = z.infer<typeof insertFinanceRecurringRuleSchema>;
export type FinanceRecurringRule = typeof financeRecurringRulesTable.$inferSelect;

export const insertFinanceTransactionSchema = createInsertSchema(financeTransactionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFinanceTransaction = z.infer<typeof insertFinanceTransactionSchema>;
export type FinanceTransaction = typeof financeTransactionsTable.$inferSelect;
