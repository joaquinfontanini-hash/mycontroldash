import { Router, type IRouter } from "express";
import {
  eq, desc, asc, and, or, ilike, sql, lt, lte, gte, gt, inArray, isNull, ne, notInArray
} from "drizzle-orm";
import {
  db,
  quotesTable, quoteItemsTable, quoteRevisionsTable, quotePaymentsTable,
  quoteActivityLogsTable, quoteInstallmentsTable, quoteAdjustmentsTable,
  clientsTable,
  type InsertQuote, type InsertQuoteItem, type InsertQuotePayment,
  type InsertQuoteInstallment,
} from "@workspace/db";
import { requireAuth, getCurrentUserId } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── helpers ────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateQuoteNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(quotesTable)
    .where(and(eq(quotesTable.userId, userId), ilike(quotesTable.quoteNumber, `P${year}-%`)));
  const n = (Number(count[0]?.cnt ?? 0) + 1).toString().padStart(4, "0");
  return `P${year}-${n}`;
}

async function logActivity(
  quoteId: number,
  clientId: number,
  userId: string,
  actionType: string,
  description: string,
  metadata?: unknown,
) {
  await db.insert(quoteActivityLogsTable).values({
    quoteId, clientId, userId,
    actionType, description,
    metadataJson: metadata ?? null,
    performedBy: userId,
  });
}

// ── FIX Bug 4: recalcStatus también maneja approved→expired ──────────────────
async function recalcStatus(quoteId: number): Promise<void> {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!quote) return;
  if (quote.status === "rejected" || quote.archivedAt) return;

  // Para contratos recurrentes el estado lo manejan las cuotas
  if (quote.quoteType === "recurring_indexed") {
    await recalcRecurringStatus(quoteId);
    return;
  }

  const totalPaid = await db
    .select({ total: sql<string>`coalesce(sum(amount), 0)` })
    .from(quotePaymentsTable)
    .where(eq(quotePaymentsTable.quoteId, quoteId));

  const paid = parseFloat(totalPaid[0]?.total ?? "0");
  const total = parseFloat(quote.totalAmount as string);
  const balance = total - paid;

  let newStatus = quote.status;
  if (paid >= total && total > 0) {
    newStatus = "paid";
  } else if (paid > 0 && balance > 0) {
    newStatus = "partially_paid";
  } else if (paid === 0 && quote.dueDate < today()) {
    // FIX: ya no excluye 'approved' — un presupuesto aprobado vencido pasa a expired
    if (!["draft", "rejected", "paid"].includes(quote.status)) {
      newStatus = "expired";
    }
  }

  if (newStatus !== quote.status) {
    await db.update(quotesTable).set({ status: newStatus }).where(eq(quotesTable.id, quoteId));
  }
}

// Recalc estado para contratos recurrentes basado en cuotas
async function recalcRecurringStatus(quoteId: number): Promise<void> {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!quote) return;

  const installments = await db.select().from(quoteInstallmentsTable)
    .where(eq(quoteInstallmentsTable.quoteId, quoteId));

  if (!installments.length) return;

  const todayStr = today();
  const allPaid = installments.every(i => i.status === "paid" || i.status === "cancelled");
  const anyPartial = installments.some(i => i.status === "partially_paid" || (parseFloat(i.paidAmount as string) > 0 && i.status !== "paid"));

  if (allPaid) {
    await db.update(quotesTable).set({ status: "paid" }).where(eq(quotesTable.id, quoteId));
  } else if (anyPartial) {
    await db.update(quotesTable).set({ status: "partially_paid" }).where(eq(quotesTable.id, quoteId));
  }
  // En contratos el vencimiento es del contrato completo (contractEndDate)
}

// ── generateInstallments — genera array de cuotas para contratos recurrentes ──
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function frequencyToMonths(freq: string): number {
  switch (freq) {
    case "monthly":    return 1;
    case "quarterly":  return 3;
    case "semiannual": return 6;
    case "annual":     return 12;
    default:           return 1;
  }
}

function nextAdjDateFromFreq(fromDate: Date, adjustmentFreq: string): string {
  const months = frequencyToMonths(adjustmentFreq);
  return addMonths(fromDate, months).toISOString().slice(0, 10);
}

function generateInstallments(
  quoteId: number,
  contractStartDate: string,
  contractEndDate: string,
  billingFrequency: string,
  baseAmount: number,
): InsertQuoteInstallment[] {
  const installments: InsertQuoteInstallment[] = [];
  const stepMonths = frequencyToMonths(billingFrequency);
  let periodStart = new Date(contractStartDate + "T00:00:00");
  const end = new Date(contractEndDate + "T00:00:00");
  let n = 1;

  while (periodStart < end) {
    const periodEnd = addMonths(periodStart, stepMonths);
    const actualPeriodEnd = periodEnd > end ? end : periodEnd;
    // La fecha de vencimiento es el último día del período (o fin de contrato)
    const dueDateObj = new Date(actualPeriodEnd);
    dueDateObj.setDate(dueDateObj.getDate() - 1); // último día inclusivo
    const dueDate = dueDateObj < periodStart
      ? periodStart.toISOString().slice(0, 10)
      : dueDateObj.toISOString().slice(0, 10);

    installments.push({
      quoteId,
      installmentNumber: n,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: actualPeriodEnd.toISOString().slice(0, 10),
      dueDate,
      baseAmount: baseAmount.toString(),
      adjustedAmount: baseAmount.toString(),
      appliedAdjustmentRate: "0",
      status: "pending",
      paidAmount: "0",
      balanceDue: baseAmount.toString(),
    });

    n++;
    periodStart = periodEnd;
    if (periodStart >= end) break;
  }

  return installments;
}

// ── Recalc estado de una cuota individual ─────────────────────────────────────
async function recalcInstallmentStatus(installmentId: number): Promise<void> {
  const [inst] = await db.select().from(quoteInstallmentsTable).where(eq(quoteInstallmentsTable.id, installmentId));
  if (!inst) return;

  const adjustedAmount = parseFloat(inst.adjustedAmount as string);
  const paidAmount = parseFloat(inst.paidAmount as string);
  const balance = adjustedAmount - paidAmount;
  const todayStr = today();

  let newStatus = inst.status;
  if (paidAmount >= adjustedAmount && adjustedAmount > 0) {
    newStatus = "paid";
  } else if (paidAmount > 0 && balance > 0) {
    newStatus = "partially_paid";
  } else if (paidAmount === 0 && inst.dueDate < todayStr && inst.status === "pending") {
    newStatus = "overdue";
  } else if (paidAmount === 0 && inst.dueDate >= todayStr) {
    if (inst.status === "overdue") newStatus = "pending"; // shouldn't happen but safety
  }

  if (newStatus !== inst.status) {
    await db.update(quoteInstallmentsTable)
      .set({ status: newStatus, balanceDue: balance.toString() })
      .where(eq(quoteInstallmentsTable.id, installmentId));
  } else if (balance.toString() !== (inst.balanceDue as string)) {
    await db.update(quoteInstallmentsTable)
      .set({ balanceDue: balance.toString() })
      .where(eq(quoteInstallmentsTable.id, installmentId));
  }
}

