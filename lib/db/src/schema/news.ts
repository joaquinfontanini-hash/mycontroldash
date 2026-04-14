import {
  pgTable, text, serial, timestamp, boolean, integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// ── news_items ───────────────────────────────────────────────────────────────

export const newsItemsTable = pgTable("news_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull(),

  // Legacy category field kept for backward-compat with existing data
  category: text("category").notNull().default("nacionales"),

  // New semantic classification fields
  regionLevel: text("region_level").notNull().default("nacional"),      // "internacional" | "nacional" | "regional"
  newsCategory: text("news_category").notNull().default("economia"),    // "economia" | "politica" | "laboral" | "juicios"
  tags: text("tags").array().notNull().default([]),                      // string[]
  impactLevel: text("impact_level").notNull().default("medio"),          // "bajo" | "medio" | "alto"
  priorityScore: integer("priority_score").notNull().default(0),

  // Legacy fields kept
  region: text("region").notNull().default("nacional"),
  url: text("url").notNull().unique(),
  summary: text("summary").notNull().default(""),
  imageUrl: text("image_url"),
  publishedAt: text("published_at").notNull(),
  importanceScore: integer("importance_score").notNull().default(0),
  isFiscalRelated: boolean("is_fiscal_related").notNull().default(false),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNewsItemSchema = createInsertSchema(newsItemsTable).omit({ id: true, fetchedAt: true });
export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItemsTable.$inferSelect;

// ── saved_news ────────────────────────────────────────────────────────────────
// Per-user saved articles (private, not shared between users)

export const savedNewsTable = pgTable("saved_news", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  newsId: integer("news_id").notNull().references(() => newsItemsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedNews = typeof savedNewsTable.$inferSelect;

// ── user_alerts ────────────────────────────────────────────────────────────────
// Per-user personalized alert configurations (private)

export const userAlertsTable = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  regionLevel: text("region_level"),    // null = all regions
  newsCategory: text("news_category"),  // null = all categories
  active: boolean("active").notNull().default(true),
  label: text("label"),                 // optional user-defined name
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserAlert = typeof userAlertsTable.$inferSelect;
