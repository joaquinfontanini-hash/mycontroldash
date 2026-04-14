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

  // ── Semantic classification (v2 engine) ──────────────────────────────────
  regionLevel: text("region_level").notNull().default("nacional"),
  // "internacional" | "nacional" | "regional"

  newsCategory: text("news_category").notNull().default("economia"),
  // "economia" | "politica" | "laboral" | "juicios"

  tags: text("tags").array().notNull().default([]),

  impactLevel: text("impact_level").notNull().default("medio"),
  // "bajo" | "medio" | "alto"

  priorityScore: integer("priority_score").notNull().default(0),
  // 0–100 final ranking score

  // ── v3 engine fields: domain-first pipeline ───────────────────────────────
  domainFitScore: integer("domain_fit_score").notNull().default(0),
  // 0–100 — does the article belong to this module's domain?

  categoryConfidence: integer("category_confidence").notNull().default(0),
  // 0–100 — how confident is the category assignment?

  classificationReason: text("classification_reason").notNull().default(""),
  // human-readable explanation for include/discard decision

  exclusionFlags: text("exclusion_flags").array().notNull().default([]),
  // negative-term flags that triggered exclusion (auditable)

  discarded: boolean("discarded").notNull().default(false),
  // true = filtered out by domain-fit gate, never shown in UI

  // ── Legacy fields kept ────────────────────────────────────────────────────
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

export const savedNewsTable = pgTable("saved_news", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  newsId: integer("news_id").notNull().references(() => newsItemsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedNews = typeof savedNewsTable.$inferSelect;

// ── user_alerts ────────────────────────────────────────────────────────────────

export const userAlertsTable = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  regionLevel: text("region_level"),
  newsCategory: text("news_category"),
  active: boolean("active").notNull().default(true),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserAlert = typeof userAlertsTable.$inferSelect;
