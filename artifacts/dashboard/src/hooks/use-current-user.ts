import { useQuery } from "@tanstack/react-query";

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

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ["current-user"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/users/me`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

export function isSuperAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}
