/**
 * fiscal-admin.ts
 *
 * New routes for the Vencimientos + Alertas + Semáforos system:
 *
 *  GET  /api/due-dates/kpis                    — Dashboard KPI stats
 *  GET  /api/due-dates/:id/traceability        — Full traceability for one due date
 *  POST /api/due-dates/recalculate             — Recalculate semáforos for all pending
 *  POST /api/due-dates/:id/mark-reviewed       — Mark as manually reviewed
 *  POST /api/due-dates/:id/resend-alert        — Resend email alert
 *
 *  GET  /api/tax-homologation                  — List tax name mappings
 *  POST /api/tax-homologation                  — Create new mapping
 *  PATCH /api/tax-homologation/:id             — Update mapping
 *  DELETE /api/tax-homologation/:id            — Delete mapping
 *
 *  GET  /api/alert-logs                        — List email alert history
 *  POST /api/alert-logs/:id/resend             — Resend specific alert
 *
 *  GET  /api/audit-logs                        — List audit trail
 */

import { Router, type IRouter } from "express";
import { desc, eq, and, gte } from "drizzle-orm";
import {
  db,
  dueDatesTable,
  clientsTable,
  taxHomologationTable,
  alertLogsTable,
  auditLogsTable,
} from "@workspace/db";
import { requireAuth, getCurrentUserId } from "../middleware/require-auth.js";
import {
  getDueDatesKPIs,
  updateAllTrafficLights,
  calculateTrafficLight,
} from "../services/afip-engine.js";
import { resendAlert } from "../services/email-alert.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── KPIs ──────────────────────────────────────────────────────────────────────

router.get("/due-dates/kpis", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const kpis = await getDueDatesKPIs(userId);
    res.json(kpis);
  } catch (err) {
    logger.error({ err }, "GET /due-dates/kpis failed");
    res.status(500).json({ error: "Error calculando KPIs" });
  }
});

// ── Recalculate semáforos ─────────────────────────────────────────────────────

router.post("/due-dates/recalculate", requireAuth, async (req, res): Promise<void> => {
  try {
    const result = await updateAllTrafficLights();
    res.json({ ok: true, updated: result.updated });
  } catch (err) {
    logger.error({ err }, "POST /due-dates/recalculate failed");
    res.status(500).json({ error: "Error recalculando semáforos" });
  }
});

// ── Traceability for a specific due date ──────────────────────────────────────

router.get("/due-dates/:id/traceability", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const [dd] = await db
      .select()
      .from(dueDatesTable)
      .where(eq(dueDatesTable.id, id));

    if (!dd) { res.status(404).json({ error: "Vencimiento no encontrado" }); return; }

    // Parse stored traceability JSON
    let traceData: Record<string, unknown> = {};
    try {
      if (dd.classificationReason) {
        traceData = JSON.parse(dd.classificationReason);
      }
    } catch {
      traceData = { raw: dd.classificationReason };
    }

    // Current semáforo (calculated live)
    const currentLight = calculateTrafficLight(dd.dueDate, dd.status);

    // Alert history for this due date
    const alertHistory = await db
      .select()
      .from(alertLogsTable)
      .where(eq(alertLogsTable.dueDateId, id))
      .orderBy(desc(alertLogsTable.createdAt))
      .limit(20);

    res.json({
      dueDate: dd,
      traceability: traceData,
      currentTrafficLight: currentLight,
      alertHistory,
      manualReview: {
        reviewed: dd.manualReview,
        reviewNotes: dd.reviewNotes,
        reviewedAt: dd.reviewedAt,
        reviewedBy: dd.reviewedBy,
      },
    });
  } catch (err) {
    logger.error({ err, id }, "GET /due-dates/:id/traceability failed");
    res.status(500).json({ error: "Error obteniendo trazabilidad" });
  }
});

// ── Mark as manually reviewed ─────────────────────────────────────────────────

router.post("/due-dates/:id/mark-reviewed", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const { notes } = req.body ?? {};

  try {
    const [updated] = await db
      .update(dueDatesTable)
      .set({
        manualReview: true,
        reviewNotes: notes ?? null,
        reviewedAt: new Date().toISOString(),
        reviewedBy: userId,
      })
      .where(eq(dueDatesTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      module: "due_dates",
      entity: "due_dates",
      entityId: String(id),
      action: "manual_review",
      detail: `Revisado manualmente por ${userId}${notes ? `: ${notes}` : ""}`,
      userId,
    });

    res.json(updated);
  } catch (err) {
    logger.error({ err, id }, "POST /due-dates/:id/mark-reviewed failed");
    res.status(500).json({ error: "Error marcando revisión" });
  }
});

