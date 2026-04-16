import { Router, type IRouter, Request, Response } from "express";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import {
  db,
  financeAccountsTable,
  financeConfigTable,
  financeCategoriesTable,
  financeTransactionsTable,
  financeRecurringRulesTable,
} from "@workspace/db";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_ACCOUNT_TYPES = ["caja", "banco", "billetera_virtual", "tarjeta", "cripto", "inversiones", "deuda"] as const;
const VALID_TX_TYPES = ["income", "expense"] as const;
const VALID_FREQUENCIES = ["weekly", "monthly", "annual"] as const;

const DEFAULT_INCOME_CATEGORIES = [
  { type: "income", name: "Sueldo",     icon: "briefcase",    color: "#10b981", sortOrder: 0 },
  { type: "income", name: "Clientes",   icon: "users",        color: "#3b82f6", sortOrder: 1 },
  { type: "income", name: "Ventas",     icon: "tag",          color: "#8b5cf6", sortOrder: 2 },
  { type: "income", name: "Extras",     icon: "star",         color: "#f59e0b", sortOrder: 3 },
  { type: "income", name: "Reintegros", icon: "rotate-ccw",   color: "#06b6d4", sortOrder: 4 },
  { type: "income", name: "Otros",      icon: "circle",       color: "#6b7280", sortOrder: 5 },
];
const DEFAULT_EXPENSE_CATEGORIES = [
  { type: "expense", name: "Hogar",          icon: "home",          color: "#ef4444", sortOrder: 0 },
  { type: "expense", name: "Servicios",      icon: "zap",           color: "#f97316", sortOrder: 1 },
  { type: "expense", name: "Supermercado",   icon: "shopping-cart", color: "#eab308", sortOrder: 2 },
  { type: "expense", name: "Transporte",     icon: "car",           color: "#84cc16", sortOrder: 3 },
  { type: "expense", name: "Salud",          icon: "heart",         color: "#ec4899", sortOrder: 4 },
  { type: "expense", name: "Educación",      icon: "book-open",     color: "#8b5cf6", sortOrder: 5 },
  { type: "expense", name: "Hijos",          icon: "baby",          color: "#f59e0b", sortOrder: 6 },
  { type: "expense", name: "Mascotas",       icon: "paw-print",     color: "#78716c", sortOrder: 7 },
  { type: "expense", name: "Salidas",        icon: "coffee",        color: "#14b8a6", sortOrder: 8 },
  { type: "expense", name: "Ropa",           icon: "shirt",         color: "#a78bfa", sortOrder: 9 },
  { type: "expense", name: "Impuestos",      icon: "file-text",     color: "#64748b", sortOrder: 10 },
  { type: "expense", name: "Suscripciones",  icon: "repeat",        color: "#06b6d4", sortOrder: 11 },
  { type: "expense", name: "Otros",          icon: "circle",        color: "#6b7280", sortOrder: 12 },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// FIX: use COUNT instead of SELECT * to check existence
async function ensureDefaultCategories(userId: string) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(financeCategoriesTable)
    .where(eq(financeCategoriesTable.userId, userId));
  if (Number(count) > 0) return;
  const defaults = [...DEFAULT_INCOME_CATEGORIES, ...DEFAULT_EXPENSE_CATEGORIES].map(c => ({
    ...c, userId, isDefault: true,
  }));
  await db.insert(financeCategoriesTable).values(defaults);
}

