import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const userSettingsTable = pgTable(
  "user_settings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("user_settings_user_key_idx").on(t.userId, t.key)],
);

export type UserSetting = typeof userSettingsTable.$inferSelect;

export const USER_SETTINGS_DEFAULTS: Record<string, string> = {
  alert_due_date_days: "7",
  alert_sensitivity: "medium",
  alert_vencimientos_enabled: "true",
  alert_tareas_enabled: "true",
  alert_finanzas_enabled: "true",
  alert_estrategia_enabled: "true",
  modo_hoy_show_scores: "true",
  modo_hoy_max_actions: "3",
  decisions_show_rules: "true",
  sidebar_compact: "false",
};
