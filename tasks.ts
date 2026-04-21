import { Router, type IRouter, type Request } from "express";
import { eq, and, or, desc, inArray, isNull, ilike } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  tasksTable,
  taskCommentsTable,
  taskHistoryTable,
  usersTable,
} from "@workspace/db";
import {
  requireAuth,
  getCurrentUserId,
  type AuthenticatedRequest,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TaskRow = typeof tasksTable.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getRole(req: Request): string {
  return (req as AuthenticatedRequest).dbUser.role;
}

function isTaskVisible(
  task: TaskRow,
  userId: string,
  role: string,
): boolean {
  if (role === "super_admin" || role === "admin") return true;
  return task.userId === userId || task.assignedToUserId === userId;
}

function canEditTask(task: TaskRow, userId: string, role: string): boolean {
  if (role === "super_admin" || role === "admin") return true;
  return task.userId === userId;
}

function canActOnTask(task: TaskRow, userId: string, role: string): boolean {
  if (role === "super_admin" || role === "admin") return true;
  return task.userId === userId || task.assignedToUserId === userId;
}

async function logHistory(
  taskId: number,
  userId: string,
  action: string,
  opts?: { previous?: string; next?: string; comment?: string },
): Promise<void> {
  try {
    await db.insert(taskHistoryTable).values({
      taskId,
      userId,
      action,
      previousValue: opts?.previous ?? null,
      newValue:      opts?.next    ?? null,
      comment:       opts?.comment ?? null,
    });
  } catch (err) {
    logger.error({ err }, "logHistory error");
  }
}

async function getUserName(userId: string): Promise<string> {
  try {
    const id = parseInt(userId, 10);
    if (isNaN(id)) return userId;
    const [u] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, id));
    return u?.name ?? u?.email ?? userId;
  } catch {
    return userId;
  }
}

// Enriquece un batch de tareas con los nombres de creador y asignado.
// Usa una sola query inArray en lugar de N queries individuales.
async function enrichTasks(
  tasks: TaskRow[],
): Promise<(TaskRow & { creatorName?: string; assigneeName?: string })[]> {
  if (tasks.length === 0) return tasks;

  const userIds = new Set<number>();
  for (const t of tasks) {
    if (t.userId) {
      const n = parseInt(t.userId, 10);
      if (!isNaN(n)) userIds.add(n);
    }
    if (t.assignedToUserId) {
      const n = parseInt(t.assignedToUserId, 10);
      if (!isNaN(n)) userIds.add(n);
    }
  }
  if (userIds.size === 0) return tasks;

  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.id, Array.from(userIds)));

  const nameMap = new Map(
    users.map((u) => [String(u.id), u.name ?? u.email ?? String(u.id)]),
  );

  return tasks.map((t) => ({
    ...t,
    creatorName:  t.userId             ? nameMap.get(t.userId)             : undefined,
    assigneeName: t.assignedToUserId   ? nameMap.get(t.assignedToUserId)   : undefined,
  }));
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const TASK_STATUSES = [
  "pending", "pending_acceptance", "in_progress", "in-progress",
  "completed", "done", "cancelled", "rejected", "archived",
] as const;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const CreateTaskBody = z.object({
  title:               z.string().trim().min(1).max(300),
  description:         z.string().max(5000).optional().nullable(),
  priority:            z.enum(PRIORITIES).default("medium"),
  dueDate:             z.string().optional().nullable(),
  assignedToUserId:    z.string().optional().nullable(),
  requiresAcceptance:  z.boolean().default(false),
  initialObservations: z.string().max(2000).optional().nullable(),
});

const UpdateTaskBody = z.object({
  title:               z.string().trim().min(1).max(300).optional(),
  description:         z.string().max(5000).optional().nullable(),
  priority:            z.enum(PRIORITIES).optional(),
  dueDate:             z.string().optional().nullable(),
  initialObservations: z.string().max(2000).optional().nullable(),
});

