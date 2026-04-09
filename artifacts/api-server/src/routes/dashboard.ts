import { Router, type IRouter } from "express";
import { db, tasksTable, fiscalUpdatesTable, travelOffersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const MOCK_EMAIL_COUNT_24H = 8;
const MOCK_NEWS_COUNT = 8;

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [tasks, fiscal, travel] = await Promise.all([
    db.select().from(tasksTable),
    db.select().from(fiscalUpdatesTable),
    db.select().from(travelOffersTable),
  ]);

  const pendingTasks = tasks.filter((t) => t.status !== "done").length;
  const fiscalUpdatesCount = fiscal.length;
  const fiscalRequireAction = fiscal.filter((f) => f.requiresAction).length;
  const travelOffersCount = travel.filter((t) => t.isValid).length;

  res.json({
    emailCount24h: MOCK_EMAIL_COUNT_24H,
    pendingTasks,
    fiscalUpdatesCount,
    fiscalRequireAction,
    travelOffersCount,
    newsCount: MOCK_NEWS_COUNT,
  });
});

export default router;
