import { Router, type IRouter } from "express";
import {
  eq, desc, asc, and, or, ilike, sql, lt, lte, gte, gt,
  inArray, isNull, ne, notInArray,
} from "drizzle-orm";
import { z } from "zod";
import {
  db,
  quotesTable,
  quoteItemsTable,
  quoteRevisionsTable,
  quotePaymentsTable,
  quoteActivityLogsTable,
  quoteInstallmentsTable,
  quoteAdjustmentsTable,
  clientsTable,
  type InsertQuote,
  type InsertQuoteItem,
  type InsertQuotePayment,
  type InsertQuoteInstallment,
} from "@workspace/db";
import { requireAuth, getCurrentUserId } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Constantes ─────────────────────────────────────────────────────────────────
const QUOTE_STATUSES    = ["draft","sent","approved","rejected","expired","paid","partially_paid","cancelled"] as const;
const QUOTE_TYPES       = ["single","recurring_indexed"] as const;
const BILLING_FREQS     = ["monthly","quarterly","semiannual","annual"] as const;
const INDEX_TYPES       = ["IPC","ICL","none"] as const;
const INSTALL_STATUSES  = ["pending","paid","partially_paid","overdue","cancelled","due"] as const;
const CURRENCIES        = ["ARS","USD","EUR"] as const;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

const AmountStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => !isNaN(parseFloat(v)), { message: "Monto inválido" });

const ListQuerySchema = z.object({
  clientId:      z.coerce.number().int().positive().optional(),
  status:        z.string().optional(),
  currency:      z.string().optional(),
  search:        z.string().max(200).optional(),
  quoteType:     z.enum(QUOTE_TYPES).optional(),
  issueDateFrom: DateString.optional(),
  issueDateTo:   DateString.optional(),
  dueDateFrom:   DateString.optional(),
  dueDateTo:     DateString.optional(),
  page:          z.coerce.number().int().min(1).optional().default(1),
  limit:         z.coerce.number().int().min(1).max(200).optional().default(50),
  sortBy:        z.enum(["dueDate","issueDate","totalAmount","status","client"]).optional().default("dueDate"),
  sortDir:       z.enum(["asc","desc"]).optional().default("asc"),
});

const QuoteItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity:    z.coerce.number().min(0),
  unitPrice:   AmountStr,
  sortOrder:   z.coerce.number().int().optional().default(0),
});

const QuoteCreateSchema = z.object({
  clientId:          z.coerce.number().int().positive(),
  title:             z.string().trim().min(1),
  quoteType:         z.enum(QUOTE_TYPES).optional().default("single"),
  currency:          z.string().optional().default("ARS"),
  subtotal:          AmountStr.optional(),
  taxAmount:         AmountStr.optional(),
  totalAmount:       AmountStr,
  notes:             z.string().optional().nullable(),
  issueDate:         DateString.optional(),
  dueDate:           DateString.optional().nullable(),
  validUntil:        DateString.optional().nullable(),
  // Contratos recurrentes
  billingFrequency:  z.enum(BILLING_FREQS).optional().nullable(),
  contractStartDate: DateString.optional().nullable(),
  contractEndDate:   DateString.optional().nullable(),
  indexType:         z.enum(INDEX_TYPES).optional().nullable(),
  items:             z.array(QuoteItemSchema).optional().default([]),
});

const QuoteUpdateSchema = QuoteCreateSchema.partial().omit({ items: true });

const PaymentCreateSchema = z.object({
  amount:        AmountStr,
  currency:      z.string().optional().default("ARS"),
  paymentDate:   DateString,
  paymentMethod: z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
});

const InstallmentPaySchema = z.object({
  amount:        AmountStr,
  currency:      z.string().optional().default("ARS"),
  paymentDate:   DateString,
  paymentMethod: z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
});

const AdjustmentSchema = z.object({
  indexType:  z.enum(["IPC","ICL"]),
  rate:       z.coerce.number().min(-100).max(1000),
  appliedAt:  DateString,
  notes:      z.string().optional().nullable(),
});

const ArchiveSchema = z.object({
  reason: z.string().optional().nullable(),
});

