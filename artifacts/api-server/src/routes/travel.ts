import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, ilike, or, sql as drizzleSql } from "drizzle-orm";
import {
  db,
  travelLocationsTable,
  travelSearchProfilesTable,
  travelSearchResultsTable,
} from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { requireAuth, getCurrentUserIdNum } from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

// ── GET /travel/locations — autocomplete ──────────────────────────────────────

router.get("/travel/locations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 1) {
    res.json([]);
    return;
  }

  const pattern = `%${q.toLowerCase()}%`;

  const rows = await db
    .select()
    .from(travelLocationsTable)
    .where(
      or(
        ilike(travelLocationsTable.normalizedName, pattern),
        ilike(travelLocationsTable.label, pattern),
        ilike(travelLocationsTable.code, pattern),
      )
    )
    .orderBy(travelLocationsTable.label)
    .limit(12);

  res.json(rows);
});

// ── GET /travel/search-profiles ───────────────────────────────────────────────

router.get("/travel/search-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  const rows = await db
    .select()
    .from(travelSearchProfilesTable)
    .where(eq(travelSearchProfilesTable.userId, userId))
    .orderBy(desc(travelSearchProfilesTable.createdAt));
  res.json(rows);
});

// ── POST /travel/search-profiles ──────────────────────────────────────────────

const ProfileBody = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  travelType: z.enum(["nacional", "internacional", "corporativo", "beneficio"]),
  originJson: z.object({
    label: z.string(),
    code: z.string().optional().nullable(),
    country: z.string().optional(),
    region: z.string().optional(),
    type: z.string().optional(),
  }),
  destinationMode: z.enum(["specific", "region", "mixed"]).default("specific"),
  destinationsJson: z.array(z.object({
    label: z.string(),
    code: z.string().optional().nullable(),
    country: z.string().optional(),
    region: z.string().optional(),
    type: z.string().optional(),
  })).optional().nullable(),
  regionsJson: z.array(z.string()).optional().nullable(),
  excludedDestinationsJson: z.array(z.string()).optional().nullable(),
  maxBudget: z.coerce.number().min(1, "El presupuesto es obligatorio"),
  currency: z.enum(["ARS", "USD", "EUR"]).default("ARS"),
  travelersCount: z.coerce.number().int().min(1).default(1),
  travelerProfile: z.enum(["solo", "pareja", "familia", "corporativo"]).default("pareja"),
  minDays: z.coerce.number().int().min(1).optional().nullable(),
  maxDays: z.coerce.number().int().min(1).optional().nullable(),
  airlinePreferencesJson: z.array(z.string()).optional().nullable(),
  hotelMinStars: z.coerce.number().int().min(1).max(5).optional().nullable(),
  mealPlan: z.string().optional().nullable(),
  directFlightOnly: z.boolean().default(false),
  dateFlexibilityDays: z.coerce.number().int().min(0).optional().nullable(),
  refreshFrequencyHours: z.coerce.number().int().min(1).default(24),
  tolerancePercent: z.coerce.number().int().min(0).max(100).default(20),
  priority: z.coerce.number().int().default(0),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

router.post("/travel/search-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" });
    return;
  }

  const d = parsed.data;
  const userId = getCurrentUserIdNum(req);

  const [created] = await db.insert(travelSearchProfilesTable).values({
    id: uid(),
    userId,
    name: d.name,
    isActive: d.isActive,
    travelType: d.travelType,
    originJson: d.originJson,
    destinationMode: d.destinationMode,
    destinationsJson: d.destinationsJson ?? null,
    regionsJson: d.regionsJson ?? null,
    excludedDestinationsJson: d.excludedDestinationsJson ?? null,
    maxBudget: d.maxBudget.toString(),
    currency: d.currency,
    travelersCount: d.travelersCount,
    travelerProfile: d.travelerProfile,
    minDays: d.minDays ?? null,
    maxDays: d.maxDays ?? null,
    airlinePreferencesJson: d.airlinePreferencesJson ?? null,
    hotelMinStars: d.hotelMinStars ?? null,
    mealPlan: d.mealPlan ?? null,
    directFlightOnly: d.directFlightOnly,
    dateFlexibilityDays: d.dateFlexibilityDays ?? null,
    refreshFrequencyHours: d.refreshFrequencyHours,
    tolerancePercent: d.tolerancePercent,
    priority: d.priority,
    notes: d.notes ?? null,
    sourceConfigsJson: [],
  }).returning();

  res.status(201).json(created);
});

