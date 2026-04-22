import { Router, type IRouter, type Request } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/require-auth.js";
import { db, inAppNotificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(requireAuth);

// Helper tipado — elimina los (req as any) repetidos
function getUserId(req: Request): number {
  return (req as AuthenticatedRequest).dbUser.id;
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── GET /notifications ────────────────────────────────────────────────────────
router.get("/", async (req: Request, res): Promise<void> => {
  const userId = getUserId(req);
  try {
    const rows = await db
      .select()
      .from(inAppNotificationsTable)
      .where(eq(inAppNotificationsTable.userId, userId))
      .orderBy(desc(inAppNotificationsTable.createdAt))
      .limit(50);

    res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error({ err, userId }, "in-app-notifications: list failed");
    res.status(500).json({ ok: false, error: "Error al obtener notificaciones" });
  }
});

// ── GET /notifications/unread-count ──────────────────────────────────────────
// Usa COUNT(*) SQL en lugar de cargar filas completas en JS para contar.
// El original hacía .select({ id }) y luego rows.length —
// carga N filas a Node solo para obtener un número.
router.get("/unread-count", async (req: Request, res): Promise<void> => {
  const userId = getUserId(req);
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(inAppNotificationsTable)
      .where(
        and(
          eq(inAppNotificationsTable.userId, userId),
          eq(inAppNotificationsTable.isRead, false),
        ),
      );
    res.json({ ok: true, count: Number(count) });
  } catch (err) {
    logger.error({ err, userId }, "in-app-notifications: unread count failed");
    res.status(500).json({ ok: false, count: 0 });
  }
});

// ── PATCH /notifications/:id/read ────────────────────────────────────────────
// El original devolvía 200 aunque el ID no existiera — .update() sin .returning()
// no distingue "actualizó 0 filas" de "actualizó 1 fila".
// Ahora usa AND(id, userId) con .returning() para verificar que realmente existió.
router.patch("/:id/read", async (req: Request, res): Promise<void> => {
  const userId = getUserId(req);
  const id = parseId(req.params["id"]);
  if (!id) {
    res.status(400).json({ ok: false, error: "ID inválido" });
    return;
  }

  try {
    const [updated] = await db
      .update(inAppNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotificationsTable.id, id),
          eq(inAppNotificationsTable.userId, userId),
        ),
      )
      .returning({ id: inAppNotificationsTable.id });

    // Si no se actualizó ninguna fila: la notif no existe O no pertenece al usuario.
    // Devolver 404 en ambos casos — sin distinguir cuál (evita oracle sobre IDs ajenos).
    if (!updated) {
      res.status(404).json({ ok: false, error: "Notificación no encontrada" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id, userId }, "in-app-notifications: mark read failed");
    res.status(500).json({ ok: false, error: "Error al marcar como leída" });
  }
});

// ── POST /notifications/read-all ──────────────────────────────────────────────
router.post("/read-all", async (req: Request, res): Promise<void> => {
  const userId = getUserId(req);
  try {
    await db
      .update(inAppNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotificationsTable.userId, userId),
          eq(inAppNotificationsTable.isRead, false),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "in-app-notifications: read-all failed");
    res.status(500).json({ ok: false, error: "Error al marcar todas como leídas" });
  }
});

// ── DELETE /notifications/:id ─────────────────────────────────────────────────
// AND(id, userId) garantiza que solo se elimina si pertenece al usuario.
router.delete("/:id", async (req: Request, res): Promise<void> => {
  const userId = getUserId(req);
  const id = parseId(req.params["id"]);
  if (!id) {
    res.status(400).json({ ok: false, error: "ID inválido" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(inAppNotificationsTable)
      .where(
        and(
          eq(inAppNotificationsTable.id, id),
          eq(inAppNotificationsTable.userId, userId),
        ),
      )
      .returning({ id: inAppNotificationsTable.id });

    if (!deleted) {
      res.status(404).json({ ok: false, error: "Notificación no encontrada" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id, userId }, "in-app-notifications: delete failed");
    res.status(500).json({ ok: false, error: "Error al eliminar notificación" });
  }
});

export default router;
