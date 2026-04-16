import {
  pgTable, text, serial, timestamp, boolean, integer, numeric, jsonb, varchar, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Legacy table (kept for data compatibility — not exposed via new routes) ────

export const travelOffersTable = pgTable("travel_offers", {
  id: serial("id").primaryKey(),
  origin: text("origin"),
  destination: text("destination").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  provider: text("provider").notNull(),
  offerType: text("offer_type").notNull().default("paquete"),
  travelType: text("travel_type").notNull().default("nacional"),
  duration: integer("duration").notNull().default(1),
  departureDate: text("departure_date"),
  passengers: integer("passengers"),
  hotel: text("hotel"),
  hotelCategory: integer("hotel_category"),
  region: text("region").notNull().default("argentina"),
  link: text("link").notNull().default("#"),
  validUntil: text("valid_until"),
  isValid: boolean("is_valid").notNull().default(true),
  qualityScore: integer("quality_score").notNull().default(70),
  qualityIssues: text("quality_issues"),
  needsReview: boolean("needs_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTravelOfferSchema = createInsertSchema(travelOffersTable).omit({ id: true, createdAt: true });
export type InsertTravelOffer = z.infer<typeof insertTravelOfferSchema>;
export type TravelOffer = typeof travelOffersTable.$inferSelect;

// ── travel_locations — location & airport catalog ─────────────────────────────

export const travelLocationsTable = pgTable("travel_locations", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  normalizedName: text("normalized_name").notNull(),
  code: text("code"),
  country: text("country").notNull(),
  region: text("region").notNull(),
  type: text("type").notNull().default("city"),
  aliases: jsonb("aliases").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  normalizedNameIdx: index("travel_locations_normalized_name_idx").on(t.normalizedName),
  codeIdx:           index("travel_locations_code_idx").on(t.code),
  labelIdx:          index("travel_locations_label_idx").on(t.label),
}));

export type TravelLocation = typeof travelLocationsTable.$inferSelect;

// ── travel_search_profiles — saved monitoring rules ───────────────────────────

export const travelSearchProfilesTable = pgTable("travel_search_profiles", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),

  travelType: text("travel_type").notNull(),

  originJson: jsonb("origin_json").notNull(),

  destinationMode: text("destination_mode").notNull().default("specific"),
  destinationsJson: jsonb("destinations_json"),
  regionsJson: jsonb("regions_json"),
  excludedDestinationsJson: jsonb("excluded_destinations_json"),

  maxBudget: numeric("max_budget", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),

  travelersCount: integer("travelers_count").notNull().default(1),
  travelerProfile: text("traveler_profile").notNull().default("pareja"),

  minDays: integer("min_days"),
  maxDays: integer("max_days"),

  airlinePreferencesJson: jsonb("airline_preferences_json"),

  hotelMinStars: integer("hotel_min_stars"),
  mealPlan: text("meal_plan"),

  directFlightOnly: boolean("direct_flight_only").notNull().default(false),

  dateFlexibilityDays: integer("date_flexibility_days"),

  sourceConfigsJson: jsonb("source_configs_json").notNull().default(sql`'[]'::jsonb`),

  refreshFrequencyHours: integer("refresh_frequency_hours").notNull().default(24),
  tolerancePercent: integer("tolerance_percent").notNull().default(20),
  priority: integer("priority").notNull().default(0),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunStatus: text("last_run_status"),
  lastRunSummaryJson: jsonb("last_run_summary_json"),
}, (t) => ({
  userIdIdx:    index("travel_search_profiles_user_id_idx").on(t.userId),
  isActiveIdx:  index("travel_search_profiles_is_active_idx").on(t.isActive),
}));

export type TravelSearchProfile = typeof travelSearchProfilesTable.$inferSelect;

// ── travel_search_results — matched offers found by running a profile ─────────

export const travelSearchResultsTable = pgTable("travel_search_results", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  searchProfileId: varchar("search_profile_id", { length: 36 }).notNull(),
  userId: integer("user_id").notNull(),

  source: text("source").notNull(),
  externalId: text("external_id"),
  externalUrl: text("external_url"),

  title: text("title").notNull(),

  originJson: jsonb("origin_json").notNull(),
  destinationJson: jsonb("destination_json").notNull(),

  region: text("region"),
  country: text("country"),

  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  priceOriginal: numeric("price_original", { precision: 12, scale: 2 }),

  days: integer("days"),
  nights: integer("nights"),
  travelersCount: integer("travelers_count"),

  airline: text("airline"),
  hotelName: text("hotel_name"),
  hotelStars: integer("hotel_stars"),
  mealPlan: text("meal_plan"),

  departureDate: text("departure_date"),
  returnDate: text("return_date"),

  confidenceScore: integer("confidence_score").notNull().default(80),

  validationStatus: text("validation_status").notNull().default("pending"),
  status: text("status").notNull().default("new"),

  rawPayloadJson: jsonb("raw_payload_json"),

  foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdIdx:         index("travel_search_results_user_id_idx").on(t.userId),
  profileIdIdx:      index("travel_search_results_profile_id_idx").on(t.searchProfileId),
  statusIdx:         index("travel_search_results_status_idx").on(t.status),
  validationIdx:     index("travel_search_results_validation_idx").on(t.validationStatus),
  userProfileIdx:    index("travel_search_results_user_profile_idx").on(t.userId, t.searchProfileId),
}));

export type TravelSearchResult = typeof travelSearchResultsTable.$inferSelect;
