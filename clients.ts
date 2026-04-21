import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clientsTable,
  clientTaxAssignmentsTable,
  clientGroupsTable,
  dueDatesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { regenerateAllDueDatesForClient } from "../services/afip-engine.js";
import {
  requireAuth,
  assertOwnership,
  getCurrentUserId,
} from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normaliza y valida un CUIT argentino: strip guiones/espacios, exactamente 11 dígitos */
function parseCuit(raw: string): string | null {
  const clean = raw.replace(/[-\s]/g, "");
  return /^\d{11}$/.test(clean) ? clean : null;
}

/** Parsea un ID de ruta y devuelve null si es inválido */
function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const GroupCreateSchema = z.object({
  name:        z.string().trim().min(1, "El nombre es requerido").max(100),
  color:       z.string().optional().default("blue"),
  description: z.string().optional().nullable(),
});

const GroupUpdateSchema = GroupCreateSchema.partial();

const ClientCreateSchema = z.object({
  name:            z.string().trim().min(1, "El nombre es requerido"),
  cuit:            z.string().min(1, "El CUIT es requerido"),
  email:           z.string().email("Email inválido").optional().nullable(),
  emailSecondary:  z.string().email("Email secundario inválido").optional().nullable(),
  phone:           z.string().optional().nullable(),
  status:          z.enum(["active", "inactive", "archived"]).optional().default("active"),
  clientPriority:  z.enum(["alta", "media", "baja"]).optional().default("media"),
  alertsActive:    z.boolean().optional().default(true),
  responsible:     z.string().optional().nullable(),
  notes:           z.string().optional().nullable(),
  groupId:         z.number().int().positive().optional().nullable(),
  taxTypes:        z.array(z.string().min(1)).optional().default([]),
});

const ClientUpdateSchema = ClientCreateSchema.partial();

// ── Client Groups ──────────────────────────────────────────────────────────────

router.get("/clients/groups", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const groups = await db
      .select()
      .from(clientGroupsTable)
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
    const parsed = GroupCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [group] = await db
      .insert(clientGroupsTable)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(group);
  } catch (err) {
    logger.error({ err }, "ClientGroup create error");
    res.status(500).json({ error: "Error al crear grupo" });
  }
});

router.put("/clients/groups/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = GroupUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(clientGroupsTable)
      .where(eq(clientGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
    if (existing.userId !== userId) { res.status(403).json({ error: "Sin permiso" }); return; }

    const [updated] = await db
      .update(clientGroupsTable)
      .set(parsed.data)
      .where(eq(clientGroupsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "ClientGroup update error");
    res.status(500).json({ error: "Error al actualizar grupo" });
  }
});

router.delete("/clients/groups/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(clientGroupsTable)
      .where(eq(clientGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
    if (existing.userId !== userId) { res.status(403).json({ error: "Sin permiso" }); return; }

    // Desasociar clientes del grupo antes de eliminar
    await db
      .update(clientsTable)
      .set({ groupId: null })
      .where(eq(clientsTable.groupId, id));
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
    const [clients, assignments, groups] = await Promise.all([
      db
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.userId, userId))
        .orderBy(desc(clientsTable.createdAt)),
      db.select().from(clientTaxAssignmentsTable),
      db
        .select()
        .from(clientGroupsTable)
        .where(eq(clientGroupsTable.userId, userId)),
    ]);

    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const result = clients.map((c) => ({
      ...c,
      taxAssignments: assignments.filter((a) => a.clientId === c.id),
      group: c.groupId ? (groupMap.get(c.groupId) ?? null) : null,
    }));
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Clients fetch error");
    res.status(500).json({ error: "Error al cargar clientes" });
  }
});

router.get("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, client.userId)) return;

    const [taxAssignments, groupRow] = await Promise.all([
      db
        .select()
        .from(clientTaxAssignmentsTable)
        .where(eq(clientTaxAssignmentsTable.clientId, id)),
      client.groupId
        ? db
            .select()
            .from(clientGroupsTable)
            .where(eq(clientGroupsTable.id, client.groupId))
            .then(([g]) => g ?? null)
        : Promise.resolve(null),
    ]);

    res.json({ ...client, taxAssignments, group: groupRow });
  } catch (err) {
    logger.error({ err }, "Client fetch error");
    res.status(500).json({ error: "Error al cargar cliente" });
  }
});

