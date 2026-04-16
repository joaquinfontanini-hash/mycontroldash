import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Dashboards ────────────────────────────────────────────────────────────────

export const dashboardsTable = pgTable("dashboards", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  category: text("category"),
  icon: text("icon"),
  color: text("color"),
  sourceType: text("source_type").notNull().default("manual"), // 'prompt' | 'template' | 'wizard' | 'manual'
  templateKey: text("template_key"),
  promptText: text("prompt_text"),
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'archived'
  isFavorite: boolean("is_favorite").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (t) => ({
  ownerIdx: index("dashboards_owner_idx").on(t.ownerUserId),
  statusIdx: index("dashboards_status_idx").on(t.status),
  slugOwnerIdx: uniqueIndex("dashboards_slug_owner_idx").on(t.slug, t.ownerUserId),
}));

// ── Layouts ───────────────────────────────────────────────────────────────────

export const dashboardLayoutsTable = pgTable("dashboard_layouts", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboardsTable.id, { onDelete: "cascade" }),
  breakpoint: text("breakpoint").notNull().default("desktop"), // 'desktop' | 'tablet' | 'mobile'
  layoutJson: jsonb("layout_json").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  dashboardBreakpointIdx: uniqueIndex("dashboard_layouts_dashboard_breakpoint_idx").on(t.dashboardId, t.breakpoint),
}));

// ── Widgets ───────────────────────────────────────────────────────────────────

export const dashboardWidgetsTable = pgTable("dashboard_widgets", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboardsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  dataSourceKey: text("data_source_key"),
  configJson: jsonb("config_json").notNull().default("{}"),
  orderIndex: integer("order_index").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  refreshIntervalSeconds: integer("refresh_interval_seconds"),
  // Snapshot fields (prepared for Part 2)
  lastDataSnapshotJson: jsonb("last_data_snapshot_json"),
  lastDataSnapshotAt: timestamp("last_data_snapshot_at"),
  snapshotExpiresAt: timestamp("snapshot_expires_at"),
  snapshotStatus: text("snapshot_status"),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  dataSignature: text("data_signature"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  dashboardIdx: index("dashboard_widgets_dashboard_idx").on(t.dashboardId),
  orderIdx: index("dashboard_widgets_order_idx").on(t.dashboardId, t.orderIndex),
}));

// ── Permissions ───────────────────────────────────────────────────────────────

export const dashboardPermissionsTable = pgTable("dashboard_permissions", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboardsTable.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(), // 'user' | 'role'
  subjectId: integer("subject_id"),
  roleKey: text("role_key"),
  permissionLevel: text("permission_level").notNull().default("view"), // 'view' | 'edit' | 'admin'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  dashboardIdx: index("dashboard_permissions_dashboard_idx").on(t.dashboardId),
  subjectIdx: index("dashboard_permissions_subject_idx").on(t.subjectType, t.subjectId),
}));

// ── Templates ─────────────────────────────────────────────────────────────────

export const dashboardTemplatesTable = pgTable("dashboard_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  icon: text("icon"),
  color: text("color"),
  previewImage: text("preview_image"),
  configJson: jsonb("config_json").notNull().default("{}"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Runs (generation audit) ───────────────────────────────────────────────────

export const dashboardRunsTable = pgTable("dashboard_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  inputType: text("input_type").notNull(), // 'prompt' | 'wizard' | 'template'
  promptText: text("prompt_text"),
  parsedIntentJson: jsonb("parsed_intent_json"),
  generatedConfigJson: jsonb("generated_config_json"),
  status: text("status").notNull().default("success"), // 'success' | 'error'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("dashboard_runs_user_idx").on(t.userId),
}));

// ── Filters ───────────────────────────────────────────────────────────────────

export const dashboardFiltersTable = pgTable("dashboard_filters", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboardsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(), // 'date_range' | 'select' | 'text' | 'multiselect'
  configJson: jsonb("config_json").notNull().default("{}"),
  defaultValueJson: jsonb("default_value_json"),
  orderIndex: integer("order_index").notNull().default(0),
}, (t) => ({
  dashboardIdx: index("dashboard_filters_dashboard_idx").on(t.dashboardId),
}));

// ── Widget Definitions (catalog) ──────────────────────────────────────────────

export const widgetDefinitionsTable = pgTable("widget_definitions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  configSchemaJson: jsonb("config_schema_json").notNull().default("{}"),
  defaultConfigJson: jsonb("default_config_json").notNull().default("{}"),
  supportsGlobalFilters: boolean("supports_global_filters").notNull().default(false),
  supportsDateRange: boolean("supports_date_range").notNull().default(false),
  supportsDrilldown: boolean("supports_drilldown").notNull().default(false),
  isExpensive: boolean("is_expensive").notNull().default(false),
  supportsSnapshot: boolean("supports_snapshot").notNull().default(false),
  snapshotTtlSeconds: integer("snapshot_ttl_seconds"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
