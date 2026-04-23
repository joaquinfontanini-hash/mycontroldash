/**
 * use-alerts.ts — Hook de alertas del sistema
 *
 * MEJORAS vs. original:
 *
 * 1. PROBLEMA PRINCIPAL CORREGIDO — useMemo recalculaba en cada render:
 *    El original incluía getBool(), getInt(), get() de useUserSettings en las
 *    dependencias del useMemo. Si ese hook retorna funciones inline (nueva
 *    referencia por render), el memo nunca era efectivo — cada render del
 *    componente padre recalculaba todas las alertas aunque los datos no cambiaran.
 *    SOLUCIÓN: extraer los valores primitivos ANTES del useMemo y usarlos
 *    como deps estables. El memo ahora solo recalcula cuando los datos cambian.
 *
 * 2. credentials:"include" en fetch de dueDates y tasks (el original no lo tenía)
 *
 * 3. sensitivityFilter como useMemo separado para evitar recreación
 *
 * 4. daysDiff memoizado una vez con la fecha de hoy (no recalcula new Date() por item)
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import { useUserSettings } from "@/hooks/use-user-settings";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type Sensitivity = "high" | "medium" | "low";

// ── Helpers puros (fuera del hook — no se recrean) ────────────────────────────

function calcDaysDiff(dateStr: string, todayMs: number): number {
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d.getTime() - todayMs) / 86_400_000);
}

// Devuelve función PURA que no cambia entre renders — memoizar con useMemo
function buildSensitivityFilter(sensitivity: Sensitivity): (level: Alert["level"]) => boolean {
  switch (sensitivity) {
    case "high":   return () => true;
    case "medium": return (l) => l === "critical" || l === "high";
    case "low":    return (l) => l === "critical";
    default:       return () => true;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAlerts() {
  const { isSignedIn } = useAuth();
  const settings = useUserSettings();

  // ── Extraer valores PRIMITIVOS de useUserSettings ANTES del useMemo ─────────
  // Si get/getBool/getInt crean nuevas referencias en cada render, incluirlos
  // directamente en las deps del useMemo haría que el memo nunca cache.
  // Extraemos los valores escalares — React solo re-ejecuta el memo cuando
  // el valor primitivo efectivamente cambia.
  const alertDueDateDays    = settings.getInt("alert_due_date_days", 7);
  const sensitivity         = (settings.get("alert_sensitivity") || "medium") as Sensitivity;
  const vencimientosEnabled = settings.getBool("alert_vencimientos_enabled");
  const tareasEnabled       = settings.getBool("alert_tareas_enabled");
  const financierosEnabled  = settings.getBool("alert_finanzas_enabled");

  // La función de filtro solo se recrea cuando cambia sensitivity (primitivo)
  const sensitivityFilter = useMemo(
    () => buildSensitivityFilter(sensitivity),
    [sensitivity]
  );

  // ── Queries con credentials:"include" ────────────────────────────────────────
  // El original usaba fetch sin credentials → 401 en Railway

  const { data: dueDates = [] } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: () =>
      fetch(`${BASE}/api/due-dates`, { credentials: "include" })
        .then(r => r.ok ? r.json() as Promise<DueDate[]> : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () =>
      fetch(`${BASE}/api/tasks`, { credentials: "include" })
        .then(r => r.ok ? r.json() as Promise<Task[]> : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const { data: finance } = useQuery<{ alerts: { type: string; level: string; message: string }[] }>({
    queryKey: ["finance-summary"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/summary`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null),
    staleTime: 120_000,
    enabled: !!isSignedIn && financierosEnabled,
  });

  // ── useMemo con deps PRIMITIVAS ───────────────────────────────────────────────
  // Ahora las deps son: arrays de datos + valores escalares de settings.
  // El memo SOLO recalcula cuando dueDates/tasks/finance cambian O cuando
  // el usuario modifica sus preferencias de alertas.
  // Antes recalculaba en cada render porque getBool/getInt eran nuevas funciones.

  const alerts = useMemo<Alert[]>(() => {
    // Fijamos "hoy" una sola vez para todo el cálculo del memo
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayMs = todayMidnight.getTime();

    const result: Alert[] = [];

    // ── Vencimientos ────────────────────────────────────────────────────────
    if (vencimientosEnabled) {
      for (const dd of dueDates) {
        if (dd.status !== "pending") continue;
        const diff = calcDaysDiff(dd.dueDate, todayMs);
        if (diff > alertDueDateDays) continue;

        const level: Alert["level"] =
          diff <= 0 ? "critical" : diff <= 2 ? "high" : "medium";
        if (!sensitivityFilter(level)) continue;

        result.push({
          id:     `dd-${dd.id}`,
          type:   "vencimiento",
          level,
          title:  dd.title,
          detail: diff < 0
            ? `Vencido hace ${Math.abs(diff)} día${Math.abs(diff) !== 1 ? "s" : ""}`
            : diff === 0
            ? "Vence hoy"
            : `Vence en ${diff} día${diff !== 1 ? "s" : ""}`,
          href:     "/dashboard/due-dates",
          daysUntil: diff,
        });
      }
    }

    // ── Tareas ───────────────────────────────────────────────────────────────
    if (tareasEnabled) {
      for (const t of tasks) {
        if (t.status === "done" || t.status === "cancelled") continue;
        if (t.priority !== "critical" && t.priority !== "high") continue;

        const hasDue = !!t.dueDate;
        const diff   = hasDue ? calcDaysDiff(t.dueDate!, todayMs) : null;
        if (hasDue && diff !== null && diff > 3) continue;

        const level: Alert["level"] = t.priority === "critical" ? "critical" : "high";
        if (!sensitivityFilter(level)) continue;

        result.push({
          id:    `task-${t.id}`,
          type:  "tarea",
          level,
          title: t.title,
          detail: hasDue && diff !== null
            ? diff <= 0 ? "Vencida" : `Vence en ${diff} día${diff !== 1 ? "s" : ""}`
            : "Sin fecha — prioridad alta",
          href: "/dashboard/tasks",
        });
      }
    }

    // ── Financiero ───────────────────────────────────────────────────────────
    if (financierosEnabled && finance?.alerts) {
      for (const fa of finance.alerts) {
        const level = (
          fa.level === "critical" ? "critical" :
          fa.level === "high"     ? "high"     : "medium"
        ) as Alert["level"];
        if (!sensitivityFilter(level)) continue;

        result.push({
          id:     `finance-${fa.type}`,
          type:   "financiero",
          level,
          title:  fa.message,
          detail: "Ver módulo de finanzas",
          href:   "/dashboard/finance",
        });
      }
    }

    // Ordenar: critical → high → medium
    result.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 } as const;
      return order[a.level] - order[b.level];
    });

    return result;
  }, [
    // Deps primitivas — NO incluir funciones como getBool/getInt/get
    dueDates,
    tasks,
    finance,
    alertDueDateDays,
    sensitivity,
    vencimientosEnabled,
    tareasEnabled,
    financierosEnabled,
    sensitivityFilter,
  ]);

  const criticalCount = useMemo(
    () => alerts.filter(a => a.level === "critical").length,
    [alerts]
  );

  const highCount = useMemo(
    () => alerts.filter(a => a.level === "high").length,
    [alerts]
  );

  return {
    alerts,
    criticalCount,
    highCount,
    totalCount: alerts.length,
    isLoading: false,
  };
}
