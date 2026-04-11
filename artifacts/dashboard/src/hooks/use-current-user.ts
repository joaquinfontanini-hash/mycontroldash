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
    queryFn: () => fetch(`${BASE}/api/users/me`).then(r => r.ok ? r.json() : null),
    staleTime: 30_000,
    retry: false,
  });
}

export function isSuperAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdmin(user: CurrentUser | null | undefined): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}
