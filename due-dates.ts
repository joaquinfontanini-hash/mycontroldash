import { Router, type IRouter } from "express";
import { eq, and, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, dueDatesTable, dueDateCategoriesTable } from "@workspace/db";
import {
  requireAuth,
  assertOwnership,
  getCurrentUserId,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Schemas Zod ───────────────────────────────────────────────────────────────

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES   = ["pending", "done", "completed", "overdue", "cancelled"] as const;
const RECURRENCE = ["none", "daily", "weekly", "monthly", "monthly-day", "yearly", "custom"] as const;

/** Fecha en formato YYYY-MM-DD */
const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe tener formato YYYY-MM-DD");

const CategoryCreateSchema = z.object({
  name:  z.string().trim().min(1, "El nombre es requerido").max(100),
  color: z.string().optional().default("blue"),
});

const DueDateCreateSchema = z.object({
  title:              z.string().trim().min(1, "El título es requerido"),
  dueDate:            DateString,
  category:           z.string().optional().default("general"),
  description:        z.string().optional().nullable(),
  priority:           z.enum(PRIORITIES).optional().default("medium"),
  status:             z.enum(STATUSES).optional().default("pending"),
  alertEnabled:       z.boolean().optional().default(true),
  recurrenceType:     z.enum(RECURRENCE).optional().default("none"),
  recurrenceRule:     z.string().optional().nullable(),
  recurrenceEndDate:  DateString.optional().nullable(),
  taxCode:            z.string().optional().nullable(),
  cuitTermination:    z.number().int().min(0).max(9).optional().nullable(),
  clientId:           z.number().int().positive().optional().nullable(),
});

const DueDateUpdateSchema = DueDateCreateSchema.partial();

const BulkDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "Debe incluir al menos un ID"),
});

// ── Categories ─────────────────────────────────────────────────────────────────

router.get("/due-date-categories", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const cats = await db
      .select()
      .from(dueDateCategoriesTable)
      .where(eq(dueDateCategoriesTable.userId, userId))
      .orderBy(asc(dueDateCategoriesTable.name));
    res.json(cats);
  } catch (err) {
    logger.error({ err }, "DueDateCategories fetch error");
    res.status(500).json({ error: "Error al cargar categorías" });
  }
});

router.post("/due-date-categories", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = CategoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [cat] = await db
      .insert(dueDateCategoriesTable)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(cat);
  } catch (err) {
    logger.error({ err }, "DueDateCategory create error");
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

router.delete("/due-date-categories/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const [existing] = await db
      .select()
      .from(dueDateCategoriesTable)
      .where(eq(dueDateCategoriesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Categoría no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(dueDateCategoriesTable).where(eq(dueDateCategoriesTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DueDateCategory delete error");
    res.status(500).json({ error: "Error al eliminar categoría" });
  }
});

// ── Due Dates ──────────────────────────────────────────────────────────────────

router.get("/due-dates", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const items = await db
      .select()
      .from(dueDatesTable)
      .where(eq(dueDatesTable.userId, userId))
      .orderBy(asc(dueDatesTable.dueDate));
    res.json(items);
  } catch (err) {
    logger.error({ err }, "DueDates fetch error");
    res.status(500).json({ error: "Error al cargar vencimientos" });
  }
});

router.get("/due-dates/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const [item] = await db
      .select()
      .from(dueDatesTable)
      .where(eq(dueDatesTable.id, id));
    if (!item) { res.status(404).json({ error: "Vencimiento no encontrado" }); return; }
    if (!assertOwnership(req, res, item.userId)) return;
    res.json(item);
  } catch (err) {
    logger.error({ err }, "DueDate fetch error");
    res.status(500).json({ error: "Error al cargar vencimiento" });
  }
});

