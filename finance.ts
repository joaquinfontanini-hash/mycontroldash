import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, gte, lte, sql, asc } from "drizzle-orm";
import { z } from "zod";
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
import {
  requireAuth,
  assertOwnership,
  getCurrentUserId,
} from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Constantes de dominio ─────────────────────────────────────────────────────
const ACCOUNT_TYPES = [
  "caja",
  "banco",
  "billetera_virtual",
  "tarjeta",
  "cripto",
  "inversiones",
  "deuda",
] as const;

const TX_TYPES       = ["income", "expense"] as const;
const FREQUENCIES    = ["weekly", "monthly", "annual"] as const;
const LOAN_STATUSES  = ["active", "paid", "defaulted"] as const;
const GOAL_TYPES     = ["ahorro", "inversion", "deuda", "otro"] as const;

// ── Categorías default (ARS, estudio contable argentino) ──────────────────────
const DEFAULT_INCOME_CATEGORIES = [
  { type: "income", name: "Sueldo",      icon: "briefcase",   color: "#10b981", sortOrder: 0 },
  { type: "income", name: "Clientes",    icon: "users",       color: "#3b82f6", sortOrder: 1 },
  { type: "income", name: "Ventas",      icon: "tag",         color: "#8b5cf6", sortOrder: 2 },
  { type: "income", name: "Extras",      icon: "star",        color: "#f59e0b", sortOrder: 3 },
  { type: "income", name: "Reintegros",  icon: "rotate-ccw",  color: "#06b6d4", sortOrder: 4 },
  { type: "income", name: "Otros",       icon: "circle",      color: "#6b7280", sortOrder: 5 },
] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  { type: "expense", name: "Hogar",          icon: "home",         color: "#ef4444", sortOrder: 0  },
  { type: "expense", name: "Servicios",      icon: "zap",          color: "#f97316", sortOrder: 1  },
  { type: "expense", name: "Supermercado",   icon: "shopping-cart", color: "#eab308", sortOrder: 2 },
  { type: "expense", name: "Transporte",     icon: "car",          color: "#84cc16", sortOrder: 3  },
  { type: "expense", name: "Salud",          icon: "heart",        color: "#ec4899", sortOrder: 4  },
  { type: "expense", name: "Educación",      icon: "book-open",    color: "#8b5cf6", sortOrder: 5  },
  { type: "expense", name: "Hijos",          icon: "baby",         color: "#f59e0b", sortOrder: 6  },
  { type: "expense", name: "Mascotas",       icon: "paw-print",    color: "#78716c", sortOrder: 7  },
  { type: "expense", name: "Salidas",        icon: "coffee",       color: "#14b8a6", sortOrder: 8  },
  { type: "expense", name: "Ropa",           icon: "shirt",        color: "#a78bfa", sortOrder: 9  },
  { type: "expense", name: "Impuestos",      icon: "file-text",    color: "#64748b", sortOrder: 10 },
  { type: "expense", name: "Suscripciones",  icon: "repeat",       color: "#06b6d4", sortOrder: 11 },
  { type: "expense", name: "Tarjetas",       icon: "credit-card",  color: "#f43f5e", sortOrder: 12 },
  { type: "expense", name: "Préstamos",      icon: "landmark",     color: "#0ea5e9", sortOrder: 13 },
  { type: "expense", name: "Otros",          icon: "circle",       color: "#6b7280", sortOrder: 14 },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function monthRange(dateStr: string): { start: string; end: string } {
  const [yr, mo] = dateStr.split("-") as [string, string];
  const start = `${yr}-${mo}-01`;
  const lastDay = new Date(parseInt(yr, 10), parseInt(mo, 10), 0).getDate();
  return { start, end: `${yr}-${mo}-${String(lastDay).padStart(2, "0")}` };
}

