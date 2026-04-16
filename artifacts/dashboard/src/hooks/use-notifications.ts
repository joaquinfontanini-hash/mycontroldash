import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/base-url";

export type NotificationType = "due_date" | "news" | "finance" | "system" | "task";
export type NotificationSeverity = "info" | "warning" | "critical";

export interface InAppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  linkUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function useNotifications() {
  return useQuery<{ ok: boolean; data: InAppNotification[] }>({
    queryKey: ["in-app-notifications"],
    queryFn: () => apiFetch(`${BASE}/api/notifications`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useUnreadCount() {
  return useQuery<{ ok: boolean; count: number }>({
    queryKey: ["notifications-unread-count"],
    queryFn: () => apiFetch(`${BASE}/api/notifications/unread-count`),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${BASE}/api/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["in-app-notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`${BASE}/api/notifications/read-all`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["in-app-notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${BASE}/api/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["in-app-notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });
}
