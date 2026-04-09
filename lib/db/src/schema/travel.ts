import { pgTable, text, serial, timestamp, boolean, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const travelOffersTable = pgTable("travel_offers", {
  id: serial("id").primaryKey(),
  destination: text("destination").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  provider: text("provider").notNull(),
  offerType: text("offer_type").notNull(),
  travelType: text("travel_type").notNull().default("familia"),
  duration: integer("duration").notNull(),
  hotel: text("hotel"),
  hotelCategory: integer("hotel_category"),
  region: text("region").notNull(),
  link: text("link").notNull(),
  validUntil: text("valid_until"),
  isValid: boolean("is_valid").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTravelOfferSchema = createInsertSchema(travelOffersTable).omit({ id: true, createdAt: true });
export type InsertTravelOffer = z.infer<typeof insertTravelOfferSchema>;
export type TravelOffer = typeof travelOffersTable.$inferSelect;