function nextOccurrenceDate(day: number, referenceDate: string): string {
  const [yr, mo] = referenceDate.split("-").map(Number) as [number, number];
  const candidate = `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (candidate >= referenceDate) return candidate;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextYr = mo === 12 ? yr + 1 : yr;
  return `${nextYr}-${String(nextMo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function ensureDefaultCategories(userId: string): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(financeCategoriesTable)
    .where(eq(financeCategoriesTable.userId, userId));
  if (Number(count) > 0) return;

  const defaults = [
    ...DEFAULT_INCOME_CATEGORIES,
    ...DEFAULT_EXPENSE_CATEGORIES,
  ].map((c) => ({ ...c, userId, isDefault: true }));
  await db.insert(financeCategoriesTable).values(defaults);
}

async function applyAccountDelta(
  accountId: number,
  delta: number,
): Promise<void> {
  const [acct] = await db
    .select()
    .from(financeAccountsTable)
    .where(eq(financeAccountsTable.id, accountId));
  if (!acct) return;
  const newAmount = parseFloat(acct.amount ?? "0") + delta;
  await db
    .update(financeAccountsTable)
    .set({ amount: String(newAmount) })
    .where(eq(financeAccountsTable.id, accountId));
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe tener formato YYYY-MM-DD");

const AmountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
    message: "El monto debe ser un número positivo",
  });

const CategoryCreateSchema = z.object({
  type:  z.enum(TX_TYPES),
  name:  z.string().trim().min(1, "El nombre es requerido").max(100),
  icon:  z.string().optional().default("circle"),
  color: z.string().optional().default("#6b7280"),
});

const TransactionQuerySchema = z.object({
  type:       z.enum(TX_TYPES).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  accountId:  z.coerce.number().int().positive().optional(),
  cardId:     z.coerce.number().int().positive().optional(),
  status:     z.string().optional(),
  from:       DateString.optional(),
  to:         DateString.optional(),
  limit:      z.coerce.number().int().min(1).max(500).optional().default(100),
  offset:     z.coerce.number().int().min(0).optional().default(0),
});

const TransactionCreateSchema = z.object({
  type:               z.enum(TX_TYPES),
  amount:             AmountSchema,
  currency:           z.string().optional().default("ARS"),
  categoryId:         z.coerce.number().int().positive().optional().nullable(),
  accountId:          z.coerce.number().int().positive().optional().nullable(),
  cardId:             z.coerce.number().int().positive().optional().nullable(),
  installmentPlanId:  z.coerce.number().int().positive().optional().nullable(),
  date:               DateString,
  status:             z.enum(["confirmed", "pending", "cancelled"]).optional().default("confirmed"),
  paymentMethod:      z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
  isFixed:            z.boolean().optional().default(false),
  isRecurring:        z.boolean().optional().default(false),
  recurringRuleId:    z.coerce.number().int().positive().optional().nullable(),
});

const TransactionUpdateSchema = TransactionCreateSchema.partial();

const RecurringRuleCreateSchema = z.object({
  name:        z.string().trim().min(1),
  type:        z.enum(TX_TYPES),
  amount:      AmountSchema,
  currency:    z.string().optional().default("ARS"),
  categoryId:  z.coerce.number().int().positive().optional().nullable(),
  accountId:   z.coerce.number().int().positive().optional().nullable(),
  frequency:   z.enum(FREQUENCIES),
  dayOfMonth:  z.coerce.number().int().min(1).max(31).optional().nullable(),
  nextDate:    DateString.optional(),
  notes:       z.string().optional().nullable(),
});

const RecurringRuleUpdateSchema = RecurringRuleCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const CardCreateSchema = z.object({
  name:        z.string().trim().min(1),
  bank:        z.string().optional().nullable(),
  lastFour:    z.string().max(4).optional().nullable(),
  color:       z.string().optional().default("#6366f1"),
  closeDay:    z.coerce.number().int().min(1).max(31),
  dueDay:      z.coerce.number().int().min(1).max(31),
  creditLimit: AmountSchema.optional().nullable(),
  currency:    z.string().optional().default("ARS"),
  notes:       z.string().optional().nullable(),
});

const CardUpdateSchema = CardCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const InstallmentPlanCreateSchema = z.object({
  description:        z.string().trim().min(1),
  totalAmount:        AmountSchema,
  installmentAmount:  AmountSchema,
  totalInstallments:  z.coerce.number().int().min(1),
  paidInstallments:   z.coerce.number().int().min(0).optional().default(0),
  startDate:          DateString,
  nextDueDate:        DateString.optional().nullable(),
  cardId:             z.coerce.number().int().positive().optional().nullable(),
  categoryId:         z.coerce.number().int().positive().optional().nullable(),
  currency:           z.string().optional().default("ARS"),
  notes:              z.string().optional().nullable(),
});

const InstallmentPlanUpdateSchema = InstallmentPlanCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const LoanCreateSchema = z.object({
  name:               z.string().trim().min(1),
  creditor:           z.string().optional().nullable(),
  totalAmount:        AmountSchema,
  totalInstallments:  z.coerce.number().int().min(1),
  installmentAmount:  AmountSchema,
  paidInstallments:   z.coerce.number().int().min(0).optional().default(0),
  startDate:          DateString,
  nextDueDate:        DateString.optional().nullable(),
  status:             z.enum(LOAN_STATUSES).optional().default("active"),
  currency:           z.string().optional().default("ARS"),
  notes:              z.string().optional().nullable(),
});

const LoanUpdateSchema = LoanCreateSchema.partial();

const BudgetCreateSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  month:      z.string().regex(/^\d{4}-\d{2}$/, "Mes debe tener formato YYYY-MM"),
  amount:     AmountSchema,
  currency:   z.string().optional().default("ARS"),
});

