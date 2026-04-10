import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const newsItemsTable = pgTable("news_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  category: text("category").notNull().default("nacionales"),
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
