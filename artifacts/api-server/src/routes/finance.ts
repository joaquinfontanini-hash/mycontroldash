import { Router, type IRouter, Request, Response } from "express";
import { eq, desc, and, gte, lte, sql, isNull } from "drizzle-orm";
import {
  db,
  financeAccountsTable,
  financeConfigTable,
  financeCategoriesTable,
  financeTransactionsTable,
  financeRecurringRulesTable,
  financeCardsTable,
  financeInstallmentPlansTable,
  financeLoansTable,
  financeBudgetsTable,
  financeGoalsTable,
} from "@workspace/db";
import { requireAuth, assertOwnership, getCurrentUserId } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_ACCOUNT_TYPES = ["caja", "banco", "billetera_virtual", "tarjeta", "cripto", "inversiones", "deuda"] as const;
const VALID_TX_TYPES = ["income", "expense"] as const;
const VALID_FREQUENCIES = ["weekly", "monthly", "annual"] as const;
const VALID_LOAN_STATUSES = ["active", "paid", "defaulted"] as const;

// ─── DEFAULT CATEGORIES ────────────────────────────────────────────────────

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
  { type: "expense", name: "Tarjetas",       icon: "credit-card",   color: "#f43f5e", sortOrder: 12 },
  { type: "expense", name: "Préstamos",      icon: "landmark",      color: "#0ea5e9", sortOrder: 13 },
  { type: "expense", name: "Otros",          icon: "circle",        color: "#6b7280", sortOrder: 14 },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────

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

