import { Router, type IRouter } from "express";
import { eq, desc, and, ne } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  annualDueCalendarsTable,
  annualDueCalendarRulesTable,
  annualDueCalendarNotesTable,
  uploadedDueFilesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  requireAuth,
  getCurrentUserId,
} from "../middleware/require-auth.js";
import { normalizeTaxCode } from "../lib/tax-normalizer.js";
import multer from "multer";
import path from "path";
import fs from "fs";

// ── Upload dir — configurable via env, no hardcode de process.cwd() ───────────
// En Railway el filesystem es efímero. Para producción real usar un bucket S3/R2.
// UPLOAD_DIR permite sobreescribir la ruta desde env sin tocar el código.
const UPLOAD_DIR =
  process.env["UPLOAD_DIR"] ??
  path.join(process.cwd(), "uploads", "tax-calendars");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9_-]/gi, "_")
      .slice(0, 60);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function detectYear(filename: string): number | null {
  const m = filename.match(/20\d{2}/);
  return m ? parseInt(m[0]!) : null;
}

function detectFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".xlsx", ".xls"].includes(ext)) return "excel";
  if (ext === ".csv") return "csv";
  return "other";
}

function detectCalendarType(
  filename: string,
  explicitType?: string,
): string {
  if (explicitType === "iibb_nqn") return "iibb_nqn";
  if (explicitType === "general") return "general";
  const upper = filename.toUpperCase();
  if (
    upper.includes("IIBB") ||
    upper.includes("NQN") ||
    upper.includes("NEUQUEN") ||
    upper.includes("NEUQUÉN") ||
    upper.includes("RENTAS")
  ) {
    return "iibb_nqn";
  }
  return "general";
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CalendarCreateSchema = z.object({
  name:         z.string().trim().min(1, "El nombre es requerido"),
  year:         z.coerce.number().int().min(2000).max(2100),
  notes:        z.string().optional().nullable(),
  calendarType: z.string().optional().default("general"),
});

const CalendarUpdateSchema = z.object({
  name:         z.string().trim().min(1).optional(),
  year:         z.coerce.number().int().min(2000).max(2100).optional(),
  notes:        z.string().optional().nullable(),
  status:       z.enum(["draft", "active", "archived"]).optional(),
  parseStatus:  z.enum(["pending", "processing", "done", "error"]).optional(),
  parseErrors:  z.string().optional().nullable(),
});

const RuleSchema = z.object({
  taxType:         z.string().trim().min(1, "taxType es requerido"),
  month:           z.coerce.number().int().min(1).max(12),
  cuitTermination: z.string().optional().default("any"),
  dueDay:          z.coerce.number().int().min(1).max(31),
  notes:           z.string().optional().nullable(),
  isManualOverride: z.boolean().optional().default(false),
});

const BulkRulesSchema = z.object({
  rules: z.array(RuleSchema).min(1, "Se requiere al menos una regla"),
});

const UploadedFileCreateSchema = z.object({
  fileName:   z.string().trim().min(1, "fileName es requerido"),
  fileType:   z.string().optional().default("pdf"),
  year:       z.coerce.number().int().optional().nullable(),
  calendarId: z.coerce.number().int().positive().optional().nullable(),
});

const router: IRouter = Router();

// ── GET /annual-calendars ─────────────────────────────────────────────────────
router.get("/annual-calendars", async (_req, res): Promise<void> => {
  try {
    const calendars = await db
      .select()
      .from(annualDueCalendarsTable)
      .orderBy(desc(annualDueCalendarsTable.year));
    res.json(calendars);
  } catch (err) {
    logger.error({ err }, "Annual calendars fetch error");
    res.status(500).json({ error: "Error al cargar calendarios" });
  }
});

// ── GET /annual-calendars/:id ─────────────────────────────────────────────────
router.get("/annual-calendars/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [calendar] = await db
      .select()
      .from(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.id, id));
    if (!calendar) {
      res.status(404).json({ error: "Calendario no encontrado" });
      return;
    }

    // Cargar reglas y notas en paralelo
    const [rules, notes] = await Promise.all([
      db
        .select()
        .from(annualDueCalendarRulesTable)
        .where(eq(annualDueCalendarRulesTable.calendarId, id)),
      db
        .select()
        .from(annualDueCalendarNotesTable)
        .where(eq(annualDueCalendarNotesTable.calendarId, id)),
    ]);

    res.json({ ...calendar, rules, notes });
  } catch (err) {
    logger.error({ err }, "Annual calendar detail error");
    res.status(500).json({ error: "Error al cargar calendario" });
  }
});

