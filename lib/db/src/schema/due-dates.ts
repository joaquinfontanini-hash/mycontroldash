import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dueDateCategoriesTable = pgTable("due_date_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dueDatesTable = pgTable("due_dates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("general"),
  dueDate: text("due_date").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  alertEnabled: boolean("alert_enabled").notNull().default(true),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDueDateCategorySchema = createInsertSchema(dueDateCategoriesTable).omit({ id: true, createdAt: true });
export type InsertDueDateCategory = z.infer<typeof insertDueDateCategorySchema>;
export type DueDateCategory = typeof dueDateCategoriesTable.$inferSelect;

export const insertDueDateSchema = createInsertSchema(dueDatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDueDate = z.infer<typeof insertDueDateSchema>;
export type DueDate = typeof dueDatesTable.$inferSelect;
