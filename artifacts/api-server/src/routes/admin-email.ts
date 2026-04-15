/**
 * admin-email.ts
 *
 * Rutas de administración del sistema de email y logs de notificaciones.
 * TODOS requieren rol super_admin.
 *
 * GET    /api/admin/email-provider/status       — estado del proveedor
 * POST   /api/admin/email-provider/configure    — configurar credenciales SMTP
 * POST   /api/admin/email-provider/test         — enviar email de prueba
 * POST   /api/admin/email-provider/reconnect    — verificar conexión (health check)
 * POST   /api/admin/email-provider/disconnect   — desconectar proveedor
 * PATCH  /api/admin/email-provider/settings     — actualizar nombre/replyTo/activo
 * GET    /api/admin/email-logs                  — historial de emails enviados
 * GET    /api/admin/notification-events         — historial de eventos
 * POST   /api/admin/notification-deliveries/:id/retry — reintentar entrega fallida
 */

import { Router, type IRouter } from "express";
import { db, emailLogsTable, notificationEventsTable, notificationDeliveriesTable } from "@workspace/db";
import { desc, eq, and, gte, lte, ilike, or } from "drizzle-orm";
import {
  getProviderStatus,
  configureProvider,
  disconnectProvider,
  healthCheck,
  sendTestEmail,
  updateProviderSettings,
} from "../services/email-provider.service.js";
import { retryDelivery } from "../services/notification-engine.js";
import { requireAuth, requireSuperAdmin } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── All routes require super_admin ─────────────────────────────────────────────
router.use("/admin/email-provider", requireAuth, requireSuperAdmin);
router.use("/admin/email-logs", requireAuth, requireSuperAdmin);
router.use("/admin/notification-events", requireAuth, requireSuperAdmin);
router.use("/admin/notification-deliveries", requireAuth, requireSuperAdmin);

// ── GET /admin/email-provider/status ─────────────────────────────────────────

router.get("/admin/email-provider/status", async (_req, res): Promise<void> => {
  try {
    const status = await getProviderStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    logger.error({ err }, "admin-email: error getting provider status");
    res.status(500).json({ ok: false, error: "Error al obtener el estado del proveedor" });
  }
});

// ── POST /admin/email-provider/configure ─────────────────────────────────────

