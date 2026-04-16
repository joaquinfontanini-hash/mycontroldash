import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { db, inAppNotificationsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(requireAuth);

// ── GET /api/notifications ────────────────────────────────────────────────────
router.get("/", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  try {
    const rows = await db
      .select()
      .from(inAppNotificationsTable)
      .where(eq(inAppNotificationsTable.userId, userId))
      .orderBy(desc(inAppNotificationsTable.createdAt))
      .limit(50);
    res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error({ err, userId }, "notifications: list failed");
    res.status(500).json({ ok: false, error: "Error al obtener notificaciones" });
  }
});

// ── GET /api/notifications/unread-count ───────────────────────────────────────
router.get("/unread-count", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  try {
    const rows = await db
      .select({ id: inAppNotificationsTable.id })
      .from(inAppNotificationsTable)
      .where(and(eq(inAppNotificationsTable.userId, userId), eq(inAppNotificationsTable.isRead, false)));
    res.json({ ok: true, count: rows.length });
  } catch (err) {
    logger.error({ err }, "notifications: unread count failed");
    res.status(500).json({ ok: false, count: 0 });
  }
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────
router.patch("/:id/read", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const id = parseInt(req.params.id, 10);
  try {
    await db
      .update(inAppNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(inAppNotificationsTable.id, id), eq(inAppNotificationsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "notifications: mark read failed");
    res.status(500).json({ ok: false });
  }
});

// ── POST /api/notifications/read-all ─────────────────────────────────────────
router.post("/read-all", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  try {
    await db
      .update(inAppNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(inAppNotificationsTable.userId, userId), eq(inAppNotificationsTable.isRead, false)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "notifications: read-all failed");
    res.status(500).json({ ok: false });
  }
});

// ── DELETE /api/notifications/:id ────────────────────────────────────────────
router.delete("/:id", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id as number;
  const id = parseInt(req.params.id, 10);
  try {
    await db
      .delete(inAppNotificationsTable)
      .where(and(eq(inAppNotificationsTable.id, id), eq(inAppNotificationsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "notifications: delete failed");
    res.status(500).json({ ok: false });
  }
});

export default router;