const ProgressBody = z.object({
  progress: z.number().int().min(0).max(100),
  status:   z.enum(TASK_STATUSES).optional(),
  comment:  z.string().max(1000).optional().nullable(),
});

const RejectBody = z.object({
  reason: z.string().max(1000).optional().nullable(),
});

const ReassignBody = z.object({
  assignedToUserId:   z.string().nullable(),
  requiresAcceptance: z.boolean().optional(),
});

const CommentBody = z.object({
  content: z.string().trim().min(1).max(2000),
});

const ListTasksQuery = z.object({
  view: z.enum([
    "all", "created_by_me", "assigned_to_me",
    "pending_acceptance", "completed", "archived",
  ]).optional().default("all"),
  status:   z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  search:   z.string().max(200).optional(),
});

const SubtaskStatusBody = z.object({
  status: z.enum(["pending", "in_progress", "completed"]),
});

// ── GET /tasks ────────────────────────────────────────────────────────────────
// Los filtros principales se ejecutan en SQL.
// El filtro de visibilidad (RBAC) se aplica en JS porque depende de lógica de rol
// que no está en la DB. El resto (status, priority, search) va a SQL.
router.get("/tasks", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const q = ListTasksQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query inválida" });
      return;
    }
    const { view, status: statusFilter, priority: priorityFilter, search } = q.data;

    // ── Construir condiciones SQL ─────────────────────────────────────────────
    // Solo top-level tasks (no subtareas) en la lista principal
    const conditions = [isNull(tasksTable.parentTaskId)];

    // Visibilidad: admins ven todo, editors/viewers solo ven sus tareas
    if (role !== "super_admin" && role !== "admin") {
      conditions.push(
        or(
          eq(tasksTable.userId, userId),
          eq(tasksTable.assignedToUserId, userId),
        )!,
      );
    }

    // Filtros de vista — traducidos a condiciones SQL
    switch (view) {
      case "created_by_me":
        conditions.push(eq(tasksTable.userId, userId));
        break;
      case "assigned_to_me":
        conditions.push(eq(tasksTable.assignedToUserId, userId));
        break;
      case "pending_acceptance":
        conditions.push(eq(tasksTable.status, "pending_acceptance"));
        conditions.push(eq(tasksTable.assignedToUserId, userId));
        break;
      case "completed":
        conditions.push(
          or(
            eq(tasksTable.status, "completed"),
            eq(tasksTable.status, "done"),
          )!,
        );
        break;
      case "archived":
        conditions.push(
          or(
            eq(tasksTable.status, "archived"),
            eq(tasksTable.status, "cancelled"),
            eq(tasksTable.status, "rejected"),
          )!,
        );
        break;
      // "all": sin filtro adicional de vista
    }

    // Filtros adicionales en SQL
    if (statusFilter)   conditions.push(eq(tasksTable.status, statusFilter));
    if (priorityFilter) conditions.push(eq(tasksTable.priority, priorityFilter));
    if (search) {
      conditions.push(
        or(
          ilike(tasksTable.title, `%${search}%`),
          ilike(tasksTable.description, `%${search}%`),
        )!,
      );
    }

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(and(...conditions))
      .orderBy(desc(tasksTable.updatedAt));

    const enriched = await enrichTasks(tasks);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/list error");
    res.status(500).json({ error: "Error al cargar tareas" });
  }
});

// ── POST /tasks ───────────────────────────────────────────────────────────────
router.post("/tasks", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const parsed = CreateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const { assignedToUserId, requiresAcceptance, ...rest } = parsed.data;

    // Estado inicial según asignación
    let status = "pending";
    if (assignedToUserId) {
      status = requiresAcceptance ? "pending_acceptance" : "in_progress";
    }

    const [task] = await db
      .insert(tasksTable)
      .values({
        ...rest,
        userId,
        assignedToUserId:   assignedToUserId ?? null,
        requiresAcceptance: requiresAcceptance ?? false,
        status,
        progress: 0,
      })
      .returning();

    await logHistory(task.id, userId, "created", {
      next:    task.title,
      comment: assignedToUserId
        ? `Asignada a usuario ${assignedToUserId}`
        : undefined,
    });

    const [enriched] = await enrichTasks([task]);
    res.status(201).json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/create error");
    res.status(500).json({ error: "Error al crear tarea" });
  }
});