// ── Estado semáforo de cuotas (cron diario) ───────────────────────────────────
export async function refreshInstallmentStatuses(userId?: string): Promise<void> {
  const todayStr = today();
  // Pasar pending → overdue donde ya venció
  const cond = userId
    ? and(eq(quotesTable.userId, userId), eq(quoteInstallmentsTable.status, "pending"), lt(quoteInstallmentsTable.dueDate, todayStr))
    : and(eq(quoteInstallmentsTable.status, "pending"), lt(quoteInstallmentsTable.dueDate, todayStr));

  await db.update(quoteInstallmentsTable)
    .set({ status: "overdue" })
    .where(
      inArray(
        quoteInstallmentsTable.quoteId,
        db.select({ id: quotesTable.id }).from(quotesTable)
          .leftJoin(quoteInstallmentsTable, eq(quoteInstallmentsTable.quoteId, quotesTable.id))
          .where(and(
            eq(quoteInstallmentsTable.status, "pending"),
            lt(quoteInstallmentsTable.dueDate, todayStr),
          )),
      )
    );
}

// Build shared "enriched quote" query
async function getQuoteDetail(quoteId: number, userId: string) {
  const [quote] = await db
    .select({
      quote: quotesTable,
      clientName: clientsTable.name,
      clientCuit: clientsTable.cuit,
      clientStatus: clientsTable.status,
    })
    .from(quotesTable)
    .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
    .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));

  if (!quote) return null;

  const [items, revisions, payments, activity, paidAgg, installments, adjustments] = await Promise.all([
    db.select().from(quoteItemsTable).where(eq(quoteItemsTable.quoteId, quoteId)).orderBy(asc(quoteItemsTable.sortOrder)),
    db.select().from(quoteRevisionsTable).where(eq(quoteRevisionsTable.quoteId, quoteId)).orderBy(desc(quoteRevisionsTable.changedAt)),
    db.select().from(quotePaymentsTable).where(eq(quotePaymentsTable.quoteId, quoteId)).orderBy(desc(quotePaymentsTable.paymentDate)),
    db.select().from(quoteActivityLogsTable).where(eq(quoteActivityLogsTable.quoteId, quoteId)).orderBy(desc(quoteActivityLogsTable.performedAt)),
    db.select({ total: sql<string>`coalesce(sum(amount), 0)` }).from(quotePaymentsTable).where(eq(quotePaymentsTable.quoteId, quoteId)),
    db.select().from(quoteInstallmentsTable).where(eq(quoteInstallmentsTable.quoteId, quoteId)).orderBy(asc(quoteInstallmentsTable.installmentNumber)),
    db.select().from(quoteAdjustmentsTable).where(eq(quoteAdjustmentsTable.quoteId, quoteId)).orderBy(desc(quoteAdjustmentsTable.appliedAt)),
  ]);

  const totalPaid = parseFloat(paidAgg[0]?.total ?? "0");
  const totalAmount = parseFloat(quote.quote.totalAmount as string);
  const balance = totalAmount - totalPaid;

  return {
    ...quote.quote,
    clientName: quote.clientName,
    clientCuit: quote.clientCuit,
    clientStatus: quote.clientStatus,
    items, revisions, payments, activity,
    installments, adjustments,
    totalPaid, balance,
  };
}

