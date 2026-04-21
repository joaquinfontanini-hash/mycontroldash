CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"last_activity_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
;
CREATE TABLE "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "task_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"due_date" text,
	"user_id" text,
	"assigned_to_user_id" text,
	"requires_acceptance" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"initial_observations" text,
	"parent_task_id" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "shortcuts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"category" text,
	"icon" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "fiscal_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"category" text NOT NULL,
	"organism" text NOT NULL,
	"source" text,
	"date" text NOT NULL,
	"impact" text DEFAULT 'medium' NOT NULL,
	"summary" text NOT NULL,
	"requires_action" boolean DEFAULT false NOT NULL,
	"is_saved" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"fingerprint" text,
	"tags" text,
	"is_normative" boolean DEFAULT false NOT NULL,
	"quality_score" integer DEFAULT 70 NOT NULL,
	"quality_issues" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "travel_api_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_name" text NOT NULL,
	"period_month" text NOT NULL,
	"calls_used" integer DEFAULT 0,
	"calls_limit" integer NOT NULL,
	"last_call_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_api_quotas_api_month_unique" UNIQUE("api_name","period_month")
);
;
CREATE TABLE "travel_locations" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"normalized_name" text NOT NULL,
	"code" text,
	"country" text NOT NULL,
	"region" text NOT NULL,
	"type" text DEFAULT 'city' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "travel_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin" text,
	"destination" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"provider" text NOT NULL,
	"offer_type" text DEFAULT 'paquete' NOT NULL,
	"travel_type" text DEFAULT 'nacional' NOT NULL,
	"duration" integer DEFAULT 1 NOT NULL,
	"departure_date" text,
	"passengers" integer,
	"hotel" text,
	"hotel_category" integer,
	"region" text DEFAULT 'argentina' NOT NULL,
	"link" text DEFAULT '#' NOT NULL,
	"valid_until" text,
	"is_valid" boolean DEFAULT true NOT NULL,
	"quality_score" integer DEFAULT 70 NOT NULL,
	"quality_issues" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "travel_search_profiles" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"travel_type" text NOT NULL,
	"origin_json" jsonb NOT NULL,
	"destination_mode" text DEFAULT 'specific' NOT NULL,
	"destinations_json" jsonb,
	"regions_json" jsonb,
	"excluded_destinations_json" jsonb,
	"max_budget" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"travelers_count" integer DEFAULT 1 NOT NULL,
	"traveler_profile" text DEFAULT 'pareja' NOT NULL,
	"min_days" integer,
	"max_days" integer,
	"airline_preferences_json" jsonb,
	"hotel_min_stars" integer,
	"meal_plan" text,
	"direct_flight_only" boolean DEFAULT false NOT NULL,
	"date_flexibility_days" integer,
	"source_configs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refresh_frequency_hours" integer DEFAULT 24 NOT NULL,
	"tolerance_percent" integer DEFAULT 20 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"search_type" text DEFAULT 'ambos',
	"departure_date_from" text,
	"departure_date_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_summary_json" jsonb
);
;
CREATE TABLE "travel_search_results" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_profile_id" varchar(36) NOT NULL,
	"user_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"external_url" text,
	"title" text NOT NULL,
	"origin_json" jsonb NOT NULL,
	"destination_json" jsonb NOT NULL,
	"region" text,
	"country" text,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"price_original" numeric(12, 2),
	"price_original_currency" text,
	"price_per_person" numeric(12, 2),
	"exchange_rate" numeric(12, 4),
	"days" integer,
	"nights" integer,
	"travelers_count" integer,
	"airline" text,
	"hotel_name" text,
	"hotel_stars" integer,
	"meal_plan" text,
	"departure_date" text,
	"return_date" text,
	"confidence_score" integer DEFAULT 80 NOT NULL,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"search_type" text,
	"api_source" text,
	"duration_minutes" integer,
	"stops" integer DEFAULT 0,
	"departure_time" text,
	"arrival_time" text,
	"raw_payload_json" jsonb,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_name" text DEFAULT 'Dashboard Personal' NOT NULL,
	"header_text" text DEFAULT 'Dashboard Personal' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"weather_location" text DEFAULT 'Neuquen' NOT NULL,
	"weather_latitude" text DEFAULT '-38.9516' NOT NULL,
	"weather_longitude" text DEFAULT '-68.0591' NOT NULL,
	"news_count" integer DEFAULT 20 NOT NULL,
	"news_refresh_minutes" integer DEFAULT 60 NOT NULL,
	"weather_refresh_minutes" integer DEFAULT 120 NOT NULL,
	"fiscal_refresh_minutes" integer DEFAULT 180 NOT NULL,
	"travel_budget_max" integer DEFAULT 500000 NOT NULL,
	"travel_audience" text DEFAULT 'todos' NOT NULL,
	"enable_news_job" boolean DEFAULT true NOT NULL,
	"enable_weather_job" boolean DEFAULT true NOT NULL,
	"enable_fiscal_job" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"category" text DEFAULT 'nacionales' NOT NULL,
	"region_level" text DEFAULT 'nacional' NOT NULL,
	"news_category" text DEFAULT 'economia' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"impact_level" text DEFAULT 'medio' NOT NULL,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"domain_fit_score" integer DEFAULT 0 NOT NULL,
	"category_confidence" integer DEFAULT 0 NOT NULL,
	"classification_reason" text DEFAULT '' NOT NULL,
	"exclusion_flags" text[] DEFAULT '{}' NOT NULL,
	"discarded" boolean DEFAULT false NOT NULL,
	"region" text DEFAULT 'nacional' NOT NULL,
	"url" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"image_url" text,
	"published_at" text NOT NULL,
	"importance_score" integer DEFAULT 0 NOT NULL,
	"is_fiscal_related" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_url_unique" UNIQUE("url")
);
;
CREATE TABLE "saved_news" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"news_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"region_level" text,
	"news_category" text,
	"active" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "weather_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"location" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"forecast" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"status" text NOT NULL,
	"records_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "email_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"email" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	CONSTRAINT "email_connections_clerk_id_unique" UNIQUE("clerk_id")
);
;
CREATE TABLE "discard_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"source_url" text,
	"reason" text NOT NULL,
	"raw_data" text,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "currency_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"buy" numeric(12, 2),
	"sell" numeric(12, 2),
	"avg" numeric(12, 2),
	"source" text DEFAULT '' NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"module" text NOT NULL,
	"type" text DEFAULT 'rss' NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"method" text DEFAULT 'rss' NOT NULL,
	"notes" text,
	"last_sync_at" timestamp with time zone,
	"last_status" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "due_date_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "due_dates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"due_date" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"recurrence_type" text DEFAULT 'none' NOT NULL,
	"recurrence_rule" text,
	"recurrence_end_date" text,
	"parent_id" integer,
	"is_recurrence_parent" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"client_id" integer,
	"calendar_rule_id" integer,
	"user_id" text,
	"traffic_light" text DEFAULT 'gris' NOT NULL,
	"cuit_group" text,
	"cuit_termination" integer,
	"tax_code" text,
	"classification_reason" text DEFAULT '' NOT NULL,
	"alert_generated" boolean DEFAULT false NOT NULL,
	"last_alert_sent_at" text,
	"manual_review" boolean DEFAULT false NOT NULL,
	"review_notes" text,
	"reviewed_at" text,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "external_file_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'excel' NOT NULL,
	"url" text,
	"identifier" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"user_id" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "client_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"description" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "client_tax_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_type" text NOT NULL,
	"notes" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cuit" text NOT NULL,
	"email" text,
	"email_secondary" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"client_priority" text DEFAULT 'media' NOT NULL,
	"alerts_active" boolean DEFAULT true NOT NULL,
	"responsible" text,
	"notes" text,
	"group_id" integer,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "annual_due_calendar_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_id" integer NOT NULL,
	"tax_type" text,
	"month" integer,
	"note" text NOT NULL,
	"requires_manual_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "annual_due_calendar_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_id" integer NOT NULL,
	"tax_type" text NOT NULL,
	"month" integer NOT NULL,
	"cuit_termination" text DEFAULT 'any' NOT NULL,
	"due_day" integer NOT NULL,
	"notes" text,
	"is_manual_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "annual_due_calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"calendar_type" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"uploaded_file" text,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_errors" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "uploaded_due_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text DEFAULT 'pdf' NOT NULL,
	"file_path" text,
	"file_size" bigint,
	"year" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_errors" text,
	"calendar_id" integer,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "supplier_payment_batch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"supplier" text NOT NULL,
	"original_due_date" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"document" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "supplier_payment_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"payment_date" text NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"due_date_id" integer,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"allowed_roles" text[] DEFAULT '{"super_admin","admin","editor","viewer"}' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modules_key_unique" UNIQUE("key")
);
;
CREATE TABLE "security_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_clerk_id" text,
	"actor_email" text,
	"target_clerk_id" text,
	"target_email" text,
	"action" text NOT NULL,
	"module" text,
	"result" text DEFAULT 'success' NOT NULL,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_module_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"module_key" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category_id" integer NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"last_four" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"close_day" integer DEFAULT 1 NOT NULL,
	"due_day" integer DEFAULT 10 NOT NULL,
	"credit_limit" numeric(18, 2),
	"currency" text DEFAULT 'ARS' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'circle' NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_config_key_unique" UNIQUE("key")
);
;
CREATE TABLE "finance_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"current_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"target_date" text,
	"category_id" integer,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_installment_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"description" text NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"installment_amount" numeric(18, 2) NOT NULL,
	"total_installments" integer NOT NULL,
	"paid_installments" integer DEFAULT 0 NOT NULL,
	"start_date" text NOT NULL,
	"next_due_date" text,
	"card_id" integer,
	"category_id" integer,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"creditor" text,
	"total_amount" numeric(18, 2) NOT NULL,
	"total_installments" integer NOT NULL,
	"installment_amount" numeric(18, 2) NOT NULL,
	"paid_installments" integer DEFAULT 0 NOT NULL,
	"start_date" text NOT NULL,
	"next_due_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_recurring_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"category_id" integer,
	"account_id" integer,
	"frequency" text NOT NULL,
	"day_of_month" integer,
	"next_date" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "finance_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"category_id" integer,
	"account_id" integer,
	"card_id" integer,
	"installment_plan_id" integer,
	"date" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"payment_method" text,
	"notes" text,
	"is_fixed" boolean DEFAULT false NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurring_rule_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "daily_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"date" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "strategy_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'profesional' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"phone" text,
	"bio" text,
	"avatar_url" text,
	"area" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
