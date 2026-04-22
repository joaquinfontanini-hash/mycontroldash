import { Router, type IRouter, type Request } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { dispatch } from "../services/notification-engine.js";

const router: IRouter = Router();

// ── Constantes de seguridad ───────────────────────────────────────────────────

// Hash dummy pre-computado para bcrypt timing-safe.
// Se usa cuando el usuario no existe para que el tiempo de respuesta sea
// indistinguible del caso "usuario existe pero contraseña incorrecta".
// El valor exacto no importa — nunca va a coincidir con ninguna contraseña real.
const DUMMY_HASH =
  "$2b$12$invalidhashfortimingneutralizationXXXXXXXXXXXXXXXXXXXXX";

// Longitud mínima de contraseña
const MIN_PASSWORD_LEN = 8;

// ── Helper: sanitizar usuario para response ───────────────────────────────────
// NUNCA devolver passwordHash, metadata interna, ni campos sensibles al cliente.
function sanitizeUser(user: typeof usersTable.$inferSelect) {
  return {
    id:                 user.id,
    email:              user.email,
    name:               user.name,
    role:               user.role,
    isActive:           user.isActive,
    isBlocked:          user.isBlocked,
    mustChangePassword: user.mustChangePassword,
    createdAt:          user.createdAt,
    // clerkId se incluye porque el frontend lo necesita para integración Clerk
    clerkId:            user.clerkId,
  };
}

