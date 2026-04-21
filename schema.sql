-- =============================================================================
-- mycontroldash — schema.sql v2
-- Aplicar en Supabase → SQL Editor (ejecutar completo de una sola vez)
-- Última revisión: índices añadidos, FKs explícitas, doble-punto-y-coma
--   eliminado, CHECK constraints en columnas de estado, updated_at triggers
-- =============================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- FUNCIÓN AUXILIAR: actualizar updated_at automáticamente
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- USUARIOS Y AUTENTICACIÓN
-- =============================================================================

CREATE TABLE IF NOT EXISTS "users" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "clerk_id"              text UNIQUE,
  "email"                 text NOT NULL UNIQUE,
  "name"                  text,
  "password_hash"         text,
  "role"                  text NOT NULL DEFAULT 'viewer'
                            CHECK (role IN ('super_admin','admin','editor','viewer')),
  "is_active"             boolean NOT NULL DEFAULT true,
  "is_blocked"            boolean NOT NULL DEFAULT false,
  "blocked_at"            timestamptz,
  "blocked_reason"        text,
  "last_activity_at"      timestamptz,
  "must_change_password"  boolean NOT NULL DEFAULT false,
  "metadata"              jsonb,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_profiles" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "phone"       text,
  "bio"         text,
  "avatar_url"  text,
  "area"        text,
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_settings" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "key"         text NOT NULL,
  "value"       text NOT NULL,
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "key")
);

CREATE TABLE IF NOT EXISTS "user_module_permissions" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "module_key"  text NOT NULL,
  "is_enabled"  boolean NOT NULL DEFAULT true,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "module_key")
);

