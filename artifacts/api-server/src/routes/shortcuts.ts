import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, shortcutsTable } from "@workspace/db";
import {
  CreateShortcutBody,
  UpdateShortcutBody,
  UpdateShortcutParams,
  DeleteShortcutParams,
} from "@workspace/api-zod";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const shortcuts = await db
    .select()
    .from(shortcutsTable)
    .where(eq(shortcutsTable.userId, userId))
    .orderBy(shortcutsTable.createdAt);
  res.json(shortcuts);
});

router.post("/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const parsed = CreateShortcutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shortcut] = await db.insert(shortcutsTable).values({ ...parsed.data, userId }).returning();
  res.status(201).json(shortcut);
});

router.patch("/shortcuts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(shortcutsTable).where(eq(shortcutsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;

  const parsed = UpdateShortcutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shortcut] = await db.update(shortcutsTable).set(parsed.data).where(eq(shortcutsTable.id, params.data.id)).returning();
  res.json(shortcut);
});

router.delete("/shortcuts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(shortcutsTable).where(eq(shortcutsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;

  await db.delete(shortcutsTable).where(eq(shortcutsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
