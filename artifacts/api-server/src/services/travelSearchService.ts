import { eq, and, isNull, lt, or, sql as drizzleSql } from "drizzle-orm";
import {
  db,
  travelLocationsTable,
  travelSearchProfilesTable,
  travelSearchResultsTable,
  travelApiQuotasTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const QUOTA_LIMITS: Record<string, number> = { serpapi: 100, amadeus: 2000 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function uid(): string {
  return crypto.randomUUID();
}

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return (parseInt(match?.[1] ?? "0") * 60) + parseInt(match?.[2] ?? "0");
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

function normalizedCurrency(currency: string): string {
  return currency === "ARS" ? "USD" : currency;
}

function generateDepartureDates(profile: typeof travelSearchProfilesTable.$inferSelect): string[] {
  const from = profile.departureDateFrom
    ? new Date(profile.departureDateFrom + "T12:00:00")
    : new Date(Date.now() + 14 * 86400000);
  const to = profile.departureDateTo
    ? new Date(profile.departureDateTo + "T12:00:00")
    : new Date(Date.now() + 90 * 86400000);
  const mid = new Date((from.getTime() + to.getTime()) / 2);
  const dates: string[] = [from.toISOString().split("T")[0]!];
  const midStr = mid.toISOString().split("T")[0]!;
  if (midStr !== dates[0]) dates.push(midStr);
  return dates;
}

function getDestinations(profile: typeof travelSearchProfilesTable.$inferSelect): Array<{ label: string; code: string | null; country: string; region: string }> {
  if (profile.destinationMode === "specific" || profile.destinationMode === "mixed") {
    return (profile.destinationsJson as Array<{ label: string; code?: string | null; country?: string; region?: string }> | null ?? [])
      .map(d => ({ label: d.label, code: d.code ?? null, country: d.country ?? "", region: d.region ?? "" }));
  }
  return [];
}

// ── Quota management ──────────────────────────────────────────────────────────

export async function canCallApi(apiName: string): Promise<boolean> {
  const month = getCurrentMonth();
  const rows = await db
    .select()
    .from(travelApiQuotasTable)
    .where(and(eq(travelApiQuotasTable.apiName, apiName), eq(travelApiQuotasTable.periodMonth, month)))
    .limit(1);

  if (rows.length === 0) {
    await db.insert(travelApiQuotasTable).values({
      id: uid(),
      apiName,
      periodMonth: month,
      callsUsed: 0,
      callsLimit: QUOTA_LIMITS[apiName] ?? 100,
    }).onConflictDoNothing();
    return true;
  }

  const quota = rows[0]!;
  return (quota.callsUsed ?? 0) < quota.callsLimit;
}

export async function incrementQuota(apiName: string): Promise<void> {
  const month = getCurrentMonth();
  await db
    .update(travelApiQuotasTable)
    .set({
      callsUsed: drizzleSql`COALESCE(calls_used, 0) + 1`,
      lastCallAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(travelApiQuotasTable.apiName, apiName), eq(travelApiQuotasTable.periodMonth, month)));
}

export async function getApiQuotas(): Promise<Record<string, unknown>> {
  const month = getCurrentMonth();
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(1, daysInMonth - today.getDate() + 1);

  const result: Record<string, unknown> = {};

  for (const apiName of ["serpapi", "amadeus"]) {
    let rows = await db
      .select()
      .from(travelApiQuotasTable)
      .where(and(eq(travelApiQuotasTable.apiName, apiName), eq(travelApiQuotasTable.periodMonth, month)))
      .limit(1);

    if (rows.length === 0) {
      await db.insert(travelApiQuotasTable).values({
        id: uid(),
        apiName,
        periodMonth: month,
        callsUsed: 0,
        callsLimit: QUOTA_LIMITS[apiName] ?? 100,
      }).onConflictDoNothing();
      rows = await db
        .select()
        .from(travelApiQuotasTable)
        .where(and(eq(travelApiQuotasTable.apiName, apiName), eq(travelApiQuotasTable.periodMonth, month)))
        .limit(1);
    }

    const quota = rows[0];
    if (!quota) continue;

    const callsUsed = quota.callsUsed ?? 0;
    const callsLimit = quota.callsLimit;
    const callsRemaining = callsLimit - callsUsed;
    const percentUsed = callsLimit > 0 ? Math.round((callsUsed / callsLimit) * 100) : 0;
    const dailyBudgetRemaining = Math.floor(callsRemaining / daysRemaining);

    result[apiName] = {
      callsUsed,
      callsLimit,
      callsRemaining: Math.max(0, callsRemaining),
      percentUsed,
      lastCallAt: quota.lastCallAt,
      dailyBudgetRemaining: Math.max(0, dailyBudgetRemaining),
      status: percentUsed >= 100 ? "exhausted" : percentUsed >= 80 ? "warning" : "ok",
    };
  }

  return result;
}

// ── Amadeus OAuth token cache ──────────────────────────────────────────────────

let amadeusTokenCache: { value: string; expiresAt: number } | null = null;

async function getAmadeusToken(): Promise<string> {
  if (amadeusTokenCache && Date.now() < amadeusTokenCache.expiresAt) {
    return amadeusTokenCache.value;
  }
  const base = process.env["AMADEUS_ENV"] === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

  const res = await fetch(`${base}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${process.env["AMADEUS_CLIENT_ID"] ?? ""}&client_secret=${process.env["AMADEUS_CLIENT_SECRET"] ?? ""}`,
  });
  const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!data.access_token) throw new Error(`Amadeus auth failed: ${data.error_description ?? "sin token"}`);

  amadeusTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 1800) - 60) * 1000,
  };
  return amadeusTokenCache.value;
}