CREATE TABLE IF NOT EXISTS "registration_requests" (
  "id"               serial PRIMARY KEY NOT NULL,
  "first_name"       text NOT NULL,
  "last_name"        text NOT NULL,
  "email"            text NOT NULL,
  "password_hash"    text NOT NULL,
  "note"             text,
  "status"           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  "reviewed_by"      integer REFERENCES "users"("id"),
  "reviewed_at"      timestamptz,
  "rejection_reason" text,
  "requested_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "user_id"               integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"            text NOT NULL,
  "expires_at"            timestamptz NOT NULL,
  "used_at"               timestamptz,
  "requested_ip"          text,
  "requested_user_agent"  text,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- MÓDULOS Y PERMISOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS "modules" (
  "id"            serial PRIMARY KEY NOT NULL,
  "key"           text NOT NULL UNIQUE,
  "name"          text NOT NULL,
  "description"   text,
  "is_active"     boolean NOT NULL DEFAULT true,
  "allowed_roles" text[] NOT NULL DEFAULT '{"super_admin","admin","editor","viewer"}',
  "order_index"   integer NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- CONFIGURACIÓN GLOBAL
-- =============================================================================

CREATE TABLE IF NOT EXISTS "app_settings" (
  "id"                     serial PRIMARY KEY NOT NULL,
  "dashboard_name"         text NOT NULL DEFAULT 'Dashboard Personal',
  "header_text"            text NOT NULL DEFAULT 'Dashboard Personal',
  "theme"                  text NOT NULL DEFAULT 'dark',
  "weather_location"       text NOT NULL DEFAULT 'Neuquen',
  "weather_latitude"       text NOT NULL DEFAULT '-38.9516',
  "weather_longitude"      text NOT NULL DEFAULT '-68.0591',
  "news_count"             integer NOT NULL DEFAULT 20,
  "news_refresh_minutes"   integer NOT NULL DEFAULT 60,
  "weather_refresh_minutes" integer NOT NULL DEFAULT 120,
  "fiscal_refresh_minutes" integer NOT NULL DEFAULT 180,
  "travel_budget_max"      integer NOT NULL DEFAULT 500000,
  "travel_audience"        text NOT NULL DEFAULT 'todos',
  "enable_news_job"        boolean NOT NULL DEFAULT true,
  "enable_weather_job"     boolean NOT NULL DEFAULT true,
  "enable_fiscal_job"      boolean NOT NULL DEFAULT true,
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- TAREAS Y PRODUCTIVIDAD
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tasks" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "title"                 text NOT NULL,
  "description"           text,
  "status"                text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','in_progress','in_review','completed','rejected','cancelled')),
  "priority"              text NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low','medium','high','critical')),
  "progress"              integer NOT NULL DEFAULT 0
                            CHECK (progress >= 0 AND progress <= 100),
  "due_date"              text,
  "user_id"               text,
  "assigned_to_user_id"   text,
  "requires_acceptance"   boolean NOT NULL DEFAULT false,
  "rejection_reason"      text,
  "initial_observations"  text,
  "parent_task_id"        integer REFERENCES "tasks"("id") ON DELETE SET NULL,
  "completed_at"          timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_comments" (
  "id"         serial PRIMARY KEY NOT NULL,
  "task_id"    integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL,
  "content"    text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_history" (
  "id"             serial PRIMARY KEY NOT NULL,
  "task_id"        integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id"        text NOT NULL,
  "action"         text NOT NULL,
  "previous_value" text,
  "new_value"      text,
  "comment"        text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "shortcuts" (
  "id"         serial PRIMARY KEY NOT NULL,
  "name"       text NOT NULL,
  "url"        text NOT NULL,
  "category"   text,
  "icon"       text,
  "user_id"    text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "daily_goals" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "title"       text NOT NULL,
  "date"        text NOT NULL,
  "priority"    text NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low','medium','high')),
  "is_done"     boolean NOT NULL DEFAULT false,
  "order_index" integer NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "strategy_goals" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "title"      text NOT NULL,
  "category"   text NOT NULL DEFAULT 'profesional',
  "priority"   text NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low','medium','high')),
  "status"     text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','completed','paused','cancelled')),
  "progress"   integer NOT NULL DEFAULT 0
                 CHECK (progress >= 0 AND progress <= 100),
  "start_date" text NOT NULL,
  "end_date"   text NOT NULL,
  "notes"      text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id"         serial PRIMARY KEY NOT NULL,
  "goal_id"    integer NOT NULL REFERENCES "strategy_goals"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL,
  "title"      text NOT NULL,
  "start_date" text NOT NULL,
  "end_date"   text NOT NULL,
  "status"     text NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','in_progress','done')),
  "notes"      text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- CLIENTES Y FISCAL
-- =============================================================================

CREATE TABLE IF NOT EXISTS "client_groups" (
  "id"          serial PRIMARY KEY NOT NULL,
  "name"        text NOT NULL,
  "color"       text NOT NULL DEFAULT 'blue',
  "description" text,
  "user_id"     text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "clients" (
  "id"              serial PRIMARY KEY NOT NULL,
  "name"            text NOT NULL,
  "cuit"            text NOT NULL,
  "email"           text,
  "email_secondary" text,
  "phone"           text,
  "status"          text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','archived')),
  "client_priority" text NOT NULL DEFAULT 'media'
                      CHECK (client_priority IN ('alta','media','baja')),
  "alerts_active"   boolean NOT NULL DEFAULT true,
  "responsible"     text,
  "notes"           text,
  "group_id"        integer REFERENCES "client_groups"("id") ON DELETE SET NULL,
  "user_id"         text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "client_tax_assignments" (
  "id"         serial PRIMARY KEY NOT NULL,
  "client_id"  integer NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "tax_type"   text NOT NULL,
  "notes"      text,
  "enabled"    boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("client_id", "tax_type")
);

CREATE TABLE IF NOT EXISTS "due_date_categories" (
  "id"         serial PRIMARY KEY NOT NULL,
  "name"       text NOT NULL,
  "color"      text NOT NULL DEFAULT 'blue',
  "user_id"    text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "due_dates" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "title"                 text NOT NULL,
  "category"              text NOT NULL DEFAULT 'general',
  "due_date"              text NOT NULL,
  "description"           text,
  "priority"              text NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low','medium','high','critical')),
  "status"                text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','completed','overdue','cancelled')),
  "alert_enabled"         boolean NOT NULL DEFAULT true,
  "recurrence_type"       text NOT NULL DEFAULT 'none'
                            CHECK (recurrence_type IN ('none','daily','weekly','monthly','yearly','custom')),
  "recurrence_rule"       text,
  "recurrence_end_date"   text,
  "parent_id"             integer REFERENCES "due_dates"("id") ON DELETE SET NULL,
  "is_recurrence_parent"  boolean NOT NULL DEFAULT false,
  "source"                text NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual','calendar','afip','import')),
  "client_id"             integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "calendar_rule_id"      integer,
  "user_id"               text,
  "traffic_light"         text NOT NULL DEFAULT 'gris'
                            CHECK (traffic_light IN ('verde','amarillo','naranja','rojo','gris')),
  "cuit_group"            text,
  "cuit_termination"      integer,
  "tax_code"              text,
  "classification_reason" text NOT NULL DEFAULT '',
  "alert_generated"       boolean NOT NULL DEFAULT false,
  "last_alert_sent_at"    text,
  "manual_review"         boolean NOT NULL DEFAULT false,
  "review_notes"          text,
  "reviewed_at"           text,
  "reviewed_by"           text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "semaforo_rules" (
  "id"              serial PRIMARY KEY NOT NULL,
  "name"            text NOT NULL,
  "color"           text NOT NULL,
  "min_days_ahead"  integer,
  "max_days_ahead"  integer,
  "conditions"      text,
  "priority"        integer NOT NULL DEFAULT 0,
  "active"          boolean NOT NULL DEFAULT true,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "tax_homologation" (
  "id"              serial PRIMARY KEY NOT NULL,
  "original_name"   text NOT NULL,
  "normalized_code" text NOT NULL,
  "aliases"         text,
  "status"          text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive')),
  "notes"           text,
  "created_by"      text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "annual_due_calendars" (
  "id"            serial PRIMARY KEY NOT NULL,
  "name"          text NOT NULL,
  "year"          integer NOT NULL,
  "calendar_type" text NOT NULL DEFAULT 'general',
  "status"        text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','archived')),
  "notes"         text,
  "uploaded_file" text,
  "parse_status"  text NOT NULL DEFAULT 'pending'
                    CHECK (parse_status IN ('pending','processing','done','error')),
  "parse_errors"  text,
  "user_id"       text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "annual_due_calendar_rules" (
  "id"                serial PRIMARY KEY NOT NULL,
  "calendar_id"       integer NOT NULL REFERENCES "annual_due_calendars"("id") ON DELETE CASCADE,
  "tax_type"          text NOT NULL,
  "month"             integer NOT NULL CHECK (month >= 1 AND month <= 12),
  "cuit_termination"  text NOT NULL DEFAULT 'any',
  "due_day"           integer NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  "notes"             text,
  "is_manual_override" boolean NOT NULL DEFAULT false,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "annual_due_calendar_notes" (
  "id"                   serial PRIMARY KEY NOT NULL,
  "calendar_id"          integer NOT NULL REFERENCES "annual_due_calendars"("id") ON DELETE CASCADE,
  "tax_type"             text,
  "month"                integer CHECK (month >= 1 AND month <= 12),
  "note"                 text NOT NULL,
  "requires_manual_review" boolean NOT NULL DEFAULT false,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "uploaded_due_files" (
  "id"           serial PRIMARY KEY NOT NULL,
  "file_name"    text NOT NULL,
  "file_type"    text NOT NULL DEFAULT 'pdf',
  "file_path"    text,
  "file_size"    bigint,
  "year"         integer,
  "status"       text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','done','error')),
  "parse_status" text NOT NULL DEFAULT 'pending'
                   CHECK (parse_status IN ('pending','processing','done','error')),
  "parse_errors" text,
  "calendar_id"  integer REFERENCES "annual_due_calendars"("id") ON DELETE SET NULL,
  "user_id"      text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- PROVEEDORES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "supplier_payment_batches" (
  "id"            serial PRIMARY KEY NOT NULL,
  "file_name"     text NOT NULL,
  "week_start"    text NOT NULL,
  "week_end"      text NOT NULL,
  "payment_date"  text NOT NULL,
  "total_amount"  integer NOT NULL DEFAULT 0,
  "item_count"    integer NOT NULL DEFAULT 0,
  "status"        text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','paid','cancelled')),
  "notes"         text,
  "due_date_id"   integer REFERENCES "due_dates"("id") ON DELETE SET NULL,
  "user_id"       text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "supplier_payment_batch_items" (
  "id"                serial PRIMARY KEY NOT NULL,
  "batch_id"          integer NOT NULL REFERENCES "supplier_payment_batches"("id") ON DELETE CASCADE,
  "supplier"          text NOT NULL,
  "original_due_date" text,
  "amount"            integer NOT NULL DEFAULT 0,
  "document"          text,
  "notes"             text,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- PRESUPUESTOS Y COBRANZAS (quotes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "quotes" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             text NOT NULL,
  "client_id"           integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "quote_type"          text NOT NULL DEFAULT 'single'
                          CHECK (quote_type IN ('single','recurring_indexed')),
  "title"               text NOT NULL,
  "status"              text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','approved','rejected','expired','cancelled')),
  "currency"            text NOT NULL DEFAULT 'ARS',
  "subtotal"            numeric(18,2) NOT NULL DEFAULT 0,
  "tax_amount"          numeric(18,2) NOT NULL DEFAULT 0,
  "total"               numeric(18,2) NOT NULL DEFAULT 0,
  "notes"               text,
  "valid_until"         text,
  -- Campos para contratos recurrentes indexados
  "billing_frequency"   text CHECK (billing_frequency IN ('monthly','bimonthly','quarterly','semiannual','annual')),
  "contract_start"      text,
  "contract_end"        text,
  "index_type"          text CHECK (index_type IN ('IPC','ICL','none')),
  "last_adjustment_at"  text,
  "next_adjustment_at"  text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_items" (
  "id"          serial PRIMARY KEY NOT NULL,
  "quote_id"    integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity"    numeric(10,2) NOT NULL DEFAULT 1,
  "unit_price"  numeric(18,2) NOT NULL,
  "total"       numeric(18,2) NOT NULL,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_revisions" (
  "id"          serial PRIMARY KEY NOT NULL,
  "quote_id"    integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "revision"    integer NOT NULL DEFAULT 1,
  "snapshot"    jsonb NOT NULL,
  "notes"       text,
  "created_by"  text,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_payments" (
  "id"             serial PRIMARY KEY NOT NULL,
  "quote_id"       integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "amount"         numeric(18,2) NOT NULL,
  "currency"       text NOT NULL DEFAULT 'ARS',
  "payment_date"   text NOT NULL,
  "payment_method" text,
  "notes"          text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_installments" (
  "id"              serial PRIMARY KEY NOT NULL,
  "quote_id"        integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "installment_num" integer NOT NULL,
  "due_date"        text NOT NULL,
  "amount"          numeric(18,2) NOT NULL,
  "currency"        text NOT NULL DEFAULT 'ARS',
  "status"          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','partially_paid','overdue','cancelled')),
  "paid_amount"     numeric(18,2) NOT NULL DEFAULT 0,
  "paid_at"         text,
  "notes"           text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_adjustments" (
  "id"            serial PRIMARY KEY NOT NULL,
  "quote_id"      integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "index_type"    text NOT NULL CHECK (index_type IN ('IPC','ICL')),
  "rate"          numeric(8,4) NOT NULL,
  "applied_at"    text NOT NULL,
  "applied_by"    text,
  "notes"         text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "quote_activity_logs" (
  "id"         serial PRIMARY KEY NOT NULL,
  "quote_id"   integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "user_id"    text,
  "action"     text NOT NULL,
  "detail"     text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- FINANZAS PERSONALES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "finance_categories" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text,
  "type"       text NOT NULL CHECK (type IN ('income','expense','transfer')),
  "name"       text NOT NULL,
  "icon"       text NOT NULL DEFAULT 'circle',
  "color"      text NOT NULL DEFAULT '#6b7280',
  "is_default" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_accounts" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "type"       text NOT NULL,
  "label"      text NOT NULL,
  "amount"     numeric(18,2) NOT NULL DEFAULT 0,
  "currency"   text NOT NULL DEFAULT 'ARS',
  "notes"      text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_cards" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "name"         text NOT NULL,
  "bank"         text,
  "last_four"    text,
  "color"        text NOT NULL DEFAULT '#6366f1',
  "close_day"    integer NOT NULL DEFAULT 1 CHECK (close_day >= 1 AND close_day <= 31),
  "due_day"      integer NOT NULL DEFAULT 10 CHECK (due_day >= 1 AND due_day <= 31),
  "credit_limit" numeric(18,2),
  "currency"     text NOT NULL DEFAULT 'ARS',
  "is_active"    boolean NOT NULL DEFAULT true,
  "notes"        text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_transactions" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             text NOT NULL,
  "type"                text NOT NULL CHECK (type IN ('income','expense','transfer')),
  "amount"              numeric(18,2) NOT NULL,
  "currency"            text NOT NULL DEFAULT 'ARS',
  "category_id"         integer REFERENCES "finance_categories"("id") ON DELETE SET NULL,
  "account_id"          integer REFERENCES "finance_accounts"("id") ON DELETE SET NULL,
  "card_id"             integer REFERENCES "finance_cards"("id") ON DELETE SET NULL,
  "installment_plan_id" integer,
  "date"                text NOT NULL,
  "status"              text NOT NULL DEFAULT 'confirmed'
                          CHECK (status IN ('confirmed','pending','cancelled')),
  "payment_method"      text,
  "notes"               text,
  "is_fixed"            boolean NOT NULL DEFAULT false,
  "is_recurring"        boolean NOT NULL DEFAULT false,
  "recurring_rule_id"   integer,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_recurring_rules" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "name"         text NOT NULL,
  "type"         text NOT NULL CHECK (type IN ('income','expense')),
  "amount"       numeric(18,2) NOT NULL,
  "currency"     text NOT NULL DEFAULT 'ARS',
  "category_id"  integer REFERENCES "finance_categories"("id") ON DELETE SET NULL,
  "account_id"   integer REFERENCES "finance_accounts"("id") ON DELETE SET NULL,
  "frequency"    text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  "day_of_month" integer CHECK (day_of_month >= 1 AND day_of_month <= 31),
  "next_date"    text,
  "is_active"    boolean NOT NULL DEFAULT true,
  "notes"        text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_installment_plans" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             text NOT NULL,
  "description"         text NOT NULL,
  "total_amount"        numeric(18,2) NOT NULL,
  "installment_amount"  numeric(18,2) NOT NULL,
  "total_installments"  integer NOT NULL,
  "paid_installments"   integer NOT NULL DEFAULT 0,
  "start_date"          text NOT NULL,
  "next_due_date"       text,
  "card_id"             integer REFERENCES "finance_cards"("id") ON DELETE SET NULL,
  "category_id"         integer REFERENCES "finance_categories"("id") ON DELETE SET NULL,
  "currency"            text NOT NULL DEFAULT 'ARS',
  "is_active"           boolean NOT NULL DEFAULT true,
  "notes"               text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_loans" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             text NOT NULL,
  "name"                text NOT NULL,
  "creditor"            text,
  "total_amount"        numeric(18,2) NOT NULL,
  "total_installments"  integer NOT NULL,
  "installment_amount"  numeric(18,2) NOT NULL,
  "paid_installments"   integer NOT NULL DEFAULT 0,
  "start_date"          text NOT NULL,
  "next_due_date"       text,
  "status"              text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','paid','defaulted','cancelled')),
  "currency"            text NOT NULL DEFAULT 'ARS',
  "notes"               text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_budgets" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "category_id" integer NOT NULL REFERENCES "finance_categories"("id") ON DELETE CASCADE,
  "month"       text NOT NULL,
  "amount"      numeric(18,2) NOT NULL,
  "currency"    text NOT NULL DEFAULT 'ARS',
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "category_id", "month")
);

CREATE TABLE IF NOT EXISTS "finance_goals" (
  "id"             serial PRIMARY KEY NOT NULL,
  "user_id"        text NOT NULL,
  "type"           text NOT NULL,
  "title"          text NOT NULL,
  "target_amount"  numeric(18,2) NOT NULL,
  "current_amount" numeric(18,2) NOT NULL DEFAULT 0,
  "target_date"    text,
  "category_id"    integer REFERENCES "finance_categories"("id") ON DELETE SET NULL,
  "currency"       text NOT NULL DEFAULT 'ARS',
  "is_active"      boolean NOT NULL DEFAULT true,
  "notes"          text,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "finance_config" (
  "id"         serial PRIMARY KEY NOT NULL,
  "key"        text NOT NULL UNIQUE,
  "value"      text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- NOTICIAS Y CONTENIDO EXTERNO
-- =============================================================================

CREATE TABLE IF NOT EXISTS "news_items" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "title"                 text NOT NULL,
  "source"                text NOT NULL,
  "category"              text NOT NULL DEFAULT 'nacionales',
  "region_level"          text NOT NULL DEFAULT 'nacional',
  "news_category"         text NOT NULL DEFAULT 'economia',
  "tags"                  text[] NOT NULL DEFAULT '{}',
  "impact_level"          text NOT NULL DEFAULT 'medio'
                            CHECK (impact_level IN ('bajo','medio','alto','critico')),
  "priority_score"        integer NOT NULL DEFAULT 0,
  "domain_fit_score"      integer NOT NULL DEFAULT 0,
  "category_confidence"   integer NOT NULL DEFAULT 0,
  "classification_reason" text NOT NULL DEFAULT '',
  "exclusion_flags"       text[] NOT NULL DEFAULT '{}',
  "discarded"             boolean NOT NULL DEFAULT false,
  "region"                text NOT NULL DEFAULT 'nacional',
  "url"                   text NOT NULL UNIQUE,
  "summary"               text NOT NULL DEFAULT '',
  "image_url"             text,
  "published_at"          text NOT NULL,
  "importance_score"      integer NOT NULL DEFAULT 0,
  "is_fiscal_related"     boolean NOT NULL DEFAULT false,
  "fetched_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "saved_news" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "news_id"    integer NOT NULL REFERENCES "news_items"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "news_id")
);

CREATE TABLE IF NOT EXISTS "user_alerts" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "region_level"  text,
  "news_category" text,
  "active"        boolean NOT NULL DEFAULT true,
  "label"         text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fiscal_updates" (
  "id"              serial PRIMARY KEY NOT NULL,
  "title"           text NOT NULL,
  "jurisdiction"    text NOT NULL,
  "category"        text NOT NULL,
  "organism"        text NOT NULL,
  "source"          text,
  "date"            text NOT NULL,
  "impact"          text NOT NULL DEFAULT 'medium'
                      CHECK (impact IN ('low','medium','high','critical')),
  "summary"         text NOT NULL,
  "requires_action" boolean NOT NULL DEFAULT false,
  "is_saved"        boolean NOT NULL DEFAULT false,
  "source_url"      text,
  "fingerprint"     text,
  "tags"            text,
  "is_normative"    boolean NOT NULL DEFAULT false,
  "quality_score"   integer NOT NULL DEFAULT 70,
  "quality_issues"  text,
  "needs_review"    boolean NOT NULL DEFAULT false,
  "is_hidden"       boolean NOT NULL DEFAULT false,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- COTIZACIONES Y CLIMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS "currency_rates" (
  "id"         serial PRIMARY KEY NOT NULL,
  "type"       text NOT NULL,
  "label"      text NOT NULL,
  "buy"        numeric(12,2),
  "sell"       numeric(12,2),
  "avg"        numeric(12,2),
  "source"     text NOT NULL DEFAULT '',
  "source_url" text,
  "status"     text NOT NULL DEFAULT 'ok'
                 CHECK (status IN ('ok','error','stale')),
  "fetched_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "weather_snapshots" (
  "id"         serial PRIMARY KEY NOT NULL,
  "location"   text NOT NULL,
  "latitude"   text NOT NULL,
  "longitude"  text NOT NULL,
  "forecast"   jsonb NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- VIAJES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "travel_locations" (
  "id"              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label"           text NOT NULL,
  "normalized_name" text NOT NULL,
  "code"            text,
  "country"         text NOT NULL,
  "region"          text NOT NULL,
  "type"            text NOT NULL DEFAULT 'city'
                      CHECK (type IN ('city','region','country','airport')),
  "aliases"         jsonb NOT NULL DEFAULT '[]',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "travel_offers" (
  "id"             serial PRIMARY KEY NOT NULL,
  "origin"         text,
  "destination"    text NOT NULL,
  "description"    text,
  "price"          numeric(10,2) NOT NULL,
  "currency"       text NOT NULL DEFAULT 'USD',
  "provider"       text NOT NULL,
  "offer_type"     text NOT NULL DEFAULT 'paquete',
  "travel_type"    text NOT NULL DEFAULT 'nacional',
  "duration"       integer NOT NULL DEFAULT 1,
  "departure_date" text,
  "passengers"     integer,
  "hotel"          text,
  "hotel_category" integer,
  "region"         text NOT NULL DEFAULT 'argentina',
  "link"           text NOT NULL DEFAULT '#',
  "valid_until"    text,
  "is_valid"       boolean NOT NULL DEFAULT true,
  "quality_score"  integer NOT NULL DEFAULT 70,
  "quality_issues" text,
  "needs_review"   boolean NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "travel_api_quotas" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "api_name"      text NOT NULL,
  "period_month"  text NOT NULL,
  "calls_used"    integer DEFAULT 0,
  "calls_limit"   integer NOT NULL,
  "last_call_at"  timestamptz,
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("api_name", "period_month")
);

CREATE TABLE IF NOT EXISTS "travel_search_profiles" (
  "id"                         varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"                    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"                       text NOT NULL,
  "is_active"                  boolean NOT NULL DEFAULT true,
  "travel_type"                text NOT NULL,
  "origin_json"                jsonb NOT NULL,
  "destination_mode"           text NOT NULL DEFAULT 'specific',
  "destinations_json"          jsonb,
  "regions_json"               jsonb,
  "excluded_destinations_json" jsonb,
  "max_budget"                 numeric(12,2) NOT NULL,
  "currency"                   text NOT NULL DEFAULT 'ARS',
  "travelers_count"            integer NOT NULL DEFAULT 1,
  "traveler_profile"           text NOT NULL DEFAULT 'pareja',
  "min_days"                   integer,
  "max_days"                   integer,
  "airline_preferences_json"   jsonb,
  "hotel_min_stars"            integer,
  "meal_plan"                  text,
  "direct_flight_only"         boolean NOT NULL DEFAULT false,
  "date_flexibility_days"      integer,
  "source_configs_json"        jsonb NOT NULL DEFAULT '[]',
  "refresh_frequency_hours"    integer NOT NULL DEFAULT 24,
  "tolerance_percent"          integer NOT NULL DEFAULT 20,
  "priority"                   integer NOT NULL DEFAULT 0,
  "notes"                      text,
  "search_type"                text DEFAULT 'ambos',
  "departure_date_from"        text,
  "departure_date_to"          text,
  "created_at"                 timestamptz NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz NOT NULL DEFAULT now(),
  "last_run_at"                timestamptz,
  "last_run_status"            text,
  "last_run_summary_json"      jsonb
);

CREATE TABLE IF NOT EXISTS "travel_search_results" (
  "id"                    varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "search_profile_id"     varchar(36) NOT NULL REFERENCES "travel_search_profiles"("id") ON DELETE CASCADE,
  "user_id"               integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source"                text NOT NULL,
  "external_id"           text,
  "external_url"          text,
  "title"                 text NOT NULL,
  "origin_json"           jsonb NOT NULL,
  "destination_json"      jsonb NOT NULL,
  "region"                text,
  "country"               text,
  "price"                 numeric(12,2) NOT NULL,
  "currency"              text NOT NULL DEFAULT 'ARS',
  "price_original"        numeric(12,2),
  "price_original_currency" text,
  "price_per_person"      numeric(12,2),
  "exchange_rate"         numeric(12,4),
  "days"                  integer,
  "nights"                integer,
  "travelers_count"       integer,
  "airline"               text,
  "hotel_name"            text,
  "hotel_stars"           integer,
  "meal_plan"             text,
  "departure_date"        text,
  "return_date"           text,
  "confidence_score"      integer NOT NULL DEFAULT 80,
  "validation_status"     text NOT NULL DEFAULT 'pending'
                            CHECK (validation_status IN ('pending','valid','invalid')),
  "status"                text NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new','viewed','saved','dismissed')),
  "search_type"           text,
  "api_source"            text,
  "duration_minutes"      integer,
  "stops"                 integer NOT NULL DEFAULT 0,
  "departure_time"        text,
  "arrival_time"          text,
  "raw_payload_json"      jsonb,
  "found_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- DASHBOARD STUDIO
-- =============================================================================

CREATE TABLE IF NOT EXISTS "dashboard_templates" (
  "id"          serial PRIMARY KEY NOT NULL,
  "name"        text NOT NULL,
  "description" text,
  "category"    text,
  "layout_json" jsonb NOT NULL DEFAULT '[]',
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "widget_definitions" (
  "id"             serial PRIMARY KEY NOT NULL,
  "type"           text NOT NULL UNIQUE,
  "name"           text NOT NULL,
  "description"    text,
  "data_source_key" text,
  "default_config" jsonb NOT NULL DEFAULT '{}',
  "min_w"          integer NOT NULL DEFAULT 1,
  "min_h"          integer NOT NULL DEFAULT 1,
  "is_active"      boolean NOT NULL DEFAULT true,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dashboards" (
  "id"                      serial PRIMARY KEY NOT NULL,
  "owner_user_id"           integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"                    text NOT NULL,
  "description"             text,
  "status"                  text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','published','archived')),
  "layout_json"             jsonb NOT NULL DEFAULT '[]',
  "refresh_interval_seconds" integer NOT NULL DEFAULT 300,
  "template_id"             integer REFERENCES "dashboard_templates"("id") ON DELETE SET NULL,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dashboard_widgets" (
  "id"              serial PRIMARY KEY NOT NULL,
  "dashboard_id"    integer NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  "widget_type"     text NOT NULL,
  "title"           text,
  "data_source_key" text,
  "config_json"     jsonb NOT NULL DEFAULT '{}',
  "layout_x"        integer NOT NULL DEFAULT 0,
  "layout_y"        integer NOT NULL DEFAULT 0,
  "layout_w"        integer NOT NULL DEFAULT 1,
  "layout_h"        integer NOT NULL DEFAULT 1,
  "sort_order"      integer NOT NULL DEFAULT 0,
  "refresh_interval_seconds" integer,
  "data_signature"  text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dashboard_snapshots" (
  "id"           serial PRIMARY KEY NOT NULL,
  "dashboard_id" integer NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  "widget_id"    integer REFERENCES "dashboard_widgets"("id") ON DELETE SET NULL,
  "data_json"    jsonb NOT NULL,
  "snapshot_at"  timestamptz NOT NULL DEFAULT now(),
  "status"       text NOT NULL DEFAULT 'ok'
                   CHECK (status IN ('ok','stale','error'))
);

CREATE TABLE IF NOT EXISTS "dashboard_permissions" (
  "id"           serial PRIMARY KEY NOT NULL,
  "dashboard_id" integer NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  "user_id"      integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_key"     text NOT NULL DEFAULT 'viewer'
                   CHECK (role_key IN ('viewer','editor','owner')),
  "granted_at"   timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("dashboard_id", "user_id")
);

-- =============================================================================
-- CHAT INTERNO
-- =============================================================================

CREATE TABLE IF NOT EXISTS "conversations" (
  "id"         serial PRIMARY KEY NOT NULL,
  "type"       text NOT NULL DEFAULT 'direct'
                 CHECK (type IN ('direct','group')),
  "name"       text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "conversation_participants" (
  "id"              serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id"         integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_read_at"    timestamptz,
  "joined_at"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("conversation_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id"              serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "sender_id"       integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content"         text NOT NULL,
  "is_deleted"      boolean NOT NULL DEFAULT false,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- NOTIFICACIONES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "in_app_notifications" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type"        text NOT NULL,
  "title"       text NOT NULL,
  "body"        text,
  "payload_json" jsonb,
  "is_read"     boolean NOT NULL DEFAULT false,
  "read_at"     timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "notification_events" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       integer REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type"    text NOT NULL,
  "event_subtype" text,
  "payload_json"  text,
  "dedupe_key"    text UNIQUE,
  "scheduled_for" timestamptz,
  "processed_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id"                    serial PRIMARY KEY NOT NULL,
  "notification_event_id" integer REFERENCES "notification_events"("id") ON DELETE SET NULL,
  "user_id"               integer REFERENCES "users"("id") ON DELETE CASCADE,
  "channel"               text NOT NULL DEFAULT 'email'
                            CHECK (channel IN ('email','push','in_app')),
  "provider"              text,
  "delivery_status"       text NOT NULL DEFAULT 'pending'
                            CHECK (delivery_status IN ('pending','sent','failed','bounced')),
  "retry_count"           integer NOT NULL DEFAULT 0,
  "provider_message_id"   text,
  "error_message"         text,
  "sent_at"               timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_notification_prefs" (
  "id"                      serial PRIMARY KEY NOT NULL,
  "user_id"                 integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "email_enabled"           boolean NOT NULL DEFAULT true,
  "due_date_enabled"        boolean NOT NULL DEFAULT true,
  "due_date_days_before"    text NOT NULL DEFAULT '7,3,1',
  "due_date_same_day"       boolean NOT NULL DEFAULT true,
  "due_date_summary_only"   boolean NOT NULL DEFAULT false,
  "news_enabled"            boolean NOT NULL DEFAULT false,
  "news_frequency"          text NOT NULL DEFAULT 'daily',
  "news_min_priority"       text NOT NULL DEFAULT 'high',
  "news_categories"         text NOT NULL DEFAULT '',
  "news_max_per_day"        integer NOT NULL DEFAULT 3,
  "dollar_enabled"          boolean NOT NULL DEFAULT false,
  "dollar_up_threshold"     text,
  "dollar_down_threshold"   text,
  "dollar_market"           text NOT NULL DEFAULT 'blue',
  "dollar_daily_summary"    boolean NOT NULL DEFAULT false,
  "login_enabled"           boolean NOT NULL DEFAULT true,
  "login_every_access"      boolean NOT NULL DEFAULT false,
  "login_new_device_only"   boolean NOT NULL DEFAULT true,
  "login_suspicious_only"   boolean NOT NULL DEFAULT false,
  "login_password_change"   boolean NOT NULL DEFAULT true,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- EMAIL
-- =============================================================================

CREATE TABLE IF NOT EXISTS "email_connections" (
  "id"               serial PRIMARY KEY NOT NULL,
  "clerk_id"         text NOT NULL UNIQUE,
  "provider"         text NOT NULL DEFAULT 'gmail',
  "email"            text,
  "access_token"     text,
  "refresh_token"    text,
  "token_expires_at" text,
  "is_active"        boolean NOT NULL DEFAULT true,
  "connected_at"     timestamptz NOT NULL DEFAULT now(),
  "last_sync_at"     timestamptz
);

CREATE TABLE IF NOT EXISTS "email_logs" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             integer REFERENCES "users"("id") ON DELETE SET NULL,
  "template_key"        text,
  "recipient_email"     text NOT NULL,
  "subject"             text NOT NULL,
  "provider"            text,
  "status"              text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed','bounced')),
  "error_message"       text,
  "provider_message_id" text,
  "metadata_json"       text,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "system_email_provider" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "provider_type"       text NOT NULL DEFAULT 'smtp_gmail',
  "sender_email"        text,
  "sender_name"         text NOT NULL DEFAULT 'Sistema Dashboard',
  "reply_to"            text,
  "is_active"           boolean NOT NULL DEFAULT false,
  "connection_status"   text NOT NULL DEFAULT 'not_configured'
                          CHECK (connection_status IN ('not_configured','ok','error')),
  "enc_smtp_host"       text,
  "enc_smtp_port"       text,
  "enc_smtp_user"       text,
  "enc_smtp_pass"       text,
  "sent_today"          integer NOT NULL DEFAULT 0,
  "failed_today"        integer NOT NULL DEFAULT 0,
  "sent_today_date"     text,
  "last_connected_at"   timestamptz,
  "last_success_at"     timestamptz,
  "last_error_at"       timestamptz,
  "last_error_message"  text,
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "alert_logs" (
  "id"              serial PRIMARY KEY NOT NULL,
  "client_id"       integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "due_date_id"     integer REFERENCES "due_dates"("id") ON DELETE SET NULL,
  "alert_type"      text NOT NULL,
  "recipient"       text NOT NULL,
  "subject"         text NOT NULL,
  "body_html"       text,
  "sent_at"         timestamptz,
  "send_status"     text NOT NULL DEFAULT 'pending'
                      CHECK (send_status IN ('pending','sent','failed')),
  "error_message"   text,
  "is_automatic"    boolean NOT NULL DEFAULT true,
  "retriggered_by"  text,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- AUDITORÍA Y LOGS DE SISTEMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"         serial PRIMARY KEY NOT NULL,
  "module"     text NOT NULL,
  "entity"     text NOT NULL,
  "entity_id"  text,
  "action"     text NOT NULL,
  "detail"     text,
  "before"     text,
  "after"      text,
  "user_id"    text,
  "ip_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "security_logs" (
  "id"              serial PRIMARY KEY NOT NULL,
  "actor_clerk_id"  text,
  "actor_email"     text,
  "target_clerk_id" text,
  "target_email"    text,
  "action"          text NOT NULL,
  "module"          text,
  "result"          text NOT NULL DEFAULT 'success'
                      CHECK (result IN ('success','failure','blocked')),
  "metadata"        jsonb,
  "ip_address"      text,
  "user_agent"      text,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sync_logs" (
  "id"             serial PRIMARY KEY NOT NULL,
  "module"         text NOT NULL,
  "status"         text NOT NULL CHECK (status IN ('ok','error','partial')),
  "records_count"  integer NOT NULL DEFAULT 0,
  "message"        text,
  "duration_ms"    integer,
  "started_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "job_logs" (
  "id"               serial PRIMARY KEY NOT NULL,
  "job_name"         text NOT NULL,
  "status"           text NOT NULL CHECK (status IN ('running','success','error')),
  "started_at"       timestamptz NOT NULL DEFAULT now(),
  "finished_at"      timestamptz,
  "duration_ms"      integer,
  "records_affected" integer DEFAULT 0,
  "error_message"    text,
  "meta_json"        text
);

CREATE TABLE IF NOT EXISTS "discard_logs" (
  "id"           serial PRIMARY KEY NOT NULL,
  "module"       text NOT NULL,
  "source"       text NOT NULL DEFAULT '',
  "title"        text NOT NULL DEFAULT '',
  "source_url"   text,
  "reason"       text NOT NULL,
  "raw_data"     text,
  "discarded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "data_sources" (
  "id"           serial PRIMARY KEY NOT NULL,
  "name"         text NOT NULL,
  "module"       text NOT NULL,
  "type"         text NOT NULL DEFAULT 'rss',
  "url"          text NOT NULL,
  "enabled"      boolean NOT NULL DEFAULT true,
  "priority"     integer NOT NULL DEFAULT 5,
  "method"       text NOT NULL DEFAULT 'rss',
  "notes"        text,
  "last_sync_at" timestamptz,
  "last_status"  text NOT NULL DEFAULT 'unknown',
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "external_file_sources" (
  "id"             serial PRIMARY KEY NOT NULL,
  "name"           text NOT NULL,
  "type"           text NOT NULL DEFAULT 'excel',
  "url"            text,
  "identifier"     text,
  "status"         text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','active','error','disabled')),
  "notes"          text,
  "user_id"        text,
  "last_synced_at" timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- CIRCUIT BREAKER Y CACHÉ EXTERNA
-- =============================================================================

CREATE TABLE IF NOT EXISTS "circuit_breaker_state" (
  "id"              serial PRIMARY KEY NOT NULL,
  "source_name"     text NOT NULL UNIQUE,
  "state"           text NOT NULL DEFAULT 'closed'
                      CHECK (state IN ('closed','open','half_open')),
  "failure_count"   integer NOT NULL DEFAULT 0,
  "last_failure_at" timestamptz,
  "open_until"      timestamptz,
  "last_success_at" timestamptz,
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "external_cache" (
  "id"           serial PRIMARY KEY NOT NULL,
  "cache_key"    text NOT NULL UNIQUE,
  "source_name"  text NOT NULL,
  "data_json"    text NOT NULL,
  "fetched_at"   timestamptz NOT NULL DEFAULT now(),
  "expires_at"   timestamptz NOT NULL,
  "is_valid"     boolean NOT NULL DEFAULT true
);

-- =============================================================================
-- ÍNDICES — ordenados por tabla y columna de mayor frecuencia de consulta
-- =============================================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_clerk_id       ON "users"("clerk_id");
CREATE INDEX IF NOT EXISTS idx_users_email          ON "users"("email");
CREATE INDEX IF NOT EXISTS idx_users_role           ON "users"("role");
CREATE INDEX IF NOT EXISTS idx_users_is_active      ON "users"("is_active");

-- tasks
CREATE INDEX IF NOT EXISTS idx_tasks_user_id        ON "tasks"("user_id");
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to    ON "tasks"("assigned_to_user_id");
CREATE INDEX IF NOT EXISTS idx_tasks_status         ON "tasks"("status");
CREATE INDEX IF NOT EXISTS idx_tasks_parent         ON "tasks"("parent_task_id");
CREATE INDEX IF NOT EXISTS idx_tasks_due_date       ON "tasks"("due_date");

-- task_comments / task_history
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON "task_comments"("task_id");
CREATE INDEX IF NOT EXISTS idx_task_history_task_id  ON "task_history"("task_id");

-- shortcuts
CREATE INDEX IF NOT EXISTS idx_shortcuts_user_id    ON "shortcuts"("user_id");

-- daily_goals
CREATE INDEX IF NOT EXISTS idx_daily_goals_user_date ON "daily_goals"("user_id","date");

-- strategy_goals / project_tasks
CREATE INDEX IF NOT EXISTS idx_strategy_goals_user  ON "strategy_goals"("user_id");
CREATE INDEX IF NOT EXISTS idx_project_tasks_goal   ON "project_tasks"("goal_id");

-- clients
CREATE INDEX IF NOT EXISTS idx_clients_user_id      ON "clients"("user_id");
CREATE INDEX IF NOT EXISTS idx_clients_cuit         ON "clients"("cuit");
CREATE INDEX IF NOT EXISTS idx_clients_status       ON "clients"("status");
CREATE INDEX IF NOT EXISTS idx_clients_group_id     ON "clients"("group_id");

-- client_tax_assignments
CREATE INDEX IF NOT EXISTS idx_client_tax_client    ON "client_tax_assignments"("client_id");

-- due_dates
CREATE INDEX IF NOT EXISTS idx_due_dates_user_id    ON "due_dates"("user_id");
CREATE INDEX IF NOT EXISTS idx_due_dates_due_date   ON "due_dates"("due_date");
CREATE INDEX IF NOT EXISTS idx_due_dates_status     ON "due_dates"("status");
CREATE INDEX IF NOT EXISTS idx_due_dates_traffic    ON "due_dates"("traffic_light");
CREATE INDEX IF NOT EXISTS idx_due_dates_client_id  ON "due_dates"("client_id");
CREATE INDEX IF NOT EXISTS idx_due_dates_tax_code   ON "due_dates"("tax_code");
CREATE INDEX IF NOT EXISTS idx_due_dates_parent     ON "due_dates"("parent_id");

-- annual calendars
CREATE INDEX IF NOT EXISTS idx_cal_rules_calendar   ON "annual_due_calendar_rules"("calendar_id");
CREATE INDEX IF NOT EXISTS idx_cal_notes_calendar   ON "annual_due_calendar_notes"("calendar_id");

-- quotes
CREATE INDEX IF NOT EXISTS idx_quotes_user_id       ON "quotes"("user_id");
CREATE INDEX IF NOT EXISTS idx_quotes_client_id     ON "quotes"("client_id");
CREATE INDEX IF NOT EXISTS idx_quotes_status        ON "quotes"("status");
CREATE INDEX IF NOT EXISTS idx_quote_items_quote    ON "quote_items"("quote_id");
CREATE INDEX IF NOT EXISTS idx_quote_installments_quote ON "quote_installments"("quote_id");
CREATE INDEX IF NOT EXISTS idx_quote_installments_due   ON "quote_installments"("due_date");
CREATE INDEX IF NOT EXISTS idx_quote_installments_status ON "quote_installments"("status");
CREATE INDEX IF NOT EXISTS idx_quote_payments_quote ON "quote_payments"("quote_id");

-- finance
CREATE INDEX IF NOT EXISTS idx_fin_txn_user_id      ON "finance_transactions"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_txn_date         ON "finance_transactions"("date");
CREATE INDEX IF NOT EXISTS idx_fin_txn_type         ON "finance_transactions"("type");
CREATE INDEX IF NOT EXISTS idx_fin_txn_category     ON "finance_transactions"("category_id");
CREATE INDEX IF NOT EXISTS idx_fin_txn_account      ON "finance_transactions"("account_id");
CREATE INDEX IF NOT EXISTS idx_fin_txn_card         ON "finance_transactions"("card_id");
CREATE INDEX IF NOT EXISTS idx_fin_accounts_user    ON "finance_accounts"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_cards_user       ON "finance_cards"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_budgets_user_month ON "finance_budgets"("user_id","month");
CREATE INDEX IF NOT EXISTS idx_fin_goals_user       ON "finance_goals"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_installments_user ON "finance_installment_plans"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_loans_user       ON "finance_loans"("user_id");
CREATE INDEX IF NOT EXISTS idx_fin_recurring_user   ON "finance_recurring_rules"("user_id");

-- news_items
CREATE INDEX IF NOT EXISTS idx_news_published_at    ON "news_items"("published_at");
CREATE INDEX IF NOT EXISTS idx_news_category        ON "news_items"("news_category");
CREATE INDEX IF NOT EXISTS idx_news_discarded       ON "news_items"("discarded");
CREATE INDEX IF NOT EXISTS idx_news_fiscal          ON "news_items"("is_fiscal_related");

-- saved_news / user_alerts
CREATE INDEX IF NOT EXISTS idx_saved_news_user      ON "saved_news"("user_id");
CREATE INDEX IF NOT EXISTS idx_user_alerts_user     ON "user_alerts"("user_id");

-- fiscal_updates
CREATE INDEX IF NOT EXISTS idx_fiscal_date          ON "fiscal_updates"("date");
CREATE INDEX IF NOT EXISTS idx_fiscal_organism      ON "fiscal_updates"("organism");
CREATE INDEX IF NOT EXISTS idx_fiscal_hidden        ON "fiscal_updates"("is_hidden");

-- currency_rates
CREATE INDEX IF NOT EXISTS idx_currency_type        ON "currency_rates"("type");
CREATE INDEX IF NOT EXISTS idx_currency_fetched_at  ON "currency_rates"("fetched_at");

-- supplier batches
CREATE INDEX IF NOT EXISTS idx_batches_user_id      ON "supplier_payment_batches"("user_id");
CREATE INDEX IF NOT EXISTS idx_batch_items_batch    ON "supplier_payment_batch_items"("batch_id");

-- dashboards
CREATE INDEX IF NOT EXISTS idx_dashboards_owner     ON "dashboards"("owner_user_id");
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard ON "dashboard_widgets"("dashboard_id");
CREATE INDEX IF NOT EXISTS idx_dashboard_perms_user ON "dashboard_permissions"("user_id");
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_dashboard ON "dashboard_snapshots"("dashboard_id");

-- messages / conversations
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON "messages"("conversation_id");
CREATE INDEX IF NOT EXISTS idx_messages_sender      ON "messages"("sender_id");
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON "conversation_participants"("user_id");

-- notifications
CREATE INDEX IF NOT EXISTS idx_notif_events_user    ON "notification_events"("user_id");
CREATE INDEX IF NOT EXISTS idx_notif_events_scheduled ON "notification_events"("scheduled_for");
CREATE INDEX IF NOT EXISTS idx_in_app_notif_user    ON "in_app_notifications"("user_id");
CREATE INDEX IF NOT EXISTS idx_in_app_notif_read    ON "in_app_notifications"("is_read");

-- alert_logs
CREATE INDEX IF NOT EXISTS idx_alert_logs_client    ON "alert_logs"("client_id");
CREATE INDEX IF NOT EXISTS idx_alert_logs_due_date  ON "alert_logs"("due_date_id");

-- audit / security logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_module    ON "audit_logs"("module");
CREATE INDEX IF NOT EXISTS idx_audit_logs_user      ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON "audit_logs"("created_at");
CREATE INDEX IF NOT EXISTS idx_security_logs_actor  ON "security_logs"("actor_clerk_id");
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON "security_logs"("created_at");

-- job_logs
CREATE INDEX IF NOT EXISTS idx_job_logs_name        ON "job_logs"("job_name");
CREATE INDEX IF NOT EXISTS idx_job_logs_started     ON "job_logs"("started_at");

-- external_cache
CREATE INDEX IF NOT EXISTS idx_ext_cache_expires    ON "external_cache"("expires_at");
CREATE INDEX IF NOT EXISTS idx_ext_cache_source     ON "external_cache"("source_name");

-- password_reset_tokens
CREATE INDEX IF NOT EXISTS idx_pw_reset_user        ON "password_reset_tokens"("user_id");
CREATE INDEX IF NOT EXISTS idx_pw_reset_expires     ON "password_reset_tokens"("expires_at");

-- travel
CREATE INDEX IF NOT EXISTS idx_travel_results_profile ON "travel_search_results"("search_profile_id");
CREATE INDEX IF NOT EXISTS idx_travel_results_user    ON "travel_search_results"("user_id");
CREATE INDEX IF NOT EXISTS idx_travel_profiles_user   ON "travel_search_profiles"("user_id");

-- user_settings
CREATE INDEX IF NOT EXISTS idx_user_settings_user   ON "user_settings"("user_id");

-- =============================================================================
-- TRIGGERS updated_at
-- Aplicar solo en tablas que tienen esa columna
-- =============================================================================

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_modules_updated_at
  BEFORE UPDATE ON "modules"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_strategy_goals_updated_at
  BEFORE UPDATE ON "strategy_goals"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_project_tasks_updated_at
  BEFORE UPDATE ON "project_tasks"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON "clients"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_client_groups_updated_at
  BEFORE UPDATE ON "client_groups"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_due_dates_updated_at
  BEFORE UPDATE ON "due_dates"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_annual_due_calendars_updated_at
  BEFORE UPDATE ON "annual_due_calendars"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_tax_homologation_updated_at
  BEFORE UPDATE ON "tax_homologation"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_external_file_sources_updated_at
  BEFORE UPDATE ON "external_file_sources"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_supplier_batches_updated_at
  BEFORE UPDATE ON "supplier_payment_batches"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON "quotes"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_quote_installments_updated_at
  BEFORE UPDATE ON "quote_installments"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_accounts_updated_at
  BEFORE UPDATE ON "finance_accounts"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_cards_updated_at
  BEFORE UPDATE ON "finance_cards"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_transactions_updated_at
  BEFORE UPDATE ON "finance_transactions"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_budgets_updated_at
  BEFORE UPDATE ON "finance_budgets"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_goals_updated_at
  BEFORE UPDATE ON "finance_goals"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_loans_updated_at
  BEFORE UPDATE ON "finance_loans"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_installment_plans_updated_at
  BEFORE UPDATE ON "finance_installment_plans"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_finance_recurring_rules_updated_at
  BEFORE UPDATE ON "finance_recurring_rules"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON "dashboards"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_dashboard_widgets_updated_at
  BEFORE UPDATE ON "dashboard_widgets"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_notification_prefs_updated_at
  BEFORE UPDATE ON "user_notification_prefs"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_notification_deliveries_updated_at
  BEFORE UPDATE ON "notification_deliveries"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_travel_search_profiles_updated_at
  BEFORE UPDATE ON "travel_search_profiles"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER trg_travel_search_results_updated_at
  BEFORE UPDATE ON "travel_search_results"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) — desactivado por defecto, listo para activar
-- El backend maneja aislamiento por user_id en la capa de aplicación.
-- Para activar por tabla: ALTER TABLE "tabla" ENABLE ROW LEVEL SECURITY;
-- =============================================================================

-- fin del schema
