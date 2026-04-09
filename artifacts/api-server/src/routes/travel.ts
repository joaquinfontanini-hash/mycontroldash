import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, travelOffersTable } from "@workspace/db";
import {
  GetTravelOfferParams,
  ListTravelOffersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/travel", async (req, res): Promise<void> => {
  const query = ListTravelOffersQueryParams.safeParse(req.query);
  let items = await db.select().from(travelOffersTable).orderBy(travelOffersTable.createdAt);

  if (query.success) {
    const { type, region, budgetMax, durationMax } = query.data;
    if (type) items = items.filter((t) => t.travelType === type);
    if (region) items = items.filter((t) => t.region === region);
    if (budgetMax != null) items = items.filter((t) => Number(t.price) <= budgetMax);
    if (durationMax != null) items = items.filter((t) => t.duration <= durationMax);
  }
  res.json(items);
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