// ── POST /annual-calendars ────────────────────────────────────────────────────
router.post("/annual-calendars", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = CalendarCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [cal] = await db
      .insert(annualDueCalendarsTable)
      .values({
        ...parsed.data,
        status:      "draft",
        parseStatus: "pending",
        userId,
      })
      .returning();
    res.status(201).json(cal);
  } catch (err) {
    logger.error({ err }, "Annual calendar create error");
    res.status(500).json({ error: "Error al crear calendario" });
  }
});

// ── PUT /annual-calendars/:id ─────────────────────────────────────────────────
router.put("/annual-calendars/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = CalendarUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [updated] = await db
      .update(annualDueCalendarsTable)
      .set(parsed.data)
      .where(eq(annualDueCalendarsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Calendario no encontrado" }); return; }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Calendar update error");
    res.status(500).json({ error: "Error al actualizar calendario" });
  }
});

// ── PUT /annual-calendars/:id/activate ───────────────────────────────────────
router.put("/annual-calendars/:id/activate", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [target] = await db
      .select()
      .from(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.id, id));
    if (!target) { res.status(404).json({ error: "Calendario no encontrado" }); return; }

    const calType = target.calendarType ?? "general";

    // Archivar otros calendarios del mismo tipo en paralelo, luego activar éste
    await db
      .update(annualDueCalendarsTable)
      .set({ status: "archived" })
      .where(
        and(
          eq(annualDueCalendarsTable.calendarType, calType),
          ne(annualDueCalendarsTable.id, id),
        ),
      );

    const [activated] = await db
      .update(annualDueCalendarsTable)
      .set({ status: "active" })
      .where(eq(annualDueCalendarsTable.id, id))
      .returning();

    res.json(activated);
  } catch (err) {
    logger.error({ err }, "Calendar activate error");
    res.status(500).json({ error: "Error al activar calendario" });
  }
});

// ── DELETE /annual-calendars/:id ──────────────────────────────────────────────
router.delete("/annual-calendars/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    // Eliminar dependientes en paralelo, luego el calendario
    await Promise.all([
      db
        .delete(annualDueCalendarRulesTable)
        .where(eq(annualDueCalendarRulesTable.calendarId, id)),
      db
        .delete(annualDueCalendarNotesTable)
        .where(eq(annualDueCalendarNotesTable.calendarId, id)),
    ]);
    await db
      .delete(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Calendar delete error");
    res.status(500).json({ error: "Error al eliminar calendario" });
  }
});

