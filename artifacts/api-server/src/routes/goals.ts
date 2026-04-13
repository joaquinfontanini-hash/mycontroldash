import { Router, type IRouter, Request, Response } from "express";
import { eq, and, desc, asc } from "drizzle-orm";
import { db, dailyGoalsTable, strategyGoalsTable } from "@workspace/db";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_CATEGORIES = ["personal", "profesional", "financiero", "salud"] as const;
const VALID_STATUSES = ["active", "paused", "done", "cancelled"] as const;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

router.get("/daily-goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const date = (req.query.date as string) || todayStr();
    const goals = await db.select().from(dailyGoalsTable)
      .where(and(eq(dailyGoalsTable.userId, userId), eq(dailyGoalsTable.date, date)))
      .orderBy(asc(dailyGoalsTable.orderIndex), asc(dailyGoalsTable.createdAt));
    res.json(goals);
  } catch (err) {
    logger.error({ err }, "daily goals fetch error");
    res.status(500).json({ error: "Error al cargar objetivos" });
  }
});

router.get("/daily-goals/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const all = await db.select().from(dailyGoalsTable)
      .where(eq(dailyGoalsTable.userId, userId))
      .orderBy(desc(dailyGoalsTable.date), asc(dailyGoalsTable.orderIndex));
    const grouped: Record<string, typeof all> = {};
    for (const g of all) {
      if (!grouped[g.date]) grouped[g.date] = [];
      grouped[g.date].push(g);
    }
    const history = Object.entries(grouped).slice(0, 30).map(([date, goals]) => ({
      date,
      total: goals.length,
      done: goals.filter(g => g.isDone).length,
      completion: goals.length > 0 ? Math.round((goals.filter(g => g.isDone).length / goals.length) * 100) : 0,
    }));
    res.json(history);
  } catch (err) {
    logger.error({ err }, "daily goals history error");
    res.status(500).json({ error: "Error al cargar historial" });
  }
});

router.post("/daily-goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { title, date, priority, orderIndex } = req.body ?? {};
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title es requerido" });
    return;
  }
  try {
    const [goal] = await db.insert(dailyGoalsTable).values({
      userId,
      title,
      date: (typeof date === "string" ? date : null) ?? todayStr(),
      priority: VALID_PRIORITIES.includes(priority) ? priority : "medium",
      orderIndex: typeof orderIndex === "number" ? orderIndex : 0,
    }).returning();
    res.status(201).json(goal);
  } catch (err) {
    logger.error({ err }, "daily goal create error");
    res.status(500).json({ error: "Error al crear objetivo" });
  }
});

router.patch("/daily-goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(dailyGoalsTable).where(eq(dailyGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const { title, isDone, priority, orderIndex } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof title === "string") updates.title = title;
    if (typeof isDone === "boolean") updates.isDone = isDone;
    if (VALID_PRIORITIES.includes(priority)) updates.priority = priority;
    if (typeof orderIndex === "number") updates.orderIndex = orderIndex;
    const [updated] = await db.update(dailyGoalsTable).set(updates as any).where(eq(dailyGoalsTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "daily goal update error");
    res.status(500).json({ error: "Error al actualizar objetivo" });
  }
});

router.delete("/daily-goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(dailyGoalsTable).where(eq(dailyGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(dailyGoalsTable).where(eq(dailyGoalsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "daily goal delete error");
    res.status(500).json({ error: "Error al eliminar objetivo" });
  }
});

router.get("/strategy-goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const goals = await db.select().from(strategyGoalsTable)
      .where(eq(strategyGoalsTable.userId, userId))
      .orderBy(asc(strategyGoalsTable.startDate));
    res.json(goals);
  } catch (err) {
    logger.error({ err }, "strategy goals fetch error");
    res.status(500).json({ error: "Error al cargar estrategia" });
  }
});

router.post("/strategy-goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { title, category, priority, status, progress, startDate, endDate, notes } = req.body ?? {};
  if (!title || !startDate || !endDate) {
    res.status(400).json({ error: "title, startDate y endDate son requeridos" });
    return;
  }
  try {
    const [goal] = await db.insert(strategyGoalsTable).values({
      userId,
      title,
      category: VALID_CATEGORIES.includes(category) ? category : "profesional",
      priority: VALID_PRIORITIES.includes(priority) ? priority : "medium",
      status: VALID_STATUSES.includes(status) ? status : "active",
      progress: Math.min(100, Math.max(0, parseInt(progress ?? 0, 10))),
      startDate,
      endDate,
      notes: notes ?? null,
    }).returning();
    res.status(201).json(goal);
  } catch (err) {
    logger.error({ err }, "strategy goal create error");
    res.status(500).json({ error: "Error al crear objetivo estratégico" });
  }
});

router.patch("/strategy-goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(strategyGoalsTable).where(eq(strategyGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const { title, category, priority, status, progress, startDate, endDate, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof title === "string") updates.title = title;
    if (VALID_CATEGORIES.includes(category)) updates.category = category;
    if (VALID_PRIORITIES.includes(priority)) updates.priority = priority;
    if (VALID_STATUSES.includes(status)) updates.status = status;
    if (typeof progress === "number") updates.progress = Math.min(100, Math.max(0, progress));
    if (typeof startDate === "string") updates.startDate = startDate;
    if (typeof endDate === "string") updates.endDate = endDate;
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(strategyGoalsTable).set(updates as any).where(eq(strategyGoalsTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "strategy goal update error");
    res.status(500).json({ error: "Error al actualizar objetivo" });
  }
});

router.delete("/strategy-goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(strategyGoalsTable).where(eq(strategyGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(strategyGoalsTable).where(eq(strategyGoalsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "strategy goal delete error");
    res.status(500).json({ error: "Error al eliminar objetivo" });
  }
});

export default router;