const KpiQuerySchema = z.object({
  currency: z.string().optional(),
  clientId: z.coerce.number().int().positive().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonthsDate(date: Date, months: number): Date {
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

async function generateQuoteNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(quotesTable)
    .where(and(eq(quotesTable.userId, userId), ilike(quotesTable.quoteNumber, `P${year}-%`)));
  const n = (Number(cnt ?? 0) + 1).toString().padStart(4, "0");
  return `P${year}-${n}`;
}

async function logActivity(
  quoteId: number,
  clientId: number,
  userId: string,
  actionType: string,
  description: string,
  metadata?: unknown,
): Promise<void> {
  await db.insert(quoteActivityLogsTable).values({
    quoteId, clientId, userId,
    actionType, description,
    metadataJson: metadata ?? null,
    performedBy: userId,
  });
}

async function recalcStatus(quoteId: number): Promise<void> {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!quote) return;
  if (quote.status === "rejected" || quote.archivedAt) return;

  if (quote.quoteType === "recurring_indexed") {
    await recalcRecurringStatus(quoteId);
    return;
  }

  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(amount), 0)` })
    .from(quotePaymentsTable)
    .where(eq(quotePaymentsTable.quoteId, quoteId));

  const paid    = parseFloat(total ?? "0");
  const total_  = parseFloat(quote.totalAmount as string);
  const balance = total_ - paid;

  let newStatus = quote.status;
  if (paid >= total_ && total_ > 0) {
    newStatus = "paid";
  } else if (paid > 0 && balance > 0) {
    newStatus = "partially_paid";
  } else if (paid === 0 && (quote.dueDate ?? "") < today()) {
    if (!["draft", "rejected", "paid"].includes(quote.status)) {
      newStatus = "expired";
    }
  }

  if (newStatus !== quote.status) {
    await db
      .update(quotesTable)
      .set({ status: newStatus })
      .where(eq(quotesTable.id, quoteId));
  }
}

async function recalcRecurringStatus(quoteId: number): Promise<void> {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!quote) return;

  const installments = await db
    .select()
    .from(quoteInstallmentsTable)
    .where(eq(quoteInstallmentsTable.quoteId, quoteId));
  if (!installments.length) return;

  const allPaid  = installments.every(
    (i) => i.status === "paid" || i.status === "cancelled",
  );
  const anyPartial = installments.some(
    (i) =>
      i.status === "partially_paid" ||
      (parseFloat(i.paidAmount as string) > 0 && i.status !== "paid"),
  );

  if (allPaid) {
    await db.update(quotesTable).set({ status: "paid" }).where(eq(quotesTable.id, quoteId));
  } else if (anyPartial) {
    await db.update(quotesTable).set({ status: "partially_paid" }).where(eq(quotesTable.id, quoteId));
  }
}

function generateInstallments(
  quoteId: number,
  contractStartDate: string,
  contractEndDate: string,
  billingFrequency: string,
  baseAmount: number,
): InsertQuoteInstallment[] {
  const installments: InsertQuoteInstallment[] = [];
  const stepMonths  = frequencyToMonths(billingFrequency);
  let periodStart   = new Date(contractStartDate + "T00:00:00");
  const end         = new Date(contractEndDate + "T00:00:00");
  let n = 1;

  while (periodStart < end) {
    const periodEnd       = addMonthsDate(periodStart, stepMonths);
    const actualPeriodEnd = periodEnd > end ? end : periodEnd;
    const dueDateObj      = new Date(actualPeriodEnd);
    dueDateObj.setDate(dueDateObj.getDate() - 1);
    const dueDate =
      dueDateObj < periodStart
        ? periodStart.toISOString().slice(0, 10)
        : dueDateObj.toISOString().slice(0, 10);

    installments.push({
      quoteId,
      installmentNumber: n,
      periodStart:  periodStart.toISOString().slice(0, 10),
      periodEnd:    actualPeriodEnd.toISOString().slice(0, 10),
      dueDate,
      baseAmount:           baseAmount.toString(),
      adjustedAmount:       baseAmount.toString(),
      appliedAdjustmentRate:"0",
      status:               "pending",
      paidAmount:           "0",
      balanceDue:           baseAmount.toString(),
    });

    n++;
    periodStart = periodEnd;
    if (periodStart >= end) break;
  }
  return installments;
}

function generateRollingInstallments(
  quoteId: number,
  fromDate: string,
  billingFrequency: string,
  currentAmount: number,
  monthsAhead: number,
  startN: number,
): InsertQuoteInstallment[] {
  const installments: InsertQuoteInstallment[] = [];
  const stepMonths = frequencyToMonths(billingFrequency);
  let periodStart  = new Date(fromDate + "T00:00:00");
  let n = startN;

  for (let i = 0; i < monthsAhead; i++) {
    const periodEnd  = addMonthsDate(periodStart, stepMonths);
    const dueDateObj = new Date(periodEnd);
    dueDateObj.setDate(dueDateObj.getDate() - 1);
    const dueDate =
      dueDateObj < periodStart
        ? periodStart.toISOString().slice(0, 10)
        : dueDateObj.toISOString().slice(0, 10);

    installments.push({
      quoteId,
      installmentNumber: n,
      periodStart:  periodStart.toISOString().slice(0, 10),
      periodEnd:    periodEnd.toISOString().slice(0, 10),
      dueDate,
      baseAmount:           currentAmount.toString(),
      adjustedAmount:       currentAmount.toString(),
      appliedAdjustmentRate:"0",
      status:               "pending",
      paidAmount:           "0",
      balanceDue:           currentAmount.toString(),
    });

    n++;
    periodStart = periodEnd;
  }
  return installments;
}

async function recalcInstallmentStatus(installmentId: number): Promise<void> {
  const [inst] = await db
    .select()
    .from(quoteInstallmentsTable)
    .where(eq(quoteInstallmentsTable.id, installmentId));
  if (!inst) return;

  const adjustedAmount = parseFloat(inst.adjustedAmount as string);
  const paidAmount     = parseFloat(inst.paidAmount as string);
  const balance        = adjustedAmount - paidAmount;
  const todayStr       = today();

  let newStatus = inst.status;
  if (paidAmount >= adjustedAmount && adjustedAmount > 0) {
    newStatus = "paid";
  } else if (paidAmount > 0 && balance > 0) {
    newStatus = "partially_paid";
  } else if (paidAmount === 0 && inst.dueDate < todayStr && inst.status === "pending") {
    newStatus = "overdue";
  } else if (paidAmount === 0 && inst.dueDate >= todayStr && inst.status === "overdue") {
    newStatus = "pending";
  }

  if (newStatus !== inst.status || balance.toString() !== (inst.balanceDue as string)) {
    await db
      .update(quoteInstallmentsTable)
      .set({ status: newStatus, balanceDue: balance.toString() })
      .where(eq(quoteInstallmentsTable.id, installmentId));
  }
}

export async function refreshInstallmentStatuses(userId?: string): Promise<void> {
  const todayStr = today();
  const cond = userId
    ? and(
        eq(quotesTable.userId, userId),
        eq(quoteInstallmentsTable.status, "pending"),
        lt(quoteInstallmentsTable.dueDate, todayStr),
      )
    : and(
        eq(quoteInstallmentsTable.status, "pending"),
        lt(quoteInstallmentsTable.dueDate, todayStr),
      );

  await db
    .update(quoteInstallmentsTable)
    .set({ status: "overdue" })
    .where(
      inArray(
        quoteInstallmentsTable.quoteId,
        db
          .select({ id: quotesTable.id })
          .from(quotesTable)
          .leftJoin(
            quoteInstallmentsTable,
            eq(quoteInstallmentsTable.quoteId, quotesTable.id),
          )
          .where(
            and(
              eq(quoteInstallmentsTable.status, "pending"),
              lt(quoteInstallmentsTable.dueDate, todayStr),
            ),
          ),
      ),
    );
}

async function getQuoteDetail(quoteId: number, userId: string) {
  const [quote] = await db
    .select({
      quote:        quotesTable,
      clientName:   clientsTable.name,
      clientCuit:   clientsTable.cuit,
      clientStatus: clientsTable.status,
    })
    .from(quotesTable)
    .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
    .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));

  if (!quote) return null;

  const [items, revisions, payments, activity, paidAgg, installments, adjustments] =
    await Promise.all([
      db.select().from(quoteItemsTable)
        .where(eq(quoteItemsTable.quoteId, quoteId))
        .orderBy(asc(quoteItemsTable.sortOrder)),
      db.select().from(quoteRevisionsTable)
        .where(eq(quoteRevisionsTable.quoteId, quoteId))
        .orderBy(desc(quoteRevisionsTable.changedAt)),
      db.select().from(quotePaymentsTable)
        .where(eq(quotePaymentsTable.quoteId, quoteId))
        .orderBy(desc(quotePaymentsTable.paymentDate)),
      db.select().from(quoteActivityLogsTable)
        .where(eq(quoteActivityLogsTable.quoteId, quoteId))
        .orderBy(desc(quoteActivityLogsTable.performedAt)),
      db.select({ total: sql<string>`coalesce(sum(amount), 0)` })
        .from(quotePaymentsTable)
        .where(eq(quotePaymentsTable.quoteId, quoteId)),
      db.select().from(quoteInstallmentsTable)
        .where(eq(quoteInstallmentsTable.quoteId, quoteId))
        .orderBy(asc(quoteInstallmentsTable.installmentNumber)),
      db.select().from(quoteAdjustmentsTable)
        .where(eq(quoteAdjustmentsTable.quoteId, quoteId))
        .orderBy(desc(quoteAdjustmentsTable.appliedAt)),
    ]);

  const totalPaid   = parseFloat(paidAgg[0]?.total ?? "0");
  const totalAmount = parseFloat(quote.quote.totalAmount as string);

  return {
    ...quote.quote,
    clientName:   quote.clientName,
    clientCuit:   quote.clientCuit,
    clientStatus: quote.clientStatus,
    items, revisions, payments, activity, installments, adjustments,
    totalPaid,
    balance: totalAmount - totalPaid,
  };
}

// ── GET /quotes ────────────────────────────────────────────────────────────────

router.get("/quotes", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query params inválidos" });
      return;
    }
    const {
      clientId, status, currency, search, quoteType,
      issueDateFrom, issueDateTo, dueDateFrom, dueDateTo,
      page, limit, sortBy, sortDir,
    } = q.data;

    const offset = (page - 1) * limit;
    const conditions = [eq(quotesTable.userId, userId)];

    if (clientId)      conditions.push(eq(quotesTable.clientId, clientId));
    if (quoteType)     conditions.push(eq(quotesTable.quoteType, quoteType));
    if (currency)      conditions.push(eq(quotesTable.currency, currency));
    if (issueDateFrom) conditions.push(gte(quotesTable.issueDate, issueDateFrom));
    if (issueDateTo)   conditions.push(lte(quotesTable.issueDate, issueDateTo));
    if (dueDateFrom)   conditions.push(gte(quotesTable.dueDate, dueDateFrom));
    if (dueDateTo)     conditions.push(lte(quotesTable.dueDate, dueDateTo));

    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(quotesTable.status, statuses[0]!));
      } else if (statuses.length > 1) {
        conditions.push(inArray(quotesTable.status, statuses));
      }
    }

    if (search) {
      conditions.push(
        or(
          ilike(quotesTable.quoteNumber, `%${search}%`),
          ilike(quotesTable.title, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
        )!,
      );
    }

    const where = and(...conditions);

    const sortCol = (() => {
      if (sortBy === "dueDate")     return sortDir === "desc" ? desc(quotesTable.dueDate)      : asc(quotesTable.dueDate);
      if (sortBy === "issueDate")   return sortDir === "desc" ? desc(quotesTable.issueDate)    : asc(quotesTable.issueDate);
      if (sortBy === "totalAmount") return sortDir === "desc" ? desc(quotesTable.totalAmount)  : asc(quotesTable.totalAmount);
      if (sortBy === "status")      return sortDir === "desc" ? desc(quotesTable.status)       : asc(quotesTable.status);
      if (sortBy === "client")      return sortDir === "desc" ? desc(clientsTable.name)        : asc(clientsTable.name);
      return asc(quotesTable.dueDate);
    })();

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id:               quotesTable.id,
          quoteNumber:      quotesTable.quoteNumber,
          clientId:         quotesTable.clientId,
          clientName:       clientsTable.name,
          title:            quotesTable.title,
          currency:         quotesTable.currency,
          issueDate:        quotesTable.issueDate,
          dueDate:          quotesTable.dueDate,
          totalAmount:      quotesTable.totalAmount,
          status:           quotesTable.status,
          version:          quotesTable.version,
          quoteType:        quotesTable.quoteType,
          contractStartDate: quotesTable.contractStartDate,
          contractEndDate:  quotesTable.contractEndDate,
          billingFrequency: quotesTable.billingFrequency,
          nextAdjustmentDate: quotesTable.nextAdjustmentDate,
          archivedAt:       quotesTable.archivedAt,
          createdAt:        quotesTable.createdAt,
          totalPaid: sql<string>`coalesce((select sum(p.amount) from quote_payments p where p.quote_id = ${quotesTable.id}), 0)`,
          lastPaymentDate: sql<string | null>`(select max(p.payment_date) from quote_payments p where p.quote_id = ${quotesTable.id})`,
          installmentsTotal:   sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id})`,
          installmentsPending: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id} and qi.status in ('pending','due'))`,
          installmentsOverdue: sql<number>`(select count(*) from quote_installments qi where qi.quote_id = ${quotesTable.id} and qi.status = 'overdue')`,
        })
        .from(quotesTable)
        .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
        .where(where)
        .orderBy(sortCol)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(quotesTable)
        .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
        .where(where),
    ]);

    res.json({
      data: rows.map((r) => ({
        ...r,
        totalPaid: parseFloat(r.totalPaid ?? "0"),
        balance:   parseFloat(r.totalAmount as string) - parseFloat(r.totalPaid ?? "0"),
      })),
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, "quotes list error");
    res.status(500).json({ error: "Error al cargar presupuestos" });
  }
});

// ── GET /quotes/kpis ───────────────────────────────────────────────────────────

router.get("/quotes/kpis", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const q = KpiQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query inválida" });
      return;
    }
    const { currency, clientId } = q.data;

    const conditions = [eq(quotesTable.userId, userId)];
    if (currency) conditions.push(eq(quotesTable.currency, currency));
    if (clientId) conditions.push(eq(quotesTable.clientId, clientId));

    const where    = and(...conditions);
    const todayStr = today();
    const monthStart  = todayStr.slice(0, 7) + "-01";
    const in30daysStr = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const [[kpis], [mesRows], [instKpis]] = await Promise.all([
      db
        .select({
          totalPresupuestado:   sql<string>`coalesce(sum(total_amount), 0)`,
          totalCobrado:         sql<string>`coalesce((select sum(p.amount) from quote_payments p join quotes q2 on p.quote_id = q2.id where q2.user_id = ${userId} ${currency ? sql`and q2.currency = ${currency}` : sql``}), 0)`,
          cantidadPresupuestos: sql<number>`count(*)`,
          cantidadVencidos:     sql<number>`count(*) filter (where status = 'expired' or (due_date < ${todayStr} and status not in ('paid','rejected') and archived_at is null))`,
          cantidadPendientes:   sql<number>`count(*) filter (where status in ('draft','sent','approved') and archived_at is null)`,
          cantidadParciales:    sql<number>`count(*) filter (where status = 'partially_paid' and archived_at is null)`,
          cantidadPagados:      sql<number>`count(*) filter (where status = 'paid')`,
          contratosActivos:     sql<number>`count(*) filter (where quote_type = 'recurring_indexed' and status in ('approved','partially_paid') and archived_at is null and contract_end_date >= ${todayStr})`,
          contratosProxVencer:  sql<number>`count(*) filter (where quote_type = 'recurring_indexed' and contract_end_date >= ${todayStr} and contract_end_date <= ${in30daysStr} and archived_at is null)`,
        })
        .from(quotesTable)
        .where(where),
      db
        .select({ total: sql<string>`coalesce(sum(p.amount), 0)` })
        .from(quotePaymentsTable)
        .leftJoin(quotesTable, eq(quotePaymentsTable.quoteId, quotesTable.id))
        .where(
          and(
            eq(quotePaymentsTable.userId, userId),
            gte(quotePaymentsTable.paymentDate, monthStart),
            currency ? eq(quotePaymentsTable.currency, currency) : sql`true`,
          ),
        ),
      db
        .select({
          cuotasPendientes: sql<number>`count(*) filter (where qi.status in ('pending','due'))`,
          cuotasVencidas:   sql<number>`count(*) filter (where qi.status = 'overdue')`,
          cuotasParciales:  sql<number>`count(*) filter (where qi.status = 'partially_paid')`,
          ingresosProyMes:  sql<string>`coalesce(sum(qi.adjusted_amount) filter (where qi.due_date >= ${monthStart} and qi.due_date < ${in30daysStr} and qi.status not in ('paid','cancelled')), 0)`,
          proximoAjuste:    sql<string | null>`min(q.next_adjustment_date) filter (where q.next_adjustment_date is not null and q.next_adjustment_date >= ${todayStr} and q.quote_type = 'recurring_indexed')`,
        })
        .from(quoteInstallmentsTable)
        .leftJoin(
          quotesTable,
          and(eq(quoteInstallmentsTable.quoteId, quotesTable.id), eq(quotesTable.userId, userId)),
        ),
    ]);

    const totalPresupuestado = parseFloat(kpis?.totalPresupuestado ?? "0");
    const totalCobrado       = parseFloat(kpis?.totalCobrado ?? "0");
    const cobranzasMes       = parseFloat(mesRows?.total ?? "0");
    const tasaCobro          = totalPresupuestado > 0 ? (totalCobrado / totalPresupuestado) * 100 : 0;

    res.json({
      totalPresupuestado,
      totalCobrado,
      saldoPendiente:      totalPresupuestado - totalCobrado,
      cantidadPresupuestos:Number(kpis?.cantidadPresupuestos ?? 0),
      cantidadVencidos:    Number(kpis?.cantidadVencidos ?? 0),
      cantidadPendientes:  Number(kpis?.cantidadPendientes ?? 0),
      cantidadParciales:   Number(kpis?.cantidadParciales ?? 0),
      cantidadPagados:     Number(kpis?.cantidadPagados ?? 0),
      cobranzasMes,
      tasaCobro:           Math.round(tasaCobro * 10) / 10,
      contratosActivos:    Number(kpis?.contratosActivos ?? 0),
      contratosProxVencer: Number(kpis?.contratosProxVencer ?? 0),
      cuotasPendientes:    Number(instKpis?.cuotasPendientes ?? 0),
      cuotasVencidas:      Number(instKpis?.cuotasVencidas ?? 0),
      cuotasParciales:     Number(instKpis?.cuotasParciales ?? 0),
      ingresosProyMes:     parseFloat(instKpis?.ingresosProyMes ?? "0"),
      proximoAjuste:       instKpis?.proximoAjuste ?? null,
    });
  } catch (err) {
    logger.error({ err }, "quotes kpis error");
    res.status(500).json({ error: "Error al cargar KPIs" });
  }
});

// ── GET /quotes/dashboard-data ────────────────────────────────────────────────

router.get("/quotes/dashboard-data", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);

    const [cobranzasMensuales, porEstado, topClients] = await Promise.all([
      db
        .select({
          mes:      sql<string>`to_char(payment_date::date, 'YYYY-MM')`,
          total:    sql<string>`sum(amount)`,
          cantidad: sql<number>`count(*)`,
        })
        .from(quotePaymentsTable)
        .where(
          and(
            eq(quotePaymentsTable.userId, userId),
            gte(quotePaymentsTable.paymentDate, sql`(current_date - interval '12 months')::text`),
          ),
        )
        .groupBy(sql`to_char(payment_date::date, 'YYYY-MM')`)
        .orderBy(sql`to_char(payment_date::date, 'YYYY-MM')`),
      db
        .select({
          status:   quotesTable.status,
          cantidad: sql<number>`count(*)`,
          total:    sql<string>`sum(total_amount)`,
        })
        .from(quotesTable)
        .where(eq(quotesTable.userId, userId))
        .groupBy(quotesTable.status),
      db
        .select({
          clientId:   quotesTable.clientId,
          clientName: clientsTable.name,
          total:      sql<string>`sum(total_amount)`,
          cantidad:   sql<number>`count(*)`,
        })
        .from(quotesTable)
        .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
        .where(eq(quotesTable.userId, userId))
        .groupBy(quotesTable.clientId, clientsTable.name)
        .orderBy(desc(sql`sum(total_amount)`))
        .limit(5),
    ]);

    res.json({ cobranzasMensuales, porEstado, topClients });
  } catch (err) {
    logger.error({ err }, "quotes dashboard-data error");
    res.status(500).json({ error: "Error al cargar datos del dashboard" });
  }
});

// ── GET /quotes/:id ────────────────────────────────────────────────────────────

router.get("/quotes/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const detail = await getQuoteDetail(id, userId);
    if (!detail) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    res.json(detail);
  } catch (err) {
    logger.error({ err }, "quote detail error");
    res.status(500).json({ error: "Error al cargar presupuesto" });
  }
});

// ── POST /quotes ───────────────────────────────────────────────────────────────

router.post("/quotes", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = QuoteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const { items, ...quoteData } = parsed.data;

    const quoteNumber = await generateQuoteNumber(userId);

    const [quote] = await db
      .insert(quotesTable)
      .values({
        ...quoteData,
        userId,
        quoteNumber,
        issueDate: quoteData.issueDate ?? today(),
        status: "draft",
        version: 1,
      })
      .returning();

    // Insertar items en bulk si los hay
    if (items.length > 0) {
      await db.insert(quoteItemsTable).values(
        items.map((item) => ({
          ...item,
          quoteId:  quote.id,
          total:    String(parseFloat(item.unitPrice) * item.quantity),
        })),
      );
    }

    // Generar cuotas para contratos recurrentes con fechas de inicio y fin
    if (
      quote.quoteType === "recurring_indexed" &&
      quote.contractStartDate &&
      quote.contractEndDate &&
      quote.billingFrequency
    ) {
      const installments = generateInstallments(
        quote.id,
        quote.contractStartDate,
        quote.contractEndDate,
        quote.billingFrequency,
        parseFloat(quote.totalAmount as string),
      );
      if (installments.length > 0) {
        await db.insert(quoteInstallmentsTable).values(installments);
      }
    }

    await logActivity(
      quote.id, quote.clientId, userId,
      "created", `Presupuesto ${quoteNumber} creado`,
    );

    const detail = await getQuoteDetail(quote.id, userId);
    res.status(201).json(detail);
  } catch (err) {
    logger.error({ err }, "quote create error");
    res.status(500).json({ error: "Error al crear presupuesto" });
  }
});

// ── PUT /quotes/:id ────────────────────────────────────────────────────────────

router.put("/quotes/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = QuoteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [updated] = await db
      .update(quotesTable)
      .set({ ...parsed.data, version: (existing.version ?? 1) + 1 })
      .where(eq(quotesTable.id, id))
      .returning();

    await logActivity(id, updated.clientId, userId, "updated", "Presupuesto actualizado");
    const detail = await getQuoteDetail(id, userId);
    res.json(detail);
  } catch (err) {
    logger.error({ err }, "quote update error");
    res.status(500).json({ error: "Error al actualizar presupuesto" });
  }
});

// ── DELETE /quotes/:id ────────────────────────────────────────────────────────

router.delete("/quotes/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    // Eliminar dependientes en paralelo
    await Promise.all([
      db.delete(quoteItemsTable).where(eq(quoteItemsTable.quoteId, id)),
      db.delete(quotePaymentsTable).where(eq(quotePaymentsTable.quoteId, id)),
      db.delete(quoteInstallmentsTable).where(eq(quoteInstallmentsTable.quoteId, id)),
      db.delete(quoteAdjustmentsTable).where(eq(quoteAdjustmentsTable.quoteId, id)),
      db.delete(quoteRevisionsTable).where(eq(quoteRevisionsTable.quoteId, id)),
      db.delete(quoteActivityLogsTable).where(eq(quoteActivityLogsTable.quoteId, id)),
    ]);
    await db.delete(quotesTable).where(eq(quotesTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "quote delete error");
    res.status(500).json({ error: "Error al eliminar presupuesto" });
  }
});

// ── POST /quotes/:id/payments ─────────────────────────────────────────────────

router.post("/quotes/:id/payments", requireAuth, async (req, res): Promise<void> => {
  try {
    const quoteId = Number(req.params["id"]);
    if (!Number.isInteger(quoteId) || quoteId <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = PaymentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [quote] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [payment] = await db
      .insert(quotePaymentsTable)
      .values({ ...parsed.data, quoteId, userId })
      .returning();

    await recalcStatus(quoteId);
    await logActivity(
      quoteId, quote.clientId, userId,
      "payment_added", `Cobro registrado: $${parsed.data.amount}`,
      { amount: parsed.data.amount },
    );

    res.status(201).json(payment);
  } catch (err) {
    logger.error({ err }, "quote payment create error");
    res.status(500).json({ error: "Error al registrar cobro" });
  }
});

// ── DELETE /quotes/:id/payments/:paymentId ────────────────────────────────────

router.delete("/quotes/:id/payments/:paymentId", requireAuth, async (req, res): Promise<void> => {
  try {
    const quoteId    = Number(req.params["id"]);
    const paymentId  = Number(req.params["paymentId"]);
    if (!Number.isInteger(quoteId) || quoteId <= 0 || !Number.isInteger(paymentId) || paymentId <= 0) {
      res.status(400).json({ error: "ID inválido" }); return;
    }

    const userId = getCurrentUserId(req);
    const [quote] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    await db.delete(quotePaymentsTable).where(eq(quotePaymentsTable.id, paymentId));
    await recalcStatus(quoteId);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "quote payment delete error");
    res.status(500).json({ error: "Error al eliminar cobro" });
  }
});

// ── POST /quotes/:id/installments/:instId/pay ─────────────────────────────────

router.post("/quotes/:id/installments/:instId/pay", requireAuth, async (req, res): Promise<void> => {
  try {
    const quoteId = Number(req.params["id"]);
    const instId  = Number(req.params["instId"]);
    if (!Number.isInteger(quoteId) || !Number.isInteger(instId)) {
      res.status(400).json({ error: "ID inválido" }); return;
    }

    const parsed = InstallmentPaySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [quote] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [inst] = await db
      .select()
      .from(quoteInstallmentsTable)
      .where(eq(quoteInstallmentsTable.id, instId));
    if (!inst) { res.status(404).json({ error: "Cuota no encontrada" }); return; }

    const newPaid = parseFloat(inst.paidAmount as string) + parseFloat(parsed.data.amount);
    await db
      .update(quoteInstallmentsTable)
      .set({ paidAmount: String(newPaid) })
      .where(eq(quoteInstallmentsTable.id, instId));

    await recalcInstallmentStatus(instId);
    await recalcRecurringStatus(quoteId);

    await logActivity(
      quoteId, quote.clientId, userId,
      "installment_paid", `Cuota #${inst.installmentNumber} cobrada: $${parsed.data.amount}`,
      { installmentId: instId, amount: parsed.data.amount },
    );

    const [updated] = await db
      .select()
      .from(quoteInstallmentsTable)
      .where(eq(quoteInstallmentsTable.id, instId));
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "installment pay error");
    res.status(500).json({ error: "Error al registrar cobro de cuota" });
  }
});

