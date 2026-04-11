import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useMemo } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface DueDate {
  id: number; title: string; dueDate: string;
  priority: string; status: string; category: string;
}

export interface Task {
  id: number; title: string; priority: string;
  status: string; dueDate?: string | null;
}

export interface FinanceSummary {
  patrimonio: number; liquidez: number; inversiones: number; deudas: number;
  alerts: { type: string; level: string; message: string }[];
  config: Record<string, string>;
}

export interface DailyGoal {
  id: number; title: string; date: string;
  priority: string; isDone: boolean; orderIndex: number;
}

export interface StrategyGoal {
  id: number; title: string; category: string;
  priority: string; status: string; progress: number;
  startDate: string; endDate: string; notes?: string | null;
}

export type DecisionLevel = "critical" | "high" | "medium" | "info";

export interface DecisionItem {
  id: string;
  type: "problem" | "risk" | "opportunity" | "action";
  level: DecisionLevel;
  title: string;
  detail: string;
  href?: string;
  rule: string;
}

export interface Scores {
  productividad: number;
  finanzas: number;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysDiff(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}

function runRules(
  dueDates: DueDate[],
  tasks: Task[],
  finance: FinanceSummary | undefined,
  dailyGoals: DailyGoal[],
  strategyGoals: StrategyGoal[],
): DecisionItem[] {
  const items: DecisionItem[] = [];
  const today = todayStr();

  const overdueDDs = dueDates.filter(dd => dd.status === "pending" && daysDiff(dd.dueDate) < 0);
  const todayDDs = dueDates.filter(dd => dd.status === "pending" && daysDiff(dd.dueDate) === 0);
  const urgentDDs = dueDates.filter(dd => dd.status === "pending" && daysDiff(dd.dueDate) > 0 && daysDiff(dd.dueDate) <= 3);

  for (const dd of overdueDDs.slice(0, 3)) {
    items.push({
      id: `dd-overdue-${dd.id}`,
      type: "problem",
      level: "critical",
      title: `Vencimiento atrasado: ${dd.title}`,
      detail: `Venció hace ${Math.abs(daysDiff(dd.dueDate))} días — marcar como completado o gestionar urgente`,
      href: "/dashboard/due-dates",
      rule: "vencimiento_atrasado",
    });
  }

  for (const dd of todayDDs.slice(0, 2)) {
    items.push({
      id: `dd-today-${dd.id}`,
      type: "action",
      level: "critical",
      title: `Vence hoy: ${dd.title}`,
      detail: "Procesarlo antes de fin del día",
      href: "/dashboard/due-dates",
      rule: "vencimiento_hoy",
    });
  }

  for (const dd of urgentDDs.slice(0, 2)) {
    items.push({
      id: `dd-urgent-${dd.id}`,
      type: "action",
      level: "high",
      title: `Próximo vencimiento: ${dd.title}`,
      detail: `En ${daysDiff(dd.dueDate)} día${daysDiff(dd.dueDate) !== 1 ? "s" : ""}`,
      href: "/dashboard/due-dates",
      rule: "vencimiento_proximo",
    });
  }

  const criticalTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled" && t.priority === "critical");
  const highTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled" && t.priority === "high");

  for (const t of criticalTasks.slice(0, 2)) {
    items.push({
      id: `task-critical-${t.id}`,
      type: "problem",
      level: "critical",
      title: `Tarea crítica pendiente: ${t.title}`,
      detail: "Requiere atención inmediata",
      href: "/dashboard/tasks",
      rule: "tarea_critica",
    });
  }

  if (highTasks.length > 3) {
    items.push({
      id: "tasks-overload",
      type: "risk",
      level: "high",
      title: `${highTasks.length} tareas de prioridad alta sin terminar`,
      detail: "Riesgo de saturación — considerá delegar o reprogramar",
      href: "/dashboard/tasks",
      rule: "sobrecarga_tareas",
    });
  }

  if (finance) {
    const liquidezMin = parseFloat(finance.config?.liquidez_minima ?? "100000");
    const deudaUmbral = parseFloat(finance.config?.alerta_deuda_umbral ?? "1000000");

    if (finance.liquidez < liquidezMin) {
      items.push({
        id: "finance-liquidez",
        type: "problem",
        level: "critical",
        title: "Liquidez por debajo del mínimo",
        detail: `Liquidez actual: $${finance.liquidez.toLocaleString("es-AR")} — mínimo configurado: $${liquidezMin.toLocaleString("es-AR")}`,
        href: "/dashboard/finance",
        rule: "liquidez_baja",
      });
    }

    if (finance.deudas > deudaUmbral) {
      items.push({
        id: "finance-deuda",
        type: "risk",
        level: "high",
        title: "Nivel de deuda elevado",
        detail: `Deuda total: $${finance.deudas.toLocaleString("es-AR")} supera el umbral configurado`,
        href: "/dashboard/finance",
        rule: "deuda_elevada",
      });
    }

    if (finance.patrimonio > 0 && finance.inversiones === 0) {
      items.push({
        id: "finance-inversiones",
        type: "opportunity",
        level: "medium",
        title: "Sin posición de inversión registrada",
        detail: "Tenés liquidez disponible — evaluá opciones de inversión",
        href: "/dashboard/finance",
        rule: "oportunidad_inversion",
      });
    }
  }

  const todayGoals = dailyGoals.filter(g => g.date === today);
  if (todayGoals.length === 0) {
    items.push({
      id: "daily-goals-empty",
      type: "action",
      level: "medium",
      title: "Sin objetivos definidos para hoy",
      detail: "Definí tus 3 prioridades del día para mantener el foco",
      href: "/dashboard/goals",
      rule: "objetivos_vacios",
    });
  }

  const delayedStrategy = strategyGoals.filter(sg => {
    if (sg.status !== "active") return false;
    const diff = daysDiff(sg.endDate);
    return diff < 0 && sg.progress < 100;
  });

  for (const sg of delayedStrategy.slice(0, 2)) {
    items.push({
      id: `strategy-delayed-${sg.id}`,
      type: "risk",
      level: "high",
      title: `Objetivo estratégico atrasado: ${sg.title}`,
      detail: `Progreso: ${sg.progress}% — venció hace ${Math.abs(daysDiff(sg.endDate))} días`,
      href: "/dashboard/strategy",
      rule: "objetivo_estrategico_atrasado",
    });
  }

  const noTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled").length === 0;
  const noAlerts = overdueDDs.length === 0 && criticalTasks.length === 0;
  if (noTasks && noAlerts) {
    items.push({
      id: "opportunity-focus",
      type: "opportunity",
      level: "info",
      title: "Sin urgencias pendientes",
      detail: "Buen momento para trabajar en objetivos estratégicos o revisar finanzas",
      href: "/dashboard/strategy",
      rule: "sin_urgencias",
    });
  }

  const levelOrder: Record<DecisionLevel, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  const typeOrder: Record<string, number> = { problem: 0, action: 1, risk: 2, opportunity: 3 };
  items.sort((a, b) => {
    const lo = levelOrder[a.level] - levelOrder[b.level];
    if (lo !== 0) return lo;
    return typeOrder[a.type] - typeOrder[b.type];
  });

  return items;
}

function computeScores(
  dueDates: DueDate[],
  tasks: Task[],
  finance: FinanceSummary | undefined,
  dailyGoals: DailyGoal[],
  strategyGoals: StrategyGoal[],
): Scores {
  let productividad = 60;
  const today = todayStr();
  const todayGoals = dailyGoals.filter(g => g.date === today);
  if (todayGoals.length > 0) {
    const doneRatio = todayGoals.filter(g => g.isDone).length / todayGoals.length;
    productividad += Math.round(doneRatio * 25);
  }
  const activeTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const criticalPending = activeTasks.filter(t => t.priority === "critical").length;
  productividad -= criticalPending * 8;
  const activeStrategy = strategyGoals.filter(sg => sg.status === "active");
  if (activeStrategy.length > 0) {
    const avgProgress = activeStrategy.reduce((s, sg) => s + sg.progress, 0) / activeStrategy.length;
    productividad += Math.round(avgProgress / 10);
  }
  productividad = Math.max(0, Math.min(100, productividad));

  let finanzas = 50;
  if (finance) {
    if (finance.patrimonio > 0) finanzas += 20;
    const liquidezMin = parseFloat(finance.config?.liquidez_minima ?? "100000");
    if (finance.liquidez >= liquidezMin) finanzas += 20;
    if (finance.inversiones > 0) finanzas += 15;
    if (finance.deudas === 0) finanzas += 15;
    const critAlerts = finance.alerts.filter(a => a.level === "critical").length;
    finanzas -= critAlerts * 12;
    finanzas = Math.max(0, Math.min(100, finanzas));
  }

  const overdueDDs = dueDates.filter(dd => dd.status === "pending" && daysDiff(dd.dueDate) < 0).length;
  productividad -= overdueDDs * 5;
  productividad = Math.max(0, Math.min(100, productividad));

  return { productividad, finanzas };
}

export function useDecisionEngine() {
  const { isSignedIn } = useAuth();

  const { data: dueDates = [] } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: () => fetch(`${BASE}/api/due-dates`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000, enabled: !!isSignedIn,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch(`${BASE}/api/tasks`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000, enabled: !!isSignedIn,
  });

  const { data: finance } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`).then(r => r.ok ? r.json() : null),
    staleTime: 60_000, enabled: !!isSignedIn,
  });

  const { data: dailyGoals = [] } = useQuery<DailyGoal[]>({
    queryKey: ["daily-goals", todayStr()],
    queryFn: () => fetch(`${BASE}/api/daily-goals`).then(r => r.ok ? r.json() : []),
    staleTime: 30_000, enabled: !!isSignedIn,
  });

  const { data: strategyGoals = [] } = useQuery<StrategyGoal[]>({
    queryKey: ["strategy-goals"],
    queryFn: () => fetch(`${BASE}/api/strategy-goals`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000, enabled: !!isSignedIn,
  });

  const decisions = useMemo(
    () => runRules(dueDates, tasks, finance, dailyGoals, strategyGoals),
    [dueDates, tasks, finance, dailyGoals, strategyGoals],
  );

  const scores = useMemo(
    () => computeScores(dueDates, tasks, finance, dailyGoals, strategyGoals),
    [dueDates, tasks, finance, dailyGoals, strategyGoals],
  );

  return { decisions, scores, dueDates, tasks, finance, dailyGoals, strategyGoals };
}
