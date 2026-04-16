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
import { requireAuth, requireAdmin, getCurrentUserIdNum } from "../middleware/require-auth.js";
import { runSearchProfile, getApiQuotas } from "../services/travelSearchService.js";
import { getTravelSchedulerStatus } from "../jobs/scheduler.js";

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

  const pattern = `%${q}%`;

  const rows = await db
    .select()
    .from(travelLocationsTable)
    .where(
      or(
        ilike(travelLocationsTable.normalizedName, pattern),
        ilike(travelLocationsTable.label, pattern),
        ilike(travelLocationsTable.code, pattern),
        drizzleSql`${travelLocationsTable.aliases}::text ILIKE ${pattern}`,
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
  searchType: z.enum(["vuelos", "paquetes", "ambos"]).default("ambos"),
  departureDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  departureDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
    searchType: d.searchType,
    departureDateFrom: d.departureDateFrom ?? null,
    departureDateTo: d.departureDateTo ?? null,
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
  if (d.searchType !== undefined)             updates.searchType = d.searchType;
  if (d.departureDateFrom !== undefined)      updates.departureDateFrom = d.departureDateFrom;
  if (d.departureDateTo !== undefined)        updates.departureDateTo = d.departureDateTo;

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

router.post("/travel/search-profiles/:id/run", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = getCurrentUserIdNum(req);
  try {
    const result = await runSearchProfile(id, userId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al ejecutar la búsqueda";
    const status = msg.includes("Esperá") ? 429 : msg.includes("no encontrado") ? 404 : 500;
    logger.error({ err }, "Travel search run error");
    res.status(status).json({ error: msg });
  }
});

// ── GET /travel/search-results ────────────────────────────────────────────────

const ResultsQuery = z.object({
  profileId:        z.string().optional(),
  status:           z.enum(["new", "seen", "saved", "dismissed", "expired"]).optional(),
  validationStatus: z.enum(["pending", "validated", "weak_match", "broken_link", "expired"]).optional(),
  searchType:       z.enum(["vuelo", "paquete"]).optional(),
  apiSource:        z.enum(["serpapi", "amadeus"]).optional(),
  limit:            z.coerce.number().int().min(1).max(200).default(100),
  offset:           z.coerce.number().int().min(0).default(0),
});

router.get("/travel/search-results", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  const q = ResultsQuery.safeParse(req.query);

  const conditions = [eq(travelSearchResultsTable.userId, userId)];
  let limit = 100;
  let offset = 0;

  if (q.success) {
    if (q.data.profileId)         conditions.push(eq(travelSearchResultsTable.searchProfileId, q.data.profileId));
    if (q.data.status)            conditions.push(eq(travelSearchResultsTable.status, q.data.status));
    if (q.data.validationStatus)  conditions.push(eq(travelSearchResultsTable.validationStatus, q.data.validationStatus));
    if (q.data.searchType)        conditions.push(eq(travelSearchResultsTable.searchType, q.data.searchType));
    if (q.data.apiSource)         conditions.push(eq(travelSearchResultsTable.apiSource, q.data.apiSource));
    limit = q.data.limit;
    offset = q.data.offset;
  }

  const rows = await db
    .select()
    .from(travelSearchResultsTable)
    .where(and(...conditions))
    .orderBy(desc(travelSearchResultsTable.foundAt))
    .limit(limit)
    .offset(offset);

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

// ── Travel locations catalog ───────────────────────────────────────────────────

export const TRAVEL_LOCATIONS = [
  // ── Argentina ──────────────────────────────────────────────────────────────
  { label: "Neuquén (NQN)", normalizedName: "neuquen", code: "NQN", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["neuquén", "nqn", "chapelco"] },
  { label: "Buenos Aires — Ezeiza (EZE)", normalizedName: "buenos aires ezeiza", code: "EZE", country: "Argentina", region: "Argentina", type: "airport", aliases: ["eze", "ezeiza", "buenos aires", "bue"] },
  { label: "Buenos Aires — Aeroparque (AEP)", normalizedName: "buenos aires aeroparque", code: "AEP", country: "Argentina", region: "Argentina", type: "airport", aliases: ["aep", "aeroparque", "jorge newbery", "buenos aires"] },
  { label: "Mendoza (MDZ)", normalizedName: "mendoza", code: "MDZ", country: "Argentina", region: "Cuyo", type: "airport", aliases: ["mendoza", "mdz"] },
  { label: "Córdoba (COR)", normalizedName: "cordoba", code: "COR", country: "Argentina", region: "Centro", type: "airport", aliases: ["córdoba", "cordoba", "cor"] },
  { label: "Bariloche (BRC)", normalizedName: "bariloche", code: "BRC", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["bariloche", "brc", "san carlos de bariloche"] },
  { label: "Rosario (ROS)", normalizedName: "rosario", code: "ROS", country: "Argentina", region: "Centro", type: "airport", aliases: ["rosario", "ros"] },
  { label: "Puerto Iguazú (IGR)", normalizedName: "puerto iguazu", code: "IGR", country: "Argentina", region: "Litoral", type: "airport", aliases: ["iguazú", "iguazu", "igr", "cataratas"] },
  { label: "Ushuaia (USH)", normalizedName: "ushuaia", code: "USH", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["ushuaia", "ush", "tierra del fuego"] },
  { label: "Mar del Plata (MDQ)", normalizedName: "mar del plata", code: "MDQ", country: "Argentina", region: "Buenos Aires", type: "airport", aliases: ["mar del plata", "mdq", "mardelplata"] },
  { label: "Salta (SLA)", normalizedName: "salta", code: "SLA", country: "Argentina", region: "Norte", type: "airport", aliases: ["salta", "sla"] },
  { label: "Jujuy (JUJ)", normalizedName: "jujuy", code: "JUJ", country: "Argentina", region: "Norte", type: "airport", aliases: ["jujuy", "juj", "san salvador de jujuy"] },
  { label: "Tucumán (TUC)", normalizedName: "tucuman", code: "TUC", country: "Argentina", region: "Norte", type: "airport", aliases: ["tucumán", "tucuman", "tuc"] },
  { label: "Chapelco — San Martín de los Andes (CPC)", normalizedName: "chapelco san martin de los andes", code: "CPC", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["san martin de los andes", "chapelco", "cpc"] },
  { label: "Trelew (REL)", normalizedName: "trelew", code: "REL", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["trelew", "rel"] },
  { label: "Puerto Madryn (PMY)", normalizedName: "puerto madryn", code: "PMY", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["puerto madryn", "pmy"] },
  { label: "Comodoro Rivadavia (CRD)", normalizedName: "comodoro rivadavia", code: "CRD", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["comodoro rivadavia", "comodoro", "crd", "rivadavia"] },
  { label: "Santa Rosa (RSA)", normalizedName: "santa rosa", code: "RSA", country: "Argentina", region: "Pampa", type: "airport", aliases: ["santa rosa", "rsa", "la pampa"] },
  { label: "Corrientes (CNQ)", normalizedName: "corrientes", code: "CNQ", country: "Argentina", region: "Litoral", type: "airport", aliases: ["corrientes", "cnq"] },
  { label: "Posadas (PSS)", normalizedName: "posadas", code: "PSS", country: "Argentina", region: "Litoral", type: "airport", aliases: ["posadas", "pss"] },
  { label: "Río Gallegos (RGL)", normalizedName: "rio gallegos", code: "RGL", country: "Argentina", region: "Patagonia", type: "airport", aliases: ["rio gallegos", "rgl"] },
  { label: "Villa Mercedes (VME)", normalizedName: "villa mercedes", code: "VME", country: "Argentina", region: "Cuyo", type: "airport", aliases: ["villa mercedes", "vme", "san luis"] },
  { label: "Resistencia (RES)", normalizedName: "resistencia", code: "RES", country: "Argentina", region: "Litoral", type: "airport", aliases: ["resistencia", "res", "chaco"] },
  // ── Sudamérica — capitales ─────────────────────────────────────────────────
  { label: "Santiago de Chile (SCL)", normalizedName: "santiago chile", code: "SCL", country: "Chile", region: "Sudamérica", type: "airport", aliases: ["santiago", "chile", "scl"] },
  { label: "Montevideo (MVD)", normalizedName: "montevideo", code: "MVD", country: "Uruguay", region: "Sudamérica", type: "airport", aliases: ["montevideo", "uruguay", "mvd"] },
  { label: "Punta del Este (PDP)", normalizedName: "punta del este", code: "PDP", country: "Uruguay", region: "Sudamérica", type: "airport", aliases: ["punta del este", "pdp"] },
  { label: "São Paulo (GRU)", normalizedName: "sao paulo", code: "GRU", country: "Brasil", region: "Sudamérica", type: "airport", aliases: ["san pablo", "sao paulo", "brasil", "brazil", "gru", "guarulhos"] },
  { label: "Río de Janeiro (GIG)", normalizedName: "rio de janeiro", code: "GIG", country: "Brasil", region: "Sudamérica", type: "airport", aliases: ["rio de janeiro", "rio", "gig", "galeao"] },
  { label: "Brasilia (BSB)", normalizedName: "brasilia", code: "BSB", country: "Brasil", region: "Sudamérica", type: "airport", aliases: ["brasilia", "bsb"] },
  { label: "Bogotá (BOG)", normalizedName: "bogota", code: "BOG", country: "Colombia", region: "Sudamérica", type: "airport", aliases: ["bogotá", "bogota", "colombia", "bog", "el dorado"] },
  { label: "Medellín (MDE)", normalizedName: "medellin", code: "MDE", country: "Colombia", region: "Sudamérica", type: "airport", aliases: ["medellin", "medellín", "mde"] },
  { label: "Lima (LIM)", normalizedName: "lima", code: "LIM", country: "Perú", region: "Sudamérica", type: "airport", aliases: ["lima", "peru", "perú", "lim"] },
  { label: "Quito (UIO)", normalizedName: "quito", code: "UIO", country: "Ecuador", region: "Sudamérica", type: "airport", aliases: ["quito", "ecuador", "uio"] },
  { label: "Guayaquil (GYE)", normalizedName: "guayaquil", code: "GYE", country: "Ecuador", region: "Sudamérica", type: "airport", aliases: ["guayaquil", "gye"] },
  { label: "Caracas (CCS)", normalizedName: "caracas", code: "CCS", country: "Venezuela", region: "Sudamérica", type: "airport", aliases: ["caracas", "venezuela", "ccs"] },
  { label: "La Paz (LPB)", normalizedName: "la paz", code: "LPB", country: "Bolivia", region: "Sudamérica", type: "airport", aliases: ["la paz", "bolivia", "lpb"] },
  { label: "Asunción (ASU)", normalizedName: "asuncion", code: "ASU", country: "Paraguay", region: "Sudamérica", type: "airport", aliases: ["asunción", "asuncion", "paraguay", "asu"] },
  // ── Centroamérica y Caribe ─────────────────────────────────────────────────
  { label: "La Habana (HAV)", normalizedName: "la habana", code: "HAV", country: "Cuba", region: "Caribe", type: "airport", aliases: ["habana", "cuba", "hav", "varadero"] },
  { label: "Cancún (CUN)", normalizedName: "cancun", code: "CUN", country: "México", region: "Caribe", type: "airport", aliases: ["cancún", "cancun", "riviera maya", "cun"] },
  { label: "Punta Cana (PUJ)", normalizedName: "punta cana", code: "PUJ", country: "Rep. Dominicana", region: "Caribe", type: "airport", aliases: ["punta cana", "dominicana", "republica dominicana", "puj"] },
  { label: "Santo Domingo (SDQ)", normalizedName: "santo domingo", code: "SDQ", country: "Rep. Dominicana", region: "Caribe", type: "airport", aliases: ["santo domingo", "sdq"] },
  { label: "Ciudad de Panamá (PTY)", normalizedName: "ciudad de panama", code: "PTY", country: "Panamá", region: "Centroamérica", type: "airport", aliases: ["panama", "panamá", "pty", "tocumen"] },
  { label: "San José de Costa Rica (SJO)", normalizedName: "san jose costa rica", code: "SJO", country: "Costa Rica", region: "Centroamérica", type: "airport", aliases: ["san jose", "costa rica", "sjo"] },
  // ── Norteamérica ───────────────────────────────────────────────────────────
  { label: "Ciudad de México (MEX)", normalizedName: "ciudad de mexico", code: "MEX", country: "México", region: "Norteamérica", type: "airport", aliases: ["ciudad de mexico", "cdmx", "mexico", "mex"] },
  { label: "Guadalajara (GDL)", normalizedName: "guadalajara", code: "GDL", country: "México", region: "Norteamérica", type: "airport", aliases: ["guadalajara", "gdl"] },
  { label: "Miami (MIA)", normalizedName: "miami", code: "MIA", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["miami", "florida", "eeuu", "usa", "mia"] },
  { label: "Nueva York — JFK (JFK)", normalizedName: "nueva york jfk", code: "JFK", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["nueva york", "new york", "jfk", "kennedy", "eeuu"] },
  { label: "Nueva York — Newark (EWR)", normalizedName: "nueva york newark", code: "EWR", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["newark", "ewr", "new york"] },
  { label: "Los Ángeles (LAX)", normalizedName: "los angeles", code: "LAX", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["los angeles", "los ángeles", "lax", "california"] },
  { label: "Chicago (ORD)", normalizedName: "chicago", code: "ORD", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["chicago", "ohare", "ord"] },
  { label: "Orlando (MCO)", normalizedName: "orlando", code: "MCO", country: "Estados Unidos", region: "Norteamérica", type: "airport", aliases: ["orlando", "disney", "mco"] },
  { label: "Toronto (YYZ)", normalizedName: "toronto", code: "YYZ", country: "Canadá", region: "Norteamérica", type: "airport", aliases: ["toronto", "canada", "yyz", "pearson"] },
  { label: "Ottawa (YOW)", normalizedName: "ottawa", code: "YOW", country: "Canadá", region: "Norteamérica", type: "airport", aliases: ["ottawa", "yow"] },
  // ── Europa — capitales ─────────────────────────────────────────────────────
  { label: "Madrid (MAD)", normalizedName: "madrid", code: "MAD", country: "España", region: "Europa", type: "airport", aliases: ["madrid", "españa", "espana", "mad", "barajas"] },
  { label: "Barcelona (BCN)", normalizedName: "barcelona", code: "BCN", country: "España", region: "Europa", type: "airport", aliases: ["barcelona", "bcn", "el prat"] },
  { label: "París — CDG (CDG)", normalizedName: "paris cdg", code: "CDG", country: "Francia", region: "Europa", type: "airport", aliases: ["paris", "parís", "france", "francia", "cdg", "charles de gaulle"] },
  { label: "Roma — Fiumicino (FCO)", normalizedName: "roma fiumicino", code: "FCO", country: "Italia", region: "Europa", type: "airport", aliases: ["roma", "rome", "italia", "fco", "fiumicino"] },
  { label: "Milán (MXP)", normalizedName: "milan", code: "MXP", country: "Italia", region: "Europa", type: "airport", aliases: ["milan", "milán", "mxp", "malpensa"] },
  { label: "Londres — Heathrow (LHR)", normalizedName: "londres heathrow", code: "LHR", country: "Reino Unido", region: "Europa", type: "airport", aliases: ["london", "londres", "uk", "reino unido", "lhr", "heathrow"] },
  { label: "Berlín (BER)", normalizedName: "berlin", code: "BER", country: "Alemania", region: "Europa", type: "airport", aliases: ["berlin", "berlín", "ber", "brandenburgo"] },
  { label: "Frankfurt (FRA)", normalizedName: "frankfurt", code: "FRA", country: "Alemania", region: "Europa", type: "airport", aliases: ["frankfurt", "alemania", "germany", "fra"] },
  { label: "Ámsterdam (AMS)", normalizedName: "amsterdam", code: "AMS", country: "Países Bajos", region: "Europa", type: "airport", aliases: ["amsterdam", "holanda", "ams", "schiphol"] },
  { label: "Lisboa (LIS)", normalizedName: "lisboa", code: "LIS", country: "Portugal", region: "Europa", type: "airport", aliases: ["lisboa", "lisbon", "portugal", "lis"] },
  { label: "Zúrich (ZRH)", normalizedName: "zurich", code: "ZRH", country: "Suiza", region: "Europa", type: "airport", aliases: ["zurich", "zúrich", "suiza", "zrh"] },
  { label: "Viena (VIE)", normalizedName: "viena", code: "VIE", country: "Austria", region: "Europa", type: "airport", aliases: ["viena", "vienna", "austria", "vie"] },
  { label: "Atenas (ATH)", normalizedName: "atenas", code: "ATH", country: "Grecia", region: "Europa", type: "airport", aliases: ["atenas", "athens", "grecia", "ath"] },
  { label: "Bruselas (BRU)", normalizedName: "bruselas", code: "BRU", country: "Bélgica", region: "Europa", type: "airport", aliases: ["bruselas", "brussels", "belgica", "bru"] },
  { label: "Estocolmo (ARN)", normalizedName: "estocolmo", code: "ARN", country: "Suecia", region: "Europa", type: "airport", aliases: ["estocolmo", "stockholm", "suecia", "arn"] },
  { label: "Oslo (OSL)", normalizedName: "oslo", code: "OSL", country: "Noruega", region: "Europa", type: "airport", aliases: ["oslo", "noruega", "osl"] },
  { label: "Copenhague (CPH)", normalizedName: "copenhague", code: "CPH", country: "Dinamarca", region: "Europa", type: "airport", aliases: ["copenhague", "copenhagen", "dinamarca", "cph"] },
  { label: "Helsinki (HEL)", normalizedName: "helsinki", code: "HEL", country: "Finlandia", region: "Europa", type: "airport", aliases: ["helsinki", "finlandia", "hel"] },
  { label: "Varsovia (WAW)", normalizedName: "varsovia", code: "WAW", country: "Polonia", region: "Europa", type: "airport", aliases: ["varsovia", "warsaw", "polonia", "waw"] },
  { label: "Praga (PRG)", normalizedName: "praga", code: "PRG", country: "Rep. Checa", region: "Europa", type: "airport", aliases: ["praga", "prague", "prg"] },
  { label: "Budapest (BUD)", normalizedName: "budapest", code: "BUD", country: "Hungría", region: "Europa", type: "airport", aliases: ["budapest", "hungria", "bud"] },
  { label: "Bucarest (OTP)", normalizedName: "bucarest", code: "OTP", country: "Rumanía", region: "Europa", type: "airport", aliases: ["bucarest", "bucharest", "rumania", "otp"] },
  { label: "Dublín (DUB)", normalizedName: "dublin", code: "DUB", country: "Irlanda", region: "Europa", type: "airport", aliases: ["dublin", "dublín", "irlanda", "dub"] },
  // ── Asia y Oriente Medio ───────────────────────────────────────────────────
  { label: "Dubái (DXB)", normalizedName: "dubai", code: "DXB", country: "Emiratos Árabes", region: "Asia", type: "airport", aliases: ["dubai", "dxb", "emiratos"] },
  { label: "Tokio — Narita (NRT)", normalizedName: "tokio narita", code: "NRT", country: "Japón", region: "Asia", type: "airport", aliases: ["tokio", "tokyo", "japon", "japón", "nrt", "narita"] },
  { label: "Bangkok (BKK)", normalizedName: "bangkok", code: "BKK", country: "Tailandia", region: "Asia", type: "airport", aliases: ["bangkok", "tailandia", "bkk"] },
  { label: "Singapur (SIN)", normalizedName: "singapur", code: "SIN", country: "Singapur", region: "Asia", type: "airport", aliases: ["singapur", "singapore", "sin", "changi"] },
  // ── Oceanía y África ───────────────────────────────────────────────────────
  { label: "Sídney (SYD)", normalizedName: "sidney", code: "SYD", country: "Australia", region: "Oceanía", type: "airport", aliases: ["sidney", "sydney", "australia", "syd"] },
  { label: "Ciudad del Cabo (CPT)", normalizedName: "ciudad del cabo", code: "CPT", country: "Sudáfrica", region: "África", type: "airport", aliases: ["ciudad del cabo", "cape town", "sudafrica", "cpt"] },
  { label: "Johannesburgo (JNB)", normalizedName: "johannesburgo", code: "JNB", country: "Sudáfrica", region: "África", type: "airport", aliases: ["johannesburgo", "johannesburg", "sudafrica", "jnb"] },
];

// ── POST /travel/seed-locations — seed catalog (admin only) ──────────────────

router.post("/travel/seed-locations", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    await db.delete(travelLocationsTable);
    const inserted = await db.insert(travelLocationsTable)
      .values(TRAVEL_LOCATIONS.map(l => ({ id: uid(), ...l })))
      .returning();
    res.json({ ok: true, count: inserted.length, message: `${inserted.length} ubicaciones cargadas correctamente` });
  } catch (err) {
    logger.error({ err }, "Error seeding travel locations");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al cargar ubicaciones" });
  }
});

// ── GET /travel/api-quotas ────────────────────────────────────────────────────

router.get("/travel/api-quotas", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const quotas = await getApiQuotas();
    res.json(quotas);
  } catch (err) {
    logger.error({ err }, "Error fetching API quotas");
    res.status(500).json({ error: "Error al obtener cuotas" });
  }
});

// ── GET /travel/scheduler-status ─────────────────────────────────────────────

router.get("/travel/scheduler-status", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const scheduler = getTravelSchedulerStatus();
    const quotas = await getApiQuotas();

    const activeProfiles = await db
      .select({ id: travelSearchProfilesTable.id })
      .from(travelSearchProfilesTable)
      .where(eq(travelSearchProfilesTable.isActive, true));

    res.json({
      scheduler: { ...scheduler, activeProfiles: activeProfiles.length },
      quotas,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching scheduler status");
    res.status(500).json({ error: "Error al obtener estado del scheduler" });
  }
});

export default router;
