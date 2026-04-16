/**
 * Studio Data Sources — Centralized catalog and resolver.
 * Widgets NEVER query tables directly; they declare a dataSourceKey and this
 * service resolves it.
 */
import {
  db,
  clientsTable,
  dueDatesTable,
  newsItemsTable,
  financeTransactionsTable,
  financeBudgetsTable,
  financeGoalsTable,
  tasksTable,
  inAppNotificationsTable,
  jobLogsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, desc, and, gte, lte, isNull, ne, sql, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getCurrencyRates } from "./currency.service.js";
import { getWeatherForecast } from "./weather.service.js";

export interface DataSourceMeta {
  key: string;
  label: string;
  description: string;
  category: string;
  isExpensive?: boolean;
  supportsSnapshot?: boolean;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const DATA_SOURCE_CATALOG: DataSourceMeta[] = [
  { key: "clients.summary",             label: "Clientes — Resumen",              description: "Totales y estadísticas de clientes",          category: "clientes",  supportsSnapshot: true },
  { key: "clients.list",                label: "Clientes — Listado",              description: "Lista de clientes activos",                   category: "clientes",  supportsSnapshot: true },
  { key: "dueDates.upcoming",           label: "Vencimientos — Próximos",         description: "Próximos vencimientos fiscales",              category: "fiscal" },
  { key: "dueDates.trafficLight",       label: "Vencimientos — Semáforo",         description: "Estado semáforo de vencimientos",            category: "fiscal" },
  { key: "news.feed",                   label: "Noticias — Feed",                 description: "Últimas noticias económicas",                 category: "noticias",  supportsSnapshot: true },
  { key: "news.priority",               label: "Noticias — Prioridad alta",       description: "Noticias de alto impacto",                   category: "noticias",  supportsSnapshot: true },
  { key: "finance.summary",             label: "Finanzas — Resumen",              description: "Resumen financiero personal",                category: "finanzas",  supportsSnapshot: true },
  { key: "finance.transactions.recent", label: "Finanzas — Movimientos recientes",description: "Últimos movimientos financieros",            category: "finanzas" },
  { key: "finance.budgets.status",      label: "Finanzas — Estado presupuestos",  description: "Estado actual de los presupuestos",          category: "finanzas",  supportsSnapshot: true },
  { key: "finance.goals.progress",      label: "Finanzas — Progreso objetivos",   description: "Progreso hacia objetivos financieros",       category: "finanzas",  supportsSnapshot: true },
  { key: "tasks.myOpen",                label: "Tareas — Mis abiertas",           description: "Tareas del usuario abiertas",                category: "tareas" },
  { key: "tasks.teamBoard",             label: "Tareas — Panel del equipo",       description: "Vista general de tareas del equipo",         category: "tareas",    supportsSnapshot: true },
  { key: "weather.forecast",            label: "Clima — Pronóstico",              description: "Pronóstico del tiempo local",                category: "clima",     supportsSnapshot: true },
  { key: "dollar.quotes",               label: "Dólar — Cotizaciones",            description: "Cotizaciones del dólar",                     category: "economía",  supportsSnapshot: true },
  { key: "system.notifications",        label: "Sistema — Notificaciones",        description: "Notificaciones del sistema",                 category: "sistema" },
  { key: "admin.jobs.health",           label: "Admin — Estado de jobs",          description: "Estado de los jobs de background (admin)",   category: "admin",     isExpensive: true },
  { key: "audit.activity",             label: "Auditoría — Actividad reciente",  description: "Actividad reciente del sistema",             category: "admin",     supportsSnapshot: false },
  { key: "static.text",                 label: "Texto estático",                  description: "Bloque de texto personalizado",              category: "general" },
  { key: "static.links",               label: "Links rápidos",                   description: "Lista de links configurables",               category: "general" },
];

// ── Resolver ──────────────────────────────────────────────────────────────────
// userId can be string or number — internally normalized to both forms as needed

export async function resolveDataSource(
  key: string,
  userId: string | number,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const userIdStr = String(userId);
  const userIdNum = typeof userId === "number" ? userId : parseInt(userIdStr, 10);

  try {
    switch (key) {

      case "clients.summary": {
        // clientsTable.userId is text
        const clients = await db.select({ id: clientsTable.id, isActive: clientsTable.isActive })
          .from(clientsTable).where(eq(clientsTable.userId, userIdStr));
        return {
          total: clients.length,
          active: clients.filter(c => c.isActive).length,
          inactive: clients.filter(c => !c.isActive).length,
        };
      }

      case "clients.list": {
        return await db.select().from(clientsTable)
          .where(and(eq(clientsTable.userId, userIdStr), eq(clientsTable.isActive, true)))
          .limit(50);
      }

      case "dueDates.upcoming": {
        const today = new Date();
        const in30 = new Date(today.getTime() + 30 * 86400000);
        // Support global dateFrom/dateTo filters
        const dateFrom = (params.dateFrom as string) ?? today.toISOString().slice(0, 10);
        const dateTo   = (params.dateTo   as string) ?? in30.toISOString().slice(0, 10);
        return await db.select().from(dueDatesTable)
          .where(and(
            eq(dueDatesTable.userId, userIdStr),
            gte(dueDatesTable.dueDate, dateFrom),
            lte(dueDatesTable.dueDate, dateTo),
            ne(dueDatesTable.status, "done"),
          ))
          .orderBy(dueDatesTable.dueDate)
          .limit(20);
      }

      case "dueDates.trafficLight": {
        const rows = await db.select({ trafficLight: dueDatesTable.trafficLight })
          .from(dueDatesTable)
          .where(eq(dueDatesTable.userId, userIdStr));
        return {
          verde: rows.filter(r => r.trafficLight === "verde").length,
          amarillo: rows.filter(r => r.trafficLight === "amarillo").length,
          rojo: rows.filter(r => r.trafficLight === "rojo").length,
          total: rows.length,
        };
      }

      case "news.feed": {
        return await db.select({
          id: newsItemsTable.id,
          title: newsItemsTable.title,
          source: newsItemsTable.source,
          publishedAt: newsItemsTable.publishedAt,
          priorityScore: newsItemsTable.priorityScore,
          category: newsItemsTable.category,
        }).from(newsItemsTable)
          .orderBy(desc(newsItemsTable.publishedAt))
          .limit((params.limit as number) ?? 10);
      }

      case "news.priority": {
        return await db.select({
          id: newsItemsTable.id,
          title: newsItemsTable.title,
          source: newsItemsTable.source,
          publishedAt: newsItemsTable.publishedAt,
          priorityScore: newsItemsTable.priorityScore,
        }).from(newsItemsTable)
          .where(gte(newsItemsTable.priorityScore, 60))
          .orderBy(desc(newsItemsTable.priorityScore))
          .limit(5);
      }

      case "finance.summary": {
        // Current month income vs expenses (or filtered date range)
        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const dateFrom = (params.dateFrom as string) ?? defaultFrom;
        const summaryWhere = params.dateTo
          ? and(eq(financeTransactionsTable.userId, userIdStr), gte(financeTransactionsTable.date, dateFrom), lte(financeTransactionsTable.date, params.dateTo as string))
          : and(eq(financeTransactionsTable.userId, userIdStr), gte(financeTransactionsTable.date, dateFrom));
        const rows = await db.select({
          amount: financeTransactionsTable.amount,
          type: financeTransactionsTable.type,
        }).from(financeTransactionsTable)
          .where(summaryWhere);

        const ingresos = rows
          .filter(r => r.type === "income" || r.type === "ingreso")
          .reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const gastos = rows
          .filter(r => r.type === "expense" || r.type === "gasto" || r.type === "egreso")
          .reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const balance = ingresos - gastos;

        return { ingresos, gastos, balance, transacciones: rows.length };
      }

      case "finance.transactions.recent": {
        const txWhere = params.dateFrom || params.dateTo
          ? and(
              eq(financeTransactionsTable.userId, userIdStr),
              params.dateFrom ? gte(financeTransactionsTable.date, params.dateFrom as string) : undefined,
              params.dateTo   ? lte(financeTransactionsTable.date, params.dateTo   as string) : undefined,
            )
          : eq(financeTransactionsTable.userId, userIdStr);
        return await db.select().from(financeTransactionsTable)
          .where(txWhere)
          .orderBy(desc(financeTransactionsTable.date))
          .limit((params.limit as number) ?? 10);
      }

      case "finance.budgets.status": {
        return await db.select().from(financeBudgetsTable)
          .where(eq(financeBudgetsTable.userId, userIdStr))
          .limit(20);
      }

      case "finance.goals.progress": {
        return await db.select().from(financeGoalsTable)
          .where(eq(financeGoalsTable.userId, userIdStr))
          .limit(10);
      }

      case "tasks.myOpen": {
        return await db.select().from(tasksTable)
          .where(and(
            eq(tasksTable.userId, userIdStr),
            ne(tasksTable.status, "done"),
          ))
          .orderBy(desc(tasksTable.createdAt))
          .limit(20);
      }

      case "tasks.teamBoard": {
        // Summary of the user's own tasks by status
        const rows = await db.select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.userId, userIdStr));
        const byStatus: Record<string, number> = {};
        for (const r of rows) {
          const s = r.status ?? "unknown";
          byStatus[s] = (byStatus[s] ?? 0) + 1;
        }
        const total = rows.length;
        const done = byStatus["done"] ?? 0;
        const pending = total - done;
        return [
          { label: "Pendientes", count: pending, status: "pending" },
          { label: "Completadas", count: done, status: "done" },
          ...Object.entries(byStatus)
            .filter(([s]) => s !== "done")
            .map(([s, count]) => ({ label: s, count, status: s })),
        ].slice(0, 8);
      }

      case "weather.forecast": {
        try {
          const wx = await getWeatherForecast();
          return wx;
        } catch {
          return null;
        }
      }

      case "dollar.quotes": {
        try {
          const rates = await getCurrencyRates();
          return rates;
        } catch {
          return null;
        }
      }

      case "system.notifications": {
        if (isNaN(userIdNum)) return [];
        return await db.select().from(inAppNotificationsTable)
          .where(and(
            eq(inAppNotificationsTable.userId, userIdNum),
            isNull(inAppNotificationsTable.readAt),
          ))
          .orderBy(desc(inAppNotificationsTable.createdAt))
          .limit(10);
      }

      case "admin.jobs.health": {
        // Only super_admin should see this; handled at route level for other users
        return await db.select().from(jobLogsTable)
          .orderBy(desc(jobLogsTable.startedAt))
          .limit(20);
      }

      case "audit.activity": {
        return await db.select({
          id: auditLogsTable.id,
          action: auditLogsTable.action,
          detail: auditLogsTable.detail,
          createdAt: auditLogsTable.createdAt,
        }).from(auditLogsTable)
          .where(eq(auditLogsTable.userId, userIdStr))
          .orderBy(desc(auditLogsTable.createdAt))
          .limit(15);
      }

      case "static.text":
      case "static.links":
        return params.content ?? null;

      default:
        logger.warn({ key }, "studio: unknown data source key");
        return null;
    }
  } catch (err) {
    logger.error({ err, key }, "studio: data source resolve error");
    return null;
  }
}