const GoalCreateSchema = z.object({
  type:          z.enum(GOAL_TYPES),
  title:         z.string().trim().min(1),
  targetAmount:  AmountSchema,
  currentAmount: AmountSchema.optional(),
  targetDate:    DateString.optional().nullable(),
  categoryId:    z.coerce.number().int().positive().optional().nullable(),
  currency:      z.string().optional().default("ARS"),
  notes:         z.string().optional().nullable(),
});

const GoalUpdateSchema = GoalCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const AccountCreateSchema = z.object({
  type:     z.enum(ACCOUNT_TYPES),
  label:    z.string().trim().min(1),
  amount:   AmountSchema.optional().default("0"),
  currency: z.string().optional().default("ARS"),
  notes:    z.string().optional().nullable(),
});

const AccountUpdateSchema = AccountCreateSchema.partial();

// ── CATEGORIES ─────────────────────────────────────────────────────────────────

router.get("/finance/categories", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    await ensureDefaultCategories(userId);
    const cats = await db
      .select()
      .from(financeCategoriesTable)
      .where(eq(financeCategoriesTable.userId, userId))
      .orderBy(financeCategoriesTable.type, financeCategoriesTable.sortOrder);
    res.json(cats);
  } catch (err) {
    logger.error({ err }, "finance categories fetch");
    res.status(500).json({ error: "Error al cargar categorías" });
  }
});

router.post("/finance/categories", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = CategoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [cat] = await db
      .insert(financeCategoriesTable)
      .values({ ...parsed.data, userId, isDefault: false })
      .returning();
    res.status(201).json(cat);
  } catch (err) {
    logger.error({ err }, "finance category create");
    res.status(500).json({ error: "Error al crear categoría" });
  }
});

router.delete("/finance/categories/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeCategoriesTable)
      .where(eq(financeCategoriesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Categoría no encontrada" }); return; }
    if (existing.userId && !assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeCategoriesTable).where(eq(financeCategoriesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance category delete");
    res.status(500).json({ error: "Error al eliminar categoría" });
  }
});

// ── ACCOUNTS ──────────────────────────────────────────────────────────────────

router.get("/finance/accounts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const accounts = await db
      .select()
      .from(financeAccountsTable)
      .where(eq(financeAccountsTable.userId, userId))
      .orderBy(financeAccountsTable.createdAt);
    res.json(accounts);
  } catch (err) {
    logger.error({ err }, "finance accounts fetch");
    res.status(500).json({ error: "Error al cargar cuentas" });
  }
});

