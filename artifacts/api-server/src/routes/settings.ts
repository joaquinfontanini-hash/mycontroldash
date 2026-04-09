import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function ensureSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (!existing) {
    const [created] = await db.insert(appSettingsTable).values({}).returning();
    return created;
  }
  return existing;
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await ensureSettings();
  res.json(settings);
});

router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await ensureSettings();
  const [updated] = await db
    .update(appSettingsTable)
    .set(parsed.data)
    .where(eq(appSettingsTable.id, existing.id))
    .returning();
  res.json(updated);
});

export default router;
