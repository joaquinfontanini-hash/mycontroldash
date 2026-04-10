import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, dueDatesTable, dueDateCategoriesTable } from "@workspace/db";

const router: IRouter = Router();

// ── Categories ─────────────────────────────────────────────────────────────────

router.get("/due-date-categories", async (_req, res): Promise<void> => {
  const cats = await db.select().from(dueDateCategoriesTable).orderBy(asc(dueDateCategoriesTable.name));
  res.json(cats);
});

router.post("/due-date-categories", async (req, res): Promise<void> => {
  const { name, color } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [cat] = await db
    .insert(dueDateCategoriesTable)
    .values({ name: name.trim(), color: color ?? "blue" })
    .returning();
  res.status(201).json(cat);
});

router.delete("/due-date-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(dueDateCategoriesTable).where(eq(dueDateCategoriesTable.id, id));
  res.status(204).end();
});

// ── Due Dates ──────────────────────────────────────────────────────────────────

type Priority = "low" | "medium" | "high" | "critical";
type Status = "pending" | "done" | "cancelled";
const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
const VALID_STATUSES: Status[] = ["pending", "done", "cancelled"];

function validateDueDate(body: any): { error?: string; data?: any } {
  if (!body || typeof body !== "object") return { error: "Body inválido" };
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return { error: "title debe ser un string no vacío" };
  }
  if (body.dueDate !== undefined && typeof body.dueDate !== "string") {
    return { error: "dueDate inválido" };
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return { error: `priority debe ser uno de: ${VALID_PRIORITIES.join(", ")}` };
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return { error: `status debe ser uno de: ${VALID_STATUSES.join(", ")}` };
  }
  return { data: body };
}

router.get("/due-dates", async (_req, res): Promise<void> => {
  const items = await db.select().from(dueDatesTable).orderBy(asc(dueDatesTable.dueDate));
  res.json(items);
});

router.post("/due-dates", async (req, res): Promise<void> => {
  const { error, data } = validateDueDate(req.body);
  if (error) { res.status(400).json({ error }); return; }
  if (!data.title || !data.dueDate) {
    res.status(400).json({ error: "title y dueDate son requeridos" });
    return;
  }
  const [item] = await db.insert(dueDatesTable).values({
    title: data.title.trim(),
    category: data.category ?? "general",
    dueDate: data.dueDate,
    description: data.description ?? null,
    priority: data.priority ?? "medium",
    status: data.status ?? "pending",
    alertEnabled: data.alertEnabled ?? true,
    userId: data.userId ?? null,
    recurrenceType: data.recurrenceType ?? "none",
    recurrenceRule: data.recurrenceRule ?? null,
    recurrenceEndDate: data.recurrenceEndDate ?? null,
  }).returning();
  res.status(201).json(item);
});

router.put("/due-dates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { error, data } = validateDueDate(req.body);
  if (error) { res.status(400).json({ error }); return; }

  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData["title"] = data.title.trim();
  if (data.category !== undefined) updateData["category"] = data.category;
  if (data.dueDate !== undefined) updateData["dueDate"] = data.dueDate;
  if (data.description !== undefined) updateData["description"] = data.description;
  if (data.priority !== undefined) updateData["priority"] = data.priority;
  if (data.status !== undefined) updateData["status"] = data.status;
  if (data.alertEnabled !== undefined) updateData["alertEnabled"] = data.alertEnabled;
  if (data.recurrenceType !== undefined) updateData["recurrenceType"] = data.recurrenceType;
  if (data.recurrenceRule !== undefined) updateData["recurrenceRule"] = data.recurrenceRule ?? null;
  if (data.recurrenceEndDate !== undefined) updateData["recurrenceEndDate"] = data.recurrenceEndDate ?? null;

  const [updated] = await db.update(dueDatesTable).set(updateData).where(eq(dueDatesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/due-dates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(dueDatesTable).where(eq(dueDatesTable.id, id));
  res.status(204).end();
});

export default router;
