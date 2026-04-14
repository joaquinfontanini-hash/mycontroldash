import { Router, type IRouter, Request } from "express";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, tasksTable, taskCommentsTable, taskHistoryTable, usersTable } from "@workspace/db";
import { requireAuth, getCurrentUserId, AuthenticatedRequest } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

type TaskRow = typeof tasksTable.$inferSelect;

function isTaskVisible(task: TaskRow, userId: string, role: string): boolean {
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
) {
  try {
    await db.insert(taskHistoryTable).values({
      taskId,
      userId,
      action,
      previousValue: opts?.previous ?? null,
      newValue: opts?.next ?? null,
      comment: opts?.comment ?? null,
    });
  } catch (err) {
    logger.error({ err }, "logHistory error");
  }
}

async function getUserName(userId: string): Promise<string> {
  try {
    const id = parseInt(userId);
    if (isNaN(id)) return userId;
    const [u] = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, id));
    return u?.name ?? u?.email ?? userId;
  } catch { return userId; }
}

// Attach creator and assignee names to task rows
async function enrichTasks(tasks: TaskRow[]): Promise<(TaskRow & { creatorName?: string; assigneeName?: string })[]> {
  if (tasks.length === 0) return tasks;

  const userIds = new Set<number>();
  for (const t of tasks) {
    if (t.userId) { const n = parseInt(t.userId); if (!isNaN(n)) userIds.add(n); }
    if (t.assignedToUserId) { const n = parseInt(t.assignedToUserId); if (!isNaN(n)) userIds.add(n); }
  }
  if (userIds.size === 0) return tasks;

  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.id, Array.from(userIds)));

  const nameMap = new Map(users.map(u => [String(u.id), u.name ?? u.email ?? String(u.id)]));

  return tasks.map(t => ({
    ...t,
    creatorName: t.userId ? nameMap.get(t.userId) : undefined,
    assigneeName: t.assignedToUserId ? nameMap.get(t.assignedToUserId) : undefined,
  }));
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateTaskBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z.string().optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  requiresAcceptance: z.boolean().default(false),
  initialObservations: z.string().max(2000).optional().nullable(),
});

const UpdateTaskBody = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().optional().nullable(),
  initialObservations: z.string().max(2000).optional().nullable(),
});

const ProgressBody = z.object({
  progress: z.number().int().min(0).max(100),
  status: z.enum(["pending", "pending_acceptance", "in_progress", "completed", "in-progress", "done"]).optional(),
  comment: z.string().max(1000).optional().nullable(),
});

const RejectBody = z.object({
  reason: z.string().max(1000).optional().nullable(),
});

const ReassignBody = z.object({
  assignedToUserId: z.string().nullable(),
  requiresAcceptance: z.boolean().optional(),
});

const CommentBody = z.object({
  content: z.string().min(1).max(2000),
});

const ListTasksQuery = z.object({
  view: z.enum(["all", "created_by_me", "assigned_to_me", "pending_acceptance", "completed", "archived"]).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().optional(),
});

// ── GET /tasks ────────────────────────────────────────────────────────────────
router.get("/tasks", requireAuth, async (req: Request, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const dbUser = (req as AuthenticatedRequest).dbUser;
  const role = dbUser.role;

  const query = ListTasksQuery.safeParse(req.query);
  const view = query.success ? query.data.view ?? "all" : "all";
  const statusFilter = query.success ? query.data.status : undefined;
  const priorityFilter = query.success ? query.data.priority : undefined;
  const search = query.success ? query.data.search?.toLowerCase().trim() : undefined;

  try {
    let tasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));

    // Visibility filter
    if (role !== "super_admin" && role !== "admin") {
      tasks = tasks.filter(t => t.userId === userId || t.assignedToUserId === userId);
    }

    // View filter
    if (view === "created_by_me") {
      tasks = tasks.filter(t => t.userId === userId);
    } else if (view === "assigned_to_me") {
      tasks = tasks.filter(t => t.assignedToUserId === userId);
    } else if (view === "pending_acceptance") {
      tasks = tasks.filter(t => t.status === "pending_acceptance" && t.assignedToUserId === userId);
    } else if (view === "completed") {
      tasks = tasks.filter(t => t.status === "completed" || t.status === "done");
    } else if (view === "archived") {
      tasks = tasks.filter(t => t.status === "archived" || t.status === "cancelled" || t.status === "rejected");
    }

    // Additional filters
    if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
    if (priorityFilter) tasks = tasks.filter(t => t.priority === priorityFilter);
    if (search) {
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(search) ||
        (t.description ?? "").toLowerCase().includes(search)
      );
    }

    const enriched = await enrichTasks(tasks);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/list error");
    res.status(500).json({ error: "Error al cargar tareas" });
  }
});

