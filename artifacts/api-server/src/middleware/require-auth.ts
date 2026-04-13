import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, modulesTable, userModulePermissionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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
// Checks in order:
//  1. User is authenticated, active, not blocked
//  2. Super-admin → always passes
//  3. Module must be globally active
//  4. User-level override (user_module_permissions): explicit disable overrides role
//  5. Role-level check (modules.allowed_roles)
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

      // Module not found in DB → deny (fail-closed for unknown modules)
      if (!mod) {
        res.status(403).json({ error: "Módulo no encontrado." });
        return;
      }

      if (!mod.isActive) {
        res.status(403).json({ error: "Este módulo no está disponible. Contactá al administrador." });
        return;
      }

      // Check user-level override (explicit grant or revoke per user)
      const [userPerm] = await db
        .select()
        .from(userModulePermissionsTable)
        .where(and(
          eq(userModulePermissionsTable.userId, user.id),
          eq(userModulePermissionsTable.moduleKey, key),
        ));

      if (userPerm !== undefined) {
        // Explicit override exists
        if (!userPerm.isEnabled) {
          res.status(403).json({ error: "No tenés permiso para acceder a este módulo." });
          return;
        }
        // isEnabled = true → access granted regardless of role
        next();
        return;
      }

      // No user-level override → fall back to role-level check
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

// ── Helper: get current user's string ID for data ownership ───────────────────
// All functional routes use this to scope queries to the authenticated user.
export function getCurrentUserId(req: Request): string {
  return String((req as AuthenticatedRequest).dbUser.id);
}

// ── Ownership assertion helper ────────────────────────────────────────────────
// Returns 403/404 if the record's userId doesn't match the current user.
// Super-admin always passes (they can access all data for admin purposes).
export function assertOwnership(
  req: Request,
  res: Response,
  recordUserId: string | null | undefined,
): boolean {
  const dbUser = (req as AuthenticatedRequest).dbUser;
  if (dbUser.role === "super_admin") return true;
  if (recordUserId !== String(dbUser.id)) {
    res.status(404).json({ error: "No encontrado" });
    return false;
  }
  return true;
}
