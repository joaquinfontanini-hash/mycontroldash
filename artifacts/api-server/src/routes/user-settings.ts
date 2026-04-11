import { Router, type IRouter, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, userSettingsTable, USER_SETTINGS_DEFAULTS } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

function getUserId(req: Request): string | null {
  const { userId } = getAuth(req);
  return userId ?? null;
}

router.get("/user-settings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "No autenticado" }); return; }
  try {
    const rows = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    const map: Record<string, string> = { ...USER_SETTINGS_DEFAULTS };
    for (const row of rows) map[row.key] = row.value;
    res.json(map);
  } catch (err) {
    logger.error({ err }, "user settings fetch error");
    res.status(500).json({ error: "Error al cargar configuración" });
  }
});

router.put("/user-settings/:key", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "No autenticado" }); return; }
  const key = req.params.key as string;
  const { value } = req.body ?? {};
  if (typeof value !== "string") { res.status(400).json({ error: "value (string) requerido" }); return; }
  if (!key || key.length > 100) { res.status(400).json({ error: "key inválida" }); return; }
  if (value.length > 1000) { res.status(400).json({ error: "value demasiado largo" }); return; }
  try {
    const existing = await db.select({ id: userSettingsTable.id })
      .from(userSettingsTable)
      .where(and(eq(userSettingsTable.userId, userId), eq(userSettingsTable.key, key)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(userSettingsTable)
        .set({ value })
        .where(and(eq(userSettingsTable.userId, userId), eq(userSettingsTable.key, key)));
    } else {
      await db.insert(userSettingsTable).values({ userId, key, value });
    }
    res.json({ key, value });
  } catch (err) {
    logger.error({ err }, "user setting upsert error");
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

router.delete("/user-settings/:key", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "No autenticado" }); return; }
  const key = req.params.key as string;
  try {
    await db.delete(userSettingsTable)
      .where(and(eq(userSettingsTable.userId, userId), eq(userSettingsTable.key, key)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "user setting delete error");
    res.status(500).json({ error: "Error al eliminar configuración" });
  }
});

export default router;