// FIX: calculate the actual last day of the month
function monthRange(dateStr: string): { start: string; end: string } {
  const [yr, mo] = dateStr.split("-");
  const start = `${yr}-${mo}-01`;
  const lastDay = new Date(parseInt(yr, 10), parseInt(mo, 10), 0).getDate();
  const end = `${yr}-${mo}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// Helper: apply account balance delta (positive = add, negative = subtract)
async function applyAccountDelta(accountId: number, delta: number) {
  const [acct] = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.id, accountId));
  if (acct) {
    const newAmount = parseFloat(acct.amount ?? "0") + delta;
    await db.update(financeAccountsTable)
      .set({ amount: String(newAmount) })
      .where(eq(financeAccountsTable.id, accountId));
  }
}

// ───── CATEGORIES ─────────────────────────────────────────────────────────

router.get("/finance/categories", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    await ensureDefaultCategories(userId);
    const cats = await db.select().from(financeCategoriesTable)
      .where(eq(financeCategoriesTable.userId, userId))
      .orderBy(financeCategoriesTable.type, financeCategoriesTable.sortOrder);
    res.json(cats);
  } catch (err) { logger.error({ err }, "finance categories fetch"); res.status(500).json({ error: "Error al cargar categorías" }); }
});

router.post("/finance/categories", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { type, name, icon, color } = req.body ?? {};
  if (!type || !name || !VALID_TX_TYPES.includes(type)) { res.status(400).json({ error: "type y name son requeridos" }); return; }
  try {
    const [cat] = await db.insert(financeCategoriesTable).values({
      userId, type, name, icon: icon ?? "circle", color: color ?? "#6b7280", isDefault: false,
    }).returning();
    res.status(201).json(cat);
  } catch (err) { logger.error({ err }, "finance category create"); res.status(500).json({ error: "Error al crear categoría" }); }
});

router.delete("/finance/categories/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (existing.userId && !assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeCategoriesTable).where(eq(financeCategoriesTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance category delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ───── TRANSACTIONS ────────────────────────────────────────────────────────

router.get("/finance/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { type, categoryId, accountId, status, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const conditions = [eq(financeTransactionsTable.userId, userId)];
    if (type && VALID_TX_TYPES.includes(type as any)) conditions.push(eq(financeTransactionsTable.type, type));
    if (categoryId) conditions.push(eq(financeTransactionsTable.categoryId, parseInt(categoryId, 10)));
    if (accountId) conditions.push(eq(financeTransactionsTable.accountId, parseInt(accountId, 10)));
    if (status) conditions.push(eq(financeTransactionsTable.status, status));
    if (from) conditions.push(gte(financeTransactionsTable.date, from));
    if (to) conditions.push(lte(financeTransactionsTable.date, to));
    const [transactions, [{ count }]] = await Promise.all([
      db.select().from(financeTransactionsTable).where(and(...conditions))
        .orderBy(desc(financeTransactionsTable.date), desc(financeTransactionsTable.id))
        .limit(parseInt(limit, 10)).offset(parseInt(offset, 10)),
      db.select({ count: sql<number>`count(*)` }).from(financeTransactionsTable).where(and(...conditions)),
    ]);
    res.json({ transactions, total: Number(count) });
  } catch (err) { logger.error({ err }, "finance transactions fetch"); res.status(500).json({ error: "Error al cargar movimientos" }); }
});

router.post("/finance/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { type, amount, currency, categoryId, accountId, date, status, paymentMethod, notes, isFixed, isRecurring, recurringRuleId } = req.body ?? {};
  if (!type || !VALID_TX_TYPES.includes(type) || !amount || !date) {
    res.status(400).json({ error: "type, amount y date son requeridos" }); return;
  }
  try {
    const [tx] = await db.insert(financeTransactionsTable).values({
      userId, type, amount: String(amount), currency: currency ?? "ARS",
      categoryId: categoryId ? parseInt(categoryId, 10) : null,
      accountId: accountId ? parseInt(accountId, 10) : null,
      date: date as string, status: status ?? "confirmed",
      paymentMethod: paymentMethod ?? null, notes: notes ?? null,
      isFixed: Boolean(isFixed), isRecurring: Boolean(isRecurring),
      recurringRuleId: recurringRuleId ? parseInt(recurringRuleId, 10) : null,
    }).returning();
    // Update account balance only for confirmed transactions
    const resolvedStatus = status ?? "confirmed";
    if (accountId && resolvedStatus === "confirmed") {
      const delta = type === "income" ? parseFloat(amount) : -parseFloat(amount);
      await applyAccountDelta(parseInt(accountId, 10), delta);
    }
    res.status(201).json(tx);
  } catch (err) { logger.error({ err }, "finance transaction create"); res.status(500).json({ error: "Error al crear movimiento" }); }
});

router.put("/finance/transactions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeTransactionsTable).where(eq(financeTransactionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const { type, amount, currency, categoryId, accountId, date, status, paymentMethod, notes, isFixed, isRecurring } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (type && VALID_TX_TYPES.includes(type)) updates.type = type;
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    if (categoryId !== undefined) updates.categoryId = categoryId ? parseInt(categoryId, 10) : null;
    if (accountId !== undefined) updates.accountId = accountId ? parseInt(accountId, 10) : null;
    if (date) updates.date = date;
    if (status) updates.status = status;
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
    if (notes !== undefined) updates.notes = notes;
    if (isFixed !== undefined) updates.isFixed = Boolean(isFixed);
    if (isRecurring !== undefined) updates.isRecurring = Boolean(isRecurring);

    // FIX: account balance reversal when status changes confirmed <-> other
    const prevStatus = existing.status;
    const nextStatus = (updates.status as string | undefined) ?? prevStatus;
    const prevAccountId = existing.accountId;
    const nextAccountId = (updates.accountId as number | null | undefined) !== undefined
      ? (updates.accountId as number | null) : prevAccountId;
    const prevAmount = parseFloat(existing.amount);
    const nextAmount = updates.amount !== undefined ? parseFloat(updates.amount as string) : prevAmount;
    const prevType = existing.type;
    const nextType = (updates.type as string | undefined) ?? prevType;

    // Reverse previous confirmed impact
    if (prevStatus === "confirmed" && prevAccountId) {
      const reverseDelta = prevType === "income" ? -prevAmount : prevAmount;
      await applyAccountDelta(prevAccountId, reverseDelta);
    }
    // Apply new confirmed impact
    if (nextStatus === "confirmed" && nextAccountId) {
      const applyDelta = nextType === "income" ? nextAmount : -nextAmount;
      await applyAccountDelta(nextAccountId, applyDelta);
    }

    const [updated] = await db.update(financeTransactionsTable).set(updates as any).where(eq(financeTransactionsTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance transaction update"); res.status(500).json({ error: "Error al actualizar" }); }
});

router.delete("/finance/transactions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeTransactionsTable).where(eq(financeTransactionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    // FIX: reverse account balance before deleting
    if (existing.accountId && existing.status === "confirmed") {
      const reverseDelta = existing.type === "income"
        ? -parseFloat(existing.amount)
        : parseFloat(existing.amount);
      await applyAccountDelta(existing.accountId, reverseDelta);
    }

    await db.delete(financeTransactionsTable).where(eq(financeTransactionsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance transaction delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ───── RECURRING RULES ─────────────────────────────────────────────────────

router.get("/finance/recurring-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const rules = await db.select().from(financeRecurringRulesTable)
      .where(eq(financeRecurringRulesTable.userId, userId))
      .orderBy(financeRecurringRulesTable.nextDate);
    res.json(rules);
  } catch (err) { logger.error({ err }, "finance recurring rules fetch"); res.status(500).json({ error: "Error al cargar reglas" }); }
});

router.post("/finance/recurring-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { name, type, amount, currency, categoryId, accountId, frequency, dayOfMonth, nextDate, notes } = req.body ?? {};
  if (!name || !type || !amount || !frequency || !VALID_FREQUENCIES.includes(frequency)) {
    res.status(400).json({ error: "Campos obligatorios faltantes" }); return;
  }
  try {
    const [rule] = await db.insert(financeRecurringRulesTable).values({
      userId, name, type, amount: String(amount), currency: currency ?? "ARS",
      categoryId: categoryId ? parseInt(categoryId, 10) : null,
      accountId: accountId ? parseInt(accountId, 10) : null,
      frequency, dayOfMonth: dayOfMonth ? parseInt(dayOfMonth, 10) : null,
      nextDate: nextDate ?? todayStr(), isActive: true, notes: notes ?? null,
    }).returning();
    res.status(201).json(rule);
  } catch (err) { logger.error({ err }, "finance recurring rule create"); res.status(500).json({ error: "Error al crear regla" }); }
});

router.put("/finance/recurring-rules/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { name, type, amount, currency, categoryId, accountId, frequency, dayOfMonth, nextDate, isActive, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (type) updates.type = type;
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    if (categoryId !== undefined) updates.categoryId = categoryId ? parseInt(categoryId, 10) : null;
    if (accountId !== undefined) updates.accountId = accountId ? parseInt(accountId, 10) : null;
    if (frequency) updates.frequency = frequency;
    if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth ? parseInt(dayOfMonth, 10) : null;
    if (nextDate) updates.nextDate = nextDate;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeRecurringRulesTable).set(updates as any).where(eq(financeRecurringRulesTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance recurring rule update"); res.status(500).json({ error: "Error al actualizar" }); }
});

router.delete("/finance/recurring-rules/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance recurring rule delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ───── SUMMARY ─────────────────────────────────────────────────────────────

router.get("/finance/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    await ensureDefaultCategories(userId);

    const today = todayStr();
    const { start: monthStart, end: monthEnd } = monthRange(today);
    const next30 = addDays(today, 30);

    // FIX: use SQL SUM aggregates instead of fetching all rows and reducing in JS
    const [
      [incomeSumRow],
      [expenseSumRow],
      accounts,
      rules,
      cats,
      recent,
    ] = await Promise.all([
      db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable)
        .where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "income"),
          gte(financeTransactionsTable.date, monthStart),
          lte(financeTransactionsTable.date, monthEnd),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )),
      db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable)
        .where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, monthStart),
          lte(financeTransactionsTable.date, monthEnd),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )),
      db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)),
      db.select().from(financeRecurringRulesTable)
        .where(and(eq(financeRecurringRulesTable.userId, userId), eq(financeRecurringRulesTable.isActive, true)))
        .orderBy(financeRecurringRulesTable.nextDate),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
      db.select().from(financeTransactionsTable)
        .where(eq(financeTransactionsTable.userId, userId))
        .orderBy(desc(financeTransactionsTable.date), desc(financeTransactionsTable.id))
        .limit(8),
    ]);

    const confirmedIncome = parseFloat(incomeSumRow.total ?? "0");
    const confirmedExpense = parseFloat(expenseSumRow.total ?? "0");
    const totalAssets = accounts.filter(a => a.type !== "deuda").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
    const totalDebt = accounts.filter(a => a.type === "deuda").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);

    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };

    // Category spending breakdown for the month (expense only)
    const monthExpenses = await db.select({
      categoryId: financeTransactionsTable.categoryId,
      total: sql<string>`coalesce(sum(amount::numeric), 0)`,
    })
      .from(financeTransactionsTable)
      .where(and(
        eq(financeTransactionsTable.userId, userId),
        eq(financeTransactionsTable.type, "expense"),
        gte(financeTransactionsTable.date, monthStart),
        lte(financeTransactionsTable.date, monthEnd),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
      ))
      .groupBy(financeTransactionsTable.categoryId);

    const categoryBreakdown = monthExpenses
      .map(row => ({
        categoryId: row.categoryId,
        name: row.categoryId ? catMap[row.categoryId]?.name ?? "Sin categoría" : "Sin categoría",
        color: row.categoryId ? catMap[row.categoryId]?.color ?? "#6b7280" : "#6b7280",
        total: parseFloat(row.total ?? "0"),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    const upcomingRecurrences = rules
      .filter(r => r.nextDate && r.nextDate <= next30).slice(0, 10)
      .map(r => ({
        id: r.id, name: r.name, type: r.type,
        amount: parseFloat(r.amount), frequency: r.frequency, nextDate: r.nextDate,
        category: r.categoryId ? catMap[r.categoryId] ?? null : null,
      }));

    // FIX: estimated balance = current disponible + remaining recurrences this month
    const expectedExpenses = rules
      .filter(r => r.type === "expense" && r.nextDate && r.nextDate <= monthEnd && r.nextDate >= today)
      .reduce((s, r) => s + parseFloat(r.amount), 0);
    const expectedIncome = rules
      .filter(r => r.type === "income" && r.nextDate && r.nextDate <= monthEnd && r.nextDate >= today)
      .reduce((s, r) => s + parseFloat(r.amount), 0);
    // Saldo estimado fin de mes = ingresos confirmados + esperados - gastos confirmados - esperados
    const saldoEstimadoFinMes = confirmedIncome + expectedIncome - confirmedExpense - expectedExpenses;

    const recentWithCat = recent.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      category: t.categoryId ? catMap[t.categoryId] ?? null : null,
    }));

    // FIX: smarter, less noisy alerts
    const alerts: { level: "green" | "yellow" | "red"; message: string }[] = [];
    const savingsRate = confirmedIncome > 0 ? (confirmedIncome - confirmedExpense) / confirmedIncome : null;
    if (savingsRate !== null) {
      if (savingsRate < 0) alerts.push({ level: "red", message: "Los gastos superan los ingresos del mes" });
      else if (savingsRate < 0.1) alerts.push({ level: "yellow", message: `Ahorro bajo: ${Math.round(savingsRate * 100)}% de ingresos` });
      else alerts.push({ level: "green", message: `Ahorro del mes: ${Math.round(savingsRate * 100)}% de ingresos` });
    }
    if (totalDebt > 0 && totalAssets > 0 && totalDebt > totalAssets * 0.5) {
      alerts.push({ level: "red", message: "La deuda supera el 50% de tus activos" });
    }
    const overdueRules = rules.filter(r => r.nextDate && r.nextDate < today);
    if (overdueRules.length > 0) {
      alerts.push({ level: "yellow", message: `${overdueRules.length} recurrencia${overdueRules.length > 1 ? "s" : ""} vencida${overdueRules.length > 1 ? "s" : ""} sin ejecutar` });
    }

    res.json({
      ingresosMes: confirmedIncome,
      gastosMes: confirmedExpense,
      saldoEstimadoFinMes,
      saldoDisponible: totalAssets - totalDebt,
      activos: totalAssets,
      deudas: totalDebt,
      accounts,
      upcomingRecurrences,
      recentTransactions: recentWithCat,
      categoryBreakdown,
      alerts,
      hasData: recent.length > 0 || accounts.length > 0,
    });
  } catch (err) { logger.error({ err }, "finance summary error"); res.status(500).json({ error: "Error al cargar resumen" }); }
});

// ───── ACCOUNTS ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<string, string> = {
  gasto_mensual_umbral: "500000",
  liquidez_minima: "100000",
  alerta_deuda_umbral: "1000000",
};
async function ensureDefaultConfig() {
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    const [existing] = await db.select().from(financeConfigTable).where(eq(financeConfigTable.key, key));
    if (!existing) await db.insert(financeConfigTable).values({ key, value });
  }
}

router.get("/finance/accounts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const accounts = await db.select().from(financeAccountsTable)
      .where(eq(financeAccountsTable.userId, userId))
      .orderBy(financeAccountsTable.createdAt);
    res.json(accounts);
  } catch (err) { logger.error({ err }, "finance accounts fetch"); res.status(500).json({ error: "Error al cargar cuentas" }); }
});

router.post("/finance/accounts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { type, label, amount, currency, notes } = req.body ?? {};
  if (!type || !VALID_ACCOUNT_TYPES.includes(type as any) || !label) {
    res.status(400).json({ error: "type y label son requeridos" }); return;
  }
  try {
    const [account] = await db.insert(financeAccountsTable).values({
      userId, type, label, amount: String(amount ?? 0), currency: currency ?? "ARS", notes: notes ?? null,
    }).returning();
    res.status(201).json(account);
  } catch (err) { logger.error({ err }, "finance account create"); res.status(500).json({ error: "Error al crear cuenta" }); }
});

router.put("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { type, label, amount, currency, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (type && VALID_ACCOUNT_TYPES.includes(type as any)) updates.type = type;
    if (label) updates.label = label;
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeAccountsTable).set(updates as any).where(eq(financeAccountsTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance account update"); res.status(500).json({ error: "Error al actualizar cuenta" }); }
});

router.delete("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeAccountsTable).where(eq(financeAccountsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance account delete"); res.status(500).json({ error: "Error al eliminar cuenta" }); }
});

router.get("/finance/config", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureDefaultConfig();
    const config = await db.select().from(financeConfigTable);
    const configMap: Record<string, string> = {};
    for (const c of config) configMap[c.key] = c.value;
    res.json(configMap);
  } catch (err) { logger.error({ err }, "finance config fetch"); res.status(500).json({ error: "Error al cargar configuración" }); }
});

router.put("/finance/config/:key", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key as string;
  const { value } = req.body ?? {};
  if (!value) { res.status(400).json({ error: "value es requerido" }); return; }
  try {
    const [existing] = await db.select().from(financeConfigTable).where(eq(financeConfigTable.key, key));
    if (existing) await db.update(financeConfigTable).set({ value: String(value) }).where(eq(financeConfigTable.key, key));
    else await db.insert(financeConfigTable).values({ key, value: String(value) });
    res.json({ key, value });
  } catch (err) { logger.error({ err }, "finance config update"); res.status(500).json({ error: "Error al guardar configuración" }); }
});

// ───── SEED DEMO ───────────────────────────────────────────────────────────

router.post("/finance/seed-demo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  try {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(financeTransactionsTable).where(eq(financeTransactionsTable.userId, userId));
    if (Number(count) > 0) { res.json({ ok: true, skipped: true, message: "Ya hay datos cargados" }); return; }

    await ensureDefaultCategories(userId);
    const cats = await db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId));
    const catByName = Object.fromEntries(cats.map(c => [c.name, c.id]));

    const existingAccts = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId));
    let bancoId: number, billeteraId: number;
    if (existingAccts.length === 0) {
      const [b] = await db.insert(financeAccountsTable).values({
        userId, type: "banco", label: "Cuenta Bancaria Principal", amount: "0", currency: "ARS",
      }).returning();
      const [bv] = await db.insert(financeAccountsTable).values({
        userId, type: "billetera_virtual", label: "Mercado Pago", amount: "0", currency: "ARS",
      }).returning();
      bancoId = b.id; billeteraId = bv.id;
    } else {
      bancoId = existingAccts[0].id; billeteraId = existingAccts[1]?.id ?? existingAccts[0].id;
    }

    const today = todayStr();
    const [ty, tm] = today.split("-");
    const d = (n: number, monthOffset = 0) => {
      const mo = parseInt(tm, 10) + monthOffset;
      const yr = mo <= 0 ? parseInt(ty, 10) - 1 : parseInt(ty, 10);
      const realMo = mo <= 0 ? mo + 12 : mo;
      return `${yr}-${String(realMo).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    };

    const txRows = [
      { type: "income",  amount: "850000", categoryId: catByName["Sueldo"],       accountId: bancoId,    date: d(1),  status: "confirmed", notes: "Sueldo del mes",         isFixed: true,  isRecurring: true },
      { type: "income",  amount: "120000", categoryId: catByName["Clientes"],      accountId: bancoId,    date: d(5),  status: "confirmed", notes: "Consultoría cliente A",  isFixed: false, isRecurring: false },
      { type: "income",  amount: "75000",  categoryId: catByName["Clientes"],      accountId: billeteraId,date: d(8),  status: "confirmed", notes: "Asesoramiento contable", isFixed: false, isRecurring: false },
      { type: "income",  amount: "200000", categoryId: catByName["Extras"],        accountId: bancoId,    date: d(20), status: "expected",  notes: "Bonus esperado",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "45000",  categoryId: catByName["Hogar"],         accountId: bancoId,    date: d(2),  status: "confirmed", notes: "Expensas",               isFixed: true,  isRecurring: true },
      { type: "expense", amount: "18500",  categoryId: catByName["Servicios"],     accountId: billeteraId,date: d(3),  status: "confirmed", notes: "Electricidad + gas",     isFixed: false, isRecurring: true },
      { type: "expense", amount: "67000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    date: d(6),  status: "confirmed", notes: "Compra semanal",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "32000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    date: d(13), status: "confirmed", notes: "Compra semanal",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "8500",   categoryId: catByName["Transporte"],    accountId: billeteraId,date: d(7),  status: "confirmed", notes: "SUBE + nafta",           isFixed: false, isRecurring: false },
      { type: "expense", amount: "15000",  categoryId: catByName["Salidas"],       accountId: billeteraId,date: d(9),  status: "confirmed", notes: "Restaurante",            isFixed: false, isRecurring: false },
      { type: "expense", amount: "4800",   categoryId: catByName["Suscripciones"], accountId: billeteraId,date: d(1),  status: "confirmed", notes: "Netflix + Spotify",      isFixed: true,  isRecurring: true },
      { type: "expense", amount: "28000",  categoryId: catByName["Salud"],         accountId: bancoId,    date: d(10), status: "pending",   notes: "Prepaga",                isFixed: true,  isRecurring: true },
      { type: "expense", amount: "12000",  categoryId: catByName["Salidas"],       accountId: billeteraId,date: d(14), status: "confirmed", notes: "Cine + cena",            isFixed: false, isRecurring: false },
      { type: "income",  amount: "850000", categoryId: catByName["Sueldo"],        accountId: bancoId,    date: d(1,  -1), status: "confirmed", notes: "Sueldo mes anterior", isFixed: true, isRecurring: true },
      { type: "expense", amount: "44000",  categoryId: catByName["Hogar"],         accountId: bancoId,    date: d(2,  -1), status: "confirmed", notes: "Expensas",            isFixed: true, isRecurring: true },
      { type: "expense", amount: "71000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    date: d(15, -1), status: "confirmed", notes: "Compra quincenal",    isFixed: false, isRecurring: false },
    ];
    await db.insert(financeTransactionsTable).values(txRows.map(t => ({ ...t, userId, currency: "ARS" })));

    // Recalculate account balances from seed data (confirmed transactions only)
    let bancoDelta = 0, billeteraDelta = 0;
    for (const t of txRows) {
      if (t.status !== "confirmed") continue;
      const delta = t.type === "income" ? parseFloat(t.amount) : -parseFloat(t.amount);
      if (t.accountId === bancoId) bancoDelta += delta;
      else billeteraDelta += delta;
    }
    await db.update(financeAccountsTable).set({ amount: String(bancoDelta) }).where(eq(financeAccountsTable.id, bancoId));
    await db.update(financeAccountsTable).set({ amount: String(billeteraDelta) }).where(eq(financeAccountsTable.id, billeteraId));

    const ruleRows = [
      { name: "Sueldo mensual",    type: "income",  amount: "850000", categoryId: catByName["Sueldo"],       accountId: bancoId,    frequency: "monthly", dayOfMonth: 1,  nextDate: addMonths(d(1), 1) },
      { name: "Expensas",          type: "expense", amount: "45000",  categoryId: catByName["Hogar"],        accountId: bancoId,    frequency: "monthly", dayOfMonth: 2,  nextDate: addMonths(d(2), 1) },
      { name: "Servicios",         type: "expense", amount: "18500",  categoryId: catByName["Servicios"],    accountId: billeteraId,frequency: "monthly", dayOfMonth: 3,  nextDate: addMonths(d(3), 1) },
      { name: "Netflix + Spotify", type: "expense", amount: "4800",   categoryId: catByName["Suscripciones"],accountId: billeteraId,frequency: "monthly", dayOfMonth: 1,  nextDate: addMonths(d(1), 1) },
      { name: "Prepaga",           type: "expense", amount: "28000",  categoryId: catByName["Salud"],        accountId: bancoId,    frequency: "monthly", dayOfMonth: 10, nextDate: addMonths(d(10), 1) },
    ];
    await db.insert(financeRecurringRulesTable).values(ruleRows.map(r => ({ ...r, userId, currency: "ARS", isActive: true })));

    res.json({ ok: true, skipped: false, message: "Datos demo cargados exitosamente" });
  } catch (err) { logger.error({ err }, "finance seed demo"); res.status(500).json({ error: "Error al cargar datos demo" }); }
});

export default router;