// ── POST /tasks ───────────────────────────────────────────────────────────────
router.post("/tasks", requireAuth, async (req: Request, res): Promise<void> => {
  const userId = getCurrentUserId(req);

  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { assignedToUserId, requiresAcceptance, ...rest } = parsed.data;

  // Auto-determine initial status
  let status = "pending";
  if (assignedToUserId) {
    status = requiresAcceptance ? "pending_acceptance" : "in_progress";
  }

  try {
    const [task] = await db.insert(tasksTable).values({
      ...rest,
      userId,
      assignedToUserId: assignedToUserId ?? null,
      requiresAcceptance: requiresAcceptance ?? false,
      status,
      progress: 0,
    }).returning();

    await logHistory(task.id, userId, "created", {
      next: task.title,
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
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!task) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(task, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/get error");
    res.status(500).json({ error: "Error al cargar tarea" });
  }
});

// ── PATCH /tasks/:id ─────────────────────────────────────────────────────────
router.patch("/tasks/:id", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede editar esta tarea" });
      return;
    }

    const parsed = UpdateTaskBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const [task] = await db.update(tasksTable).set(parsed.data).where(eq(tasksTable.id, id)).returning();
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
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede eliminar esta tarea" });
      return;
    }

    await db.delete(taskHistoryTable).where(eq(taskHistoryTable.taskId, id));
    await db.delete(taskCommentsTable).where(eq(taskCommentsTable.taskId, id));
    await db.delete(tasksTable).where(eq(tasksTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "tasks/delete error");
    res.status(500).json({ error: "Error al eliminar tarea" });
  }
});

// ── POST /tasks/:id/accept ────────────────────────────────────────────────────
router.post("/tasks/:id/accept", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    if (existing.assignedToUserId !== userId && role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Solo el asignado puede aceptar esta tarea" });
      return;
    }
    if (existing.status !== "pending_acceptance") {
      res.status(409).json({ error: "La tarea no está pendiente de aceptación" });
      return;
    }

    const [task] = await db.update(tasksTable)
      .set({ status: "in_progress" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "accepted", { previous: "pending_acceptance", next: "in_progress" });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/accept error");
    res.status(500).json({ error: "Error al aceptar tarea" });
  }
});

// ── POST /tasks/:id/reject ────────────────────────────────────────────────────
router.post("/tasks/:id/reject", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  const parsed = RejectBody.safeParse(req.body);
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    if (existing.assignedToUserId !== userId && role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Solo el asignado puede rechazar esta tarea" });
      return;
    }
    if (existing.status !== "pending_acceptance") {
      res.status(409).json({ error: "La tarea no está pendiente de aceptación" });
      return;
    }

    const [task] = await db.update(tasksTable)
      .set({ status: "rejected", rejectionReason: reason })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "rejected", {
      previous: "pending_acceptance",
      next: "rejected",
      comment: reason ?? undefined,
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
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  const parsed = ProgressBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canActOnTask(existing, userId, role)) {
      res.status(403).json({ error: "No tenés permiso para actualizar esta tarea" });
      return;
    }

    const updates: Partial<typeof tasksTable.$inferInsert> = {
      progress: parsed.data.progress,
    };

    // Auto-set status if progress is 100 and no explicit status
    if (parsed.data.status) {
      updates.status = parsed.data.status;
    } else if (parsed.data.progress === 100) {
      updates.status = "completed";
      updates.completedAt = new Date();
    }

    const [task] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, id)).returning();

    await logHistory(id, userId, "progress_updated", {
      previous: String(existing.progress),
      next: String(parsed.data.progress),
      comment: parsed.data.comment ?? undefined,
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
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canActOnTask(existing, userId, role)) {
      res.status(403).json({ error: "No tenés permiso" });
      return;
    }

    const [task] = await db.update(tasksTable)
      .set({ status: "completed", progress: 100, completedAt: new Date() })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "completed", { previous: existing.status, next: "completed" });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/complete error");
    res.status(500).json({ error: "Error al completar tarea" });
  }
});

// ── POST /tasks/:id/cancel ────────────────────────────────────────────────────
router.post("/tasks/:id/cancel", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede cancelar esta tarea" });
      return;
    }

    const [task] = await db.update(tasksTable)
      .set({ status: "cancelled" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "cancelled", { previous: existing.status, next: "cancelled" });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/cancel error");
    res.status(500).json({ error: "Error al cancelar tarea" });
  }
});