;
CREATE TABLE "conversation_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'direct' NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "registration_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "alert_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"due_date_id" integer,
	"alert_type" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text,
	"sent_at" timestamp with time zone,
	"send_status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"is_automatic" boolean DEFAULT true NOT NULL,
	"retriggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"detail" text,
	"before" text,
	"after" text,
	"user_id" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "semaforo_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"min_days_ahead" integer,
	"max_days_ahead" integer,
	"conditions" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "tax_homologation" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"normalized_code" text NOT NULL,
	"aliases" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"template_key" text,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"provider_message_id" text,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_event_id" integer,
	"user_id" integer,
	"channel" text DEFAULT 'email' NOT NULL,
	"provider" text,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "notification_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" text NOT NULL,
	"event_subtype" text,
	"payload_json" text,
	"dedupe_key" text,
	"scheduled_for" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" text,
	"requested_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "system_email_provider" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_type" text DEFAULT 'smtp_gmail' NOT NULL,
	"sender_email" text,
	"sender_name" text DEFAULT 'Sistema Dashboard' NOT NULL,
	"reply_to" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"connection_status" text DEFAULT 'not_configured' NOT NULL,
	"enc_smtp_host" text,
	"enc_smtp_port" text,
	"enc_smtp_user" text,
	"enc_smtp_pass" text,
	"sent_today" integer DEFAULT 0 NOT NULL,
	"failed_today" integer DEFAULT 0 NOT NULL,
	"sent_today_date" text,
	"last_connected_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_notification_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"due_date_enabled" boolean DEFAULT true NOT NULL,
	"due_date_days_before" text DEFAULT '7,3,1' NOT NULL,
	"due_date_same_day" boolean DEFAULT true NOT NULL,
	"due_date_summary_only" boolean DEFAULT false NOT NULL,
	"news_enabled" boolean DEFAULT false NOT NULL,
	"news_frequency" text DEFAULT 'daily' NOT NULL,
	"news_min_priority" text DEFAULT 'high' NOT NULL,
	"news_categories" text DEFAULT '' NOT NULL,
	"news_max_per_day" integer DEFAULT 3 NOT NULL,
	"dollar_enabled" boolean DEFAULT false NOT NULL,
	"dollar_up_threshold" text,
	"dollar_down_threshold" text,
	"dollar_market" text DEFAULT 'blue' NOT NULL,
	"dollar_daily_summary" boolean DEFAULT false NOT NULL,
	"login_enabled" boolean DEFAULT true NOT NULL,
	"login_every_access" boolean DEFAULT false NOT NULL,
	"login_new_device_only" boolean DEFAULT true NOT NULL,
	"login_suspicious_only" boolean DEFAULT false NOT NULL,
	"login_password_change" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_prefs_user_id_unique" UNIQUE("user_id")
);
;
CREATE TABLE "circuit_breaker_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_name" text NOT NULL,
	"state" text DEFAULT 'closed' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone,
	"open_until" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_breaker_state_source_name_unique" UNIQUE("source_name")
);
;
CREATE TABLE "external_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"source_name" text NOT NULL,
	"data_json" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	CONSTRAINT "external_cache_cache_key_unique" UNIQUE("cache_key")
);
;
CREATE TABLE "job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"records_affected" integer DEFAULT 0,
	"error_message" text,
	"meta_json" text
);
;
CREATE TABLE "in_app_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"link_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"payload_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key" text NOT NULL,
	"json_value" text DEFAULT 'null' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "dashboard_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"config_json" jsonb DEFAULT '{}' NOT NULL,
	"default_value_json" jsonb,
	"order_index" integer DEFAULT 0 NOT NULL
);
;
CREATE TABLE "dashboard_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"breakpoint" text DEFAULT 'desktop' NOT NULL,
	"layout_json" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