function monthRange(dateStr: string): { start: string; end: string } {
  const [yr, mo] = dateStr.split("-");
  const start = `${yr}-${mo}-01`;
  const lastDay = new Date(parseInt(yr, 10), parseInt(mo, 10), 0).getDate();
  const end = `${yr}-${mo}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// Given a day-of-month, compute the next occurrence date >= referenceDate
function nextOccurrenceDate(day: number, referenceDate: string): string {
  const [yr, mo] = referenceDate.split("-").map(Number);
  const candidate = `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (candidate >= referenceDate) return candidate;
  // Next month
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextYr = mo === 12 ? yr + 1 : yr;
  return `${nextYr}-${String(nextMo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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

async function applyAccountDelta(accountId: number, delta: number) {
  const [acct] = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.id, accountId));
  if (acct) {
    const newAmount = parseFloat(acct.amount ?? "0") + delta;
    await db.update(financeAccountsTable)
      .set({ amount: String(newAmount) })
      .where(eq(financeAccountsTable.id, accountId));
  }
}

// ─── CATEGORIES ────────────────────────────────────────────────────────────

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

// ─── TRANSACTIONS ──────────────────────────────────────────────────────────

router.get("/finance/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { type, categoryId, accountId, cardId, status, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const conditions = [eq(financeTransactionsTable.userId, userId)];
    if (type && VALID_TX_TYPES.includes(type as any)) conditions.push(eq(financeTransactionsTable.type, type));
    if (categoryId) conditions.push(eq(financeTransactionsTable.categoryId, parseInt(categoryId, 10)));
    if (accountId) conditions.push(eq(financeTransactionsTable.accountId, parseInt(accountId, 10)));
    if (cardId) conditions.push(eq(financeTransactionsTable.cardId, parseInt(cardId, 10)));
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
  const { type, amount, currency, categoryId, accountId, cardId, installmentPlanId, date, status, paymentMethod, notes, isFixed, isRecurring, recurringRuleId } = req.body ?? {};
  if (!type || !VALID_TX_TYPES.includes(type) || !amount || !date) {
    res.status(400).json({ error: "type, amount y date son requeridos" }); return;
  }
  try {
    const [tx] = await db.insert(financeTransactionsTable).values({
      userId, type, amount: String(amount), currency: currency ?? "ARS",
      categoryId: categoryId ? parseInt(categoryId, 10) : null,
      accountId: accountId ? parseInt(accountId, 10) : null,
      cardId: cardId ? parseInt(cardId, 10) : null,
      installmentPlanId: installmentPlanId ? parseInt(installmentPlanId, 10) : null,
      date: date as string, status: status ?? "confirmed",
      paymentMethod: paymentMethod ?? null, notes: notes ?? null,
      isFixed: Boolean(isFixed), isRecurring: Boolean(isRecurring),
      recurringRuleId: recurringRuleId ? parseInt(recurringRuleId, 10) : null,
    }).returning();
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

    const { type, amount, currency, categoryId, accountId, cardId, installmentPlanId, date, status, paymentMethod, notes, isFixed, isRecurring } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (type && VALID_TX_TYPES.includes(type)) updates.type = type;
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    if (categoryId !== undefined) updates.categoryId = categoryId ? parseInt(categoryId, 10) : null;
    if (accountId !== undefined) updates.accountId = accountId ? parseInt(accountId, 10) : null;
    if (cardId !== undefined) updates.cardId = cardId ? parseInt(cardId, 10) : null;
    if (installmentPlanId !== undefined) updates.installmentPlanId = installmentPlanId ? parseInt(installmentPlanId, 10) : null;
    if (date) updates.date = date;
    if (status) updates.status = status;
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
    if (notes !== undefined) updates.notes = notes;
    if (isFixed !== undefined) updates.isFixed = Boolean(isFixed);
    if (isRecurring !== undefined) updates.isRecurring = Boolean(isRecurring);

    const prevStatus = existing.status;
    const nextStatus = (updates.status as string | undefined) ?? prevStatus;
    const prevAccountId = existing.accountId;
    const nextAccountId = (updates.accountId as number | null | undefined) !== undefined
      ? (updates.accountId as number | null) : prevAccountId;
    const prevAmount = parseFloat(existing.amount);
    const nextAmount = updates.amount !== undefined ? parseFloat(updates.amount as string) : prevAmount;
    const prevType = existing.type;
    const nextType = (updates.type as string | undefined) ?? prevType;

    if (prevStatus === "confirmed" && prevAccountId) {
      const reverseDelta = prevType === "income" ? -prevAmount : prevAmount;
      await applyAccountDelta(prevAccountId, reverseDelta);
    }
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
    if (existing.accountId && existing.status === "confirmed") {
      const reverseDelta = existing.type === "income" ? -parseFloat(existing.amount) : parseFloat(existing.amount);
      await applyAccountDelta(existing.accountId, reverseDelta);
    }
    await db.delete(financeTransactionsTable).where(eq(financeTransactionsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance transaction delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ─── RECURRING RULES ───────────────────────────────────────────────────────

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

// ─── CARDS ─────────────────────────────────────────────────────────────────

router.get("/finance/cards", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const cards = await db.select().from(financeCardsTable)
      .where(eq(financeCardsTable.userId, userId))
      .orderBy(financeCardsTable.createdAt);
    res.json(cards);
  } catch (err) { logger.error({ err }, "finance cards fetch"); res.status(500).json({ error: "Error al cargar tarjetas" }); }
});

router.post("/finance/cards", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { name, bank, lastFour, color, closeDay, dueDay, creditLimit, currency, notes } = req.body ?? {};
  if (!name || !closeDay || !dueDay) { res.status(400).json({ error: "name, closeDay y dueDay son requeridos" }); return; }
  try {
    const [card] = await db.insert(financeCardsTable).values({
      userId, name, bank: bank ?? null, lastFour: lastFour ?? null,
      color: color ?? "#6366f1",
      closeDay: parseInt(closeDay, 10), dueDay: parseInt(dueDay, 10),
      creditLimit: creditLimit ? String(creditLimit) : null,
      currency: currency ?? "ARS", isActive: true, notes: notes ?? null,
    }).returning();
    res.status(201).json(card);
  } catch (err) { logger.error({ err }, "finance card create"); res.status(500).json({ error: "Error al crear tarjeta" }); }
});

router.put("/finance/cards/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeCardsTable).where(eq(financeCardsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tarjeta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { name, bank, lastFour, color, closeDay, dueDay, creditLimit, currency, isActive, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (bank !== undefined) updates.bank = bank;
    if (lastFour !== undefined) updates.lastFour = lastFour;
    if (color) updates.color = color;
    if (closeDay) updates.closeDay = parseInt(closeDay, 10);
    if (dueDay) updates.dueDay = parseInt(dueDay, 10);
    if (creditLimit !== undefined) updates.creditLimit = creditLimit ? String(creditLimit) : null;
    if (currency) updates.currency = currency;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeCardsTable).set(updates as any).where(eq(financeCardsTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance card update"); res.status(500).json({ error: "Error al actualizar tarjeta" }); }
});

router.delete("/finance/cards/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeCardsTable).where(eq(financeCardsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tarjeta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeCardsTable).where(eq(financeCardsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance card delete"); res.status(500).json({ error: "Error al eliminar tarjeta" }); }
});

// Summary for a specific card (spending in current period)
router.get("/finance/cards/:id/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [card] = await db.select().from(financeCardsTable).where(eq(financeCardsTable.id, id));
    if (!card || !assertOwnership(req, res, card.userId)) return;
    const today = todayStr();
    // Current billing period: from last closeDay to today
    const [yr, mo] = today.split("-").map(Number);
    const lastCloseMo = card.closeDay >= parseInt(today.slice(8), 10) ? (mo === 1 ? 12 : mo - 1) : mo;
    const lastCloseYr = lastCloseMo === 12 && mo === 1 ? yr - 1 : yr;
    const periodStart = `${lastCloseYr}-${String(lastCloseMo).padStart(2, "0")}-${String(card.closeDay).padStart(2, "0")}`;
    const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
      .from(financeTransactionsTable)
      .where(and(
        eq(financeTransactionsTable.cardId, id),
        eq(financeTransactionsTable.type, "expense"),
        gte(financeTransactionsTable.date, periodStart),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
      ));
    const nextDueDate = nextOccurrenceDate(card.dueDay, today);
    const nextCloseDate = nextOccurrenceDate(card.closeDay, today);
    res.json({ periodStart, totalSpent: parseFloat(total ?? "0"), nextDueDate, nextCloseDate });
  } catch (err) { logger.error({ err }, "finance card summary"); res.status(500).json({ error: "Error" }); }
});

// ─── INSTALLMENT PLANS ─────────────────────────────────────────────────────

router.get("/finance/installment-plans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const plans = await db.select().from(financeInstallmentPlansTable)
      .where(eq(financeInstallmentPlansTable.userId, userId))
      .orderBy(financeInstallmentPlansTable.nextDueDate);
    res.json(plans);
  } catch (err) { logger.error({ err }, "finance installment plans fetch"); res.status(500).json({ error: "Error al cargar cuotas" }); }
});

router.post("/finance/installment-plans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { description, totalAmount, installmentAmount, totalInstallments, paidInstallments, startDate, nextDueDate, cardId, categoryId, currency, notes } = req.body ?? {};
  if (!description || !totalAmount || !installmentAmount || !totalInstallments || !startDate) {
    res.status(400).json({ error: "description, totalAmount, installmentAmount, totalInstallments y startDate son requeridos" }); return;
  }
  try {
    const [plan] = await db.insert(financeInstallmentPlansTable).values({
      userId, description,
      totalAmount: String(totalAmount),
      installmentAmount: String(installmentAmount),
      totalInstallments: parseInt(totalInstallments, 10),
      paidInstallments: paidInstallments ? parseInt(paidInstallments, 10) : 0,
      startDate, nextDueDate: nextDueDate ?? null,
      cardId: cardId ? parseInt(cardId, 10) : null,
      categoryId: categoryId ? parseInt(categoryId, 10) : null,
      currency: currency ?? "ARS", isActive: true, notes: notes ?? null,
    }).returning();
    res.status(201).json(plan);
  } catch (err) { logger.error({ err }, "finance installment plan create"); res.status(500).json({ error: "Error al crear plan de cuotas" }); }
});

router.put("/finance/installment-plans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeInstallmentPlansTable).where(eq(financeInstallmentPlansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Plan no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { description, totalAmount, installmentAmount, totalInstallments, paidInstallments, startDate, nextDueDate, cardId, categoryId, currency, isActive, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (description) updates.description = description;
    if (totalAmount !== undefined) updates.totalAmount = String(totalAmount);
    if (installmentAmount !== undefined) updates.installmentAmount = String(installmentAmount);
    if (totalInstallments !== undefined) updates.totalInstallments = parseInt(totalInstallments, 10);
    if (paidInstallments !== undefined) updates.paidInstallments = parseInt(paidInstallments, 10);
    if (startDate) updates.startDate = startDate;
    if (nextDueDate !== undefined) updates.nextDueDate = nextDueDate;
    if (cardId !== undefined) updates.cardId = cardId ? parseInt(cardId, 10) : null;
    if (categoryId !== undefined) updates.categoryId = categoryId ? parseInt(categoryId, 10) : null;
    if (currency) updates.currency = currency;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeInstallmentPlansTable).set(updates as any).where(eq(financeInstallmentPlansTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance installment plan update"); res.status(500).json({ error: "Error al actualizar" }); }
});

router.delete("/finance/installment-plans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeInstallmentPlansTable).where(eq(financeInstallmentPlansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Plan no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeInstallmentPlansTable).where(eq(financeInstallmentPlansTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance installment plan delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ─── LOANS ─────────────────────────────────────────────────────────────────

router.get("/finance/loans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const loans = await db.select().from(financeLoansTable)
      .where(eq(financeLoansTable.userId, userId))
      .orderBy(financeLoansTable.nextDueDate);
    res.json(loans);
  } catch (err) { logger.error({ err }, "finance loans fetch"); res.status(500).json({ error: "Error al cargar préstamos" }); }
});

router.post("/finance/loans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { name, creditor, totalAmount, totalInstallments, installmentAmount, paidInstallments, startDate, nextDueDate, status, currency, notes } = req.body ?? {};
  if (!name || !totalAmount || !totalInstallments || !installmentAmount || !startDate) {
    res.status(400).json({ error: "name, totalAmount, totalInstallments, installmentAmount y startDate son requeridos" }); return;
  }
  try {
    const [loan] = await db.insert(financeLoansTable).values({
      userId, name, creditor: creditor ?? null,
      totalAmount: String(totalAmount),
      totalInstallments: parseInt(totalInstallments, 10),
      installmentAmount: String(installmentAmount),
      paidInstallments: paidInstallments ? parseInt(paidInstallments, 10) : 0,
      startDate, nextDueDate: nextDueDate ?? null,
      status: status ?? "active",
      currency: currency ?? "ARS", notes: notes ?? null,
    }).returning();
    res.status(201).json(loan);
  } catch (err) { logger.error({ err }, "finance loan create"); res.status(500).json({ error: "Error al crear préstamo" }); }
});

router.put("/finance/loans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeLoansTable).where(eq(financeLoansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Préstamo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { name, creditor, totalAmount, totalInstallments, installmentAmount, paidInstallments, startDate, nextDueDate, status, currency, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (creditor !== undefined) updates.creditor = creditor;
    if (totalAmount !== undefined) updates.totalAmount = String(totalAmount);
    if (totalInstallments !== undefined) updates.totalInstallments = parseInt(totalInstallments, 10);
    if (installmentAmount !== undefined) updates.installmentAmount = String(installmentAmount);
    if (paidInstallments !== undefined) updates.paidInstallments = parseInt(paidInstallments, 10);
    if (startDate) updates.startDate = startDate;
    if (nextDueDate !== undefined) updates.nextDueDate = nextDueDate;
    if (status && VALID_LOAN_STATUSES.includes(status)) updates.status = status;
    if (currency) updates.currency = currency;
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeLoansTable).set(updates as any).where(eq(financeLoansTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance loan update"); res.status(500).json({ error: "Error al actualizar" }); }
});

router.delete("/finance/loans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeLoansTable).where(eq(financeLoansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Préstamo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeLoansTable).where(eq(financeLoansTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance loan delete"); res.status(500).json({ error: "Error al eliminar" }); }
});

// ─── SUMMARY ───────────────────────────────────────────────────────────────

router.get("/finance/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    await ensureDefaultCategories(userId);

    const today = todayStr();
    const { start: monthStart, end: monthEnd } = monthRange(today);
    const next30 = addDays(today, 30);

    const [
      [incomeSumRow],
      [expenseSumRow],
      accounts,
      rules,
      cats,
      recent,
      cards,
      installmentPlans,
      loans,
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
      db.select().from(financeCardsTable)
        .where(and(eq(financeCardsTable.userId, userId), eq(financeCardsTable.isActive, true))),
      db.select().from(financeInstallmentPlansTable)
        .where(and(eq(financeInstallmentPlansTable.userId, userId), eq(financeInstallmentPlansTable.isActive, true))),
      db.select().from(financeLoansTable)
        .where(and(eq(financeLoansTable.userId, userId), eq(financeLoansTable.status, "active"))),
    ]);

    const confirmedIncome = parseFloat(incomeSumRow.total ?? "0");
    const confirmedExpense = parseFloat(expenseSumRow.total ?? "0");
    const totalAssets = accounts.filter(a => a.type !== "deuda").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
    const totalDebt = accounts.filter(a => a.type === "deuda").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
    const saldoDisponible = totalAssets - totalDebt;

    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };
    const cardMap: Record<number, typeof cards[0]> = {};
    for (const c of cards) cardMap[c.id] = c;

    // ── Upcoming recurrences (next 30 days) ──
    const upcomingRecurrences = rules
      .filter(r => r.nextDate && r.nextDate <= next30).slice(0, 10)
      .map(r => ({
        id: r.id, name: r.name, type: r.type,
        amount: parseFloat(r.amount), frequency: r.frequency, nextDate: r.nextDate,
        category: r.categoryId ? catMap[r.categoryId] ?? null : null,
      }));

    // ── Card summaries with current cycle spending ──
    const cardSummaries = await Promise.all(cards.map(async card => {
      const [yr, mo] = today.split("-").map(Number);
      const todayDay = parseInt(today.slice(8), 10);
      const lastCloseMo = card.closeDay >= todayDay ? (mo === 1 ? 12 : mo - 1) : mo;
      const lastCloseYr = lastCloseMo === 12 && mo === 1 ? yr - 1 : yr;
      const periodStart = `${lastCloseYr}-${String(lastCloseMo).padStart(2, "0")}-${String(card.closeDay).padStart(2, "0")}`;
      const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable)
        .where(and(
          eq(financeTransactionsTable.cardId, card.id),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, periodStart),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        ));
      const nextDueDate = nextOccurrenceDate(card.dueDay, today);
      const nextCloseDate = nextOccurrenceDate(card.closeDay, today);
      const activePlans = installmentPlans.filter(p => p.cardId === card.id);
      const pendingInstallments = activePlans.reduce((s, p) => {
        const remaining = p.totalInstallments - p.paidInstallments;
        return s + (remaining > 0 ? parseFloat(p.installmentAmount) : 0);
      }, 0);
      return {
        ...card,
        totalSpent: parseFloat(total ?? "0"),
        pendingInstallments,
        nextDueDate,
        nextCloseDate,
        isClosingSoon: nextCloseDate <= addDays(today, 7),
        isDueSoon: nextDueDate <= addDays(today, 7),
      };
    }));

    // ── Compromisos del mes ──
    const recurringCommitments = rules
      .filter(r => r.type === "expense" && r.nextDate && r.nextDate >= today && r.nextDate <= monthEnd)
      .reduce((s, r) => s + parseFloat(r.amount), 0);
    const installmentCommitments = installmentPlans
      .filter(p => p.paidInstallments < p.totalInstallments)
      .reduce((s, p) => s + parseFloat(p.installmentAmount), 0);
    const loanCommitments = loans
      .filter(l => l.paidInstallments < l.totalInstallments)
      .reduce((s, l) => s + parseFloat(l.installmentAmount), 0);
    const totalComprometido = recurringCommitments + installmentCommitments + loanCommitments;
    const saldoLibre = saldoDisponible - totalComprometido;

    // ── Semáforo de presión financiera ──
    let presionFinanciera: "green" | "yellow" | "red" = "green";
    if (confirmedIncome > 0) {
      const ratio = totalComprometido / confirmedIncome;
      if (ratio > 0.8 || totalComprometido > saldoDisponible) presionFinanciera = "red";
      else if (ratio > 0.5) presionFinanciera = "yellow";
    } else if (totalComprometido > saldoDisponible) {
      presionFinanciera = "red";
    }

    // ── Upcoming payments (cards + loans + installments) within 30 days ──
    type UpcomingPayment = { label: string; amount: number; dueDate: string | null; type: "card" | "loan" | "installment"; color: string };
    const upcomingPayments: UpcomingPayment[] = [];
    for (const c of cardSummaries) {
      if (c.nextDueDate <= next30) {
        upcomingPayments.push({ label: c.name, amount: c.totalSpent, dueDate: c.nextDueDate, type: "card", color: c.color });
      }
    }
    for (const l of loans) {
      if (l.nextDueDate && l.nextDueDate <= next30) {
        upcomingPayments.push({ label: l.name, amount: parseFloat(l.installmentAmount), dueDate: l.nextDueDate, type: "loan", color: "#0ea5e9" });
      }
    }
    for (const p of installmentPlans) {
      if (p.nextDueDate && p.nextDueDate <= next30 && p.paidInstallments < p.totalInstallments) {
        const card = p.cardId ? cardMap[p.cardId] : null;
        upcomingPayments.push({ label: p.description, amount: parseFloat(p.installmentAmount), dueDate: p.nextDueDate, type: "installment", color: card?.color ?? "#f43f5e" });
      }
    }
    upcomingPayments.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    // ── Category spending breakdown ──
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

    // ── Recent transactions with category ──
    const recentWithCat = recent.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      category: t.categoryId ? catMap[t.categoryId] ?? null : null,
    }));

    // ── Alerts ──
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
    if (saldoLibre < 0) {
      alerts.push({ level: "red", message: "Los compromisos superan tu saldo disponible" });
    } else if (presionFinanciera === "yellow") {
      alerts.push({ level: "yellow", message: "Alta carga de compromisos fijos este mes" });
    }
    const overdueRules = rules.filter(r => r.nextDate && r.nextDate < today);
    if (overdueRules.length > 0) {
      alerts.push({ level: "yellow", message: `${overdueRules.length} recurrencia${overdueRules.length > 1 ? "s" : ""} vencida${overdueRules.length > 1 ? "s" : ""} sin ejecutar` });
    }
    const dueSoonCards = cardSummaries.filter(c => c.isDueSoon);
    if (dueSoonCards.length > 0) {
      alerts.push({ level: "yellow", message: `${dueSoonCards.length} tarjeta${dueSoonCards.length > 1 ? "s" : ""} con vencimiento próximo (7 días)` });
    }

    // ── Estimated balance ──
    const expectedExpenses = rules
      .filter(r => r.type === "expense" && r.nextDate && r.nextDate <= monthEnd && r.nextDate >= today)
      .reduce((s, r) => s + parseFloat(r.amount), 0);
    const expectedIncome = rules
      .filter(r => r.type === "income" && r.nextDate && r.nextDate <= monthEnd && r.nextDate >= today)
      .reduce((s, r) => s + parseFloat(r.amount), 0);
    const saldoEstimadoFinMes = confirmedIncome + expectedIncome - confirmedExpense - expectedExpenses;

    res.json({
      ingresosMes: confirmedIncome,
      gastosMes: confirmedExpense,
      saldoEstimadoFinMes,
      saldoDisponible,
      activos: totalAssets,
      deudas: totalDebt,
      accounts,
      // Phase 2
      cards: cardSummaries,
      loans: loans.map(l => ({ ...l, totalAmount: parseFloat(l.totalAmount), installmentAmount: parseFloat(l.installmentAmount) })),
      installmentPlans: installmentPlans.map(p => ({ ...p, totalAmount: parseFloat(p.totalAmount), installmentAmount: parseFloat(p.installmentAmount) })),
      compromisos: {
        total: totalComprometido,
        recurring: recurringCommitments,
        installments: installmentCommitments,
        loans: loanCommitments,
        saldoLibre,
        presionFinanciera,
      },
      upcomingPayments,
      upcomingRecurrences,
      recentTransactions: recentWithCat,
      categoryBreakdown,
      alerts,
      hasData: recent.length > 0 || accounts.length > 0,
    });
  } catch (err) { logger.error({ err }, "finance summary error"); res.status(500).json({ error: "Error al cargar resumen" }); }
});

// ─── ACCOUNTS ──────────────────────────────────────────────────────────────

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
    const accounts = await db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)).orderBy(financeAccountsTable.createdAt);
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
    const [account] = await db.insert(financeAccountsTable).values({ userId, type, label, amount: String(amount ?? 0), currency: currency ?? "ARS", notes: notes ?? null }).returning();
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

// ─── SEED DEMO ─────────────────────────────────────────────────────────────

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
      const [b] = await db.insert(financeAccountsTable).values({ userId, type: "banco", label: "Cuenta Bancaria Principal", amount: "0", currency: "ARS" }).returning();
      const [bv] = await db.insert(financeAccountsTable).values({ userId, type: "billetera_virtual", label: "Mercado Pago", amount: "0", currency: "ARS" }).returning();
      bancoId = b.id; billeteraId = bv.id;
    } else {
      bancoId = existingAccts[0].id; billeteraId = existingAccts[1]?.id ?? existingAccts[0].id;
    }

    // Demo cards
    const [visaCard] = await db.insert(financeCardsTable).values({
      userId, name: "Visa Galicia", bank: "Galicia", lastFour: "4321",
      color: "#6366f1", closeDay: 5, dueDay: 15, currency: "ARS", isActive: true,
    }).returning();
    const [masterCard] = await db.insert(financeCardsTable).values({
      userId, name: "Mastercard Santander", bank: "Santander", lastFour: "8765",
      color: "#f43f5e", closeDay: 20, dueDay: 28, currency: "ARS", isActive: true,
    }).returning();

    const today = todayStr();
    const [ty, tm] = today.split("-");
    const d = (n: number, monthOffset = 0) => {
      const mo = parseInt(tm, 10) + monthOffset;
      const yr = mo <= 0 ? parseInt(ty, 10) - 1 : parseInt(ty, 10);
      const realMo = mo <= 0 ? mo + 12 : mo;
      return `${yr}-${String(realMo).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    };

    const txRows = [
      { type: "income",  amount: "850000", categoryId: catByName["Sueldo"],       accountId: bancoId,    cardId: null, date: d(1),  status: "confirmed", notes: "Sueldo del mes",         isFixed: true,  isRecurring: true },
      { type: "income",  amount: "120000", categoryId: catByName["Clientes"],      accountId: bancoId,    cardId: null, date: d(5),  status: "confirmed", notes: "Consultoría cliente A",  isFixed: false, isRecurring: false },
      { type: "income",  amount: "75000",  categoryId: catByName["Clientes"],      accountId: billeteraId,cardId: null, date: d(8),  status: "confirmed", notes: "Asesoramiento contable", isFixed: false, isRecurring: false },
      { type: "income",  amount: "200000", categoryId: catByName["Extras"],        accountId: bancoId,    cardId: null, date: d(20), status: "expected",  notes: "Bonus esperado",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "45000",  categoryId: catByName["Hogar"],         accountId: bancoId,    cardId: null, date: d(2),  status: "confirmed", notes: "Expensas",               isFixed: true,  isRecurring: true },
      { type: "expense", amount: "18500",  categoryId: catByName["Servicios"],     accountId: billeteraId,cardId: null, date: d(3),  status: "confirmed", notes: "Electricidad + gas",     isFixed: false, isRecurring: true },
      { type: "expense", amount: "67000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    cardId: null, date: d(6),  status: "confirmed", notes: "Compra semanal",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "32000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    cardId: null, date: d(13), status: "confirmed", notes: "Compra semanal",         isFixed: false, isRecurring: false },
      { type: "expense", amount: "8500",   categoryId: catByName["Transporte"],    accountId: billeteraId,cardId: null, date: d(7),  status: "confirmed", notes: "SUBE + nafta",           isFixed: false, isRecurring: false },
      { type: "expense", amount: "15000",  categoryId: catByName["Salidas"],       accountId: billeteraId,cardId: null, date: d(9),  status: "confirmed", notes: "Restaurante",            isFixed: false, isRecurring: false },
      { type: "expense", amount: "4800",   categoryId: catByName["Suscripciones"], accountId: null,       cardId: visaCard.id, date: d(1),  status: "confirmed", notes: "Netflix + Spotify", isFixed: true,  isRecurring: true },
      { type: "expense", amount: "28000",  categoryId: catByName["Salud"],         accountId: bancoId,    cardId: null, date: d(10), status: "pending",   notes: "Prepaga",                isFixed: true,  isRecurring: true },
      { type: "expense", amount: "120000", categoryId: catByName["Ropa"],          accountId: null,       cardId: visaCard.id, date: d(3),  status: "confirmed", notes: "Ropa temporada",   isFixed: false, isRecurring: false },
      { type: "expense", amount: "89000",  categoryId: catByName["Hogar"],         accountId: null,       cardId: masterCard.id, date: d(7), status: "confirmed", notes: "Electrodoméstico",isFixed: false, isRecurring: false },
      { type: "income",  amount: "850000", categoryId: catByName["Sueldo"],        accountId: bancoId,    cardId: null, date: d(1, -1), status: "confirmed", notes: "Sueldo mes anterior", isFixed: true, isRecurring: true },
      { type: "expense", amount: "44000",  categoryId: catByName["Hogar"],         accountId: bancoId,    cardId: null, date: d(2, -1), status: "confirmed", notes: "Expensas",            isFixed: true, isRecurring: true },
      { type: "expense", amount: "71000",  categoryId: catByName["Supermercado"],  accountId: bancoId,    cardId: null, date: d(15,-1), status: "confirmed", notes: "Compra quincenal",    isFixed: false, isRecurring: false },
    ];
    await db.insert(financeTransactionsTable).values(txRows.map(t => ({ ...t, userId, currency: "ARS" })));

    // Recalculate account balances
    let bancoDelta = 0, billeteraDelta = 0;
    for (const t of txRows) {
      if (t.status !== "confirmed" || t.cardId || !t.accountId) continue;
      const delta = t.type === "income" ? parseFloat(t.amount) : -parseFloat(t.amount);
      if (t.accountId === bancoId) bancoDelta += delta;
      else billeteraDelta += delta;
    }
    await db.update(financeAccountsTable).set({ amount: String(bancoDelta) }).where(eq(financeAccountsTable.id, bancoId));
    await db.update(financeAccountsTable).set({ amount: String(billeteraDelta) }).where(eq(financeAccountsTable.id, billeteraId));

    // Demo installment plans (cuotas)
    await db.insert(financeInstallmentPlansTable).values([
      {
        userId, description: "TV Samsung 55\"", totalAmount: "480000", installmentAmount: "40000",
        totalInstallments: 12, paidInstallments: 3, startDate: d(10, -3),
        nextDueDate: addMonths(d(10, -3), 4), cardId: visaCard.id,
        categoryId: catByName["Hogar"], currency: "ARS", isActive: true,
      },
      {
        userId, description: "MacBook Pro", totalAmount: "2400000", installmentAmount: "200000",
        totalInstallments: 12, paidInstallments: 2, startDate: d(15, -2),
        nextDueDate: addMonths(d(15, -2), 3), cardId: masterCard.id,
        categoryId: catByName["Otros"], currency: "ARS", isActive: true,
      },
    ]);

    // Demo loan
    await db.insert(financeLoansTable).values({
      userId, name: "Préstamo personal banco", creditor: "Banco Galicia",
      totalAmount: "1200000", totalInstallments: 24, installmentAmount: "55000",
      paidInstallments: 6, startDate: d(1, -6), nextDueDate: addMonths(d(1, -6), 7),
      status: "active", currency: "ARS",
    });

    // Demo recurring rules
    await db.insert(financeRecurringRulesTable).values([
      { userId, name: "Sueldo mensual",    type: "income",  amount: "850000", categoryId: catByName["Sueldo"],       accountId: bancoId,    frequency: "monthly", dayOfMonth: 1,  nextDate: addMonths(d(1), 1),  isActive: true, currency: "ARS" },
      { userId, name: "Expensas",          type: "expense", amount: "45000",  categoryId: catByName["Hogar"],        accountId: bancoId,    frequency: "monthly", dayOfMonth: 2,  nextDate: addMonths(d(2), 1),  isActive: true, currency: "ARS" },
      { userId, name: "Servicios",         type: "expense", amount: "18500",  categoryId: catByName["Servicios"],    accountId: billeteraId,frequency: "monthly", dayOfMonth: 3,  nextDate: addMonths(d(3), 1),  isActive: true, currency: "ARS" },
      { userId, name: "Netflix + Spotify", type: "expense", amount: "4800",   categoryId: catByName["Suscripciones"],accountId: null,       frequency: "monthly", dayOfMonth: 1,  nextDate: addMonths(d(1), 1),  isActive: true, currency: "ARS" },
      { userId, name: "Prepaga",           type: "expense", amount: "28000",  categoryId: catByName["Salud"],        accountId: bancoId,    frequency: "monthly", dayOfMonth: 10, nextDate: addMonths(d(10), 1), isActive: true, currency: "ARS" },
      { userId, name: "Préstamo Galicia",  type: "expense", amount: "55000",  categoryId: catByName["Préstamos"],    accountId: bancoId,    frequency: "monthly", dayOfMonth: 1,  nextDate: addMonths(d(1), 1),  isActive: true, currency: "ARS" },
    ]);

    res.json({ ok: true, skipped: false, message: "Datos demo cargados exitosamente" });
  } catch (err) { logger.error({ err }, "finance seed demo"); res.status(500).json({ error: "Error al cargar datos demo" }); }
});