// ── POST /tasks/:id/archive ───────────────────────────────────────────────────
router.post("/tasks/:id/archive", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede archivar esta tarea" });
      return;
    }

    const [task] = await db.update(tasksTable)
      .set({ status: "archived" })
      .where(eq(tasksTable.id, id))
      .returning();

    await logHistory(id, userId, "archived", { previous: existing.status, next: "archived" });
    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/archive error");
    res.status(500).json({ error: "Error al archivar tarea" });
  }
});

// ── POST /tasks/:id/reassign ──────────────────────────────────────────────────
router.post("/tasks/:id/reassign", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  const parsed = ReassignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(existing, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!canEditTask(existing, userId, role)) {
      res.status(403).json({ error: "Solo el creador puede reasignar esta tarea" });
      return;
    }

    const { assignedToUserId: newAssignee, requiresAcceptance } = parsed.data;
    const req_acc = requiresAcceptance ?? existing.requiresAcceptance ?? false;

    let newStatus = existing.status;
    if (newAssignee) {
      newStatus = req_acc ? "pending_acceptance" : "in_progress";
    } else {
      newStatus = "pending";
    }

    const [task] = await db.update(tasksTable)
      .set({
        assignedToUserId: newAssignee,
        requiresAcceptance: req_acc,
        status: newStatus,
      })
      .where(eq(tasksTable.id, id))
      .returning();

    // Determine the audit action based on previous and new state
    const hadAssignee = !!existing.assignedToUserId;
    const hasNewAssignee = !!newAssignee;
    const auditAction = !hasNewAssignee ? "unassigned"
      : !hadAssignee ? "assigned"
      : "reassigned";

    const assigneeName = newAssignee ? await getUserName(newAssignee) : "sin asignar";
    const auditComment = !hasNewAssignee
      ? "Asignación eliminada"
      : !hadAssignee
        ? `Asignada a ${assigneeName}`
        : `Reasignada a ${assigneeName}`;

    await logHistory(id, userId, auditAction, {
      previous: existing.assignedToUserId ?? "sin asignar",
      next: newAssignee ?? "sin asignar",
      comment: auditComment,
    });

    const [enriched] = await enrichTasks([task]);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/reassign error");
    res.status(500).json({ error: "Error al reasignar tarea" });
  }
});

// ── GET /tasks/:id/comments ───────────────────────────────────────────────────
router.get("/tasks/:id/comments", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!task) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(task, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    const comments = await db.select().from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, id))
      .orderBy(taskCommentsTable.createdAt);

    // Enrich with user names
    const userIds = [...new Set(comments.map(c => parseInt(c.userId)).filter(n => !isNaN(n)))];
    const users = userIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : [];
    const nameMap = new Map(users.map(u => [String(u.id), u.name ?? u.email ?? String(u.id)]));

    const enriched = comments.map(c => ({
      ...c,
      authorName: nameMap.get(c.userId) ?? c.userId,
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/comments get error");
    res.status(500).json({ error: "Error al cargar comentarios" });
  }
});

// ── POST /tasks/:id/comments ──────────────────────────────────────────────────
router.post("/tasks/:id/comments", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  const parsed = CommentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!task) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(task, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    const [comment] = await db.insert(taskCommentsTable)
      .values({ taskId: id, userId, content: parsed.data.content })
      .returning();

    await logHistory(id, userId, "commented", { comment: parsed.data.content.slice(0, 100) });
    const authorName = await getUserName(userId);
    res.status(201).json({ ...comment, authorName });
  } catch (err) {
    logger.error({ err }, "tasks/comments post error");
    res.status(500).json({ error: "Error al agregar comentario" });
  }
});

// ── GET /tasks/:id/history ────────────────────────────────────────────────────
router.get("/tasks/:id/history", requireAuth, async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const role = (req as AuthenticatedRequest).dbUser.role;

  try {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!task) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!isTaskVisible(task, userId, role)) { res.status(404).json({ error: "No encontrada" }); return; }

    const history = await db.select().from(taskHistoryTable)
      .where(eq(taskHistoryTable.taskId, id))
      .orderBy(desc(taskHistoryTable.createdAt));

    const userIds = [...new Set(history.map(h => parseInt(h.userId)).filter(n => !isNaN(n)))];
    const users = userIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : [];
    const nameMap = new Map(users.map(u => [String(u.id), u.name ?? u.email ?? String(u.id)]));

    const enriched = history.map(h => ({
      ...h,
      actorName: nameMap.get(h.userId) ?? h.userId,
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "tasks/history get error");
    res.status(500).json({ error: "Error al cargar historial" });
  }
});

export default router;