// ── PATCH /travel/search-profiles/:id ────────────────────────────────────────

router.patch("/travel/search-profiles/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = getCurrentUserIdNum(req);

  const existing = await db
    .select()
    .from(travelSearchProfilesTable)
    .where(and(
      eq(travelSearchProfilesTable.id, id),
      eq(travelSearchProfilesTable.userId, userId),
    ))
    .limit(1);

  if (!existing[0]) {
    res.status(404).json({ error: "Búsqueda no encontrada" });
    return;
  }

  const parsed = ProfileBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" });
    return;
  }

  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (d.name !== undefined)                   updates.name = d.name;
  if (d.isActive !== undefined)               updates.isActive = d.isActive;
  if (d.travelType !== undefined)             updates.travelType = d.travelType;
  if (d.originJson !== undefined)             updates.originJson = d.originJson;
  if (d.destinationMode !== undefined)        updates.destinationMode = d.destinationMode;
  if (d.destinationsJson !== undefined)       updates.destinationsJson = d.destinationsJson;
  if (d.regionsJson !== undefined)            updates.regionsJson = d.regionsJson;
  if (d.excludedDestinationsJson !== undefined) updates.excludedDestinationsJson = d.excludedDestinationsJson;
  if (d.maxBudget !== undefined)              updates.maxBudget = d.maxBudget.toString();
  if (d.currency !== undefined)               updates.currency = d.currency;
  if (d.travelersCount !== undefined)         updates.travelersCount = d.travelersCount;
  if (d.travelerProfile !== undefined)        updates.travelerProfile = d.travelerProfile;
  if (d.minDays !== undefined)                updates.minDays = d.minDays;
  if (d.maxDays !== undefined)                updates.maxDays = d.maxDays;
  if (d.airlinePreferencesJson !== undefined) updates.airlinePreferencesJson = d.airlinePreferencesJson;
  if (d.hotelMinStars !== undefined)          updates.hotelMinStars = d.hotelMinStars;
  if (d.mealPlan !== undefined)               updates.mealPlan = d.mealPlan;
  if (d.directFlightOnly !== undefined)       updates.directFlightOnly = d.directFlightOnly;
  if (d.dateFlexibilityDays !== undefined)    updates.dateFlexibilityDays = d.dateFlexibilityDays;
  if (d.refreshFrequencyHours !== undefined)  updates.refreshFrequencyHours = d.refreshFrequencyHours;
  if (d.tolerancePercent !== undefined)       updates.tolerancePercent = d.tolerancePercent;
  if (d.priority !== undefined)               updates.priority = d.priority;
  if (d.notes !== undefined)                  updates.notes = d.notes;

  const [updated] = await db
    .update(travelSearchProfilesTable)
    .set(updates)
    .where(eq(travelSearchProfilesTable.id, id))
    .returning();

  res.json(updated);
});

// ── DELETE /travel/search-profiles/:id ───────────────────────────────────────

router.delete("/travel/search-profiles/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = getCurrentUserIdNum(req);

  const [deleted] = await db
    .delete(travelSearchProfilesTable)
    .where(and(
      eq(travelSearchProfilesTable.id, id),
      eq(travelSearchProfilesTable.userId, userId),
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Búsqueda no encontrada" });
    return;
  }

  // Also delete associated results
  await db
    .delete(travelSearchResultsTable)
    .where(eq(travelSearchResultsTable.searchProfileId, id));

  res.status(204).send();
});

// ── POST /travel/search-profiles/:id/run ─────────────────────────────────────

const SIMULATED_SOURCES = [
  "Despegar.com", "Almundo", "Aero Sur Turismo", "TUI Argentina",
  "Flybondi", "Aerolíneas Argentinas", "LATAM", "American Express Travel",
];