// ── GET /quotes  (list with filters + pagination) ──────────────────────────────
router.get("/quotes", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const {
      clientId, status, currency, search, quoteType,
      issueDateFrom, issueDateTo, dueDateFrom, dueDateTo,
      page = "1", limit = "50", sortBy = "dueDate", sortDir = "asc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(quotesTable.userId, userId)];
    if (clientId) conditions.push(eq(quotesTable.clientId, parseInt(clientId)));
    if (quoteType) conditions.push(eq(quotesTable.quoteType, quoteType));
    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(quotesTable.status, statuses[0]!));
      } else if (statuses.length > 1) {
        conditions.push(inArray(quotesTable.status, statuses));
      }
    }
    if (currency) conditions.push(eq(quotesTable.currency, currency));
    if (issueDateFrom) conditions.push(gte(quotesTable.issueDate, issueDateFrom));
    if (issueDateTo) conditions.push(lte(quotesTable.issueDate, issueDateTo));
    if (dueDateFrom) conditions.push(gte(quotesTable.dueDate, dueDateFrom));
    if (dueDateTo) conditions.push(lte(quotesTable.dueDate, dueDateTo));
    if (search) {
      conditions.push(
        or(
          ilike(quotesTable.quoteNumber, `%${search}%`),
          ilike(quotesTable.title, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
        )!
      );
    }

    const where = and(...conditions);

    const sortCol = (() => {
      if (sortBy === "dueDate")     return sortDir === "desc" ? desc(quotesTable.dueDate)     : asc(quotesTable.dueDate);
      if (sortBy === "issueDate")   return sortDir === "desc" ? desc(quotesTable.issueDate)   : asc(quotesTable.issueDate);
      if (sortBy === "totalAmount") return sortDir === "desc" ? desc(quotesTable.totalAmount)  : asc(quotesTable.totalAmount);
      if (sortBy === "status")      return sortDir === "desc" ? desc(quotesTable.status)       : asc(quotesTable.status);
      if (sortBy === "client")      return sortDir === "desc" ? desc(clientsTable.name)        : asc(clientsTable.name);
      return asc(quotesTable.dueDate);
    })();

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: quotesTable.id,
          quoteNumber: quotesTable.quoteNumber,
          clientId: quotesTable.clientId,
          clientName: clientsTable.name,
          title: quotesTable.title,
          currency: quotesTable.currency,
          issueDate: quotesTable.issueDate,
          dueDate: quotesTable.dueDate,
          totalAmount: quotesTable.totalAmount,
          status: quotesTable.status,
          version: quotesTable.version,
          quoteType: quotesTable.quoteType,
          contractStartDate: quotesTable.contractStartDate,
          contractEndDate: quotesTable.contractEndDate,
          billingFrequency: quotesTable.billingFrequency,
          nextAdjustmentDate: quotesTable.nextAdjustmentDate,
          archivedAt: quotesTable.archivedAt,
          createdAt: quotesTable.createdAt,
          totalPaid: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
          lastPaymentDate: sql<string | null>`(select max(p.payment_date) from quote_payments p where p.quote_id = ${quotesTable.id})`,
          installmentsTotal: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id})`,
          installmentsPending: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id} and qi.status in ('pending','due'))`,
          installmentsOverdue: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id} and qi.status = 'overdue')`,
        })
        .from(quotesTable)
        .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
        .where(where)
        .orderBy(sortCol)
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(quotesTable)
        .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
        .where(where),
    ]);

    const enriched = rows.map(r => ({
      ...r,
      totalPaid: parseFloat(r.totalPaid ?? "0"),
      balance: parseFloat(r.totalAmount as string) - parseFloat(r.totalPaid ?? "0"),
    }));

    res.json({
      data: enriched,
      total: Number(countRows[0]?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    logger.error({ err }, "quotes list error");
    res.status(500).json({ error: "Error al cargar presupuestos" });
  }
});

// ── GET /quotes/kpis ────────────────────────────────────────────────────────────
router.get("/quotes/kpis", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { currency, clientId } = req.query as Record<string, string>;

    const conditions = [eq(quotesTable.userId, userId)];
    if (currency) conditions.push(eq(quotesTable.currency, currency));
    if (clientId) conditions.push(eq(quotesTable.clientId, parseInt(clientId)));
    const where = and(...conditions);

    const todayStr = today();
    const monthStart = todayStr.slice(0, 7) + "-01";
    const in30days = new Date();
    in30days.setDate(in30days.getDate() + 30);
    const in30daysStr = in30days.toISOString().slice(0, 10);

    const [kpis] = await db
      .select({
        totalPresupuestado: sql<string>`coalesce(sum(total_amount), 0)`,
        totalCobrado: sql<string>`coalesce((select sum(p.amount) from quote_payments p join quotes q2 on p.quote_id = q2.id where q2.user_id = ${userId} ${currency ? sql`and q2.currency = ${currency}` : sql``}), 0)`,
        cantidadPresupuestos: sql<number>`count(*)`,
        cantidadVencidos: sql<number>`count(*) filter (where status = 'expired' or (due_date < ${todayStr} and status not in ('paid','rejected') and archived_at is null))`,
        cantidadPendientes: sql<number>`count(*) filter (where status in ('draft','sent','approved') and archived_at is null)`,
        cantidadParciales: sql<number>`count(*) filter (where status = 'partially_paid' and archived_at is null)`,
        cantidadPagados: sql<number>`count(*) filter (where status = 'paid')`,
        contratosActivos: sql<number>`count(*) filter (where quote_type = 'recurring_indexed' and status in ('approved','partially_paid') and archived_at is null and contract_end_date >= ${todayStr})`,
        contratosProxVencer: sql<number>`count(*) filter (where quote_type = 'recurring_indexed' and contract_end_date >= ${todayStr} and contract_end_date <= ${in30daysStr} and archived_at is null)`,
      })
      .from(quotesTable)
      .where(where);

    const totalPresupuestado = parseFloat(kpis?.totalPresupuestado ?? "0");
    const totalCobrado = parseFloat(kpis?.totalCobrado ?? "0");

    // Cobranzas del mes
    const [mesRows] = await db
      .select({ total: sql<string>`coalesce(sum(p.amount), 0)` })
      .from(quotePaymentsTable)
      .leftJoin(quotesTable, eq(quotePaymentsTable.quoteId, quotesTable.id))
      .where(and(
        eq(quotePaymentsTable.userId, userId),
        gte(quotePaymentsTable.paymentDate, monthStart),
        currency ? eq(quotePaymentsTable.currency, currency) : sql`true`,
      ));

    const cobranzasMes = parseFloat(mesRows?.total ?? "0");
    const tasaCobro = totalPresupuestado > 0 ? (totalCobrado / totalPresupuestado) * 100 : 0;

    // KPIs de cuotas (contratos recurrentes)
    const [instKpis] = await db
      .select({
        cuotasPendientes: sql<number>`count(*) filter (where qi.status in ('pending','due'))`,
        cuotasVencidas: sql<number>`count(*) filter (where qi.status = 'overdue')`,
        cuotasParciales: sql<number>`count(*) filter (where qi.status = 'partially_paid')`,
        ingresosProyMes: sql<string>`coalesce(sum(qi.adjusted_amount) filter (where qi.due_date >= ${monthStart} and qi.due_date < ${in30daysStr} and qi.status not in ('paid','cancelled')), 0)`,
        proximoAjuste: sql<string | null>`min(q.next_adjustment_date) filter (where q.next_adjustment_date is not null and q.next_adjustment_date >= ${todayStr} and q.quote_type = 'recurring_indexed')`,
      })
      .from(quoteInstallmentsTable)
      .leftJoin(quotesTable, and(eq(quoteInstallmentsTable.quoteId, quotesTable.id), eq(quotesTable.userId, userId)));

    res.json({
      totalPresupuestado,
      totalCobrado,
      saldoPendiente: totalPresupuestado - totalCobrado,
      cantidadPresupuestos: Number(kpis?.cantidadPresupuestos ?? 0),
      cantidadVencidos: Number(kpis?.cantidadVencidos ?? 0),
      cantidadPendientes: Number(kpis?.cantidadPendientes ?? 0),
      cantidadParciales: Number(kpis?.cantidadParciales ?? 0),
      cantidadPagados: Number(kpis?.cantidadPagados ?? 0),
      cobranzasMes,
      tasaCobro: Math.round(tasaCobro * 10) / 10,
      // Recurrentes
      contratosActivos: Number(kpis?.contratosActivos ?? 0),
      contratosProxVencer: Number(kpis?.contratosProxVencer ?? 0),
      cuotasPendientes: Number(instKpis?.cuotasPendientes ?? 0),
      cuotasVencidas: Number(instKpis?.cuotasVencidas ?? 0),
      cuotasParciales: Number(instKpis?.cuotasParciales ?? 0),
      ingresosProyMes: parseFloat(instKpis?.ingresosProyMes ?? "0"),
      proximoAjuste: instKpis?.proximoAjuste ?? null,
    });
  } catch (err) {
    logger.error({ err }, "quotes kpis error");
    res.status(500).json({ error: "Error al cargar KPIs" });
  }
});

// ── GET /quotes/dashboard-data  (para Dashboard Studio) ──────────────────────
router.get("/quotes/dashboard-data", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const cobranzasMensuales = await db
      .select({
        mes: sql<string>`to_char(payment_date::date, 'YYYY-MM')`,
        total: sql<string>`sum(amount)`,
        cantidad: sql<number>`count(*)`,
      })
      .from(quotePaymentsTable)
      .where(and(
        eq(quotePaymentsTable.userId, userId),
        gte(quotePaymentsTable.paymentDate, sql`(current_date - interval '12 months')::text`),
      ))
      .groupBy(sql`to_char(payment_date::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(payment_date::date, 'YYYY-MM')`);

    const porEstado = await db
      .select({
        status: quotesTable.status,
        cantidad: sql<number>`count(*)`,
        total: sql<string>`sum(total_amount)`,
      })
      .from(quotesTable)
      .where(eq(quotesTable.userId, userId))
      .groupBy(quotesTable.status);

    const topDeudores = await db
      .select({
        clientId: quotesTable.clientId,
        clientName: clientsTable.name,
        totalPresupuestado: sql<string>`sum(q.total_amount)`,
        totalCobrado: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = q.id), 0)`,
        saldoPendiente: sql<string>`sum(q.total_amount) - coalesce((select sum(p.amount) from quote_payments p where p.quote_id = q.id), 0)`,
      })
      .from(sql`quotes q`)
      .leftJoin(clientsTable, sql`q.client_id = ${clientsTable.id}`)
      .where(sql`q.user_id = ${userId} and q.status not in ('rejected') and q.archived_at is null`)
      .groupBy(sql`q.client_id, ${clientsTable.name}`)
      .orderBy(sql`sum(q.total_amount) - coalesce((select sum(p.amount) from quote_payments p where p.quote_id = q.id), 0) desc`)
      .limit(10);

    const proxVencimientos = await db
      .select({
        id: quotesTable.id,
        quoteNumber: quotesTable.quoteNumber,
        title: quotesTable.title,
        clientName: clientsTable.name,
        dueDate: quotesTable.dueDate,
        totalAmount: quotesTable.totalAmount,
        status: quotesTable.status,
        balance: sql<string>`${quotesTable.totalAmount} - coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
      })
      .from(quotesTable)
      .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
      .where(and(
        eq(quotesTable.userId, userId),
        gte(quotesTable.dueDate, today()),
        lte(quotesTable.dueDate, sql`(current_date + interval '30 days')::text`),
        inArray(quotesTable.status, ["sent", "approved", "partially_paid"]),
        isNull(quotesTable.archivedAt),
      ))
      .orderBy(asc(quotesTable.dueDate))
      .limit(20);

    // Cuotas próximas a vencer (30 días) de contratos recurrentes
    const cuotasProximas = await db
      .select({
        id: quoteInstallmentsTable.id,
        quoteId: quoteInstallmentsTable.quoteId,
        installmentNumber: quoteInstallmentsTable.installmentNumber,
        dueDate: quoteInstallmentsTable.dueDate,
        adjustedAmount: quoteInstallmentsTable.adjustedAmount,
        balanceDue: quoteInstallmentsTable.balanceDue,
        status: quoteInstallmentsTable.status,
        clientName: clientsTable.name,
        quoteTitle: quotesTable.title,
        quoteNumber: quotesTable.quoteNumber,
      })
      .from(quoteInstallmentsTable)
      .leftJoin(quotesTable, eq(quoteInstallmentsTable.quoteId, quotesTable.id))
      .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
      .where(and(
        eq(quotesTable.userId, userId),
        gte(quoteInstallmentsTable.dueDate, today()),
        lte(quoteInstallmentsTable.dueDate, sql`(current_date + interval '30 days')::text`),
        inArray(quoteInstallmentsTable.status, ["pending", "due", "partially_paid"]),
      ))
      .orderBy(asc(quoteInstallmentsTable.dueDate))
      .limit(20);

    res.json({ cobranzasMensuales, porEstado, topDeudores, proxVencimientos, cuotasProximas });
  } catch (err) {
    logger.error({ err }, "quotes dashboard-data error");
    res.status(500).json({ error: "Error al cargar datos del dashboard" });
  }
});

// ── GET /quotes/client/:clientId  (resumen del cliente) ───────────────────────
router.get("/quotes/client/:clientId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const clientId = parseInt(req.params["clientId"] as string);
    if (isNaN(clientId)) { res.status(400).json({ error: "clientId inválido" }); return; }

    const todayStr = today();

    const [summary] = await db
      .select({
        totalPresupuestos: sql<number>`count(*)`,
        totalPresupuestado: sql<string>`coalesce(sum(total_amount), 0)`,
        totalCobrado: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = q.id), 0)`,
        cantidadVencidos: sql<number>`count(*) filter (where status = 'expired' or (due_date < ${todayStr} and status not in ('paid','rejected') and archived_at is null))`,
        cantidadParciales: sql<number>`count(*) filter (where status = 'partially_paid')`,
        contratosActivos: sql<number>`count(*) filter (where quote_type = 'recurring_indexed' and status in ('approved','partially_paid') and contract_end_date >= ${todayStr})`,
      })
      .from(sql`quotes q`)
      .where(sql`q.client_id = ${clientId} and q.user_id = ${userId}`);

    const totalPres = parseFloat(summary?.totalPresupuestado ?? "0");
    const totalCob = parseFloat(summary?.totalCobrado ?? "0");

    const [lastQuote] = await db
      .select({ id: quotesTable.id, quoteNumber: quotesTable.quoteNumber, issueDate: quotesTable.issueDate, title: quotesTable.title, totalAmount: quotesTable.totalAmount, status: quotesTable.status, quoteType: quotesTable.quoteType })
      .from(quotesTable)
      .where(and(eq(quotesTable.clientId, clientId), eq(quotesTable.userId, userId)))
      .orderBy(desc(quotesTable.issueDate))
      .limit(1);

    const [lastPayment] = await db
      .select({ id: quotePaymentsTable.id, paymentDate: quotePaymentsTable.paymentDate, amount: quotePaymentsTable.amount, currency: quotePaymentsTable.currency })
      .from(quotePaymentsTable)
      .where(and(eq(quotePaymentsTable.clientId, clientId), eq(quotePaymentsTable.userId, userId)))
      .orderBy(desc(quotePaymentsTable.paymentDate))
      .limit(1);

    const quotes = await db
      .select({
        id: quotesTable.id,
        quoteNumber: quotesTable.quoteNumber,
        title: quotesTable.title,
        issueDate: quotesTable.issueDate,
        dueDate: quotesTable.dueDate,
        totalAmount: quotesTable.totalAmount,
        status: quotesTable.status,
        currency: quotesTable.currency,
        version: quotesTable.version,
        quoteType: quotesTable.quoteType,
        contractStartDate: quotesTable.contractStartDate,
        contractEndDate: quotesTable.contractEndDate,
        billingFrequency: quotesTable.billingFrequency,
        archivedAt: quotesTable.archivedAt,
        totalPaid: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
        lastPaymentDate: sql<string | null>`(select max(p.payment_date) from quote_payments p where p.quote_id = ${quotesTable.id})`,
        installmentsTotal: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id})`,
        installmentsOverdue: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id} and qi.status = 'overdue')`,
      })
      .from(quotesTable)
      .where(and(eq(quotesTable.clientId, clientId), eq(quotesTable.userId, userId)))
      .orderBy(desc(quotesTable.issueDate));

    const payments = await db
      .select({
        id: quotePaymentsTable.id,
        quoteId: quotePaymentsTable.quoteId,
        installmentId: quotePaymentsTable.installmentId,
        quoteNumber: quotesTable.quoteNumber,
        paymentDate: quotePaymentsTable.paymentDate,
        amount: quotePaymentsTable.amount,
        currency: quotePaymentsTable.currency,
        paymentMethod: quotePaymentsTable.paymentMethod,
        reference: quotePaymentsTable.reference,
        notes: quotePaymentsTable.notes,
      })
      .from(quotePaymentsTable)
      .leftJoin(quotesTable, eq(quotePaymentsTable.quoteId, quotesTable.id))
      .where(and(eq(quotePaymentsTable.clientId, clientId), eq(quotePaymentsTable.userId, userId)))
      .orderBy(desc(quotePaymentsTable.paymentDate));

    res.json({
      summary: {
        totalPresupuestos: Number(summary?.totalPresupuestos ?? 0),
        totalPresupuestado: totalPres,
        totalCobrado: totalCob,
        saldoPendiente: totalPres - totalCob,
        cantidadVencidos: Number(summary?.cantidadVencidos ?? 0),
        cantidadParciales: Number(summary?.cantidadParciales ?? 0),
        contratosActivos: Number(summary?.contratosActivos ?? 0),
        lastQuote: lastQuote ?? null,
        lastPayment: lastPayment ?? null,
      },
      quotes: quotes.map(q => ({
        ...q,
        totalPaid: parseFloat(q.totalPaid ?? "0"),
        balance: parseFloat(q.totalAmount as string) - parseFloat(q.totalPaid ?? "0"),
      })),
      payments,
    });
  } catch (err) {
    logger.error({ err }, "quotes client summary error");
    res.status(500).json({ error: "Error al cargar presupuestos del cliente" });
  }
});