router.post("/admin/email-provider/configure", async (req, res): Promise<void> => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, senderEmail, senderName, replyTo, providerType } = req.body ?? {};

  if (!smtpHost || !smtpUser || !smtpPass) {
    res.status(400).json({ ok: false, error: "smtpHost, smtpUser y smtpPass son requeridos" });
    return;
  }

  const port = parseInt(smtpPort) || 587;
  if (isNaN(port) || port < 1 || port > 65535) {
    res.status(400).json({ ok: false, error: "smtpPort inválido" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (senderEmail && !emailRegex.test(senderEmail)) {
    res.status(400).json({ ok: false, error: "senderEmail tiene formato inválido" });
    return;
  }
  if (replyTo && !emailRegex.test(replyTo)) {
    res.status(400).json({ ok: false, error: "replyTo tiene formato inválido" });
    return;
  }
  if (!emailRegex.test(smtpUser)) {
    res.status(400).json({ ok: false, error: "smtpUser debe ser un email válido" });
    return;
  }

  try {
    // Save credentials (isActive=false until health check passes)
    await configureProvider(
      { smtpHost, smtpPort: port, smtpUser, smtpPass, senderEmail, senderName, replyTo, providerType },
      (req as any).dbUser?.email,
    );

    // Verify credentials before activating
    const health = await healthCheck();

    if (!health.ok) {
      // Leave isActive=false — credentials saved but not activated
      const status = await getProviderStatus();
      res.json({
        ok: false,
        saved: true,
        warning: "Credenciales guardadas pero la verificación de conexión falló. Revisá el host, usuario y contraseña.",
        error: health.error,
        data: status,
      });
      return;
    }

    // Health check passed — activate the provider
    await updateProviderSettings({ isActive: true });
    const status = await getProviderStatus();

    logger.info({ actor: (req as any).dbUser?.email, smtpHost, smtpUser: smtpUser?.replace(/./g, "•") }, "admin-email: provider configured and activated");
    res.json({ ok: true, message: "Proveedor configurado y verificado correctamente", data: status, latencyMs: health.latencyMs });
  } catch (err) {
    logger.error({ err }, "admin-email: error configuring provider");
    res.status(500).json({ ok: false, error: "Error al guardar la configuración" });
  }
});

// ── POST /admin/email-provider/test ──────────────────────────────────────────

router.post("/admin/email-provider/test", async (req, res): Promise<void> => {
  const actor = (req as any).dbUser!;
  const testEmail = req.body?.email ?? actor.email;

  if (!testEmail || typeof testEmail !== "string") {
    res.status(400).json({ ok: false, error: "Se requiere email de destinatario" });
    return;
  }

  try {
    const result = await sendTestEmail(testEmail, { adminName: actor.name ?? actor.email, userId: actor.id });
    if (!result.ok) {
      res.json({ ok: false, error: result.error ?? result.status });
      return;
    }
    logger.info({ actor: actor.email, testEmail }, "admin-email: test email sent");
    res.json({ ok: true, message: `Email de prueba enviado a ${testEmail}`, messageId: result.messageId });
  } catch (err) {
    logger.error({ err }, "admin-email: error sending test email");
    res.status(500).json({ ok: false, error: "Error al enviar el email de prueba" });
  }
});

// ── POST /admin/email-provider/reconnect ─────────────────────────────────────

router.post("/admin/email-provider/reconnect", async (req, res): Promise<void> => {
  try {
    const result = await healthCheck();
    const status = await getProviderStatus();
    res.json({ ok: result.ok, data: status, latencyMs: result.latencyMs, error: result.error });
  } catch (err) {
    logger.error({ err }, "admin-email: error on reconnect/health check");
    res.status(500).json({ ok: false, error: "Error al verificar la conexión" });
  }
});

// ── POST /admin/email-provider/disconnect ────────────────────────────────────

router.post("/admin/email-provider/disconnect", async (req, res): Promise<void> => {
  try {
    await disconnectProvider((req as any).dbUser?.email);
    logger.info({ actor: (req as any).dbUser?.email }, "admin-email: provider disconnected");
    res.json({ ok: true, message: "Proveedor desconectado" });
  } catch (err) {
    logger.error({ err }, "admin-email: error disconnecting provider");
    res.status(500).json({ ok: false, error: "Error al desconectar el proveedor" });
  }
});

// ── PATCH /admin/email-provider/settings ─────────────────────────────────────

router.patch("/admin/email-provider/settings", async (req, res): Promise<void> => {
  const { senderName, replyTo, isActive } = req.body ?? {};

  try {
    await updateProviderSettings({
      senderName: typeof senderName === "string" ? senderName : undefined,
      replyTo:    typeof replyTo === "string" ? replyTo : undefined,
      isActive:   typeof isActive === "boolean" ? isActive : undefined,
    });
    const status = await getProviderStatus();
    res.json({ ok: true, message: "Configuración actualizada", data: status });
  } catch (err) {
    logger.error({ err }, "admin-email: error updating settings");
    res.status(500).json({ ok: false, error: "Error al actualizar la configuración" });
  }
});

// ── GET /admin/email-logs ─────────────────────────────────────────────────────

router.get("/admin/email-logs", async (req, res): Promise<void> => {
  const { status, templateKey, userId, from, to, limit: rawLimit, offset: rawOffset } = req.query;

  const limit  = Math.min(parseInt(String(rawLimit ?? "50")),  200);
  const offset = Math.max(parseInt(String(rawOffset ?? "0")),  0);

  try {
    const conditions = [];

    if (status && typeof status === "string") {
      conditions.push(eq(emailLogsTable.status, status));
    }
    if (templateKey && typeof templateKey === "string") {
      conditions.push(eq(emailLogsTable.templateKey, templateKey));
    }
    if (userId && !isNaN(parseInt(String(userId)))) {
      conditions.push(eq(emailLogsTable.userId, parseInt(String(userId))));
    }
    if (from && typeof from === "string") {
      conditions.push(gte(emailLogsTable.createdAt, new Date(from)));
    }
    if (to && typeof to === "string") {
      conditions.push(lte(emailLogsTable.createdAt, new Date(to)));
    }

    const rows = await db
      .select()
      .from(emailLogsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(emailLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ ok: true, data: rows, limit, offset });
  } catch (err) {
    logger.error({ err }, "admin-email: error getting email logs");
    res.status(500).json({ ok: false, error: "Error al obtener los logs" });
  }
});

// ── GET /admin/notification-events ───────────────────────────────────────────

router.get("/admin/notification-events", async (req, res): Promise<void> => {
  const { eventType, userId, limit: rawLimit, offset: rawOffset } = req.query;
  const limit  = Math.min(parseInt(String(rawLimit ?? "50")), 200);
  const offset = Math.max(parseInt(String(rawOffset ?? "0")), 0);

  try {
    const conditions = [];
    if (eventType && typeof eventType === "string") conditions.push(eq(notificationEventsTable.eventType, eventType));
    if (userId && !isNaN(parseInt(String(userId)))) conditions.push(eq(notificationEventsTable.userId, parseInt(String(userId))));

    const rows = await db
      .select()
      .from(notificationEventsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(notificationEventsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ ok: true, data: rows, limit, offset });
  } catch (err) {
    logger.error({ err }, "admin-email: error getting notification events");
    res.status(500).json({ ok: false, error: "Error al obtener los eventos" });
  }
});

// ── POST /admin/notification-deliveries/:id/retry ─────────────────────────────

router.post("/admin/notification-deliveries/:id/retry", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) { res.status(400).json({ ok: false, error: "ID inválido" }); return; }

  try {
    const result = await retryDelivery(id);
    res.json({ ok: result.ok, message: result.message });
  } catch (err) {
    logger.error({ err }, "admin-email: error retrying delivery");
    res.status(500).json({ ok: false, error: "Error al reintentar el envío" });
  }
});

export default router;
