import { Router, type IRouter } from "express";
import { eq, and, asc, inArray } from "drizzle-orm";
import { db, dueDatesTable, dueDateCategoriesTable } from "@workspace/db";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Categories ─────────────────────────────────────────────────────────────────

router.get("/due-date-categories", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const cats = await db.select().from(dueDateCategoriesTable)
    .where(eq(dueDateCategoriesTable.userId, userId))
    .orderBy(asc(dueDateCategoriesTable.name));
  res.json(cats);
});

router.post("/due-date-categories", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { name, color } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name es requerido" });
    return;
  }
  const [cat] = await db
    .insert(dueDateCategoriesTable)
    .values({ userId, name: name.trim(), color: color ?? "blue" })
    .returning();
  res.status(201).json(cat);
});

router.delete("/due-date-categories/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select().from(dueDateCategoriesTable).where(eq(dueDateCategoriesTable.id, id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;
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

router.get("/due-dates", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const items = await db.select().from(dueDatesTable)
    .where(eq(dueDatesTable.userId, userId))
    .orderBy(asc(dueDatesTable.dueDate));
  res.json(items);
});

router.post("/due-dates", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { error, data } = validateDueDate(req.body);
  if (error) { res.status(400).json({ error }); return; }
  if (!data.title || !data.dueDate) {
    res.status(400).json({ error: "title y dueDate son requeridos" });
    return;
  }

  // ── Monthly recurrence: create one entry per month ──────────────────────────
  if (data.recurrenceType === "monthly-day" && data.recurrenceRule) {
    const dayOfMonth = parseInt(String(data.recurrenceRule), 10);
    if (!isNaN(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
      const startRef = new Date(data.dueDate + "T00:00:00");
      const endRef = data.recurrenceEndDate
        ? new Date(data.recurrenceEndDate + "T00:00:00")
        : new Date(startRef.getFullYear(), 11, 31);

      const entries: Parameters<typeof db.insert>[0] extends never ? never : any[] = [];
      let year = startRef.getFullYear();
      let month = startRef.getMonth();
      let isFirst = true;

      while (true) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const day = Math.min(dayOfMonth, daysInMonth);
        const d = new Date(year, month, day);
        if (d > endRef) break;
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        entries.push({
          title: data.title.trim(),
          category: data.category ?? "general",
          dueDate: dateStr,
          description: data.description ?? null,
          priority: data.priority ?? "medium",
          status: data.status ?? "pending",
          alertEnabled: data.alertEnabled ?? true,
          userId,
          recurrenceType: "monthly-day",
          recurrenceRule: String(dayOfMonth),
          recurrenceEndDate: data.recurrenceEndDate ?? null,
          isRecurrenceParent: isFirst,
        });
        isFirst = false;
        month++;
        if (month > 11) { month = 0; year++; }
        if (entries.length >= 60) break; // safety cap (5 years)
      }

      if (entries.length === 0) {
        res.status(400).json({ error: "Ninguna ocurrencia generada con los parámetros dados" });
        return;
      }
      const items = await db.insert(dueDatesTable).values(entries).returning();
      res.status(201).json(items);
      return;
    }
  }

  // ── Single entry ─────────────────────────────────────────────────────────────
  const [item] = await db.insert(dueDatesTable).values({
    title: data.title.trim(),
    category: data.category ?? "general",
    dueDate: data.dueDate,
    description: data.description ?? null,
    priority: data.priority ?? "medium",
    status: data.status ?? "pending",
    alertEnabled: data.alertEnabled ?? true,
    userId,
    recurrenceType: data.recurrenceType ?? "none",
    recurrenceRule: data.recurrenceRule ?? null,
    recurrenceEndDate: data.recurrenceEndDate ?? null,
  }).returning();
  res.status(201).json(item);
});

router.put("/due-dates/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select().from(dueDatesTable).where(eq(dueDatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;

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
  res.json(updated);
});

router.delete("/due-dates/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select().from(dueDatesTable).where(eq(dueDatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
  if (!assertOwnership(req, res, existing.userId)) return;
  await db.delete(dueDatesTable).where(eq(dueDatesTable.id, id));
  res.status(204).end();
});

router.post("/due-dates/bulk-delete", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids requeridos (array no vacío)" }); return;
  }
  const numericIds = (ids as unknown[]).map(Number).filter(n => !isNaN(n));
  if (numericIds.length === 0) {
    res.status(400).json({ error: "IDs inválidos" }); return;
  }
  await db.delete(dueDatesTable).where(
    and(inArray(dueDatesTable.id, numericIds), eq(dueDatesTable.userId, userId))
  );
  res.json({ ok: true, deleted: numericIds.length });
});

export default router;