router.post("/finance/accounts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = AccountCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [account] = await db
      .insert(financeAccountsTable)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(account);
  } catch (err) {
    logger.error({ err }, "finance account create");
    res.status(500).json({ error: "Error al crear cuenta" });
  }
});

router.put("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = AccountUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeAccountsTable)
      .where(eq(financeAccountsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeAccountsTable)
      .set(parsed.data)
      .where(eq(financeAccountsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance account update");
    res.status(500).json({ error: "Error al actualizar cuenta" });
  }
});

router.delete("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeAccountsTable)
      .where(eq(financeAccountsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeAccountsTable).where(eq(financeAccountsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance account delete");
    res.status(500).json({ error: "Error al eliminar cuenta" });
  }
});

// ── TRANSACTIONS ───────────────────────────────────────────────────────────────

router.get("/finance/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const q = TransactionQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.issues[0]?.message ?? "Query params inválidos" });
      return;
    }
    const { type, categoryId, accountId, cardId, status, from, to, limit, offset } = q.data;

    const conditions = [eq(financeTransactionsTable.userId, userId)];
    if (type)       conditions.push(eq(financeTransactionsTable.type, type));
    if (categoryId) conditions.push(eq(financeTransactionsTable.categoryId, categoryId));
    if (accountId)  conditions.push(eq(financeTransactionsTable.accountId, accountId));
    if (cardId)     conditions.push(eq(financeTransactionsTable.cardId, cardId));
    if (status)     conditions.push(eq(financeTransactionsTable.status, status));
    if (from)       conditions.push(gte(financeTransactionsTable.date, from));
    if (to)         conditions.push(lte(financeTransactionsTable.date, to));

    const where = and(...conditions);
    const [transactions, [{ count }]] = await Promise.all([
      db
        .select()
        .from(financeTransactionsTable)
        .where(where)
        .orderBy(
          desc(financeTransactionsTable.date),
          desc(financeTransactionsTable.id),
        )
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(financeTransactionsTable)
        .where(where),
    ]);

    res.json({ transactions, total: Number(count) });
  } catch (err) {
    logger.error({ err }, "finance transactions fetch");
    res.status(500).json({ error: "Error al cargar movimientos" });
  }
});

router.post("/finance/transactions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = TransactionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const data = parsed.data;

    const [tx] = await db
      .insert(financeTransactionsTable)
      .values({ ...data, userId })
      .returning();

    // Actualizar saldo de cuenta si la transacción es confirmada
    if (data.accountId && data.status === "confirmed") {
      const delta =
        data.type === "income"
          ? parseFloat(data.amount)
          : -parseFloat(data.amount);
      await applyAccountDelta(data.accountId, delta);
    }

    res.status(201).json(tx);
  } catch (err) {
    logger.error({ err }, "finance transaction create");
    res.status(500).json({ error: "Error al crear movimiento" });
  }
});