// ── GET /tasks/:id ────────────────────────────────────────────────────────────
router.get("/tasks/:id", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!task || !isTaskVisible(task, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }

    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/get error");
    res.status(500).json({ error: "Error al cargar tarea" });
  }
});

// ── PATCH /tasks/:id ─────────────────────────────────────────────────────────
router.patch("/tasks/:id", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const parsed = UpdateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede editar esta tarea" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set(parsed.data)
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "edited", { comment: "Tarea editada" });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/update error");
    res.status(500).json({ error: "Error al actualizar tarea" });
  }
});

// ── DELETE /tasks/:id ─────────────────────────────────────────────────────────
router.delete("/tasks/:id", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede eliminar esta tarea" });
      return;
    }

    // Eliminar history y comments en paralelo, luego la tarea
    await Promise.all([
      db.delete(taskHistoryTable).where(eq(taskHistoryTable.taskId, id)),
      db.delete(taskCommentsTable).where(eq(taskCommentsTable.taskId, id)),
    ]);
    await db.delete(tasksTable).where(eq(tasksTable.id, id));

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "tasks/delete error");
    res.status(500).json({ error: "Error al eliminar tarea" });
  }
});

// ── POST /tasks/:id/accept ────────────────────────────────────────────────────
router.post("/tasks/:id/accept", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (
      existing.assignedToUserId !== userId &&
      role !== "super_admin" &&
      role !== "admin"
    ) {
      res.status(403).json({ error: "Solo el asignado puede aceptar esta tarea" });
      return;
    }
    if (existing.status !== "pending_acceptance") {
      res.status(409).json({ error: "La tarea no está pendiente de aceptación" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set({ status: "in_progress" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "accepted", {
      previous: "pending_acceptance",
      next:     "in_progress",
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/accept error");
    res.status(500).json({ error: "Error al aceptar tarea" });
  }
});

// ── POST /tasks/:id/reject ────────────────────────────────────────────────────
router.post("/tasks/:id/reject", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);
    const parsed = RejectBody.safeParse(req.body);
    const reason = parsed.success ? (parsed.data.reason ?? null) : null;

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (
      existing.assignedToUserId !== userId &&
      role !== "super_admin" &&
      role !== "admin"
    ) {
      res.status(403).json({ error: "Solo el asignado puede rechazar esta tarea" });
      return;
    }
    if (existing.status !== "pending_acceptance") {
      res.status(409).json({ error: "La tarea no está pendiente de aceptación" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set({ status: "rejected", rejectionReason: reason })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "rejected", {
      previous: "pending_acceptance",
      next:     "rejected",
      comment:  reason ?? undefined,
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/reject error");
    res.status(500).json({ error: "Error al rechazar tarea" });
  }
});

// ── PATCH /tasks/:id/progress ─────────────────────────────────────────────────
router.patch("/tasks/:id/progress", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);
    const parsed = ProgressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canActOnTask(existing, userId, role)) {
      res.status(403).json({ error: "No tenés permiso para actualizar esta tarea" });
      return;
    }

    const updates: Partial<typeof tasksTable.$inferInsert> = {
      progress: parsed.data.progress,
    };

    if (parsed.data.status) {
      updates.status = parsed.data.status;
    } else if (parsed.data.progress === 100) {
      updates.status      = "completed";
      updates.completedAt = new Date();
    }

    const [task] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "progress_updated", {
      previous: String(existing.progress),
      next:     String(parsed.data.progress),
      comment:  parsed.data.comment ?? undefined,
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/progress error");
    res.status(500).json({ error: "Error al actualizar avance" });
  }
});

// ── POST /tasks/:id/complete ──────────────────────────────────────────────────
router.post("/tasks/:id/complete", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canActOnTask(existing, userId, role)) {
      res.status(403).json({ error: "No tenés permiso" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set({ status: "completed", progress: 100, completedAt: new Date() })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "completed", {
      previous: existing.status,
      next:     "completed",
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/complete error");
    res.status(500).json({ error: "Error al completar tarea" });
  }
});

// ── POST /tasks/:id/cancel ────────────────────────────────────────────────────
router.post("/tasks/:id/cancel", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede cancelar esta tarea" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set({ status: "cancelled" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "cancelled", {
      previous: existing.status,
      next:     "cancelled",
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/cancel error");
    res.status(500).json({ error: "Error al cancelar tarea" });
  }
});

// ── POST /tasks/:id/archive ───────────────────────────────────────────────────
router.post("/tasks/:id/archive", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede archivar esta tarea" });
      return;
    }

    const [task] = await db
      .update(tasksTable)
      .set({ status: "archived" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "archived", {
      previous: existing.status,
      next:     "archived",
    });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/archive error");
    res.status(500).json({ error: "Error al archivar tarea" });
  }
});

