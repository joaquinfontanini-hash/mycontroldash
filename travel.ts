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
import {
  requireAuth,
  getCurrentUserIdNum,
} from "../middleware/require-auth.js";
import {
  runSearchProfile,
  getApiQuotas,
  getBnaExchangeRate,
} from "../services/travelSearchService.js";
import { getTravelSchedulerStatus } from "../jobs/scheduler.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseStringId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  // UUID v4 o nanoid de longitud razonable
  return s.length > 0 && s.length <= 64 ? s : null;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LocationsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

const ProfileBody = z.object({
  name:                    z.string().min(1, "El nombre es obligatorio").max(200),
  travelType:              z.enum(["nacional", "internacional", "corporativo", "beneficio"]),
  originJson:              z.object({
    label:   z.string(),
    code:    z.string().optional().nullable(),
    country: z.string().optional(),
    region:  z.string().optional(),
    type:    z.string().optional(),
  }),
  destinationMode:         z.enum(["specific", "region", "mixed"]).default("specific"),
  destinationsJson:        z.array(z.object({
    label:   z.string(),
    code:    z.string().optional().nullable(),
    country: z.string().optional(),
    region:  z.string().optional(),
    type:    z.string().optional(),
  })).optional().nullable(),
  regionsJson:             z.array(z.string()).optional().nullable(),
  excludedDestinationsJson: z.array(z.string()).optional().nullable(),
  maxBudget:               z.coerce.number().min(1, "El presupuesto es obligatorio"),
  currency:                z.enum(["ARS", "USD", "EUR"]).default("ARS"),
  travelersCount:          z.coerce.number().int().min(1).default(1),
  travelerProfile:         z.enum(["solo", "pareja", "familia", "corporativo"]).default("pareja"),
  minDays:                 z.coerce.number().int().min(1).optional().nullable(),
  maxDays:                 z.coerce.number().int().min(1).optional().nullable(),
  airlinePreferencesJson:  z.array(z.string()).optional().nullable(),
  hotelMinStars:           z.coerce.number().int().min(1).max(5).optional().nullable(),
  mealPlan:                z.string().optional().nullable(),
  directFlightOnly:        z.boolean().default(false),
  dateFlexibilityDays:     z.coerce.number().int().min(0).optional().nullable(),
  refreshFrequencyHours:   z.coerce.number().int().min(1).default(24),
  tolerancePercent:        z.coerce.number().int().min(0).max(100).default(20),
  priority:                z.coerce.number().int().default(0),
  notes:                   z.string().max(2000).optional().nullable(),
  isActive:                z.boolean().default(true),
  searchType:              z.enum(["vuelos", "paquetes", "ambos"]).default("ambos"),
  departureDateFrom:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  departureDateTo:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const ResultsQuerySchema = z.object({
  profileId:        z.string().optional(),
  status:           z.enum(["new", "seen", "saved", "dismissed", "expired"]).optional(),
  validationStatus: z.enum(["pending", "validated", "weak_match", "broken_link", "expired"]).optional(),
  searchType:       z.enum(["vuelo", "paquete"]).optional(),
  apiSource:        z.enum(["serpapi", "amadeus"]).optional(),
  limit:            z.coerce.number().int().min(1).max(200).default(100),
  offset:           z.coerce.number().int().min(0).default(0),
});

const StatusBodySchema = z.object({
  status: z.enum(["new", "seen", "saved", "dismissed", "expired"]),
});

// ── GET /travel/locations — autocomplete ──────────────────────────────────────
// Límite de longitud en query param: previene patrones de 1000+ caracteres que
// generan ILIKE costosos en DB.
router.get("/travel/locations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const qParsed = LocationsQuerySchema.safeParse(req.query);
  if (!qParsed.success || !qParsed.data.q) {
    res.json([]);
    return;
  }

  const pattern = `%${qParsed.data.q}%`;

  try {
    const rows = await db
      .select()
      .from(travelLocationsTable)
      .where(
        or(
          ilike(travelLocationsTable.normalizedName, pattern),
          ilike(travelLocationsTable.label, pattern),
          ilike(travelLocationsTable.code, pattern),
          drizzleSql`${travelLocationsTable.aliases}::text ILIKE ${pattern}`,
        ),
      )
      .orderBy(travelLocationsTable.label)
      .limit(12);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "travel/locations search error");
    res.status(500).json({ error: "Error al buscar ubicaciones" });
  }
});

// ── GET /travel/search-profiles ───────────────────────────────────────────────
// Filtra siempre por userId — un usuario nunca puede ver perfiles de otro.
router.get("/travel/search-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  try {
    const rows = await db
      .select()
      .from(travelSearchProfilesTable)
      .where(eq(travelSearchProfilesTable.userId, userId))
      .orderBy(desc(travelSearchProfilesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err, userId }, "travel/search-profiles list error");
    res.status(500).json({ error: "Error al cargar perfiles de búsqueda" });
  }
});

