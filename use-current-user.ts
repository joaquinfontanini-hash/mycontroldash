/**
 * use-current-user.ts — Hook para el usuario autenticado actual
 *
 * MEJORAS vs. original (preserva toda la lógica, mejora robustez):
 *  1. retry handler explícito: no reintenta en 401/403 (el original lo tenía
 *     parcialmente, se completa y tipifica correctamente)
 *  2. gcTime explícito: los datos del usuario se conservan 10min fuera de uso
 *  3. refetchOnWindowFocus:false para evitar re-fetch al volver a la pestaña
 *     (el usuario no cambia mientras la app está abierta)
 *  4. STATIC_DATE centralizado en una constante fuera del módulo
 */

import { useQuery } from "@tanstack/react-query";
import { LOCAL_AUTH_MODE, LOCAL_NAME, LOCAL_EMAIL, getLocalSession } from "@/lib/local-auth";
import { BASE } from "@/lib/base-url";

// ── HttpError ─────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  status: number;
  constructor(status: number, body?: string) {
    super(body ?? `HTTP ${status}`);
    this.status = status;
  }
}

export function isUnauthenticatedError(err: unknown): boolean {
  return err instanceof HttpError && err.status === 401;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurrentUser {
  id: number;
  clerkId: string | null;
  email: string;
  name: string | null;
  role: "super_admin" | "admin" | "editor" | "viewer" | string;
  isActive: boolean;
  isBlocked: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  mustChangePassword: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Fecha fija fuera del módulo — no se recrea en cada render/import
const STATIC_DATE = new Date(0).toISOString();

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useCurrentUser() {
  const session   = LOCAL_AUTH_MODE ? getLocalSession() : null;

  const localUser: CurrentUser | undefined = LOCAL_AUTH_MODE && session
    ? {
        id:                 1,
        clerkId:            null,
        email:              session.email ?? LOCAL_EMAIL,
        name:               session.name  ?? LOCAL_NAME,
        role:               "super_admin",
        isActive:           true,
        isBlocked:          false,
        blockedAt:          null,
        blockedReason:      null,
        mustChangePassword: false,
        lastActivityAt:     null,
        createdAt:          STATIC_DATE,
        updatedAt:          STATIC_DATE,
      }
    : undefined;

  return useQuery<CurrentUser, HttpError>({
    queryKey: ["current-user"],

    queryFn: async () => {
      if (LOCAL_AUTH_MODE) return localUser!;
      const r = await fetch(`${BASE}/api/users/me`, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new HttpError(r.status, body?.error ?? `HTTP ${r.status}`);
      }
      return r.json() as Promise<CurrentUser>;
    },

    enabled: !LOCAL_AUTH_MODE || !!session,
    initialData: LOCAL_AUTH_MODE ? localUser : undefined,

    // En modo local la sesión es estática — nunca expira
    // En modo Clerk/JWT, 5 min es suficiente (el rol no cambia frecuentemente)
    staleTime: LOCAL_AUTH_MODE ? Infinity : 5 * 60 * 1000,

    // Conservar datos en cache 10 min después de que el componente se desmonte
    // Evita refetch al navegar entre páginas
    gcTime: 10 * 60 * 1000,

    // No refetch al volver a la pestaña — el usuario no cambia durante la sesión
    refetchOnWindowFocus: false,

    // Solo reintentar en errores que NO sean auth (401/403)
    // Un 401 significa que la sesión expiró — no tiene sentido reintentar
    retry: (failureCount, err) => {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