const SIMULATED_RESULTS: Array<{
  titleTemplate: string;
  airline?: string;
  hotel?: string;
  hotelStars?: number;
  priceFactorMin: number;
  priceFactorMax: number;
  daysMin: number;
  daysMax: number;
  mealPlan?: string;
}> = [
  { titleTemplate: "Paquete todo incluido", airline: "Aerolíneas Argentinas", hotel: "Hotel Loi Suites", hotelStars: 4, priceFactorMin: 0.80, priceFactorMax: 0.95, daysMin: 5, daysMax: 7, mealPlan: "todo incluido" },
  { titleTemplate: "Escapada vuelo + hotel", airline: "LATAM", hotel: "Ibis Hotel", hotelStars: 3, priceFactorMin: 0.65, priceFactorMax: 0.80, daysMin: 3, daysMax: 5 },
  { titleTemplate: "Oferta flash — cupos limitados", airline: "Flybondi", hotel: "Apart Hotel Premium", hotelStars: 3, priceFactorMin: 0.55, priceFactorMax: 0.75, daysMin: 4, daysMax: 6 },
  { titleTemplate: "Paquete familiar", hotel: "Resort & Spa", hotelStars: 5, priceFactorMin: 0.90, priceFactorMax: 1.10, daysMin: 7, daysMax: 10, mealPlan: "media pensión" },
  { titleTemplate: "Tarifa corporativa especial", airline: "American Airlines", hotel: "NH Collection", hotelStars: 4, priceFactorMin: 0.70, priceFactorMax: 0.85, daysMin: 2, daysMax: 4 },
];

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

router.post("/travel/search-profiles/:id/run", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = getCurrentUserIdNum(req);

  const [profile] = await db
    .select()
    .from(travelSearchProfilesTable)
    .where(and(
      eq(travelSearchProfilesTable.id, id),
      eq(travelSearchProfilesTable.userId, userId),
    ))
    .limit(1);

  if (!profile) {
    res.status(404).json({ error: "Búsqueda no encontrada" });
    return;
  }

  try {
    const budget = Number(profile.maxBudget);
    const tolerance = profile.tolerancePercent ?? 20;
    const maxBudgetWithTolerance = budget * (1 + tolerance / 100);

    const now = new Date();
    const resultCount = Math.floor(randomBetween(2, 5));
    const insertedResults: unknown[] = [];

    const destinations = (profile.destinationsJson as Array<{ label: string; country?: string; region?: string }> | null) ?? [];
    const regions = (profile.regionsJson as string[] | null) ?? [];
    const origin = profile.originJson as { label: string; code?: string | null };

    for (let i = 0; i < resultCount; i++) {
      const template = SIMULATED_RESULTS[i % SIMULATED_RESULTS.length]!;
      const source = SIMULATED_SOURCES[Math.floor(Math.random() * SIMULATED_SOURCES.length)]!;

      let destLabel = "Destino simulado";
      let destCountry = "Argentina";
      let destRegion = "Argentina";

      if (profile.destinationMode === "specific" && destinations.length > 0) {
        const dest = destinations[i % destinations.length]!;
        destLabel = dest.label;
        destCountry = dest.country ?? "Argentina";
        destRegion = dest.region ?? "Argentina";
      } else if (profile.destinationMode === "region" && regions.length > 0) {
        destLabel = `Destino en ${regions[i % regions.length]}`;
        destRegion = regions[i % regions.length]!;
      }

      const days = Math.round(randomBetween(
        profile.minDays ?? template.daysMin,
        profile.maxDays ?? template.daysMax,
      ));
      const nights = days - 1;

      const priceFactor = randomBetween(template.priceFactorMin, template.priceFactorMax);
      const price = Math.round(budget * priceFactor);
      const confidenceScore = price <= budget ? Math.round(randomBetween(75, 98)) : Math.round(randomBetween(55, 74));
      const validationStatus = confidenceScore >= 75 ? "validated" : "weak_match";

      const departureDate = addDays(now, Math.round(randomBetween(14, 90)));
      const returnDate = addDays(new Date(departureDate), days);

      const title = `${template.titleTemplate} — ${destLabel}`;

      const [inserted] = await db.insert(travelSearchResultsTable).values({
        id: uid(),
        searchProfileId: id,
        userId,
        source,
        externalId: `SIM-${Date.now()}-${i}`,
        externalUrl: null,
        title,
        originJson: origin,
        destinationJson: { label: destLabel, country: destCountry, region: destRegion },
        region: destRegion,
        country: destCountry,
        price: Math.min(price, Math.round(maxBudgetWithTolerance)).toString(),
        currency: profile.currency,
        priceOriginal: price > budget ? price.toString() : null,
        days,
        nights,
        travelersCount: profile.travelersCount,
        airline: profile.airlinePreferencesJson
          ? (profile.airlinePreferencesJson as string[])[0] ?? template.airline ?? null
          : template.airline ?? null,
        hotelName: template.hotel ?? null,
        hotelStars: template.hotelStars != null && (profile.hotelMinStars == null || template.hotelStars >= profile.hotelMinStars)
          ? template.hotelStars
          : null,
        mealPlan: template.mealPlan ?? profile.mealPlan ?? null,
        departureDate,
        returnDate,
        confidenceScore,
        validationStatus,
        status: "new",
        rawPayloadJson: { simulated: true, profileId: id },
      }).returning();

      insertedResults.push(inserted);
    }

    // Update profile run metadata
    await db.update(travelSearchProfilesTable)
      .set({
        lastRunAt: now,
        lastRunStatus: "ok",
        lastRunSummaryJson: { count: insertedResults.length, ranAt: now.toISOString() },
        updatedAt: now,
      })
      .where(eq(travelSearchProfilesTable.id, id));

    res.json({ ok: true, resultsFound: insertedResults.length, results: insertedResults });
  } catch (err) {
    logger.error({ err }, "Travel search run error");

    await db.update(travelSearchProfilesTable)
      .set({ lastRunAt: new Date(), lastRunStatus: "error", updatedAt: new Date() })
      .where(eq(travelSearchProfilesTable.id, id));

    res.status(500).json({ error: "Error al ejecutar la búsqueda" });
  }
});

