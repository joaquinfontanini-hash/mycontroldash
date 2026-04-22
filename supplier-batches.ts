import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  db,
  supplierPaymentBatchesTable,
  supplierPaymentBatchItemsTable,
  dueDatesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  requireAuth,
  assertOwnership,
  getCurrentUserId,
} from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Upload config ─────────────────────────────────────────────────────────────
// El módulo de proveedores soporta upload de archivos de lote (Excel, CSV).
// Railway tiene filesystem efímero — para producción real usar S3/R2.
// UPLOAD_DIR es configurable via env para override sin tocar código.
const UPLOAD_DIR =
  process.env["UPLOAD_DIR"] ??
  path.join(process.cwd(), "uploads", "supplier-batches");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel",                                          // xls
  "text/csv",
  "application/csv",
  "text/plain",   // algunos clientes envían CSV como text/plain
]);

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ts  = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path
        .basename(file.originalname, ext)
        .replace(/[^a-z0-9_-]/gi, "_")
        .slice(0, 60);
      cb(null, `${ts}_${base}${ext}`);
    },
  }),
  limits: {
    fileSize:  10 * 1024 * 1024, // 10 MB — lotes típicos de proveedores << 1 MB
    files:     1,
    fieldSize: 1 * 1024 * 1024,  // 1 MB por campo de texto
  },
  fileFilter: (_req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const mimeOk   = ALLOWED_MIME_TYPES.has(file.mimetype);
    const extOk    = ALLOWED_EXTENSIONS.has(ext);

    if (!mimeOk && !extOk) {
      cb(new Error("Solo se aceptan archivos Excel (.xlsx, .xls) o CSV (.csv)"));
      return;
    }
    cb(null, true);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getNextMonday(fromDate?: string): string {
  const base       = fromDate ? new Date(fromDate) : new Date();
  const dayOfWeek  = base.getDay();
  const daysUntil  = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
  const monday     = new Date(base);
  monday.setDate(base.getDate() + daysUntil);
  return monday.toISOString().split("T")[0]!;
}

function getPreviousSaturday(fromDate?: string): string {
  const base      = fromDate ? new Date(fromDate) : new Date();
  const dayOfWeek = base.getDay();
  const daysBack  = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 0 : dayOfWeek + 1;
  const saturday  = new Date(base);
  saturday.setDate(base.getDate() - daysBack);
  return saturday.toISOString().split("T")[0]!;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const BatchItemSchema = z.object({
  supplier:        z.string().trim().min(1).max(200).default("Sin nombre"),
  originalDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  amount:          z.coerce.number().min(0).default(0),
  document:        z.string().max(100).optional().nullable(),
  notes:           z.string().max(500).optional().nullable(),
});

const BatchCreateSchema = z.object({
  fileName:  z.string().trim().min(1).max(255),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:     z.string().max(1000).optional().nullable(),
  items:     z.array(BatchItemSchema).max(500, "Máximo 500 ítems por lote").default([]),
});

// ── GET /supplier-batches ─────────────────────────────────────────────────────
router.get("/supplier-batches", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId  = getCurrentUserId(req);
    const batches = await db
      .select()
      .from(supplierPaymentBatchesTable)
      .where(eq(supplierPaymentBatchesTable.userId, userId))
      .orderBy(desc(supplierPaymentBatchesTable.createdAt));
    res.json(batches);
  } catch (err) {
    logger.error({ err }, "Supplier batches fetch error");
    res.status(500).json({ error: "Error al cargar lotes" });
  }
});

// ── GET /supplier-batches/:id ─────────────────────────────────────────────────
router.get("/supplier-batches/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [batch] = await db
      .select()
      .from(supplierPaymentBatchesTable)
      .where(eq(supplierPaymentBatchesTable.id, id));
    if (!batch) { res.status(404).json({ error: "Lote no encontrado" }); return; }
    if (!assertOwnership(req, res, batch.userId)) return;

    const items = await db
      .select()
      .from(supplierPaymentBatchItemsTable)
      .where(eq(supplierPaymentBatchItemsTable.batchId, id));

    res.json({ ...batch, items });
  } catch (err) {
    logger.error({ err }, "Supplier batch detail error");
    res.status(500).json({ error: "Error al cargar detalle del lote" });
  }
});