// ── Resend alert for a due date ───────────────────────────────────────────────

router.post("/due-dates/:id/resend-alert", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);

  try {
    // Get due date
    const [dd] = await db
      .select({ dd: dueDatesTable, client: clientsTable })
      .from(dueDatesTable)
      .innerJoin(clientsTable, eq(dueDatesTable.clientId, clientsTable.id))
      .where(eq(dueDatesTable.id, id));

    if (!dd) { res.status(404).json({ error: "Vencimiento no encontrado" }); return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(dd.dd.dueDate + "T00:00:00");
    const daysRemaining = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const alertType = daysRemaining < 0 ? "overdue"
      : daysRemaining === 0 ? "due_today"
      : "reminder_1d";

    const recipients = [dd.client.email, dd.client.emailSecondary]
      .filter((e): e is string => Boolean(e && e.includes("@")));

    if (recipients.length === 0) {
      res.status(400).json({ error: "El cliente no tiene email configurado" });
      return;
    }

    const { sendDueDateAlert } = await import("../services/email-alert.service.js");
    const result = await sendDueDateAlert(
      {
        dueDateId: dd.dd.id,
        clientId: dd.client.id,
        clientName: dd.client.name,
        taxCode: dd.dd.taxCode ?? "",
        taxLabel: dd.dd.title,
        dueDate: dd.dd.dueDate,
        daysRemaining,
        trafficLight: dd.dd.trafficLight,
        priority: dd.dd.priority,
        alertType,
      },
      recipients,
      { isAutomatic: false, triggeredBy: userId, forceResend: true },
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, id }, "POST /due-dates/:id/resend-alert failed");
    res.status(500).json({ error: "Error reenviando alerta" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tax Homologation CRUD
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/tax-homologation", requireAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(taxHomologationTable)
      .orderBy(taxHomologationTable.normalizedCode, taxHomologationTable.originalName);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error listando homologaciones" });
  }
});

router.post("/tax-homologation", requireAuth, async (req, res): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { originalName, normalizedCode, aliases, notes } = req.body ?? {};

  if (!originalName || !normalizedCode) {
    res.status(400).json({ error: "originalName y normalizedCode son requeridos" });
    return;
  }

  try {
    const [row] = await db
      .insert(taxHomologationTable)
      .values({ originalName, normalizedCode, aliases, notes, createdBy: userId })
      .returning();

    await db.insert(auditLogsTable).values({
      module: "homologation",
      entity: "tax_homologation",
      entityId: String(row.id),
      action: "create",
      detail: `Homologación creada: "${originalName}" → "${normalizedCode}"`,
      userId,
    });

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: "Error creando homologación" });
  }
});

router.patch("/tax-homologation/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  const allowed = ["originalName", "normalizedCode", "aliases", "notes", "status"] as const;
  const updates: Partial<Record<typeof allowed[number], string>> = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }

  try {
    const [row] = await db
      .update(taxHomologationTable)
      .set(updates)
      .where(eq(taxHomologationTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      module: "homologation",
      entity: "tax_homologation",
      entityId: String(id),
      action: "update",
      detail: `Homologación actualizada`,
      after: JSON.stringify(updates),
      userId,
    });

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Error actualizando homologación" });
  }
});

router.delete("/tax-homologation/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const userId = getCurrentUserId(req);
  try {
    await db.delete(taxHomologationTable).where(eq(taxHomologationTable.id, id));
    await db.insert(auditLogsTable).values({
      module: "homologation",
      entity: "tax_homologation",
      entityId: String(id),
      action: "delete",
      detail: "Homologación eliminada",
      userId,
    });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Error eliminando homologación" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Alert Logs
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/alert-logs", requireAuth, async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const clientId = req.query["clientId"] ? Number(req.query["clientId"]) : undefined;

    let rows = await db
      .select()
      .from(alertLogsTable)
      .orderBy(desc(alertLogsTable.createdAt))
      .limit(limit);

    if (clientId) rows = rows.filter(r => r.clientId === clientId);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error listando alertas" });
  }
});

router.post("/alert-logs/:id/resend", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const userId = getCurrentUserId(req);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const result = await resendAlert(id, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Error reenviando alerta" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Logs
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/audit-logs", requireAuth, async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 1000);
    const module = req.query["module"] as string | undefined;

    let rows = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    if (module) rows = rows.filter(r => r.module === module);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error listando auditoría" });
  }
});

export default router;
