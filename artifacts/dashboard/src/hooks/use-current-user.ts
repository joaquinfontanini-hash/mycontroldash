import { useQuery } from "@tanstack/react-query";
import { LOCAL_AUTH_MODE, LOCAL_NAME, LOCAL_EMAIL, getLocalSession } from "@/lib/local-auth";

import { BASE } from "@/lib/base-url";

// ── Custom error class so callers can inspect the HTTP status ─────────────────
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

const STATIC_DATE = new Date(0).toISOString();

export function useCurrentUser() {
  const session = LOCAL_AUTH_MODE ? getLocalSession() : null;

  const localUser: CurrentUser | undefined = LOCAL_AUTH_MODE
    ? session
      ? {
          id: 1,
          clerkId: null,
          email: session.email ?? LOCAL_EMAIL,
          name: session.name ?? LOCAL_NAME,
          role: "super_admin",
          isActive: true,
          isBlocked: false,
          blockedAt: null,
          blockedReason: null,
          mustChangePassword: false,
          lastActivityAt: null,
          createdAt: STATIC_DATE,
          updatedAt: STATIC_DATE,
        }
      : undefined
    : undefined;

  return useQuery<CurrentUser, HttpError>({
    queryKey: ["current-user"],
    queryFn: async () => {
      if (LOCAL_AUTH_MODE) return localUser!;
      const r = await fetch(`${BASE}/api/users/me`, { credentials: "include" });
      if (!r.ok) {
        // Capture the body message if available for better debugging
        const body = await r.json().catch(() => ({}));
        throw new HttpError(r.status, body?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    enabled: !LOCAL_AUTH_MODE || !!session,
    initialData: LOCAL_AUTH_MODE ? localUser : undefined,
    // Keep stale data while refetching — avoids flicker and transient redirects.
    // Session lasts 30 days so 5 minutes is a safe revalidation window.
    staleTime: LOCAL_AUTH_MODE ? Infinity : 5 * 60 * 1000,
    // Only retry on non-auth errors; a 401 is definitive, no point retrying.
    retry: (failureCount, error) => {
      if (LOCAL_AUTH_MODE) return false;
      if (isUnauthenticatedError(error)) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
  });
}

export function isSuperAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}
