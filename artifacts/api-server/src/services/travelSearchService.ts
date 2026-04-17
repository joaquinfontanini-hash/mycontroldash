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

// FIX 1 — tipo de cambio USD → ARS en tiempo real
async function getUsdToArsRate(): Promise<number> {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await res.json() as { rates?: Record<string, number> };
    return data.rates?.["ARS"] ?? 1200;
  } catch {
    return 1200;
  }
}

// MEJORA 3 — Rango de fechas con rotación semanal para rangos largos
function generateDepartureDates(profile: typeof travelSearchProfilesTable.$inferSelect): string[] {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0]!;

  const from = profile.departureDateFrom
    ? new Date(profile.departureDateFrom + "T12:00:00")
    : new Date(Date.now() + 14 * 86400000);
  const to = profile.departureDateTo
    ? new Date(profile.departureDateTo + "T12:00:00")
    : new Date(Date.now() + 60 * 86400000);

  // No buscar fechas pasadas
  const effectiveFrom = from < now ? now : from;
  if (effectiveFrom > to) return [];

  const diffDays = Math.round((to.getTime() - effectiveFrom.getTime()) / 86400000);
  const dates: string[] = [];

  if (diffDays <= 14) {
    // Rango corto (≤2 semanas): cada 2 días, máx 7
    for (let i = 0; i <= diffDays && dates.length < 7; i += 2) {
      const d = new Date(effectiveFrom);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]!);
    }
  } else if (diffDays <= 60) {
    // Rango medio (2 semanas–2 meses): cada semana, máx 8
    for (let i = 0; i <= diffDays && dates.length < 8; i += 7) {
      const d = new Date(effectiveFrom);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]!);
    }
  } else {
    // Rango largo (>2 meses): 1 fecha por mes, rotando el día para cubrir distintas semanas
    const prevRunCount = (profile.lastRunSummaryJson as { runCount?: number } | null)?.runCount ?? 0;
    const dayOffset = (prevRunCount % 4) * 7; // rota: días 1, 8, 15, 22 del mes

    let current = new Date(effectiveFrom.getFullYear(), effectiveFrom.getMonth(), 1 + dayOffset);
    if (current < effectiveFrom) {
      // Si el offset cae antes del inicio, avanzar al mes siguiente
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1 + dayOffset);
    }

    while (current <= to && dates.length < 9) {
      if (current >= effectiveFrom) {
        dates.push(current.toISOString().split("T")[0]!);
      }
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1 + dayOffset);
    }
  }

  // Filtrar fechas pasadas
  return dates.filter(d => d >= todayStr);
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
  usdToArs: number = 1,
): Promise<InsertResult[]> {
  const serpApiKey = process.env["SERPAPI_KEY"];
  if (!serpApiKey) throw new Error("SERPAPI_KEY no configurada");
  if (!dest.code) throw new Error(`Destino ${dest.label} sin código IATA`);
  const origin = profile.originJson as { code?: string | null; label: string };
  if (!origin.code) throw new Error("Origen sin código IATA");

  const travelers = profile.travelersCount ?? 1;
  const profileCurrency = profile.currency ?? "ARS";
  const maxBudget = Number(profile.maxBudget ?? 0);
  const tolerancePct = profile.tolerancePercent ?? 20;
  const budgetWithTolerance = maxBudget * (1 + tolerancePct / 100);

  // type=1 siempre (ida y vuelta) — type=2 es one-way, no round-trip con escalas
  // Para vuelos sin escalas se usa stops=0, no type=2
  const minDays = profile.minDays ?? 3;
  const returnDate = addDays(departureDate, minDays);

  const params = new URLSearchParams({
    engine: "google_flights",
    api_key: serpApiKey,
    departure_id: origin.code,
    arrival_id: dest.code,
    outbound_date: departureDate,
    return_date: returnDate,
    adults: String(travelers),
    currency: "USD",
    hl: "es",
    type: "1",
  });

  if (profile.directFlightOnly) {
    params.set("stops", "0");
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
  const results: InsertResult[] = [];

  for (let i = 0; i < flights.length; i++) {
    const flight = flights[i]!;
    const seg = flight.flights?.[0];

    // Punto 2 — filtrar en backend si directFlightOnly: descartar vuelos con escalas o >180 min
    if (profile.directFlightOnly) {
      const flightLegs = flight.flights?.length ?? 1;
      const duration = flight.total_duration ?? 0;
      if (flightLegs > 1 || duration > 180) {
        logger.info(
          { legs: flightLegs, duration },
          "[SerpAPI] Vuelo con escala o duración excesiva descartado por directFlightOnly",
        );
        continue;
      }
    }

    // Punto 3 — SerpAPI devuelve flight.price como precio total del itinerario (todos los viajeros)
    const totalPriceUsd = flight.price ?? 0;
    const pricePerPersonUsd = travelers > 0 ? totalPriceUsd / travelers : totalPriceUsd;

    // FIX 1 — convertir a moneda del perfil para comparar con presupuesto
    const totalInProfileCurrency = profileCurrency === "ARS"
      ? totalPriceUsd * usdToArs
      : totalPriceUsd;
    const pricePerPersonInProfileCurrency = profileCurrency === "ARS"
      ? pricePerPersonUsd * usdToArs
      : pricePerPersonUsd;

    console.log('[Budget Check]', { priceUsd: flight.price, usdToArs, totalPriceArs: flight.price * travelers * usdToArs, budget: profile.maxBudget, tolerance: budgetWithTolerance });

    if (maxBudget > 0 && totalInProfileCurrency > budgetWithTolerance) {
      logger.info(
        { total: Math.round(totalInProfileCurrency), budget: Math.round(budgetWithTolerance), currency: profileCurrency },
        "[SerpAPI] Vuelo fuera de presupuesto — omitido",
      );
      continue;
    }

    results.push({
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
      price: String(Math.round(totalInProfileCurrency)),
      currency: profileCurrency,
      priceOriginal: String(totalPriceUsd),
      priceOriginalCurrency: "USD",
      pricePerPerson: String(Math.round(pricePerPersonInProfileCurrency)),
      exchangeRate: profileCurrency === "ARS" ? String(usdToArs) : null,
      travelersCount: travelers,
      airline: seg?.airline ?? null,
      stops: Math.max(0, (flight.flights?.length ?? 1) - 1),
      durationMinutes: flight.total_duration ?? null,
      nights: minDays,
      departureDate: seg?.departure_airport?.time?.split(" ")[0] ?? departureDate,
      returnDate,
      departureTime: seg?.departure_airport?.time?.split(" ")[1] ?? null,
      arrivalTime: seg?.arrival_airport?.time?.split(" ")[1] ?? null,
      confidenceScore: 95,
      validationStatus: "validated",
      status: "new",
      rawPayloadJson: { simulated: false, source: "serpapi", runAt: new Date().toISOString() },
    } satisfies InsertResult);
  }

  return results;
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

// ── runSearchProfile — main entry point ──────────────────────────────────────

export interface RunResult {
  ok: boolean;
  resultsFound: number;
  skipped: number;
  errors: string[];
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

  if (!hasSerpApiKey && !hasAmadeusKeys) {
    throw new Error("No hay APIs de búsqueda configuradas. Configurá SERPAPI_KEY o AMADEUS_CLIENT_ID/SECRET en las variables de entorno.");
  }

  // FIX 1 — obtener tipo de cambio una sola vez antes del loop
  const usdToArs = (profile.currency === "ARS" && hasSerpApiKey) ? await getUsdToArsRate() : 1;
  if (profile.currency === "ARS") {
    logger.info({ usdToArs }, "[Travel] Tipo de cambio USD/ARS obtenido");
  }

  logger.info({ dates: departureDates.length, destinations: destinations.length }, "[Travel] Iniciando búsqueda multi-fecha");

  for (const dest of destinations.slice(0, 2)) {
    for (const date of departureDates) {

      // SerpAPI — vuelos
      if ((searchType === "vuelos" || searchType === "ambos") && hasSerpApiKey) {
        if (await canCallApi("serpapi")) {
          try {
            const res = await searchSerpApiFlights(profile, dest, date, usdToArs);
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

      await new Promise(r => setTimeout(r, 500));
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
  const prevRunCount = (profile.lastRunSummaryJson as { runCount?: number } | null)?.runCount ?? 0;
  await db
    .update(travelSearchProfilesTable)
    .set({
      lastRunAt: now,
      lastRunStatus: toInsert.length > 0 ? "ok" : errors.length > 0 ? "error" : "ok",
      lastRunSummaryJson: {
        count: toInsert.length,
        skipped: allResults.length - toInsert.length,
        errors,
        runCount: prevRunCount + 1,
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
  };
}

// ── Scheduler helper — run all due profiles ───────────────────────────────────

export async function runDueProfiles(): Promise<void> {
  const hasSerpApiKey = !!process.env["SERPAPI_KEY"];
  const hasAmadeusKeys = !!(process.env["AMADEUS_CLIENT_ID"] && process.env["AMADEUS_CLIENT_SECRET"]);

  if (!hasSerpApiKey && !hasAmadeusKeys) {
    logger.info("[TravelScheduler] Sin API keys configuradas — skip");
    return;
  }

  const canSerp = hasSerpApiKey && await canCallApi("serpapi");
  const canAmadeus = hasAmadeusKeys && await canCallApi("amadeus");
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

  if (!hasSerpApiKey && !hasAmadeusKeys) {
    return { ok: false, resultsFound: 0, skipped: 0, errors: ["Sin API keys configuradas"] };
  }

  const usdToArs = (profile.currency === "ARS" && hasSerpApiKey) ? await getUsdToArsRate() : 1;

  for (const dest of destinations.slice(0, 2)) {
    for (const date of departureDates) {
      if ((searchType === "vuelos" || searchType === "ambos") && hasSerpApiKey && await canCallApi("serpapi")) {
        try { allResults.push(...await searchSerpApiFlights(profile, dest, date, usdToArs)); await incrementQuota("serpapi"); } catch (e) { errors.push(String(e)); }
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
  const prevRunCountSched = (profile.lastRunSummaryJson as { runCount?: number } | null)?.runCount ?? 0;
  await db.update(travelSearchProfilesTable).set({
    lastRunAt: now,
    lastRunStatus: toInsert.length > 0 ? "ok" : errors.length > 0 ? "error" : "ok",
    lastRunSummaryJson: { count: toInsert.length, skipped: allResults.length - toInsert.length, errors, runCount: prevRunCountSched + 1, ranAt: now.toISOString() },
    updatedAt: now,
  }).where(eq(travelSearchProfilesTable.id, profile.id));

  return { ok: true, resultsFound: toInsert.length, skipped: allResults.length - toInsert.length, errors };
}