// ─── PHASE 3: BUDGETS ─────────────────────────────────────────────────────

router.get("/finance/budgets", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const month = (req.query.month as string) || today.slice(0, 7);
  const { start, end } = monthRange(`${month}-01`);
  try {
    const [budgets, cats, spendingRows] = await Promise.all([
      db.select().from(financeBudgetsTable).where(and(
        eq(financeBudgetsTable.userId, userId),
        eq(financeBudgetsTable.month, month),
      )),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
      db.select({
        categoryId: financeTransactionsTable.categoryId,
        total: sql<string>`coalesce(sum(amount::numeric), 0)`,
      }).from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.userId, userId),
        eq(financeTransactionsTable.type, "expense"),
        gte(financeTransactionsTable.date, start),
        lte(financeTransactionsTable.date, end),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
      )).groupBy(financeTransactionsTable.categoryId),
    ]);
    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };
    const spendMap: Record<number, number> = {};
    for (const s of spendingRows) { if (s.categoryId != null) spendMap[s.categoryId] = parseFloat(s.total); }

    const enriched = budgets.map(b => {
      const spent = spendMap[b.categoryId] ?? 0;
      const budgeted = parseFloat(b.amount);
      const remaining = budgeted - spent;
      const pct = budgeted > 0 ? (spent / budgeted) * 100 : 0;
      const status = pct > 100 ? "exceeded" : pct >= 90 ? "critical" : pct >= 70 ? "warning" : "ok";
      return { ...b, amount: budgeted, spent, remaining, pct, status, category: catMap[b.categoryId] ?? null };
    });
    const totalBudgeted = enriched.reduce((s, b) => s + b.amount, 0);
    const totalSpent = enriched.reduce((s, b) => s + b.spent, 0);
    res.json({ budgets: enriched, totalBudgeted, totalSpent, month });
  } catch (err) { logger.error({ err }, "finance budgets fetch"); res.status(500).json({ error: "Error al cargar presupuestos" }); }
});

