import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Client Groups ──────────────────────────────────────────────────────────────
export const clientGroupsTable = pgTable("client_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  description: text("description"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientGroupSchema = createInsertSchema(clientGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClientGroup = z.infer<typeof insertClientGroupSchema>;
export type ClientGroup = typeof clientGroupsTable.$inferSelect;

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cuit: text("cuit").notNull(),
  email: text("email"),
  emailSecondary: text("email_secondary"),            // nuevo
  phone: text("phone"),
  status: text("status").notNull().default("active"),
  clientPriority: text("client_priority").notNull().default("media"), // nuevo: alta | media | baja
  alertsActive: boolean("alerts_active").notNull().default(true),     // nuevo
  responsible: text("responsible"),                  // nuevo: nombre del responsable interno
  notes: text("notes"),
  groupId: integer("group_id"),                      // grupo de clientes (FK a client_groups)
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const clientTaxAssignmentsTable = pgTable("client_tax_assignments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  taxType: text("tax_type").notNull(),
  notes: text("notes"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export const insertClientTaxAssignmentSchema = createInsertSchema(clientTaxAssignmentsTable).omit({ id: true, createdAt: true });
export type InsertClientTaxAssignment = z.infer<typeof insertClientTaxAssignmentSchema>;
export type ClientTaxAssignment = typeof clientTaxAssignmentsTable.$inferSelect;
