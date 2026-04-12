import { useQuery } from "@tanstack/react-query";
import { LOCAL_AUTH_MODE, LOCAL_NAME, LOCAL_EMAIL, getLocalSession } from "@/lib/local-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface CurrentUser {
  id: number;
  clerkId: string;
  email: string;
  name: string | null;
  role: "super_admin" | "admin" | "editor" | "viewer" | string;
  isActive: boolean;
  isBlocked: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
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
          clerkId: "local",
          email: session.email ?? LOCAL_EMAIL,
          name: session.name ?? LOCAL_NAME,
          role: "super_admin",
          isActive: true,
          isBlocked: false,
          blockedAt: null,
          blockedReason: null,
          lastActivityAt: null,
          createdAt: STATIC_DATE,
          updatedAt: STATIC_DATE,
        }
      : undefined
    : undefined;

  return useQuery<CurrentUser>({
    queryKey: ["current-user"],
    queryFn: async () => {
      if (LOCAL_AUTH_MODE) return localUser!;
      const r = await fetch(`${BASE}/api/users/me`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !LOCAL_AUTH_MODE || !!session,
    initialData: LOCAL_AUTH_MODE ? localUser : undefined,
    staleTime: LOCAL_AUTH_MODE ? Infinity : 30_000,
    retry: LOCAL_AUTH_MODE ? false : 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

export function isSuperAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}