// ── POST /tasks/:id/reassign ──────────────────────────────────────────────────
router.post("/tasks/:id/reassign", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);
    const parsed = ReassignBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!existing || !isTaskVisible(existing, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede reasignar esta tarea" });
      return;
    }

    const { assignedToUserId: newAssignee, requiresAcceptance } = parsed.data;
    const reqAcc = requiresAcceptance ?? existing.requiresAcceptance ?? false;

    let newStatus = existing.status;
    if (newAssignee) {
      newStatus = reqAcc ? "pending_acceptance" : "in_progress";
    } else {
      newStatus = "pending";
    }

    const [task] = await db
      .update(tasksTable)
      .set({
        assignedToUserId:   newAssignee,
        requiresAcceptance: reqAcc,
        status:             newStatus,
      })
      .where(eq(tasksTable.id, id))
      .returning();

    const hadAssignee    = !!existing.assignedToUserId;
    const hasNewAssignee = !!newAssignee;
    const auditAction    = !hasNewAssignee ? "unassigned"
      : !hadAssignee ? "assigned"
      : "reassigned";

    // getUserName solo se llama si hay nuevo asignado — evita query innecesaria
    const assigneeName  = newAssignee ? await getUserName(newAssignee) : "sin asignar";
    const auditComment  = !hasNewAssignee     ? "Asignación eliminada"
      : !hadAssignee ? `Asignada a ${assigneeName}`
      : `Reasignada a ${assigneeName}`;

    await logHistory(id, userId, auditAction, {
      previous: existing.assignedToUserId ?? "sin asignar",
      next:     newAssignee ?? "sin asignar",
      comment:  auditComment,
    });

    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/reassign error");
    res.status(500).json({ error: "Error al reasignar tarea" });
  }
});

// ── GET /tasks/:id/subtasks ───────────────────────────────────────────────────
router.get("/tasks/:id/subtasks", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [parent] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!parent || !isTaskVisible(parent, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }

    const subtasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, id))
      .orderBy(tasksTable.createdAt);

    const enriched = await enrichTasks(subtasks);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/subtasks get error");
    res.status(500).json({ error: "Error al cargar subtareas" });
  }
});

// ── POST /tasks/:id/subtasks ──────────────────────────────────────────────────
router.post("/tasks/:id/subtasks", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);
    const parsed = CreateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [parent] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!parent || !isTaskVisible(parent, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    if (!canActOnTask(parent, userId, role)) {
      res.status(403).json({ error: "No tenés permiso para agregar subtareas" });
      return;
    }

    const { assignedToUserId, requiresAcceptance, ...rest } = parsed.data;
    let status = "pending";
    if (assignedToUserId) {
      status = requiresAcceptance ? "pending_acceptance" : "in_progress";
    }

    const [subtask] = await db
      .insert(tasksTable)
      .values({
        ...rest,
        userId,
        assignedToUserId:   assignedToUserId ?? null,
        requiresAcceptance: requiresAcceptance ?? false,
        parentTaskId:       id,
        status,
        progress: 0,
      })
      .returning();

    await logHistory(subtask.id, userId, "created", {
      next:    subtask.title,
      comment: `Subtarea de tarea #${id}${assignedToUserId ? ` · Asignada a usuario ${assignedToUserId}` : ""}`,
    });

    const [enriched] = await enrichTasks([subtask]);
    res.status(201).json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/subtasks create error");
    res.status(500).json({ error: "Error al crear subtarea" });
  }
});