// ── SerpAPI — Google Flights ───────────────────────────────────────────────────

type Destination = { label: string; code: string | null; country: string; region: string };
type Profile = typeof travelSearchProfilesTable.$inferSelect;
type InsertResult = typeof travelSearchResultsTable.$inferInsert;

export async function searchSerpApiFlights(
  profile: Profile,
  dest: Destination,
  departureDate: string,
): Promise<InsertResult[]> {
  const serpApiKey = process.env["SERPAPI_KEY"];
  if (!serpApiKey) throw new Error("SERPAPI_KEY no configurada");
  if (!dest.code) throw new Error(`Destino ${dest.label} sin código IATA`);
  const origin = profile.originJson as { code?: string | null; label: string };
  if (!origin.code) throw new Error("Origen sin código IATA");

  const currency = normalizedCurrency(profile.currency);
  const params = new URLSearchParams({
    engine: "google_flights",
    api_key: serpApiKey,
    departure_id: origin.code,
    arrival_id: dest.code,
    outbound_date: departureDate,
    adults: String(profile.travelersCount ?? 1),
    currency,
    hl: "es",
    type: profile.directFlightOnly ? "2" : "1",
  });

  if (profile.minDays) {
    params.set("return_date", addDays(departureDate, profile.minDays));
  }

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  const data = await res.json() as {
    error?: string;
    best_flights?: Array<{ flights?: Array<{ airline?: string; departure_airport?: { id?: string; time?: string }; arrival_airport?: { id?: string; time?: string }; duration?: number }>; price?: number; total_duration?: number }>;
    other_flights?: typeof this["best_flights"];
    search_metadata?: { google_flights_url?: string };
  };

  if (data.error) throw new Error(`SerpAPI: ${data.error}`);

  const flights = [...(data.best_flights ?? []), ...(data.other_flights ?? [])].slice(0, 3);
  const externalUrl = data.search_metadata?.google_flights_url ?? null;

  return flights.map((flight, i) => {
    const seg = flight.flights?.[0];
    return {
      id: uid(),
      searchProfileId: profile.id,
      userId: profile.userId,
      source: "Google Flights",
      apiSource: "serpapi",
      searchType: "vuelo",
      externalId: `${profile.id}:serpapi:${dest.code}:${departureDate}:${i}`,
      externalUrl,
      title: `Vuelo ${origin.code} → ${dest.code} — ${seg?.airline ?? "Aerolínea"}`,
      originJson: profile.originJson,
      destinationJson: dest,
      region: dest.region,
      country: dest.country,
      price: String(Math.round(flight.price ?? 0)),
      currency,
      travelersCount: profile.travelersCount ?? 1,
      airline: seg?.airline ?? null,
      stops: Math.max(0, (flight.flights?.length ?? 1) - 1),
      durationMinutes: flight.total_duration ?? null,
      departureDate: seg?.departure_airport?.time?.split(" ")[0] ?? departureDate,
      departureTime: seg?.departure_airport?.time?.split(" ")[1] ?? null,
      arrivalTime: seg?.arrival_airport?.time?.split(" ")[1] ?? null,
      confidenceScore: 95,
      validationStatus: "validated",
      status: "new",
      rawPayloadJson: { simulated: false, source: "serpapi", runAt: new Date().toISOString() },
    } satisfies InsertResult;
  });
}