// ── POST /quotes/:id/apply-adjustment ─────────────────────────────────────────

router.post("/quotes/:id/apply-adjustment", requireAuth, async (req, res): Promise<void> => {
  try {
    const quoteId = Number(req.params["id"]);
    if (!Number.isInteger(quoteId) || quoteId <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = AdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const userId = getCurrentUserId(req);
    const [quote] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.userId, userId)));
    if (!quote) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (quote.quoteType !== "recurring_indexed") {
      res.status(400).json({ error: "Solo los contratos recurrentes admiten ajuste de índice" });
      return;
    }

    const { rate, indexType, appliedAt, notes } = parsed.data;
    const multiplier = 1 + rate / 100;

    // Solo ajustar cuotas futuras pendientes (nunca vencidas, pagas ni parciales)
    const pendingInstallments = await db
      .select()
      .from(quoteInstallmentsTable)
      .where(
        and(
          eq(quoteInstallmentsTable.quoteId, quoteId),
          eq(quoteInstallmentsTable.status, "pending"),
          gte(quoteInstallmentsTable.dueDate, today()),
        ),
      );

    for (const inst of pendingInstallments) {
      const newAmount = parseFloat(inst.adjustedAmount as string) * multiplier;
      await db
        .update(quoteInstallmentsTable)
        .set({
          adjustedAmount:        String(newAmount),
          appliedAdjustmentRate: String(rate),
          balanceDue:            String(newAmount - parseFloat(inst.paidAmount as string)),
        })
        .where(eq(quoteInstallmentsTable.id, inst.id));
    }

    const [adjustment] = await db
      .insert(quoteAdjustmentsTable)
      .values({
        quoteId, indexType, rate: String(rate),
        appliedAt, appliedBy: userId, notes: notes ?? null,
      })
      .returning();

    // Actualizar fecha del próximo ajuste en el quote
    const nextAdjDate = new Date(appliedAt + "T00:00:00");
    nextAdjDate.setMonth(
      nextAdjDate.getMonth() + frequencyToMonths(quote.billingFrequency ?? "monthly"),
    );
    await db
      .update(quotesTable)
      .set({ nextAdjustmentDate: nextAdjDate.toISOString().slice(0, 10) })
      .where(eq(quotesTable.id, quoteId));

    await logActivity(
      quoteId, quote.clientId, userId,
      "adjustment_applied",
      `Ajuste ${indexType} ${rate > 0 ? "+" : ""}${rate}% aplicado a ${pendingInstallments.length} cuotas`,
      { indexType, rate, affectedInstallments: pendingInstallments.length },
    );

    res.json({ ok: true, adjustment, affectedInstallments: pendingInstallments.length });
  } catch (err) {
    logger.error({ err }, "quote apply-adjustment error");
    res.status(500).json({ error: "Error al aplicar ajuste de índice" });
  }
});