// ── POST /tasks/:id/subtasks/:subId/complete ──────────────────────────────────
// Toggle: si está completada la reabre, si no la completa
router.post(
  "/tasks/:id/subtasks/:subId/complete",
  requireAuth,
  async (req: Request, res): Promise<void> => {
    try {
      const parentId = parseId(req.params["id"]);
      const subId    = parseId(req.params["subId"]);
      if (!parentId || !subId) { res.status(400).json({ error: "ID inválido" }); return; }

      const userId = getCurrentUserId(req);
      const role   = getRole(req);

      const [subtask] = await db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.id, subId), eq(tasksTable.parentTaskId, parentId)));
      if (!subtask) { res.status(404).json({ error: "Subtarea no encontrada" }); return; }
      if (!canActOnTask(subtask, userId, role)) {
        res.status(403).json({ error: "No tenés permiso" });
        return;
      }

      const isDone = subtask.status === "completed" || subtask.status === "done";
      const [updated] = await db
        .update(tasksTable)
        .set(
          isDone
            ? { status: "in_progress", progress: 0, completedAt: null }
            : { status: "completed",   progress: 100, completedAt: new Date() },
        )
        .where(eq(tasksTable.id, subId))
        .returning();

      await logHistory(subId, userId, isDone ? "status_changed" : "completed", {
        previous: subtask.status,
        next:     updated.status,
      });
      const [enriched] = await enrichTasks([updated]);
      res.json(enriched);
    } catch (err) {
      logger.error({ err }, "subtasks/complete error");
      res.status(500).json({ error: "Error al actualizar subtarea" });
    }
  },
);

// ── PATCH /tasks/:id/subtasks/:subId/status ───────────────────────────────────
router.patch(
  "/tasks/:id/subtasks/:subId/status",
  requireAuth,
  async (req: Request, res): Promise<void> => {
    try {
      const parentId = parseId(req.params["id"]);
      const subId    = parseId(req.params["subId"]);
      if (!parentId || !subId) { res.status(400).json({ error: "ID inválido" }); return; }

      const userId = getCurrentUserId(req);
      const role   = getRole(req);
      const parsed = SubtaskStatusBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Estado inválido" });
        return;
      }

      const [subtask] = await db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.id, subId), eq(tasksTable.parentTaskId, parentId)));
      if (!subtask) { res.status(404).json({ error: "Subtarea no encontrada" }); return; }
      if (!canActOnTask(subtask, userId, role)) {
        res.status(403).json({ error: "No tenés permiso" });
        return;
      }

      const { status } = parsed.data;
      const isCompleted = status === "completed";
      const [updated] = await db
        .update(tasksTable)
        .set({
          status,
          progress:    isCompleted ? 100 : status === "in_progress" ? 50 : 0,
          completedAt: isCompleted ? new Date() : null,
        })
        .where(eq(tasksTable.id, subId))
        .returning();

      await logHistory(subId, userId, "status_changed", {
        previous: subtask.status,
        next:     status,
      });
      const [enriched] = await enrichTasks([updated]);
      res.json(enriched);
    } catch (err) {
      logger.error({ err }, "subtasks/status error");
      res.status(500).json({ error: "Error al actualizar subtarea" });
    }
  },
);

