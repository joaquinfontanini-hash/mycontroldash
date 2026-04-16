import { db, travelLocationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { TRAVEL_LOCATIONS } from "../routes/travel.js";

function uid() {
  return crypto.randomUUID();
}

export async function seedTravelLocationsIfNeeded(): Promise<void> {
  try {
    const [{ count }] = await db.select({ count: sql<string>`count(*)` }).from(travelLocationsTable);
    const total = Number(count ?? 0);

    if (total >= TRAVEL_LOCATIONS.length) {
      logger.info({ total, expected: TRAVEL_LOCATIONS.length }, "Travel locations already up to date, skipping seed");
      return;
    }

    logger.info({ total, expected: TRAVEL_LOCATIONS.length }, "Travel locations catalog outdated — re-seeding...");
    await db.delete(travelLocationsTable);
    await db.insert(travelLocationsTable).values(TRAVEL_LOCATIONS.map(l => ({ id: uid(), ...l })));
    logger.info({ count: TRAVEL_LOCATIONS.length }, "Travel locations catalog seeded successfully");
  } catch (err) {
    logger.error({ err }, "Failed to seed travel locations — autocomplete may be empty");
  }
}
