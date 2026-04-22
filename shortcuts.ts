import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, shortcutsTable } from "@workspace/db";
import {
  CreateShortcutBody,
  UpdateShortcutBody,
  UpdateShortcutParams,
  DeleteShortcutParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  assertOwnership,
  getCurrentUserId,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── GET /shortcuts ────────────────────────────────────────────────────────────
router.get("/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  try {
    const shortcuts = await db
      .select()
      .from(shortcutsTable)
      .where(eq(shortcutsTable.userId, userId))
      .orderBy(shortcutsTable.createdAt);
    res.json(shortcuts);
  } catch (err) {
    logger.error({ err, userId }, "shortcuts/list error");
    res.status(500).json({ error: "Error al cargar accesos rápidos" });
  }
});

// ── POST /shortcuts ───────────────────────────────────────────────────────────
router.post("/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);

  const parsed = CreateShortcutBody.safeParse(req.body);
  if (!parsed.success) {
    // issues[0].message en lugar de error.message (serialización Zod completa)
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }

  try {
    const [shortcut] = await db
      .insert(shortcutsTable)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(shortcut);
  } catch (err) {
    logger.error({ err, userId }, "shortcuts/create error");
    res.status(500).json({ error: "Error al crear acceso rápido" });
  }
});

// ── PATCH /shortcuts/:id ──────────────────────────────────────────────────────
router.patch("/shortcuts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message ?? "ID inválido" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(shortcutsTable)
      .where(eq(shortcutsTable.id, params.data.id));
    if (!existing) { res.status(404).json({ error: "Acceso rápido no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const parsed = UpdateShortcutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [shortcut] = await db
      .update(shortcutsTable)
      .set(parsed.data)
      .where(eq(shortcutsTable.id, params.data.id))
      .returning();
    res.json(shortcut);
  } catch (err) {
    logger.error({ err }, "shortcuts/update error");
    res.status(500).json({ error: "Error al actualizar acceso rápido" });
  }
});

// ── DELETE /shortcuts/:id ─────────────────────────────────────────────────────
router.delete("/shortcuts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteShortcutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message ?? "ID inválido" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(shortcutsTable)
      .where(eq(shortcutsTable.id, params.data.id));
    if (!existing) { res.status(404).json({ error: "Acceso rápido no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(shortcutsTable).where(eq(shortcutsTable.id, params.data.id));
    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "shortcuts/delete error");
    res.status(500).json({ error: "Error al eliminar acceso rápido" });
  }
});

export default router;
