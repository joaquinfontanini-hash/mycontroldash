/**
 * notifications.ts
 *
 * Preferencias de alertas del usuario autenticado.
 *
 * GET    /api/me/notification-preferences        — obtener preferencias (con defaults)
 * PATCH  /api/me/notification-preferences        — actualizar preferencias
 * POST   /api/me/notification-preferences/test   — enviar email de prueba al usuario
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getUserNotificationPrefs,
  upsertUserNotificationPrefs,
} from "../services/notification-engine.js";
import { sendTestEmail } from "../services/email-provider.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/me/notification-preferences", requireAuth);

// Default prefs to return when user has none configured
const DEFAULT_PREFS = {
  emailEnabled:         true,
  dueDateEnabled:       true,
  dueDateDaysBefore:    "7,3,1",
  dueDateSameDay:       true,
  dueDateSummaryOnly:   false,
  newsEnabled:          false,
  newsFrequency:        "daily",
  newsMinPriority:      "high",
  newsCategories:       "",
  newsMaxPerDay:        3,
  dollarEnabled:        false,
  dollarUpThreshold:    null,
  dollarDownThreshold:  null,
  dollarMarket:         "blue",
  dollarDailySummary:   false,
  loginEnabled:         true,
  loginEveryAccess:     false,
  loginNewDeviceOnly:   true,
  loginSuspiciousOnly:  false,
  loginPasswordChange:  true,
};

// ── GET /api/me/notification-preferences ─────────────────────────────────────

router.get("/me/notification-preferences", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id;
  try {
    const prefs = await getUserNotificationPrefs(userId);
    res.json({ ok: true, data: prefs ?? { userId, ...DEFAULT_PREFS, id: null, createdAt: null, updatedAt: null } });
  } catch (err) {
    logger.error({ err, userId }, "notifications: error getting prefs");
    res.status(500).json({ ok: false, error: "Error al obtener las preferencias" });
  }
});

// ── PATCH /api/me/notification-preferences ────────────────────────────────────

const ALLOWED_FIELDS = new Set([
  "emailEnabled",
  "dueDateEnabled", "dueDateDaysBefore", "dueDateSameDay", "dueDateSummaryOnly",
  "newsEnabled", "newsFrequency", "newsMinPriority", "newsCategories", "newsMaxPerDay",
  "dollarEnabled", "dollarUpThreshold", "dollarDownThreshold", "dollarMarket", "dollarDailySummary",
  "loginEnabled", "loginEveryAccess", "loginNewDeviceOnly", "loginSuspiciousOnly", "loginPasswordChange",
]);

router.patch("/me/notification-preferences", async (req, res): Promise<void> => {
  const userId = (req as any).dbUser!.id;
  const body = req.body ?? {};

  // Filter only allowed fields to prevent mass assignment
  const update: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) update[key] = val;
  }

  // Validate newsFrequency
  if (update["newsFrequency"] && !["immediate", "daily", "weekly"].includes(String(update["newsFrequency"]))) {
    res.status(400).json({ ok: false, error: "newsFrequency debe ser: immediate, daily o weekly" });
    return;
  }
  // Validate newsMinPriority
  if (update["newsMinPriority"] && !["low", "medium", "high"].includes(String(update["newsMinPriority"]))) {
    res.status(400).json({ ok: false, error: "newsMinPriority debe ser: low, medium o high" });
    return;
  }
  // Validate dollarMarket
  if (update["dollarMarket"] && !["blue", "mep", "oficial", "ccl"].includes(String(update["dollarMarket"]))) {
    res.status(400).json({ ok: false, error: "dollarMarket inválido" });
    return;
  }

  try {
    const prefs = await upsertUserNotificationPrefs(userId, update as any);
    res.json({ ok: true, data: prefs, message: "Preferencias actualizadas" });
  } catch (err) {
    logger.error({ err, userId }, "notifications: error updating prefs");
    res.status(500).json({ ok: false, error: "Error al guardar las preferencias" });
  }
});

// ── POST /api/me/notification-preferences/test ───────────────────────────────

router.post("/me/notification-preferences/test", async (req, res): Promise<void> => {
  const user = (req as any).dbUser!;
  try {
    const result = await sendTestEmail(user.email, { adminName: user.name ?? user.email, userId: user.id });
    if (!result.ok) {
      if (result.status === "not_configured") {
        res.status(503).json({ ok: false, error: "El sistema de email no está configurado. Contactá al administrador." });
        return;
      }
      res.json({ ok: false, error: result.error ?? "Error al enviar el email de prueba" });
      return;
    }
    res.json({ ok: true, message: `Email de prueba enviado a ${user.email}` });
  } catch (err) {
    logger.error({ err, userId: user.id }, "notifications: error sending test email");
    res.status(500).json({ ok: false, error: "Error al enviar el email de prueba" });
  }
});

export default router;