router.post("/finance/budgets", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { categoryId, month, amount, currency } = req.body ?? {};
  if (!categoryId || !month || !amount) { res.status(400).json({ error: "categoryId, month y amount son requeridos" }); return; }
  try {
    const existing = await db.select().from(financeBudgetsTable).where(and(
      eq(financeBudgetsTable.userId, userId),
      eq(financeBudgetsTable.categoryId, parseInt(categoryId, 10)),
      eq(financeBudgetsTable.month, month),
    ));
    if (existing.length > 0) {
      const [updated] = await db.update(financeBudgetsTable)
        .set({ amount: String(amount), currency: currency ?? "ARS" })
        .where(eq(financeBudgetsTable.id, existing[0].id)).returning();
      res.json(updated); return;
    }
    const [budget] = await db.insert(financeBudgetsTable).values({
      userId, categoryId: parseInt(categoryId, 10), month, amount: String(amount), currency: currency ?? "ARS",
    }).returning();
    res.status(201).json(budget);
  } catch (err) { logger.error({ err }, "finance budget create"); res.status(500).json({ error: "Error al crear presupuesto" }); }
});

router.put("/finance/budgets/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeBudgetsTable).where(eq(financeBudgetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { amount, currency } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    const [updated] = await db.update(financeBudgetsTable).set(updates).where(eq(financeBudgetsTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance budget update"); res.status(500).json({ error: "Error al actualizar presupuesto" }); }
});

