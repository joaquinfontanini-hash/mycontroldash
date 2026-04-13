import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  ListTasksQueryParams,
} from "@workspace/api-zod";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const query = ListTasksQueryParams.safeParse(req.query);
  const filters: ReturnType<typeof eq>[] = [eq(tasksTable.userId, userId)];
  if (query.success) {
    if (query.data.status) filters.push(eq(tasksTable.status, query.data.status));
    if (query.data.priority) filters.push(eq(tasksTable.priority, query.data.priority));
  }
  const tasks = await db.select().from(tasksTable).where(and(...filters)).orderBy(tasksTable.createdAt);
  res.json(tasks);
});

router.post("/tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db.insert(tasksTable).values({ ...parsed.data, userId }).returning();
  res.status(201).json(task);
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, task.userId)) return;
  res.json(task);
});

router.patch("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db.update(tasksTable).set(parsed.data).where(eq(tasksTable.id, params.data.id)).returning();
  res.json(task);
});

router.delete("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;

  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