router.put("/finance/transactions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = TransactionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeTransactionsTable)
      .where(eq(financeTransactionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Movimiento no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const updates = parsed.data;
    const prevStatus    = existing.status;
    const nextStatus    = updates.status    ?? prevStatus;
    const prevAccountId = existing.accountId;
    const nextAccountId = "accountId" in updates ? updates.accountId : prevAccountId;
    const prevAmount    = parseFloat(existing.amount);
    const nextAmount    = updates.amount !== undefined ? parseFloat(updates.amount) : prevAmount;
    const prevType      = existing.type;
    const nextType      = updates.type ?? prevType;

    // Revertir efecto anterior sobre la cuenta
    if (prevStatus === "confirmed" && prevAccountId) {
      const reverseDelta = prevType === "income" ? -prevAmount : prevAmount;
      await applyAccountDelta(prevAccountId, reverseDelta);
    }

    const [updated] = await db
      .update(financeTransactionsTable)
      .set(updates)
      .where(eq(financeTransactionsTable.id, id))
      .returning();

    // Aplicar nuevo efecto sobre la cuenta
    if (nextStatus === "confirmed" && nextAccountId) {
      const applyDelta = nextType === "income" ? nextAmount : -nextAmount;
      await applyAccountDelta(nextAccountId, applyDelta);
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance transaction update");
    res.status(500).json({ error: "Error al actualizar movimiento" });
  }
});

router.delete("/finance/transactions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeTransactionsTable)
      .where(eq(financeTransactionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Movimiento no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    if (existing.accountId && existing.status === "confirmed") {
      const reverseDelta =
        existing.type === "income"
          ? -parseFloat(existing.amount)
          : parseFloat(existing.amount);
      await applyAccountDelta(existing.accountId, reverseDelta);
    }

    await db.delete(financeTransactionsTable).where(eq(financeTransactionsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance transaction delete");
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

// ── RECURRING RULES ────────────────────────────────────────────────────────────

router.get("/finance/recurring-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const rules = await db
      .select()
      .from(financeRecurringRulesTable)
      .where(eq(financeRecurringRulesTable.userId, userId))
      .orderBy(financeRecurringRulesTable.nextDate);
    res.json(rules);
  } catch (err) {
    logger.error({ err }, "finance recurring rules fetch");
    res.status(500).json({ error: "Error al cargar reglas recurrentes" });
  }
});

router.post("/finance/recurring-rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = RecurringRuleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [rule] = await db
      .insert(financeRecurringRulesTable)
      .values({ ...parsed.data, userId, isActive: true, nextDate: parsed.data.nextDate ?? todayStr() })
      .returning();
    res.status(201).json(rule);
  } catch (err) {
    logger.error({ err }, "finance recurring rule create");
    res.status(500).json({ error: "Error al crear regla recurrente" });
  }
});

router.put("/finance/recurring-rules/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = RecurringRuleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeRecurringRulesTable)
      .where(eq(financeRecurringRulesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Regla no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeRecurringRulesTable)
      .set(parsed.data)
      .where(eq(financeRecurringRulesTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance recurring rule update");
    res.status(500).json({ error: "Error al actualizar regla recurrente" });
  }
});

router.delete("/finance/recurring-rules/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeRecurringRulesTable)
      .where(eq(financeRecurringRulesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Regla no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance recurring rule delete");
    res.status(500).json({ error: "Error al eliminar regla recurrente" });
  }
});

// ── CARDS ──────────────────────────────────────────────────────────────────────

router.get("/finance/cards", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const cards = await db
      .select()
      .from(financeCardsTable)
      .where(eq(financeCardsTable.userId, userId))
      .orderBy(financeCardsTable.createdAt);
    res.json(cards);
  } catch (err) {
    logger.error({ err }, "finance cards fetch");
    res.status(500).json({ error: "Error al cargar tarjetas" });
  }
});

router.post("/finance/cards", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = CardCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [card] = await db
      .insert(financeCardsTable)
      .values({ ...parsed.data, userId, isActive: true })
      .returning();
    res.status(201).json(card);
  } catch (err) {
    logger.error({ err }, "finance card create");
    res.status(500).json({ error: "Error al crear tarjeta" });
  }
});

router.put("/finance/cards/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = CardUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeCardsTable)
      .where(eq(financeCardsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tarjeta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeCardsTable)
      .set(parsed.data)
      .where(eq(financeCardsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance card update");
    res.status(500).json({ error: "Error al actualizar tarjeta" });
  }
});

router.delete("/finance/cards/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeCardsTable)
      .where(eq(financeCardsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tarjeta no encontrada" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeCardsTable).where(eq(financeCardsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance card delete");
    res.status(500).json({ error: "Error al eliminar tarjeta" });
  }
});