// ── POST /travel/search-profiles ──────────────────────────────────────────────
router.post("/travel/search-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }

  const d = parsed.data;
  const userId = getCurrentUserIdNum(req);

  try {
    const [created] = await db
      .insert(travelSearchProfilesTable)
      .values({
        id:                      crypto.randomUUID(),
        userId,
        name:                    d.name,
        isActive:                d.isActive,
        travelType:              d.travelType,
        originJson:              d.originJson,
        destinationMode:         d.destinationMode,
        destinationsJson:        d.destinationsJson ?? null,
        regionsJson:             d.regionsJson ?? null,
        excludedDestinationsJson: d.excludedDestinationsJson ?? null,
        maxBudget:               d.maxBudget.toString(),
        currency:                d.currency,
        travelersCount:          d.travelersCount,
        travelerProfile:         d.travelerProfile,
        minDays:                 d.minDays ?? null,
        maxDays:                 d.maxDays ?? null,
        airlinePreferencesJson:  d.airlinePreferencesJson ?? null,
        hotelMinStars:           d.hotelMinStars ?? null,
        mealPlan:                d.mealPlan ?? null,
        directFlightOnly:        d.directFlightOnly,
        dateFlexibilityDays:     d.dateFlexibilityDays ?? null,
        refreshFrequencyHours:   d.refreshFrequencyHours,
        tolerancePercent:        d.tolerancePercent,
        priority:                d.priority,
        notes:                   d.notes ?? null,
        sourceConfigsJson:       [],
        searchType:              d.searchType,
        departureDateFrom:       d.departureDateFrom ?? null,
        departureDateTo:         d.departureDateTo ?? null,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    logger.error({ err, userId }, "travel/search-profiles create error");
    res.status(500).json({ error: "Error al crear perfil de búsqueda" });
  }
});

// ── PATCH /travel/search-profiles/:id ────────────────────────────────────────
// AND(id, userId) en la verificación inicial garantiza que el usuario
// no puede modificar perfiles de otro usuario, incluso conociendo el UUID.
router.patch("/travel/search-profiles/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseStringId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserIdNum(req);

  try {
    const [existing] = await db
      .select()
      .from(travelSearchProfilesTable)
      .where(
        and(
          eq(travelSearchProfilesTable.id, id),
          eq(travelSearchProfilesTable.userId, userId),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Búsqueda no encontrada" });
      return;
    }

    const parsed = ProfileBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const d = parsed.data;

    // Construir objeto de updates tipado — sin Record<string, unknown> + cast
    const updates: Partial<typeof travelSearchProfilesTable.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (d.name !== undefined)                    updates.name = d.name;
    if (d.isActive !== undefined)                updates.isActive = d.isActive;
    if (d.travelType !== undefined)              updates.travelType = d.travelType;
    if (d.originJson !== undefined)              updates.originJson = d.originJson;
    if (d.destinationMode !== undefined)         updates.destinationMode = d.destinationMode;
    if (d.destinationsJson !== undefined)        updates.destinationsJson = d.destinationsJson;
    if (d.regionsJson !== undefined)             updates.regionsJson = d.regionsJson;
    if (d.excludedDestinationsJson !== undefined) updates.excludedDestinationsJson = d.excludedDestinationsJson;
    if (d.maxBudget !== undefined)               updates.maxBudget = d.maxBudget.toString();
    if (d.currency !== undefined)                updates.currency = d.currency;
    if (d.travelersCount !== undefined)          updates.travelersCount = d.travelersCount;
    if (d.travelerProfile !== undefined)         updates.travelerProfile = d.travelerProfile;
    if (d.minDays !== undefined)                 updates.minDays = d.minDays;
    if (d.maxDays !== undefined)                 updates.maxDays = d.maxDays;
    if (d.airlinePreferencesJson !== undefined)  updates.airlinePreferencesJson = d.airlinePreferencesJson;
    if (d.hotelMinStars !== undefined)           updates.hotelMinStars = d.hotelMinStars;
    if (d.mealPlan !== undefined)                updates.mealPlan = d.mealPlan;
    if (d.directFlightOnly !== undefined)        updates.directFlightOnly = d.directFlightOnly;
    if (d.dateFlexibilityDays !== undefined)     updates.dateFlexibilityDays = d.dateFlexibilityDays;
    if (d.refreshFrequencyHours !== undefined)   updates.refreshFrequencyHours = d.refreshFrequencyHours;
    if (d.tolerancePercent !== undefined)        updates.tolerancePercent = d.tolerancePercent;
    if (d.priority !== undefined)                updates.priority = d.priority;
    if (d.notes !== undefined)                   updates.notes = d.notes;
    if (d.searchType !== undefined)              updates.searchType = d.searchType;
    if (d.departureDateFrom !== undefined)       updates.departureDateFrom = d.departureDateFrom;
    if (d.departureDateTo !== undefined)         updates.departureDateTo = d.departureDateTo;

    const [updated] = await db
      .update(travelSearchProfilesTable)
      .set(updates)
      .where(eq(travelSearchProfilesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err, id, userId }, "travel/search-profiles patch error");
    res.status(500).json({ error: "Error al actualizar perfil de búsqueda" });
  }
});

// ── DELETE /travel/search-profiles/:id ───────────────────────────────────────
// Elimina el perfil y sus resultados. AND(id, userId) previene eliminar
// perfiles ajenos.
router.delete("/travel/search-profiles/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseStringId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserIdNum(req);

  try {
    const [deleted] = await db
      .delete(travelSearchProfilesTable)
      .where(
        and(
          eq(travelSearchProfilesTable.id, id),
          eq(travelSearchProfilesTable.userId, userId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Búsqueda no encontrada" });
      return;
    }

    // Eliminar resultados asociados en background — no bloquear la respuesta
    db.delete(travelSearchResultsTable)
      .where(eq(travelSearchResultsTable.searchProfileId, id))
      .catch((err: unknown) => {
        logger.warn({ err, id }, "travel: failed to delete search results after profile delete");
      });

    res.status(204).send();
  } catch (err) {
    logger.error({ err, id, userId }, "travel/search-profiles delete error");
    res.status(500).json({ error: "Error al eliminar perfil de búsqueda" });
  }
});

// ── POST /travel/search-profiles/:id/run ─────────────────────────────────────
// Ejecuta la búsqueda para un perfil. Pasa userId al servicio para que
// verifique que el perfil le pertenece antes de correr la búsqueda.
router.post("/travel/search-profiles/:id/run", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseStringId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserIdNum(req);

  try {
    const result = await runSearchProfile(id, userId);
    res.json(result);
  } catch (err) {
    const msg    = err instanceof Error ? err.message : "Error al ejecutar la búsqueda";
    const status = msg.includes("Esperá") ? 429
      : msg.includes("no encontrado") ? 404
      : 500;
    logger.error({ err }, "Travel search run error");
    res.status(status).json({ error: msg });
  }
});

// ── GET /travel/search-results ────────────────────────────────────────────────
// Filtra siempre por userId — un usuario nunca puede ver resultados de otro.
router.get("/travel/search-results", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  const q = ResultsQuerySchema.safeParse(req.query);

  // Si la query tiene errores de validación devolver 400 con el primer error
  if (!q.success) {
    res.status(400).json({ error: q.error.issues[0]?.message ?? "Query params inválidos" });
    return;
  }

  const conditions = [eq(travelSearchResultsTable.userId, userId)];
  if (q.data.profileId)        conditions.push(eq(travelSearchResultsTable.searchProfileId, q.data.profileId));
  if (q.data.status)           conditions.push(eq(travelSearchResultsTable.status, q.data.status));
  if (q.data.validationStatus) conditions.push(eq(travelSearchResultsTable.validationStatus, q.data.validationStatus));
  if (q.data.searchType)       conditions.push(eq(travelSearchResultsTable.searchType, q.data.searchType));
  if (q.data.apiSource)        conditions.push(eq(travelSearchResultsTable.apiSource, q.data.apiSource));

  try {
    const rows = await db
      .select()
      .from(travelSearchResultsTable)
      .where(and(...conditions))
      .orderBy(desc(travelSearchResultsTable.foundAt))
      .limit(q.data.limit)
      .offset(q.data.offset);

    res.json(rows);
  } catch (err) {
    logger.error({ err, userId }, "travel/search-results list error");
    res.status(500).json({ error: "Error al cargar resultados de búsqueda" });
  }
});