// ── Helper: IP del cliente ────────────────────────────────────────────────────
function getIp(req: Request): string {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  );
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email:    z.string().email("Email inválido").max(254),
  password: z.string().min(1, "La contraseña es requerida").max(1024),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "La contraseña actual es requerida"),
  newPassword:     z
    .string()
    .min(MIN_PASSWORD_LEN, `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres`)
    .max(1024),
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
// Seguridad implementada:
//   1. Timing-safe: bcrypt.compare() siempre corre aunque el usuario no exista
//   2. Sin user enumeration: mismo mensaje de error para usuario inexistente y
//      contraseña incorrecta
//   3. Audit trail: todo intento se loguea con IP
//   4. Session save explícito antes de responder
router.post("/auth/login", async (req: Request, res): Promise<void> => {
  const ip = getIp(req);

  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ ip }, "Login attempt: invalid input");
    res.status(400).json({ error: "Email y contraseña son requeridos" });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  logger.info({ ip, email: normalizedEmail }, "Login attempt: start");

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));

    // ── TIMING-SAFE: siempre ejecutar bcrypt.compare() ────────────────────────
    // Si el usuario no existe usamos DUMMY_HASH. Esto garantiza que el tiempo
    // de respuesta sea idéntico independientemente de si el usuario existe o no,
    // eliminando el ataque de user enumeration por timing.
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await bcrypt.compare(password, hashToCompare);

    // Verificaciones en este orden deliberado — después del bcrypt para no
    // crear diferencias de timing entre los distintos casos de fallo:
    if (!user || !passwordValid) {
      logger.warn(
        { ip, email: normalizedEmail, reason: !user ? "user_not_found" : "wrong_password" },
        "Login attempt: failed",
      );
      // Mismo mensaje para ambos casos — sin user enumeration
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    if (!user.isActive) {
      logger.warn({ ip, email: normalizedEmail, userId: user.id }, "Login attempt: account inactive");
      res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." });
      return;
    }

    if (user.isBlocked) {
      logger.warn({ ip, email: normalizedEmail, userId: user.id }, "Login attempt: account blocked");
      res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." });
      return;
    }

    if (!user.passwordHash) {
      // Cuenta Clerk-only — no tiene contraseña local
      logger.warn({ ip, email: normalizedEmail, userId: user.id }, "Login attempt: no local password");
      res.status(401).json({
        error: "Este usuario no tiene contraseña local. Usá Google para ingresar.",
      });
      return;
    }

    // ── Establecer sesión ─────────────────────────────────────────────────────
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    // Actualizar timestamp de actividad en background
    db.update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch((err: unknown) => logger.warn({ err }, "auth/login: lastActivityAt update failed"));

    logger.info(
      { ip, userId: user.id, email: user.email, role: user.role },
      "Login attempt: success",
    );

    // Notificación de login (fire-and-forget, deduplicada por hora)
    dispatch({
      userId:         user.id,
      eventType:      "login",
      eventSubtype:   "normal",
      recipientEmail: user.email,
      dedupeKey:      `login:${user.id}:${new Date().toISOString().slice(0, 13)}`,
      dedupeWindowMs: 12 * 3_600_000,
      payload: {
        userName:  user.name ?? user.email,
        email:     user.email,
        loginAt:   new Date(),
        ip,
        userAgent: req.headers["user-agent"]?.substring(0, 150),
        appUrl:    process.env["APP_URL"] ?? "",
      },
    }).catch((err: unknown) =>
      logger.warn({ err }, "auth/login: login alert dispatch failed (non-critical)"),
    );

    res.json(sanitizeUser(user));
  } catch (err) {
    logger.error({ err, ip, email: normalizedEmail }, "auth/login error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

// ── POST /auth/change-password ────────────────────────────────────────────────
// Requiere contraseña actual para prevenir hijacking de sesión.
// El original no pedía la contraseña actual — cualquier sesión robada podía
// cambiar la contraseña sin conocerla.
router.post("/auth/change-password", async (req: Request, res): Promise<void> => {
  const sessionUserId = req.session?.userId;
  if (!sessionUserId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, sessionUserId));

    if (!user || !user.isActive || user.isBlocked) {
      res.status(403).json({ error: "Acceso denegado" });
      return;
    }

    // Verificar contraseña actual (timing-safe con dummy para el caso sin hash)
    const hashToCompare = user.passwordHash ?? DUMMY_HASH;
    const currentValid  = await bcrypt.compare(parsed.data.currentPassword, hashToCompare);

    if (!currentValid || !user.passwordHash) {
      logger.warn({ userId: user.id }, "change-password: wrong current password");
      res.status(401).json({ error: "La contraseña actual es incorrecta" });
      return;
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash: newHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id }, "Password changed successfully");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "auth/change-password error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

// ── POST /auth/google-session ─────────────────────────────────────────────────
// Establece una sesión local para usuarios autenticados con Clerk/Google.
// Llamado por el frontend después de que Clerk autentica exitosamente.
router.post("/auth/google-session", async (req: Request, res): Promise<void> => {
  const ip      = getIp(req);
  const clerkId = getAuth(req)?.userId;

  if (!clerkId) {
    logger.warn({ ip }, "Google session: no Clerk token present");
    res.status(401).json({ error: "Sin sesión Google activa" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    if (!user) {
      logger.warn({ ip, clerkId }, "Google session: Clerk user has no matching DB record");
      res.status(404).json({ error: "Usuario no registrado. Completá el registro primero." });
      return;
    }

    if (!user.isActive) {
      logger.warn({ ip, userId: user.id }, "Google session: account inactive");
      res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." });
      return;
    }

    if (user.isBlocked) {
      logger.warn({ ip, userId: user.id }, "Google session: account blocked");
      res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." });
      return;
    }

    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    db.update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch((err: unknown) => logger.warn({ err }, "google-session: lastActivityAt update failed"));

    logger.info({ ip, userId: user.id, role: user.role }, "Google session: established");

    res.json(sanitizeUser(user));
  } catch (err) {
    logger.error({ err, ip, clerkId }, "auth/google-session error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", (req: Request, res): void => {
  const sessionUserId = req.session?.userId;
  req.session.destroy((err) => {
    if (err) logger.error({ err }, "session destroy error");
    // Limpiar cookie con los mismos atributos con los que fue creada
    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure:   process.env["NODE_ENV"] === "production",
      sameSite: process.env["NODE_ENV"] === "production" ? "none" : "lax",
    });
    logger.info({ userId: sessionUserId ?? "unknown" }, "Logout: session destroyed");
    res.json({ ok: true });
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
// Devuelve el usuario autenticado sin campos sensibles.
// Soporta tanto sesión local como autenticación Clerk.
router.get("/auth/me", async (req: Request, res): Promise<void> => {
  const sessionUserId = req.session?.userId;

  if (sessionUserId) {
    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, sessionUserId));

      if (!user || !user.isActive || user.isBlocked) {
        req.session.destroy(() => {});
        res.status(401).json({ error: "Sesión inválida" });
        return;
      }

      res.json(sanitizeUser(user));
      return;
    } catch (err) {
      logger.error({ err }, "auth/me session error");
      res.status(500).json({ error: "Error interno" });
      return;
    }
  }

  // Fallback a Clerk si no hay sesión local
  const clerkId = getAuth(req)?.userId;
  if (!clerkId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    if (!user || !user.isActive || user.isBlocked) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    res.json(sanitizeUser(user));
  } catch (err) {
    logger.error({ err }, "auth/me clerk error");
    res.status(401).json({ error: "No autenticado" });
  }
});

export default router;