// Resumen del período actual de una tarjeta específica
router.get("/finance/cards/:id/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [card] = await db
      .select()
      .from(financeCardsTable)
      .where(eq(financeCardsTable.id, id));
    if (!card) { res.status(404).json({ error: "Tarjeta no encontrada" }); return; }
    if (!assertOwnership(req, res, card.userId)) return;

    const today = todayStr();
    const [yr, mo] = today.split("-").map(Number) as [number, number];
    const dayOfMonth = parseInt(today.slice(8), 10);
    const lastCloseMo =
      card.closeDay >= dayOfMonth ? (mo === 1 ? 12 : mo - 1) : mo;
    const lastCloseYr = lastCloseMo === 12 && mo === 1 ? yr - 1 : yr;
    const periodStart = `${lastCloseYr}-${String(lastCloseMo).padStart(2, "0")}-${String(card.closeDay).padStart(2, "0")}`;

    const [{ total }] = await db
      .select({
        total: sql<string>`coalesce(sum(amount::numeric), 0)`,
      })
      .from(financeTransactionsTable)
      .where(
        and(
          eq(financeTransactionsTable.cardId, id),
          eq(financeTransactionsTable.type, "expense"),
          gte(financeTransactionsTable.date, periodStart),
          sql`${financeTransactionsTable.status} != 'cancelled'`,
        ),
      );

    const nextDueDate   = nextOccurrenceDate(card.dueDay, today);
    const nextCloseDate = nextOccurrenceDate(card.closeDay, today);

    res.json({
      periodStart,
      totalSpent:     parseFloat(total ?? "0"),
      nextDueDate,
      nextCloseDate,
    });
  } catch (err) {
    logger.error({ err }, "finance card summary");
    res.status(500).json({ error: "Error al calcular resumen de tarjeta" });
  }
});

// ── INSTALLMENT PLANS ──────────────────────────────────────────────────────────

router.get("/finance/installment-plans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const plans = await db
      .select()
      .from(financeInstallmentPlansTable)
      .where(eq(financeInstallmentPlansTable.userId, userId))
      .orderBy(financeInstallmentPlansTable.nextDueDate);
    res.json(plans);
  } catch (err) {
    logger.error({ err }, "finance installment plans fetch");
    res.status(500).json({ error: "Error al cargar planes de cuotas" });
  }
});

router.post("/finance/installment-plans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = InstallmentPlanCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [plan] = await db
      .insert(financeInstallmentPlansTable)
      .values({ ...parsed.data, userId, isActive: true })
      .returning();
    res.status(201).json(plan);
  } catch (err) {
    logger.error({ err }, "finance installment plan create");
    res.status(500).json({ error: "Error al crear plan de cuotas" });
  }
});

router.put("/finance/installment-plans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = InstallmentPlanUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeInstallmentPlansTable)
      .where(eq(financeInstallmentPlansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Plan no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeInstallmentPlansTable)
      .set(parsed.data)
      .where(eq(financeInstallmentPlansTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance installment plan update");
    res.status(500).json({ error: "Error al actualizar plan de cuotas" });
  }
});

router.delete("/finance/installment-plans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeInstallmentPlansTable)
      .where(eq(financeInstallmentPlansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Plan no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeInstallmentPlansTable).where(eq(financeInstallmentPlansTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance installment plan delete");
    res.status(500).json({ error: "Error al eliminar plan de cuotas" });
  }
});

// ── LOANS ──────────────────────────────────────────────────────────────────────

router.get("/finance/loans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const loans = await db
      .select()
      .from(financeLoansTable)
      .where(eq(financeLoansTable.userId, userId))
      .orderBy(financeLoansTable.nextDueDate);
    res.json(loans);
  } catch (err) {
    logger.error({ err }, "finance loans fetch");
    res.status(500).json({ error: "Error al cargar préstamos" });
  }
});