// ── GET /annual-calendars/:id/rules ──────────────────────────────────────────
router.get("/annual-calendars/:id/rules", async (req, res): Promise<void> => {
  try {
    const calendarId = parseId(req.params["id"]);
    if (!calendarId) { res.status(400).json({ error: "ID inválido" }); return; }

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

// ── POST /annual-calendars/:id/rules ─────────────────────────────────────────
router.post("/annual-calendars/:id/rules", requireAuth, async (req, res): Promise<void> => {
  try {
    const calendarId = parseId(req.params["id"]);
    if (!calendarId) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const normalizedTaxType = normalizeTaxCode(parsed.data.taxType);
    if (normalizedTaxType !== parsed.data.taxType) {
      logger.info(
        { original: parsed.data.taxType, normalized: normalizedTaxType },
        "annual-calendars: taxType normalized on rule creation",
      );
    }

    const [rule] = await db
      .insert(annualDueCalendarRulesTable)
      .values({ ...parsed.data, taxType: normalizedTaxType, calendarId })
      .returning();

    res.status(201).json(rule);
  } catch (err) {
    logger.error({ err }, "Calendar rule create error");
    res.status(500).json({ error: "Error al crear regla" });
  }
});

// ── POST /annual-calendars/:id/rules/bulk ─────────────────────────────────────
// Bulk insert en una sola query en lugar de N inserts secuenciales
router.post("/annual-calendars/:id/rules/bulk", requireAuth, async (req, res): Promise<void> => {
  try {
    const calendarId = parseId(req.params["id"]);
    if (!calendarId) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = BulkRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    // Normalizar y preparar todos los valores de una vez
    const values = parsed.data.rules.map((r) => ({
      ...r,
      taxType:    normalizeTaxCode(r.taxType),
      calendarId,
    }));

    // Un único INSERT con todos los valores (N filas en 1 round-trip)
    const inserted = await db
      .insert(annualDueCalendarRulesTable)
      .values(values)
      .returning();

    logger.info(
      { calendarId, count: inserted.length },
      "annual-calendars: bulk rules inserted",
    );
    res.status(201).json({ inserted: inserted.length, rules: inserted });
  } catch (err) {
    logger.error({ err }, "Calendar bulk rules create error");
    res.status(500).json({ error: "Error al crear reglas en bloque" });
  }
});

// ── POST /annual-calendars/:id/rules/normalize ───────────────────────────────
// Re-normaliza taxType en todas las reglas existentes del calendario
router.post("/annual-calendars/:id/rules/normalize", requireAuth, async (req, res): Promise<void> => {
  try {
    const calendarId = parseId(req.params["id"]);
    if (!calendarId) { res.status(400).json({ error: "ID inválido" }); return; }

    const rules = await db
      .select()
      .from(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, calendarId));

    // Filtrar solo las que realmente necesitan cambio (evitar writes innecesarios)
    const toFix = rules
      .map((r) => ({ ...r, normalized: normalizeTaxCode(r.taxType) }))
      .filter((r) => r.normalized !== r.taxType);

    // Actualizar en paralelo
    await Promise.all(
      toFix.map((r) =>
        db
          .update(annualDueCalendarRulesTable)
          .set({ taxType: r.normalized })
          .where(eq(annualDueCalendarRulesTable.id, r.id)),
      ),
    );

    const changes = toFix.map((r) => ({
      id:         r.id,
      original:   r.taxType,
      normalized: r.normalized,
    }));

    logger.info(
      { calendarId, fixed: toFix.length, changes },
      "annual-calendars: re-normalized taxTypes",
    );
    res.json({ ok: true, checked: rules.length, fixed: toFix.length, changes });
  } catch (err) {
    logger.error({ err }, "Calendar rules normalize error");
    res.status(500).json({ error: "Error al re-normalizar reglas" });
  }
});

// ── GET /annual-calendars/diagnostic/tax-match ───────────────────────────────
router.get("/annual-calendars/diagnostic/tax-match", async (req, res): Promise<void> => {
  try {
    const calendarIdRaw = req.query["calendarId"];
    const clientTaxTypesRaw = req.query["clientTaxTypes"];

    let cal;
    if (calendarIdRaw) {
      const calendarId = parseId(calendarIdRaw);
      if (!calendarId) { res.status(400).json({ error: "calendarId inválido" }); return; }
      [cal] = await db
        .select()
        .from(annualDueCalendarsTable)
        .where(eq(annualDueCalendarsTable.id, calendarId));
    } else {
      [cal] = await db
        .select()
        .from(annualDueCalendarsTable)
        .where(eq(annualDueCalendarsTable.status, "active"));
    }
    if (!cal) { res.json({ ok: false, error: "No hay calendario activo" }); return; }

    const rules = await db
      .select()
      .from(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, cal.id));

    const calendarTaxTypes = [...new Set(rules.map((r) => r.taxType))];
    const calendarNormalized = calendarTaxTypes.map((t) => ({
      raw:        t,
      normalized: normalizeTaxCode(t),
    }));

    const clientTypes = clientTaxTypesRaw
      ? String(clientTaxTypesRaw)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const matchResults = clientTypes.map((ct) => ({
      clientTaxType: ct,
      normalized:    normalizeTaxCode(ct),
      matched:       calendarNormalized.some(
        (c) => c.normalized === normalizeTaxCode(ct),
      ),
      matchedRaw: calendarNormalized
        .filter((c) => c.normalized === normalizeTaxCode(ct))
        .map((c) => c.raw),
    }));

    res.json({
      ok: true,
      calendar: {
        id:     cal.id,
        name:   cal.name,
        year:   cal.year,
        status: cal.status,
      },
      calendarTaxTypes: calendarNormalized,
      rulesCount:       rules.length,
      clientMatchResults: matchResults,
    });
  } catch (err) {
    logger.error({ err }, "Tax match diagnostic error");
    res.status(500).json({ error: "Error en diagnóstico" });
  }
});

// ── POST /annual-calendars/seed/iibb-nqn ─────────────────────────────────────
router.post("/annual-calendars/seed/iibb-nqn", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const yearParsed = z.coerce.number().int().min(2020).max(2035).safeParse(req.body.year ?? 2026);
    if (!yearParsed.success) {
      res.status(400).json({ error: "Año inválido" });
      return;
    }
    const year = yearParsed.data;

    const existing = await db
      .select()
      .from(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.calendarType, "iibb_nqn"));

    const alreadyForYear = existing.find((c) => c.year === year);
    if (alreadyForYear) {
      res.status(409).json({
        error: `Ya existe un calendario IIBB NQN para el año ${year} (ID ${alreadyForYear.id})`,
      });
      return;
    }

    const [calendar] = await db
      .insert(annualDueCalendarsTable)
      .values({
        name:         `IIBB NQN ${year}`,
        year,
        calendarType: "iibb_nqn",
        status:       "draft",
        parseStatus:  "done",
        notes:        `Calendario de Ingresos Brutos Neuquén ${year} pre-cargado desde tabla oficial.`,
        userId,
      })
      .returning();

    logger.info({ calendarId: calendar.id, year }, "IIBB NQN calendar seeded");
    res.status(201).json(calendar);
  } catch (err) {
    logger.error({ err }, "IIBB NQN seed error");
    res.status(500).json({ error: "Error al crear calendario IIBB NQN" });
  }
});

