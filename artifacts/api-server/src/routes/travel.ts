import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, travelOffersTable } from "@workspace/db";
import {
  GetTravelOfferParams,
  ListTravelOffersQueryParams,
} from "@workspace/api-zod";
import { scoreTravelOffer, logDiscard, DEFAULT_QUALITY_THRESHOLD } from "../services/data-quality.service.js";
import { logger } from "../lib/logger.js";
import { requireModule } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/travel", async (req, res): Promise<void> => {
  const query = ListTravelOffersQueryParams.safeParse(req.query);
  let items = await db.select().from(travelOffersTable).orderBy(desc(travelOffersTable.createdAt));

  if (query.success) {
    const { type, region, budgetMax, durationMax } = query.data;
    if (type) items = items.filter((t) => t.travelType === type);
    if (region) items = items.filter((t) => t.region === region);
    if (budgetMax != null) items = items.filter((t) => Number(t.price) <= budgetMax);
    if (durationMax != null) items = items.filter((t) => t.duration <= durationMax);
  }

  const threshold = DEFAULT_QUALITY_THRESHOLD;
  items = items.filter(t => (t.qualityScore ?? 70) >= threshold);

  res.json(items);
});

router.get("/travel/quality", async (_req, res): Promise<void> => {
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

router.post("/travel/score-all", async (_req, res): Promise<void> => {
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

router.get("/travel/:id", async (req, res): Promise<void> => {
  const params = GetTravelOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [item] = await db.select().from(travelOffersTable).where(eq(travelOffersTable.id, params.data.id));
  if (!item) {
    res.status(404).json({ error: "Travel offer not found" });
    return;
  }
  res.json(item);
});

export default router;