router.post("/due-dates", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = DueDateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const data = parsed.data;

    // ── Recurrencia mensual por día: generar una entrada por mes ──────────────
    if (data.recurrenceType === "monthly-day" && data.recurrenceRule) {
      const dayOfMonth = parseInt(data.recurrenceRule, 10);
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        res.status(400).json({ error: "recurrenceRule debe ser un día válido (1-31) para monthly-day" });
        return;
      }

      const startRef = new Date(data.dueDate + "T00:00:00");
      const endRef = data.recurrenceEndDate
        ? new Date(data.recurrenceEndDate + "T00:00:00")
        : new Date(startRef.getFullYear(), 11, 31);

      const entries: (typeof dueDatesTable.$inferInsert)[] = [];
      let year  = startRef.getFullYear();
      let month = startRef.getMonth();
      let isFirst = true;

      while (entries.length < 60) { // cap de seguridad: 5 años
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const day = Math.min(dayOfMonth, daysInMonth);
        const d = new Date(year, month, day);
        if (d > endRef) break;

        const dateStr = [
          year,
          String(month + 1).padStart(2, "0"),
          String(day).padStart(2, "0"),
        ].join("-");

        entries.push({
          title:             data.title,
          category:          data.category,
          dueDate:           dateStr,
          description:       data.description ?? null,
          priority:          data.priority,
          status:            data.status,
          alertEnabled:      data.alertEnabled,
          userId,
          recurrenceType:    "monthly-day",
          recurrenceRule:    String(dayOfMonth),
          recurrenceEndDate: data.recurrenceEndDate ?? null,
          isRecurrenceParent: isFirst,
          taxCode:           data.taxCode ?? null,
          cuitTermination:   data.cuitTermination ?? null,
          clientId:          data.clientId ?? null,
        });

        isFirst = false;
        month++;
        if (month > 11) { month = 0; year++; }
      }

      if (entries.length === 0) {
        res.status(400).json({ error: "Ninguna ocurrencia generada con los parámetros dados" });
        return;
      }

      const items = await db.insert(dueDatesTable).values(entries).returning();
      res.status(201).json(items);
      return;
    }

    // ── Entrada individual ────────────────────────────────────────────────────
    const [item] = await db
      .insert(dueDatesTable)
      .values({
        title:             data.title,
        category:          data.category,
        dueDate:           data.dueDate,
        description:       data.description ?? null,
        priority:          data.priority,
        status:            data.status,
        alertEnabled:      data.alertEnabled,
        userId,
        recurrenceType:    data.recurrenceType,
        recurrenceRule:    data.recurrenceRule ?? null,
        recurrenceEndDate: data.recurrenceEndDate ?? null,
        taxCode:           data.taxCode ?? null,
        cuitTermination:   data.cuitTermination ?? null,
        clientId:          data.clientId ?? null,
      })
      .returning();

    res.status(201).json(item);
  } catch (err) {
    logger.error({ err }, "DueDate create error");
    res.status(500).json({ error: "Error al crear vencimiento" });
  }
});

router.put("/due-dates/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const parsed = DueDateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(dueDatesTable)
      .where(eq(dueDatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Vencimiento no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    // Solo actualizar los campos presentes en el body (partial update)
    const updateData: Partial<typeof dueDatesTable.$inferInsert> = {};
    const d = parsed.data;
    if (d.title !== undefined)             updateData.title             = d.title;
    if (d.category !== undefined)          updateData.category          = d.category;
    if (d.dueDate !== undefined)           updateData.dueDate           = d.dueDate;
    if (d.description !== undefined)       updateData.description       = d.description ?? null;
    if (d.priority !== undefined)          updateData.priority          = d.priority;
    if (d.status !== undefined)            updateData.status            = d.status;
    if (d.alertEnabled !== undefined)      updateData.alertEnabled      = d.alertEnabled;
    if (d.recurrenceType !== undefined)    updateData.recurrenceType    = d.recurrenceType;
    if (d.recurrenceRule !== undefined)    updateData.recurrenceRule    = d.recurrenceRule ?? null;
    if (d.recurrenceEndDate !== undefined) updateData.recurrenceEndDate = d.recurrenceEndDate ?? null;
    if (d.taxCode !== undefined)           updateData.taxCode           = d.taxCode ?? null;
    if (d.cuitTermination !== undefined)   updateData.cuitTermination   = d.cuitTermination ?? null;
    if (d.clientId !== undefined)          updateData.clientId          = d.clientId ?? null;

    const [updated] = await db
      .update(dueDatesTable)
      .set(updateData)
      .where(eq(dueDatesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "DueDate update error");
    res.status(500).json({ error: "Error al actualizar vencimiento" });
  }
});

router.delete("/due-dates/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const [existing] = await db
      .select()
      .from(dueDatesTable)
      .where(eq(dueDatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Vencimiento no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(dueDatesTable).where(eq(dueDatesTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DueDate delete error");
    res.status(500).json({ error: "Error al eliminar vencimiento" });
  }
});

router.post("/due-dates/bulk-delete", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = BulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "IDs inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    // El filtro por userId garantiza que solo se eliminan los vencimientos del usuario
    // aunque alguien envíe IDs ajenos — sin necesidad de cargar cada registro individualmente
    const result = await db
      .delete(dueDatesTable)
      .where(
        and(
          inArray(dueDatesTable.id, parsed.data.ids),
          eq(dueDatesTable.userId, userId),
        ),
      )
      .returning({ id: dueDatesTable.id });

    res.json({ ok: true, deleted: result.length });
  } catch (err) {
    logger.error({ err }, "DueDate bulk-delete error");
    res.status(500).json({ error: "Error al eliminar vencimientos" });
  }
});

export default router;