// ── GET /quotes/:id ─────────────────────────────────────────────────────────────
router.get("/quotes/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
    const detail = await getQuoteDetail(id, userId);
    if (!detail) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    res.json(detail);
  } catch (err) {
    logger.error({ err }, "quote detail error");
    res.status(500).json({ error: "Error al cargar presupuesto" });
  }
});

// ── POST /quotes ────────────────────────────────────────────────────────────────
router.post("/quotes", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const {
      clientId, title, description, currency, issueDate, dueDate,
      subtotal, discountAmount, taxAmount, totalAmount, notes, items = [],
      // Campos recurrentes
      quoteType = "single",
      contractStartDate, contractEndDate, billingFrequency,
      adjustmentFrequency, adjustmentIndex, adjustmentMode, baseAmount,
    } = req.body;

    if (!clientId) { res.status(400).json({ error: "El cliente es requerido" }); return; }
    if (!title?.trim()) { res.status(400).json({ error: "El título es requerido" }); return; }
    if (!currency?.trim()) { res.status(400).json({ error: "La moneda es requerida" }); return; }
    if (!issueDate) { res.status(400).json({ error: "La fecha de emisión es requerida" }); return; }
    if (parseFloat(totalAmount ?? 0) < 0) { res.status(400).json({ error: "El total no puede ser negativo" }); return; }

    // FIX Bug 2: verificar ownership del cliente
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(400).json({ error: "Cliente no encontrado" }); return; }

    // Validaciones para recurrentes
    if (quoteType === "recurring_indexed") {
      if (!contractStartDate) { res.status(400).json({ error: "La fecha de inicio del contrato es requerida" }); return; }
      if (!contractEndDate)   { res.status(400).json({ error: "La fecha de fin del contrato es requerida" }); return; }
      if (!billingFrequency)  { res.status(400).json({ error: "La frecuencia de cobro es requerida" }); return; }
      if (!baseAmount || parseFloat(baseAmount) <= 0) { res.status(400).json({ error: "El importe base de la cuota es requerido" }); return; }
      if (contractStartDate >= contractEndDate) { res.status(400).json({ error: "La fecha fin debe ser posterior a la fecha inicio" }); return; }
    } else {
      if (!dueDate) { res.status(400).json({ error: "La fecha de vencimiento es requerida" }); return; }
    }

    const quoteNumber = await generateQuoteNumber(userId);

    // Para recurrentes el totalAmount = sum of all installments (se calcula después)
    // dueDate para recurrentes = contractEndDate
    const effectiveDueDate = quoteType === "recurring_indexed" ? contractEndDate : dueDate;

    // FIX Bug 1: siempre crear como draft, ignorar status del body
    const [quote] = await db.insert(quotesTable).values({
      quoteNumber,
      clientId,
      userId,
      title: title.trim(),
      description: description ?? null,
      currency,
      issueDate,
      dueDate: effectiveDueDate,
      subtotal: subtotal?.toString() ?? "0",
      discountAmount: discountAmount?.toString() ?? "0",
      taxAmount: taxAmount?.toString() ?? "0",
      totalAmount: totalAmount?.toString() ?? "0",
      status: "draft",  // FIX: siempre draft, nunca del body
      version: 1,
      notes: notes ?? null,
      createdBy: userId,
      // Campos recurrentes
      quoteType,
      contractStartDate: quoteType === "recurring_indexed" ? contractStartDate : null,
      contractEndDate:   quoteType === "recurring_indexed" ? contractEndDate   : null,
      billingFrequency:  quoteType === "recurring_indexed" ? billingFrequency  : null,
      adjustmentFrequency: adjustmentFrequency ?? null,
      adjustmentIndex:   adjustmentIndex ?? "ipc",
      adjustmentMode:    adjustmentMode ?? "apply_on_last_effective_amount",
      baseAmount:        quoteType === "recurring_indexed" ? baseAmount?.toString() : null,
      nextAdjustmentDate: (quoteType === "recurring_indexed" && adjustmentFrequency && contractStartDate)
        ? nextAdjDateFromFreq(new Date(contractStartDate + "T00:00:00"), adjustmentFrequency)
        : null,
      installmentsGenerated: false,
    }).returning();

    // Items (para single)
    if (items.length > 0) {
      await db.insert(quoteItemsTable).values(
        items.map((it: { description: string; quantity: number; unitPrice: number; lineTotal: number }, i: number) => ({
          quoteId: quote!.id,
          description: it.description,
          quantity: it.quantity?.toString() ?? "1",
          unitPrice: it.unitPrice?.toString() ?? "0",
          lineTotal: it.lineTotal?.toString() ?? "0",
          sortOrder: i,
        }))
      );
    }

    // Generar cuotas para recurrentes
    if (quoteType === "recurring_indexed" && contractStartDate && contractEndDate && billingFrequency && baseAmount) {
      const installs = generateInstallments(
        quote!.id,
        contractStartDate,
        contractEndDate,
        billingFrequency,
        parseFloat(baseAmount),
      );

      if (installs.length > 0) {
        await db.insert(quoteInstallmentsTable).values(installs);
        // totalAmount = suma de todas las cuotas
        const totalContrato = installs.reduce((acc, i) => acc + parseFloat(baseAmount), 0);
        await db.update(quotesTable).set({
          totalAmount: totalContrato.toFixed(2),
          subtotal: totalContrato.toFixed(2),
          installmentsGenerated: true,
        }).where(eq(quotesTable.id, quote!.id));
      }
    }

    await logActivity(quote!.id, clientId, userId, "created", `Presupuesto ${quoteNumber} creado (${quoteType === "recurring_indexed" ? "contrato recurrente" : "cobro único"})`);

    const detail = await getQuoteDetail(quote!.id, userId);
    res.status(201).json(detail);
  } catch (err) {
    logger.error({ err }, "quote create error");
    res.status(500).json({ error: "Error al crear presupuesto" });
  }
});

