import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface DueDate {
  id: number;
  title: string;
  category: string;
  dueDate: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "done" | "cancelled";
}

interface Task {
  id: number;
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  status: string;
  dueDate?: string | null;
}

export interface Alert {
  id: string;
  type: "vencimiento" | "tarea" | "fiscal";
  level: "critical" | "high" | "medium";
  title: string;
  detail: string;
  href: string;
  daysUntil?: number;
}

function daysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}

export function useAlerts() {
  const { isSignedIn } = useAuth();

  const { data: dueDates = [] } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: () => fetch(`${BASE}/api/due-dates`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch(`${BASE}/api/tasks`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const alerts: Alert[] = [];

  for (const dd of dueDates) {
    if (dd.status !== "pending") continue;
    const diff = daysDiff(dd.dueDate);
    if (diff > 7) continue;
    const level: Alert["level"] =
      diff <= 0 ? "critical" : diff <= 2 ? "high" : "medium";
    alerts.push({
      id: `dd-${dd.id}`,
      type: "vencimiento",
      level,
      title: dd.title,
      detail: diff < 0
        ? `Vencido hace ${Math.abs(diff)} día${Math.abs(diff) !== 1 ? "s" : ""}`
        : diff === 0
        ? "Vence hoy"
        : `Vence en ${diff} día${diff !== 1 ? "s" : ""}`,
      href: "/dashboard/due-dates",
      daysUntil: diff,
    });
  }

  for (const t of tasks) {
    if (t.status === "done" || t.status === "cancelled") continue;
    if (t.priority !== "critical" && t.priority !== "high") continue;
    const hasDue = !!t.dueDate;
    const diff = hasDue ? daysDiff(t.dueDate!) : null;
    if (hasDue && diff !== null && diff > 3) continue;
    alerts.push({
      id: `task-${t.id}`,
      type: "tarea",
      level: t.priority === "critical" ? "critical" : "high",
      title: t.title,
      detail: hasDue && diff !== null
        ? diff <= 0 ? "Vencida" : `Vence en ${diff} día${diff !== 1 ? "s" : ""}`
        : "Sin fecha — prioridad alta",
      href: "/dashboard/tasks",
    });
  }

  alerts.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2 };
    return order[a.level] - order[b.level];
  });

  const criticalCount = alerts.filter(a => a.level === "critical").length;
  const totalCount = alerts.length;

  return { alerts, criticalCount, totalCount };
}
