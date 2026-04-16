import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────

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

// ─── CONFIG ───────────────────────────────────────────────────────────────

export const financeConfigTable = pgTable("finance_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── CATEGORIES ───────────────────────────────────────────────────────────

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

// ─── RECURRING RULES ──────────────────────────────────────────────────────

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

// ─── CARDS ────────────────────────────────────────────────────────────────
// Tarjetas de crédito con fecha de cierre y vencimiento

export const financeCardsTable = pgTable("finance_cards", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  bank: text("bank"),
  lastFour: text("last_four"),
  color: text("color").notNull().default("#6366f1"),
  closeDay: integer("close_day").notNull().default(1),
  dueDay: integer("due_day").notNull().default(10),
  creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }),
  currency: text("currency").notNull().default("ARS"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── INSTALLMENT PLANS ────────────────────────────────────────────────────
// Compras en cuotas: monto total, cuotas, pagadas, próxima fecha

export const financeInstallmentPlansTable = pgTable("finance_installment_plans", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  description: text("description").notNull(),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  installmentAmount: numeric("installment_amount", { precision: 18, scale: 2 }).notNull(),
  totalInstallments: integer("total_installments").notNull(),
  paidInstallments: integer("paid_installments").notNull().default(0),
  startDate: text("start_date").notNull(),
  nextDueDate: text("next_due_date"),
  cardId: integer("card_id"),
  categoryId: integer("category_id"),
  currency: text("currency").notNull().default("ARS"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── LOANS ────────────────────────────────────────────────────────────────
// Préstamos: acreedor, cuotas, saldo pendiente, estado

export const financeLoansTable = pgTable("finance_loans", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  creditor: text("creditor"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  totalInstallments: integer("total_installments").notNull(),
  installmentAmount: numeric("installment_amount", { precision: 18, scale: 2 }).notNull(),
  paidInstallments: integer("paid_installments").notNull().default(0),
  startDate: text("start_date").notNull(),
  nextDueDate: text("next_due_date"),
  status: text("status").notNull().default("active"),
  currency: text("currency").notNull().default("ARS"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────

export const financeTransactionsTable = pgTable("finance_transactions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  categoryId: integer("category_id"),
  accountId: integer("account_id"),
  cardId: integer("card_id"),
  installmentPlanId: integer("installment_plan_id"),
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

// ─── ZODSCHEMAS + TYPES ────────────────────────────────────────────────────

export const insertFinanceAccountSchema = createInsertSchema(financeAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceAccount = z.infer<typeof insertFinanceAccountSchema>;
export type FinanceAccount = typeof financeAccountsTable.$inferSelect;

export const insertFinanceConfigSchema = createInsertSchema(financeConfigTable).omit({ id: true, updatedAt: true });
export type InsertFinanceConfig = z.infer<typeof insertFinanceConfigSchema>;
export type FinanceConfig = typeof financeConfigTable.$inferSelect;

export const insertFinanceCategorySchema = createInsertSchema(financeCategoriesTable).omit({ id: true, createdAt: true });
export type InsertFinanceCategory = z.infer<typeof insertFinanceCategorySchema>;
export type FinanceCategory = typeof financeCategoriesTable.$inferSelect;

export const insertFinanceRecurringRuleSchema = createInsertSchema(financeRecurringRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceRecurringRule = z.infer<typeof insertFinanceRecurringRuleSchema>;
export type FinanceRecurringRule = typeof financeRecurringRulesTable.$inferSelect;

export const insertFinanceCardSchema = createInsertSchema(financeCardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceCard = z.infer<typeof insertFinanceCardSchema>;
export type FinanceCard = typeof financeCardsTable.$inferSelect;

export const insertFinanceInstallmentPlanSchema = createInsertSchema(financeInstallmentPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceInstallmentPlan = z.infer<typeof insertFinanceInstallmentPlanSchema>;
export type FinanceInstallmentPlan = typeof financeInstallmentPlansTable.$inferSelect;

export const insertFinanceLoanSchema = createInsertSchema(financeLoansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceLoan = z.infer<typeof insertFinanceLoanSchema>;
export type FinanceLoan = typeof financeLoansTable.$inferSelect;

export const insertFinanceTransactionSchema = createInsertSchema(financeTransactionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceTransaction = z.infer<typeof insertFinanceTransactionSchema>;
export type FinanceTransaction = typeof financeTransactionsTable.$inferSelect;
