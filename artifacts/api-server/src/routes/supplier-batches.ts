import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, supplierPaymentBatchesTable, supplierPaymentBatchItemsTable, dueDatesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getAuth } from "@clerk/express";
import { requireModule } from "../middleware/require-auth.js";

const router: IRouter = Router();

function getNextMonday(fromDate?: string): string {
  const base = fromDate ? new Date(fromDate) : new Date();
  const dayOfWeek = base.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
  const monday = new Date(base);
  monday.setDate(base.getDate() + daysUntilMonday);
  return monday.toISOString().split("T")[0]!;
}

function getPreviousSaturday(fromDate?: string): string {
  const base = fromDate ? new Date(fromDate) : new Date();
  const dayOfWeek = base.getDay();
  const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 0 : dayOfWeek + 1;
  const saturday = new Date(base);
  saturday.setDate(base.getDate() - daysBack);
  return saturday.toISOString().split("T")[0]!;
}

router.get("/supplier-batches", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const batches = await db.select().from(supplierPaymentBatchesTable)
      .where(userId ? eq(supplierPaymentBatchesTable.userId, userId) : undefined)
      .orderBy(desc(supplierPaymentBatchesTable.createdAt));
    res.json(batches);
  } catch (err) {
    logger.error({ err }, "Supplier batches fetch error");
    res.status(500).json({ error: "Error al cargar lotes" });
  }
});

router.get("/supplier-batches/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [batch] = await db.select().from(supplierPaymentBatchesTable)
      .where(eq(supplierPaymentBatchesTable.id, id));
    if (!batch) { res.status(404).json({ error: "Lote no encontrado" }); return; }
    const items = await db.select().from(supplierPaymentBatchItemsTable)
      .where(eq(supplierPaymentBatchItemsTable.batchId, id));
    res.json({ ...batch, items });
  } catch (err) {
    logger.error({ err }, "Supplier batch detail error");
    res.status(500).json({ error: "Error al cargar detalle del lote" });
  }
});

router.post("/supplier-batches", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const { fileName, items, weekStart, weekEnd, notes } = req.body;
    if (!fileName) { res.status(400).json({ error: "fileName es requerido" }); return; }

    const parsedItems: Array<{
      supplier: string; originalDueDate?: string;
      amount?: number; document?: string; notes?: string;
    }> = Array.isArray(items) ? items : [];

    const ws = weekStart ?? getPreviousSaturday();
    const we = weekEnd ?? ws;
    const paymentDate = getNextMonday(we);

    const totalAmount = parsedItems.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

    const existingBatches = await db.select().from(supplierPaymentBatchesTable)
      .where(eq(supplierPaymentBatchesTable.paymentDate, paymentDate));
    if (userId) {
      const userExisting = existingBatches.filter(b => b.userId === userId);
      if (userExisting.length > 0) {
        await db.delete(supplierPaymentBatchItemsTable)
          .where(eq(supplierPaymentBatchItemsTable.batchId, userExisting[0]!.id));
        await db.delete(supplierPaymentBatchesTable)
          .where(eq(supplierPaymentBatchesTable.id, userExisting[0]!.id));
      }
    }

    const [batch] = await db.insert(supplierPaymentBatchesTable).values({
      fileName, weekStart: ws, weekEnd: we, paymentDate,
      totalAmount, itemCount: parsedItems.length,
      status: "processed", notes,
      userId: userId ?? null,
    }).returning();

    for (const item of parsedItems) {
      await db.insert(supplierPaymentBatchItemsTable).values({
        batchId: batch.id,
        supplier: item.supplier ?? "Sin nombre",
        originalDueDate: item.originalDueDate,
        amount: Number(item.amount) || 0,
        document: item.document,
        notes: item.notes,
      });
    }

    const [existingDueDate] = await db.select().from(dueDatesTable)
      .where(eq(dueDatesTable.dueDate, paymentDate));

    let dueDateId: number | null = null;
    if (!existingDueDate) {
      const [dd] = await db.insert(dueDatesTable).values({
        title: `Pago proveedores — semana ${ws} al ${we}`,
        category: "proveedores",
        dueDate: paymentDate,
        description: `Lote: ${fileName} | ${parsedItems.length} comprobantes | Total: $${totalAmount.toLocaleString("es-AR")}`,
        priority: "high",
        status: "pending",
        alertEnabled: true,
        source: "supplier-batch",
        userId: userId ?? null,
      }).returning();
      dueDateId = dd.id;
    } else {
      dueDateId = existingDueDate.id;
    }

    await db.update(supplierPaymentBatchesTable)
      .set({ dueDateId })
      .where(eq(supplierPaymentBatchesTable.id, batch.id));

    res.status(201).json({ ...batch, dueDateId, items: parsedItems });
  } catch (err) {
    logger.error({ err }, "Supplier batch create error");
    res.status(500).json({ error: "Error al crear lote de proveedores" });
  }
});

router.delete("/supplier-batches/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    await db.delete(supplierPaymentBatchItemsTable).where(eq(supplierPaymentBatchItemsTable.batchId, id));
    await db.delete(supplierPaymentBatchesTable).where(eq(supplierPaymentBatchesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Supplier batch delete error");
    res.status(500).json({ error: "Error al eliminar lote" });
  }
});

export default router;
