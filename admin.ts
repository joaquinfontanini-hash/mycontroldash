/**
 * admin.ts — Rutas del panel de administración
 *
 * TODOS los endpoints en este archivo requieren rol admin o super_admin.
 * Se aplica requireAdmin o requireSuperAdmin en cada ruta individualmente
 * (defense in depth) — no depende solo del guard en routes/index.ts.
 *
 * Rutas incluidas:
 *   GET  /admin/audit-logs         — log de auditoría (admin+)
 *   GET  /admin/security-logs      — log de seguridad (admin+)
 *   GET  /admin/jobs/health        — estado de cron jobs (super_admin only)
 *   POST /admin/jobs/:name/run     — ejecutar job manualmente (super_admin only)
 *   GET  /admin/registration-requests — solicitudes de registro pendientes (admin+)
 *   PATCH /admin/registration-requests/:id — aprobar/rechazar solicitud (admin+)
 */

import { Router, type IRouter, type Request } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db, auditLogsTable, securityLogsTable, usersTable } from "@workspace/db";
import {
  requireAdmin,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";
import { getJobHealth, runJobManually } from "../jobs/scheduler.js";
import { logSecurityEvent, getClientIp } from "../lib/security-logger.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const AuditQuerySchema = z.object({
  module:   z.string().optional(),
  userId:   z.string().optional(),
  action:   z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(500).optional().default(100),
  offset:   z.coerce.number().int().min(0).optional().default(0),
});

const SecurityLogQuerySchema = z.object({
  action:   z.string().optional(),
  result:   z.enum(["success", "failure", "blocked"]).optional(),
  limit:    z.coerce.number().int().min(1).max(500).optional().default(100),
  offset:   z.coerce.number().int().min(0).optional().default(0),
});

const RegistrationDecisionSchema = z.object({
  action:           z.enum(["approve", "reject"]),
  rejectionReason:  z.string().optional().nullable(),
  // Para aprobación: rol a asignar al nuevo usuario
  role:             z.enum(["viewer", "editor", "admin"]).optional().default("viewer"),
});

// ── GET /admin/audit-logs ─────────────────────────────────────────────────────
// Log de todas las acciones de CRUD en el sistema (módulo, entidad, before/after).
// Solo admin+: datos sensibles de operaciones del estudio.
router.get("/admin/audit-logs", requireAdmin, async (req: Request, res): Promise<void> => {
  try {
    const q = AuditQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query inválida" });
      return;
    }
    const { module, userId, action, limit, offset } = q.data;

    // Construir condiciones dinámicamente
    const conditions = [];
    if (module) conditions.push(eq(auditLogsTable.module, module));
    if (userId) conditions.push(eq(auditLogsTable.userId, userId));
    if (action) conditions.push(eq(auditLogsTable.action, action));

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(logs);
  } catch (err) {
    logger.error({ err }, "admin/audit-logs error");
    res.status(500).json({ error: "Error al cargar audit logs" });
  }
});

