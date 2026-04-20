import {
  pgTable, serial, integer, text, numeric, timestamp, jsonb, index, boolean
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

// ── quotes ────────────────────────────────────────────────────────────────────
// Estados: draft | sent | approved | rejected | expired | partially_paid | paid
// Tipos:   single | recurring_indexed

export const quotesTable = pgTable("quotes", {
  id:               serial("id").primaryKey(),
  quoteNumber:      text("quote_number").notNull().unique(),
  clientId:         integer("client_id").notNull().references(() => clientsTable.id),
  userId:           text("user_id").notNull(),
  title:            text("title").notNull(),
  description:      text("description"),
  currency:         text("currency").notNull().default("ARS"),
  issueDate:        text("issue_date").notNull(),
  dueDate:          text("due_date").notNull(),
  subtotal:         numeric("subtotal",         { precision: 18, scale: 2 }).notNull().default("0"),
  discountAmount:   numeric("discount_amount",  { precision: 18, scale: 2 }).notNull().default("0"),
  taxAmount:        numeric("tax_amount",       { precision: 18, scale: 2 }).notNull().default("0"),
  totalAmount:      numeric("total_amount",     { precision: 18, scale: 2 }).notNull().default("0"),
  status:           text("status").notNull().default("draft"),
  version:          integer("version").notNull().default(1),
  parentQuoteId:    integer("parent_quote_id"),
  approvedAt:       timestamp("approved_at",  { withTimezone: true }),
  rejectedAt:       timestamp("rejected_at",  { withTimezone: true }),
  notes:            text("notes"),
  createdBy:        text("created_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  archivedAt:       timestamp("archived_at", { withTimezone: true }),

  // ── Campos para contratos recurrentes (quoteType = recurring_indexed) ──────
  quoteType:             text("quote_type").notNull().default("single"),  // single | recurring_indexed
  contractType:          text("contract_type"),          // fixed_term | indefinite
  contractStartDate:     text("contract_start_date"),    // YYYY-MM-DD — inicio vigencia
  contractEndDate:       text("contract_end_date"),      // YYYY-MM-DD — fin vigencia (null para indefinidos)
  billingFrequency:      text("billing_frequency"),      // monthly | quarterly | semiannual | annual
  adjustmentFrequency:   text("adjustment_frequency"),   // quarterly | semiannual | annual
  adjustmentIndex:       text("adjustment_index"),       // ipc | icl | custom
  adjustmentMode:        text("adjustment_mode"),        // apply_on_last_effective_amount
  baseAmount:            numeric("base_amount",    { precision: 18, scale: 2 }),  // monto original de 1ra cuota
  currentAmount:         numeric("current_amount", { precision: 18, scale: 2 }),  // monto vigente (actualizado por IPC)
  nextAdjustmentDate:    text("next_adjustment_date"),   // YYYY-MM-DD
  lastAdjustmentDate:    text("last_adjustment_date"),   // YYYY-MM-DD
  installmentsGenerated: boolean("installments_generated").notNull().default(false),
}, (t) => ({
  clientIdx:     index("quotes_client_idx").on(t.clientId),
  statusIdx:     index("quotes_status_idx").on(t.status),
  dueDateIdx:    index("quotes_due_date_idx").on(t.dueDate),
  issueDateIdx:  index("quotes_issue_date_idx").on(t.issueDate),
  createdAtIdx:  index("quotes_created_at_idx").on(t.createdAt),
  userIdx:       index("quotes_user_idx").on(t.userId),
  quoteTypeIdx:  index("quotes_type_idx").on(t.quoteType),
}));

// ── quote_items ───────────────────────────────────────────────────────────────

export const quoteItemsTable = pgTable("quote_items", {
  id:          serial("id").primaryKey(),
  quoteId:     integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity:    numeric("quantity",   { precision: 18, scale: 4 }).notNull().default("1"),
  unitPrice:   numeric("unit_price", { precision: 18, scale: 2 }).notNull().default("0"),
  lineTotal:   numeric("line_total", { precision: 18, scale: 2 }).notNull().default("0"),
  sortOrder:   integer("sort_order").notNull().default(0),
}, (t) => ({
  quoteIdx: index("quote_items_quote_idx").on(t.quoteId),
}));

// ── quote_revisions ───────────────────────────────────────────────────────────

export const quoteRevisionsTable = pgTable("quote_revisions", {
  id:                   serial("id").primaryKey(),
  quoteId:              integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  previousTotalAmount:  numeric("previous_total_amount", { precision: 18, scale: 2 }).notNull(),
  newTotalAmount:       numeric("new_total_amount",      { precision: 18, scale: 2 }).notNull(),
  previousPayloadJson:  jsonb("previous_payload_json"),
  newPayloadJson:       jsonb("new_payload_json"),
  changeReason:         text("change_reason"),
  changedBy:            text("changed_by").notNull(),
  changedAt:            timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quoteIdx: index("quote_revisions_quote_idx").on(t.quoteId),
}));

// ── payments ──────────────────────────────────────────────────────────────────

export const quotePaymentsTable = pgTable("quote_payments", {
  id:              serial("id").primaryKey(),
  quoteId:         integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  installmentId:   integer("installment_id"),   // FK a quote_installments (nullable para single)
  clientId:        integer("client_id").notNull().references(() => clientsTable.id),
  userId:          text("user_id").notNull(),
  paymentDate:     text("payment_date").notNull(),
  amount:          numeric("amount",   { precision: 18, scale: 2 }).notNull(),
  currency:        text("currency").notNull().default("ARS"),
  paymentMethod:   text("payment_method").notNull().default("transferencia"),
  reference:       text("reference"),
  notes:           text("notes"),
  createdBy:       text("created_by").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quoteIdx:       index("quote_payments_quote_idx").on(t.quoteId),
  clientIdx:      index("quote_payments_client_idx").on(t.clientId),
  dateIdx:        index("quote_payments_date_idx").on(t.paymentDate),
  installmentIdx: index("quote_payments_installment_idx").on(t.installmentId),
}));