router.delete("/finance/budgets/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeBudgetsTable).where(eq(financeBudgetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeBudgetsTable).where(eq(financeBudgetsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance budget delete"); res.status(500).json({ error: "Error al eliminar presupuesto" }); }
});

// ─── PHASE 3: PROJECTION + CALENDAR ───────────────────────────────────────

router.get("/finance/projection", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const horizon = 35;
  const endDate = addDays(today, horizon);
  try {
    const [accounts, rules, cards, installments, loans] = await Promise.all([
      db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)),
      db.select().from(financeRecurringRulesTable).where(and(
        eq(financeRecurringRulesTable.userId, userId),
        eq(financeRecurringRulesTable.isActive, true),
      )),
      db.select().from(financeCardsTable).where(and(
        eq(financeCardsTable.userId, userId),
        eq(financeCardsTable.isActive, true),
      )),
      db.select().from(financeInstallmentPlansTable).where(and(
        eq(financeInstallmentPlansTable.userId, userId),
        eq(financeInstallmentPlansTable.isActive, true),
      )),
      db.select().from(financeLoansTable).where(and(
        eq(financeLoansTable.userId, userId),
        eq(financeLoansTable.status, "active"),
      )),
    ]);

    const saldoActual = accounts.reduce((s, a) => {
      const amt = parseFloat(a.amount ?? "0");
      return s + (a.type === "deuda" ? -Math.abs(amt) : amt);
    }, 0);

    type CalEvent = { date: string; label: string; amount: number; type: "income" | "expense"; category: string; icon: string };
    const allEvents: CalEvent[] = [];

    // Recurring rules – up to 2 occurrences per rule in range
    for (const r of rules) {
      if (!r.nextDate) continue;
      let d = r.nextDate;
      let count = 0;
      while (d <= endDate && count < 2) {
        if (d >= today) {
          allEvents.push({ date: d, label: r.name, amount: parseFloat(r.amount), type: r.type as "income" | "expense", category: "recurring", icon: r.type === "income" ? "arrow-up" : "repeat" });
        }
        d = r.frequency === "weekly" ? addDays(d, 7) : r.frequency === "monthly" ? addMonths(d, 1) : addDays(d, 365);
        count++;
      }
    }

    // Cards – due date with cycle spending
    for (const c of cards) {
      const dueDate = nextOccurrenceDate(c.dueDay, today);
      if (dueDate <= endDate) {
        const closeDateStr = nextOccurrenceDate(c.closeDay, today);
        const cycleStart = addDays(closeDateStr, -32);
        const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
          .from(financeTransactionsTable).where(and(
            eq(financeTransactionsTable.userId, userId),
            eq(financeTransactionsTable.cardId, c.id),
            eq(financeTransactionsTable.type, "expense"),
            gte(financeTransactionsTable.date, cycleStart),
            sql`${financeTransactionsTable.status} != 'cancelled'`,
          ));
        const cardSpending = parseFloat(total);
        if (cardSpending > 0) {
          allEvents.push({ date: dueDate, label: c.name, amount: cardSpending, type: "expense", category: "card", icon: "credit-card" });
        }
      }
    }

    // Loans
    for (const l of loans) {
      if (l.nextDueDate && l.nextDueDate >= today && l.nextDueDate <= endDate) {
        allEvents.push({ date: l.nextDueDate, label: l.name, amount: parseFloat(l.installmentAmount), type: "expense", category: "loan", icon: "landmark" });
      }
    }

    // Installment plans
    for (const p of installments) {
      if (p.nextDueDate && p.nextDueDate >= today && p.nextDueDate <= endDate && p.paidInstallments < p.totalInstallments) {
        allEvents.push({ date: p.nextDueDate, label: p.description, amount: parseFloat(p.installmentAmount), type: "expense", category: "installment", icon: "layers" });
      }
    }

    // Build daily running balance
    const dailySeries: { date: string; saldo: number; events: CalEvent[] }[] = [];
    let running = saldoActual;
    for (let i = 0; i <= horizon; i++) {
      const date = addDays(today, i);
      const dayEvents = allEvents.filter(e => e.date === date);
      for (const e of dayEvents) running += e.type === "income" ? e.amount : -e.amount;
      dailySeries.push({ date, saldo: running, events: dayEvents });
    }

    const p7 = dailySeries[7];
    const p15 = dailySeries[15];
    const [ty, tm] = today.split("-").map(Number);
    const lastDayOfMonth = new Date(ty, tm, 0).getDate();
    const monthEndDate = `${today.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;
    const monthEndIdx = dailySeries.findIndex(s => s.date >= monthEndDate);
    const pMonth = monthEndIdx >= 0 ? dailySeries[monthEndIdx] : dailySeries[dailySeries.length - 1];

    const riskLevel = (saldo: number) => saldo < 0 ? "high" : saldo < saldoActual * 0.2 ? "medium" : "low";

    const highPressureDays = dailySeries
      .filter(d => {
        const exp = d.events.filter(e => e.type === "expense");
        return exp.length >= 2 || exp.reduce((s, e) => s + e.amount, 0) > Math.abs(saldoActual) * 0.1;
      })
      .slice(0, 5)
      .map(d => ({
        date: d.date,
        totalExpenses: d.events.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0),
      }));

    const calendarEvents = [...allEvents].sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      saldoActual,
      projection7d: { saldo: p7?.saldo ?? saldoActual, risk: riskLevel(p7?.saldo ?? saldoActual) },
      projection15d: { saldo: p15?.saldo ?? saldoActual, risk: riskLevel(p15?.saldo ?? saldoActual) },
      projectionMonthEnd: { saldo: pMonth?.saldo ?? saldoActual, risk: riskLevel(pMonth?.saldo ?? saldoActual) },
      dailySeries,
      calendarEvents,
      highPressureDays,
    });
  } catch (err) { logger.error({ err }, "finance projection"); res.status(500).json({ error: "Error al calcular proyección" }); }
});

// ─── PHASE 3: INSIGHTS ────────────────────────────────────────────────────

router.get("/finance/insights", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const [ty, tm] = today.split("-").map(Number);
  const prevMonthYr = tm === 1 ? ty - 1 : ty;
  const prevMonthMo = tm === 1 ? 12 : tm - 1;
  const prevMonth = `${prevMonthYr}-${String(prevMonthMo).padStart(2, "0")}`;
  const { start: thisStart, end: thisEnd } = monthRange(`${thisMonth}-01`);
  const { start: prevStart, end: prevEnd } = monthRange(`${prevMonth}-01`);

  try {
    const [thisExpByCat, prevExpByCat, budgets, cats, upcomingNext7, accounts] = await Promise.all([
      db.select({ categoryId: financeTransactionsTable.categoryId, isFixed: financeTransactionsTable.isFixed, total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable).where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, thisStart),
          lte(financeTransactionsTable.date, thisEnd),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )).groupBy(financeTransactionsTable.categoryId, financeTransactionsTable.isFixed),
      db.select({ categoryId: financeTransactionsTable.categoryId, isFixed: financeTransactionsTable.isFixed, total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable).where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, prevStart),
          lte(financeTransactionsTable.date, prevEnd),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )).groupBy(financeTransactionsTable.categoryId, financeTransactionsTable.isFixed),
      db.select().from(financeBudgetsTable).where(and(
        eq(financeBudgetsTable.userId, userId),
        eq(financeBudgetsTable.month, thisMonth),
      )),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
      db.select().from(financeRecurringRulesTable).where(and(
        eq(financeRecurringRulesTable.userId, userId),
        eq(financeRecurringRulesTable.isActive, true),
        gte(financeRecurringRulesTable.nextDate, today),
        lte(financeRecurringRulesTable.nextDate, addDays(today, 7)),
      )),
      db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)),
    ]);

    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };

    const thisVarTotal = thisExpByCat.filter(r => !r.isFixed).reduce((s, r) => s + parseFloat(r.total), 0);
    const prevVarTotal = prevExpByCat.filter(r => !r.isFixed).reduce((s, r) => s + parseFloat(r.total), 0);

    type Insight = { id: string; icon: string; text: string; level: "info" | "warning" | "red" | "green" };
    const insights: Insight[] = [];

    // 1. Variable expense trend vs last month
    if (prevVarTotal > 0) {
      const diff = ((thisVarTotal - prevVarTotal) / prevVarTotal) * 100;
      if (Math.abs(diff) > 5) {
        insights.push({
          id: "variable_trend",
          icon: diff > 0 ? "trending-up" : "trending-down",
          text: `Tus gastos variables vienen ${Math.abs(Math.round(diff))}% ${diff > 0 ? "arriba" : "abajo"} del mes anterior.`,
          level: diff > 20 ? "red" : diff > 10 ? "warning" : "info",
        });
      }
    }

    // 2. Top variable expense category
    const varByCat: Record<number, number> = {};
    for (const r of thisExpByCat.filter(r => !r.isFixed)) {
      if (r.categoryId != null) varByCat[r.categoryId] = (varByCat[r.categoryId] ?? 0) + parseFloat(r.total);
    }
    const topCatId = Object.entries(varByCat).sort(([, a], [, b]) => b - a)[0];
    if (topCatId) {
      const catName = catMap[Number(topCatId[0])]?.name ?? "Sin categoría";
      insights.push({
        id: "top_category",
        icon: "pie-chart",
        text: `Tu categoría con mayor gasto variable este mes es ${catName}: $${Math.round(Number(topCatId[1])).toLocaleString("es-AR")}.`,
        level: "info",
      });
    }

    // 3. Budget alerts
    const thisByCat: Record<number, number> = {};
    for (const r of thisExpByCat) {
      if (r.categoryId != null) thisByCat[r.categoryId] = (thisByCat[r.categoryId] ?? 0) + parseFloat(r.total);
    }
    for (const b of budgets) {
      const spent = thisByCat[b.categoryId] ?? 0;
      const budgeted = parseFloat(b.amount);
      const pct = budgeted > 0 ? (spent / budgeted) * 100 : 0;
      const catName = catMap[b.categoryId]?.name ?? "categoría";
      if (pct > 100) {
        insights.push({ id: `budget_exceeded_${b.id}`, icon: "alert-triangle", text: `Superaste el presupuesto de ${catName} en $${Math.round(spent - budgeted).toLocaleString("es-AR")} (${Math.round(pct)}% ejecutado).`, level: "red" });
      } else if (pct >= 80) {
        insights.push({ id: `budget_warning_${b.id}`, icon: "alert-triangle", text: `El presupuesto de ${catName} está al ${Math.round(pct)}%: te quedan $${Math.round(budgeted - spent).toLocaleString("es-AR")}.`, level: "warning" });
      }
    }

    // 4. Upcoming pressure next 7 days
    const expNext7 = upcomingNext7.filter(r => r.type === "expense");
    if (expNext7.length >= 2) {
      const totalAmt = expNext7.reduce((s, r) => s + parseFloat(r.amount), 0);
      insights.push({ id: "pressure_week", icon: "zap", text: `Los próximos 7 días tenés ${expNext7.length} vencimientos por $${Math.round(totalAmt).toLocaleString("es-AR")}.`, level: "warning" });
    }

    // 5. Subscriptions % of total variable
    const subCatId = cats.find(c => c.name === "Suscripciones")?.id;
    if (subCatId && thisVarTotal > 0) {
      const subAmt = varByCat[subCatId] ?? 0;
      const subPct = (subAmt / thisVarTotal) * 100;
      if (subPct > 3) {
        insights.push({ id: "subscriptions", icon: "repeat", text: `Tus suscripciones representan el ${Math.round(subPct)}% del gasto variable del mes ($${Math.round(subAmt).toLocaleString("es-AR")}).`, level: "info" });
      }
    }

    // 6. Projected month-end balance (simple: saldo + expected income rules - expected expense rules this month)
    const saldoActual = accounts.reduce((s, a) => {
      const amt = parseFloat(a.amount ?? "0");
      return s + (a.type === "deuda" ? -Math.abs(amt) : amt);
    }, 0);
    const [ty2, tm2] = today.split("-").map(Number);
    const lastDayOfMonth = new Date(ty2, tm2, 0).getDate();
    const monthEndDate = `${today.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;
    const allRules = await db.select().from(financeRecurringRulesTable).where(and(
      eq(financeRecurringRulesTable.userId, userId),
      eq(financeRecurringRulesTable.isActive, true),
      gte(financeRecurringRulesTable.nextDate, today),
      lte(financeRecurringRulesTable.nextDate, monthEndDate),
    ));
    let projDelta = 0;
    for (const r of allRules) projDelta += r.type === "income" ? parseFloat(r.amount) : -parseFloat(r.amount);
    const projectedEnd = saldoActual + projDelta;
    if (Math.abs(projDelta) > 1000) {
      insights.push({
        id: "month_projection",
        icon: projectedEnd >= 0 ? "calendar" : "alert-triangle",
        text: `A este ritmo, terminás el mes con aproximadamente $${Math.round(projectedEnd).toLocaleString("es-AR")}.`,
        level: projectedEnd < 0 ? "red" : projectedEnd < saldoActual * 0.2 ? "warning" : "green",
      });
    }

    res.json({ insights });
  } catch (err) { logger.error({ err }, "finance insights"); res.status(500).json({ error: "Error al calcular insights" }); }
});