// ── Amadeus — Flights ─────────────────────────────────────────────────────────

export async function searchAmadeusFlights(
  profile: Profile,
  dest: Destination,
  departureDate: string,
): Promise<InsertResult[]> {
  if (!dest.code) throw new Error(`Destino ${dest.label} sin código IATA`);
  const origin = profile.originJson as { code?: string | null; label: string };
  if (!origin.code) throw new Error("Origen sin código IATA");

  const token = await getAmadeusToken();
  const base = process.env["AMADEUS_ENV"] === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
  const currency = normalizedCurrency(profile.currency);

  const params = new URLSearchParams({
    originLocationCode: origin.code,
    destinationLocationCode: dest.code,
    departureDate,
    adults: String(profile.travelersCount ?? 1),
    max: "3",
    currencyCode: currency,
    nonStop: profile.directFlightOnly ? "true" : "false",
  });
  if (profile.minDays) params.set("returnDate", addDays(departureDate, profile.minDays));

  const res = await fetch(`${base}/v2/shopping/flight-offers?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as {
    errors?: unknown[];
    data?: Array<{
      id?: string;
      price?: { total?: string; currency?: string };
      itineraries?: Array<{
        duration?: string;
        segments?: Array<{ carrierCode?: string; departure?: { iataCode?: string; at?: string }; arrival?: { iataCode?: string; at?: string } }>;
      }>;
    }>;
    dictionaries?: { carriers?: Record<string, string> };
  };

  if (data.errors) throw new Error(`Amadeus flights: ${JSON.stringify(data.errors)}`);

  return (data.data ?? []).slice(0, 3).map((offer, i) => {
    const itinerary = offer.itineraries?.[0];
    const segment = itinerary?.segments?.[0];
    const airlineCode = segment?.carrierCode ?? "";
    const airlineName = data.dictionaries?.carriers?.[airlineCode] ?? airlineCode;

    return {
      id: uid(),
      searchProfileId: profile.id,
      userId: profile.userId,
      source: "Amadeus",
      apiSource: "amadeus",
      searchType: "vuelo",
      externalId: `${profile.id}:amadeus:flight:${dest.code}:${departureDate}:${i}`,
      externalUrl: `https://www.amadeus.com/en/search?originLocationCode=${origin.code}&destinationLocationCode=${dest.code}&departureDate=${departureDate}&adults=${profile.travelersCount ?? 1}`,
      title: `Vuelo ${origin.code} → ${dest.code} — ${airlineName}`,
      originJson: profile.originJson,
      destinationJson: dest,
      region: dest.region,
      country: dest.country,
      price: String(Math.round(parseFloat(offer.price?.total ?? "0"))),
      currency: offer.price?.currency ?? currency,
      travelersCount: profile.travelersCount ?? 1,
      airline: airlineName || null,
      stops: Math.max(0, (itinerary?.segments?.length ?? 1) - 1),
      durationMinutes: itinerary?.duration ? parseDuration(itinerary.duration) : null,
      departureDate: segment?.departure?.at?.split("T")[0] ?? departureDate,
      departureTime: segment?.departure?.at?.split("T")[1]?.slice(0, 5) ?? null,
      arrivalTime: segment?.arrival?.at?.split("T")[1]?.slice(0, 5) ?? null,
      confidenceScore: 92,
      validationStatus: "validated",
      status: "new",
      rawPayloadJson: { simulated: false, source: "amadeus", offerId: offer.id, runAt: new Date().toISOString() },
    } satisfies InsertResult;
  });
}

