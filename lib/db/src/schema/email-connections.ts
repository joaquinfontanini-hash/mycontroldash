import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailConnectionsTable = pgTable("email_connections", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  provider: text("provider").notNull().default("gmail"),
  email: text("email"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: text("token_expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
});

export const insertEmailConnectionSchema = createInsertSchema(emailConnectionsTable).omit({ id: true, connectedAt: true });
export type InsertEmailConnection = z.infer<typeof insertEmailConnectionSchema>;
export type EmailConnection = typeof emailConnectionsTable.$inferSelect;
