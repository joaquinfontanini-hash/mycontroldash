import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import { useUserSettings } from "@/hooks/use-user-settings";

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
  type: "vencimiento" | "tarea" | "fiscal" | "financiero";
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

type Sensitivity = "high" | "medium" | "low";

function getSensitivityFilter(sensitivity: Sensitivity): (level: Alert["level"]) => boolean {
  switch (sensitivity) {
    case "high":   return () => true;
    case "medium": return (l) => l === "critical" || l === "high";
    case "low":    return (l) => l === "critical";
    default:       return () => true;
  }
}

export function useAlerts() {
  const { isSignedIn } = useAuth();
  const { get, getBool, getInt } = useUserSettings();

  const alertDueDateDays = getInt("alert_due_date_days", 7);
  const sensitivity = (get("alert_sensitivity") || "medium") as Sensitivity;
  const vencimientosEnabled = getBool("alert_vencimientos_enabled");
  const tareasEnabled = getBool("alert_tareas_enabled");
  const financierosEnabled = getBool("alert_finanzas_enabled");
  const sensitivityFilter = getSensitivityFilter(sensitivity);

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

  const { data: finance } = useQuery<{ alerts: { type: string; level: string; message: string }[] }>({
    queryKey: ["finance-summary"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`).then(r => r.ok ? r.json() : null),
    staleTime: 120_000,
    enabled: !!isSignedIn && financierosEnabled,
  });

  const alerts = useMemo<Alert[]>(() => {
    const result: Alert[] = [];

    if (vencimientosEnabled) {
      for (const dd of dueDates) {
        if (dd.status !== "pending") continue;
        const diff = daysDiff(dd.dueDate);
        if (diff > alertDueDateDays) continue;
        const level: Alert["level"] =
          diff <= 0 ? "critical" : diff <= 2 ? "high" : "medium";
        if (!sensitivityFilter(level)) continue;
        result.push({
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
    }

    if (tareasEnabled) {
      for (const t of tasks) {
        if (t.status === "done" || t.status === "cancelled") continue;
        if (t.priority !== "critical" && t.priority !== "high") continue;
        const hasDue = !!t.dueDate;
        const diff = hasDue ? daysDiff(t.dueDate!) : null;
        if (hasDue && diff !== null && diff > 3) continue;
        const level: Alert["level"] = t.priority === "critical" ? "critical" : "high";
        if (!sensitivityFilter(level)) continue;
        result.push({
          id: `task-${t.id}`,
          type: "tarea",
          level,
          title: t.title,
          detail: hasDue && diff !== null
            ? diff <= 0 ? "Vencida" : `Vence en ${diff} día${diff !== 1 ? "s" : ""}`
            : "Sin fecha — prioridad alta",
          href: "/dashboard/tasks",
        });
      }
    }

    if (financierosEnabled && finance?.alerts) {
      for (const fa of finance.alerts) {
        const level = (fa.level === "critical" ? "critical" : fa.level === "high" ? "high" : "medium") as Alert["level"];
        if (!sensitivityFilter(level)) continue;
        result.push({
          id: `finance-${fa.type}`,
          type: "financiero",
          level,
          title: fa.message,
          detail: "Ver módulo de finanzas",
          href: "/dashboard/finance",
        });
      }
    }

    result.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 };
      return order[a.level] - order[b.level];
    });

    return result;
  }, [dueDates, tasks, finance, alertDueDateDays, sensitivity, vencimientosEnabled, tareasEnabled, financierosEnabled]);

  const criticalCount = alerts.filter(a => a.level === "critical").length;
  const totalCount = alerts.length;

  return { alerts, criticalCount, totalCount };
}