// ── Amadeus — Hotel packages ───────────────────────────────────────────────────

export async function searchAmadeusPackages(
  profile: Profile,
  dest: Destination,
  departureDate: string,
): Promise<InsertResult[]> {
  if (!dest.code) throw new Error(`Destino ${dest.label} sin código IATA`);
  const origin = profile.originJson as { code?: string | null; label: string };

  const token = await getAmadeusToken();
  const base = process.env["AMADEUS_ENV"] === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
  const nights = profile.minDays ? profile.minDays - 1 : 4;
  const checkOut = addDays(departureDate, nights);
  const currency = normalizedCurrency(profile.currency);

  const hotelParams = new URLSearchParams({
    cityCode: dest.code,
    checkInDate: departureDate,
    checkOutDate: checkOut,
    adults: String(profile.travelersCount ?? 1),
    max: "3",
  });
  if (profile.hotelMinStars) {
    const stars: number[] = [];
    for (let i = profile.hotelMinStars; i <= 5; i++) stars.push(i);
    hotelParams.set("ratings", stars.join(","));
  }

  const hotelRes = await fetch(`${base}/v3/shopping/hotel-offers?${hotelParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const hotelData = await hotelRes.json() as {
    errors?: unknown[];
    data?: Array<{
      hotel?: { hotelId?: string; name?: string; rating?: string };
      offers?: Array<{ price?: { total?: string; currency?: string }; boardType?: string }>;
    }>;
  };

  if (hotelData.errors) throw new Error(`Amadeus hotels: ${JSON.stringify(hotelData.errors)}`);

  // Try to get a reference flight price
  let flightPrice = 0;
  let flightAirline: string | null = null;
  try {
    const flights = await searchAmadeusFlights(profile, dest, departureDate);
    flightPrice = parseFloat(flights[0]?.price ?? "0");
    flightAirline = flights[0]?.airline ?? null;
  } catch (_) { /* best effort */ }

  return (hotelData.data ?? []).slice(0, 2).map((hotel, i) => {
    const offer = hotel.offers?.[0];
    const hotelPrice = parseFloat(offer?.price?.total ?? "0");
    const totalPrice = Math.round(hotelPrice + flightPrice);

    return {
      id: uid(),
      searchProfileId: profile.id,
      userId: profile.userId,
      source: "Amadeus (Paquete)",
      apiSource: "amadeus",
      searchType: "paquete",
      externalId: `${profile.id}:amadeus:pkg:${dest.code}:${hotel.hotel?.hotelId ?? String(i)}:${departureDate}`,
      externalUrl: `https://www.amadeus.com/en/hotels?cityCode=${dest.code}&checkIn=${departureDate}&checkOut=${checkOut}&adults=${profile.travelersCount ?? 1}`,
      title: `Paquete ${dest.label} — ${hotel.hotel?.name ?? "Hotel"}`,
      originJson: profile.originJson,
      destinationJson: dest,
      region: dest.region,
      country: dest.country,
      price: String(totalPrice),
      currency: offer?.price?.currency ?? currency,
      days: nights + 1,
      nights,
      travelersCount: profile.travelersCount ?? 1,
      airline: flightAirline,
      hotelName: hotel.hotel?.name ?? null,
      hotelStars: hotel.hotel?.rating ? parseInt(hotel.hotel.rating) : null,
      mealPlan: offer?.boardType ?? null,
      departureDate,
      returnDate: checkOut,
      confidenceScore: 88,
      validationStatus: "validated",
      status: "new",
      rawPayloadJson: { simulated: false, source: "amadeus", hotelId: hotel.hotel?.hotelId, runAt: new Date().toISOString() },
    } satisfies InsertResult;
  });
}

// ── Simulación fallback (cuando no hay API keys configuradas) ─────────────────