// ── PUT /quotes/:id ─────────────────────────────────────────────────────────────
router.put("/quotes/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (existing.archivedAt) { res.status(400).json({ error: "No se puede editar un presupuesto archivado" }); return; }

    const {
      title, description, currency, issueDate, dueDate,
      subtotal, discountAmount, taxAmount, totalAmount, notes, changeReason, items,
    } = req.body;

    const prevTotal = parseFloat(existing.totalAmount as string);
    const newTotal = parseFloat(totalAmount?.toString() ?? existing.totalAmount as string);

    const updates: Partial<InsertQuote> = {};
    if (title !== undefined)          updates.title = title;
    if (description !== undefined)    updates.description = description;
    if (currency !== undefined)       updates.currency = currency;
    if (issueDate !== undefined)      updates.issueDate = issueDate;
    if (dueDate !== undefined)        updates.dueDate = dueDate;
    if (subtotal !== undefined)       updates.subtotal = subtotal.toString();
    if (discountAmount !== undefined) updates.discountAmount = discountAmount.toString();
    if (taxAmount !== undefined)      updates.taxAmount = taxAmount.toString();
    if (totalAmount !== undefined)    updates.totalAmount = totalAmount.toString();
    if (notes !== undefined)          updates.notes = notes;

    if (Math.abs(newTotal - prevTotal) > 0.001) {
      await db.insert(quoteRevisionsTable).values({
        quoteId: id,
        previousTotalAmount: prevTotal.toString(),
        newTotalAmount: newTotal.toString(),
        previousPayloadJson: { title: existing.title, totalAmount: existing.totalAmount, issueDate: existing.issueDate, dueDate: existing.dueDate },
        newPayloadJson: { title, totalAmount, issueDate, dueDate },
        changeReason: changeReason ?? "Edición manual",
        changedBy: userId,
      });
    }

    if (Object.keys(updates).length > 0) {
      await db.update(quotesTable).set(updates).where(eq(quotesTable.id, id));
    }

    if (items !== undefined) {
      await db.delete(quoteItemsTable).where(eq(quoteItemsTable.quoteId, id));
      if (items.length > 0) {
        await db.insert(quoteItemsTable).values(
          items.map((it: { description: string; quantity: number; unitPrice: number; lineTotal: number }, i: number) => ({
            quoteId: id,
            description: it.description,
            quantity: it.quantity?.toString() ?? "1",
            unitPrice: it.unitPrice?.toString() ?? "0",
            lineTotal: it.lineTotal?.toString() ?? "0",
            sortOrder: i,
          }))
        );
      }
    }

    await recalcStatus(id);
    await logActivity(id, existing.clientId, userId, "updated", "Presupuesto actualizado", { prevTotal, newTotal });

    const detail = await getQuoteDetail(id, userId);
    res.json(detail);
  } catch (err) {
    logger.error({ err }, "quote update error");
    res.status(500).json({ error: "Error al actualizar presupuesto" });
  }
});