router.post("/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = ClientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const { cuit, taxTypes, ...rest } = parsed.data;

    const cleanCuit = parseCuit(cuit);
    if (!cleanCuit) {
      res.status(400).json({ error: "CUIT inválido (debe tener 11 dígitos numéricos)" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [client] = await db
      .insert(clientsTable)
      .values({ ...rest, cuit: cleanCuit, userId })
      .returning();

    // Bulk insert de asignaciones fiscales en una sola query
    if (taxTypes.length > 0) {
      await db.insert(clientTaxAssignmentsTable).values(
        taxTypes.map((taxType) => ({ clientId: client.id, taxType, enabled: true })),
      );
    }

    const [taxAssignments, groupRow] = await Promise.all([
      db
        .select()
        .from(clientTaxAssignmentsTable)
        .where(eq(clientTaxAssignmentsTable.clientId, client.id)),
      client.groupId
        ? db
            .select()
            .from(clientGroupsTable)
            .where(eq(clientGroupsTable.id, client.groupId))
            .then(([g]) => g ?? null)
        : Promise.resolve(null),
    ]);

    res.status(201).json({ ...client, taxAssignments, group: groupRow });
  } catch (err) {
    logger.error({ err }, "Client create error");
    res.status(500).json({ error: "Error al crear cliente" });
  }
});

router.put("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = ClientUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const { cuit, taxTypes, ...rest } = parsed.data;

    // Construir objeto de updates solo con los campos presentes en el body
    const updates: Record<string, unknown> = { ...rest };

    if (cuit !== undefined) {
      const cleanCuit = parseCuit(cuit);
      if (!cleanCuit) {
        res.status(400).json({ error: "CUIT inválido (debe tener 11 dígitos numéricos)" });
        return;
      }
      updates["cuit"] = cleanCuit;
    }

    const [updated] = await db
      .update(clientsTable)
      .set(updates)
      .where(eq(clientsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    // Reemplazar asignaciones fiscales si se envió el array
    if (taxTypes !== undefined) {
      await db
        .delete(clientTaxAssignmentsTable)
        .where(eq(clientTaxAssignmentsTable.clientId, id));
      if (taxTypes.length > 0) {
        await db.insert(clientTaxAssignmentsTable).values(
          taxTypes.map((taxType) => ({ clientId: id, taxType, enabled: true })),
        );
      }
    }

    const [taxAssignments, groupRow] = await Promise.all([
      db
        .select()
        .from(clientTaxAssignmentsTable)
        .where(eq(clientTaxAssignmentsTable.clientId, id)),
      updated.groupId
        ? db
            .select()
            .from(clientGroupsTable)
            .where(eq(clientGroupsTable.id, updated.groupId))
            .then(([g]) => g ?? null)
        : Promise.resolve(null),
    ]);

    res.json({ ...updated, taxAssignments, group: groupRow });
  } catch (err) {
    logger.error({ err }, "Client update error");
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

router.delete("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    // Eliminar dependientes antes del cliente (respeta FK constraints)
    await Promise.all([
      db.delete(dueDatesTable).where(eq(dueDatesTable.clientId, id)),
      db
        .delete(clientTaxAssignmentsTable)
        .where(eq(clientTaxAssignmentsTable.clientId, id)),
    ]);
    await db.delete(clientsTable).where(eq(clientsTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Client delete error");
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

// ── Motor AFIP: generación de vencimientos ────────────────────────────────────
// Ambas rutas son equivalentes — se mantienen por compatibilidad con el frontend.
// requireAuth agregado: el motor accede a datos del usuario, no debe ser público.

async function handleGenerateDueDates(
  req: Parameters<typeof router.post>[1] extends (req: infer R, ...args: unknown[]) => unknown ? R : never,
  res: Parameters<typeof router.post>[1] extends (req: unknown, res: infer R, ...args: unknown[]) => unknown ? R : never,
): Promise<void> {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    if (!assertOwnership(req as Parameters<typeof assertOwnership>[0], res as Parameters<typeof assertOwnership>[1], client.userId)) return;

    const result = await regenerateAllDueDatesForClient(id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "AFIP engine error");
    res.status(500).json({ error: "Error al generar vencimientos" });
  }
}

router.post("/clients/:id/generate-due-dates",    requireAuth, handleGenerateDueDates);
router.post("/clients/:id/regenerate-due-dates",  requireAuth, handleGenerateDueDates);

export default router;