const SIM_TEMPLATES = [
  { title: "Paquete todo incluido",        airline: "Aerolíneas Argentinas", hotel: "Hotel Loi Suites",    hotelStars: 4, priceMin: 0.80, priceMax: 0.95, daysMin: 5, daysMax: 7,  meal: "todo incluido" },
  { title: "Escapada vuelo + hotel",        airline: "LATAM",                 hotel: "Ibis Hotel",           hotelStars: 3, priceMin: 0.65, priceMax: 0.80, daysMin: 3, daysMax: 5  },
  { title: "Oferta flash — cupos limitados",airline: "Flybondi",              hotel: "Apart Hotel Premium",  hotelStars: 3, priceMin: 0.55, priceMax: 0.75, daysMin: 4, daysMax: 6  },
  { title: "Paquete familiar",              airline: null,                    hotel: "Resort & Spa",         hotelStars: 5, priceMin: 0.90, priceMax: 1.10, daysMin: 7, daysMax: 10, meal: "media pensión" },
  { title: "Tarifa corporativa especial",   airline: "American Airlines",     hotel: "NH Collection",        hotelStars: 4, priceMin: 0.70, priceMax: 0.85, daysMin: 2, daysMax: 4  },
];

function randomBetween(a: number, b: number) { return a + Math.random() * (b - a); }

function simulateResults(profile: Profile, dest: Destination, departureDate: string): InsertResult[] {
  const budget = Number(profile.maxBudget);
  const tolerance = profile.tolerancePercent ?? 20;
  const maxWithTol = budget * (1 + tolerance / 100);
  const now = new Date();
  const results: InsertResult[] = [];

  for (let i = 0; i < 3; i++) {
    const tmpl = SIM_TEMPLATES[i % SIM_TEMPLATES.length]!;
    const days = Math.round(randomBetween(profile.minDays ?? tmpl.daysMin, profile.maxDays ?? tmpl.daysMax));
    const price = Math.round(budget * randomBetween(tmpl.priceMin, tmpl.priceMax));
    const cappedPrice = Math.min(price, Math.round(maxWithTol));
    const score = price <= budget ? Math.round(randomBetween(75, 98)) : Math.round(randomBetween(55, 74));
    const origin = profile.originJson as { code?: string | null; label: string };

    results.push({
      id: uid(),
      searchProfileId: profile.id,
      userId: profile.userId,
      source: "Simulación",
      apiSource: null,
      searchType: "vuelo",
      externalId: `${profile.id}:sim:${tmpl.title}:${dest.label}:${i}`,
      externalUrl: null,
      title: `${tmpl.title} — ${dest.label}`,
      originJson: profile.originJson,
      destinationJson: dest,
      region: dest.region,
      country: dest.country,
      price: String(cappedPrice),
      currency: profile.currency,
      priceOriginal: price > budget ? String(price) : null,
      days,
      nights: days - 1,
      travelersCount: profile.travelersCount ?? 1,
      airline: tmpl.airline,
      hotelName: tmpl.hotel,
      hotelStars: tmpl.hotelStars != null && (profile.hotelMinStars == null || tmpl.hotelStars >= profile.hotelMinStars) ? tmpl.hotelStars : null,
      mealPlan: tmpl.meal ?? profile.mealPlan ?? null,
      departureDate: addDays(now.toISOString().split("T")[0]!, Math.round(randomBetween(14, 90))),
      returnDate: addDays(now.toISOString().split("T")[0]!, Math.round(randomBetween(20, 100))),
      confidenceScore: score,
      validationStatus: score >= 75 ? "validated" : "weak_match",
      status: "new",
      rawPayloadJson: { simulated: true, profileId: profile.id, runAt: now.toISOString() },
    } satisfies InsertResult);
  }
  return results;
}

// ── runSearchProfile — main entry point ──────────────────────────────────────

export interface RunResult {
  ok: boolean;
  resultsFound: number;
  skipped: number;
  errors: string[];
  mode: "real" | "simulated";
}

