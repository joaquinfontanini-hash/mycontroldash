import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supplierPaymentBatchesTable = pgTable("supplier_payment_batches", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  weekStart: text("week_start").notNull(),
  weekEnd: text("week_end").notNull(),
  paymentDate: text("payment_date").notNull(),
  totalAmount: integer("total_amount").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  dueDateId: integer("due_date_id"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplierPaymentBatchItemsTable = pgTable("supplier_payment_batch_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  supplier: text("supplier").notNull(),
  originalDueDate: text("original_due_date"),
  amount: integer("amount").notNull().default(0),
  document: text("document"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierPaymentBatchSchema = createInsertSchema(supplierPaymentBatchesTable).omit({ id: true, createdAt: true });
export type InsertSupplierPaymentBatch = z.infer<typeof insertSupplierPaymentBatchSchema>;
export type SupplierPaymentBatch = typeof supplierPaymentBatchesTable.$inferSelect;

export const insertSupplierPaymentBatchItemSchema = createInsertSchema(supplierPaymentBatchItemsTable).omit({ id: true, createdAt: true });
export type InsertSupplierPaymentBatchItem = z.infer<typeof insertSupplierPaymentBatchItemSchema>;
export type SupplierPaymentBatchItem = typeof supplierPaymentBatchItemsTable.$inferSelect;
