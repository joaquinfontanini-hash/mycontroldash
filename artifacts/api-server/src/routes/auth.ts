import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { Request } from "express";

const router: IRouter = Router();

router.post("/auth/login", async (req: Request, res): Promise<void> => {
  const { email, password } = req.body ?? {};

  // Fix 4/6: Log every login attempt with IP for audit trail
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    logger.warn({ ip, email: email ?? "(missing)" }, "Login attempt: missing credentials");
    res.status(400).json({ error: "Email y contraseña son requeridos" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  logger.info({ ip, email: normalizedEmail }, "Login attempt: start");

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));

    if (!user) {
      await new Promise(r => setTimeout(r, 400));
      logger.warn({ ip, email: normalizedEmail }, "Login attempt: user not found");
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
      logger.warn({ ip, email: normalizedEmail, userId: user.id }, "Login attempt: no password hash (Google-only account)");
      res.status(401).json({ error: "Este usuario no tiene contraseña local configurada. Usá Google para ingresar." });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await new Promise(r => setTimeout(r, 400));
      logger.warn({ ip, email: normalizedEmail, userId: user.id }, "Login attempt: wrong password");
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    // Fix 4: Ensure session is saved before responding
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    await db
      .update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ ip, userId: user.id, email: user.email, role: user.role }, "Login attempt: success");
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (err) {
    logger.error({ err, ip, email: normalizedEmail }, "auth/login error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

router.post("/auth/change-password", async (req: Request, res): Promise<void> => {
  const sessionUserId = req.session?.userId;
  if (!sessionUserId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const { newPassword } = req.body ?? {};
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
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

    const hash = await bcrypt.hash(newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash: hash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id }, "Password changed successfully");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "auth/change-password error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

router.post("/auth/google-session", async (req: Request, res): Promise<void> => {
  const clerkAuth = getAuth(req);
  const clerkId = clerkAuth?.userId;

  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";

  if (!clerkId) {
    logger.warn({ ip }, "Google session: no Clerk token present");
    res.status(401).json({ error: "Sin sesión Google activa" });
    return;
  }

  logger.info({ ip, clerkId }, "Google session: establishing...");

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
      logger.warn({ ip, clerkId, userId: user.id, email: user.email }, "Google session: account inactive");
      res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." });
      return;
    }
    if (user.isBlocked) {
      logger.warn({ ip, clerkId, userId: user.id, email: user.email }, "Google session: account blocked");
      res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." });
      return;
    }

    // Fix 4: Ensure session is saved before responding
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    await db
      .update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ ip, userId: user.id, email: user.email, role: user.role }, "Google session: established");
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    logger.error({ err, ip, clerkId }, "auth/google-session error");
    res.status(500).json({ error: "Error interno" });
  }
});

router.post("/auth/logout", async (req: Request, res): Promise<void> => {
  const sessionUserId = req.session?.userId;
  req.session.destroy((err) => {
    if (err) logger.error({ err }, "session destroy error");
    // Fix 4: Clear cookie with same attributes used when setting it
    // so the browser actually removes it in cross-domain (sameSite none) mode
    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });
    logger.info({ userId: sessionUserId ?? "unknown" }, "Logout: session destroyed");
    res.json({ ok: true });
  });
});

router.get("/auth/me", async (req: Request, res): Promise<void> => {
  const sessionUserId = req.session?.userId;

  if (!sessionUserId) {
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
      res.json(user);
    } catch {
      res.status(401).json({ error: "No autenticado" });
    }
    return;
  }

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
    res.json(user);
  } catch (err) {
    logger.error({ err }, "auth/me error");
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
