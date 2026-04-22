import { db, weatherSnapshotsTable, appSettingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { fetchOpenMeteoForecast, type OpenMeteoDay } from "../adapters/openmeteo.adapter.js";
import { withSyncLog }                               from "./sync.service.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";
import { logger }                                    from "../lib/logger.js";

// ── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_LAT      = "-38.9516";
const DEFAULT_LON      = "-68.0591";
const DEFAULT_LOCATION = "Neuquén, Argentina";
const CACHE_TTL_MS     = 2 * 60 * 60 * 1000; // 2 horas
const SOURCE_NAME      = "OpenMeteo";

// OpenMeteo es una API pública gratuita SIN autenticación.
// No hay API key que pueda filtrarse en logs.

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type WeatherResult = {
  forecast:  OpenMeteoDay[];
  location:  string;
  fetchedAt: string;
  source:    "live" | "cache";
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getLocationSettings(): Promise<{ lat: string; lon: string; location: string }> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return {
    lat:      settings?.weatherLatitude  ?? DEFAULT_LAT,
    lon:      settings?.weatherLongitude ?? DEFAULT_LON,
    location: settings?.weatherLocation  ?? DEFAULT_LOCATION,
  };
}

async function getLatestSnapshot(
  location: string,
): Promise<typeof weatherSnapshotsTable.$inferSelect | null> {
  const [cached] = await db
    .select()
    .from(weatherSnapshotsTable)
    .where(eq(weatherSnapshotsTable.location, location))
    .orderBy(desc(weatherSnapshotsTable.fetchedAt))
    .limit(1);
  return cached ?? null;
}

// Convierte el JSON almacenado en DB al tipo correcto — elimina "forecast as any"
function parseForecastJson(raw: unknown): OpenMeteoDay[] {
  if (!Array.isArray(raw)) return getMockForecast();
  return raw as OpenMeteoDay[];
}

// ── getWeatherForecast ────────────────────────────────────────────────────────
// Sirve desde caché si los datos tienen menos de 2 horas.
// Si el circuit está abierto sirve la caché stale (o mock si no hay caché).
// NO llama a withSyncLog — la función pública solo lee/sirve datos.
// El log de sync se hace únicamente en refreshWeather().
export async function getWeatherForecast(): Promise<WeatherResult> {
  const { lat, lon, location } = await getLocationSettings();
  const cached  = await getLatestSnapshot(location);
  const cacheAge = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

  // Servir desde caché si está fresca
  if (cached && cacheAge < CACHE_TTL_MS) {
    return {
      forecast:  parseForecastJson(cached.forecast),
      location,
      fetchedAt: cached.fetchedAt.toISOString(),
      source:    "cache",
    };
  }

  // Circuit abierto: servir caché stale o mock
  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn({ source: SOURCE_NAME }, "weather.service: circuit abierto, sirviendo caché stale");
    if (cached) {
      return {
        forecast:  parseForecastJson(cached.forecast),
        location,
        fetchedAt: cached.fetchedAt.toISOString(),
        source:    "cache",
      };
    }
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" };
  }

  // Fetch en vivo — delegar a refreshWeather() para no duplicar lógica
  try {
    return await refreshWeather();
  } catch {
    // refreshWeather ya loguea el error — aquí solo caemos al fallback
    if (cached) {
      return {
        forecast:  parseForecastJson(cached.forecast),
        location,
        fetchedAt: cached.fetchedAt.toISOString(),
        source:    "cache",
      };
    }
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" };
  }
}

// ── refreshWeather ────────────────────────────────────────────────────────────
// Fuerza un fetch fresco desde la API.
// Registra en sync_logs vía withSyncLog — solo UNA vez (el original llamaba
// withSyncLog también desde getWeatherForecast, duplicando el log).
export async function refreshWeather(): Promise<WeatherResult> {
  const { lat, lon, location } = await getLocationSettings();

  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn({ source: SOURCE_NAME }, "weather.service: circuit abierto, saltando refresh");
    const cached = await getLatestSnapshot(location);
    if (cached) {
      return {
        forecast:  parseForecastJson(cached.forecast),
        location,
        fetchedAt: cached.fetchedAt.toISOString(),
        source:    "cache",
      };
    }
    return { forecast: getMockForecast(), location, fetchedAt: new Date().toISOString(), source: "cache" };
  }

  try {
    const forecast = await withSyncLog("weather", async () => {
      const data = await fetchOpenMeteoForecast(lat, lon, 3);
      return { count: data.length, result: data };
    });

    // forecast es OpenMeteoDay[] — tipado correcto sin "as any"
    await db.insert(weatherSnapshotsTable).values({
      location,
      latitude:  lat,
      longitude: lon,
      forecast:  forecast satisfies OpenMeteoDay[],
    });

    await recordSuccess(SOURCE_NAME);
    return { forecast, location, fetchedAt: new Date().toISOString(), source: "live" };
  } catch (err) {
    await recordFailure(SOURCE_NAME);
    // OpenMeteo no tiene API key — es seguro loguear el error completo
    logger.error({ err, source: SOURCE_NAME }, "weather.service: fetch falló");
    throw err; // relanzar — el caller (getWeatherForecast) maneja el fallback
  }
}

// ── getMockForecast ───────────────────────────────────────────────────────────
// Datos de fallback cuando no hay caché y la API no responde.
// Solo se usa cuando el circuit está abierto Y no hay snapshot en DB.
function getMockForecast(): OpenMeteoDay[] {
  const today = new Date();
  const days  = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  return [
    {
      date:            today.toISOString().slice(0, 10),
      dayName:         "Hoy",
      condition:       "Parcialmente nublado",
      conditionIcon:   "cloud-sun",
      tempMin:         8,
      tempMax:         18,
      rainProbability: 20,
      windSpeed:       25,
      windDirection:   "NO",
      wmoCode:         2,
    },
    {
      date:            new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10),
      dayName:         days[(today.getDay() + 1) % 7] ?? "Mañana",
      condition:       "Soleado",
      conditionIcon:   "sun",
      tempMin:         10,
      tempMax:         22,
      rainProbability: 5,
      windSpeed:       18,
      windDirection:   "O",
      wmoCode:         1,
    },
    {
      date:            new Date(today.getTime() + 172_800_000).toISOString().slice(0, 10),
      dayName:         days[(today.getDay() + 2) % 7] ?? "Pasado",
      condition:       "Lluvioso",
      conditionIcon:   "cloud-rain",
      tempMin:         6,
      tempMax:         14,
      rainProbability: 75,
      windSpeed:       35,
      windDirection:   "S",
      wmoCode:         61,
    },
  ];
}
