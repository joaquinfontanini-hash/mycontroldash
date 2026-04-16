/**
 * Smart Summary Engine — Rule-based, no LLM.
 * Receives data from multiple resolved data sources and produces
 * natural-language insights in Spanish.
 */

export interface SmartSummaryContext {
  dueDates?: {
    verde: number;
    amarillo: number;
    rojo: number;
    total: number;
  };
  upcomingDueDates?: Array<{ dueDate: string; description?: string; clientName?: string }>;
  financeTransactions?: Array<{ amount: string | number; type: string; date: string; category?: string }>;
  financeSummary?: { ingresos: number; gastos: number; balance: number };
  tasks?: Array<{ status: string; title: string; updatedAt?: string }>;
  newsPriority?: Array<{ title: string; priorityScore: number }>;
  systemNotifications?: Array<{ title?: string; message?: string }>;
}

export interface SmartSummaryInsight {
  level: "info" | "warning" | "alert" | "success";
  text: string;
  icon: string;
}

export interface SmartSummaryResult {
  insights: SmartSummaryInsight[];
  generatedAt: string;
  hasData: boolean;
}

const now = () => new Date();

function daysFromToday(dateStr: string): number {
  const d = new Date(dateStr);
  const today = now();
  return Math.ceil((d.getTime() - today.setHours(0, 0, 0, 0)) / 86400000);
}

export function buildSmartSummary(ctx: SmartSummaryContext): SmartSummaryResult {
  const insights: SmartSummaryInsight[] = [];

  // ── Vencimientos fiscales ──────────────────────────────────────────────────

  if (ctx.dueDates) {
    const { rojo, amarillo, verde, total } = ctx.dueDates;
    if (rojo > 0) {
      insights.push({
        level: "alert",
        icon: "🔴",
        text: `${rojo} vencimiento${rojo > 1 ? "s" : ""} vencido${rojo > 1 ? "s" : ""} sin resolver.`,
      });
    }
    if (amarillo > 0) {
      insights.push({
        level: "warning",
        icon: "🟡",
        text: `${amarillo} vencimiento${amarillo > 1 ? "s" : ""} por vencer próximamente.`,
      });
    }
    if (rojo === 0 && amarillo === 0 && total > 0) {
      insights.push({
        level: "success",
        icon: "✅",
        text: `Todos los vencimientos al día (${verde} en verde).`,
      });
    }
  }

  if (ctx.upcomingDueDates?.length) {
    const critical = ctx.upcomingDueDates.filter(d => daysFromToday(d.dueDate) <= 2);
    if (critical.length > 0) {
      insights.push({
        level: "alert",
        icon: "⚠️",
        text: `${critical.length} vencimiento${critical.length > 1 ? "s" : ""} crítico${critical.length > 1 ? "s" : ""} en las próximas 48 horas.`,
      });
    }
    const thisWeek = ctx.upcomingDueDates.filter(d => {
      const days = daysFromToday(d.dueDate);
      return days > 2 && days <= 7;
    });
    if (thisWeek.length > 0) {
      insights.push({
        level: "warning",
        icon: "📅",
        text: `${thisWeek.length} vencimiento${thisWeek.length > 1 ? "s" : ""} esta semana.`,
      });
    }
  }

  // ── Finanzas ───────────────────────────────────────────────────────────────

  if (ctx.financeSummary) {
    const { ingresos, gastos, balance } = ctx.financeSummary;
    if (ingresos > 0 || gastos > 0) {
      if (balance < 0) {
        insights.push({
          level: "warning",
          icon: "💸",
          text: `Mes actual con balance negativo: gastos superan ingresos en $${Math.abs(balance).toLocaleString("es-AR")}.`,
        });
      } else if (balance > 0) {
        insights.push({
          level: "info",
          icon: "💰",
          text: `Balance positivo este mes: $${balance.toLocaleString("es-AR")} de ahorro.`,
        });
      }
      if (gastos > 0 && ingresos > 0) {
        const ratio = Math.round((gastos / ingresos) * 100);
        if (ratio > 90) {
          insights.push({
            level: "warning",
            icon: "📊",
            text: `Los gastos representan el ${ratio}% de los ingresos este mes.`,
          });
        }
      }
    }
  }

  if (ctx.financeTransactions?.length) {
    // Detect stagnant months (no transactions in last 7 days)
    const recent = ctx.financeTransactions.filter(t => {
      const days = now().getTime() - new Date(t.date).getTime();
      return days <= 7 * 86400000;
    });
    if (recent.length === 0 && ctx.financeTransactions.length > 0) {
      insights.push({
        level: "info",
        icon: "🔍",
        text: "No se registraron movimientos financieros en los últimos 7 días.",
      });
    }
  }

  // ── Tareas ─────────────────────────────────────────────────────────────────

  if (ctx.tasks?.length) {
    const open = ctx.tasks.filter(t => t.status !== "done");
    const stagnant = open.filter(t => {
      if (!t.updatedAt) return false;
      const days = (now().getTime() - new Date(t.updatedAt).getTime()) / 86400000;
      return days > 5;
    });
    if (stagnant.length > 0) {
      insights.push({
        level: "warning",
        icon: "🕐",
        text: `${stagnant.length} tarea${stagnant.length > 1 ? "s" : ""} sin movimiento hace más de 5 días.`,
      });
    }
    if (open.length > 10) {
      insights.push({
        level: "info",
        icon: "📋",
        text: `Tenés ${open.length} tareas abiertas. Revisá si podés cerrar algunas.`,
      });
    }
  }

  // ── Noticias ───────────────────────────────────────────────────────────────

  if (ctx.newsPriority?.length) {
    const highImpact = ctx.newsPriority.filter(n => n.priorityScore >= 80);
    if (highImpact.length > 0) {
      insights.push({
        level: "info",
        icon: "📰",
        text: `${highImpact.length} noticia${highImpact.length > 1 ? "s" : ""} de impacto alto en la agenda económica.`,
      });
    }
  }

  // ── Notificaciones del sistema ─────────────────────────────────────────────

  if (ctx.systemNotifications?.length) {
    const count = ctx.systemNotifications.length;
    insights.push({
      level: "info",
      icon: "🔔",
      text: `${count} notificación${count > 1 ? "es" : ""} sin leer en el sistema.`,
    });
  }

  // ── Fallback ───────────────────────────────────────────────────────────────

  if (insights.length === 0) {
    insights.push({
      level: "info",
      icon: "📊",
      text: "No hay alertas activas. Todo parece estar en orden.",
    });
  }

  return {
    insights,
    generatedAt: now().toISOString(),
    hasData: insights.length > 0,
  };
}