// ── PATCH /travel/search-results/:id/status ──────────────────────────────────
// AND(id, userId) garantiza que solo el dueño puede cambiar el estado.
router.patch("/travel/search-results/:id/status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseStringId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserIdNum(req);

  const parsed = StatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Estado inválido" });
    return;
  }

  try {
    const [updated] = await db
      .update(travelSearchResultsTable)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(
        and(
          eq(travelSearchResultsTable.id, id),
          eq(travelSearchResultsTable.userId, userId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Resultado no encontrado" });
      return;
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err, id, userId }, "travel/search-results status update error");
    res.status(500).json({ error: "Error al actualizar estado del resultado" });
  }
});

// ── GET /travel/locations-catalog ────────────────────────────────────────────
// Lista completa de ubicaciones para el admin. Paginado con offset.
router.get("/travel/locations-catalog", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const schema = z.object({
    limit:  z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  });
  const q = schema.safeParse(req.query);
  const { limit, offset } = q.success ? q.data : { limit: 100, offset: 0 };

  try {
    const rows = await db
      .select()
      .from(travelLocationsTable)
      .orderBy(travelLocationsTable.country, travelLocationsTable.label)
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "travel/locations-catalog error");
    res.status(500).json({ error: "Error al cargar catálogo de ubicaciones" });
  }
});

// ── GET /travel/stats — métricas del módulo (admin) ──────────────────────────
router.get("/travel/stats", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserIdNum(req);
  try {
    const [quotas, schedulerStatus, exchangeRate] = await Promise.all([
      getApiQuotas(),
      getTravelSchedulerStatus(),
      getBnaExchangeRate(),
    ]);
    res.json({ quotas, schedulerStatus, exchangeRate });
  } catch (err) {
    logger.error({ err, userId }, "travel/stats error");
    res.status(500).json({ error: "Error al obtener estadísticas de viajes" });
  }
});

export default router;
