import { db, weatherSnapshotsTable, appSettingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { fetchOpenMeteoForecast, type OpenMeteoDay } from "../adapters/openmeteo.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";
import { logger } from "../lib/logger.js";

const DEFAULT_LAT = "-38.9516";
const DEFAULT_LON = "-68.0591";
const DEFAULT_LOCATION = "Neuquén, Argentina";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SOURCE_NAME = "OpenMeteo";

async function getLocationSettings() {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return {
    lat: settings?.weatherLatitude ?? DEFAULT_LAT,
    lon: settings?.weatherLongitude ?? DEFAULT_LON,
    location: settings?.weatherLocation ?? DEFAULT_LOCATION,
  };
}

async function getLatestSnapshot(location: string) {
  const [cached] = await db
    .select()
    .from(weatherSnapshotsTable)
    .where(eq(weatherSnapshotsTable.location, location))
    .orderBy(desc(weatherSnapshotsTable.fetchedAt))
    .limit(1);
  return cached ?? null;
}

export async function getWeatherForecast(): Promise<{
  forecast: OpenMeteoDay[];
  location: string;
  fetchedAt: string;
  source: "live" | "cache";
}> {
  const { lat, lon, location } = await getLocationSettings();
  const cached = await getLatestSnapshot(location);
  const now = Date.now();
  const cacheAge = cached ? now - new Date(cached.fetchedAt).getTime() : Infinity;

  // Serve fresh cache if within TTL
  if (cached && cacheAge < CACHE_TTL_MS) {
    return { forecast: cached.forecast as OpenMeteoDay[], location, fetchedAt: cached.fetchedAt.toISOString(), source: "cache" };
  }

  // Check circuit breaker — if open, fall back to stale cache or mock
  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn({ SOURCE_NAME }, "weather.service: circuit open, using stale cache");
    const stale = cached ?? null;
    if (stale) return { forecast: stale.forecast as OpenMeteoDay[], location, fetchedAt: stale.fetchedAt.toISOString(), source: "cache" };
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" };
  }

  try {
    const forecast = await withSyncLog("weather", async () => {
      const data = await fetchOpenMeteoForecast(lat, lon, 3);
      return { count: data.length, result: data };
    });

    await db.insert(weatherSnapshotsTable).values({ location, latitude: lat, longitude: lon, forecast: forecast as any });
    await recordSuccess(SOURCE_NAME);

    return { forecast, location, fetchedAt: new Date().toISOString(), source: "live" };
  } catch (err) {
    await recordFailure(SOURCE_NAME);
    logger.error({ err }, "Weather fetch failed, trying cache fallback");

    if (cached) return { forecast: cached.forecast as OpenMeteoDay[], location, fetchedAt: cached.fetchedAt.toISOString(), source: "cache" };
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" };
  }
}

export async function refreshWeather() {
  const { lat, lon, location } = await getLocationSettings();

  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn("weather.service: circuit open, skipping refresh");
    const cached = await getLatestSnapshot(location);
    if (cached) return { forecast: cached.forecast as OpenMeteoDay[], location, fetchedAt: cached.fetchedAt.toISOString(), source: "cache" as const };
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" as const };
  }

  try {
    const forecast = await withSyncLog("weather", async () => {
      const data = await fetchOpenMeteoForecast(lat, lon, 3);
      return { count: data.length, result: data };
    });

    await db.insert(weatherSnapshotsTable).values({ location, latitude: lat, longitude: lon, forecast: forecast as any });
    await recordSuccess(SOURCE_NAME);

    return { forecast, location, fetchedAt: new Date().toISOString(), source: "live" as const };
  } catch (err) {
    await recordFailure(SOURCE_NAME);
    logger.error({ err }, "refreshWeather failed");
    throw err;
  }
}

function getMockForecast(): OpenMeteoDay[] {
  const today = new Date();
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  return [
    {
      date: today.toISOString().split("T")[0] ?? "",
      dayName: "Hoy",
      condition: "Parcialmente nublado",
      conditionIcon: "cloud-sun",
      tempMin: 8,
      tempMax: 18,
      rainProbability: 20,
      windSpeed: 25,
      windDirection: "NO",
      wmoCode: 2,
    },
    {
      date: new Date(today.getTime() + 86400000).toISOString().split("T")[0] ?? "",
      dayName: days[(today.getDay() + 1) % 7] ?? "Mañana",
      condition: "Soleado",
      conditionIcon: "sun",
      tempMin: 10,
      tempMax: 22,
      rainProbability: 5,
      windSpeed: 18,
      windDirection: "O",
      wmoCode: 1,
    },
    {
      date: new Date(today.getTime() + 172800000).toISOString().split("T")[0] ?? "",
      dayName: days[(today.getDay() + 2) % 7] ?? "Pasado",
      condition: "Lluvioso",
      conditionIcon: "cloud-rain",
      tempMin: 6,
      tempMax: 14,
      rainProbability: 75,
      windSpeed: 35,
      windDirection: "S",
      wmoCode: 61,
    },
  ];
}