// ── PATCH /quotes/:id/status ────────────────────────────────────────────────────
// FIX Bug 3: máquina de estados con transiciones válidas
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:           ["sent", "rejected", "approved"],
  sent:            ["approved", "rejected", "draft"],
  approved:        ["sent", "rejected", "paid", "partially_paid"],
  rejected:        ["draft"],
  expired:         ["draft", "approved"],
  partially_paid:  ["paid"],
  paid:            [],
};

router.patch("/quotes/:id/status", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const { status, force = false } = req.body;
    const validStatuses = Object.keys(VALID_TRANSITIONS);
    if (!validStatuses.includes(status)) { res.status(400).json({ error: "Estado inválido" }); return; }

    // FIX: validar transición a menos que sea forzada
    if (!force) {
      const allowed = VALID_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(status)) {
        res.status(400).json({
          error: `Transición inválida: ${existing.status} → ${status}`,
          allowedTransitions: allowed,
        });
        return;
      }
    }

    const updates: Record<string, unknown> = { status };
    if (status === "approved") updates.approvedAt = new Date();
    if (status === "rejected") updates.rejectedAt = new Date();

    await db.update(quotesTable).set(updates).where(eq(quotesTable.id, id));
    await logActivity(id, existing.clientId, userId, "status_change", `Estado cambiado a ${status}`, { from: existing.status, to: status });

    res.json({ ok: true, from: existing.status, to: status });
  } catch (err) {
    logger.error({ err }, "quote status error");
    res.status(500).json({ error: "Error al cambiar estado" });
  }
});

// ── PATCH /quotes/:id/archive ───────────────────────────────────────────────────
router.patch("/quotes/:id/archive", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    await db.update(quotesTable).set({ archivedAt: new Date() }).where(eq(quotesTable.id, id));
    await logActivity(id, existing.clientId, userId, "archived", "Presupuesto archivado");

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "quote archive error");
    res.status(500).json({ error: "Error al archivar" });
  }
});

// ── POST /quotes/:id/new-version ────────────────────────────────────────────────
router.post("/quotes/:id/new-version", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const existingItems = await db.select().from(quoteItemsTable).where(eq(quoteItemsTable.quoteId, id));
    const quoteNumber = await generateQuoteNumber(userId);

    const [newQuote] = await db.insert(quotesTable).values({
      quoteNumber,
      clientId: existing.clientId,
      userId,
      title: existing.title,
      description: existing.description,
      currency: existing.currency,
      issueDate: today(),
      dueDate: existing.dueDate,
      subtotal: existing.subtotal,
      discountAmount: existing.discountAmount,
      taxAmount: existing.taxAmount,
      totalAmount: existing.totalAmount,
      status: "draft",
      version: existing.version + 1,
      parentQuoteId: id,
      notes: existing.notes,
      createdBy: userId,
    }).returning();

    if (existingItems.length > 0) {
      await db.insert(quoteItemsTable).values(
        existingItems.map(it => ({
          quoteId: newQuote!.id,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          sortOrder: it.sortOrder,
        }))
      );
    }

    await logActivity(newQuote!.id, existing.clientId, userId, "new_version", `Nueva versión ${newQuote!.version} creada desde ${existing.quoteNumber}`);
    await logActivity(id, existing.clientId, userId, "new_version", `Se creó versión ${newQuote!.version} (${quoteNumber}) a partir de este presupuesto`);

    const detail = await getQuoteDetail(newQuote!.id, userId);
    res.status(201).json(detail);
  } catch (err) {
    logger.error({ err }, "quote new-version error");
    res.status(500).json({ error: "Error al crear nueva versión" });
  }
});

