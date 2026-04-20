import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyGoalsTable = pgTable("daily_goals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  priority: text("priority").notNull().default("medium"),
  isDone: boolean("is_done").notNull().default(false),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strategyGoalsTable = pgTable("strategy_goals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("profesional"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("active"),
  progress: integer("progress").notNull().default(0),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDailyGoalSchema = createInsertSchema(dailyGoalsTable).omit({ id: true, createdAt: true });
export type InsertDailyGoal = z.infer<typeof insertDailyGoalSchema>;
export type DailyGoal = typeof dailyGoalsTable.$inferSelect;

export const insertStrategyGoalSchema = createInsertSchema(strategyGoalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStrategyGoal = z.infer<typeof insertStrategyGoalSchema>;
export type StrategyGoal = typeof strategyGoalsTable.$inferSelect;

// ── Project Tasks (tareas dentro de un proyecto/objetivo estratégico) ──────────
export const projectTasksTable = pgTable("project_tasks", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("todo"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectTaskSchema = createInsertSchema(projectTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectTask = z.infer<typeof insertProjectTaskSchema>;
export type ProjectTask = typeof projectTasksTable.$inferSelect;