// ── GET /admin/security-logs ──────────────────────────────────────────────────
// Log de eventos de seguridad: logins, bloqueos, cambios de rol, etc.
// Solo admin+.
router.get("/admin/security-logs", requireAdmin, async (req: Request, res): Promise<void> => {
  try {
    const q = SecurityLogQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query inválida" });
      return;
    }
    const { action, result, limit, offset } = q.data;

    const conditions = [];
    if (action) conditions.push(eq(securityLogsTable.action, action));
    if (result) conditions.push(eq(securityLogsTable.result, result));

    const logs = await db
      .select()
      .from(securityLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(securityLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(logs);
  } catch (err) {
    logger.error({ err }, "admin/security-logs error");
    res.status(500).json({ error: "Error al cargar security logs" });
  }
});

// ── GET /admin/jobs/health ────────────────────────────────────────────────────
// Estado de los cron jobs del sistema. Solo super_admin.
// (Documentado en replit.md como C2: gated by super_admin role)
router.get("/admin/jobs/health", requireSuperAdmin, async (_req, res): Promise<void> => {
  try {
    const health = await getJobHealth();
    res.json(health);
  } catch (err) {
    logger.error({ err }, "admin/jobs/health error");
    res.status(500).json({ error: "Error al obtener estado de jobs" });
  }
});

// ── POST /admin/jobs/:name/run ────────────────────────────────────────────────
// Ejecuta un job manualmente. Solo super_admin.
router.post("/admin/jobs/:name/run", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  try {
    const jobName = req.params["name"];
    if (!jobName || typeof jobName !== "string") {
      res.status(400).json({ error: "Nombre del job requerido" });
      return;
    }

    const actor = (req as AuthenticatedRequest).dbUser;
    logger.info({ jobName, actorId: actor?.id }, "admin: manual job run requested");

    const result = await runJobManually(jobName);
    res.json({ ok: true, job: jobName, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "admin/jobs/run error");
    // Devolver el mensaje del error — puede ser "job not found" o un error de ejecución
    res.status(400).json({ error: message });
  }
});

// ── GET /admin/registration-requests ─────────────────────────────────────────
// Lista solicitudes de registro pendientes (usuarios que solicitaron acceso).
// Solo admin+.
router.get("/admin/registration-requests", requireAdmin, async (_req, res): Promise<void> => {
  try {
    // Importar tabla dinámicamente para no crear dependencia circular si no existe
    const { registrationRequestsTable } = await import("@workspace/db");
    const requests = await db
      .select()
      .from(registrationRequestsTable)
      .orderBy(desc(registrationRequestsTable.requestedAt));
    // No exponer passwordHash de las solicitudes
    res.json(
      requests.map((r) => ({
        id:              r.id,
        firstName:       r.firstName,
        lastName:        r.lastName,
        email:           r.email,
        note:            r.note,
        status:          r.status,
        requestedAt:     r.requestedAt,
        reviewedAt:      r.reviewedAt,
        rejectionReason: r.rejectionReason,
      })),
    );
  } catch (err) {
    logger.error({ err }, "admin/registration-requests GET error");
    res.status(500).json({ error: "Error al cargar solicitudes" });
  }
});

// ── PATCH /admin/registration-requests/:id ────────────────────────────────────
// Aprobar o rechazar una solicitud de registro. Solo admin+.
router.patch(
  "/admin/registration-requests/:id",
  requireAdmin,
  async (req: Request, res): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: "ID inválido" });
        return;
      }

      const parsed = RegistrationDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
        return;
      }

      const { registrationRequestsTable } = await import("@workspace/db");
      const actor = (req as AuthenticatedRequest).dbUser;

      const [request] = await db
        .select()
        .from(registrationRequestsTable)
        .where(eq(registrationRequestsTable.id, id));
      if (!request) {
        res.status(404).json({ error: "Solicitud no encontrada" });
        return;
      }
      if (request.status !== "pending") {
        res.status(409).json({ error: "La solicitud ya fue procesada" });
        return;
      }

      const { action, rejectionReason, role } = parsed.data;

      if (action === "approve") {
        // Crear el usuario en la DB
        const [newUser] = await db
          .insert(usersTable)
          .values({
            email:        request.email,
            name:         `${request.firstName} ${request.lastName}`.trim(),
            passwordHash: request.passwordHash,
            role:         role ?? "viewer",
          })
          .returning();

        await db
          .update(registrationRequestsTable)
          .set({
            status:      "approved",
            reviewedBy:  actor?.id,
            reviewedAt:  new Date(),
          })
          .where(eq(registrationRequestsTable.id, id));

        await logSecurityEvent({
          actorClerkId: actor?.clerkId ?? null,
          actorEmail:   actor?.email ?? null,
          targetEmail:  request.email,
          action:       "registration_approved",
          result:       "success",
          metadata:     { newUserId: newUser.id, role },
          ipAddress:    getClientIp(req),
        });

        res.json({ ok: true, action: "approved", userId: newUser.id });
      } else {
        await db
          .update(registrationRequestsTable)
          .set({
            status:          "rejected",
            reviewedBy:      actor?.id,
            reviewedAt:      new Date(),
            rejectionReason: rejectionReason ?? null,
          })
          .where(eq(registrationRequestsTable.id, id));

        await logSecurityEvent({
          actorClerkId: actor?.clerkId ?? null,
          actorEmail:   actor?.email ?? null,
          targetEmail:  request.email,
          action:       "registration_rejected",
          result:       "success",
          metadata:     { reason: rejectionReason },
          ipAddress:    getClientIp(req),
        });

        res.json({ ok: true, action: "rejected" });
      }
    } catch (err) {
      logger.error({ err }, "admin/registration-requests PATCH error");
      res.status(500).json({ error: "Error al procesar solicitud" });
    }
  },
);

export default router;