// ── GET /travel/search-results ────────────────────────────────────────────────

const ResultsQuery = z.object({
  profileId: z.string().optional(),
  status:    z.string().optional(),
  validationStatus: z.string().optional(),
});

router.get("/travel/search-results", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  const q = ResultsQuery.safeParse(req.query);

  const conditions = [eq(travelSearchResultsTable.userId, userId)];

  if (q.success) {
    if (q.data.profileId)         conditions.push(eq(travelSearchResultsTable.searchProfileId, q.data.profileId));
    if (q.data.status)            conditions.push(eq(travelSearchResultsTable.status, q.data.status));
    if (q.data.validationStatus)  conditions.push(eq(travelSearchResultsTable.validationStatus, q.data.validationStatus));
  }

  const rows = await db
    .select()
    .from(travelSearchResultsTable)
    .where(and(...conditions))
    .orderBy(desc(travelSearchResultsTable.foundAt));

  res.json(rows);
});

// ── PATCH /travel/search-results/:id/status ───────────────────────────────────

const StatusBody = z.object({
  status: z.enum(["new", "seen", "saved", "dismissed", "expired"]),
});

router.patch("/travel/search-results/:id/status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = getCurrentUserIdNum(req);

  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Estado inválido" });
    return;
  }

  const [updated] = await db
    .update(travelSearchResultsTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(
      eq(travelSearchResultsTable.id, id),
      eq(travelSearchResultsTable.userId, userId),
    ))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Resultado no encontrado" });
    return;
  }

  res.json(updated);
});

// ── GET /travel/locations-catalog — list all (admin config) ──────────────────

router.get("/travel/locations-catalog", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(travelLocationsTable)
    .orderBy(travelLocationsTable.country, travelLocationsTable.label)
    .limit(500);
  res.json(rows);
});

// ── POST /travel/seed-locations — seed catalog (internal) ────────────────────

