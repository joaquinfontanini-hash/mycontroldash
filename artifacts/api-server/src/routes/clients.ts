import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, clientsTable, clientTaxAssignmentsTable, clientGroupsTable, dueDatesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { generateDueDatesForClient, regenerateAllDueDatesForClient } from "../services/afip-engine.js";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Client Groups ──────────────────────────────────────────────────────────────

router.get("/clients/groups", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const groups = await db.select().from(clientGroupsTable)
      .where(eq(clientGroupsTable.userId, userId))
      .orderBy(clientGroupsTable.name);
    res.json(groups);
  } catch (err) {
    logger.error({ err }, "ClientGroups fetch error");
    res.status(500).json({ error: "Error al cargar grupos" });
  }
});

router.post("/clients/groups", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { name, color, description } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "El nombre del grupo es requerido" }); return; }
    const [group] = await db.insert(clientGroupsTable).values({
      name: name.trim(),
      color: color ?? "blue",
      description: description ?? null,
      userId,
    }).returning();
    res.status(201).json(group);
  } catch (err) {
    logger.error({ err }, "ClientGroup create error");
    res.status(500).json({ error: "Error al crear grupo" });
  }
});

router.put("/clients/groups/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const userId = getCurrentUserId(req);
    const [existing] = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
    if (existing.userId !== userId) { res.status(403).json({ error: "Sin permiso" }); return; }

    const { name, color, description } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (color !== undefined) updates.color = color;
    if (description !== undefined) updates.description = description;

    const [updated] = await db.update(clientGroupsTable).set(updates).where(eq(clientGroupsTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "ClientGroup update error");
    res.status(500).json({ error: "Error al actualizar grupo" });
  }
});

router.delete("/clients/groups/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const userId = getCurrentUserId(req);
    const [existing] = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
    if (existing.userId !== userId) { res.status(403).json({ error: "Sin permiso" }); return; }

    // Remove groupId from clients using this group
    await db.update(clientsTable).set({ groupId: null }).where(eq(clientsTable.groupId, id));
    await db.delete(clientGroupsTable).where(eq(clientGroupsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "ClientGroup delete error");
    res.status(500).json({ error: "Error al eliminar grupo" });
  }
});

// ── Clients ───────────────────────────────────────────────────────────────────

router.get("/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const clients = await db.select().from(clientsTable)
      .where(eq(clientsTable.userId, userId))
      .orderBy(desc(clientsTable.createdAt));
    const assignments = await db.select().from(clientTaxAssignmentsTable);
    const groups = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.userId, userId));
    const groupMap = new Map(groups.map(g => [g.id, g]));
    const result = clients.map(c => ({
      ...c,
      taxAssignments: assignments.filter(a => a.clientId === c.id),
      group: c.groupId ? groupMap.get(c.groupId) ?? null : null,
    }));
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Clients fetch error");
    res.status(500).json({ error: "Error al cargar clientes" });
  }
});

router.get("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, client.userId)) return;
    const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
      .where(eq(clientTaxAssignmentsTable.clientId, id));
    let group = null;
    if (client.groupId) {
      const [g] = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.id, client.groupId));
      group = g ?? null;
    }
    res.json({ ...client, taxAssignments, group });
  } catch (err) {
    logger.error({ err }, "Client fetch error");
    res.status(500).json({ error: "Error al cargar cliente" });
  }
});

router.post("/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { name, cuit, email, phone, status, notes, taxTypes, groupId } = req.body;
    if (!name || !cuit) { res.status(400).json({ error: "Nombre y CUIT son requeridos" }); return; }
    const cleanCuit = cuit.replace(/[-\s]/g, "");
    if (!/^\d{11}$/.test(cleanCuit)) { res.status(400).json({ error: "CUIT inválido (debe tener 11 dígitos)" }); return; }
    const [client] = await db.insert(clientsTable).values({
      name, cuit: cleanCuit, email, phone,
      status: status ?? "active", notes,
      groupId: groupId ? parseInt(groupId) : null,
      userId,
    }).returning();
    if (taxTypes && Array.isArray(taxTypes)) {
      for (const taxType of taxTypes) {
        await db.insert(clientTaxAssignmentsTable).values({ clientId: client.id, taxType, enabled: true });
      }
    }
    const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
      .where(eq(clientTaxAssignmentsTable.clientId, client.id));
    let group = null;
    if (client.groupId) {
      const [g] = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.id, client.groupId));
      group = g ?? null;
    }
    res.status(201).json({ ...client, taxAssignments, group });
  } catch (err) {
    logger.error({ err }, "Client create error");
    res.status(500).json({ error: "Error al crear cliente" });
  }
});

router.put("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [existing] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const { name, cuit, email, phone, status, notes, taxTypes, groupId } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if ("groupId" in req.body) updates.groupId = groupId ? parseInt(groupId) : null;
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
    let group = null;
    if (updated.groupId) {
      const [g] = await db.select().from(clientGroupsTable).where(eq(clientGroupsTable.id, updated.groupId));
      group = g ?? null;
    }
    res.json({ ...updated, taxAssignments, group });
  } catch (err) {
    logger.error({ err }, "Client update error");
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

router.delete("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const [existing] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(dueDatesTable).where(eq(dueDatesTable.clientId, id));
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
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const result = await regenerateAllDueDatesForClient(id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "AFIP engine error");
    res.status(500).json({ error: "Error al generar vencimientos" });
  }
});

router.post("/clients/:id/regenerate-due-dates", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const result = await regenerateAllDueDatesForClient(id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "AFIP engine regenerate error");
    res.status(500).json({ error: "Error al regenerar vencimientos" });
  }
});

export default router;