router.post("/finance/loans", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = LoanCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [loan] = await db
      .insert(financeLoansTable)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(loan);
  } catch (err) {
    logger.error({ err }, "finance loan create");
    res.status(500).json({ error: "Error al crear préstamo" });
  }
});

router.put("/finance/loans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = LoanUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeLoansTable)
      .where(eq(financeLoansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Préstamo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeLoansTable)
      .set(parsed.data)
      .where(eq(financeLoansTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance loan update");
    res.status(500).json({ error: "Error al actualizar préstamo" });
  }
});

router.delete("/finance/loans/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeLoansTable)
      .where(eq(financeLoansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Préstamo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeLoansTable).where(eq(financeLoansTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance loan delete");
    res.status(500).json({ error: "Error al eliminar préstamo" });
  }
});

// ── BUDGETS ────────────────────────────────────────────────────────────────────

router.get("/finance/budgets", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const monthParam =
      typeof req.query["month"] === "string" ? req.query["month"] : undefined;

    const conditions = [eq(financeBudgetsTable.userId, userId)];
    if (monthParam) conditions.push(eq(financeBudgetsTable.month, monthParam));

    const budgets = await db
      .select()
      .from(financeBudgetsTable)
      .where(and(...conditions))
      .orderBy(financeBudgetsTable.month, financeBudgetsTable.categoryId);
    res.json(budgets);
  } catch (err) {
    logger.error({ err }, "finance budgets fetch");
    res.status(500).json({ error: "Error al cargar presupuestos" });
  }
});

router.post("/finance/budgets", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = BudgetCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    // Upsert: si ya existe para (userId, categoryId, month) se reemplaza
    const [budget] = await db
      .insert(financeBudgetsTable)
      .values({ ...parsed.data, userId })
      .onConflictDoUpdate({
        target: [
          financeBudgetsTable.userId,
          financeBudgetsTable.categoryId,
          financeBudgetsTable.month,
        ],
        set: { amount: parsed.data.amount },
      })
      .returning();
    res.status(201).json(budget);
  } catch (err) {
    logger.error({ err }, "finance budget create");
    res.status(500).json({ error: "Error al crear presupuesto" });
  }
});

router.delete("/finance/budgets/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeBudgetsTable)
      .where(eq(financeBudgetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Presupuesto no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeBudgetsTable).where(eq(financeBudgetsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance budget delete");
    res.status(500).json({ error: "Error al eliminar presupuesto" });
  }
});

// ── GOALS ──────────────────────────────────────────────────────────────────────

router.get("/finance/goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const goals = await db
      .select()
      .from(financeGoalsTable)
      .where(eq(financeGoalsTable.userId, userId))
      .orderBy(financeGoalsTable.createdAt);
    res.json(goals);
  } catch (err) {
    logger.error({ err }, "finance goals fetch");
    res.status(500).json({ error: "Error al cargar objetivos" });
  }
});

router.post("/finance/goals", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = GoalCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }
    const userId = getCurrentUserId(req);
    const [goal] = await db
      .insert(financeGoalsTable)
      .values({ ...parsed.data, userId, isActive: true })
      .returning();
    res.status(201).json(goal);
  } catch (err) {
    logger.error({ err }, "finance goal create");
    res.status(500).json({ error: "Error al crear objetivo" });
  }
});