// ─── PHASE 4: GOALS ───────────────────────────────────────────────────────

router.get("/finance/goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const { start, end } = monthRange(`${thisMonth}-01`);
  try {
    const [goals, cats, thisMonthSpending] = await Promise.all([
      db.select().from(financeGoalsTable).where(eq(financeGoalsTable.userId, userId)).orderBy(desc(financeGoalsTable.createdAt)),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
      db.select({ categoryId: financeTransactionsTable.categoryId, total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable).where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, start),
          lte(financeTransactionsTable.date, end),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )).groupBy(financeTransactionsTable.categoryId),
    ]);
    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };
    const spendMap: Record<number, number> = {};
    for (const s of thisMonthSpending) { if (s.categoryId != null) spendMap[s.categoryId] = parseFloat(s.total); }

    const enriched = goals.map(g => {
      const target = parseFloat(g.targetAmount);
      let current = parseFloat(g.currentAmount);
      // For reduce_spending: auto-compute from category spending
      if (g.type === "reduce_spending" && g.categoryId != null) {
        const spent = spendMap[g.categoryId] ?? 0;
        current = Math.max(0, target - spent); // how much budget is still saved
      }
      const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
      const daysLeft = g.targetDate ? Math.ceil((new Date(g.targetDate + "T12:00:00Z").getTime() - Date.now()) / 86400000) : null;
      const monthlyNeeded = daysLeft != null && daysLeft > 0 ? ((target - current) / (daysLeft / 30)) : null;
      return {
        ...g,
        targetAmount: target,
        currentAmount: current,
        pct,
        remaining: target - current,
        daysLeft,
        monthlyNeeded,
        category: g.categoryId ? (catMap[g.categoryId] ?? null) : null,
      };
    });
    res.json(enriched);
  } catch (err) { logger.error({ err }, "finance goals fetch"); res.status(500).json({ error: "Error al cargar objetivos" }); }
});

