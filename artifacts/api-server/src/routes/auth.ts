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
  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email y contraseña son requeridos" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()));

    if (!user) {
      await new Promise(r => setTimeout(r, 400));
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." });
      return;
    }
    if (user.isBlocked) {
      res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." });
      return;
    }
    if (!user.passwordHash) {
      res.status(401).json({ error: "Este usuario no tiene contraseña local configurada. Usá Google para ingresar." });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await new Promise(r => setTimeout(r, 400));
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    req.session.userId = user.id;
    await db
      .update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id, email: user.email }, "Local login success");
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    logger.error({ err }, "auth/login error");
    res.status(500).json({ error: "Error interno. Intentá de nuevo." });
  }
});

router.post("/auth/google-session", async (req: Request, res): Promise<void> => {
  const clerkAuth = getAuth(req);
  const clerkId = clerkAuth?.userId;

  if (!clerkId) {
    res.status(401).json({ error: "Sin sesión Google activa" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    if (!user) {
      res.status(404).json({ error: "Usuario no registrado. Completá el registro primero." });
      return;
    }
    if (!user.isActive || user.isBlocked) {
      res.status(403).json({ error: "Acceso denegado" });
      return;
    }

    req.session.userId = user.id;
    await db
      .update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id, email: user.email }, "Google session established");
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    logger.error({ err }, "auth/google-session error");
    res.status(500).json({ error: "Error interno" });
  }
});

router.post("/auth/logout", async (req: Request, res): Promise<void> => {
  req.session.destroy((err) => {
    if (err) logger.error({ err }, "session destroy error");
    res.clearCookie("connect.sid");
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
