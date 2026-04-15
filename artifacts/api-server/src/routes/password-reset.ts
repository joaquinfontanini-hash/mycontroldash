/**
 * password-reset.ts
 *
 * Flujo seguro de restablecimiento de contraseña.
 *
 * POST /api/auth/forgot-password
 *   — Rate limited por IP (5/hora) + por email (3/hora)
 *   — Respuesta siempre neutra (no enumera usuarios)
 *   — Genera token aleatorio seguro, guarda SHA-256, invalida tokens anteriores
 *   — Envía email con link que incluye el token en claro
 *
 * GET  /api/auth/reset-password/validate?token=XXX
 *   — Verifica que el token existe, no está usado y no expiró
 *   — No expone detalles sensibles
 *
 * POST /api/auth/reset-password
 *   — Valida token, actualiza contraseña, invalida token, destruye sesiones
 *   — Envía email de confirmación de cambio
 */

import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { sendTemplateEmail } from "../services/email-provider.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const RESET_TOKEN_EXPIRY_MINUTES = 30;
const APP_URL = process.env["APP_URL"] ?? "http://localhost:5173";
const MIN_PASSWORD_LENGTH = 8;

// ── Rate limiters ─────────────────────────────────────────────────────────────

const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5,
  keyGenerator: (req) =>
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown",
  handler: (_req, res) => {
    res.status(429).json({ ok: true, message: "Si el email existe, te enviamos instrucciones." });
  },
  skip: () => process.env["NODE_ENV"] === "test",
});

