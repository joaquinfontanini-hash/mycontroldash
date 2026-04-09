import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, shortcutsTable } from "@workspace/db";
import {
  CreateShortcutBody,
  UpdateShortcutBody,
  UpdateShortcutParams,
  DeleteShortcutParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/shortcuts", async (_req, res): Promise<void> => {
  const shortcuts = await db.select().from(shortcutsTable).orderBy(shortcutsTable.createdAt);
  res.json(shortcuts);
});

router.post("/shortcuts", async (req, res): Promise<void> => {
  const parsed = CreateShortcutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shortcut] = await db.insert(shortcutsTable).values(parsed.data).returning();
  res.status(201).json(shortcut);
});

router.patch("/shortcuts/:id", async (req, res): Promise<void> => {
  const params = UpdateShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateShortcutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [shortcut] = await db.update(shortcutsTable).set(parsed.data).where(eq(shortcutsTable.id, params.data.id)).returning();
  if (!shortcut) {
    res.status(404).json({ error: "Shortcut not found" });
    return;
  }
  res.json(shortcut);
});

router.delete("/shortcuts/:id", async (req, res): Promise<void> => {
  const params = DeleteShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [shortcut] = await db.delete(shortcutsTable).where(eq(shortcutsTable.id, params.data.id)).returning();
  if (!shortcut) {
    res.status(404).json({ error: "Shortcut not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