// ── quote_installments ────────────────────────────────────────────────────────
// Solo para contratos recurring_indexed.
// Estados: pending | due | overdue | partially_paid | paid | cancelled

export const quoteInstallmentsTable = pgTable("quote_installments", {
  id:                    serial("id").primaryKey(),
  quoteId:               integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  installmentNumber:     integer("installment_number").notNull(),
  periodStart:           text("period_start").notNull(),    // YYYY-MM-DD
  periodEnd:             text("period_end").notNull(),      // YYYY-MM-DD
  dueDate:               text("due_date").notNull(),        // YYYY-MM-DD
  baseAmount:            numeric("base_amount",     { precision: 18, scale: 2 }).notNull(),
  adjustedAmount:        numeric("adjusted_amount", { precision: 18, scale: 2 }).notNull(),
  appliedAdjustmentRate: numeric("applied_adjustment_rate", { precision: 10, scale: 6 }).notNull().default("0"),
  status:                text("status").notNull().default("pending"),
  paidAmount:            numeric("paid_amount",  { precision: 18, scale: 2 }).notNull().default("0"),
  balanceDue:            numeric("balance_due",  { precision: 18, scale: 2 }).notNull(),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  quoteIdx:      index("quote_installments_quote_idx").on(t.quoteId),
  dueDateIdx:    index("quote_installments_due_date_idx").on(t.dueDate),
  statusIdx:     index("quote_installments_status_idx").on(t.status),
  numberIdx:     index("quote_installments_number_idx").on(t.quoteId, t.installmentNumber),
}));

// ── quote_adjustments ─────────────────────────────────────────────────────────
// Historial de ajustes IPC aplicados a contratos recurrentes.