router.put("/finance/goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const parsed = GoalUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const [existing] = await db
      .select()
      .from(financeGoalsTable)
      .where(eq(financeGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Objetivo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    const [updated] = await db
      .update(financeGoalsTable)
      .set(parsed.data)
      .where(eq(financeGoalsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance goal update");
    res.status(500).json({ error: "Error al actualizar objetivo" });
  }
});

router.delete("/finance/goals/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params["id"]);
    if (!id) { res.status(400).json({ error: "ID inválido" }); return; }

    const [existing] = await db
      .select()
      .from(financeGoalsTable)
      .where(eq(financeGoalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Objetivo no encontrado" }); return; }
    if (!assertOwnership(req, res, existing.userId)) return;

    await db.delete(financeGoalsTable).where(eq(financeGoalsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance goal delete");
    res.status(500).json({ error: "Error al eliminar objetivo" });
  }
});

// ── SUMMARY ────────────────────────────────────────────────────────────────────
// Resumen financiero del mes actual: ingresos, egresos, balance, evolución

router.get("/finance/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const monthParam =
      typeof req.query["month"] === "string"
        ? req.query["month"]
        : todayStr().slice(0, 7);

    const { start, end } = monthRange(monthParam + "-01");

    const [incomeAgg, expenseAgg, accounts, budgets, goals] = await Promise.all([
      db
        .select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable)
        .where(
          and(
            eq(financeTransactionsTable.userId, userId),
            eq(financeTransactionsTable.type, "income"),
            eq(financeTransactionsTable.status, "confirmed"),
            gte(financeTransactionsTable.date, start),
            lte(financeTransactionsTable.date, end),
          ),
        ),
      db
        .select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
        .from(financeTransactionsTable)
        .where(
          and(
            eq(financeTransactionsTable.userId, userId),
            eq(financeTransactionsTable.type, "expense"),
            eq(financeTransactionsTable.status, "confirmed"),
            gte(financeTransactionsTable.date, start),
            lte(financeTransactionsTable.date, end),
          ),
        ),
      db
        .select()
        .from(financeAccountsTable)
        .where(eq(financeAccountsTable.userId, userId)),
      db
        .select()
        .from(financeBudgetsTable)
        .where(
          and(
            eq(financeBudgetsTable.userId, userId),
            eq(financeBudgetsTable.month, monthParam),
          ),
        ),
      db
        .select()
        .from(financeGoalsTable)
        .where(
          and(
            eq(financeGoalsTable.userId, userId),
            eq(financeGoalsTable.isActive, true),
          ),
        ),
    ]);

    const totalIncome  = parseFloat(incomeAgg[0]?.total ?? "0");
    const totalExpense = parseFloat(expenseAgg[0]?.total ?? "0");
    const balance      = totalIncome - totalExpense;

    const totalAssets = accounts.reduce(
      (sum, a) => sum + parseFloat(a.amount ?? "0"),
      0,
    );

    res.json({
      month:         monthParam,
      totalIncome,
      totalExpense,
      balance,
      totalAssets,
      accountsCount: accounts.length,
      budgetsCount:  budgets.length,
      goalsCount:    goals.length,
      savingsRate:
        totalIncome > 0
          ? Math.round((balance / totalIncome) * 100 * 10) / 10
          : 0,
    });
  } catch (err) {
    logger.error({ err }, "finance summary");
    res.status(500).json({ error: "Error al calcular resumen financiero" });
  }
});

// ── CONFIG ─────────────────────────────────────────────────────────────────────

router.get("/finance/config", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await db.select().from(financeConfigTable);
    const map = Object.fromEntries(config.map((c) => [c.key, c.value]));
    res.json(map);
  } catch (err) {
    logger.error({ err }, "finance config fetch");
    res.status(500).json({ error: "Error al cargar configuración" });
  }
});

router.put("/finance/config/:key", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params["key"];
    if (!key) { res.status(400).json({ error: "Clave requerida" }); return; }

    const valueSchema = z.object({ value: z.string().min(1) });
    const parsed = valueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "El valor es requerido" });
      return;
    }

    const [entry] = await db
      .insert(financeConfigTable)
      .values({ key, value: parsed.data.value })
      .onConflictDoUpdate({
        target: financeConfigTable.key,
        set: { value: parsed.data.value },
      })
      .returning();
    res.json(entry);
  } catch (err) {
    logger.error({ err }, "finance config update");
    res.status(500).json({ error: "Error al actualizar configuración" });
  }
});

export default router;