;
CREATE TABLE "dashboard_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer,
	"role_key" text,
	"permission_level" text DEFAULT 'view' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
;
CREATE TABLE "dashboard_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"input_type" text NOT NULL,
	"prompt_text" text,
	"parsed_intent_json" jsonb,
	"generated_config_json" jsonb,
	"status" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
;
CREATE TABLE "dashboard_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"color" text,
	"preview_image" text,
	"config_json" jsonb DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_templates_key_unique" UNIQUE("key")
);
;
CREATE TABLE "dashboard_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"data_source_key" text,
	"config_json" jsonb DEFAULT '{}' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"refresh_interval_seconds" integer,
	"last_data_snapshot_json" jsonb,
	"last_data_snapshot_at" timestamp,
	"snapshot_expires_at" timestamp,
	"snapshot_status" text,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"data_signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
;
CREATE TABLE "dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"color" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"template_key" text,
	"prompt_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"refresh_interval_seconds" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
;
CREATE TABLE "widget_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"config_schema_json" jsonb DEFAULT '{}' NOT NULL,
	"default_config_json" jsonb DEFAULT '{}' NOT NULL,
	"supports_global_filters" boolean DEFAULT false NOT NULL,
	"supports_date_range" boolean DEFAULT false NOT NULL,
	"supports_drilldown" boolean DEFAULT false NOT NULL,
	"is_expensive" boolean DEFAULT false NOT NULL,
	"supports_snapshot" boolean DEFAULT false NOT NULL,
	"snapshot_ttl_seconds" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "widget_definitions_key_unique" UNIQUE("key")
);
;
CREATE TABLE "quote_activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"description" text NOT NULL,
	"metadata_json" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "quote_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"adjustment_date" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"adjustment_rate" numeric(10, 6) NOT NULL,
	"index_used" text DEFAULT 'ipc' NOT NULL,
	"previous_base_amount" numeric(18, 2) NOT NULL,
	"new_base_amount" numeric(18, 2) NOT NULL,
	"installments_affected" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"applied_by" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "quote_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"installment_number" integer NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"due_date" text NOT NULL,
	"base_amount" numeric(18, 2) NOT NULL,
	"adjusted_amount" numeric(18, 2) NOT NULL,
	"applied_adjustment_rate" numeric(10, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"balance_due" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "quote_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
;
CREATE TABLE "quote_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"installment_id" integer,
	"client_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"payment_date" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"payment_method" text DEFAULT 'transferencia' NOT NULL,
	"reference" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "quote_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"previous_total_amount" numeric(18, 2) NOT NULL,
	"new_total_amount" numeric(18, 2) NOT NULL,
	"previous_payload_json" jsonb,
	"new_payload_json" jsonb,
	"change_reason" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" text NOT NULL,
	"client_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_quote_id" integer,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"quote_type" text DEFAULT 'single' NOT NULL,
	"contract_type" text,
	"contract_start_date" text,
	"contract_end_date" text,
	"billing_frequency" text,
	"adjustment_frequency" text,
	"adjustment_index" text,
	"adjustment_mode" text,
	"base_amount" numeric(18, 2),
	"current_amount" numeric(18, 2),
	"next_adjustment_date" text,
	"last_adjustment_date" text,
	"installments_generated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "quotes_quote_number_unique" UNIQUE("quote_number")
);
;
ALTER TABLE "saved_news" ADD CONSTRAINT "saved_news_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "saved_news" ADD CONSTRAINT "saved_news_news_id_news_items_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news_items"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "user_alerts" ADD CONSTRAINT "user_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "dashboard_filters" ADD CONSTRAINT "dashboard_filters_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "dashboard_runs" ADD CONSTRAINT "dashboard_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_activity_logs" ADD CONSTRAINT "quote_activity_logs_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_activity_logs" ADD CONSTRAINT "quote_activity_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "quote_adjustments" ADD CONSTRAINT "quote_adjustments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_installments" ADD CONSTRAINT "quote_installments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_payments" ADD CONSTRAINT "quote_payments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quote_payments" ADD CONSTRAINT "quote_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;;
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;;
CREATE INDEX "travel_locations_normalized_name_idx" ON "travel_locations" USING btree ("normalized_name");;
CREATE INDEX "travel_locations_code_idx" ON "travel_locations" USING btree ("code");;
CREATE INDEX "travel_locations_label_idx" ON "travel_locations" USING btree ("label");;
CREATE INDEX "travel_search_profiles_user_id_idx" ON "travel_search_profiles" USING btree ("user_id");;
CREATE INDEX "travel_search_profiles_is_active_idx" ON "travel_search_profiles" USING btree ("is_active");;
CREATE INDEX "travel_search_results_user_id_idx" ON "travel_search_results" USING btree ("user_id");;
CREATE INDEX "travel_search_results_profile_id_idx" ON "travel_search_results" USING btree ("search_profile_id");;
CREATE INDEX "travel_search_results_status_idx" ON "travel_search_results" USING btree ("status");;
CREATE INDEX "travel_search_results_validation_idx" ON "travel_search_results" USING btree ("validation_status");;
CREATE INDEX "travel_search_results_user_profile_idx" ON "travel_search_results" USING btree ("user_id","search_profile_id");;
CREATE UNIQUE INDEX "user_settings_user_key_idx" ON "user_settings" USING btree ("user_id","key");;
CREATE INDEX "el_user_id_idx" ON "email_logs" USING btree ("user_id");;
CREATE INDEX "el_status_idx" ON "email_logs" USING btree ("status");;
CREATE INDEX "el_created_at_idx" ON "email_logs" USING btree ("created_at");;
CREATE INDEX "nd_event_id_idx" ON "notification_deliveries" USING btree ("notification_event_id");;
CREATE INDEX "nd_user_id_idx" ON "notification_deliveries" USING btree ("user_id");;
CREATE INDEX "ne_user_id_idx" ON "notification_events" USING btree ("user_id");;
CREATE INDEX "ne_event_type_idx" ON "notification_events" USING btree ("event_type");;
CREATE INDEX "ne_dedupe_key_idx" ON "notification_events" USING btree ("dedupe_key");;
CREATE INDEX "prt_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");;
CREATE INDEX "prt_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");;
CREATE INDEX "unp_user_id_idx" ON "user_notification_prefs" USING btree ("user_id");;
CREATE INDEX "cb_source_name_idx" ON "circuit_breaker_state" USING btree ("source_name");;
CREATE INDEX "ec_cache_key_idx" ON "external_cache" USING btree ("cache_key");;
CREATE INDEX "ec_source_name_idx" ON "external_cache" USING btree ("source_name");;
CREATE INDEX "ec_expires_at_idx" ON "external_cache" USING btree ("expires_at");;
CREATE INDEX "jl_job_name_idx" ON "job_logs" USING btree ("job_name");;
CREATE INDEX "jl_status_idx" ON "job_logs" USING btree ("status");;
CREATE INDEX "jl_started_at_idx" ON "job_logs" USING btree ("started_at");;
CREATE INDEX "ian_user_id_idx" ON "in_app_notifications" USING btree ("user_id");;
CREATE INDEX "ian_is_read_idx" ON "in_app_notifications" USING btree ("is_read");;
CREATE INDEX "ian_type_idx" ON "in_app_notifications" USING btree ("type");;
CREATE INDEX "ian_created_at_idx" ON "in_app_notifications" USING btree ("created_at");;
CREATE UNIQUE INDEX "up_user_key_idx" ON "user_preferences" USING btree ("user_id","key");;
CREATE INDEX "dashboard_filters_dashboard_idx" ON "dashboard_filters" USING btree ("dashboard_id");;
CREATE UNIQUE INDEX "dashboard_layouts_dashboard_breakpoint_idx" ON "dashboard_layouts" USING btree ("dashboard_id","breakpoint");;
CREATE INDEX "dashboard_permissions_dashboard_idx" ON "dashboard_permissions" USING btree ("dashboard_id");;
CREATE INDEX "dashboard_permissions_subject_idx" ON "dashboard_permissions" USING btree ("subject_type","subject_id");;
CREATE INDEX "dashboard_runs_user_idx" ON "dashboard_runs" USING btree ("user_id");;
CREATE INDEX "dashboard_widgets_dashboard_idx" ON "dashboard_widgets" USING btree ("dashboard_id");;
CREATE INDEX "dashboard_widgets_order_idx" ON "dashboard_widgets" USING btree ("dashboard_id","order_index");;
CREATE INDEX "dashboards_owner_idx" ON "dashboards" USING btree ("owner_user_id");;
CREATE INDEX "dashboards_status_idx" ON "dashboards" USING btree ("status");;
CREATE UNIQUE INDEX "dashboards_slug_owner_idx" ON "dashboards" USING btree ("slug","owner_user_id");;
CREATE INDEX "quote_activity_quote_idx" ON "quote_activity_logs" USING btree ("quote_id");;
CREATE INDEX "quote_activity_client_idx" ON "quote_activity_logs" USING btree ("client_id");;
CREATE INDEX "quote_adjustments_quote_idx" ON "quote_adjustments" USING btree ("quote_id");;
CREATE INDEX "quote_adjustments_date_idx" ON "quote_adjustments" USING btree ("adjustment_date");;
CREATE INDEX "quote_installments_quote_idx" ON "quote_installments" USING btree ("quote_id");;
CREATE INDEX "quote_installments_due_date_idx" ON "quote_installments" USING btree ("due_date");;
CREATE INDEX "quote_installments_status_idx" ON "quote_installments" USING btree ("status");;
CREATE INDEX "quote_installments_number_idx" ON "quote_installments" USING btree ("quote_id","installment_number");;
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id");;
CREATE INDEX "quote_payments_quote_idx" ON "quote_payments" USING btree ("quote_id");;
CREATE INDEX "quote_payments_client_idx" ON "quote_payments" USING btree ("client_id");;
CREATE INDEX "quote_payments_date_idx" ON "quote_payments" USING btree ("payment_date");;
CREATE INDEX "quote_payments_installment_idx" ON "quote_payments" USING btree ("installment_id");;
CREATE INDEX "quote_revisions_quote_idx" ON "quote_revisions" USING btree ("quote_id");;
CREATE INDEX "quotes_client_idx" ON "quotes" USING btree ("client_id");;
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");;
CREATE INDEX "quotes_due_date_idx" ON "quotes" USING btree ("due_date");;
CREATE INDEX "quotes_issue_date_idx" ON "quotes" USING btree ("issue_date");;
CREATE INDEX "quotes_created_at_idx" ON "quotes" USING btree ("created_at");;
CREATE INDEX "quotes_user_idx" ON "quotes" USING btree ("user_id");;
CREATE INDEX "quotes_type_idx" ON "quotes" USING btree ("quote_type");