export const quoteAdjustmentsTable = pgTable("quote_adjustments", {
  id:                     serial("id").primaryKey(),
  quoteId:                integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  adjustmentDate:         text("adjustment_date").notNull(),    // YYYY-MM-DD — fecha efectiva
  periodFrom:             text("period_from").notNull(),        // YYYY-MM-DD — inicio período IPC
  periodTo:               text("period_to").notNull(),          // YYYY-MM-DD — fin período IPC
  adjustmentRate:         numeric("adjustment_rate", { precision: 10, scale: 6 }).notNull(),  // ej: 0.034 = 3.4%
  indexUsed:              text("index_used").notNull().default("ipc"),
  previousBaseAmount:     numeric("previous_base_amount", { precision: 18, scale: 2 }).notNull(),
  newBaseAmount:          numeric("new_base_amount",      { precision: 18, scale: 2 }).notNull(),
  installmentsAffected:   integer("installments_affected").notNull().default(0),
  notes:                  text("notes"),
  appliedBy:              text("applied_by").notNull(),
  appliedAt:              timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quoteIdx:       index("quote_adjustments_quote_idx").on(t.quoteId),
  dateIdx:        index("quote_adjustments_date_idx").on(t.adjustmentDate),
}));

// ── quote_activity_logs ───────────────────────────────────────────────────────

export const quoteActivityLogsTable = pgTable("quote_activity_logs", {
  id:           serial("id").primaryKey(),
  quoteId:      integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  clientId:     integer("client_id").notNull().references(() => clientsTable.id),
  userId:       text("user_id").notNull(),
  actionType:   text("action_type").notNull(),
  description:  text("description").notNull(),
  metadataJson: jsonb("metadata_json"),
  performedBy:  text("performed_by").notNull(),
  performedAt:  timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quoteIdx:  index("quote_activity_quote_idx").on(t.quoteId),
  clientIdx: index("quote_activity_client_idx").on(t.clientId),
}));

// ── Zod insert schemas ────────────────────────────────────────────────────────

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({
  id: true, createdAt: true, updatedAt: true, quoteNumber: true,
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;

export const insertQuoteItemSchema = createInsertSchema(quoteItemsTable).omit({ id: true });
export type InsertQuoteItem = z.infer<typeof insertQuoteItemSchema>;
export type QuoteItem = typeof quoteItemsTable.$inferSelect;

export const insertQuoteRevisionSchema = createInsertSchema(quoteRevisionsTable).omit({ id: true, changedAt: true });
export type InsertQuoteRevision = z.infer<typeof insertQuoteRevisionSchema>;
export type QuoteRevision = typeof quoteRevisionsTable.$inferSelect;

export const insertQuotePaymentSchema = createInsertSchema(quotePaymentsTable).omit({ id: true, createdAt: true });
export type InsertQuotePayment = z.infer<typeof insertQuotePaymentSchema>;
export type QuotePayment = typeof quotePaymentsTable.$inferSelect;

export const insertQuoteInstallmentSchema = createInsertSchema(quoteInstallmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuoteInstallment = z.infer<typeof insertQuoteInstallmentSchema>;
export type QuoteInstallment = typeof quoteInstallmentsTable.$inferSelect;

export const insertQuoteAdjustmentSchema = createInsertSchema(quoteAdjustmentsTable).omit({ id: true, appliedAt: true });
export type InsertQuoteAdjustment = z.infer<typeof insertQuoteAdjustmentSchema>;
export type QuoteAdjustment = typeof quoteAdjustmentsTable.$inferSelect;

export const insertQuoteActivityLogSchema = createInsertSchema(quoteActivityLogsTable).omit({ id: true, performedAt: true });
export type InsertQuoteActivityLog = z.infer<typeof insertQuoteActivityLogSchema>;
export type QuoteActivityLog = typeof quoteActivityLogsTable.$inferSelect;
