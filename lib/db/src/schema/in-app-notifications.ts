import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";

export const inAppNotificationsTable = pgTable("in_app_notifications", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),
  type:        text("type").notNull(),        // due_date | news | finance | system | task
  title:       text("title").notNull(),
  body:        text("body").notNull(),
  severity:    text("severity").notNull().default("info"),  // info | warning | critical
  linkUrl:     text("link_url"),
  isRead:      boolean("is_read").notNull().default(false),
  readAt:      timestamp("read_at", { withTimezone: true }),
  payloadJson: text("payload_json"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ian_user_id_idx").on(t.userId),
  index("ian_is_read_idx").on(t.isRead),
  index("ian_type_idx").on(t.type),
  index("ian_created_at_idx").on(t.createdAt),
]);

export type InAppNotification = typeof inAppNotificationsTable.$inferSelect;