router.post("/travel/seed-locations", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const existing = await db.select().from(travelLocationsTable).limit(1);
  if (existing.length > 0) {
    res.json({ ok: true, message: "Locations already seeded", count: 0 });
    return;
  }

  const locations = [
    // ── Argentina ─────────────────────────────────────────────────────────────
    { label: "Neuquén (NQN)", normalizedName: "neuquen", code: "NQN", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["neuquén", "nqn"] },
    { label: "Buenos Aires — Ezeiza (EZE)", normalizedName: "buenos aires ezeiza", code: "EZE", country: "Argentina", region: "Argentina", type: "airport", aliases: ["eze", "ezeiza", "buenos aires", "bue"] },
    { label: "Buenos Aires — Aeroparque (AEP)", normalizedName: "buenos aires aeroparque", code: "AEP", country: "Argentina", region: "Argentina", type: "airport", aliases: ["aep", "aeroparque", "buenos aires"] },
    { label: "Mendoza (MDZ)", normalizedName: "mendoza", code: "MDZ", country: "Argentina", region: "Cuyo", type: "airport", aliases: ["mendoza", "mdz"] },
    { label: "Córdoba (COR)", normalizedName: "cordoba", code: "COR", country: "Argentina", region: "Centro", type: "airport", aliases: ["córdoba", "cordoba", "cor"] },
    { label: "Bariloche (BRC)", normalizedName: "bariloche", code: "BRC", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["bariloche", "brc", "san carlos de bariloche"] },
    { label: "Rosario (ROS)", normalizedName: "rosario", code: "ROS", country: "Argentina", region: "Centro", type: "airport", aliases: ["rosario", "ros"] },
    { label: "Iguazú (IGR)", normalizedName: "iguazu", code: "IGR", country: "Argentina", region: "Litoral", type: "airport", aliases: ["iguazú", "iguazu", "puerto iguazu", "igr"] },
    { label: "Ushuaia (USH)", normalizedName: "ushuaia", code: "USH", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["ushuaia", "ush", "tierra del fuego"] },
    { label: "Mar del Plata (MDQ)", normalizedName: "mar del plata", code: "MDQ", country: "Argentina", region: "Buenos Aires", type: "airport", aliases: ["mar del plata", "mdp", "mdq"] },
    { label: "Salta (SLA)", normalizedName: "salta", code: "SLA", country: "Argentina", region: "Norte", type: "airport", aliases: ["salta", "sla"] },
    { label: "Jujuy (JUJ)", normalizedName: "jujuy", code: "JUJ", country: "Argentina", region: "Norte", type: "airport", aliases: ["jujuy", "juj", "san salvador de jujuy"] },
    { label: "Tucumán (TUC)", normalizedName: "tucuman", code: "TUC", country: "Argentina", region: "Norte", type: "airport", aliases: ["tucumán", "tucuman", "tuc"] },
    { label: "San Martín de los Andes (CPC)", normalizedName: "san martin de los andes", code: "CPC", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["san martin de los andes", "chapelco", "cpc"] },
    { label: "Puerto Madryn (PMY)", normalizedName: "puerto madryn", code: "PMY", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["puerto madryn", "pmy"] },
    { label: "Comodoro Rivadavia (CRD)", normalizedName: "comodoro rivadavia", code: "CRD", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["comodoro rivadavia", "comodoro", "crd"] },
    { label: "Santa Rosa (RSA)", normalizedName: "santa rosa", code: "RSA", country: "Argentina", region: "Pampa", type: "airport", aliases: ["santa rosa", "rsa", "la pampa"] },
    { label: "Posadas (PSS)", normalizedName: "posadas", code: "PSS", country: "Argentina", region: "Litoral", type: "airport", aliases: ["posadas", "pss"] },
    { label: "Resistencia (RES)", normalizedName: "resistencia", code: "RES", country: "Argentina", region: "Litoral", type: "airport", aliases: ["resistencia", "res", "chaco"] },
    // ── Sudamérica ────────────────────────────────────────────────────────────
    { label: "Santiago de Chile (SCL)", normalizedName: "santiago de chile", code: "SCL", country: "Chile", region: "Sudamérica", type: "airport", aliases: ["santiago", "chile", "scl"] },
    { label: "Lima (LIM)", normalizedName: "lima", code: "LIM", country: "Perú", region: "Sudamérica", type: "airport", aliases: ["lima", "peru", "perú", "lim"] },
    { label: "Bogotá (BOG)", normalizedName: "bogota", code: "BOG", country: "Colombia", region: "Sudamérica", type: "airport", aliases: ["bogotá", "bogota", "colombia", "bog"] },
    { label: "São Paulo (GRU)", normalizedName: "sao paulo", code: "GRU", country: "Brasil", region: "Sudamérica", type: "airport", aliases: ["san pablo", "sao paulo", "brasil", "brazil", "gru"] },
    { label: "Río de Janeiro (GIG)", normalizedName: "rio de janeiro", code: "GIG", country: "Brasil", region: "Sudamérica", type: "airport", aliases: ["rio de janeiro", "rio", "gig"] },
    { label: "Montevideo (MVD)", normalizedName: "montevideo", code: "MVD", country: "Uruguay", region: "Sudamérica", type: "airport", aliases: ["montevideo", "uruguay", "mvd"] },
    { label: "Punta del Este (PDP)", normalizedName: "punta del este", code: "PDP", country: "Uruguay", region: "Sudamérica", type: "airport", aliases: ["punta del este", "pdp"] },
    { label: "Asunción (ASU)", normalizedName: "asuncion", code: "ASU", country: "Paraguay", region: "Sudamérica", type: "airport", aliases: ["asunción", "asuncion", "paraguay", "asu"] },
    // ── Caribe ────────────────────────────────────────────────────────────────
    { label: "Cancún (CUN)", normalizedName: "cancun", code: "CUN", country: "México", region: "Caribe", type: "airport", aliases: ["cancún", "cancun", "mexico", "méxico", "riviera maya", "cun"] },
    { label: "Punta Cana (PUJ)", normalizedName: "punta cana", code: "PUJ", country: "Rep. Dominicana", region: "Caribe", type: "airport", aliases: ["punta cana", "dominicana", "republica dominicana", "puj"] },
    { label: "Varadero (VRA)", normalizedName: "varadero", code: "VRA", country: "Cuba", region: "Caribe", type: "airport", aliases: ["varadero", "cuba", "vra"] },
    { label: "Ciudad de Panamá (PTY)", normalizedName: "ciudad de panama", code: "PTY", country: "Panamá", region: "Caribe", type: "airport", aliases: ["panama", "panamá", "pty"] },
    // ── Norteamérica ──────────────────────────────────────────────────────────
    { label: "Miami (MIA)", normalizedName: "miami", code: "MIA", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["miami", "florida", "eeuu", "usa", "mia"] },
    { label: "Nueva York — JFK (JFK)", normalizedName: "nueva york jfk", code: "JFK", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["nueva york", "new york", "jfk", "eeuu"] },
    { label: "Los Ángeles (LAX)", normalizedName: "los angeles", code: "LAX", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["los angeles", "los ángeles", "lax", "eeuu"] },
    { label: "Orlando (MCO)", normalizedName: "orlando", code: "MCO", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["orlando", "disney", "mco"] },
    { label: "Ciudad de México (MEX)", normalizedName: "ciudad de mexico", code: "MEX", country: "México", region: "Norteamérica", type: "airport", aliases: ["ciudad de mexico", "cdmx", "mexico", "mex"] },
    // ── Europa ────────────────────────────────────────────────────────────────
    { label: "Madrid (MAD)", normalizedName: "madrid", code: "MAD", country: "España", region: "Europa", type: "airport", aliases: ["madrid", "españa", "espana", "mad"] },
    { label: "Barcelona (BCN)", normalizedName: "barcelona", code: "BCN", country: "España", region: "Europa", type: "airport", aliases: ["barcelona", "bcn", "cataluña"] },
    { label: "París (CDG)", normalizedName: "paris", code: "CDG", country: "Francia", region: "Europa", type: "airport", aliases: ["paris", "parís", "france", "francia", "cdg"] },
    { label: "Roma (FCO)", normalizedName: "roma", code: "FCO", country: "Italia", region: "Europa", type: "airport", aliases: ["roma", "rome", "italia", "fco"] },
    { label: "Londres (LHR)", normalizedName: "londres", code: "LHR", country: "Reino Unido", region: "Europa", type: "airport", aliases: ["london", "londres", "uk", "reino unido", "lhr"] },
    { label: "Milán (MXP)", normalizedName: "milan", code: "MXP", country: "Italia", region: "Europa", type: "airport", aliases: ["milan", "milán", "mxp"] },
    { label: "Lisboa (LIS)", normalizedName: "lisboa", code: "LIS", country: "Portugal", region: "Europa", type: "airport", aliases: ["lisboa", "lisbon", "portugal", "lis"] },
    { label: "Amsterdam (AMS)", normalizedName: "amsterdam", code: "AMS", country: "Países Bajos", region: "Europa", type: "airport", aliases: ["amsterdam", "holanda", "ams"] },
    { label: "Frankfurt (FRA)", normalizedName: "frankfurt", code: "FRA", country: "Alemania", region: "Europa", type: "airport", aliases: ["frankfurt", "alemania", "germany", "fra"] },
    // ── Asia & Otros ──────────────────────────────────────────────────────────
    { label: "Tokio (NRT)", normalizedName: "tokio", code: "NRT", country: "Japón", region: "Asia", type: "airport", aliases: ["tokio", "tokyo", "japon", "japón", "nrt"] },
    { label: "Dubai (DXB)", normalizedName: "dubai", code: "DXB", country: "Emiratos Árabes", region: "Asia", type: "airport", aliases: ["dubai", "dxb", "emiratos"] },
    { label: "Bangkok (BKK)", normalizedName: "bangkok", code: "BKK", country: "Tailandia", region: "Asia", type: "airport", aliases: ["bangkok", "tailandia", "bkk"] },
    { label: "Johannesburgo (JNB)", normalizedName: "johannesburgo", code: "JNB", country: "Sudáfrica", region: "África", type: "airport", aliases: ["johannesburgo", "sudafrica", "jnb"] },
  ];

  const inserted = await db.insert(travelLocationsTable)
    .values(locations.map(l => ({ id: uid(), ...l })))
    .returning();

  res.json({ ok: true, count: inserted.length });
});

export default router;