router.post("/finance/goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { type, title, targetAmount, targetDate, categoryId, currency, notes } = req.body ?? {};
  if (!type || !title || !targetAmount) { res.status(400).json({ error: "type, title y targetAmount son requeridos" }); return; }
  const validTypes = ["savings", "reduce_spending", "emergency_fund", "pay_debt"];
  if (!validTypes.includes(type)) { res.status(400).json({ error: "type inválido" }); return; }
  try {
    const { currentAmount: rawCurrent } = req.body ?? {};
    const [goal] = await db.insert(financeGoalsTable).values({
      userId, type, title, targetAmount: String(targetAmount),
      currentAmount: String(parseFloat(rawCurrent ?? "0") || 0),
      targetDate: targetDate ?? null, categoryId: categoryId ? parseInt(categoryId, 10) : null,
      currency: currency ?? "ARS", isActive: true, notes: notes ?? null,
    }).returning();
    res.status(201).json(goal);
  } catch (err) { logger.error({ err }, "finance goal create"); res.status(500).json({ error: "Error al crear objetivo" }); }
});

router.put("/finance/goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeGoalsTable).where(eq(financeGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    const { type, title, targetAmount, currentAmount, targetDate, categoryId, currency, isActive, notes } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (type) updates.type = type;
    if (title) updates.title = title;
    if (targetAmount !== undefined) updates.targetAmount = String(targetAmount);
    if (currentAmount !== undefined) updates.currentAmount = String(currentAmount);
    if (targetDate !== undefined) updates.targetDate = targetDate;
    if (categoryId !== undefined) updates.categoryId = categoryId ? parseInt(categoryId, 10) : null;
    if (currency) updates.currency = currency;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeGoalsTable).set(updates).where(eq(financeGoalsTable.id, id)).returning();
    res.json(updated);
  } catch (err) { logger.error({ err }, "finance goal update"); res.status(500).json({ error: "Error al actualizar objetivo" }); }
});

router.delete("/finance/goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [existing] = await db.select().from(financeGoalsTable).where(eq(financeGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "No encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;
    await db.delete(financeGoalsTable).where(eq(financeGoalsTable.id, id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "finance goal delete"); res.status(500).json({ error: "Error al eliminar objetivo" }); }
});

// ─── PHASE 4: SMART SUGGESTIONS ───────────────────────────────────────────

router.get("/finance/suggestions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const since90 = addDays(today, -90);
  const since30 = addDays(today, -30);
  try {
    // SQL-based grouping — no in-memory processing of 500 rows
    const [grouped, recentNotesRows, cats] = await Promise.all([
      db.select({
        normalizedNotes: sql<string>`lower(trim(notes))`,
        originalNotes: sql<string>`max(notes)`,
        txType: financeTransactionsTable.type,
        cnt: sql<number>`count(*)::int`,
        avgAmount: sql<string>`round(avg(amount::numeric))`,
        categoryId: sql<number | null>`max(category_id)`,
        accountId: sql<number | null>`max(account_id)`,
      }).from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.userId, userId),
        gte(financeTransactionsTable.date, since90),
        sql`${financeTransactionsTable.notes} is not null`,
        isNull(financeTransactionsTable.recurringRuleId),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
        sql`length(trim(notes)) >= 3`,
      )).groupBy(sql`lower(trim(notes))`, financeTransactionsTable.type)
        .having(sql`count(*) >= 3`)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db.select({ notes: financeTransactionsTable.notes })
        .from(financeTransactionsTable).where(and(
          eq(financeTransactionsTable.userId, userId),
          gte(financeTransactionsTable.date, since30),
          sql`${financeTransactionsTable.notes} is not null`,
          sql`length(trim(notes)) >= 2`,
        )).orderBy(desc(financeTransactionsTable.date)).limit(100),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
    ]);

    const catMap: Record<number, { name: string; color: string; icon: string }> = {};
    for (const c of cats) catMap[c.id] = { name: c.name, color: c.color, icon: c.icon };

    type Suggestion = { id: string; type: string; text: string; data: Record<string, unknown> };
    const suggestions: Suggestion[] = grouped.map(g => ({
      id: `recurring_${g.normalizedNotes.slice(0, 20)}`,
      type: "recurring",
      text: `"${g.originalNotes}" apareció ${g.cnt} veces en los últimos 3 meses. ¿Querés automatizarla como recurrencia?`,
      data: {
        notes: g.originalNotes,
        txType: g.txType,
        categoryId: g.categoryId,
        categoryName: g.categoryId ? (catMap[g.categoryId]?.name ?? null) : null,
        accountId: g.accountId,
        avgAmount: parseFloat(g.avgAmount),
        frequency: "monthly",
      },
    }));

    const seenNotes = new Set<string>();
    const recentConcepts: string[] = [];
    for (const r of recentNotesRows) {
      const n = (r.notes ?? "").trim();
      if (n && !seenNotes.has(n)) { seenNotes.add(n); recentConcepts.push(n); }
      if (recentConcepts.length >= 20) break;
    }

    res.json({ suggestions, recentConcepts });
  } catch (err) { logger.error({ err }, "finance suggestions"); res.status(500).json({ error: "Error al calcular sugerencias" }); }
});

// ─── PHASE 4: WEEKLY REVIEW ───────────────────────────────────────────────