export async function runSearchProfile(profileId: string, userId: number): Promise<RunResult> {
  const rows = await db
    .select()
    .from(travelSearchProfilesTable)
    .where(and(eq(travelSearchProfilesTable.id, profileId), eq(travelSearchProfilesTable.userId, userId)))
    .limit(1);

  const profile = rows[0];
  if (!profile) throw new Error("Perfil no encontrado");

  // Rate limit: 30 min entre ejecuciones
  if (profile.lastRunAt) {
    const minsSince = (Date.now() - new Date(profile.lastRunAt).getTime()) / 60000;
    if (minsSince < 30) {
      throw new Error(`Este perfil se ejecutó hace ${Math.round(minsSince)} min. Esperá ${Math.round(30 - minsSince)} min más.`);
    }
  }

  const searchType = profile.searchType ?? "ambos";
  const destinations = getDestinations(profile);
  const departureDates = generateDepartureDates(profile);
  const allResults: InsertResult[] = [];
  const errors: string[] = [];

  const hasSerpApiKey = !!process.env["SERPAPI_KEY"];
  const hasAmadeusKeys = !!(process.env["AMADEUS_CLIENT_ID"] && process.env["AMADEUS_CLIENT_SECRET"]);
  const useRealApis = hasSerpApiKey || hasAmadeusKeys;

  if (useRealApis) {
    for (const dest of destinations.slice(0, 3)) {
      for (const date of departureDates.slice(0, 1)) {

        // SerpAPI — vuelos
        if ((searchType === "vuelos" || searchType === "ambos") && hasSerpApiKey) {
          if (await canCallApi("serpapi")) {
            try {
              const res = await searchSerpApiFlights(profile, dest, date);
              allResults.push(...res);
              await incrementQuota("serpapi");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`SerpAPI: ${msg}`);
              logger.warn({ err }, "SerpAPI search failed");
            }
          } else {
            errors.push("SerpAPI: cuota mensual agotada");
          }
        }

        // Amadeus — vuelos
        if ((searchType === "vuelos" || searchType === "ambos") && hasAmadeusKeys) {
          if (await canCallApi("amadeus")) {
            try {
              const res = await searchAmadeusFlights(profile, dest, date);
              allResults.push(...res);
              await incrementQuota("amadeus");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`Amadeus vuelos: ${msg}`);
              logger.warn({ err }, "Amadeus flights search failed");
            }
          } else {
            errors.push("Amadeus: cuota mensual agotada");
          }
        }

        // Amadeus — paquetes
        if ((searchType === "paquetes" || searchType === "ambos") && hasAmadeusKeys) {
          if (await canCallApi("amadeus")) {
            try {
              const res = await searchAmadeusPackages(profile, dest, date);
              allResults.push(...res);
              await incrementQuota("amadeus");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`Amadeus paquetes: ${msg}`);
              logger.warn({ err }, "Amadeus packages search failed");
            }
          }
        }

        // Pausa entre destinos
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } else {
    // Sin API keys → simulación
    for (const dest of destinations.slice(0, 3)) {
      const date = departureDates[0]!;
      allResults.push(...simulateResults(profile, dest, date));
    }
  }

  // Deduplicar por externalId
  const existingRows = await db
    .select({ externalId: travelSearchResultsTable.externalId })
    .from(travelSearchResultsTable)
    .where(eq(travelSearchResultsTable.searchProfileId, profileId));
  const existingIds = new Set(existingRows.map(r => r.externalId).filter(Boolean));
  const toInsert = allResults.filter(r => r.externalId && !existingIds.has(r.externalId));

  if (toInsert.length > 0) {
    await db.insert(travelSearchResultsTable).values(toInsert);
  }

  // Actualizar metadata del perfil
  const now = new Date();
  await db
    .update(travelSearchProfilesTable)
    .set({
      lastRunAt: now,
      lastRunStatus: errors.length === 0 || toInsert.length > 0 ? "ok" : "error",
      lastRunSummaryJson: {
        count: toInsert.length,
        skipped: allResults.length - toInsert.length,
        errors,
        mode: useRealApis ? "real" : "simulated",
        ranAt: now.toISOString(),
      },
      updatedAt: now,
    })
    .where(eq(travelSearchProfilesTable.id, profileId));

  return {
    ok: true,
    resultsFound: toInsert.length,
    skipped: allResults.length - toInsert.length,
    errors,
    mode: useRealApis ? "real" : "simulated",
  };
}

// ── Scheduler helper — run all due profiles ───────────────────────────────────

