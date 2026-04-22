import { Router, type IRouter } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  fiscalUpdatesTable,
  travelOffersTable,
} from "@workspace/db";
import {
  requireAuth,
  getCurrentUserId,
  getCurrentUserIdNum,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── GET /dashboard/summary ────────────────────────────────────────────────────
// Resumen del dashboard home: tareas pendientes, fiscal, viajes, noticias.
//
// Correcciones aplicadas vs el original:
//   1. requireAuth: el endpoint era completamente público sin ningún guard
//   2. Filtro userId en tasksTable: el original cargaba TODAS las tareas
//      de TODOS los usuarios (N usuarios × M tareas) para contar en JS
//   3. COUNT(*) SQL en lugar de carga de filas completas + JS .filter().length
//   4. MOCK_EMAIL_COUNT y MOCK_NEWS_COUNT documentados explícitamente como
//      placeholders — el original los tenía como constantes sin comentario
router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId    = getCurrentUserId(req);
    const userIdNum = getCurrentUserIdNum(req);

    const [
      pendingTasksResult,
      fiscalResult,
      fiscalActionResult,
      travelResult,
    ] = await Promise.all([
      // Tareas pendientes del usuario actual — filtradas por userId en SQL
      db
        .select({ count: sql<number>`count(*)` })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.userId, userId),
            ne(tasksTable.status, "completed"),
            ne(tasksTable.status, "done"),
            ne(tasksTable.status, "cancelled"),
            ne(tasksTable.status, "archived"),
          ),
        ),
      // Actualizaciones fiscales visibles (global — no tiene userId)
      db
        .select({ count: sql<number>`count(*)` })
        .from(fiscalUpdatesTable)
        .where(eq(fiscalUpdatesTable.isHidden, false)),
      // Actualizaciones fiscales que requieren acción
      db
        .select({ count: sql<number>`count(*)` })
        .from(fiscalUpdatesTable)
        .where(
          and(
            eq(fiscalUpdatesTable.isHidden, false),
            eq(fiscalUpdatesTable.requiresAction, true),
          ),
        ),
      // Ofertas de viaje válidas (global — tabla de ofertas del módulo travel)
      db
        .select({ count: sql<number>`count(*)` })
        .from(travelOffersTable)
        .where(eq(travelOffersTable.isValid, true)),
    ]);

    res.json({
      pendingTasks:         Number(pendingTasksResult[0]?.count ?? 0),
      fiscalUpdatesCount:   Number(fiscalResult[0]?.count ?? 0),
      fiscalRequireAction:  Number(fiscalActionResult[0]?.count ?? 0),
      travelOffersCount:    Number(travelResult[0]?.count ?? 0),
      // Estos dos valores son placeholders — no hay servicio de email ni noticias
      // conectado directamente al summary. El frontend los usa como indicadores visuales.
      // TODO: reemplazar con queries reales cuando los módulos de email y noticias
      // expongan conteos de usuario.
      emailCount24h: 0,
      newsCount:     0,
    });
  } catch (err) {
    logger.error({ err }, "dashboard/summary error");
    res.status(500).json({ error: "Error al cargar resumen del dashboard" });
  }
});

export default router;