// ── POST /quotes/:id/duplicate ──────────────────────────────────────────────────
router.post("/quotes/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const existingItems = await db.select().from(quoteItemsTable).where(eq(quoteItemsTable.quoteId, id));
    const quoteNumber = await generateQuoteNumber(userId);

    const [dup] = await db.insert(quotesTable).values({
      quoteNumber,
      clientId: existing.clientId,
      userId,
      title: `${existing.title} (copia)`,
      description: existing.description,
      currency: existing.currency,
      issueDate: today(),
      dueDate: existing.dueDate,
      subtotal: existing.subtotal,
      discountAmount: existing.discountAmount,
      taxAmount: existing.taxAmount,
      totalAmount: existing.totalAmount,
      status: "draft",
      version: 1,
      notes: existing.notes,
      createdBy: userId,
    }).returning();

    if (existingItems.length > 0) {
      await db.insert(quoteItemsTable).values(
        existingItems.map(it => ({
          quoteId: dup!.id,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          sortOrder: it.sortOrder,
        }))
      );
    }

    await logActivity(dup!.id, existing.clientId, userId, "duplicated", `Duplicado desde ${existing.quoteNumber}`);

    const detail = await getQuoteDetail(dup!.id, userId);
    res.status(201).json(detail);
  } catch (err) {
    logger.error({ err }, "quote duplicate error");
    res.status(500).json({ error: "Error al duplicar presupuesto" });
  }
});

// ── POST /quotes/:id/payments ───────────────────────────────────────────────────
router.post("/quotes/:id/payments", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [quote] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (quote.archivedAt) { res.status(400).json({ error: "No se puede registrar cobro en presupuesto archivado" }); return; }
    if (quote.status === "rejected") { res.status(400).json({ error: "No se puede cobrar un presupuesto rechazado" }); return; }

    const { paymentDate, amount, currency, paymentMethod, reference, notes } = req.body;

    if (!paymentDate) { res.status(400).json({ error: "La fecha de pago es requerida" }); return; }
    if (!amount || parseFloat(amount) <= 0) { res.status(400).json({ error: "El importe debe ser mayor a 0" }); return; }

    const [paidAgg] = await db
      .select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(quotePaymentsTable)
      .where(eq(quotePaymentsTable.quoteId, id));

    const totalPaid = parseFloat(paidAgg?.total ?? "0");
    const totalAmount = parseFloat(quote.totalAmount as string);
    const balance = totalAmount - totalPaid;

    if (parseFloat(amount) > balance + 0.01) {
      res.status(400).json({ error: `El importe (${amount}) supera el saldo pendiente (${balance.toFixed(2)})` });
      return;
    }

    const [payment] = await db.insert(quotePaymentsTable).values({
      quoteId: id,
      clientId: quote.clientId,
      userId,
      paymentDate,
      amount: amount.toString(),
      currency: currency ?? quote.currency,
      paymentMethod: paymentMethod ?? "transferencia",
      reference: reference ?? null,
      notes: notes ?? null,
      createdBy: userId,
    }).returning();

    await recalcStatus(id);
    await logActivity(id, quote.clientId, userId, "payment_registered", `Cobro registrado: ${amount} ${currency ?? quote.currency}`, { amount, paymentMethod, reference });

    res.status(201).json(payment);
  } catch (err) {
    logger.error({ err }, "quote payment error");
    res.status(500).json({ error: "Error al registrar cobro" });
  }
});

// ── DELETE /quotes/:id/payments/:paymentId ──────────────────────────────────────
router.delete("/quotes/:id/payments/:paymentId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const quoteId = parseInt(req.params["id"] as string);
    const paymentId = parseInt(req.params["paymentId"] as string);
    if (isNaN(quoteId) || isNaN(paymentId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [quote] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [payment] = await db.select().from(quotePaymentsTable).where(and(eq(quotePaymentsTable.id, paymentId), eq(quotePaymentsTable.quoteId, quoteId)));
    if (!payment) { res.status(404).json({ error: "Cobro no encontrado" }); return; }

    await db.delete(quotePaymentsTable).where(eq(quotePaymentsTable.id, paymentId));
    await recalcStatus(quoteId);
    await logActivity(quoteId, quote.clientId, userId, "payment_deleted", `Cobro eliminado: ${payment.amount} ${payment.currency}`);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "quote payment delete error");
    res.status(500).json({ error: "Error al eliminar cobro" });
  }
});

// ── GET /quotes/:id/installments ────────────────────────────────────────────────
router.get("/quotes/:id/installments", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    // Verificar ownership
    const [quote] = await db.select({ id: quotesTable.id, quoteType: quotesTable.quoteType })
      .from(quotesTable)
      .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (quote.quoteType !== "recurring_indexed") {
      res.status(400).json({ error: "Solo los contratos recurrentes tienen cuotas" });
      return;
    }

    const { status } = req.query as Record<string, string>;
    const conditions = [eq(quoteInstallmentsTable.quoteId, id)];
    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length > 0) conditions.push(inArray(quoteInstallmentsTable.status, statuses));
    }

    const installments = await db.select().from(quoteInstallmentsTable)
      .where(and(...conditions))
      .orderBy(asc(quoteInstallmentsTable.installmentNumber));

    const todayStr = today();
    const enriched = installments.map(i => ({
      ...i,
      isOverdue: i.dueDate < todayStr && !["paid", "cancelled"].includes(i.status),
      isDueSoon: i.dueDate >= todayStr && i.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    }));

    // KPIs de cuotas
    const total = enriched.length;
    const paid = enriched.filter(i => i.status === "paid").length;
    const overdue = enriched.filter(i => i.status === "overdue" || (i.isOverdue && i.status !== "paid")).length;
    const pending = enriched.filter(i => i.status === "pending" || i.status === "due").length;
    const totalPaid = enriched.reduce((acc, i) => acc + parseFloat(i.paidAmount as string), 0);
    const totalAdjusted = enriched.reduce((acc, i) => acc + parseFloat(i.adjustedAmount as string), 0);

    res.json({
      installments: enriched,
      summary: { total, paid, overdue, pending, totalPaid, totalAdjusted, balance: totalAdjusted - totalPaid },
    });
  } catch (err) {
    logger.error({ err }, "installments list error");
    res.status(500).json({ error: "Error al cargar cuotas" });
  }
});

