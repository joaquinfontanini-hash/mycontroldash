import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, lte, sql as drizzleSql } from "drizzle-orm";
import { db, travelOffersTable } from "@workspace/db";
import { z } from "zod";
import { scoreTravelOffer, logDiscard, DEFAULT_QUALITY_THRESHOLD } from "../services/data-quality.service.js";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const TravelOfferBody = z.object({
  origin:        z.string().optional().nullable(),
  destination:   z.string().min(1, "Destino requerido"),
  description:   z.string().optional().nullable(),
  price:         z.coerce.number().min(0, "Precio inválido"),
  currency:      z.enum(["ARS", "USD", "EUR"]).default("USD"),
  provider:      z.string().min(1, "Proveedor requerido"),
  offerType:     z.string().default("paquete"),
  travelType:    z.enum(["nacional", "internacional", "corporativo"]).default("nacional"),
  duration:      z.coerce.number().int().min(1, "Duración mínima 1 día"),
  departureDate: z.string().optional().nullable(),
  passengers:    z.coerce.number().int().min(1).optional().nullable(),
  hotel:         z.string().optional().nullable(),
  hotelCategory: z.coerce.number().int().min(1).max(5).optional().nullable(),
  region:        z.string().min(1, "Región requerida"),
  link:          z.string().url("Link inválido").or(z.literal("#")).default("#"),
  validUntil:    z.string().optional().nullable(),
});

const ListQuery = z.object({
  type:       z.string().optional(),
  region:     z.string().optional(),
  budgetMax:  z.coerce.number().optional(),
  durationMax: z.coerce.number().optional(),
});

// ── GET /travel — list offers ──────────────────────────────────────────────────

router.get("/travel", async (req: Request, res: Response): Promise<void> => {
  const query = ListQuery.safeParse(req.query);

  const conditions = [];
  conditions.push(eq(travelOffersTable.isValid, true));

  if (query.success) {
    const { type, region, budgetMax, durationMax } = query.data;
    if (type)        conditions.push(eq(travelOffersTable.travelType, type));
    if (region)      conditions.push(eq(travelOffersTable.region, region));
    if (budgetMax != null)   conditions.push(drizzleSql`${travelOffersTable.price} <= ${budgetMax}`);
    if (durationMax != null) conditions.push(lte(travelOffersTable.duration, durationMax));
  }

  const items = await db
    .select()
    .from(travelOffersTable)
    .where(and(...conditions))
    .orderBy(desc(travelOffersTable.createdAt));

  res.json(items);
});

// ── GET /travel/quality — quality metrics ──────────────────────────────────────

router.get("/travel/quality", async (_req: Request, res: Response): Promise<void> => {
  try {
    const all = await db.select().from(travelOffersTable);
    const scores = all.map(t => t.qualityScore ?? 70);
    res.json({
      total: all.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      needsReview: all.filter(t => t.needsReview).length,
      highQuality: all.filter(t => (t.qualityScore ?? 70) >= 80).length,
      lowQuality: all.filter(t => (t.qualityScore ?? 70) < 60).length,
    });
  } catch (err) {
    logger.error({ err }, "Travel quality metrics error");
    res.status(500).json({ error: "Error al calcular métricas de calidad" });
  }
});

// ── POST /travel/score-all — re-score (admin only) ─────────────────────────────

router.post("/travel/score-all", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const all = await db.select().from(travelOffersTable);
    let updated = 0;
    let discarded = 0;

    for (const offer of all) {
      const quality = scoreTravelOffer({
        destination: offer.destination,
        price: offer.price,
        link: offer.link,
        duration: offer.duration,
        validUntil: offer.validUntil,
        provider: offer.provider,
      });

      if (quality.discard) {
        await logDiscard({
          module: "travel",
          source: offer.provider,
          title: offer.destination,
          sourceUrl: offer.link,
          reason: quality.discardReason ?? "Calidad insuficiente",
        });
        discarded++;
      }

      await db.update(travelOffersTable)
        .set({
          qualityScore: quality.score,
          qualityIssues: quality.issues.length > 0 ? JSON.stringify(quality.issues) : null,
          needsReview: quality.needsReview,
          isValid: !quality.discard,
        })
        .where(eq(travelOffersTable.id, offer.id));

      updated++;
    }

    res.json({ ok: true, updated, discarded });
  } catch (err) {
    logger.error({ err }, "Travel score-all error");
    res.status(500).json({ error: "Error al puntuar ofertas de viaje" });
  }
});

// ── POST /travel — create offer ────────────────────────────────────────────────

router.post("/travel", async (req: Request, res: Response): Promise<void> => {
  const parsed = TravelOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" });
    return;
  }

  const data = parsed.data;

  const [created] = await db.insert(travelOffersTable).values({
    origin:        data.origin ?? null,
    destination:   data.destination,
    description:   data.description ?? null,
    price:         data.price.toString(),
    currency:      data.currency,
    provider:      data.provider,
    offerType:     data.offerType,
    travelType:    data.travelType,
    duration:      data.duration,
    departureDate: data.departureDate ?? null,
    passengers:    data.passengers ?? null,
    hotel:         data.hotel ?? null,
    hotelCategory: data.hotelCategory ?? null,
    region:        data.region,
    link:          data.link,
    validUntil:    data.validUntil ?? null,
    isValid:       true,
    qualityScore:  80,
    needsReview:   false,
  }).returning();

  res.status(201).json(created);
});

// ── PUT /travel/:id — update offer ────────────────────────────────────────────

router.put("/travel/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = TravelOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" });
    return;
  }

  const data = parsed.data;

  const [updated] = await db.update(travelOffersTable)
    .set({
      origin:        data.origin ?? null,
      destination:   data.destination,
      description:   data.description ?? null,
      price:         data.price.toString(),
      currency:      data.currency,
      provider:      data.provider,
      offerType:     data.offerType,
      travelType:    data.travelType,
      duration:      data.duration,
      departureDate: data.departureDate ?? null,
      passengers:    data.passengers ?? null,
      hotel:         data.hotel ?? null,
      hotelCategory: data.hotelCategory ?? null,
      region:        data.region,
      link:          data.link,
      validUntil:    data.validUntil ?? null,
    })
    .where(eq(travelOffersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Oferta no encontrada" });
    return;
  }

  res.json(updated);
});

// ── DELETE /travel/:id ────────────────────────────────────────────────────────

router.delete("/travel/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [deleted] = await db.delete(travelOffersTable)
    .where(eq(travelOffersTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Oferta no encontrada" });
    return;
  }

  res.status(204).send();
});

// ── GET /travel/:id ────────────────────────────────────────────────────────────

router.get("/travel/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [item] = await db.select().from(travelOffersTable).where(eq(travelOffersTable.id, id));
  if (!item) {
    res.status(404).json({ error: "Oferta no encontrada" });
    return;
  }

  res.json(item);
});

export default router;