// ── POST /quotes/:id/archive / restore ────────────────────────────────────────

router.post("/quotes/:id/archive", requireAuth, async (req, res): Promise<void> => {
  try {
    const id     = Number(req.params["id"]);
    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [updated] = await db
      .update(quotesTable)
      .set({ archivedAt: today() })
      .where(eq(quotesTable.id, id))
      .returning();

    await logActivity(id, existing.clientId, userId, "archived", "Presupuesto archivado");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "quote archive error");
    res.status(500).json({ error: "Error al archivar presupuesto" });
  }
});

router.post("/quotes/:id/restore", requireAuth, async (req, res): Promise<void> => {
  try {
    const id     = Number(req.params["id"]);
    const userId = getCurrentUserId(req);
    const [existing] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }

    const [updated] = await db
      .update(quotesTable)
      .set({ archivedAt: null })
      .where(eq(quotesTable.id, id))
      .returning();

    await logActivity(id, existing.clientId, userId, "restored", "Presupuesto restaurado");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "quote restore error");
    res.status(500).json({ error: "Error al restaurar presupuesto" });
  }
});

// ── GET /quotes/client/:clientId ──────────────────────────────────────────────

router.get("/quotes/client/:clientId", requireAuth, async (req, res): Promise<void> => {
  try {
    const clientId = Number(req.params["clientId"]);
    if (!Number.isInteger(clientId) || clientId <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

    const userId = getCurrentUserId(req);

    const [quotes, installments] = await Promise.all([
      db
        .select()
        .from(quotesTable)
        .where(
          and(eq(quotesTable.userId, userId), eq(quotesTable.clientId, clientId)),
        )
        .orderBy(desc(quotesTable.createdAt)),
      db
        .select({
          inst:       quoteInstallmentsTable,
          quoteNumber: quotesTable.quoteNumber,
        })
        .from(quoteInstallmentsTable)
        .leftJoin(quotesTable, eq(quoteInstallmentsTable.quoteId, quotesTable.id))
        .where(
          and(
            eq(quotesTable.userId, userId),
            eq(quotesTable.clientId, clientId),
          ),
        )
        .orderBy(asc(quoteInstallmentsTable.dueDate)),
    ]);

    res.json({ quotes, installments: installments.map((r) => ({ ...r.inst, quoteNumber: r.quoteNumber })) });
  } catch (err) {
    logger.error({ err }, "quotes by client error");
    res.status(500).json({ error: "Error al cargar presupuestos del cliente" });
  }
});

export default router;
