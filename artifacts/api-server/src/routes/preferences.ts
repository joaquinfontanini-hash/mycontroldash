import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { db, userPreferencesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(requireAuth);

// ── GET /api/me/preferences ───────────────────────────────────────────────────
router.get("/", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  try {
    const rows = await db
      .select()
      .from(userPreferencesTable)
      .where(eq(userPreferencesTable.userId, userId));

    const prefs: Record<string, unknown> = {};
    for (const row of rows) {
      try { prefs[row.key] = JSON.parse(row.jsonValue); }
      catch { prefs[row.key] = row.jsonValue; }
    }
    res.json({ ok: true, data: prefs });
  } catch (err) {
    logger.error({ err, userId }, "preferences: get failed");
    res.status(500).json({ ok: false, error: "Error al obtener preferencias" });
  }
});

// ── GET /api/me/preferences/:key ─────────────────────────────────────────────
router.get("/:key", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const { key } = req.params;
  try {
    const [row] = await db
      .select()
      .from(userPreferencesTable)
      .where(and(eq(userPreferencesTable.userId, userId), eq(userPreferencesTable.key, key)));
    if (!row) { res.json({ ok: true, data: null }); return; }
    let value: unknown;
    try { value = JSON.parse(row.jsonValue); } catch { value = row.jsonValue; }
    res.json({ ok: true, data: value });
  } catch (err) {
    logger.error({ err }, "preferences: get key failed");
    res.status(500).json({ ok: false });
  }
});

// ── PUT /api/me/preferences/:key ─────────────────────────────────────────────
router.put("/:key", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) { res.status(400).json({ ok: false, error: "value required" }); return; }
  try {
    await db
      .insert(userPreferencesTable)
      .values({ userId, key, jsonValue: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: [userPreferencesTable.userId, userPreferencesTable.key],
        set: { jsonValue: JSON.stringify(value) },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, key }, "preferences: put failed");
    res.status(500).json({ ok: false, error: "Error al guardar preferencia" });
  }
});

// ── PUT /api/me/preferences (bulk) ───────────────────────────────────────────
router.put("/", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const body = req.body as Record<string, unknown>;
  if (typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "body must be an object" });
    return;
  }
  try {
    for (const [key, value] of Object.entries(body)) {
      await db
        .insert(userPreferencesTable)
        .values({ userId, key, jsonValue: JSON.stringify(value) })
        .onConflictDoUpdate({
          target: [userPreferencesTable.userId, userPreferencesTable.key],
          set: { jsonValue: JSON.stringify(value) },
        });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "preferences: bulk put failed");
    res.status(500).json({ ok: false, error: "Error al guardar preferencias" });
  }
});

// ── DELETE /api/me/preferences/:key ──────────────────────────────────────────
router.delete("/:key", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const { key } = req.params;
  try {
    await db
      .delete(userPreferencesTable)
      .where(and(eq(userPreferencesTable.userId, userId), eq(userPreferencesTable.key, key)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, key }, "preferences: delete failed");
    res.status(500).json({ ok: false });
  }
});

export default router;
