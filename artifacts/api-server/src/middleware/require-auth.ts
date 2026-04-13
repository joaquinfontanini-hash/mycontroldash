import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, modulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type AuthenticatedRequest = Request & {
  dbUser: {
    id: number;
    clerkId: string | null;
    email: string;
    name: string | null;
    role: string;
    isActive: boolean;
    isBlocked: boolean;
  };
};

async function resolveUser(req: Request): Promise<typeof usersTable.$inferSelect | null> {
  const sessionUserId = req.session?.userId;
  if (sessionUserId) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, sessionUserId));
    return user ?? null;
  }

  const clerkId = getAuth(req)?.userId;
  if (clerkId) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));
    return user ?? null;
  }

  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveUser(req);

    if (!user) {
      res.status(401).json({ error: "No autenticado" });
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
    await db
      .update(usersTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(usersTable.id, user.id));
    next();
  } catch (err) {
    logger.error({ err }, "requireAuth error");
    res.status(500).json({ error: "Error de autenticación" });
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await resolveUser(req);

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

// ── Module-level access guard ─────────────────────────────────────────────────
// Super-admin always passes. Other roles checked against modulesTable.allowedRoles.
export function requireModule(key: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await resolveUser(req);
      if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
      if (!user.isActive) { res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." }); return; }
      if (user.isBlocked) { res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." }); return; }

      (req as AuthenticatedRequest).dbUser = user;

      // Super admin bypasses all module restrictions
      if (user.role === "super_admin") { next(); return; }

      const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.key, key));

      // Module not found in DB → allow (fail-open for unknown modules)
      if (!mod) { next(); return; }

      if (!mod.isActive) {
        res.status(403).json({ error: "Este módulo no está disponible. Contactá al administrador." });
        return;
      }

      if (!mod.allowedRoles.includes(user.role)) {
        res.status(403).json({ error: "No tenés permiso para acceder a este módulo." });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err }, "requireModule error");
      res.status(500).json({ error: "Error de autorización" });
    }
  };
}
