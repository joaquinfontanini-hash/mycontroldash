import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Wallet, Plus, Pencil, Trash2, RefreshCw,
  ArrowUpCircle, ArrowDownCircle, Calendar, AlertTriangle,
  Clock, Repeat, ChevronDown, X, Filter, Sparkles, Building2,
  CreditCard, Smartphone, DollarSign, PieChart, Landmark,
  Pause, Play, CheckCircle2, Info, Zap,
  Target, BarChart2, Layers, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── TYPES ────────────────────────────────────────────────────────────────

interface FinanceCategory { id: number; type: string; name: string; icon: string; color: string; isDefault: boolean; }
interface FinanceAccount { id: number; type: string; label: string; amount: string; currency: string; notes: string | null; }
interface FinanceTransaction {
  id: number; type: string; amount: number; currency: string;
  categoryId: number | null; accountId: number | null; cardId: number | null; date: string;
  status: string; paymentMethod: string | null; notes: string | null;
  isFixed: boolean; isRecurring: boolean;
  category: { name: string; color: string; icon: string } | null;
}
interface FinanceRecurringRule {
  id: number; name: string; type: string; amount: string; currency: string;
  categoryId: number | null; accountId: number | null; frequency: string;
  dayOfMonth: number | null; nextDate: string | null; isActive: boolean; notes: string | null;
}
interface FinanceCard {
  id: number; name: string; bank: string | null; lastFour: string | null; color: string;
  closeDay: number; dueDay: number; creditLimit: string | null; currency: string; isActive: boolean; notes: string | null;
  totalSpent?: number; pendingInstallments?: number; nextDueDate?: string; nextCloseDate?: string;
  isClosingSoon?: boolean; isDueSoon?: boolean;
}
interface FinanceInstallmentPlan {
  id: number; description: string; totalAmount: number; installmentAmount: number;
  totalInstallments: number; paidInstallments: number; startDate: string;
  nextDueDate: string | null; cardId: number | null; categoryId: number | null;
  currency: string; isActive: boolean; notes: string | null;
}
interface FinanceLoan {
  id: number; name: string; creditor: string | null; totalAmount: number;
  totalInstallments: number; installmentAmount: number; paidInstallments: number;
  startDate: string; nextDueDate: string | null; status: string; currency: string; notes: string | null;
}
interface CategoryBreakdown { categoryId: number | null; name: string; color: string; total: number; }
interface Compromisos { total: number; recurring: number; installments: number; loans: number; saldoLibre: number; presionFinanciera: "green" | "yellow" | "red"; }
interface UpcomingPayment { label: string; amount: number; dueDate: string | null; type: "card" | "loan" | "installment"; color: string; }
interface FinanceSummary {
  ingresosMes: number; gastosMes: number; saldoEstimadoFinMes: number; saldoDisponible: number;
  activos: number; deudas: number; hasData: boolean;
  accounts: FinanceAccount[];
  cards: FinanceCard[];
  loans: FinanceLoan[];
  installmentPlans: FinanceInstallmentPlan[];
  compromisos: Compromisos;
  upcomingPayments: UpcomingPayment[];
  upcomingRecurrences: { id: number; name: string; type: string; amount: number; frequency: string; nextDate: string | null; category: { name: string; color: string } | null }[];
  recentTransactions: FinanceTransaction[];
  categoryBreakdown: CategoryBreakdown[];
  alerts: { level: "green" | "yellow" | "red"; message: string }[];
}

interface BudgetWithSpending {
  id: number; userId: string; categoryId: number; month: string; amount: number; currency: string;
  spent: number; remaining: number; pct: number;
  status: "ok" | "warning" | "critical" | "exceeded";
  category: { name: string; color: string; icon: string } | null;
}
interface BudgetsData { budgets: BudgetWithSpending[]; totalBudgeted: number; totalSpent: number; month: string; }
interface CalendarEvent { date: string; label: string; amount: number; type: "income" | "expense"; category: string; icon: string; }
interface ProjectionPoint { date: string; saldo: number; events: CalendarEvent[]; }
interface ProjectionData {
  saldoActual: number;
  projection7d: { saldo: number; risk: "low" | "medium" | "high" };
  projection15d: { saldo: number; risk: "low" | "medium" | "high" };
  projectionMonthEnd: { saldo: number; risk: "low" | "medium" | "high" };
  dailySeries: ProjectionPoint[];
  calendarEvents: CalendarEvent[];
  highPressureDays: { date: string; totalExpenses: number }[];
}
interface Insight { id: string; icon: string; text: string; level: "info" | "warning" | "red" | "green"; }
interface InsightsData { insights: Insight[]; }

// ─── HELPERS ──────────────────────────────────────────────────────────────

function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtSigned(n: number) { return (n >= 0 ? "+" : "-") + fmt(n); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysUntil(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr).getTime() - new Date(todayStr()).getTime()) / 86400000);
  return diff;
}

