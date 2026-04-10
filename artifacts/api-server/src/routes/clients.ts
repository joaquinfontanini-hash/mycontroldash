import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, clientsTable, clientTaxAssignmentsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { generateDueDatesForClient, regenerateAllDueDatesForClient } from "../services/afip-engine.js";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

router.get("/clients", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const clients = await db.select().from(clientsTable)
      .where(userId ? eq(clientsTable.userId, userId) : undefined)
      .orderBy(desc(clientsTable.createdAt));
    const assignments = await db.select().from(clientTaxAssignmentsTable);
    const result = clients.map(c => ({
      ...c,
      taxAssignments: assignments.filter(a => a.clientId === c.id),
    }));
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Clients fetch error");
    res.status(500).json({ error: "Error al cargar clientes" });
  }
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
      .where(eq(clientTaxAssignmentsTable.clientId, id));
    res.json({ ...client, taxAssignments });
  } catch (err) {
    logger.error({ err }, "Client fetch error");
    res.status(500).json({ error: "Error al cargar cliente" });
  }
});

router.post("/clients", async (req, res): Promise<void> => {
  try {
    const userId = getAuth(req)?.userId;
    const { name, cuit, email, phone, status, notes, taxTypes } = req.body;
    if (!name || !cuit) { res.status(400).json({ error: "Nombre y CUIT son requeridos" }); return; }
    const cleanCuit = cuit.replace(/[-\s]/g, "");
    if (!/^\d{11}$/.test(cleanCuit)) { res.status(400).json({ error: "CUIT inválido (debe tener 11 dígitos)" }); return; }
    const [client] = await db.insert(clientsTable).values({
      name, cuit: cleanCuit, email, phone,
      status: status ?? "active", notes,
      userId: userId ?? null,
    }).returning();
    if (taxTypes && Array.isArray(taxTypes)) {
      for (const taxType of taxTypes) {
        await db.insert(clientTaxAssignmentsTable).values({
          clientId: client.id,
          taxType,
          enabled: true,
        });
      }
    }
    const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
      .where(eq(clientTaxAssignmentsTable.clientId, client.id));
    res.status(201).json({ ...client, taxAssignments });
  } catch (err) {
    logger.error({ err }, "Client create error");
    res.status(500).json({ error: "Error al crear cliente" });
  }
});

router.put("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const { name, cuit, email, phone, status, notes, taxTypes } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (cuit !== undefined) {
      const cleanCuit = cuit.replace(/[-\s]/g, "");
      if (!/^\d{11}$/.test(cleanCuit)) { res.status(400).json({ error: "CUIT inválido" }); return; }
      updates.cuit = cleanCuit;
    }
    const [updated] = await db.update(clientsTable).set(updates).where(eq(clientsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (taxTypes && Array.isArray(taxTypes)) {
      await db.delete(clientTaxAssignmentsTable).where(eq(clientTaxAssignmentsTable.clientId, id));
      for (const taxType of taxTypes) {
        await db.insert(clientTaxAssignmentsTable).values({ clientId: id, taxType, enabled: true });
      }
    }
    const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
      .where(eq(clientTaxAssignmentsTable.clientId, id));
    res.json({ ...updated, taxAssignments });
  } catch (err) {
    logger.error({ err }, "Client update error");
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    await db.delete(clientTaxAssignmentsTable).where(eq(clientTaxAssignmentsTable.clientId, id));
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Client delete error");
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

router.post("/clients/:id/generate-due-dates", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const result = await generateDueDatesForClient(id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "AFIP engine error");
    res.status(500).json({ error: "Error al generar vencimientos" });
  }
});

router.post("/clients/:id/regenerate-due-dates", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const result = await regenerateAllDueDatesForClient(id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "AFIP engine regenerate error");
    res.status(500).json({ error: "Error al regenerar vencimientos" });
  }
});

export default router;
