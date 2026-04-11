import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modulesTable = pgTable("modules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  allowedRoles: text("allowed_roles").array().notNull().default(["super_admin", "admin", "editor", "viewer"]),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const userModulePermissionsTable = pgTable("user_module_permissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  moduleKey: text("module_key").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const securityLogsTable = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  actorClerkId: text("actor_clerk_id"),
  actorEmail: text("actor_email"),
  targetClerkId: text("target_clerk_id"),
  targetEmail: text("target_email"),
  action: text("action").notNull(),
  module: text("module"),
  result: text("result").notNull().default("success"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertModuleSchema = createInsertSchema(modulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertModule = z.infer<typeof insertModuleSchema>;
export type Module = typeof modulesTable.$inferSelect;

export const insertSecurityLogSchema = createInsertSchema(securityLogsTable).omit({ id: true, createdAt: true });
export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogsTable.$inferSelect;