const ACCOUNT_META: Record<string, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
  caja:              { label: "Efectivo",          icon: Wallet,        color: "text-emerald-600 dark:text-emerald-400", bgColor: "bg-emerald-100 dark:bg-emerald-900/30" },
  banco:             { label: "Banco",             icon: Building2,     color: "text-blue-600 dark:text-blue-400",       bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  billetera_virtual: { label: "Billetera Virtual", icon: Smartphone,    color: "text-violet-600 dark:text-violet-400",   bgColor: "bg-violet-100 dark:bg-violet-900/30" },
  tarjeta:           { label: "Tarjeta",           icon: CreditCard,    color: "text-amber-600 dark:text-amber-400",     bgColor: "bg-amber-100 dark:bg-amber-900/30" },
  cripto:            { label: "Cripto",            icon: DollarSign,    color: "text-orange-600 dark:text-orange-400",   bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  inversiones:       { label: "Inversiones",       icon: TrendingUp,    color: "text-indigo-600 dark:text-indigo-400",   bgColor: "bg-indigo-100 dark:bg-indigo-900/30" },
  deuda:             { label: "Deuda",             icon: AlertTriangle, color: "text-red-600 dark:text-red-400",         bgColor: "bg-red-100 dark:bg-red-900/30" },
};
const FREQ_LABEL: Record<string, string> = { weekly: "Semanal", monthly: "Mensual", annual: "Anual" };
const STATUS_META: Record<string, { label: string; color: string }> = {
  confirmed: { label: "Confirmado", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  pending:   { label: "Pendiente",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  expected:  { label: "Esperado",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  cancelled: { label: "Cancelado",  color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};
const LOAN_STATUS_META: Record<string, { label: string; color: string }> = {
  active:   { label: "Activo",    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  paid:     { label: "Pagado",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  defaulted:{ label: "En mora",   color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
};
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Débito", "Crédito", "Billetera virtual", "Cripto", "Otro"];
const CARD_COLORS = ["#6366f1","#f43f5e","#10b981","#f59e0b","#3b82f6","#8b5cf6","#0ea5e9","#64748b","#ec4899","#f97316"];

function AlertDot({ level }: { level: "green" | "yellow" | "red" }) {
  const c = level === "green" ? "bg-emerald-500" : level === "yellow" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${c}`} />;
}

// ─── SUMMARY CARD ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent, bgColor, icon: Icon }: {
  label: string; value: string; sub?: string; accent: string; bgColor: string; icon: React.ElementType;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${accent}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`rounded-xl p-2.5 shrink-0 ${bgColor}`}>
            <Icon className={`h-5 w-5 ${accent}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── PRESSURE METER ────────────────────────────────────────────────────────

function PressureMeter({ compromisos, income }: { compromisos: Compromisos; income: number }) {
  const { presionFinanciera, total, saldoLibre } = compromisos;
  const config = {
    green:  { label: "Presión financiera baja",   bg: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800", lightBg: "bg-emerald-50 dark:bg-emerald-950/20" },
    yellow: { label: "Presión financiera media",  bg: "bg-amber-500",   text: "text-amber-700 dark:text-amber-400",     border: "border-amber-200 dark:border-amber-800",     lightBg: "bg-amber-50 dark:bg-amber-950/20" },
    red:    { label: "Presión financiera alta",   bg: "bg-red-500",     text: "text-red-700 dark:text-red-400",         border: "border-red-200 dark:border-red-800",         lightBg: "bg-red-50 dark:bg-red-950/20" },
  };
  const c = config[presionFinanciera];
  const ratio = income > 0 ? Math.min((total / income) * 100, 100) : 0;

  return (
    <Card className={`border ${c.border} ${c.lightBg}`}>
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${c.bg}`} />
            <span className={`text-sm font-semibold ${c.text}`}>{c.label}</span>
          </div>
          {income > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(ratio)}% de ingresos comprometido</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Disponible</p>
            <p className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">{fmt(compromisos.saldoLibre + total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Comprometido</p>
            <p className={`text-lg font-bold tabular-nums ${presionFinanciera === "green" ? "text-amber-600 dark:text-amber-400" : c.text}`}>{fmt(total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Libre</p>
            <p className={`text-lg font-bold tabular-nums ${saldoLibre >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>{fmt(saldoLibre)}</p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${c.bg}`} style={{ width: `${ratio}%` }} />
        </div>
        {total > 0 && (
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground flex-wrap">
            {compromisos.recurring > 0 && <span>Recurrencias: {fmt(compromisos.recurring)}</span>}
            {compromisos.installments > 0 && <span>Cuotas: {fmt(compromisos.installments)}</span>}
            {compromisos.loans > 0 && <span>Préstamos: {fmt(compromisos.loans)}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── CATEGORY BREAKDOWN ────────────────────────────────────────────────────

function CategoryBreakdownSection({ breakdown, total }: { breakdown: CategoryBreakdown[]; total: number }) {
  if (!breakdown.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <PieChart className="h-4 w-4 text-muted-foreground" /> Gastos por categoría — este mes
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4 space-y-2.5">
        {breakdown.map(item => {
          const pct = total > 0 ? (item.total / total) * 100 : 0;
          return (
            <div key={item.categoryId ?? "sin"}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium" style={{ color: item.color }}>{item.name}</span>
                <span className="tabular-nums text-muted-foreground">{fmt(item.total)} <span className="opacity-60">({Math.round(pct)}%)</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: item.color }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── ONBOARDING EMPTY STATE ────────────────────────────────────────────────

function OnboardingCard({ onLoadDemo, onNewAccount, onNewTx, loading }: {
  onLoadDemo: () => void; onNewAccount: () => void; onNewTx: () => void; loading: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 px-8 text-center">
        <div className="h-16 w-16 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mx-auto mb-4">
          <Wallet className="h-8 w-8 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-lg font-bold mb-1">Empezá a registrar tus finanzas</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
          Llevá el control de ingresos, gastos, tarjetas y préstamos en un solo lugar.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onNewAccount} variant="outline" className="gap-1.5"><Building2 className="h-4 w-4" /> Crear cuenta</Button>
          <Button onClick={onNewTx} className="gap-1.5 bg-violet-600 hover:bg-violet-700"><Plus className="h-4 w-4" /> Primer movimiento</Button>
          <Button onClick={onLoadDemo} variant="ghost" disabled={loading} className="gap-1.5 text-muted-foreground text-xs">
            <Sparkles className="h-3.5 w-3.5" />{loading ? "Cargando..." : "Cargar datos de ejemplo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── DELETE CONFIRM DIALOG ─────────────────────────────────────────────────

function DeleteConfirmDialog({ open, onCancel, onConfirm, title, description }: {
  open: boolean; onCancel: () => void; onConfirm: () => void; title: string; description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" />{title}</DialogTitle></DialogHeader>
        {description && <p className="text-sm text-muted-foreground px-1">{description}</p>}
        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm}>Eliminar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── TRANSACTION MODAL ─────────────────────────────────────────────────────

interface TxFormState {
  type: "income" | "expense"; amount: string; categoryId: string; accountId: string; cardId: string;
  date: string; status: string; paymentMethod: string; notes: string; isFixed: boolean; isRecurring: boolean;
  recurFrequency: string; recurNextDate: string;
}
const emptyTxForm = (type: "income" | "expense" = "expense"): TxFormState => ({
  type, amount: "", categoryId: "", accountId: "", cardId: "", date: todayStr(),
  status: "confirmed", paymentMethod: "", notes: "", isFixed: false, isRecurring: false,
  recurFrequency: "monthly", recurNextDate: "",
});

function TransactionModal({ open, onClose, tx, categories, accounts, cards, onSaved }: {
  open: boolean; onClose: () => void; tx: FinanceTransaction | null;
  categories: FinanceCategory[]; accounts: FinanceAccount[]; cards: FinanceCard[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<TxFormState>(() =>
    tx ? {
      type: tx.type as "income" | "expense", amount: String(tx.amount),
      categoryId: tx.categoryId ? String(tx.categoryId) : "",
      accountId: tx.accountId ? String(tx.accountId) : "",
      cardId: tx.cardId ? String(tx.cardId) : "",
      date: tx.date, status: tx.status, paymentMethod: tx.paymentMethod ?? "",
      notes: tx.notes ?? "", isFixed: tx.isFixed, isRecurring: tx.isRecurring,
      recurFrequency: "monthly", recurNextDate: "",
    } : emptyTxForm()
  );
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof TxFormState, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const activeCats = categories.filter(c => c.type === form.type);
  const activeCards = cards.filter(c => c.isActive);

  async function handleSave() {
    if (!form.amount || parseFloat(form.amount) <= 0) { toast({ title: "Ingresá un monto válido", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type: form.type, amount: parseFloat(form.amount),
        categoryId: form.categoryId || null, accountId: form.accountId || null,
        cardId: form.cardId || null, date: form.date, status: form.status,
        paymentMethod: form.paymentMethod || null, notes: form.notes || null,
        isFixed: form.isFixed, isRecurring: form.isRecurring,
      };
      const url = tx ? `${BASE}/api/finance/transactions/${tx.id}` : `${BASE}/api/finance/transactions`;
      const r = await fetch(url, { method: tx ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      if (!tx && form.isRecurring && form.recurFrequency) {
        await fetch(`${BASE}/api/finance/recurring-rules`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.notes || (form.type === "income" ? "Ingreso recurrente" : "Gasto recurrente"), type: form.type, amount: parseFloat(form.amount), categoryId: form.categoryId || null, accountId: form.accountId || null, frequency: form.recurFrequency, nextDate: form.recurNextDate || null }),
        });
      }
      toast({ title: tx ? "Movimiento actualizado" : "Movimiento registrado" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{tx ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{tx ? "Editar movimiento" : "Nuevo movimiento"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex rounded-lg border overflow-hidden">
            {(["income", "expense"] as const).map(t => (
              <button key={t} onClick={() => { set("type", t); set("categoryId", ""); }}
                className={`flex-1 py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${form.type === t ? (t === "income" ? "bg-emerald-500 text-white" : "bg-red-500 text-white") : "bg-transparent text-muted-foreground hover:bg-muted"}`}>
                {t === "income" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                {t === "income" ? "Ingreso" : "Gasto"}
              </button>
            ))}
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <Input type="number" min="0" step="any" placeholder="0" value={form.amount} onChange={e => set("amount", e.target.value)} className="pl-7 text-lg font-bold h-12" autoFocus />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label>
              <Select value={form.categoryId} onValueChange={v => set("categoryId", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
                <SelectContent>{activeCats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Fecha</Label>
              <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuenta bancaria</Label>
              <Select value={form.accountId || "__none__"} onValueChange={v => { const val = v === "__none__" ? "" : v; set("accountId", val); if (val) set("cardId", ""); }}>
                <SelectTrigger><SelectValue placeholder="Sin cuenta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin cuenta</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Tarjeta de crédito</Label>
              <Select value={form.cardId || "__none__"} onValueChange={v => { const val = v === "__none__" ? "" : v; set("cardId", val); if (val) set("accountId", ""); }}>
                <SelectTrigger><SelectValue placeholder="Sin tarjeta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin tarjeta</SelectItem>
                  {activeCards.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Nota (opcional)</Label>
            <Input placeholder="Ej: Compra en supermercado" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
              <Checkbox checked={form.isFixed} onCheckedChange={v => set("isFixed", Boolean(v))} /> Fijo
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
              <Checkbox checked={form.isRecurring} onCheckedChange={v => { set("isRecurring", Boolean(v)); if (v) setAdvanced(true); }} /> Recurrente
            </label>
          </div>
          {form.isRecurring && (
            <div className="rounded-lg border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1"><Repeat className="h-3 w-3" /> Recurrencia</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Frecuencia</Label>
                  <Select value={form.recurFrequency} onValueChange={v => set("recurFrequency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Próxima fecha</Label>
                  <Input type="date" value={form.recurNextDate} onChange={e => set("recurNextDate", e.target.value)} />
                </div>
              </div>
            </div>
          )}
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setAdvanced(!advanced)}>
            <ChevronDown className={`h-3 w-3 transition-transform ${advanced ? "rotate-180" : ""}`} />
            {advanced ? "Menos opciones" : "Más opciones"}
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Estado</Label>
                <Select value={form.status} onValueChange={v => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmado</SelectItem>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="expected">Esperado</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Medio de pago</Label>
                <Select value={form.paymentMethod || "__none__"} onValueChange={v => set("paymentMethod", v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sin especificar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin especificar</SelectItem>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className={form.type === "income" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-500 hover:bg-red-600"}>
            {saving ? "Guardando..." : tx ? "Guardar cambios" : form.type === "income" ? "Registrar ingreso" : "Registrar gasto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ACCOUNT MODAL ─────────────────────────────────────────────────────────

function AccountModal({ open, onClose, acct, onSaved }: { open: boolean; onClose: () => void; acct: FinanceAccount | null; onSaved: () => void; }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ type: acct?.type ?? "banco", label: acct?.label ?? "", amount: acct?.amount ?? "0", currency: acct?.currency ?? "ARS", notes: acct?.notes ?? "" });
  const [saving, setSaving] = useState(false);
  async function handleSave() {
    if (!form.label) { toast({ title: "Ingresá un nombre", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = acct ? `${BASE}/api/finance/accounts/${acct.id}` : `${BASE}/api/finance/accounts`;
      const r = await fetch(url, { method: acct ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error();
      toast({ title: acct ? "Cuenta actualizada" : "Cuenta creada" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{acct ? "Editar cuenta" : "Nueva cuenta"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Tipo</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ACCOUNT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
            <Input placeholder="Ej: Cuenta corriente Galicia" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Saldo actual</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ARS">ARS</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="USDT">USDT</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Notas</Label>
            <Input placeholder="Opcional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : acct ? "Guardar" : "Crear cuenta"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CARD MODAL ────────────────────────────────────────────────────────────

function CardModal({ open, onClose, card, onSaved }: { open: boolean; onClose: () => void; card: FinanceCard | null; onSaved: () => void; }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: card?.name ?? "", bank: card?.bank ?? "", lastFour: card?.lastFour ?? "",
    color: card?.color ?? "#6366f1", closeDay: String(card?.closeDay ?? 1),
    dueDay: String(card?.dueDay ?? 10), creditLimit: card?.creditLimit ?? "", currency: card?.currency ?? "ARS", notes: card?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  async function handleSave() {
    if (!form.name || !form.closeDay || !form.dueDay) { toast({ title: "Nombre, cierre y vencimiento son obligatorios", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = card ? `${BASE}/api/finance/cards/${card.id}` : `${BASE}/api/finance/cards`;
      const r = await fetch(url, { method: card ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, creditLimit: form.creditLimit || null }) });
      if (!r.ok) throw new Error();
      toast({ title: card ? "Tarjeta actualizada" : "Tarjeta creada" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" />{card ? "Editar tarjeta" : "Nueva tarjeta"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
            <Input placeholder="Ej: Visa Galicia" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Banco / Emisor</Label>
              <Input placeholder="Ej: Galicia" value={form.bank} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Últimos 4 dígitos</Label>
              <Input placeholder="1234" maxLength={4} value={form.lastFour} onChange={e => setForm(f => ({ ...f, lastFour: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Día de cierre</Label>
              <Input type="number" min="1" max="31" placeholder="1-31" value={form.closeDay} onChange={e => setForm(f => ({ ...f, closeDay: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Día de vencimiento</Label>
              <Input type="number" min="1" max="31" placeholder="1-31" value={form.dueDay} onChange={e => setForm(f => ({ ...f, dueDay: e.target.value }))} />
            </div>
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Límite (opcional)</Label>
            <Input type="number" placeholder="Ej: 500000" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {CARD_COLORS.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`h-7 w-7 rounded-full transition-all ${form.color === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : "hover:scale-105"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : card ? "Guardar" : "Crear tarjeta"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── INSTALLMENT PLAN MODAL ────────────────────────────────────────────────

function InstallmentPlanModal({ open, onClose, plan, cards, categories, onSaved }: {
  open: boolean; onClose: () => void; plan: FinanceInstallmentPlan | null;
  cards: FinanceCard[]; categories: FinanceCategory[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    description: plan?.description ?? "", totalAmount: plan ? String(plan.totalAmount) : "",
    totalInstallments: plan ? String(plan.totalInstallments) : "", installmentAmount: plan ? String(plan.installmentAmount) : "",
    paidInstallments: plan ? String(plan.paidInstallments) : "0", startDate: plan?.startDate ?? todayStr(),
    nextDueDate: plan?.nextDueDate ?? "", cardId: plan?.cardId ? String(plan.cardId) : "",
    categoryId: plan?.categoryId ? String(plan.categoryId) : "", currency: plan?.currency ?? "ARS", notes: plan?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  function recalcInstallment() {
    const t = parseFloat(form.totalAmount);
    const n = parseInt(form.totalInstallments, 10);
    if (t > 0 && n > 0) setForm(f => ({ ...f, installmentAmount: String(Math.round(t / n)) }));
  }

  async function handleSave() {
    if (!form.description || !form.totalAmount || !form.totalInstallments || !form.startDate) {
      toast({ title: "Completá todos los campos obligatorios", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body = { ...form, totalAmount: parseFloat(form.totalAmount), installmentAmount: parseFloat(form.installmentAmount), totalInstallments: parseInt(form.totalInstallments, 10), paidInstallments: parseInt(form.paidInstallments, 10), cardId: form.cardId || null, categoryId: form.categoryId || null, nextDueDate: form.nextDueDate || null };
      const url = plan ? `${BASE}/api/finance/installment-plans/${plan.id}` : `${BASE}/api/finance/installment-plans`;
      const r = await fetch(url, { method: plan ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      toast({ title: plan ? "Cuota actualizada" : "Plan de cuotas creado" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const expenseCategories = categories.filter(c => c.type === "expense");
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{plan ? "Editar cuotas" : "Nueva compra en cuotas"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Descripción</Label>
            <Input placeholder="Ej: TV Samsung 55&quot;" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Total</Label>
              <Input type="number" placeholder="0" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} onBlur={recalcInstallment} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuotas</Label>
              <Input type="number" min="1" placeholder="12" value={form.totalInstallments} onChange={e => setForm(f => ({ ...f, totalInstallments: e.target.value }))} onBlur={recalcInstallment} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Valor cuota</Label>
              <Input type="number" placeholder="0" value={form.installmentAmount} onChange={e => setForm(f => ({ ...f, installmentAmount: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuotas pagadas</Label>
              <Input type="number" min="0" value={form.paidInstallments} onChange={e => setForm(f => ({ ...f, paidInstallments: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Fecha inicio</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Próximo vencimiento</Label>
              <Input type="date" value={form.nextDueDate} onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Tarjeta</Label>
              <Select value={form.cardId || "__none__"} onValueChange={v => setForm(f => ({ ...f, cardId: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Sin tarjeta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin tarjeta</SelectItem>
                  {cards.filter(c => c.isActive).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label>
            <Select value={form.categoryId || "__none__"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "__none__" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin categoría</SelectItem>
                {expenseCategories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : plan ? "Guardar" : "Crear plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── LOAN MODAL ────────────────────────────────────────────────────────────

function LoanModal({ open, onClose, loan, onSaved }: { open: boolean; onClose: () => void; loan: FinanceLoan | null; onSaved: () => void; }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: loan?.name ?? "", creditor: loan?.creditor ?? "",
    totalAmount: loan ? String(loan.totalAmount) : "", totalInstallments: loan ? String(loan.totalInstallments) : "",
    installmentAmount: loan ? String(loan.installmentAmount) : "", paidInstallments: loan ? String(loan.paidInstallments) : "0",
    startDate: loan?.startDate ?? todayStr(), nextDueDate: loan?.nextDueDate ?? "",
    status: loan?.status ?? "active", currency: loan?.currency ?? "ARS", notes: loan?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name || !form.totalAmount || !form.totalInstallments || !form.installmentAmount || !form.startDate) {
      toast({ title: "Completá todos los campos obligatorios", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body = { ...form, totalAmount: parseFloat(form.totalAmount), totalInstallments: parseInt(form.totalInstallments, 10), installmentAmount: parseFloat(form.installmentAmount), paidInstallments: parseInt(form.paidInstallments, 10), nextDueDate: form.nextDueDate || null };
      const url = loan ? `${BASE}/api/finance/loans/${loan.id}` : `${BASE}/api/finance/loans`;
      const r = await fetch(url, { method: loan ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      toast({ title: loan ? "Préstamo actualizado" : "Préstamo creado" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Landmark className="h-4 w-4" />{loan ? "Editar préstamo" : "Nuevo préstamo"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
              <Input placeholder="Ej: Préstamo personal" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Acreedor</Label>
              <Input placeholder="Ej: Banco Galicia" value={form.creditor} onChange={e => setForm(f => ({ ...f, creditor: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto total</Label>
              <Input type="number" placeholder="0" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuotas</Label>
              <Input type="number" min="1" value={form.totalInstallments} onChange={e => setForm(f => ({ ...f, totalInstallments: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Valor cuota</Label>
              <Input type="number" placeholder="0" value={form.installmentAmount} onChange={e => setForm(f => ({ ...f, installmentAmount: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuotas pagadas</Label>
              <Input type="number" min="0" value={form.paidInstallments} onChange={e => setForm(f => ({ ...f, paidInstallments: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Fecha inicio</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Próxima cuota</Label>
              <Input type="date" value={form.nextDueDate} onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Estado</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="paid">Pagado</SelectItem>
                  <SelectItem value="defaulted">En mora</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Notas</Label>
            <Input placeholder="Opcional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : loan ? "Guardar" : "Crear préstamo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── RECURRING MODAL ───────────────────────────────────────────────────────

function RecurringModal({ open, onClose, rule, categories, accounts, onSaved }: {
  open: boolean; onClose: () => void; rule: FinanceRecurringRule | null;
  categories: FinanceCategory[]; accounts: FinanceAccount[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: rule?.name ?? "", type: rule?.type ?? "expense", amount: rule?.amount ?? "", categoryId: rule?.categoryId ? String(rule.categoryId) : "", accountId: rule?.accountId ? String(rule.accountId) : "", frequency: rule?.frequency ?? "monthly", dayOfMonth: rule?.dayOfMonth ? String(rule.dayOfMonth) : "", nextDate: rule?.nextDate ?? todayStr(), isActive: rule?.isActive ?? true, notes: rule?.notes ?? "" });
  const [saving, setSaving] = useState(false);
  const activeCats = categories.filter(c => c.type === form.type);
  async function handleSave() {
    if (!form.name || !form.amount) { toast({ title: "Nombre y monto son obligatorios", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { ...form, amount: parseFloat(form.amount), categoryId: form.categoryId || null, accountId: form.accountId || null, dayOfMonth: form.dayOfMonth ? parseInt(form.dayOfMonth, 10) : null };
      const url = rule ? `${BASE}/api/finance/recurring-rules/${rule.id}` : `${BASE}/api/finance/recurring-rules`;
      const r = await fetch(url, { method: rule ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      toast({ title: rule ? "Regla actualizada" : "Regla creada" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{rule ? "Editar recurrencia" : "Nueva recurrencia"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex rounded-lg border overflow-hidden">
            {(["income", "expense"] as const).map(t => (
              <button key={t} onClick={() => setForm(f => ({ ...f, type: t, categoryId: "" }))}
                className={`flex-1 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${form.type === t ? (t === "income" ? "bg-emerald-500 text-white" : "bg-red-500 text-white") : "text-muted-foreground hover:bg-muted"}`}>
                {t === "income" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                {t === "income" ? "Ingreso" : "Gasto"}
              </button>
            ))}
          </div>
          <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
            <Input placeholder="Ej: Sueldo mensual" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto</Label>
              <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input type="number" className="pl-6" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Frecuencia</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="monthly">Mensual</SelectItem><SelectItem value="annual">Anual</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
                <SelectContent>{activeCats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuenta</Label>
              <Select value={form.accountId || "__none__"} onValueChange={v => setForm(f => ({ ...f, accountId: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">Sin cuenta</SelectItem>{accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Próxima fecha</Label>
              <Input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} />
            </div>
            <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Día del mes</Label>
              <Input type="number" min="1" max="31" value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : rule ? "Guardar" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────

export default function FinancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState("dashboard");
  const [txModal, setTxModal] = useState<{ open: boolean; tx: FinanceTransaction | null }>({ open: false, tx: null });
  const [acctModal, setAcctModal] = useState<{ open: boolean; acct: FinanceAccount | null }>({ open: false, acct: null });
  const [cardModal, setCardModal] = useState<{ open: boolean; card: FinanceCard | null }>({ open: false, card: null });
  const [installModal, setInstallModal] = useState<{ open: boolean; plan: FinanceInstallmentPlan | null }>({ open: false, plan: null });
  const [loanModal, setLoanModal] = useState<{ open: boolean; loan: FinanceLoan | null }>({ open: false, loan: null });
  const [recurModal, setRecurModal] = useState<{ open: boolean; rule: FinanceRecurringRule | null }>({ open: false, rule: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; title: string; description?: string; onConfirm: () => void }>({ open: false, title: "", onConfirm: () => {} });
  const [filter, setFilter] = useState({ type: "", categoryId: "", accountId: "", status: "", from: "", to: "" });
  const [budgetMonth, setBudgetMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [budgetModal, setBudgetModal] = useState<{ open: boolean; budget: BudgetWithSpending | null }>({ open: false, budget: null });

  const { data: summary, isLoading: summaryLoading } = useQuery<FinanceSummary>({
    queryKey: ["/api/finance/summary"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: categoriesData } = useQuery<FinanceCategory[]>({
    queryKey: ["/api/finance/categories"],
    queryFn: () => fetch(`${BASE}/api/finance/categories`, { credentials: "include" }).then(r => r.json()),
  });
  const { data: accountsData } = useQuery<FinanceAccount[]>({
    queryKey: ["/api/finance/accounts"],
    queryFn: () => fetch(`${BASE}/api/finance/accounts`, { credentials: "include" }).then(r => r.json()),
  });
  const { data: cardsData } = useQuery<FinanceCard[]>({
    queryKey: ["/api/finance/cards"],
    queryFn: () => fetch(`${BASE}/api/finance/cards`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "tarjetas",
  });
  const { data: installPlansData } = useQuery<FinanceInstallmentPlan[]>({
    queryKey: ["/api/finance/installment-plans"],
    queryFn: () => fetch(`${BASE}/api/finance/installment-plans`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "tarjetas",
  });
  const { data: loansData } = useQuery<FinanceLoan[]>({
    queryKey: ["/api/finance/loans"],
    queryFn: () => fetch(`${BASE}/api/finance/loans`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "prestamos",
  });
  const txParams = new URLSearchParams();
  if (filter.type) txParams.set("type", filter.type);
  if (filter.categoryId) txParams.set("categoryId", filter.categoryId);
  if (filter.accountId) txParams.set("accountId", filter.accountId);
  if (filter.status) txParams.set("status", filter.status);
  if (filter.from) txParams.set("from", filter.from);
  if (filter.to) txParams.set("to", filter.to);
  txParams.set("limit", "200");
  const { data: txData, isLoading: txLoading } = useQuery<{ transactions: FinanceTransaction[]; total: number }>({
    queryKey: ["/api/finance/transactions", filter],
    queryFn: () => fetch(`${BASE}/api/finance/transactions?${txParams}`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "movimientos",
  });
  const { data: rulesData } = useQuery<FinanceRecurringRule[]>({
    queryKey: ["/api/finance/recurring-rules"],
    queryFn: () => fetch(`${BASE}/api/finance/recurring-rules`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "recurrencias",
  });
  const { data: budgetsData, isLoading: budgetsLoading } = useQuery<BudgetsData>({
    queryKey: ["/api/finance/budgets", budgetMonth],
    queryFn: () => fetch(`${BASE}/api/finance/budgets?month=${budgetMonth}`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "presupuestos",
  });
  const { data: projectionData, isLoading: projectionLoading } = useQuery<ProjectionData>({
    queryKey: ["/api/finance/projection"],
    queryFn: () => fetch(`${BASE}/api/finance/projection`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "proyeccion",
  });
  const { data: insightsData } = useQuery<InsightsData>({
    queryKey: ["/api/finance/insights"],
    queryFn: () => fetch(`${BASE}/api/finance/insights`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "dashboard" || tab === "proyeccion",
    staleTime: 5 * 60 * 1000,
  });

  const categories = categoriesData ?? [];
  const accounts = accountsData ?? [];
  const allCards = (cardsData ?? summary?.cards ?? []) as FinanceCard[];
  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);
  const acctMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const cardMap = useMemo(() => Object.fromEntries(allCards.map(c => [c.id, c])), [allCards]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["/api/finance/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/accounts"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/recurring-rules"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/cards"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/installment-plans"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/loans"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/budgets"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/insights"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/projection"] });
  }

  const seedMutation = useMutation({
    mutationFn: () => fetch(`${BASE}/api/finance/seed-demo`, { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: (data) => { toast({ title: data.skipped ? "Ya hay datos cargados" : "Datos demo cargados" }); invalidateAll(); },
    onError: () => toast({ title: "Error al cargar demo", variant: "destructive" }),
  });

  function confirmDelete(title: string, description: string, action: () => Promise<void>) {
    setDeleteConfirm({ open: true, title, description, onConfirm: async () => { setDeleteConfirm(s => ({ ...s, open: false })); await action(); } });
  }

  async function deleteTx(id: number) {
    confirmDelete("¿Eliminar movimiento?", "Esta acción no se puede deshacer y puede actualizar el saldo de la cuenta.", async () => {
      const r = await fetch(`${BASE}/api/finance/transactions/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Movimiento eliminado" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function deleteAccount(id: number) {
    confirmDelete("¿Eliminar cuenta?", "Los movimientos asociados no se borrarán.", async () => {
      const r = await fetch(`${BASE}/api/finance/accounts/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Cuenta eliminada" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function deleteCard(id: number) {
    confirmDelete("¿Eliminar tarjeta?", "Los movimientos y cuotas asociados no se borrarán.", async () => {
      const r = await fetch(`${BASE}/api/finance/cards/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Tarjeta eliminada" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function deleteInstallmentPlan(id: number) {
    confirmDelete("¿Eliminar plan de cuotas?", "El historial de esta cuota se perderá.", async () => {
      const r = await fetch(`${BASE}/api/finance/installment-plans/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Plan eliminado" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function deleteLoan(id: number) {
    confirmDelete("¿Eliminar préstamo?", "El registro del préstamo se eliminará permanentemente.", async () => {
      const r = await fetch(`${BASE}/api/finance/loans/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Préstamo eliminado" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function deleteRule(id: number) {
    confirmDelete("¿Eliminar recurrencia?", "Los movimientos ya registrados no se verán afectados.", async () => {
      const r = await fetch(`${BASE}/api/finance/recurring-rules/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Regla eliminada" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }
  async function toggleRule(rule: FinanceRecurringRule) {
    const r = await fetch(`${BASE}/api/finance/recurring-rules/${rule.id}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (r.ok) { toast({ title: rule.isActive ? "Recurrencia pausada" : "Recurrencia reactivada" }); invalidateAll(); }
    else toast({ title: "Error", variant: "destructive" });
  }

  const hasFilters = Object.values(filter).some(Boolean);
  const hasData = summary?.hasData ?? false;

  return (
    <div className="relative min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Wallet className="h-6 w-6 text-violet-500" /> Finanzas Personales
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Tu situación financiera en tiempo real</p>
          </div>
          <Button variant="outline" size="sm" onClick={invalidateAll} className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList className="flex w-max min-w-full sm:min-w-0">
              <TabsTrigger value="dashboard">Resumen</TabsTrigger>
              <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
              <TabsTrigger value="cuentas">Cuentas</TabsTrigger>
              <TabsTrigger value="tarjetas">Tarjetas</TabsTrigger>
              <TabsTrigger value="prestamos">Préstamos</TabsTrigger>
              <TabsTrigger value="recurrencias">Recurrencias</TabsTrigger>
              <TabsTrigger value="presupuestos">Presupuestos</TabsTrigger>
              <TabsTrigger value="proyeccion">Proyección</TabsTrigger>
            </TabsList>
          </div>

          {/* ── DASHBOARD TAB ─────────────────────────────────────────── */}
          <TabsContent value="dashboard" className="mt-5 space-y-5">
            {summaryLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <Card key={i}><CardContent className="h-28 animate-pulse bg-muted rounded-lg m-2" /></Card>)}</div>
            ) : !summary ? null : !hasData ? (
              <OnboardingCard onLoadDemo={() => seedMutation.mutate()} onNewAccount={() => { setTab("cuentas"); setAcctModal({ open: true, acct: null }); }} onNewTx={() => setTxModal({ open: true, tx: null })} loading={seedMutation.isPending} />
            ) : (
              <>
                {/* Semáforo de presión financiera */}
                {summary.compromisos && <PressureMeter compromisos={summary.compromisos} income={summary.ingresosMes} />}

                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <SummaryCard label="Saldo disponible" value={fmt(summary.saldoDisponible)} sub="Activos menos deudas" accent="text-violet-600 dark:text-violet-400" bgColor="bg-violet-100 dark:bg-violet-900/30" icon={Wallet} />
                  <SummaryCard label="Ingresos del mes" value={fmt(summary.ingresosMes)} sub="Confirmados" accent="text-emerald-600 dark:text-emerald-400" bgColor="bg-emerald-100 dark:bg-emerald-900/30" icon={TrendingUp} />
                  <SummaryCard label="Gastos del mes" value={fmt(summary.gastosMes)} sub="Confirmados" accent="text-red-500 dark:text-red-400" bgColor="bg-red-100 dark:bg-red-900/30" icon={TrendingDown} />
                  <SummaryCard label="Balance neto del mes" value={fmt(summary.saldoEstimadoFinMes)} sub={summary.saldoEstimadoFinMes >= 0 ? "Ingresos − Gastos proyectado" : "Déficit proyectado"} accent={summary.saldoEstimadoFinMes >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"} bgColor={summary.saldoEstimadoFinMes >= 0 ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"} icon={Calendar} />
                  <SummaryCard label="Tarjetas activas" value={String(summary.cards?.length ?? 0)} sub={summary.cards?.some(c => c.isDueSoon) ? "Vence pronto" : "Sin vencimiento urgente"} accent="text-amber-600 dark:text-amber-400" bgColor="bg-amber-100 dark:bg-amber-900/30" icon={CreditCard} />
                  <SummaryCard label="Préstamos activos" value={String(summary.loans?.filter(l => l.status === "active").length ?? 0)} sub={summary.loans?.length ? fmt(summary.compromisos?.loans ?? 0) + " este mes" : "Sin préstamos"} accent="text-blue-600 dark:text-blue-400" bgColor="bg-blue-100 dark:bg-blue-900/30" icon={Landmark} />
                </div>

                {/* Alerts */}
                {summary.alerts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Alertas</CardTitle></CardHeader>
                    <CardContent className="space-y-2 pb-4">
                      {summary.alerts.map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5 text-sm"><AlertDot level={a.level} /><span>{a.message}</span></div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Insights */}
                {insightsData?.insights && insightsData.insights.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> Insights financieros</CardTitle></CardHeader>
                    <CardContent className="pb-4 space-y-2">
                      {insightsData.insights.slice(0, 4).map(ins => (
                        <InsightRow key={ins.id} insight={ins} />
                      ))}
                      {insightsData.insights.length > 4 && (
                        <Button variant="link" size="sm" className="text-xs px-0 mt-1" onClick={() => setTab("proyeccion")}>Ver todos los insights →</Button>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Upcoming payments (cards + loans + installments) */}
                {summary.upcomingPayments?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /> Próximos vencimientos</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3 space-y-1">
                      {summary.upcomingPayments.slice(0, 6).map((p, i) => {
                        const days = daysUntil(p.dueDate);
                        const urgent = days !== null && days <= 3;
                        return (
                          <div key={i} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: p.color + "22" }}>
                              {p.type === "card" ? <CreditCard className="h-4 w-4" style={{ color: p.color }} /> : p.type === "loan" ? <Landmark className="h-4 w-4" style={{ color: p.color }} /> : <CheckCircle2 className="h-4 w-4" style={{ color: p.color }} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{p.label}</p>
                              <p className="text-xs text-muted-foreground">{p.dueDate}{days !== null && <span className={urgent ? " text-red-500 font-semibold" : ""}> · {days === 0 ? "Hoy" : days < 0 ? `${Math.abs(days)}d vencido` : `en ${days}d`}</span>}</p>
                            </div>
                            <span className="text-sm font-bold tabular-nums text-red-500 dark:text-red-400 shrink-0">{fmt(p.amount)}</span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                <div className="grid md:grid-cols-2 gap-5">
                  {/* Recent Transactions */}
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Últimos movimientos</CardTitle></CardHeader>
                    <CardContent className="pb-3">
                      {summary.recentTransactions.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Sin movimientos registrados</p>
                      ) : (
                        <div className="space-y-1">
                          {summary.recentTransactions.map(tx => (
                            <div key={tx.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: (tx.category?.color ?? "#6b7280") + "22" }}>
                                {tx.type === "income" ? <ArrowUpCircle className="h-4 w-4 text-emerald-500" /> : <ArrowDownCircle className="h-4 w-4 text-red-500" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{tx.notes || tx.category?.name || (tx.type === "income" ? "Ingreso" : "Gasto")}</p>
                                <p className="text-xs text-muted-foreground">{tx.date}{tx.category?.name ? ` · ${tx.category.name}` : ""}</p>
                              </div>
                              <span className={`text-sm font-bold tabular-nums shrink-0 ${tx.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                                {tx.type === "income" ? "+" : "-"}{fmt(tx.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <Button variant="link" size="sm" className="mt-1 text-xs px-2" onClick={() => setTab("movimientos")}>Ver todos →</Button>
                    </CardContent>
                  </Card>

                  {/* Upcoming Recurrences */}
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Repeat className="h-4 w-4 text-muted-foreground" /> Próximas recurrencias</CardTitle></CardHeader>
                    <CardContent className="pb-3">
                      {summary.upcomingRecurrences.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No hay recurrencias en los próximos 30 días</p>
                      ) : (
                        <div className="space-y-1">
                          {summary.upcomingRecurrences.map(r => (
                            <div key={r.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-muted">
                                {r.type === "income" ? <ArrowUpCircle className="h-4 w-4 text-emerald-500" /> : <ArrowDownCircle className="h-4 w-4 text-red-500" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{r.name}</p>
                                <p className="text-xs text-muted-foreground">{r.nextDate} · {FREQ_LABEL[r.frequency]}</p>
                              </div>
                              <span className={`text-sm font-bold tabular-nums ${r.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                                {r.type === "income" ? "+" : "-"}{fmt(r.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <Button variant="link" size="sm" className="mt-1 text-xs px-2" onClick={() => setTab("recurrencias")}>Gestionar →</Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Category breakdown */}
                {summary.categoryBreakdown?.length > 0 && <CategoryBreakdownSection breakdown={summary.categoryBreakdown} total={summary.gastosMes} />}

                {/* Accounts mini */}
                {summary.accounts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-muted-foreground" /> Cuentas</CardTitle></CardHeader>
                    <CardContent className="pb-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {summary.accounts.map(a => {
                          const meta = ACCOUNT_META[a.type] ?? ACCOUNT_META["banco"];
                          const Icon = meta.icon;
                          return (
                            <div key={a.id} className="rounded-lg border bg-card p-3 flex flex-col gap-1">
                              <div className="flex items-center gap-2"><Icon className={`h-3.5 w-3.5 ${meta.color}`} /><span className="text-xs text-muted-foreground truncate">{a.label}</span></div>
                              <p className={`text-base font-bold tabular-nums ${a.type === "deuda" ? "text-red-500" : "text-foreground"}`}>
                                {a.currency !== "ARS" ? a.currency + " " : ""}{fmt(parseFloat(a.amount))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <Button variant="link" size="sm" className="mt-2 text-xs px-2" onClick={() => setTab("cuentas")}>Gestionar cuentas →</Button>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── MOVIMIENTOS TAB ────────────────────────────────────────── */}
          <TabsContent value="movimientos" className="mt-5 space-y-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={filter.type || "all"} onValueChange={v => setFilter(f => ({ ...f, type: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Todos los tipos</SelectItem><SelectItem value="income">Ingresos</SelectItem><SelectItem value="expense">Gastos</SelectItem></SelectContent>
                  </Select>
                  <Select value={filter.categoryId || "all"} onValueChange={v => setFilter(f => ({ ...f, categoryId: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Categoría" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Todas las categorías</SelectItem>{categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={filter.accountId || "all"} onValueChange={v => setFilter(f => ({ ...f, accountId: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Cuenta" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Todas las cuentas</SelectItem>{accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={filter.status || "all"} onValueChange={v => setFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Todos</SelectItem>{Object.entries(STATUS_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="date" className="h-8 w-36 text-xs" value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} />
                  <Input type="date" className="h-8 w-36 text-xs" value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} />
                  {hasFilters && <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setFilter({ type: "", categoryId: "", accountId: "", status: "", from: "", to: "" })}><X className="h-3 w-3" /> Limpiar</Button>}
                </div>
              </CardContent>
            </Card>
            {txLoading ? <Card><CardContent className="h-40 animate-pulse bg-muted rounded-lg mt-4" /></Card> : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fecha</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descripción</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Categoría</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden md:table-cell">Cuenta / Tarjeta</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Estado</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monto</th>
                          <th className="py-3 px-4 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!txData?.transactions?.length ? (
                          <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                            <div className="flex flex-col items-center gap-2"><Wallet className="h-8 w-8 opacity-20" /><p>Sin movimientos{hasFilters ? " con estos filtros" : ""}</p>{!hasFilters && <Button size="sm" variant="outline" className="mt-2" onClick={() => setTxModal({ open: true, tx: null })}>Cargar primer movimiento</Button>}</div>
                          </td></tr>
                        ) : txData.transactions.map(tx => (
                          <tr key={tx.id} className="border-b hover:bg-muted/30 transition-colors group">
                            <td className="py-3 px-4 text-muted-foreground tabular-nums whitespace-nowrap">{tx.date}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {tx.type === "income" ? <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <ArrowDownCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                                <span className="truncate max-w-[140px]">{tx.notes || tx.category?.name || (tx.type === "income" ? "Ingreso" : "Gasto")}</span>
                                {tx.isRecurring && <Repeat className="h-3 w-3 text-muted-foreground shrink-0" />}
                                {tx.cardId && <CreditCard className="h-3 w-3 text-muted-foreground shrink-0" />}
                              </div>
                            </td>
                            <td className="py-3 px-4 hidden sm:table-cell">
                              {tx.category ? <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5" style={{ background: tx.category.color + "22", color: tx.category.color }}>{tx.category.name}</span> : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-xs hidden md:table-cell">
                              {tx.cardId ? <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" />{cardMap[tx.cardId]?.name ?? "Tarjeta"}</span> : tx.accountId ? acctMap[tx.accountId]?.label ?? "—" : "—"}
                            </td>
                            <td className="py-3 px-4 hidden sm:table-cell">
                              {STATUS_META[tx.status] ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[tx.status].color}`}>{STATUS_META[tx.status].label}</span> : tx.status}
                            </td>
                            <td className={`py-3 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${tx.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                              {tx.type === "income" ? "+" : "-"}{fmt(tx.amount)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setTxModal({ open: true, tx })}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteTx(tx.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {txData && txData.total > 0 && (
                    <div className="px-4 py-2 border-t text-xs text-muted-foreground flex items-center justify-between">
                      <span>{txData.total} movimiento{txData.total !== 1 ? "s" : ""} en total</span>
                      <span>Balance: <span className={txData.transactions.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0) >= 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-red-500 dark:text-red-400 font-semibold"}>{fmtSigned(txData.transactions.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0))}</span></span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── CUENTAS TAB ────────────────────────────────────────────── */}
          <TabsContent value="cuentas" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAcctModal({ open: true, acct: null })} className="gap-1.5"><Plus className="h-4 w-4" /> Nueva cuenta</Button>
            </div>
            {!accountsData?.length ? (
              <Card><CardContent className="py-16 text-center"><Wallet className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-muted-foreground">No tenés cuentas creadas</p><Button className="mt-4" onClick={() => setAcctModal({ open: true, acct: null })}>Crear primera cuenta</Button></CardContent></Card>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {accountsData.map(a => {
                  const meta = ACCOUNT_META[a.type] ?? ACCOUNT_META["banco"];
                  const Icon = meta.icon;
                  return (
                    <Card key={a.id} className="group">
                      <CardContent className="pt-5 pb-4 px-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${meta.bgColor}`}><Icon className={`h-5 w-5 ${meta.color}`} /></div>
                            <div><p className="font-semibold text-sm leading-tight">{a.label}</p><p className="text-xs text-muted-foreground">{meta.label} · {a.currency}</p></div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAcctModal({ open: true, acct: a })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteAccount(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <p className={`text-2xl font-bold tabular-nums mt-3 ${a.type === "deuda" ? "text-red-500 dark:text-red-400" : ""}`}>
                          {a.currency !== "ARS" ? a.currency + " " : ""}{fmt(parseFloat(a.amount))}
                        </p>
                        {a.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{a.notes}</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── TARJETAS TAB ───────────────────────────────────────────── */}
          <TabsContent value="tarjetas" className="mt-5 space-y-5">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <Button onClick={() => setInstallModal({ open: true, plan: null })} variant="outline" className="gap-1.5 text-sm"><CheckCircle2 className="h-4 w-4" /> Nueva cuota</Button>
              </div>
              <Button onClick={() => setCardModal({ open: true, card: null })} className="gap-1.5"><Plus className="h-4 w-4" /> Nueva tarjeta</Button>
            </div>

            {/* Cards grid */}
            {!cardsData?.length ? (
              <Card><CardContent className="py-16 text-center"><CreditCard className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-muted-foreground mb-4">No tenés tarjetas registradas</p><Button onClick={() => setCardModal({ open: true, card: null })}>Agregar primera tarjeta</Button></CardContent></Card>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {cardsData.map(card => {
                  const plans = (installPlansData ?? []).filter(p => p.cardId === card.id && p.isActive);
                  const pendingInstallTotal = plans.reduce((s, p) => s + (p.paidInstallments < p.totalInstallments ? p.installmentAmount : 0), 0);
                  const days = daysUntil(card.nextDueDate);
                  const urgent = days !== null && days <= 7;
                  return (
                    <Card key={card.id} className="group overflow-hidden">
                      <div className="h-2 w-full" style={{ background: card.color }} />
                      <CardContent className="pt-4 pb-4 px-5">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-base">{card.name}</p>
                              {card.lastFour && <span className="text-xs text-muted-foreground">••{card.lastFour}</span>}
                            </div>
                            {card.bank && <p className="text-xs text-muted-foreground">{card.bank}</p>}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCardModal({ open: true, card })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteCard(card.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                          <div className="rounded-lg bg-muted/50 p-2.5">
                            <p className="text-xs text-muted-foreground">Gastado este período</p>
                            <p className="font-bold tabular-nums text-red-500 dark:text-red-400 mt-0.5">{fmt(card.totalSpent ?? 0)}</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-2.5">
                            <p className="text-xs text-muted-foreground">Cuotas pendientes</p>
                            <p className="font-bold tabular-nums mt-0.5">{fmt(pendingInstallTotal)}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-1">
                          <span>Cierre: día {card.closeDay}{card.nextCloseDate ? ` (${card.nextCloseDate})` : ""}</span>
                          <span className={`font-medium ${urgent ? "text-red-500" : ""}`}>Vence: día {card.dueDay}{days !== null ? ` · ${days === 0 ? "hoy" : days < 0 ? `${Math.abs(days)}d vencido` : `en ${days}d`}` : ""}</span>
                        </div>
                        {plans.length > 0 && (
                          <div className="mt-3 pt-3 border-t space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground">Cuotas activas ({plans.length})</p>
                            {plans.map(p => {
                              const remaining = p.totalInstallments - p.paidInstallments;
                              const pct = (p.paidInstallments / p.totalInstallments) * 100;
                              return (
                                <div key={p.id} className="group/plan">
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="font-medium truncate max-w-[60%]">{p.description}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-muted-foreground">{p.paidInstallments}/{p.totalInstallments}</span>
                                      <span className="font-semibold">{fmt(p.installmentAmount)}/mes</span>
                                      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/plan:opacity-100" onClick={() => setInstallModal({ open: true, plan: p })}><Pencil className="h-3 w-3" /></Button>
                                      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/plan:opacity-100 text-destructive" onClick={() => deleteInstallmentPlan(p.id)}><Trash2 className="h-3 w-3" /></Button>
                                    </div>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{remaining} cuota{remaining !== 1 ? "s" : ""} restante{remaining !== 1 ? "s" : ""}{p.nextDueDate ? ` · próx: ${p.nextDueDate}` : ""}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Installment plans without card */}
            {installPlansData && installPlansData.filter(p => !p.cardId && p.isActive).length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Cuotas sin tarjeta</CardTitle></CardHeader>
                <CardContent className="pb-4 space-y-3">
                  {installPlansData.filter(p => !p.cardId && p.isActive).map(p => {
                    const remaining = p.totalInstallments - p.paidInstallments;
                    const pct = (p.paidInstallments / p.totalInstallments) * 100;
                    return (
                      <div key={p.id} className="group">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium">{p.description}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground text-xs">{p.paidInstallments}/{p.totalInstallments} cuotas</span>
                            <span className="font-bold">{fmt(p.installmentAmount)}/mes</span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInstallModal({ open: true, plan: p })}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteInstallmentPlan(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{remaining} restante{remaining !== 1 ? "s" : ""} · Total {fmt(p.totalAmount)}{p.nextDueDate ? ` · próx: ${p.nextDueDate}` : ""}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── PRÉSTAMOS TAB ──────────────────────────────────────────── */}
          <TabsContent value="prestamos" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setLoanModal({ open: true, loan: null })} className="gap-1.5"><Plus className="h-4 w-4" /> Nuevo préstamo</Button>
            </div>

            {!loansData?.length ? (
              <Card><CardContent className="py-16 text-center"><Landmark className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-muted-foreground mb-4">No tenés préstamos registrados</p><Button onClick={() => setLoanModal({ open: true, loan: null })}>Agregar primer préstamo</Button></CardContent></Card>
            ) : (
              <>
                {/* Total adeudado summary */}
                {loansData.filter(l => l.status === "active").length > 0 && (
                  <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                    <CardContent className="py-4 px-5">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Total adeudado (activos)</p>
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-1">
                            {fmt(loansData.filter(l => l.status === "active").reduce((s, l) => s + l.totalAmount - (l.paidInstallments * l.installmentAmount), 0))}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Compromiso mensual</p>
                          <p className="text-lg font-bold tabular-nums">{fmt(loansData.filter(l => l.status === "active").reduce((s, l) => s + l.installmentAmount, 0))}/mes</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-3">
                  {loansData.map(loan => {
                    const pct = (loan.paidInstallments / loan.totalInstallments) * 100;
                    const remaining = loan.totalInstallments - loan.paidInstallments;
                    const saldoPendiente = Math.max(0, loan.totalAmount - (loan.paidInstallments * loan.installmentAmount));
                    const days = daysUntil(loan.nextDueDate);
                    const statusMeta = LOAN_STATUS_META[loan.status] ?? LOAN_STATUS_META["active"];
                    return (
                      <Card key={loan.id} className="group">
                        <CardContent className="pt-5 pb-4 px-5">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-base">{loan.name}</p>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.color}`}>{statusMeta.label}</span>
                              </div>
                              {loan.creditor && <p className="text-xs text-muted-foreground mt-0.5">{loan.creditor}</p>}
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLoanModal({ open: true, loan })}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteLoan(loan.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-center mb-3">
                            <div className="rounded-lg bg-muted/50 p-2">
                              <p className="text-xs text-muted-foreground">Cuota mensual</p>
                              <p className="font-bold tabular-nums mt-0.5">{fmt(loan.installmentAmount)}</p>
                            </div>
                            <div className="rounded-lg bg-muted/50 p-2">
                              <p className="text-xs text-muted-foreground">Saldo pendiente</p>
                              <p className="font-bold tabular-nums text-blue-600 dark:text-blue-400 mt-0.5">{fmt(saldoPendiente)}</p>
                            </div>
                            <div className="rounded-lg bg-muted/50 p-2">
                              <p className="text-xs text-muted-foreground">Cuotas restantes</p>
                              <p className="font-bold tabular-nums mt-0.5">{remaining}/{loan.totalInstallments}</p>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
                            <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{Math.round(pct)}% pagado</span>
                            {loan.nextDueDate && <span className={days !== null && days <= 7 ? "text-amber-600 font-semibold" : ""}><Calendar className="h-3 w-3 inline mr-1" />Próxima: {loan.nextDueDate}{days !== null ? ` (${days === 0 ? "hoy" : days < 0 ? `${Math.abs(days)}d vencida` : `en ${days}d`})` : ""}</span>}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── RECURRENCIAS TAB ────────────────────────────────────────── */}
          <TabsContent value="recurrencias" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setRecurModal({ open: true, rule: null })} className="gap-1.5"><Plus className="h-4 w-4" /> Nueva recurrencia</Button>
            </div>
            {!rulesData?.length ? (
              <Card><CardContent className="py-16 text-center"><Repeat className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-muted-foreground">No tenés movimientos recurrentes configurados</p><Button className="mt-4" onClick={() => setRecurModal({ open: true, rule: null })}>Crear primera recurrencia</Button></CardContent></Card>
            ) : (
              <div className="space-y-2">
                {/* Active rules */}
                {rulesData.filter(r => r.isActive).length > 0 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Activas</p>
                )}
                {rulesData.filter(r => r.isActive).map(rule => <RecurringRuleRow key={rule.id} rule={rule} catMap={catMap} acctMap={acctMap} onEdit={() => setRecurModal({ open: true, rule })} onDelete={() => deleteRule(rule.id)} onToggle={() => toggleRule(rule)} />)}

                {/* Inactive (paused) */}
                {rulesData.filter(r => !r.isActive).length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-4">Pausadas</p>
                    {rulesData.filter(r => !r.isActive).map(rule => <RecurringRuleRow key={rule.id} rule={rule} catMap={catMap} acctMap={acctMap} onEdit={() => setRecurModal({ open: true, rule })} onDelete={() => deleteRule(rule.id)} onToggle={() => toggleRule(rule)} />)}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── PRESUPUESTOS TAB ──────────────────────────────────────── */}
          <TabsContent value="presupuestos" className="mt-5 space-y-4">
            {/* Month selector */}
            <div className="flex items-center gap-3 justify-between flex-wrap">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                  const [y, m] = budgetMonth.split("-").map(Number);
                  const d = new Date(y, m - 2, 1); setBudgetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold capitalize">{new Date(budgetMonth + "-15").toLocaleString("es-AR", { month: "long", year: "numeric" })}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                  const [y, m] = budgetMonth.split("-").map(Number);
                  const d = new Date(y, m, 1); setBudgetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => setBudgetModal({ open: true, budget: null })}>
                <Plus className="h-3.5 w-3.5" /> Nuevo presupuesto
              </Button>
            </div>

            {budgetsLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Card key={i}><CardContent className="h-20 animate-pulse bg-muted rounded-lg m-3" /></Card>)}</div>
            ) : !budgetsData?.budgets?.length ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-16">
                  <Target className="h-12 w-12 text-muted-foreground/30" />
                  <p className="text-muted-foreground text-center">No hay presupuestos para este mes.</p>
                  <p className="text-sm text-muted-foreground text-center">Creá un presupuesto por categoría para controlar tus gastos.</p>
                  <Button size="sm" onClick={() => setBudgetModal({ open: true, budget: null })} className="mt-2 gap-1.5"><Plus className="h-3.5 w-3.5" /> Crear primer presupuesto</Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary card */}
                <Card className="bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 border-violet-200 dark:border-violet-800">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Total presupuestado</p>
                        <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{fmt(budgetsData.totalBudgeted)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Gastado</p>
                        <p className="text-2xl font-bold text-red-500">{fmt(budgetsData.totalSpent)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Disponible</p>
                        <p className={`text-2xl font-bold ${budgetsData.totalBudgeted - budgetsData.totalSpent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                          {fmt(budgetsData.totalBudgeted - budgetsData.totalSpent)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="w-full bg-white/60 dark:bg-black/20 rounded-full h-2">
                        <div className="h-2 rounded-full transition-all bg-violet-500" style={{ width: `${Math.min(100, (budgetsData.totalSpent / budgetsData.totalBudgeted) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 text-right">{Math.round((budgetsData.totalSpent / budgetsData.totalBudgeted) * 100)}% ejecutado</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Budget cards */}
                <div className="space-y-3">
                  {budgetsData.budgets.sort((a, b) => b.pct - a.pct).map(b => (
                    <BudgetCard key={b.id} budget={b} onEdit={() => setBudgetModal({ open: true, budget: b })} onDelete={async () => {
                      if (!confirm(`¿Eliminar presupuesto de ${b.category?.name ?? "esta categoría"}?`)) return;
                      await fetch(`${BASE}/api/finance/budgets/${b.id}`, { method: "DELETE", credentials: "include" });
                      qc.invalidateQueries({ queryKey: ["/api/finance/budgets"] });
                      toast({ title: "Presupuesto eliminado" });
                    }} />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── PROYECCIÓN TAB ────────────────────────────────────────── */}
          <TabsContent value="proyeccion" className="mt-5 space-y-5">
            {projectionLoading ? (
              <div className="space-y-4">{[...Array(3)].map((_, i) => <Card key={i}><CardContent className="h-32 animate-pulse bg-muted rounded-lg m-3" /></Card>)}</div>
            ) : !projectionData ? null : (
              <>
                {/* 3 horizon cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "En 7 días", data: projectionData.projection7d, color: "emerald" },
                    { label: "En 15 días", data: projectionData.projection15d, color: "blue" },
                    { label: "Fin de mes", data: projectionData.projectionMonthEnd, color: "violet" },
                  ].map(({ label, data, color }) => {
                    const riskColor = data.risk === "high" ? "text-red-500" : data.risk === "medium" ? "text-amber-500" : `text-${color}-600 dark:text-${color}-400`;
                    const riskLabel = data.risk === "high" ? "Riesgo alto" : data.risk === "medium" ? "Moderado" : "Estable";
                    const riskBg = data.risk === "high" ? "bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800" : data.risk === "medium" ? "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800" : "bg-emerald-100/50 dark:bg-emerald-950/20 border-transparent";
                    return (
                      <Card key={label} className={`${riskBg}`}>
                        <CardContent className="py-4 px-4 text-center">
                          <p className="text-xs text-muted-foreground mb-1">{label}</p>
                          <p className={`text-xl font-bold tabular-nums ${data.saldo < 0 ? "text-red-500" : riskColor}`}>{fmt(data.saldo)}</p>
                          <p className={`text-xs mt-1 font-medium ${data.risk === "high" ? "text-red-500" : data.risk === "medium" ? "text-amber-500" : "text-emerald-600 dark:text-emerald-400"}`}>{riskLabel}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Projection chart */}
                {projectionData.dailySeries.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart2 className="h-4 w-4 text-muted-foreground" /> Evolución del saldo (próximos 35 días)</CardTitle></CardHeader>
                    <CardContent className="pb-4 px-4">
                      <ProjectionChart series={projectionData.dailySeries} />
                    </CardContent>
                  </Card>
                )}

                {/* High pressure days */}
                {projectionData.highPressureDays.length > 0 && (
                  <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10">
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400"><Zap className="h-4 w-4" /> Días de mayor presión</CardTitle></CardHeader>
                    <CardContent className="pb-4 space-y-1">
                      {projectionData.highPressureDays.map(d => (
                        <div key={d.date} className="flex items-center justify-between text-sm px-2">
                          <span className="text-muted-foreground">{d.date}</span>
                          <span className="font-semibold text-red-500">{fmt(d.totalExpenses)}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Insights */}
                {insightsData?.insights && insightsData.insights.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> Insights automáticos</CardTitle></CardHeader>
                    <CardContent className="pb-4 space-y-2">
                      {insightsData.insights.map(ins => <InsightRow key={ins.id} insight={ins} />)}
                    </CardContent>
                  </Card>
                )}

                {/* Calendar */}
                {projectionData.calendarEvents.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /> Calendario financiero</CardTitle></CardHeader>
                    <CardContent className="pb-4">
                      <FinancialCalendar events={projectionData.calendarEvents} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button size="lg" className="h-14 w-14 rounded-full shadow-2xl bg-violet-600 hover:bg-violet-700 text-white p-0" onClick={() => setTxModal({ open: true, tx: null })}>
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Modals */}
      {txModal.open && <TransactionModal open={txModal.open} onClose={() => setTxModal({ open: false, tx: null })} tx={txModal.tx} categories={categories} accounts={accounts} cards={allCards} onSaved={invalidateAll} />}
      {acctModal.open && <AccountModal open={acctModal.open} onClose={() => setAcctModal({ open: false, acct: null })} acct={acctModal.acct} onSaved={invalidateAll} />}
      {cardModal.open && <CardModal open={cardModal.open} onClose={() => setCardModal({ open: false, card: null })} card={cardModal.card} onSaved={invalidateAll} />}
      {installModal.open && <InstallmentPlanModal open={installModal.open} onClose={() => setInstallModal({ open: false, plan: null })} plan={installModal.plan} cards={allCards} categories={categories} onSaved={invalidateAll} />}
      {loanModal.open && <LoanModal open={loanModal.open} onClose={() => setLoanModal({ open: false, loan: null })} loan={loanModal.loan} onSaved={invalidateAll} />}
      {recurModal.open && <RecurringModal open={recurModal.open} onClose={() => setRecurModal({ open: false, rule: null })} rule={recurModal.rule} categories={categories} accounts={accounts} onSaved={invalidateAll} />}
      {budgetModal.open && <BudgetModal open={budgetModal.open} onClose={() => setBudgetModal({ open: false, budget: null })} budget={budgetModal.budget} categories={categories.filter(c => c.type === "expense")} month={budgetMonth} onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/finance/budgets"] }); }} />}
      <DeleteConfirmDialog open={deleteConfirm.open} title={deleteConfirm.title} description={deleteConfirm.description} onCancel={() => setDeleteConfirm(s => ({ ...s, open: false }))} onConfirm={deleteConfirm.onConfirm} />
    </div>
  );
}

// ─── RECURRING RULE ROW ────────────────────────────────────────────────────

function RecurringRuleRow({ rule, catMap, acctMap, onEdit, onDelete, onToggle }: {
  rule: FinanceRecurringRule;
  catMap: Record<number, FinanceCategory>;
  acctMap: Record<number, FinanceAccount>;
  onEdit: () => void; onDelete: () => void; onToggle: () => void;
}) {
  const cat = rule.categoryId ? catMap[rule.categoryId] : null;
  const acct = rule.accountId ? acctMap[rule.accountId] : null;
  return (
    <Card className={`group ${!rule.isActive ? "opacity-60" : ""}`}>
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted shrink-0">
            {rule.type === "income" ? <ArrowUpCircle className="h-5 w-5 text-emerald-500" /> : <ArrowDownCircle className="h-5 w-5 text-red-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">{rule.name}</p>
              {!rule.isActive && <Badge variant="outline" className="text-xs">Pausada</Badge>}
              <Badge variant="outline" className="text-xs">{FREQ_LABEL[rule.frequency]}</Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {cat && <span style={{ color: cat.color }}>{cat.name}</span>}
              {acct && <span>{acct.label}</span>}
              {rule.nextDate && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Próx: {rule.nextDate}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <p className={`text-base font-bold tabular-nums ${rule.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
              {rule.type === "income" ? "+" : "-"}{fmt(parseFloat(rule.amount))}
            </p>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle} title={rule.isActive ? "Pausar" : "Reactivar"}>
                {rule.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── BUDGET CARD ───────────────────────────────────────────────────────────

function BudgetCard({ budget: b, onEdit, onDelete }: { budget: BudgetWithSpending; onEdit: () => void; onDelete: () => void }) {
  const statusColors = {
    ok: { bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400", label: "En rango" },
    warning: { bar: "bg-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400", label: "Atención" },
    critical: { bar: "bg-red-400", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400", label: "Crítico" },
    exceeded: { bar: "bg-red-600", badge: "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-300", label: "Excedido" },
  };
  const s = statusColors[b.status];
  return (
    <Card className={`group ${b.status === "exceeded" ? "border-red-300 dark:border-red-800" : b.status === "critical" ? "border-amber-300 dark:border-amber-800" : ""}`}>
      <CardContent className="px-5 py-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: (b.category?.color ?? "#6b7280") + "22" }}>
              <Target className="h-4 w-4" style={{ color: b.category?.color ?? "#6b7280" }} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{b.category?.name ?? "Sin categoría"}</p>
              <p className="text-xs text-muted-foreground">{b.month}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}>{s.label}</span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3 text-center">
          <div><p className="text-xs text-muted-foreground">Presupuestado</p><p className="text-sm font-bold">${b.amount.toLocaleString("es-AR")}</p></div>
          <div><p className="text-xs text-muted-foreground">Gastado</p><p className={`text-sm font-bold ${b.status === "ok" ? "" : "text-red-500"}`}>${b.spent.toLocaleString("es-AR")}</p></div>
          <div><p className="text-xs text-muted-foreground">Disponible</p><p className={`text-sm font-bold ${b.remaining >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>${Math.abs(b.remaining).toLocaleString("es-AR")}{b.remaining < 0 ? " excedido" : ""}</p></div>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div className={`h-2 rounded-full transition-all ${s.bar}`} style={{ width: `${Math.min(100, b.pct)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-right">{Math.round(b.pct)}% ejecutado</p>
      </CardContent>
    </Card>
  );
}

// ─── BUDGET MODAL ──────────────────────────────────────────────────────────

function BudgetModal({ open, onClose, budget, categories, month, onSaved }: {
  open: boolean; onClose: () => void; budget: BudgetWithSpending | null;
  categories: FinanceCategory[]; month: string; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    categoryId: budget?.categoryId ? String(budget.categoryId) : "",
    amount: budget?.amount ? String(budget.amount) : "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.categoryId || !form.amount) { toast({ title: "Seleccioná una categoría y un monto", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = budget ? `${BASE}/api/finance/budgets/${budget.id}` : `${BASE}/api/finance/budgets`;
      const method = budget ? "PUT" : "POST";
      const body = budget ? { amount: parseFloat(form.amount) } : { categoryId: parseInt(form.categoryId, 10), month, amount: parseFloat(form.amount) };
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      toast({ title: budget ? "Presupuesto actualizado" : "Presupuesto creado" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{budget ? "Editar presupuesto" : "Nuevo presupuesto"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Mes</Label>
            <p className="text-sm font-medium capitalize">{new Date(month + "-15").toLocaleString("es-AR", { month: "long", year: "numeric" })}</p>
          </div>
          {!budget && (
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná una categoría" /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {budget && <div><Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label><p className="text-sm font-medium">{budget.category?.name ?? "—"}</p></div>}
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto presupuestado</Label>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input type="number" className="pl-6" placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} autoFocus />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : budget ? "Guardar" : "Crear presupuesto"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── INSIGHT ROW ───────────────────────────────────────────────────────────

function InsightRow({ insight: ins }: { insight: Insight }) {
  const levelStyles = {
    green: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300",
    warning: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300",
    red: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300",
    info: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-300",
  };
  const icons: Record<string, ReactNode> = {
    "trending-up": <TrendingUp className="h-4 w-4 shrink-0" />,
    "trending-down": <TrendingDown className="h-4 w-4 shrink-0" />,
    "pie-chart": <PieChart className="h-4 w-4 shrink-0" />,
    "alert-triangle": <AlertTriangle className="h-4 w-4 shrink-0" />,
    "zap": <Zap className="h-4 w-4 shrink-0" />,
    "repeat": <Repeat className="h-4 w-4 shrink-0" />,
    "calendar": <Calendar className="h-4 w-4 shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${levelStyles[ins.level]}`}>
      {icons[ins.icon] ?? <Info className="h-4 w-4 shrink-0" />}
      <span>{ins.text}</span>
    </div>
  );
}

// ─── PROJECTION CHART (SVG) ────────────────────────────────────────────────

function ProjectionChart({ series }: { series: { date: string; saldo: number }[] }) {
  if (series.length < 2) return null;
  const W = 700, H = 160, PAD = { t: 12, b: 32, l: 10, r: 10 };
  const values = series.map(s => s.saldo);
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, 0);
  const range = maxVal - minVal || 1;
  const toX = (i: number) => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r);
  const toY = (v: number) => PAD.t + ((maxVal - v) / range) * (H - PAD.t - PAD.b);
  const zeroY = toY(0);

  const points = series.map((s, i) => `${toX(i)},${toY(s.saldo)}`).join(" ");
  const areaPoints = `${toX(0)},${zeroY} ${points} ${toX(series.length - 1)},${zeroY}`;

  const tickDates = [0, 7, 15, 30].filter(d => d < series.length);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minWidth: 300 }}>
        {/* Zero line */}
        <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 2" />
        {/* Area fill */}
        <polygon points={areaPoints} fill={minVal < 0 ? "#ef444420" : "#10b98120"} />
        {/* Line */}
        <polyline points={points} fill="none" stroke={minVal < 0 ? "#ef4444" : "#10b981"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Today marker */}
        <line x1={toX(0)} y1={PAD.t} x2={toX(0)} y2={H - PAD.b} stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="3 2" />
        <text x={toX(0) + 3} y={PAD.t + 10} fontSize="9" fill="#8b5cf6">Hoy</text>
        {/* Tick labels */}
        {tickDates.map(d => (
          <g key={d}>
            <text x={toX(d)} y={H - 6} fontSize="9" fill="#9ca3af" textAnchor="middle">{series[d]?.date?.slice(5) ?? ""}</text>
          </g>
        ))}
        {/* Start and end values */}
        <text x={PAD.l + 2} y={toY(values[0]) - 4} fontSize="9" fill="#6b7280">${Math.round(values[0] / 1000)}k</text>
        <text x={W - PAD.r - 2} y={toY(values[values.length - 1]) - 4} fontSize="9" fill="#6b7280" textAnchor="end">${Math.round(values[values.length - 1] / 1000)}k</text>
      </svg>
    </div>
  );
}

// ─── FINANCIAL CALENDAR ────────────────────────────────────────────────────

function FinancialCalendar({ events }: { events: CalendarEvent[] }) {
  const catIcon: Record<string, ReactNode> = {
    "card": <CreditCard className="h-3.5 w-3.5" />,
    "loan": <Landmark className="h-3.5 w-3.5" />,
    "installment": <Layers className="h-3.5 w-3.5" />,
    "recurring": <Repeat className="h-3.5 w-3.5" />,
  };
  const catColor: Record<string, string> = {
    "card": "#f43f5e", "loan": "#0ea5e9", "installment": "#8b5cf6", "recurring": "#10b981",
  };

  // Group by date
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    grouped[e.date] = [...(grouped[e.date] ?? []), e];
  }
  const dates = Object.keys(grouped).sort();

  if (!dates.length) return <p className="text-sm text-muted-foreground text-center py-4">No hay eventos próximos</p>;

  return (
    <div className="space-y-3">
      {dates.map(date => {
        const dayEvents = grouped[date];
        const today = new Date().toISOString().slice(0, 10);
        const daysAway = Math.round((new Date(date + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86400000);
        const dayLabel = daysAway === 0 ? "Hoy" : daysAway === 1 ? "Mañana" : `en ${daysAway}d`;
        const totalExp = dayEvents.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
        const urgent = daysAway <= 3 && totalExp > 0;
        return (
          <div key={date} className={`rounded-lg border p-3 space-y-2 ${urgent ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/10" : "bg-muted/30"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{date}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${urgent ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{dayLabel}</span>
              </div>
              {totalExp > 0 && <span className="text-xs font-semibold text-red-500">-${totalExp.toLocaleString("es-AR")}</span>}
            </div>
            <div className="space-y-1">
              {dayEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span style={{ color: catColor[e.category] ?? "#6b7280" }}>{catIcon[e.category] ?? <Info className="h-3.5 w-3.5" />}</span>
                  <span className="flex-1 truncate text-xs">{e.label}</span>
                  <span className={`text-xs font-semibold tabular-nums ${e.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {e.type === "income" ? "+" : "-"}${e.amount.toLocaleString("es-AR")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