// ── GET /uploaded-due-files ───────────────────────────────────────────────────
router.get("/uploaded-due-files", async (_req, res): Promise<void> => {
  try {
    const files = await db
      .select()
      .from(uploadedDueFilesTable)
      .orderBy(desc(uploadedDueFilesTable.createdAt));
    res.json(files);
  } catch (err) {
    logger.error({ err }, "Uploaded files fetch error");
    res.status(500).json({ error: "Error al cargar archivos" });
  }
});

// ── POST /uploaded-due-files ──────────────────────────────────────────────────
router.post("/uploaded-due-files", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = UploadedFileCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [file] = await db
      .insert(uploadedDueFilesTable)
      .values({
        ...parsed.data,
        status:      "pending",
        parseStatus: "pending",
        userId,
      })
      .returning();
    res.status(201).json(file);
  } catch (err) {
    logger.error({ err }, "File upload create error");
    res.status(500).json({ error: "Error al registrar archivo" });
  }
});

// ── DELETE /uploaded-due-files/:id ───────────────────────────────────────────
router.delete("/uploaded-due-files/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [record] = await db
      .select()
      .from(uploadedDueFilesTable)
      .where(eq(uploadedDueFilesTable.id, id));
    if (!record) { res.status(404).json({ error: "Archivo no encontrado" }); return; }

    if (record.filePath) {
      try {
        fs.unlinkSync(record.filePath);
      } catch {
        // Silencioso — el archivo puede no existir en Railway (filesystem efímero)
        logger.warn({ filePath: record.filePath }, "No se pudo eliminar el archivo físico");
      }
    }

    await db.delete(uploadedDueFilesTable).where(eq(uploadedDueFilesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "File delete error");
    res.status(500).json({ error: "Error al eliminar archivo" });
  }
});

// ── POST /tax-calendars/upload ────────────────────────────────────────────────
router.post(
  "/tax-calendars/upload",
  upload.single("file"),
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No se recibió ningún archivo" });
        return;
      }

      const detectedYear =
        detectYear(file.originalname) ??
        (req.body.year ? parseInt(req.body.year as string, 10) : null);
      const fileType = detectFileType(file.originalname);
      const calType = detectCalendarType(
        file.originalname,
        req.body.calendarType as string | undefined,
      );
      const calendarName =
        (req.body.name as string | undefined) ||
        (calType === "iibb_nqn"
          ? `IIBB NQN ${detectedYear ?? "sin año"}`
          : `Calendario ${detectedYear ?? "sin año"} — ${file.originalname}`);

      // Crear calendario y registro de archivo en paralelo sería ideal,
      // pero el fileRecord necesita el calendarId — se mantienen en secuencia.
      const [calendar] = await db
        .insert(annualDueCalendarsTable)
        .values({
          name:         calendarName,
          year:         detectedYear ?? new Date().getFullYear(),
          calendarType: calType,
          status:       "draft",
          parseStatus:  "pending",
          uploadedFile: file.path,
          userId,
        })
        .returning();

      const [fileRecord] = await db
        .insert(uploadedDueFilesTable)
        .values({
          fileName:    file.originalname,
          fileType,
          filePath:    file.path,
          fileSize:    BigInt(file.size),
          year:        detectedYear,
          status:      "pending",
          parseStatus: "pending",
          calendarId:  calendar.id,
          userId,
        })
        .returning();

      logger.info(
        { calendarId: calendar.id, fileId: fileRecord.id, year: detectedYear },
        "Tax calendar uploaded",
      );

      res.status(201).json({
        calendar,
        file:    fileRecord,
        message: "Archivo subido correctamente. Pendiente de procesamiento manual.",
      });
    } catch (err) {
      logger.error({ err }, "Tax calendar upload error");
      res.status(500).json({ error: "Error al subir el archivo" });
    }
  },
);

export default router;
