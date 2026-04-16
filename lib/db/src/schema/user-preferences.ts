import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const userPreferencesTable = pgTable("user_preferences", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull(),
  key:        text("key").notNull(),
  jsonValue:  text("json_value").notNull().default("null"),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  uniqueIndex("up_user_key_idx").on(t.userId, t.key),
]);

export type UserPreference = typeof userPreferencesTable.$inferSelect;

export const USER_PREFERENCE_KEYS = {
  THEME:              "theme",
  SIDEBAR_COLLAPSED:  "sidebar_collapsed",
  DASHBOARD_WIDGETS:  "dashboard_widgets",
  FINANCE_DEFAULT_TAB:"finance_default_tab",
  NEWS_FILTERS:       "news_filters",
  TABLE_PAGE_SIZE:    "table_page_size",
  NOTIFICATIONS_MUTED:"notifications_muted",
} as const;
