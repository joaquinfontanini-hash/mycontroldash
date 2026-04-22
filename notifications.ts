/**
 * notifications.ts
 *
 * Preferencias de alertas del usuario autenticado.
 *
 * GET  /me/notification-preferences       — obtener preferencias (con defaults)
 * PATCH /me/notification-preferences      — actualizar preferencias
 * POST  /me/notification-preferences/test — enviar email de prueba al usuario
 */

import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/require-auth.js";
import {
  getUserNotificationPrefs,
  upsertUserNotificationPrefs,
} from "../services/notification-engine.js";
import { sendTestEmail } from "../services/email-provider.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Aplicar requireAuth a todo el namespace /me/notification-preferences
router.use("/me/notification-preferences", requireAuth);

// ── Defaults devueltos cuando el usuario no tiene preferencias configuradas ────
const DEFAULT_PREFS = {
  emailEnabled:        true,
  dueDateEnabled:      true,
  dueDateDaysBefore:   "7,3,1",
  dueDateSameDay:      true,
  dueDateSummaryOnly:  false,
  newsEnabled:         false,
  newsFrequency:       "daily",
  newsMinPriority:     "high",
  newsCategories:      "",
  newsMaxPerDay:       3,
  dollarEnabled:       false,
  dollarUpThreshold:   null,
  dollarDownThreshold: null,
  dollarMarket:        "blue",
  dollarDailySummary:  false,
  loginEnabled:        true,
  loginEveryAccess:    false,
  loginNewDeviceOnly:  true,
  loginSuspiciousOnly: false,
  loginPasswordChange: true,
} as const;

// ── Zod schema ────────────────────────────────────────────────────────────────
// Reemplaza las validaciones manuales encadenadas del original.
// `.partial()` permite actualizar solo los campos enviados.
const UpdatePrefsSchema = z
  .object({
    emailEnabled:        z.boolean(),
    dueDateEnabled:      z.boolean(),
    dueDateDaysBefore:   z
      .string()
      .regex(
        /^\d+(,\d+)*$/,
        "dueDateDaysBefore debe ser una lista de días positivos separados por coma (ej: 7,3,1)",
      )
      .refine(
        (v) => v.split(",").every((n) => parseInt(n, 10) > 0),
        "Todos los días deben ser mayores a 0",
      ),
    dueDateSameDay:      z.boolean(),
    dueDateSummaryOnly:  z.boolean(),
    newsEnabled:         z.boolean(),
    newsFrequency:       z.enum(["immediate", "daily", "weekly"]),
    newsMinPriority:     z.enum(["low", "medium", "high"]),
    newsCategories:      z.string().max(500),
    newsMaxPerDay:       z.coerce.number().int().min(1).max(50),
    dollarEnabled:       z.boolean(),
    dollarUpThreshold:   z
      .union([z.null(), z.coerce.number().min(0).max(100)])
      .transform((v) => (v === null ? null : String(v)))
      .nullable(),
    dollarDownThreshold: z
      .union([z.null(), z.coerce.number().min(0).max(100)])
      .transform((v) => (v === null ? null : String(v)))
      .nullable(),
    dollarMarket:        z.enum(["blue", "mep", "oficial", "ccl"]),
    dollarDailySummary:  z.boolean(),
    loginEnabled:        z.boolean(),
    loginEveryAccess:    z.boolean(),
    loginNewDeviceOnly:  z.boolean(),
    loginSuspiciousOnly: z.boolean(),
    loginPasswordChange: z.boolean(),
  })
  .partial()
  .strict(); // Rechaza campos no definidos — previene mass assignment

// ── GET /me/notification-preferences ─────────────────────────────────────────
router.get("/me/notification-preferences", async (req: Request, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).dbUser.id;
  try {
    const prefs = await getUserNotificationPrefs(userId);
    res.json({
      ok:   true,
      data: prefs ?? { userId, ...DEFAULT_PREFS, id: null, createdAt: null, updatedAt: null },
    });
  } catch (err) {
    logger.error({ err, userId }, "notifications: error getting prefs");
    res.status(500).json({ ok: false, error: "Error al obtener las preferencias" });
  }
});

// ── PATCH /me/notification-preferences ───────────────────────────────────────
router.patch("/me/notification-preferences", async (req: Request, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).dbUser.id;

  const parsed = UpdatePrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  try {
    const prefs = await upsertUserNotificationPrefs(userId, parsed.data);
    res.json({ ok: true, data: prefs, message: "Preferencias actualizadas" });
  } catch (err) {
    logger.error({ err, userId }, "notifications: error updating prefs");
    res.status(500).json({ ok: false, error: "Error al guardar las preferencias" });
  }
});

// ── POST /me/notification-preferences/test ────────────────────────────────────
router.post("/me/notification-preferences/test", async (req: Request, res): Promise<void> => {
  const user = (req as AuthenticatedRequest).dbUser;
  try {
    const result = await sendTestEmail(user.email, {
      adminName: user.name ?? user.email,
      userId:    user.id,
    });

    if (!result.ok) {
      if (result.status === "not_configured") {
        res.status(503).json({
          ok:    false,
          error: "El sistema de email no está configurado. Contactá al administrador.",
        });
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