export async function runDueProfiles(): Promise<void> {
  const canSerp = await canCallApi("serpapi");
  const canAmadeus = await canCallApi("amadeus");
  if (!canSerp && !canAmadeus) {
    logger.info("[TravelScheduler] Cuotas mensuales agotadas — skip");
    return;
  }

  const profiles = await db
    .select()
    .from(travelSearchProfilesTable)
    .where(
      and(
        eq(travelSearchProfilesTable.isActive, true),
        or(
          isNull(travelSearchProfilesTable.lastRunAt),
          lt(
            travelSearchProfilesTable.lastRunAt,
            drizzleSql`now() - (refresh_frequency_hours || ' hours')::interval`,
          ),
        ),
      ),
    );

  logger.info({ count: profiles.length }, "[TravelScheduler] Perfiles a actualizar");

  for (const profile of profiles) {
    try {
      // Bypass rate limit for scheduler: temporarily allow if scheduler is calling
      const result = await runSearchProfileForScheduler(profile);
      logger.info({ name: profile.name, found: result.resultsFound }, "[TravelScheduler] Perfil ejecutado");
    } catch (err) {
      logger.error({ err, name: profile.name }, "[TravelScheduler] Error en perfil");
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

// Internal: bypasses the 30-min rate limit (scheduler has its own frequency check)
async function runSearchProfileForScheduler(profile: typeof travelSearchProfilesTable.$inferSelect): Promise<RunResult> {
  const searchType = profile.searchType ?? "ambos";
  const destinations = getDestinations(profile);
  const departureDates = generateDepartureDates(profile);
  const allResults: InsertResult[] = [];
  const errors: string[] = [];

  const hasSerpApiKey = !!process.env["SERPAPI_KEY"];
  const hasAmadeusKeys = !!(process.env["AMADEUS_CLIENT_ID"] && process.env["AMADEUS_CLIENT_SECRET"]);
  const useRealApis = hasSerpApiKey || hasAmadeusKeys;

  if (useRealApis) {
    for (const dest of destinations.slice(0, 3)) {
      for (const date of departureDates.slice(0, 1)) {
        if ((searchType === "vuelos" || searchType === "ambos") && hasSerpApiKey && await canCallApi("serpapi")) {
          try { allResults.push(...await searchSerpApiFlights(profile, dest, date)); await incrementQuota("serpapi"); } catch (e) { errors.push(String(e)); }
        }
        if ((searchType === "vuelos" || searchType === "ambos") && hasAmadeusKeys && await canCallApi("amadeus")) {
          try { allResults.push(...await searchAmadeusFlights(profile, dest, date)); await incrementQuota("amadeus"); } catch (e) { errors.push(String(e)); }
        }
        if ((searchType === "paquetes" || searchType === "ambos") && hasAmadeusKeys && await canCallApi("amadeus")) {
          try { allResults.push(...await searchAmadeusPackages(profile, dest, date)); await incrementQuota("amadeus"); } catch (e) { errors.push(String(e)); }
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } else {
    for (const dest of destinations.slice(0, 3)) {
      allResults.push(...simulateResults(profile, dest, departureDates[0]!));
    }
  }

  const existingRows = await db
    .select({ externalId: travelSearchResultsTable.externalId })
    .from(travelSearchResultsTable)
    .where(eq(travelSearchResultsTable.searchProfileId, profile.id));
  const existingIds = new Set(existingRows.map(r => r.externalId).filter(Boolean));
  const toInsert = allResults.filter(r => r.externalId && !existingIds.has(r.externalId));

  if (toInsert.length > 0) {
    await db.insert(travelSearchResultsTable).values(toInsert);
  }

  const now = new Date();
  await db.update(travelSearchProfilesTable).set({
    lastRunAt: now, lastRunStatus: "ok",
    lastRunSummaryJson: { count: toInsert.length, skipped: allResults.length - toInsert.length, errors, ranAt: now.toISOString() },
    updatedAt: now,
  }).where(eq(travelSearchProfilesTable.id, profile.id));

  return { ok: true, resultsFound: toInsert.length, skipped: allResults.length - toInsert.length, errors, mode: useRealApis ? "real" : "simulated" };
}