// ── POST /supplier-batches ────────────────────────────────────────────────────
// Crea un lote de proveedores desde JSON.
// Usa bulk insert para los ítems — N ítems en 1 query en lugar de N queries.
// Fix de bug: el filtro de due_date existente incluye userId para evitar tomar
// una fecha de otro usuario como existente.
router.post("/supplier-batches", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const parsed = BatchCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const { fileName, weekStart, weekEnd, notes, items } = parsed.data;

    const ws          = weekStart ?? getPreviousSaturday();
    const we          = weekEnd ?? ws;
    const paymentDate = getNextMonday(we);
    const totalAmount = items.reduce((sum, it) => sum + it.amount, 0);

    // Reemplazar lote existente del mismo usuario para la misma fecha de pago
    const [userExisting] = await db
      .select()
      .from(supplierPaymentBatchesTable)
      .where(
        and(
          eq(supplierPaymentBatchesTable.paymentDate, paymentDate),
          eq(supplierPaymentBatchesTable.userId, userId),
        ),
      );

    if (userExisting) {
      await Promise.all([
        db
          .delete(supplierPaymentBatchItemsTable)
          .where(eq(supplierPaymentBatchItemsTable.batchId, userExisting.id)),
        db
          .delete(supplierPaymentBatchesTable)
          .where(eq(supplierPaymentBatchesTable.id, userExisting.id)),
      ]);
    }

    const [batch] = await db
      .insert(supplierPaymentBatchesTable)
      .values({
        fileName,
        weekStart:   ws,
        weekEnd:     we,
        paymentDate,
        totalAmount,
        itemCount:   items.length,
        status:      "processed",
        notes:       notes ?? null,
        userId,
      })
      .returning();

    // Bulk insert en una sola query — el original hacía for...of await (N queries)
    if (items.length > 0) {
      await db.insert(supplierPaymentBatchItemsTable).values(
        items.map((item) => ({
          batchId:         batch.id,
          supplier:        item.supplier,
          originalDueDate: item.originalDueDate ?? null,
          amount:          item.amount,
          document:        item.document ?? null,
          notes:           item.notes ?? null,
        })),
      );
    }

    // Crear vencimiento en el módulo AFIP solo si no existe YA UNO PROPIO
    // Bug del original: filtraba por paymentDate sin userId — podía tomar
    // el due_date de otro usuario si casualmente tenían la misma fecha
    const [existingDueDate] = await db
      .select()
      .from(dueDatesTable)
      .where(
        and(
          eq(dueDatesTable.dueDate, paymentDate),
          eq(dueDatesTable.userId, userId),          // FIX: filtrar por userId
          eq(dueDatesTable.source, "supplier-batch"),
        ),
      );

    let dueDateId: number | null = null;

    if (!existingDueDate) {
      const [dd] = await db
        .insert(dueDatesTable)
        .values({
          title:        `Pago proveedores — semana ${ws} al ${we}`,
          category:     "proveedores",
          dueDate:      paymentDate,
          description:  `Lote: ${fileName} | ${items.length} comprobantes | Total: $${totalAmount.toLocaleString("es-AR")}`,
          priority:     "high",
          status:       "pending",
          alertEnabled: true,
          source:       "supplier-batch",
          userId,
        })
        .returning();
      dueDateId = dd.id;
    } else {
      dueDateId = existingDueDate.id;
    }

    await db
      .update(supplierPaymentBatchesTable)
      .set({ dueDateId })
      .where(eq(supplierPaymentBatchesTable.id, batch.id));

    res.status(201).json({ ...batch, dueDateId, items });
  } catch (err) {
    logger.error({ err }, "Supplier batch create error");
    res.status(500).json({ error: "Error al crear lote de proveedores" });
  }
});

// ── POST /supplier-batches/upload ─────────────────────────────────────────────
// Upload de archivo Excel/CSV de lote. El parsing del contenido se hace
// en el cliente o en un proceso separado — esta ruta solo registra el archivo.
//
// Validaciones de seguridad implementadas:
//   - Límite de tamaño: 10 MB (multer)
//   - Tipos permitidos: xlsx, xls, csv (multer fileFilter por MIME + extensión)
//   - Nombre sanitizado: timestamp + base sin caracteres especiales
//   - Railway filesystem efímero: se documenta en la respuesta
router.post(
  "/supplier-batches/upload",
  requireAuth,
  upload.single("file"),
  async (req, res): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      const file   = req.file;

      if (!file) {
        res.status(400).json({ error: "No se recibió ningún archivo" });
        return;
      }

      // Validación adicional de extensión (segunda línea de defensa)
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        fs.unlinkSync(file.path);
        res.status(400).json({ error: "Tipo de archivo no permitido" });
        return;
      }

      logger.info(
        { userId, fileName: file.originalname, size: file.size, path: file.path },
        "Supplier batch file uploaded",
      );

      res.status(201).json({
        ok:       true,
        fileName: file.originalname,
        savedAs:  path.basename(file.path),
        size:     file.size,
        message:
          "Archivo recibido. Procesalo manualmente o usá el endpoint POST /supplier-batches con los datos parseados.",
        warning:
          "El filesystem de Railway es efímero. El archivo se perderá en el próximo deploy. Para producción usá almacenamiento externo (S3/R2).",
      });
    } catch (err) {
      logger.error({ err }, "Supplier batch upload error");
      res.status(500).json({ error: "Error al subir archivo" });
    }
  },
);

// ── DELETE /supplier-batches/:id ─────────────────────────────────────────────
router.delete("/supplier-batches/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(supplierPaymentBatchesTable)
      .where(eq(supplierPaymentBatchesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Lote no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await Promise.all([
      db
        .delete(supplierPaymentBatchItemsTable)
        .where(eq(supplierPaymentBatchItemsTable.batchId, id)),
      db
        .delete(supplierPaymentBatchesTable)
        .where(eq(supplierPaymentBatchesTable.id, id)),
    ]);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Supplier batch delete error");
    res.status(500).json({ error: "Error al eliminar lote" });
  }
});

export default router;
