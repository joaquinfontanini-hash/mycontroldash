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
  quotesTable,
  quotePaymentsTable,
  quoteInstallmentsTable,
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
  // Presupuestos y Cobranzas
  { key: "quotes.kpis",                label: "Presupuestos — KPIs",             description: "Total presupuestado, cobrado, saldo, tasa",   category: "presupuestos", supportsSnapshot: true },
  { key: "quotes.upcoming.expiry",     label: "Presupuestos — Próximos a vencer",description: "Presupuestos próximos a vencer (30 días)",    category: "presupuestos" },
  { key: "quotes.monthly.payments",    label: "Presupuestos — Cobranzas por mes",description: "Evolución mensual de cobranzas",              category: "presupuestos", supportsSnapshot: true },
  { key: "quotes.by.status",           label: "Presupuestos — Por estado",       description: "Distribución de presupuestos por estado",    category: "presupuestos", supportsSnapshot: true },
  { key: "quotes.top.debtors",         label: "Presupuestos — Ranking deudores", description: "Top clientes con mayor saldo pendiente",      category: "presupuestos", supportsSnapshot: true },
  // Finanzas integradas — Cuotas de contratos recurrentes
  { key: "quotes.projected.monthly",        label: "Presupuestos — Ingresos proyectados por mes", description: "Cuotas futuras pendientes agrupadas por mes de vencimiento", category: "presupuestos", supportsSnapshot: true },
  { key: "quotes.outstanding.receivables",  label: "Presupuestos — Deuda pendiente",              description: "Total de saldos pendientes: presupuestos + cuotas vencidas", category: "presupuestos", supportsSnapshot: true },
  { key: "quotes.installments.future",      label: "Presupuestos — Cuotas futuras",               description: "Cuotas pendientes con vencimiento en los próximos 60 días",  category: "presupuestos" },
  { key: "quotes.installments.overdue",     label: "Presupuestos — Cuotas vencidas",              description: "Cuotas con status overdue o dueDate pasada sin pagar",       category: "presupuestos" },
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
        const clients = await db.select({ id: clientsTable.id, status: clientsTable.status })
          .from(clientsTable).where(eq(clientsTable.userId, userIdStr));
        return {
          total: clients.length,
          active: clients.filter(c => c.status === "active").length,
          inactive: clients.filter(c => c.status !== "active").length,
        };
      }

      case "clients.list": {
        return await db.select().from(clientsTable)
          .where(and(eq(clientsTable.userId, userIdStr), eq(clientsTable.status, "active")))
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

      case "quotes.kpis": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const monthStart = todayStr.slice(0, 7) + "-01";
        const [kpis] = await db.select({
          totalPresupuestado: sql<string>`coalesce(sum(total_amount), 0)`,
          cantidadPresupuestos: sql<number>`count(*)`,
          cantidadVencidos: sql<number>`count(*) filter (where status = 'expired' or (due_date < ${todayStr} and status not in ('paid','rejected') and archived_at is null))`,
          cantidadPendientes: sql<number>`count(*) filter (where status in ('draft','sent','approved') and archived_at is null)`,
          cantidadPagados: sql<number>`count(*) filter (where status = 'paid')`,
          cantidadParciales: sql<number>`count(*) filter (where status = 'partially_paid')`,
        }).from(quotesTable).where(eq(quotesTable.userId, userIdStr));
        const [cob] = await db.select({ total: sql<string>`coalesce(sum(amount), 0)` }).from(quotePaymentsTable).where(eq(quotePaymentsTable.userId, userIdStr));
        const [mes] = await db.select({ total: sql<string>`coalesce(sum(amount), 0)` }).from(quotePaymentsTable).where(and(eq(quotePaymentsTable.userId, userIdStr), gte(quotePaymentsTable.paymentDate, monthStart)));
        const totalPres = parseFloat(kpis?.totalPresupuestado ?? "0");
        const totalCob = parseFloat(cob?.total ?? "0");
        return {
          totalPresupuestado: totalPres, totalCobrado: totalCob, saldoPendiente: totalPres - totalCob,
          cantidadPresupuestos: Number(kpis?.cantidadPresupuestos ?? 0),
          cantidadVencidos: Number(kpis?.cantidadVencidos ?? 0),
          cantidadPendientes: Number(kpis?.cantidadPendientes ?? 0),
          cantidadPagados: Number(kpis?.cantidadPagados ?? 0),
          cantidadParciales: Number(kpis?.cantidadParciales ?? 0),
          cobranzasMes: parseFloat(mes?.total ?? "0"),
          tasaCobro: totalPres > 0 ? Math.round((totalCob / totalPres) * 1000) / 10 : 0,
        };
      }

      case "quotes.upcoming.expiry": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const in30 = new Date(); in30.setDate(in30.getDate() + 30); const in30Str = in30.toISOString().slice(0, 10);
        return await db.select({
          id: quotesTable.id, quoteNumber: quotesTable.quoteNumber, title: quotesTable.title,
          dueDate: quotesTable.dueDate, totalAmount: quotesTable.totalAmount, status: quotesTable.status,
          clientName: clientsTable.name,
          balance: sql<string>`${quotesTable.totalAmount} - coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
        }).from(quotesTable)
          .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
          .where(and(eq(quotesTable.userId, userIdStr), gte(quotesTable.dueDate, todayStr), lte(quotesTable.dueDate, in30Str), isNull(quotesTable.archivedAt)))
          .orderBy(quotesTable.dueDate).limit(15);
      }

      case "quotes.monthly.payments": {
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 11); const cutoffStr = cutoff.toISOString().slice(0, 7) + "-01";
        return await db.select({
          mes: sql<string>`to_char(payment_date::date, 'YYYY-MM')`,
          total: sql<string>`sum(amount)`,
          cantidad: sql<number>`count(*)`,
        }).from(quotePaymentsTable)
          .where(and(eq(quotePaymentsTable.userId, userIdStr), gte(quotePaymentsTable.paymentDate, cutoffStr)))
          .groupBy(sql`to_char(payment_date::date, 'YYYY-MM')`)
          .orderBy(sql`to_char(payment_date::date, 'YYYY-MM')`);
      }

      case "quotes.by.status": {
        return await db.select({
          status: quotesTable.status, cantidad: sql<number>`count(*)`, total: sql<string>`sum(total_amount)`,
        }).from(quotesTable).where(eq(quotesTable.userId, userIdStr)).groupBy(quotesTable.status);
      }

      case "quotes.top.debtors": {
        return await db.select({
          clientId: quotesTable.clientId, clientName: clientsTable.name,
          totalPresupuestado: sql<string>`sum(${quotesTable.totalAmount})`,
          totalCobrado: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
          saldoPendiente: sql<string>`sum(${quotesTable.totalAmount}) - coalesce(sum((select coalesce(sum(p.amount),0) from quote_payments p where p.quote_id = ${quotesTable.id})), 0)`,
        }).from(quotesTable)
          .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
          .where(and(eq(quotesTable.userId, userIdStr), isNull(quotesTable.archivedAt)))
          .groupBy(quotesTable.clientId, clientsTable.name)
          .orderBy(sql`sum(${quotesTable.totalAmount}) - coalesce(sum((select coalesce(sum(p.amount),0) from quote_payments p where p.quote_id = ${quotesTable.id})), 0) desc`)
          .limit(10);
      }

      case "quotes.projected.monthly": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const months = (params.months as number) ?? 12;
        const future = new Date(); future.setMonth(future.getMonth() + months);
        const futureStr = future.toISOString().slice(0, 10);
        const rows = await db
          .select({
            mes: sql<string>`to_char(qi.due_date::date, 'YYYY-MM')`,
            totalProyectado: sql<string>`sum(qi.adjusted_amount)`,
            cantidadCuotas: sql<number>`count(*)`,
          })
          .from(sql`quote_installments qi`)
          .innerJoin(quotesTable, sql`qi.quote_id = ${quotesTable.id}`)
          .where(sql`${quotesTable.userId} = ${userIdStr} AND qi.due_date > ${todayStr} AND qi.due_date <= ${futureStr} AND qi.status NOT IN ('paid','cancelled','overdue','partially_paid')`)
          .groupBy(sql`to_char(qi.due_date::date, 'YYYY-MM')`)
          .orderBy(sql`to_char(qi.due_date::date, 'YYYY-MM')`);
        return rows.map(r => ({ ...r, totalProyectado: parseFloat(r.totalProyectado ?? "0") }));
      }

      case "quotes.outstanding.receivables": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const [quotesBalance] = await db
          .select({
            saldoPresupuestos: sql<string>`coalesce(sum(q.total_amount) - sum(coalesce((select sum(p.amount) from quote_payments p where p.quote_id = q.id), 0)), 0)`,
            cantidadPresupuestos: sql<number>`count(*) filter (where q.status not in ('paid','rejected') and q.archived_at is null)`,
          })
          .from(sql`quotes q`)
          .where(sql`q.user_id = ${userIdStr} and q.status not in ('paid','rejected') and q.archived_at is null`);
        const [installBalance] = await db
          .select({
            saldoCuotas: sql<string>`coalesce(sum(qi.balance_due), 0)`,
            cuotasVencidas: sql<number>`count(*) filter (where qi.status = 'overdue' or (qi.due_date < ${todayStr} and qi.status not in ('paid','cancelled')))`,
            cuotasPendientes: sql<number>`count(*) filter (where qi.status in ('pending','due'))`,
          })
          .from(sql`quote_installments qi`)
          .innerJoin(quotesTable, sql`qi.quote_id = ${quotesTable.id}`)
          .where(sql`${quotesTable.userId} = ${userIdStr} AND qi.status NOT IN ('paid','cancelled')`);
        return {
          saldoPresupuestos: parseFloat(quotesBalance?.saldoPresupuestos ?? "0"),
          saldoCuotas: parseFloat(installBalance?.saldoCuotas ?? "0"),
          totalPendiente: parseFloat(quotesBalance?.saldoPresupuestos ?? "0") + parseFloat(installBalance?.saldoCuotas ?? "0"),
          cantidadPresupuestos: Number(quotesBalance?.cantidadPresupuestos ?? 0),
          cuotasVencidas: Number(installBalance?.cuotasVencidas ?? 0),
          cuotasPendientes: Number(installBalance?.cuotasPendientes ?? 0),
        };
      }

      case "quotes.installments.future": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const days = (params.days as number) ?? 60;
        const future = new Date(); future.setDate(future.getDate() + days);
        const futureStr = future.toISOString().slice(0, 10);
        return await db
          .select({
            id: quoteInstallmentsTable.id,
            quoteId: quoteInstallmentsTable.quoteId,
            quoteNumber: quotesTable.quoteNumber,
            clientName: clientsTable.name,
            installmentNumber: quoteInstallmentsTable.installmentNumber,
            dueDate: quoteInstallmentsTable.dueDate,
            adjustedAmount: quoteInstallmentsTable.adjustedAmount,
            status: quoteInstallmentsTable.status,
            balanceDue: quoteInstallmentsTable.balanceDue,
          })
          .from(quoteInstallmentsTable)
          .innerJoin(quotesTable, eq(quoteInstallmentsTable.quoteId, quotesTable.id))
          .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
          .where(and(
            eq(quotesTable.userId, userIdStr),
            gte(quoteInstallmentsTable.dueDate, todayStr),
            lte(quoteInstallmentsTable.dueDate, futureStr),
            sql`${quoteInstallmentsTable.status} NOT IN ('paid','cancelled')`,
          ))
          .orderBy(quoteInstallmentsTable.dueDate)
          .limit(30);
      }

      case "quotes.installments.overdue": {
        const todayStr = new Date().toISOString().slice(0, 10);
        return await db
          .select({
            id: quoteInstallmentsTable.id,
            quoteId: quoteInstallmentsTable.quoteId,
            quoteNumber: quotesTable.quoteNumber,
            clientName: clientsTable.name,
            installmentNumber: quoteInstallmentsTable.installmentNumber,
            dueDate: quoteInstallmentsTable.dueDate,
            adjustedAmount: quoteInstallmentsTable.adjustedAmount,
            paidAmount: quoteInstallmentsTable.paidAmount,
            balanceDue: quoteInstallmentsTable.balanceDue,
            status: quoteInstallmentsTable.status,
          })
          .from(quoteInstallmentsTable)
          .innerJoin(quotesTable, eq(quoteInstallmentsTable.quoteId, quotesTable.id))
          .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
          .where(and(
            eq(quotesTable.userId, userIdStr),
            sql`(${quoteInstallmentsTable.status} = 'overdue' OR (${quoteInstallmentsTable.dueDate} < ${todayStr} AND ${quoteInstallmentsTable.status} NOT IN ('paid','cancelled')))`,
          ))
          .orderBy(quoteInstallmentsTable.dueDate)
          .limit(30);
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
