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
} from "@workspace/db";
import { eq, desc, and, gte, lte, isNull, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface DataSourceMeta {
  key: string;
  label: string;
  description: string;
  category: string;
  isExpensive?: boolean;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const DATA_SOURCE_CATALOG: DataSourceMeta[] = [
  { key: "clients.summary", label: "Clientes — Resumen", description: "Totales y estadísticas de clientes", category: "clientes" },
  { key: "clients.list", label: "Clientes — Listado", description: "Lista de clientes activos", category: "clientes" },
  { key: "dueDates.upcoming", label: "Vencimientos — Próximos", description: "Próximos vencimientos fiscales", category: "fiscal" },
  { key: "dueDates.trafficLight", label: "Vencimientos — Semáforo", description: "Estado semáforo de vencimientos", category: "fiscal" },
  { key: "news.feed", label: "Noticias — Feed", description: "Últimas noticias económicas", category: "noticias" },
  { key: "news.priority", label: "Noticias — Prioridad alta", description: "Noticias de alto impacto", category: "noticias" },
  { key: "finance.summary", label: "Finanzas — Resumen", description: "Resumen financiero personal", category: "finanzas" },
  { key: "finance.transactions.recent", label: "Finanzas — Movimientos recientes", description: "Últimos movimientos financieros", category: "finanzas" },
  { key: "finance.budgets.status", label: "Finanzas — Estado presupuestos", description: "Estado actual de los presupuestos", category: "finanzas" },
  { key: "finance.goals.progress", label: "Finanzas — Progreso objetivos", description: "Progreso hacia objetivos financieros", category: "finanzas" },
  { key: "tasks.myOpen", label: "Tareas — Mis abiertas", description: "Tareas del usuario abiertas", category: "tareas" },
  { key: "tasks.teamBoard", label: "Tareas — Panel del equipo", description: "Vista general de tareas del equipo", category: "tareas" },
  { key: "weather.forecast", label: "Clima — Pronóstico", description: "Pronóstico del tiempo local", category: "clima" },
  { key: "dollar.quotes", label: "Dólar — Cotizaciones", description: "Cotizaciones del dólar", category: "economía" },
  { key: "system.notifications", label: "Sistema — Notificaciones", description: "Notificaciones del sistema", category: "sistema" },
  { key: "admin.jobs.health", label: "Admin — Estado de jobs", description: "Estado de los jobs de background", category: "admin", isExpensive: true },
  { key: "audit.activity", label: "Auditoría — Actividad reciente", description: "Actividad reciente del sistema", category: "admin" },
  { key: "static.text", label: "Texto estático", description: "Bloque de texto personalizado", category: "general" },
  { key: "static.links", label: "Links rápidos", description: "Lista de links configurables", category: "general" },
];

// ── Resolver ──────────────────────────────────────────────────────────────────

export async function resolveDataSource(
  key: string,
  userId: number,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  try {
    switch (key) {

      case "clients.summary": {
        const clients = await db.select({ id: clientsTable.id, isActive: clientsTable.isActive })
          .from(clientsTable).where(eq(clientsTable.userId, userId));
        return {
          total: clients.length,
          active: clients.filter(c => c.isActive).length,
          inactive: clients.filter(c => !c.isActive).length,
        };
      }

      case "clients.list": {
        return await db.select().from(clientsTable)
          .where(and(eq(clientsTable.userId, userId), eq(clientsTable.isActive, true)))
          .limit(50);
      }

      case "dueDates.upcoming": {
        const today = new Date();
        const in30 = new Date(today.getTime() + 30 * 86400000);
        // dueDatesTable.userId is text; cast userId to string for comparison
        return await db.select().from(dueDatesTable)
          .where(and(
            eq(dueDatesTable.userId, String(userId)),
            gte(dueDatesTable.dueDate, today.toISOString().slice(0, 10)),
            lte(dueDatesTable.dueDate, in30.toISOString().slice(0, 10)),
            ne(dueDatesTable.status, "done"),
          ))
          .orderBy(dueDatesTable.dueDate)
          .limit(20);
      }

      case "dueDates.trafficLight": {
        const rows = await db.select({
          trafficLight: dueDatesTable.trafficLight,
        }).from(dueDatesTable)
          .where(eq(dueDatesTable.userId, String(userId)));
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

      case "finance.transactions.recent": {
        // financeTransactionsTable.userId is text
        return await db.select().from(financeTransactionsTable)
          .where(eq(financeTransactionsTable.userId, String(userId)))
          .orderBy(desc(financeTransactionsTable.date))
          .limit((params.limit as number) ?? 10);
      }

      case "finance.budgets.status": {
        // financeBudgetsTable.userId is text
        return await db.select().from(financeBudgetsTable)
          .where(eq(financeBudgetsTable.userId, String(userId)))
          .limit(20);
      }

      case "finance.goals.progress": {
        return await db.select().from(financeGoalsTable)
          .where(eq(financeGoalsTable.userId, String(userId)))
          .limit(10);
      }

      case "tasks.myOpen": {
        // tasksTable.userId is text
        return await db.select().from(tasksTable)
          .where(and(
            eq(tasksTable.userId, String(userId)),
            ne(tasksTable.status, "done"),
          ))
          .orderBy(desc(tasksTable.createdAt))
          .limit(20);
      }

      case "system.notifications": {
        return await db.select().from(inAppNotificationsTable)
          .where(and(
            eq(inAppNotificationsTable.userId, userId),
            isNull(inAppNotificationsTable.readAt),
          ))
          .orderBy(desc(inAppNotificationsTable.createdAt))
          .limit(10);
      }

      case "admin.jobs.health": {
        return await db.select().from(jobLogsTable)
          .orderBy(desc(jobLogsTable.startedAt))
          .limit(20);
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
