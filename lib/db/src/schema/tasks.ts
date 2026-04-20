import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Main tasks table ──────────────────────────────────────────────────────────
// Statuses:
//   pending            – created, not yet started (or unassigned)
//   pending_acceptance – assigned and waiting for assignee to accept
//   in_progress        – accepted, being worked on
//   completed          – finished
//   rejected           – assignee rejected it
//   cancelled          – creator cancelled it
//   archived           – archived for record-keeping
//
// Legacy statuses (backward compat with pre-migration data):
//   in-progress → displayed as "En progreso"
//   done        → displayed as "Completada"
//
// Priorities: low | medium | high | urgent
export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  progress: integer("progress").notNull().default(0),
  dueDate: text("due_date"),
  userId: text("user_id"),             // creator ID (backward compat column name)
  assignedToUserId: text("assigned_to_user_id"),
  requiresAcceptance: boolean("requires_acceptance").notNull().default(false),
  rejectionReason: text("rejection_reason"),
  initialObservations: text("initial_observations"),
  parentTaskId: integer("parent_task_id"),  // subtask parent reference
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── Task comments ─────────────────────────────────────────────────────────────
export const taskCommentsTable = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Task history / audit trail ────────────────────────────────────────────────
// Actions: created | status_changed | progress_updated | assigned | reassigned |
//          accepted | rejected | cancelled | archived | completed | commented | edited
export const taskHistoryTable = pgTable("task_history", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;

export const insertTaskCommentSchema = createInsertSchema(taskCommentsTable).omit({ id: true, createdAt: true });
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TaskComment = typeof taskCommentsTable.$inferSelect;

export const insertTaskHistorySchema = createInsertSchema(taskHistoryTable).omit({ id: true, createdAt: true });
export type InsertTaskHistory = z.infer<typeof insertTaskHistorySchema>;
export type TaskHistory = typeof taskHistoryTable.$inferSelect;
