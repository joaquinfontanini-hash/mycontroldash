import {
  pgTable, serial, integer, text, numeric, timestamp, jsonb, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

// ── quotes ────────────────────────────────────────────────────────────────────
// Estados: draft | sent | approved | rejected | expired | partially_paid | paid

export const quotesTable = pgTable("quotes", {
  id:               serial("id").primaryKey(),
  quoteNumber:      text("quote_number").notNull().unique(),
  clientId:         integer("client_id").notNull().references(() => clientsTable.id),
  userId:           text("user_id").notNull(),
  title:            text("title").notNull(),
  description:      text("description"),
  currency:         text("currency").notNull().default("ARS"),
  issueDate:        text("issue_date").notNull(),            // YYYY-MM-DD
  dueDate:          text("due_date").notNull(),              // YYYY-MM-DD
  subtotal:         numeric("subtotal",         { precision: 18, scale: 2 }).notNull().default("0"),
  discountAmount:   numeric("discount_amount",  { precision: 18, scale: 2 }).notNull().default("0"),
  taxAmount:        numeric("tax_amount",       { precision: 18, scale: 2 }).notNull().default("0"),
  totalAmount:      numeric("total_amount",     { precision: 18, scale: 2 }).notNull().default("0"),
  status:           text("status").notNull().default("draft"),
  version:          integer("version").notNull().default(1),
  parentQuoteId:    integer("parent_quote_id"),              // FK a versión anterior
  approvedAt:       timestamp("approved_at",  { withTimezone: true }),
  rejectedAt:       timestamp("rejected_at",  { withTimezone: true }),
  notes:            text("notes"),
  createdBy:        text("created_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  archivedAt:       timestamp("archived_at", { withTimezone: true }),
}, (t) => ({
  clientIdx:    index("quotes_client_idx").on(t.clientId),
  statusIdx:    index("quotes_status_idx").on(t.status),
  dueDateIdx:   index("quotes_due_date_idx").on(t.dueDate),
  issueDateIdx: index("quotes_issue_date_idx").on(t.issueDate),
  createdAtIdx: index("quotes_created_at_idx").on(t.createdAt),
  userIdx:      index("quotes_user_idx").on(t.userId),
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
  id:            serial("id").primaryKey(),
  quoteId:       integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  clientId:      integer("client_id").notNull().references(() => clientsTable.id),
  userId:        text("user_id").notNull(),
  paymentDate:   text("payment_date").notNull(),            // YYYY-MM-DD
  amount:        numeric("amount",   { precision: 18, scale: 2 }).notNull(),
  currency:      text("currency").notNull().default("ARS"),
  paymentMethod: text("payment_method").notNull().default("transferencia"),
  reference:     text("reference"),
  notes:         text("notes"),
  createdBy:     text("created_by").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quoteIdx:  index("quote_payments_quote_idx").on(t.quoteId),
  clientIdx: index("quote_payments_client_idx").on(t.clientId),
  dateIdx:   index("quote_payments_date_idx").on(t.paymentDate),
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

export const insertQuoteActivityLogSchema = createInsertSchema(quoteActivityLogsTable).omit({ id: true, performedAt: true });
export type InsertQuoteActivityLog = z.infer<typeof insertQuoteActivityLogSchema>;
export type QuoteActivityLog = typeof quoteActivityLogsTable.$inferSelect;
