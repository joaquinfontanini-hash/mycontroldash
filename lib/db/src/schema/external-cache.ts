import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";

export const externalCacheTable = pgTable("external_cache", {
  id:          serial("id").primaryKey(),
  cacheKey:    text("cache_key").notNull().unique(),
  sourceName:  text("source_name").notNull(),
  dataJson:    text("data_json").notNull(),
  fetchedAt:   timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  isValid:     boolean("is_valid").notNull().default(true),
}, t => [
  index("ec_cache_key_idx").on(t.cacheKey),
  index("ec_source_name_idx").on(t.sourceName),
  index("ec_expires_at_idx").on(t.expiresAt),
]);

export type ExternalCache = typeof externalCacheTable.$inferSelect;

export const circuitBreakerTable = pgTable("circuit_breaker_state", {
  id:              serial("id").primaryKey(),
  sourceName:      text("source_name").notNull().unique(),
  state:           text("state").notNull().default("closed"),  // closed | open | half_open
  failureCount:    integer("failure_count").notNull().default(0),
  lastFailureAt:   timestamp("last_failure_at", { withTimezone: true }),
  openUntil:       timestamp("open_until", { withTimezone: true }),
  lastSuccessAt:   timestamp("last_success_at", { withTimezone: true }),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  index("cb_source_name_idx").on(t.sourceName),
]);

export type CircuitBreaker = typeof circuitBreakerTable.$inferSelect;