// ── POST /quotes/:id/installments/:installmentId/payments ────────────────────
router.post("/quotes/:id/installments/:installmentId/payments", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const quoteId = parseInt(req.params["id"] as string);
    const installmentId = parseInt(req.params["installmentId"] as string);
    if (isNaN(quoteId) || isNaN(installmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [quote] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (quote.status === "rejected") { res.status(400).json({ error: "No se puede cobrar un contrato rechazado" }); return; }

    const [installment] = await db.select().from(quoteInstallmentsTable)
      .where(and(eq(quoteInstallmentsTable.id, installmentId), eq(quoteInstallmentsTable.quoteId, quoteId)));
    if (!installment) { res.status(404).json({ error: "Cuota no encontrada" }); return; }
    if (installment.status === "paid") { res.status(400).json({ error: "La cuota ya está pagada" }); return; }
    if (installment.status === "cancelled") { res.status(400).json({ error: "La cuota está cancelada" }); return; }

    const { paymentDate, amount, currency, paymentMethod, reference, notes } = req.body;
    if (!paymentDate) { res.status(400).json({ error: "La fecha de pago es requerida" }); return; }
    if (!amount || parseFloat(amount) <= 0) { res.status(400).json({ error: "El importe debe ser mayor a 0" }); return; }

    const adjustedAmount = parseFloat(installment.adjustedAmount as string);
    const alreadyPaid = parseFloat(installment.paidAmount as string);
    const balance = adjustedAmount - alreadyPaid;

    if (parseFloat(amount) > balance + 0.01) {
      res.status(400).json({ error: `El importe (${amount}) supera el saldo de la cuota (${balance.toFixed(2)})` });
      return;
    }

    // Registrar el pago vinculado a la cuota
    const [payment] = await db.insert(quotePaymentsTable).values({
      quoteId,
      installmentId,
      clientId: quote.clientId,
      userId,
      paymentDate,
      amount: amount.toString(),
      currency: currency ?? quote.currency,
      paymentMethod: paymentMethod ?? "transferencia",
      reference: reference ?? null,
      notes: notes ?? null,
      createdBy: userId,
    }).returning();

    // Actualizar paidAmount y balanceDue de la cuota
    const newPaid = (alreadyPaid + parseFloat(amount)).toFixed(2);
    await db.update(quoteInstallmentsTable)
      .set({ paidAmount: newPaid })
      .where(eq(quoteInstallmentsTable.id, installmentId));

    // Recalcular estado de la cuota
    await recalcInstallmentStatus(installmentId);
    await recalcStatus(quoteId);

    await logActivity(quoteId, quote.clientId, userId, "installment_payment",
      `Cuota #${installment.installmentNumber} cobrada: ${amount} ${currency ?? quote.currency}`,
      { installmentId, installmentNumber: installment.installmentNumber, amount, paymentMethod });

    res.status(201).json(payment);
  } catch (err) {
    logger.error({ err }, "installment payment error");
    res.status(500).json({ error: "Error al registrar cobro de cuota" });
  }
});

// ── POST /quotes/:id/apply-adjustment ───────────────────────────────────────────
// Aplica ajuste IPC solo a cuotas futuras según la regla de integridad contable
router.post("/quotes/:id/apply-adjustment", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const id = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const [quote] = await db.select().from(quotesTable).where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (quote.quoteType !== "recurring_indexed") {
      res.status(400).json({ error: "Solo se puede ajustar contratos recurrentes" });
      return;
    }
    if (quote.status === "rejected" || quote.archivedAt) {
      res.status(400).json({ error: "No se puede ajustar un contrato inactivo" });
      return;
    }

    const { adjustmentRate, adjustmentDate, periodFrom, periodTo, notes, indexUsed = "ipc" } = req.body;

    if (!adjustmentRate || isNaN(parseFloat(adjustmentRate))) {
      res.status(400).json({ error: "La tasa de ajuste es requerida (ej: 0.034 para 3.4%)" });
      return;
    }
    if (!adjustmentDate) { res.status(400).json({ error: "La fecha efectiva del ajuste es requerida" }); return; }
    if (!periodFrom || !periodTo) { res.status(400).json({ error: "El período del índice (desde/hasta) es requerido" }); return; }

    const rate = parseFloat(adjustmentRate);
    if (rate <= -1) { res.status(400).json({ error: "La tasa no puede ser menor o igual a -100%" }); return; }

    // REGLA CRÍTICA: Solo actualizar cuotas donde:
    // - dueDate > adjustmentDate (cuotas futuras)
    // - status NOT IN (paid, overdue, partially_paid, cancelled)
    const futurePending = await db.select().from(quoteInstallmentsTable)
      .where(and(
        eq(quoteInstallmentsTable.quoteId, id),
        gt(quoteInstallmentsTable.dueDate, adjustmentDate),
        notInArray(quoteInstallmentsTable.status, ["paid", "overdue", "partially_paid", "cancelled"]),
      ));

    if (futurePending.length === 0) {
      res.status(400).json({ error: "No hay cuotas futuras pendientes para ajustar" });
      return;
    }

    // Calcular importe anterior (último adjustedAmount de las cuotas a ajustar)
    const previousBaseAmount = parseFloat(futurePending[0]!.adjustedAmount as string);
    const newBaseAmount = previousBaseAmount * (1 + rate);

    // Aplicar ajuste a cada cuota elegible
    for (const inst of futurePending) {
      const prev = parseFloat(inst.adjustedAmount as string);
      const newAdj = (prev * (1 + rate)).toFixed(2);
      const newBalance = (parseFloat(newAdj) - parseFloat(inst.paidAmount as string)).toFixed(2);

      await db.update(quoteInstallmentsTable)
        .set({
          adjustedAmount: newAdj,
          appliedAdjustmentRate: rate.toString(),
          balanceDue: newBalance,
        })
        .where(eq(quoteInstallmentsTable.id, inst.id));
    }

    // Actualizar nextAdjustmentDate y lastAdjustmentDate en el contrato
    const nextAdj = quote.adjustmentFrequency
      ? nextAdjDateFromFreq(new Date(adjustmentDate + "T00:00:00"), quote.adjustmentFrequency)
      : null;

    await db.update(quotesTable)
      .set({ lastAdjustmentDate: adjustmentDate, nextAdjustmentDate: nextAdj })
      .where(eq(quotesTable.id, id));

    // Registrar historial de ajuste
    const [adjustment] = await db.insert(quoteAdjustmentsTable).values({
      quoteId: id,
      adjustmentDate,
      periodFrom,
      periodTo,
      adjustmentRate: rate.toString(),
      indexUsed,
      previousBaseAmount: previousBaseAmount.toFixed(2),
      newBaseAmount: newBaseAmount.toFixed(2),
      installmentsAffected: futurePending.length,
      notes: notes ?? null,
      appliedBy: userId,
    }).returning();

    await logActivity(id, quote.clientId, userId, "ipc_adjustment",
      `Ajuste IPC ${(rate * 100).toFixed(2)}% aplicado a ${futurePending.length} cuota(s) futuras`,
      { adjustmentDate, rate, affectedCount: futurePending.length, periodFrom, periodTo });

    res.json({
      ok: true,
      adjustment,
      installmentsAffected: futurePending.length,
      previousBaseAmount,
      newBaseAmount,
    });
  } catch (err) {
    logger.error({ err }, "apply adjustment error");
    res.status(500).json({ error: "Error al aplicar ajuste" });
  }
});

export default router;