router.get("/finance/weekly-review", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const weekStart = addDays(today, -6);
  const prevWeekStart = addDays(today, -13);
  const prevWeekEnd = addDays(today, -7);
  const { start: mStart, end: mEnd } = monthRange(`${today.slice(0, 7)}-01`);
  try {
    const [thisWeekTx, prevWeekTx, expectedUnreceived, upcomingRules, accounts, budgets, monthlyCatSpend] = await Promise.all([
      db.select().from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.userId, userId),
        gte(financeTransactionsTable.date, weekStart),
        lte(financeTransactionsTable.date, today),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
      )),
      db.select().from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.userId, userId),
        gte(financeTransactionsTable.date, prevWeekStart),
        lte(financeTransactionsTable.date, prevWeekEnd),
        sql`${financeTransactionsTable.status} != 'cancelled'`,
      )),
      db.select().from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.userId, userId),
        eq(financeTransactionsTable.type, "income"),
        eq(financeTransactionsTable.status, "expected"),
        lte(financeTransactionsTable.date, today),
      )).limit(10),
      db.select().from(financeRecurringRulesTable).where(and(
        eq(financeRecurringRulesTable.userId, userId),
        eq(financeRecurringRulesTable.isActive, true),
        gte(financeRecurringRulesTable.nextDate, today),
        lte(financeRecurringRulesTable.nextDate, addDays(today, 7)),
      )),
      db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)),
      db.select().from(financeBudgetsTable).where(and(
        eq(financeBudgetsTable.userId, userId),
        eq(financeBudgetsTable.month, today.slice(0, 7)),
      )),
      db.select({ categoryId: financeTransactionsTable.categoryId, total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable).where(and(
          eq(financeTransactionsTable.userId, userId),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, mStart),
          lte(financeTransactionsTable.date, mEnd),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        )).groupBy(financeTransactionsTable.categoryId),
    ]);

    const thisIncome = thisWeekTx.filter(t => t.type === "income").reduce((s, t) => s + parseFloat(t.amount), 0);
    const thisExpenses = thisWeekTx.filter(t => t.type === "expense").reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevIncome = prevWeekTx.filter(t => t.type === "income").reduce((s, t) => s + parseFloat(t.amount), 0);
    const prevExpenses = prevWeekTx.filter(t => t.type === "expense").reduce((s, t) => s + parseFloat(t.amount), 0);

    const saldoLibre = accounts.reduce((s, a) => {
      const amt = parseFloat(a.amount ?? "0");
      return s + (a.type === "deuda" ? -Math.abs(amt) : amt);
    }, 0);

    const upcomingExpenses = upcomingRules.filter(r => r.type === "expense").reduce((s, r) => s + parseFloat(r.amount), 0);
    const upcomingIncome = upcomingRules.filter(r => r.type === "income").reduce((s, r) => s + parseFloat(r.amount), 0);

    const spendMap: Record<number, number> = {};
    for (const s of monthlyCatSpend) { if (s.categoryId != null) spendMap[s.categoryId] = parseFloat(s.total); }

    const overspentBudgets = budgets.filter(b => {
      const spent = spendMap[b.categoryId] ?? 0;
      return spent > parseFloat(b.amount);
    });

    res.json({
      period: { from: weekStart, to: today },
      thisWeek: { income: thisIncome, expenses: thisExpenses, txCount: thisWeekTx.length },
      prevWeek: { income: prevIncome, expenses: prevExpenses },
      incomeChange: prevIncome > 0 ? ((thisIncome - prevIncome) / prevIncome) * 100 : null,
      expenseChange: prevExpenses > 0 ? ((thisExpenses - prevExpenses) / prevExpenses) * 100 : null,
      expectedUnreceived: expectedUnreceived.map(t => ({ id: t.id, notes: t.notes, amount: parseFloat(t.amount), date: t.date })),
      upcomingVencimientos: upcomingRules.map(r => ({ id: r.id, name: r.name, type: r.type, amount: parseFloat(r.amount), nextDate: r.nextDate })),
      upcomingExpenses,
      upcomingIncome,
      saldoLibre,
      overspentBudgets: overspentBudgets.map(b => ({ id: b.id, categoryId: b.categoryId, budgeted: parseFloat(b.amount), spent: spendMap[b.categoryId] ?? 0 })),
    });
  } catch (err) { logger.error({ err }, "finance weekly review"); res.status(500).json({ error: "Error al calcular revisión semanal" }); }
});

// ─── PHASE 4: EXPORT ──────────────────────────────────────────────────────

router.get("/finance/export/transactions.csv", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const { from, to } = req.query as Record<string, string>;
  try {
    const conditions = [eq(financeTransactionsTable.userId, userId)];
    if (from) conditions.push(gte(financeTransactionsTable.date, from));
    if (to) conditions.push(lte(financeTransactionsTable.date, to));

    const [txs, cats, accounts, cards] = await Promise.all([
      db.select().from(financeTransactionsTable).where(and(...conditions)).orderBy(desc(financeTransactionsTable.date)).limit(5000),
      db.select().from(financeCategoriesTable).where(eq(financeCategoriesTable.userId, userId)),
      db.select().from(financeAccountsTable).where(eq(financeAccountsTable.userId, userId)),
      db.select().from(financeCardsTable).where(eq(financeCardsTable.userId, userId)),
    ]);
    const catMap: Record<number, string> = {};
    for (const c of cats) catMap[c.id] = c.name;
    const acctMap: Record<number, string> = {};
    for (const a of accounts) acctMap[a.id] = a.label;
    const cardMap: Record<number, string> = {};
    for (const c of cards) cardMap[c.id] = c.name;

    const header = "Fecha,Tipo,Monto,Moneda,Categoría,Cuenta,Tarjeta,Estado,Descripción,Fijo,Recurrente\n";
    const rows = txs.map(t => [
      t.date,
      t.type === "income" ? "Ingreso" : "Gasto",
      t.amount,
      t.currency,
      t.categoryId ? (catMap[t.categoryId] ?? "") : "",
      t.accountId ? (acctMap[t.accountId] ?? "") : "",
      t.cardId ? (cardMap[t.cardId] ?? "") : "",
      t.status,
      `"${(t.notes ?? "").replace(/"/g, '""')}"`,
      t.isFixed ? "Si" : "No",
      t.isRecurring ? "Si" : "No",
    ].join(",")).join("\n");

    const filename = `movimientos_${from ?? "todo"}_${to ?? todayStr()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + header + rows); // BOM for Excel compatibility
  } catch (err) { logger.error({ err }, "finance export csv"); res.status(500).json({ error: "Error al exportar" }); }
});

router.get("/finance/export/summary.csv", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getCurrentUserId(req);
  const today = todayStr();
  const [ty, tm] = today.split("-").map(Number);
  // Compute range: 12 months back
  const mo12 = tm - 11;
  const yr12 = mo12 <= 0 ? ty - 1 : ty;
  const realMo12 = mo12 <= 0 ? mo12 + 12 : mo12;
  const since = `${yr12}-${String(realMo12).padStart(2, "0")}-01`;
  try {
    // Single query grouped by month — no N+1
    const monthData = await db.select({
      month: sql<string>`to_char(date::date, 'YYYY-MM')`,
      income: sql<string>`coalesce(sum(case when type='income' then amount::numeric else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when type='expense' then amount::numeric else 0 end), 0)`,
    }).from(financeTransactionsTable).where(and(
      eq(financeTransactionsTable.userId, userId),
      gte(financeTransactionsTable.date, since),
      sql`${financeTransactionsTable.status} != 'cancelled'`,
    )).groupBy(sql`to_char(date::date, 'YYYY-MM')`).orderBy(sql`to_char(date::date, 'YYYY-MM')`);

    const dataMap: Record<string, { income: number; expense: number }> = {};
    for (const d of monthData) dataMap[d.month] = { income: parseFloat(d.income), expense: parseFloat(d.expense) };

    const csvRows: string[] = ["Mes,Ingresos,Gastos,Balance"];
    for (let i = 11; i >= 0; i--) {
      const mo = tm - i;
      const yr = mo <= 0 ? ty - 1 : ty;
      const realMo = mo <= 0 ? mo + 12 : mo;
      const monthStr = `${yr}-${String(realMo).padStart(2, "0")}`;
      const d = dataMap[monthStr] ?? { income: 0, expense: 0 };
      csvRows.push(`${monthStr},${Math.round(d.income)},${Math.round(d.expense)},${Math.round(d.income - d.expense)}`);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="resumen_mensual_${today}.csv"`);
    res.send("\uFEFF" + csvRows.join("\n"));
  } catch (err) { logger.error({ err }, "finance export summary"); res.status(500).json({ error: "Error al exportar resumen" }); }
});

export default router;
