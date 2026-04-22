/**
 * require-auth.ts — Middleware de autenticación y autorización
 *
 * Fuente única de verdad: sesiones Express.
 * Todos los flujos de auth (login local, Clerk OAuth) deben crear una
 * sesión Express que almacena userId (entero FK a usersTable).
 *
 * Jerarquía de roles:
 *   super_admin > admin > editor > viewer
 *
 * Todos los helpers de este módulo asumen que requireAuth ya corrió antes
 * y que req.dbUser está seteado.
 */

import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable, modulesTable, userModulePermissionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ── Tipo del request autenticado ──────────────────────────────────────────────

export type AuthenticatedRequest = Request & {
  dbUser: {
    id:        number;
    clerkId:   string | null;
    email:     string;
    name:      string | null;
    role:      string;
    isActive:  boolean;
    isBlocked: boolean;
  };
};

// ── Constantes ────────────────────────────────────────────────────────────────

// Los roles con privilegios administrativos — pueden acceder a datos de otros usuarios
const ADMIN_ROLES = new Set(["super_admin", "admin"]);

// Throttle del update de lastActivityAt — una write por usuario cada N minutos
const ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const activityUpdateCache = new Map<number, number>(); // userId → lastUpdatedMs

// ── resolveUser ───────────────────────────────────────────────────────────────
// Resolución desde sesión — única fuente de verdad.
// Carga el usuario completo desde la DB para tener rol actualizado.
async function resolveUser(req: Request): Promise<typeof usersTable.$inferSelect | null> {
  const sessionUserId = req.session?.userId;
  if (!sessionUserId) return null;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, sessionUserId));

  return user ?? null;
}

// ── updateActivityThrottled ───────────────────────────────────────────────────
// Actualiza lastActivityAt en DB máximo una vez cada ACTIVITY_UPDATE_INTERVAL_MS
// por usuario. El original actualizaba en CADA request — una write a DB por
// endpoint por usuario, incluyendo polling frecuente. Con 5 usuarios × 60 req/min
// = 300 writes/min innecesarias a Supabase.
function updateActivityThrottled(userId: number): void {
  const now  = Date.now();
  const last = activityUpdateCache.get(userId) ?? 0;
  if (now - last < ACTIVITY_UPDATE_INTERVAL_MS) return;

  activityUpdateCache.set(userId, now);
  // Fire-and-forget — no bloquea el request
  db.update(usersTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(usersTable.id, userId))
    .catch((err: unknown) => {
      logger.warn({ err, userId }, "requireAuth: lastActivityAt update failed");
    });
}

// ── requireAuth ───────────────────────────────────────────────────────────────
// Verifica autenticación + activo + no bloqueado.
// Setea req.dbUser para que los handlers downstream no necesiten re-consultar la DB.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
    updateActivityThrottled(user.id);
    next();
  } catch (err) {
    logger.error({ err }, "requireAuth error");
    res.status(500).json({ error: "Error de autenticación" });
  }
}

// ── requireRole ───────────────────────────────────────────────────────────────
// Si dbUser ya está seteado (requireAuth corrió antes), lo usa directamente.
// Si no, resuelve desde la sesión — evita doble query cuando se usa en cadena.
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Usar dbUser si ya fue resuelto por requireAuth upstream
      let user = (req as AuthenticatedRequest).dbUser as typeof usersTable.$inferSelect | undefined;
      if (!user) {
        const resolved = await resolveUser(req);
        if (!resolved) {
          res.status(401).json({ error: "No autenticado" });
          return;
        }
        user = resolved;
      }

      if (!user.isActive || user.isBlocked) {
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

export const requireAdmin      = requireRole("super_admin", "admin");
export const requireSuperAdmin = requireRole("super_admin");

// ── requireModule ─────────────────────────────────────────────────────────────
// Guard de acceso a módulo. Orden de verificación:
//   1. Usuario autenticado, activo, no bloqueado
//   2. super_admin → siempre pasa (sin consultar la tabla de módulos)
//   3. Módulo debe existir y estar activo globalmente (fail-closed)
//   4. Override a nivel usuario (user_module_permissions): anula el rol
//   5. Fallback a rol permitido en modules.allowed_roles
export function requireModule(key: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await resolveUser(req);
      if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
      if (!user.isActive) { res.status(403).json({ error: "Cuenta desactivada. Contactá al administrador." }); return; }
      if (user.isBlocked) { res.status(403).json({ error: "Cuenta bloqueada. Contactá al administrador." }); return; }

      (req as AuthenticatedRequest).dbUser = user;

      // super_admin bypasses all module restrictions
      if (user.role === "super_admin") { next(); return; }

      const [mod] = await db
        .select()
        .from(modulesTable)
        .where(eq(modulesTable.key, key));

      // Módulo no encontrado → denegar (fail-closed)
      if (!mod) {
        logger.warn({ moduleKey: key, userId: user.id }, "requireModule: módulo no encontrado en DB");
        res.status(403).json({ error: "Módulo no encontrado." });
        return;
      }

      if (!mod.isActive) {
        res.status(403).json({ error: "Este módulo no está disponible. Contactá al administrador." });
        return;
      }

      // Override por usuario (grant/revoke explícito)
      const [userPerm] = await db
        .select()
        .from(userModulePermissionsTable)
        .where(
          and(
            eq(userModulePermissionsTable.userId, user.id),
            eq(userModulePermissionsTable.moduleKey, key),
          ),
        );

      if (userPerm !== undefined) {
        if (!userPerm.isEnabled) {
          res.status(403).json({ error: "No tenés permiso para acceder a este módulo." });
          return;
        }
        // isEnabled = true → acceso garantizado independientemente del rol
        next();
        return;
      }

      // Fallback: verificar rol en allowed_roles del módulo
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

// ── getCurrentUserId ──────────────────────────────────────────────────────────
// Devuelve el userId como string para columnas text de ownership.
// Siempre se llama después de requireAuth — dbUser siempre está seteado.
export function getCurrentUserId(req: Request): string {
  return String((req as AuthenticatedRequest).dbUser.id);
}

// ── getCurrentUserIdNum ───────────────────────────────────────────────────────
// Devuelve el userId como number para columnas integer FK.
export function getCurrentUserIdNum(req: Request): number {
  return (req as AuthenticatedRequest).dbUser.id;
}

// ── assertOwnership ───────────────────────────────────────────────────────────
// Verifica que el registro pertenece al usuario autenticado.
// Admins (super_admin + admin) pueden acceder a todos los registros —
// necesario para el panel de administración.
// Devuelve 404 cuando falla ownership (no 403) para no revelar
// que el recurso existe pero pertenece a otro usuario.
export function assertOwnership(
  req: Request,
  res: Response,
  recordUserId: string | null | undefined,
): boolean {
  const dbUser = (req as AuthenticatedRequest).dbUser;

  // Admins tienen acceso total para gestión
  if (ADMIN_ROLES.has(dbUser.role)) return true;

  if (recordUserId !== String(dbUser.id)) {
    res.status(404).json({ error: "No encontrado" });
    return false;
  }

  return true;
}
