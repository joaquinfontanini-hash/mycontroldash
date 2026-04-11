import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type AuthenticatedRequest = Request & {
  dbUser: {
    id: number;
    clerkId: string;
    email: string;
    name: string | null;
    role: string;
    isActive: boolean;
    isBlocked: boolean;
  };
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.userId));
    if (!user) {
      res.status(401).json({ error: "Usuario no registrado en el sistema" });
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
    (req as AuthenticatedRequest).dbUser = user;
    await db.update(usersTable).set({ lastActivityAt: new Date() }).where(eq(usersTable.id, user.id));
    next();
  } catch (err) {
    logger.error({ err }, "requireAuth error");
    res.status(500).json({ error: "Error de autenticación" });
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    try {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.userId));
      if (!user || !user.isActive || user.isBlocked) {
        res.status(403).json({ error: "Acceso denegado" });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ error: `Se requiere rol: ${roles.join(" o ")}` });
        return;
      }
      (req as AuthenticatedRequest).dbUser = user;
      next();
    } catch (err) {
      logger.error({ err }, "requireRole error");
      res.status(500).json({ error: "Error de autorización" });
    }
  };
}

export const requireAdmin = requireRole("super_admin", "admin");
export const requireSuperAdmin = requireRole("super_admin");
