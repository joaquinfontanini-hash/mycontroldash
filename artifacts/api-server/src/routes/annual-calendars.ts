import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db, annualDueCalendarsTable, annualDueCalendarRulesTable,
  annualDueCalendarNotesTable, uploadedDueFilesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getAuth } from "@clerk/express";
import { requireModule } from "../middleware/require-auth.js";
import { normalizeTaxCode } from "../lib/tax-normalizer.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "tax-calendars");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
    cb(null, `${ts}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".xlsx", ".xls", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Solo se aceptan archivos PDF, Excel o CSV"));
  },
});

function detectYear(filename: string): number | null {
  const m = filename.match(/20\d{2}/);
  return m ? parseInt(m[0]) : null;
}

function detectFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".xlsx", ".xls"].includes(ext)) return "excel";
  if (ext === ".csv") return "csv";
  return "other";
}

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
    const { name, year, notes, calendarType } = req.body;
    if (!name || !year) { res.status(400).json({ error: "Nombre y año son requeridos" }); return; }
    const [cal] = await db.insert(annualDueCalendarsTable).values({
      name, year: parseInt(year), notes,
      calendarType: calendarType ?? "general",
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
    // Find out which type this calendar is so we only archive others of the same type
    const [target] = await db.select().from(annualDueCalendarsTable).where(eq(annualDueCalendarsTable.id, id));
    if (!target) { res.status(404).json({ error: "Calendario no encontrado" }); return; }
    const calType = target.calendarType ?? "general";
    // Archive only calendars of the same type
    await db.update(annualDueCalendarsTable)
      .set({ status: "archived" })
      .where(eq(annualDueCalendarsTable.calendarType, calType));
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

    // Normalize taxType at storage time to avoid matching failures later
    const normalizedTaxType = normalizeTaxCode(taxType);
    if (normalizedTaxType !== taxType) {
      logger.info({ original: taxType, normalized: normalizedTaxType }, "annual-calendars: taxType normalized on rule creation");
    }

    const [rule] = await db.insert(annualDueCalendarRulesTable).values({
      calendarId, taxType: normalizedTaxType, month: parseInt(month),
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

/** Bulk insert rules for a calendar (normalizes taxType on each) */
router.post("/annual-calendars/:id/rules/bulk", async (req, res): Promise<void> => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) { res.status(400).json({ error: "ID inválido" }); return; }
    const { rules } = req.body;
    if (!Array.isArray(rules) || rules.length === 0) {
      res.status(400).json({ error: "Se requiere un array de reglas no vacío" }); return;
    }

    const inserted = [];
    for (const r of rules) {
      if (!r.taxType || !r.month || !r.dueDay) continue;
      const normalizedTaxType = normalizeTaxCode(r.taxType);
      const [rule] = await db.insert(annualDueCalendarRulesTable).values({
        calendarId,
        taxType: normalizedTaxType,
        month: parseInt(r.month),
        cuitTermination: r.cuitTermination ?? "any",
        dueDay: parseInt(r.dueDay),
        notes: r.notes ?? null,
        isManualOverride: !!r.isManualOverride,
      }).returning();
      inserted.push(rule);
    }

    logger.info({ calendarId, count: inserted.length }, "annual-calendars: bulk rules inserted");
    res.status(201).json({ inserted: inserted.length, rules: inserted });
  } catch (err) {
    logger.error({ err }, "Calendar bulk rules create error");
    res.status(500).json({ error: "Error al crear reglas en bloque" });
  }
});

/** GET /api/annual-calendars/:id/rules — list all rules for a calendar */
router.get("/annual-calendars/:id/rules", async (req, res): Promise<void> => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) { res.status(400).json({ error: "ID inválido" }); return; }
    const rules = await db
      .select()
      .from(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, calendarId));
    res.json(rules);
  } catch (err) {
    logger.error({ err }, "Calendar rules list error");
    res.status(500).json({ error: "Error al cargar reglas" });
  }
});

/** Diagnostic: show available taxTypes in active calendar vs a client's taxTypes */
router.get("/annual-calendars/diagnostic/tax-match", async (req, res): Promise<void> => {
  try {
    const { calendarId, clientTaxTypes } = req.query;

    // Get calendar
    let cal;
    if (calendarId) {
      [cal] = await db.select().from(annualDueCalendarsTable)
        .where(eq(annualDueCalendarsTable.id, parseInt(String(calendarId))));
    } else {
      [cal] = await db.select().from(annualDueCalendarsTable)
        .where(eq(annualDueCalendarsTable.status, "active"));
    }

    if (!cal) { res.json({ ok: false, error: "No hay calendario activo" }); return; }

    const rules = await db.select().from(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, cal.id));

    const calendarTaxTypes = [...new Set(rules.map(r => r.taxType))];
    const calendarNormalized = calendarTaxTypes.map(t => ({ raw: t, normalized: normalizeTaxCode(t) }));

    const clientTypes = clientTaxTypes
      ? String(clientTaxTypes).split(",").map(s => s.trim()).filter(Boolean)
      : [];

    const matchResults = clientTypes.map(ct => ({
      clientTaxType: ct,
      normalized: normalizeTaxCode(ct),
      matched: calendarNormalized.some(c => c.normalized === normalizeTaxCode(ct)),
      matchedRaw: calendarNormalized.filter(c => c.normalized === normalizeTaxCode(ct)).map(c => c.raw),
    }));

    res.json({
      ok: true,
      calendar: { id: cal.id, name: cal.name, year: cal.year, status: cal.status },
      calendarTaxTypes: calendarNormalized,
      rulesCount: rules.length,
      clientMatchResults: matchResults,
    });
  } catch (err) {
    logger.error({ err }, "Tax match diagnostic error");
    res.status(500).json({ error: "Error en diagnóstico" });
  }
});

/** Re-normalize all taxType values in existing rules for a calendar */
router.post("/annual-calendars/:id/rules/normalize", async (req, res): Promise<void> => {
  try {
    const calendarId = parseInt(req.params.id);
    if (isNaN(calendarId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const rules = await db
      .select()
      .from(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, calendarId));

    let fixed = 0;
    const changes: Array<{ id: number; original: string; normalized: string }> = [];

    for (const rule of rules) {
      const normalized = normalizeTaxCode(rule.taxType);
      if (normalized !== rule.taxType) {
        await db
          .update(annualDueCalendarRulesTable)
          .set({ taxType: normalized })
          .where(eq(annualDueCalendarRulesTable.id, rule.id));
        changes.push({ id: rule.id, original: rule.taxType, normalized });
        fixed++;
      }
    }

    logger.info({ calendarId, fixed, changes }, "annual-calendars: re-normalized taxTypes");
    res.json({ ok: true, checked: rules.length, fixed, changes });
  } catch (err) {
    logger.error({ err }, "Calendar rules normalize error");
    res.status(500).json({ error: "Error al re-normalizar reglas" });
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

router.delete("/uploaded-due-files/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [record] = await db.select().from(uploadedDueFilesTable).where(eq(uploadedDueFilesTable.id, id));
    if (!record) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
    if (record.filePath) {
      try { fs.unlinkSync(record.filePath); } catch (_) {}
    }
    await db.delete(uploadedDueFilesTable).where(eq(uploadedDueFilesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "File delete error");
    res.status(500).json({ error: "Error al eliminar archivo" });
  }
});

function detectCalendarType(filename: string, explicitType?: string): string {
  if (explicitType === "iibb_nqn") return "iibb_nqn";
  if (explicitType === "general") return "general";
  const upper = filename.toUpperCase();
  if (upper.includes("IIBB") || upper.includes("NQN") || upper.includes("NEUQUEN") || upper.includes("NEUQUÉN") || upper.includes("RENTAS")) {
    return "iibb_nqn";
  }
  return "general";
}

router.post(
  "/tax-calendars/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    try {
      const userId = getAuth(req)?.userId;
      const file = req.file;
      if (!file) { res.status(400).json({ error: "No se recibió ningún archivo" }); return; }

      const detectedYear = detectYear(file.originalname) ?? (req.body.year ? parseInt(req.body.year) : null);
      const fileType = detectFileType(file.originalname);
      const calType = detectCalendarType(file.originalname, req.body.calendarType);
      const calendarName = req.body.name || (calType === "iibb_nqn"
        ? `IIBB NQN ${detectedYear ?? "sin año"}`
        : `Calendario ${detectedYear ?? "sin año"} — ${file.originalname}`);

      const [calendar] = await db.insert(annualDueCalendarsTable).values({
        name: calendarName,
        year: detectedYear ?? new Date().getFullYear(),
        calendarType: calType,
        status: "draft",
        parseStatus: "pending",
        uploadedFile: file.path,
        userId: userId ?? null,
      }).returning();

      const [fileRecord] = await db.insert(uploadedDueFilesTable).values({
        fileName: file.originalname,
        fileType,
        filePath: file.path,
        fileSize: file.size,
        year: detectedYear,
        status: "pending",
        parseStatus: "pending",
        calendarId: calendar.id,
        userId: userId ?? null,
      }).returning();

      logger.info({ calendarId: calendar.id, fileId: fileRecord.id, year: detectedYear }, "Tax calendar uploaded");

      res.status(201).json({
        calendar,
        file: fileRecord,
        message: "Archivo subido correctamente. Pendiente de procesamiento manual.",
      });
    } catch (err) {
      logger.error({ err }, "Tax calendar upload error");
      res.status(500).json({ error: "Error al subir el archivo" });
    }
  }
);

/** POST /api/annual-calendars/seed/iibb-nqn — crea el calendario IIBB NQN con reglas pre-cargadas desde la tabla oficial */
router.post("/annual-calendars/seed/iibb-nqn", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const year = req.body.year ? parseInt(req.body.year) : 2026;

    // Check if already exists
    const existing = await db.select().from(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.calendarType, "iibb_nqn"));
    const alreadyForYear = existing.find(c => c.year === year);
    if (alreadyForYear) {
      res.status(409).json({ error: `Ya existe un calendario IIBB NQN para el año ${year} (ID ${alreadyForYear.id})` });
      return;
    }

    const [calendar] = await db.insert(annualDueCalendarsTable).values({
      name: `IIBB NQN ${year}`,
      year,
      calendarType: "iibb_nqn",
      status: "draft",
      parseStatus: "done",
      notes: "Calendario de Ingresos Brutos Neuquén pre-cargado desde tabla oficial. Vencimientos de Diciembre (enero del año siguiente) no incluidos en este calendario.",
      userId: userId ?? null,
    }).returning();

    // Rules data: [dueMonth, dueDay, cuitTermination]
    // Period months → due month (Enero→Feb, Febrero→Mar, ..., Noviembre→Dic)
    const RULES: Array<[number, number, string]> = [
      // Enero (período 1) → vence en Febrero
      [2, 20, "0-1"], [2, 20, "2-3"], [2, 20, "4-5"], [2, 23, "6-7"], [2, 24, "8-9"],
      // Febrero (período 2) → vence en Marzo
      [3, 18, "0-1"], [3, 19, "2-3"], [3, 20, "4-5"], [3, 23, "6-7"], [3, 25, "8-9"],
      // Marzo (período 3) → vence en Abril
      [4, 20, "0-1"], [4, 21, "2-3"], [4, 22, "4-5"], [4, 23, "6-7"], [4, 24, "8-9"],
      // Abril (período 4) → vence en Mayo
      [5, 18, "0-1"], [5, 19, "2-3"], [5, 20, "4-5"], [5, 21, "6-7"], [5, 22, "8-9"],
      // Mayo (período 5) → vence en Junio
      [6, 18, "0-1"], [6, 19, "2-3"], [6, 22, "4-5"], [6, 23, "6-7"], [6, 24, "8-9"],
      // Junio (período 6) → vence en Julio
      [7, 20, "0-1"], [7, 21, "2-3"], [7, 22, "4-5"], [7, 23, "6-7"], [7, 24, "8-9"],
      // Julio (período 7) → vence en Agosto
      [8, 18, "0-1"], [8, 19, "2-3"], [8, 20, "4-5"], [8, 21, "6-7"], [8, 24, "8-9"],
      // Agosto (período 8) → vence en Septiembre
      [9, 18, "0-1"], [9, 21, "2-3"], [9, 22, "4-5"], [9, 23, "6-7"], [9, 24, "8-9"],
      // Septiembre (período 9) → vence en Octubre
      [10, 19, "0-1"], [10, 20, "2-3"], [10, 21, "4-5"], [10, 22, "6-7"], [10, 23, "8-9"],
      // Octubre (período 10) → vence en Noviembre
      [11, 18, "0-1"], [11, 19, "2-3"], [11, 20, "4-5"], [11, 24, "6-7"], [11, 25, "8-9"],
      // Noviembre (período 11) → vence en Diciembre
      [12, 18, "0-1"], [12, 21, "2-3"], [12, 22, "4-5"], [12, 23, "6-7"], [12, 24, "8-9"],
    ];

    const inserted = [];
    for (const [month, dueDay, cuitTermination] of RULES) {
      const [rule] = await db.insert(annualDueCalendarRulesTable).values({
        calendarId: calendar.id,
        taxType: "iibb_neuquen",
        month,
        dueDay,
        cuitTermination,
        isManualOverride: false,
      }).returning();
      inserted.push(rule);
    }

    logger.info({ calendarId: calendar.id, year, rules: inserted.length }, "IIBB NQN calendar seeded");
    res.status(201).json({ calendar, rulesInserted: inserted.length });
  } catch (err) {
    logger.error({ err }, "IIBB NQN seed error");
    res.status(500).json({ error: "Error al crear calendario IIBB NQN" });
  }
});

export default router;
