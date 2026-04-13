import { Router, type IRouter, Request } from "express";
import bcrypt from "bcrypt";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, registrationRequestsTable } from "@workspace/db";
import { requireAdmin, AuthenticatedRequest } from "../middleware/require-auth.js";
import { logSecurityEvent, getClientIp } from "../lib/security-logger.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Submit registration request (public) ─────────────────────────────────────
router.post("/registration-requests", async (req: Request, res): Promise<void> => {
  const { firstName, lastName, email, password, note } = req.body ?? {};

  if (!firstName || typeof firstName !== "string" || firstName.trim().length < 1) {
    res.status(400).json({ error: "El nombre es requerido." });
    return;
  }
  if (!lastName || typeof lastName !== "string" || lastName.trim().length < 1) {
    res.status(400).json({ error: "El apellido es requerido." });
    return;
  }
  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Email inválido." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));

    if (existingUser) {
      res.status(409).json({ error: "Ya existe una cuenta con ese email." });
      return;
    }

    const [existingRequest] = await db
      .select({ id: registrationRequestsTable.id, status: registrationRequestsTable.status })
      .from(registrationRequestsTable)
      .where(eq(registrationRequestsTable.email, normalizedEmail))
      .orderBy(desc(registrationRequestsTable.requestedAt))
      .limit(1);

    if (existingRequest && existingRequest.status === "pending") {
      res.status(409).json({ error: "Ya tenés una solicitud pendiente de aprobación con ese email." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await db
      .insert(registrationRequestsTable)
      .values({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        passwordHash,
        note: note?.trim() || null,
        status: "pending",
      })
      .returning({ id: registrationRequestsTable.id });

    logger.info({ email: normalizedEmail }, "Registration request submitted");
    res.status(201).json({ id: created.id, message: "Solicitud enviada. Te notificaremos cuando sea revisada." });
  } catch (err) {
    logger.error({ err }, "registration-requests/submit error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

// ── List all requests (admin) ─────────────────────────────────────────────────
router.get("/registration-requests", requireAdmin, async (req: Request, res): Promise<void> => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const requests = await db
      .select()
      .from(registrationRequestsTable)
      .orderBy(desc(registrationRequestsTable.requestedAt));

    const filtered = statusFilter && statusFilter !== "all"
      ? requests.filter(r => r.status === statusFilter)
      : requests;

    res.json(filtered);
  } catch (err) {
    logger.error({ err }, "registration-requests/list error");
    res.status(500).json({ error: "Error al cargar solicitudes" });
  }
});

// ── Stats (admin) ─────────────────────────────────────────────────────────────
router.get("/registration-requests/stats", requireAdmin, async (_req: Request, res): Promise<void> => {
  try {
    const all = await db
      .select({ status: registrationRequestsTable.status })
      .from(registrationRequestsTable);
    const stats = { total: all.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of all) {
      if (r.status === "pending") stats.pending++;
      else if (r.status === "approved") stats.approved++;
      else if (r.status === "rejected") stats.rejected++;
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "registration-requests/stats error");
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// ── Approve (admin) ───────────────────────────────────────────────────────────
router.post("/registration-requests/:id/approve", requireAdmin, async (req: Request, res): Promise<void> => {
  const actor = (req as AuthenticatedRequest).dbUser;
  const requestId = parseInt(String(req.params.id), 10);
  if (isNaN(requestId)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const [request] = await db
      .select()
      .from(registrationRequestsTable)
      .where(eq(registrationRequestsTable.id, requestId));

    if (!request) { res.status(404).json({ error: "Solicitud no encontrada" }); return; }
    if (request.status !== "pending") {
      res.status(409).json({ error: "Esta solicitud ya fue procesada." });
      return;
    }

    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, request.email));

    if (existingUser) {
      res.status(409).json({ error: "Ya existe un usuario con ese email." });
      return;
    }

    const [newUser] = await db
      .insert(usersTable)
      .values({
        email: request.email,
        name: `${request.firstName} ${request.lastName}`,
        passwordHash: request.passwordHash,
        role: "viewer",
        isActive: true,
        isBlocked: false,
        mustChangePassword: false,
      })
      .returning({ id: usersTable.id });

    await db
      .update(registrationRequestsTable)
      .set({ status: "approved", reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(registrationRequestsTable.id, requestId));

    await logSecurityEvent({
      actorEmail: actor.email,
      targetEmail: request.email,
      action: "registration_approved",
      result: "success",
      ipAddress: getClientIp(req),
      metadata: { requestId, newUserId: newUser.id },
    });

    logger.info({ requestId, email: request.email, newUserId: newUser.id }, "Registration approved");
    res.json({ ok: true, userId: newUser.id });
  } catch (err) {
    logger.error({ err }, "registration-requests/approve error");
    res.status(500).json({ error: "Error interno al aprobar" });
  }
});

// ── Reject (admin) ────────────────────────────────────────────────────────────
router.post("/registration-requests/:id/reject", requireAdmin, async (req: Request, res): Promise<void> => {
  const actor = (req as AuthenticatedRequest).dbUser;
  const requestId = parseInt(String(req.params.id), 10);
  if (isNaN(requestId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const rejectionReason = req.body?.reason?.trim() ?? null;

  try {
    const [request] = await db
      .select()
      .from(registrationRequestsTable)
      .where(eq(registrationRequestsTable.id, requestId));

    if (!request) { res.status(404).json({ error: "Solicitud no encontrada" }); return; }
    if (request.status !== "pending") {
      res.status(409).json({ error: "Esta solicitud ya fue procesada." });
      return;
    }

    await db
      .update(registrationRequestsTable)
      .set({
        status: "rejected",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        rejectionReason,
      })
      .where(eq(registrationRequestsTable.id, requestId));

    await logSecurityEvent({
      actorEmail: actor.email,
      targetEmail: request.email,
      action: "registration_rejected",
      result: "success",
      ipAddress: getClientIp(req),
      metadata: { requestId, reason: rejectionReason },
    });

    logger.info({ requestId, email: request.email }, "Registration rejected");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "registration-requests/reject error");
    res.status(500).json({ error: "Error interno al rechazar" });
  }
});

export default router;