// ── DELETE /tasks/:id/subtasks/:subId ─────────────────────────────────────────
router.delete(
  "/tasks/:id/subtasks/:subId",
  requireAuth,
  async (req: Request, res): Promise<void> => {
    try {
      const parentId = parseId(req.params["id"]);
      const subId    = parseId(req.params["subId"]);
      if (!parentId || !subId) { res.status(400).json({ error: "ID inválido" }); return; }

      const userId = getCurrentUserId(req);
      const role   = getRole(req);

      const [subtask] = await db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.id, subId), eq(tasksTable.parentTaskId, parentId)));
      if (!subtask) { res.status(404).json({ error: "Subtarea no encontrada" }); return; }
      if (!canEditTask(subtask, userId, role)) {
        res.status(403).json({ error: "Solo el creador puede eliminar esta subtarea" });
        return;
      }

      await Promise.all([
        db.delete(taskHistoryTable).where(eq(taskHistoryTable.taskId, subId)),
        db.delete(taskCommentsTable).where(eq(taskCommentsTable.taskId, subId)),
      ]);
      await db.delete(tasksTable).where(eq(tasksTable.id, subId));

      res.sendStatus(204);
    } catch (err) {
      logger.error({ err }, "subtasks/delete error");
      res.status(500).json({ error: "Error al eliminar subtarea" });
    }
  },
);

// ── GET /tasks/:id/comments ───────────────────────────────────────────────────
router.get("/tasks/:id/comments", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!task || !isTaskVisible(task, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }

    const comments = await db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, id))
      .orderBy(taskCommentsTable.createdAt);

    res.json(comments);
  } catch (err) {
    logger.error({ err }, "tasks/comments get error");
    res.status(500).json({ error: "Error al cargar comentarios" });
  }
});

// ── POST /tasks/:id/comments ──────────────────────────────────────────────────
router.post("/tasks/:id/comments", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);
    const parsed = CommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!task || !isTaskVisible(task, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }

    const [comment] = await db
      .insert(taskCommentsTable)
      .values({ taskId: id, userId, content: parsed.data.content })
      .returning();

    res.status(201).json(comment);
  } catch (err) {
    logger.error({ err }, "tasks/comments create error");
    res.status(500).json({ error: "Error al crear comentario" });
  }
});

// ── GET /tasks/:id/history ────────────────────────────────────────────────────
router.get("/tasks/:id/history", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    if (!task || !isTaskVisible(task, userId, role)) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }

    const history = await db
      .select()
      .from(taskHistoryTable)
      .where(eq(taskHistoryTable.taskId, id))
      .orderBy(desc(taskHistoryTable.createdAt));

    res.json(history);
  } catch (err) {
    logger.error({ err }, "tasks/history get error");
    res.status(500).json({ error: "Error al cargar historial" });
  }
});

// ── GET /tasks/board — vista Kanban ───────────────────────────────────────────
// Devuelve tareas agrupadas por estado para el board Kanban del frontend.
// Solo tareas propias del usuario (fix del bug de cross-user data leak documentado
// en replit.md como C1: tasks.teamBoard ahora filtra por userId)
router.get("/tasks/board", requireAuth, async (req: Request, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const role   = getRole(req);

    // Admins pueden ver el board completo; el resto solo sus tareas
    const conditions = [isNull(tasksTable.parentTaskId)];
    if (role !== "super_admin" && role !== "admin") {
      conditions.push(
        or(
          eq(tasksTable.userId, userId),
          eq(tasksTable.assignedToUserId, userId),
        )!,
      );
    }

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(and(...conditions))
      .orderBy(tasksTable.priority, desc(tasksTable.updatedAt));

    const enriched = await enrichTasks(tasks);

    // Agrupar por estado en JS — la agrupación no tiene costo de query adicional
    const board = {
      pending:            enriched.filter((t) => t.status === "pending"),
      pending_acceptance: enriched.filter((t) => t.status === "pending_acceptance"),
      in_progress:        enriched.filter((t) => t.status === "in_progress" || t.status === "in-progress"),
      completed:          enriched.filter((t) => t.status === "completed" || t.status === "done"),
    };

    res.json(board);
  } catch (err) {
    logger.error({ err }, "tasks/board error");
    res.status(500).json({ error: "Error al cargar board" });
  }
});

export default router;