const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 3,
  keyGenerator: (req) => {
    const email = (req.body?.email ?? "").toLowerCase().trim();
    return `email:${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ ok: true, message: "Si el email existe, te enviamos instrucciones." });
  },
  skip: () => process.env["NODE_ENV"] === "test",
});

// ── Token utilities ───────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString("hex"); // 64 hex chars, URL-safe
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────

router.post(
  "/auth/forgot-password",
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  async (req, res): Promise<void> => {
    const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ??
      req.socket?.remoteAddress ?? "unknown";
    const ua = req.headers["user-agent"] ?? "";

    const { email } = req.body ?? {};

    // Always respond the same — never reveal whether the email exists
    const NEUTRAL = { ok: true, message: "Si el email está registrado, recibirás instrucciones en los próximos minutos." };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.json(NEUTRAL); // intentionally neutral
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    logger.info({ ip, email: normalizedEmail }, "forgot-password: request");

    try {
      const [user] = await db
        .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, isActive: usersTable.isActive, isBlocked: usersTable.isBlocked })
        .from(usersTable)
        .where(eq(usersTable.email, normalizedEmail));

      // If user doesn't exist or is inactive — still respond neutrally
      if (!user || !user.isActive || user.isBlocked) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200)); // timing equalization
        res.json(NEUTRAL);
        return;
      }

      // Invalidate any existing unused tokens for this user
      await db
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokensTable.userId, user.id),
            isNull(passwordResetTokensTable.usedAt),
          ),
        );

      // Generate new token
      const plainToken = generateToken();
      const tokenHash  = hashToken(plainToken);
      const expiresAt  = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await db.insert(passwordResetTokensTable).values({
        userId:             user.id,
        tokenHash,
        expiresAt,
        requestedIp:        ip.substring(0, 45),
        requestedUserAgent: ua.substring(0, 500),
      });

      // Build reset link (APP_URL points to the frontend)
      const resetUrl = `${APP_URL}/reset-password?token=${plainToken}`;

      // Send email — fire and forget, but log errors
      sendTemplateEmail(
        "forgot_password_request",
        {
          userName:        user.name ?? user.email,
          resetUrl,
          expiresMinutes:  RESET_TOKEN_EXPIRY_MINUTES,
          requestedAt:     new Date(),
          ip:              ip,
        },
        user.email,
        { userId: user.id },
      ).catch(err => {
        logger.error({ err, userId: user.id }, "forgot-password: email send failed");
      });

      logger.info({ userId: user.id, ip }, "forgot-password: token generated and email queued");
    } catch (err) {
      logger.error({ err, email: normalizedEmail, ip }, "forgot-password: internal error");
    }

    // Always respond neutrally
    res.json(NEUTRAL);
  },
);

// ── GET /api/auth/reset-password/validate ────────────────────────────────────

router.get("/auth/reset-password/validate", async (req, res): Promise<void> => {
  const { token } = req.query;

  if (!token || typeof token !== "string" || token.length < 60) {
    res.status(400).json({ ok: false, valid: false, error: "Token inválido o mal formado" });
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const now       = new Date();

    const [record] = await db
      .select({
        id:        passwordResetTokensTable.id,
        expiresAt: passwordResetTokensTable.expiresAt,
        usedAt:    passwordResetTokensTable.usedAt,
        userId:    passwordResetTokensTable.userId,
      })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, tokenHash));

    if (!record) {
      res.json({ ok: false, valid: false, error: "Token inválido o no encontrado" });
      return;
    }
    if (record.usedAt) {
      res.json({ ok: false, valid: false, error: "Este enlace ya fue utilizado" });
      return;
    }
    if (record.expiresAt < now) {
      res.json({ ok: false, valid: false, error: "El enlace expiró. Solicitá uno nuevo." });
      return;
    }

    res.json({ ok: true, valid: true });
  } catch (err) {
    logger.error({ err }, "reset-password/validate: error");
    res.status(500).json({ ok: false, valid: false, error: "Error al validar el token" });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ??
    req.socket?.remoteAddress ?? "unknown";

  const { token, newPassword } = req.body ?? {};

  if (!token || typeof token !== "string" || token.length < 60) {
    res.status(400).json({ ok: false, error: "Token inválido" });
    return;
  }
  if (!newPassword || typeof newPassword !== "string") {
    res.status(400).json({ ok: false, error: "La nueva contraseña es requerida" });
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` });
    return;
  }
  if (!/[A-Z]/.test(newPassword) && !/[0-9]/.test(newPassword)) {
    res.status(400).json({ ok: false, error: "La contraseña debe incluir al menos un número o una mayúscula" });
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const now       = new Date();

    const [record] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, tokenHash));

    if (!record) {
      res.status(400).json({ ok: false, error: "Token inválido" });
      return;
    }
    if (record.usedAt) {
      res.status(400).json({ ok: false, error: "Este enlace ya fue utilizado" });
      return;
    }
    if (record.expiresAt < now) {
      res.status(400).json({ ok: false, error: "El enlace expiró. Solicitá uno nuevo desde la pantalla de login." });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, record.userId));

    if (!user || !user.isActive) {
      res.status(400).json({ ok: false, error: "Cuenta no disponible" });
      return;
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user password and clear mustChangePassword
    await db.update(usersTable).set({
      passwordHash,
      mustChangePassword: false,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, user.id));

    // Mark token as used
    await db.update(passwordResetTokensTable).set({ usedAt: new Date() })
      .where(eq(passwordResetTokensTable.id, record.id));

    // Destroy current session if any (force re-login)
    if (req.session?.userId) {
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    }

    logger.info({ userId: user.id, ip }, "reset-password: password changed successfully");

    // Send confirmation email (fire and forget)
    sendTemplateEmail(
      "password_changed",
      { userName: user.name ?? user.email, changedAt: new Date(), ip, appUrl: APP_URL },
      user.email,
      { userId: user.id },
    ).catch(err => logger.error({ err }, "reset-password: confirmation email failed"));

    res.json({ ok: true, message: "Contraseña restablecida correctamente. Ya podés ingresar." });
  } catch (err) {
    logger.error({ err }, "reset-password: error");
    res.status(500).json({ ok: false, error: "Error interno. Intentá de nuevo." });
  }
});

export default router;
