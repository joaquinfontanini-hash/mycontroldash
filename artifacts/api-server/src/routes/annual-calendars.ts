import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db, annualDueCalendarsTable, annualDueCalendarRulesTable,
  annualDueCalendarNotesTable, uploadedDueFilesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

router.get("/annual-calendars", async (_req, res): Promise<void> => {
  try {
    const calendars = await db.select().from(annualDueCalendarsTable).orderBy(desc(annualDueCalendarsTable.year));
    res.json(calendars);
  } catch (err) {
    logger.error({ err }, "Annual calendars fetch error");
    res.status(500).json({ error: "Error al cargar calendarios" });
  }
});

router.get("/annual-calendars/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [calendar] = await db.select().from(annualDueCalendarsTable).where(eq(annualDueCalendarsTable.id, id));
    if (!calendar) { res.status(404).json({ error: "Calendario no encontrado" }); return; }
    const rules = await db.select().from(annualDueCalendarRulesTable).where(eq(annualDueCalendarRulesTable.calendarId, id));
    const notes = await db.select().from(annualDueCalendarNotesTable).where(eq(annualDueCalendarNotesTable.calendarId, id));
    res.json({ ...calendar, rules, notes });
  } catch (err) {
    logger.error({ err }, "Annual calendar detail error");
    res.status(500).json({ error: "Error al cargar calendario" });
  }
});

router.post("/annual-calendars", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const { name, year, notes } = req.body;
    if (!name || !year) { res.status(400).json({ error: "Nombre y año son requeridos" }); return; }
    const [cal] = await db.insert(annualDueCalendarsTable).values({
      name, year: parseInt(year), notes,
      status: "draft", parseStatus: "pending",
      userId: userId ?? null,
    }).returning();
    res.status(201).json(cal);
  } catch (err) {
    logger.error({ err }, "Annual calendar create error");
    res.status(500).json({ error: "Error al crear calendario" });
  }
});

router.put("/annual-calendars/:id/activate", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    await db.update(annualDueCalendarsTable).set({ status: "archived" });
    const [activated] = await db.update(annualDueCalendarsTable)
      .set({ status: "active" })
      .where(eq(annualDueCalendarsTable.id, id))
      .returning();
    res.json(activated);
  } catch (err) {
    logger.error({ err }, "Calendar activate error");
    res.status(500).json({ error: "Error al activar calendario" });
  }
});

router.put("/annual-calendars/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const { name, year, notes, status, parseStatus, parseErrors } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (year !== undefined) updates.year = parseInt(year);
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;
    if (parseStatus !== undefined) updates.parseStatus = parseStatus;
    if (parseErrors !== undefined) updates.parseErrors = parseErrors;
    const [updated] = await db.update(annualDueCalendarsTable).set(updates)
      .where(eq(annualDueCalendarsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "No encontrado" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Calendar update error");
    res.status(500).json({ error: "Error al actualizar calendario" });
  }
});

router.post("/annual-calendars/:id/rules", async (req, res): Promise<void> => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) { res.status(400).json({ error: "ID inválido" }); return; }
    const { taxType, month, cuitTermination, dueDay, notes, isManualOverride } = req.body;
    if (!taxType || !month || !dueDay) { res.status(400).json({ error: "taxType, month y dueDay son requeridos" }); return; }
    const [rule] = await db.insert(annualDueCalendarRulesTable).values({
      calendarId, taxType, month: parseInt(month),
      cuitTermination: cuitTermination ?? "any",
      dueDay: parseInt(dueDay), notes,
      isManualOverride: !!isManualOverride,
    }).returning();
    res.status(201).json(rule);
  } catch (err) {
    logger.error({ err }, "Calendar rule create error");
    res.status(500).json({ error: "Error al crear regla" });
  }
});

router.delete("/annual-calendars/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    await db.delete(annualDueCalendarRulesTable).where(eq(annualDueCalendarRulesTable.calendarId, id));
    await db.delete(annualDueCalendarNotesTable).where(eq(annualDueCalendarNotesTable.calendarId, id));
    await db.delete(annualDueCalendarsTable).where(eq(annualDueCalendarsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Calendar delete error");
    res.status(500).json({ error: "Error al eliminar calendario" });
  }
});

router.get("/uploaded-due-files", async (_req, res): Promise<void> => {
  try {
    const files = await db.select().from(uploadedDueFilesTable).orderBy(desc(uploadedDueFilesTable.createdAt));
    res.json(files);
  } catch (err) {
    logger.error({ err }, "Uploaded files fetch error");
    res.status(500).json({ error: "Error al cargar archivos" });
  }
});

router.post("/uploaded-due-files", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const { fileName, fileType, year, calendarId } = req.body;
    if (!fileName) { res.status(400).json({ error: "fileName es requerido" }); return; }
    const [file] = await db.insert(uploadedDueFilesTable).values({
      fileName, fileType: fileType ?? "pdf",
      year: year ? parseInt(year) : null,
      status: "pending", parseStatus: "pending",
      calendarId: calendarId ? parseInt(calendarId) : null,
      userId: userId ?? null,
    }).returning();
    res.status(201).json(file);
  } catch (err) {
    logger.error({ err }, "File upload create error");
    res.status(500).json({ error: "Error al registrar archivo" });
  }
});

export default router;
