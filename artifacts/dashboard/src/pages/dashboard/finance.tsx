import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Wallet, Plus, Pencil, Trash2, RefreshCw,
  ArrowUpCircle, ArrowDownCircle, Calendar, AlertTriangle,
  Clock, Repeat, ChevronDown, X, Filter, Sparkles, Building2,
  CreditCard, Smartphone, DollarSign, PieChart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── TYPES ────────────────────────────────────────────────────────────────

interface FinanceCategory { id: number; type: string; name: string; icon: string; color: string; isDefault: boolean; }
interface FinanceAccount { id: number; type: string; label: string; amount: string; currency: string; notes: string | null; }
interface FinanceTransaction {
  id: number; type: string; amount: number; currency: string;
  categoryId: number | null; accountId: number | null; date: string;
  status: string; paymentMethod: string | null; notes: string | null;
  isFixed: boolean; isRecurring: boolean;
  category: { name: string; color: string; icon: string } | null;
}
interface FinanceRecurringRule {
  id: number; name: string; type: string; amount: string; currency: string;
  categoryId: number | null; accountId: number | null; frequency: string;
  dayOfMonth: number | null; nextDate: string | null; isActive: boolean; notes: string | null;
}
interface CategoryBreakdown { categoryId: number | null; name: string; color: string; total: number; }
interface FinanceSummary {
  ingresosMes: number; gastosMes: number; saldoEstimadoFinMes: number; saldoDisponible: number;
  activos: number; deudas: number; hasData: boolean;
  accounts: FinanceAccount[];
  upcomingRecurrences: { id: number; name: string; type: string; amount: number; frequency: string; nextDate: string | null; category: { name: string; color: string } | null }[];
  recentTransactions: FinanceTransaction[];
  categoryBreakdown: CategoryBreakdown[];
  alerts: { level: "green" | "yellow" | "red"; message: string }[];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

// FIX: removed \u200B (zero-width space) that broke copy-paste of amounts
function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtSigned(n: number) { return (n >= 0 ? "+" : "-") + fmt(n); }

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

const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Débito", "Crédito", "Billetera virtual", "Cripto", "Otro"];

function todayStr() { return new Date().toISOString().slice(0, 10); }

function AlertDot({ level }: { level: "green" | "yellow" | "red" }) {
  const c = level === "green" ? "bg-emerald-500" : level === "yellow" ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${c}`} />;
}

// ─── SUMMARY CARD ─────────────────────────────────────────────────────────
// FIX: removed broken CSS rgba(var()) syntax; using explicit bgColor instead
// FIX: removed unused `trend` prop

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

// ─── DELETE CONFIRM DIALOG ─────────────────────────────────────────────────
// FIX: replaces native confirm() dialog with proper in-app dialog

function DeleteConfirmDialog({ open, onCancel, onConfirm, title, description }: {
  open: boolean; onCancel: () => void; onConfirm: () => void;
  title: string; description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            {title}
          </DialogTitle>
        </DialogHeader>
        {description && <p className="text-sm text-muted-foreground px-1">{description}</p>}
        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm}>Eliminar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CATEGORY BREAKDOWN BAR ────────────────────────────────────────────────

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
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: item.color }} />
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
          Llevá el control de tus ingresos, gastos y cuentas en un solo lugar. Podés empezar cargando datos de ejemplo o crear tu primer movimiento.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onNewAccount} variant="outline" className="gap-1.5">
            <Building2 className="h-4 w-4" /> Crear cuenta
          </Button>
          <Button onClick={onNewTx} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
            <Plus className="h-4 w-4" /> Primer movimiento
          </Button>
          <Button onClick={onLoadDemo} variant="ghost" disabled={loading} className="gap-1.5 text-muted-foreground text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            {loading ? "Cargando..." : "Cargar datos de ejemplo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── TRANSACTION FORM ─────────────────────────────────────────────────────

interface TxFormState {
  type: "income" | "expense";
  amount: string;
  categoryId: string;
  accountId: string;
  date: string;
  status: string;
  paymentMethod: string;
  notes: string;
  isFixed: boolean;
  isRecurring: boolean;
  recurFrequency: string;
  recurDay: string;
  recurNextDate: string;
}

const emptyTxForm = (type: "income" | "expense" = "expense"): TxFormState => ({
  type, amount: "", categoryId: "", accountId: "", date: todayStr(),
  status: "confirmed", paymentMethod: "", notes: "",
  isFixed: false, isRecurring: false, recurFrequency: "monthly", recurDay: "", recurNextDate: "",
});

function TransactionModal({
  open, onClose, tx, categories, accounts, onSaved,
}: {
  open: boolean; onClose: () => void;
  tx: FinanceTransaction | null;
  categories: FinanceCategory[]; accounts: FinanceAccount[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<TxFormState>(() =>
    tx ? {
      type: tx.type as "income" | "expense",
      amount: String(tx.amount),
      categoryId: tx.categoryId ? String(tx.categoryId) : "",
      accountId: tx.accountId ? String(tx.accountId) : "",
      date: tx.date, status: tx.status,
      paymentMethod: tx.paymentMethod ?? "",
      notes: tx.notes ?? "",
      isFixed: tx.isFixed, isRecurring: tx.isRecurring,
      recurFrequency: "monthly", recurDay: "", recurNextDate: "",
    } : emptyTxForm()
  );
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const incomeCategories = categories.filter(c => c.type === "income");
  const expenseCategories = categories.filter(c => c.type === "expense");
  const activeCats = form.type === "income" ? incomeCategories : expenseCategories;

  async function handleSave() {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast({ title: "Ingresá un monto válido", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type: form.type, amount: parseFloat(form.amount),
        categoryId: form.categoryId || null,
        accountId: form.accountId || null,
        date: form.date, status: form.status,
        paymentMethod: form.paymentMethod || null,
        notes: form.notes || null,
        isFixed: form.isFixed, isRecurring: form.isRecurring,
      };
      const url = tx ? `${BASE}/api/finance/transactions/${tx.id}` : `${BASE}/api/finance/transactions`;
      const method = tx ? "PUT" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());

      if (!tx && form.isRecurring && form.recurFrequency) {
        const ruleBody = {
          name: form.notes || (form.type === "income" ? "Ingreso recurrente" : "Gasto recurrente"),
          type: form.type, amount: parseFloat(form.amount),
          categoryId: form.categoryId || null, accountId: form.accountId || null,
          frequency: form.recurFrequency,
          dayOfMonth: form.recurDay ? parseInt(form.recurDay, 10) : null,
          nextDate: form.recurNextDate || null,
        };
        await fetch(`${BASE}/api/finance/recurring-rules`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ruleBody),
        });
      }

      toast({ title: tx ? "Movimiento actualizado" : "Movimiento registrado" });
      onSaved(); onClose();
    } catch { toast({ title: "Error al guardar", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const set = (k: keyof TxFormState, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tx ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {tx ? "Editar movimiento" : "Nuevo movimiento"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex rounded-lg border overflow-hidden">
            {(["income", "expense"] as const).map(t => (
              <button key={t} onClick={() => { set("type", t); set("categoryId", ""); }}
                className={`flex-1 py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${form.type === t
                  ? t === "income" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                  : "bg-transparent text-muted-foreground hover:bg-muted"}`}>
                {t === "income" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                {t === "income" ? "Ingreso" : "Gasto"}
              </button>
            ))}
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <Input type="number" min="0" step="any" placeholder="0" value={form.amount}
                onChange={e => set("amount", e.target.value)}
                className="pl-7 text-lg font-bold h-12" autoFocus />
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

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuenta</Label>
            <Select value={form.accountId} onValueChange={v => set("accountId", v)}>
              <SelectTrigger><SelectValue placeholder="Sin cuenta asignada" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin cuenta</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Nota (opcional)</Label>
            <Input placeholder="Ej: Compra en supermercado" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
              <Checkbox checked={form.isFixed} onCheckedChange={v => set("isFixed", Boolean(v))} />
              Fijo
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
              <Checkbox checked={form.isRecurring} onCheckedChange={v => { set("isRecurring", Boolean(v)); if (v) setAdvanced(true); }} />
              Recurrente
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
            <div className="space-y-3 pt-1">
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
                  <Select value={form.paymentMethod} onValueChange={v => set("paymentMethod", v)}>
                    <SelectTrigger><SelectValue placeholder="Sin especificar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin especificar</SelectItem>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}
            className={form.type === "income" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-500 hover:bg-red-600"}>
            {saving ? "Guardando..." : tx ? "Guardar cambios" : form.type === "income" ? "Registrar ingreso" : "Registrar gasto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ACCOUNT MODAL ────────────────────────────────────────────────────────

function AccountModal({ open, onClose, acct, onSaved }: {
  open: boolean; onClose: () => void; acct: FinanceAccount | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    type: acct?.type ?? "banco", label: acct?.label ?? "",
    amount: acct?.amount ?? "0", currency: acct?.currency ?? "ARS", notes: acct?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.label) { toast({ title: "Ingresá un nombre", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = acct ? `${BASE}/api/finance/accounts/${acct.id}` : `${BASE}/api/finance/accounts`;
      const r = await fetch(url, {
        method: acct ? "PUT" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
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
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Tipo</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ACCOUNT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
            <Input placeholder="Ej: Cuenta corriente Galicia" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Saldo actual</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="USDT">USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Notas</Label>
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

// ─── RECURRING MODAL ──────────────────────────────────────────────────────

function RecurringModal({ open, onClose, rule, categories, accounts, onSaved }: {
  open: boolean; onClose: () => void; rule: FinanceRecurringRule | null;
  categories: FinanceCategory[]; accounts: FinanceAccount[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: rule?.name ?? "", type: rule?.type ?? "expense",
    amount: rule?.amount ?? "", categoryId: rule?.categoryId ? String(rule.categoryId) : "",
    accountId: rule?.accountId ? String(rule.accountId) : "",
    frequency: rule?.frequency ?? "monthly",
    dayOfMonth: rule?.dayOfMonth ? String(rule.dayOfMonth) : "",
    nextDate: rule?.nextDate ?? todayStr(),
    isActive: rule?.isActive ?? true, notes: rule?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const activeCats = categories.filter(c => c.type === form.type);

  async function handleSave() {
    if (!form.name || !form.amount) {
      toast({ title: "Nombre y monto son obligatorios", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const body = {
        ...form, amount: parseFloat(form.amount),
        categoryId: form.categoryId || null, accountId: form.accountId || null,
        dayOfMonth: form.dayOfMonth ? parseInt(form.dayOfMonth, 10) : null,
      };
      const url = rule ? `${BASE}/api/finance/recurring-rules/${rule.id}` : `${BASE}/api/finance/recurring-rules`;
      const r = await fetch(url, {
        method: rule ? "PUT" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
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
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Nombre</Label>
            <Input placeholder="Ej: Sueldo mensual" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Monto</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input type="number" className="pl-6" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Frecuencia</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="annual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Categoría</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
                <SelectContent>{activeCats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Cuenta</Label>
              <Select value={form.accountId} onValueChange={v => setForm(f => ({ ...f, accountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin cuenta</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Próxima fecha</Label>
              <Input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 block">Día del mes</Label>
              <Input type="number" min="1" max="31" placeholder="1-31" value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} />
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
  const [recurModal, setRecurModal] = useState<{ open: boolean; rule: FinanceRecurringRule | null }>({ open: false, rule: null });

  // FIX: delete confirmation state (replaces native confirm() dialogs)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean; title: string; description?: string; onConfirm: () => void;
  }>({ open: false, title: "", onConfirm: () => {} });

  const [filter, setFilter] = useState({ type: "", categoryId: "", accountId: "", status: "", from: "", to: "" });

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

  const categories = categoriesData ?? [];
  const accounts = accountsData ?? [];

  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);
  const acctMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["/api/finance/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/accounts"] });
    qc.invalidateQueries({ queryKey: ["/api/finance/recurring-rules"] });
  }

  const seedMutation = useMutation({
    mutationFn: () => fetch(`${BASE}/api/finance/seed-demo`, { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: data.skipped ? "Ya hay datos cargados" : "Datos demo cargados" });
      invalidateAll();
    },
    onError: () => toast({ title: "Error al cargar demo", variant: "destructive" }),
  });

  // FIX: replaced confirm() with proper dialog
  function confirmDelete(title: string, description: string, action: () => Promise<void>) {
    setDeleteConfirm({
      open: true, title, description,
      onConfirm: async () => {
        setDeleteConfirm(s => ({ ...s, open: false }));
        await action();
      },
    });
  }

  async function deleteTx(id: number) {
    confirmDelete("¿Eliminar movimiento?", "Esta acción no se puede deshacer y puede actualizar el saldo de la cuenta asociada.", async () => {
      const r = await fetch(`${BASE}/api/finance/transactions/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Movimiento eliminado" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }

  async function deleteAccount(id: number) {
    confirmDelete("¿Eliminar cuenta?", "Se eliminará la cuenta. Los movimientos asociados no se borrarán.", async () => {
      const r = await fetch(`${BASE}/api/finance/accounts/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Cuenta eliminada" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }

  async function deleteRule(id: number) {
    confirmDelete("¿Eliminar recurrencia?", "Se eliminará la regla. Los movimientos ya registrados no se verán afectados.", async () => {
      const r = await fetch(`${BASE}/api/finance/recurring-rules/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) { toast({ title: "Regla eliminada" }); invalidateAll(); }
      else toast({ title: "Error al eliminar", variant: "destructive" });
    });
  }

  const hasFilters = Object.values(filter).some(Boolean);
  const hasData = summary?.hasData ?? false;

  return (
    <div className="relative min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6 pb-24">

        {/* Header — FIX: "Cargar demo" moved to empty state onboarding */}
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
          <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:flex">
            <TabsTrigger value="dashboard">Resumen</TabsTrigger>
            <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
            <TabsTrigger value="cuentas">Cuentas</TabsTrigger>
            <TabsTrigger value="recurrencias">Recurrencias</TabsTrigger>
          </TabsList>

          {/* ── DASHBOARD TAB ── */}
          <TabsContent value="dashboard" className="mt-5 space-y-5">
            {summaryLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => <Card key={i}><CardContent className="h-28 animate-pulse bg-muted rounded-lg m-2" /></Card>)}
              </div>
            ) : !summary ? null : !hasData ? (
              /* FIX: onboarding empty state with demo loader */
              <OnboardingCard
                onLoadDemo={() => seedMutation.mutate()}
                onNewAccount={() => { setTab("cuentas"); setAcctModal({ open: true, acct: null }); }}
                onNewTx={() => setTxModal({ open: true, tx: null })}
                loading={seedMutation.isPending}
              />
            ) : (
              <>
                {/* Summary Cards — FIX: uses bgColor instead of broken CSS var */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <SummaryCard label="Saldo disponible" value={fmt(summary.saldoDisponible)}
                    sub="Activos menos deudas"
                    accent="text-violet-600 dark:text-violet-400"
                    bgColor="bg-violet-100 dark:bg-violet-900/30"
                    icon={Wallet} />
                  <SummaryCard label="Ingresos del mes" value={fmt(summary.ingresosMes)}
                    sub="Confirmados"
                    accent="text-emerald-600 dark:text-emerald-400"
                    bgColor="bg-emerald-100 dark:bg-emerald-900/30"
                    icon={TrendingUp} />
                  <SummaryCard label="Gastos del mes" value={fmt(summary.gastosMes)}
                    sub="Confirmados"
                    accent="text-red-500 dark:text-red-400"
                    bgColor="bg-red-100 dark:bg-red-900/30"
                    icon={TrendingDown} />
                  {/* FIX: clearer label and sub-label for estimated balance */}
                  <SummaryCard
                    label="Balance neto del mes"
                    value={fmt(summary.saldoEstimadoFinMes)}
                    sub={summary.saldoEstimadoFinMes >= 0 ? "Ingresos − Gastos (proyectado)" : "Déficit proyectado"}
                    accent={summary.saldoEstimadoFinMes >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}
                    bgColor={summary.saldoEstimadoFinMes >= 0 ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}
                    icon={Calendar}
                  />
                  <SummaryCard label="Próx. recurrencias" value={String(summary.upcomingRecurrences.length)}
                    sub="En 30 días"
                    accent="text-amber-600 dark:text-amber-400"
                    bgColor="bg-amber-100 dark:bg-amber-900/30"
                    icon={Repeat} />
                  <SummaryCard label="Alertas activas" value={String(summary.alerts.length)}
                    sub={summary.alerts.length === 0 ? "Todo en orden" : "Ver detalle abajo"}
                    accent={summary.alerts.some(a => a.level === "red") ? "text-red-500 dark:text-red-400" : summary.alerts.some(a => a.level === "yellow") ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}
                    bgColor={summary.alerts.some(a => a.level === "red") ? "bg-red-100 dark:bg-red-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}
                    icon={AlertTriangle} />
                </div>

                {/* Alerts — FIX: only shown when there are real alerts */}
                {summary.alerts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" /> Alertas
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pb-4">
                      {summary.alerts.map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5 text-sm">
                          <AlertDot level={a.level} />
                          <span>{a.message}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className="grid md:grid-cols-2 gap-5">
                  {/* Recent Transactions */}
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" /> Últimos movimientos
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      {summary.recentTransactions.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Sin movimientos registrados</p>
                      ) : (
                        <div className="space-y-1">
                          {summary.recentTransactions.map(tx => (
                            <div key={tx.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
                                style={{ background: (tx.category?.color ?? "#6b7280") + "22" }}>
                                {tx.type === "income"
                                  ? <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                                  : <ArrowDownCircle className="h-4 w-4 text-red-500" />}
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
                      <Button variant="link" size="sm" className="mt-1 text-xs px-2" onClick={() => setTab("movimientos")}>
                        Ver todos los movimientos →
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Upcoming Recurrences */}
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Repeat className="h-4 w-4 text-muted-foreground" /> Próximos movimientos recurrentes
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      {summary.upcomingRecurrences.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No hay recurrencias en los próximos 30 días</p>
                      ) : (
                        <div className="space-y-1">
                          {summary.upcomingRecurrences.map(r => (
                            <div key={r.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
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
                      <Button variant="link" size="sm" className="mt-1 text-xs px-2" onClick={() => setTab("recurrencias")}>
                        Gestionar recurrencias →
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* FIX: new category spending breakdown */}
                {summary.categoryBreakdown.length > 0 && (
                  <CategoryBreakdownSection
                    breakdown={summary.categoryBreakdown}
                    total={summary.gastosMes}
                  />
                )}

                {/* Accounts mini */}
                {summary.accounts.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" /> Cuentas
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {summary.accounts.map(a => {
                          const meta = ACCOUNT_META[a.type] ?? ACCOUNT_META["banco"];
                          const Icon = meta.icon;
                          return (
                            <div key={a.id} className="rounded-lg border bg-card p-3 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                                <span className="text-xs text-muted-foreground truncate">{a.label}</span>
                              </div>
                              <p className={`text-base font-bold tabular-nums ${a.type === "deuda" ? "text-red-500" : "text-foreground"}`}>
                                {a.currency !== "ARS" ? a.currency + " " : ""}{fmt(parseFloat(a.amount))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <Button variant="link" size="sm" className="mt-2 text-xs px-2" onClick={() => setTab("cuentas")}>
                        Gestionar cuentas →
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── MOVIMIENTOS TAB ── */}
          <TabsContent value="movimientos" className="mt-5 space-y-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={filter.type || "all"} onValueChange={v => setFilter(f => ({ ...f, type: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los tipos</SelectItem>
                      <SelectItem value="income">Ingresos</SelectItem>
                      <SelectItem value="expense">Gastos</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filter.categoryId || "all"} onValueChange={v => setFilter(f => ({ ...f, categoryId: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Categoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las categorías</SelectItem>
                      {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filter.accountId || "all"} onValueChange={v => setFilter(f => ({ ...f, accountId: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Cuenta" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las cuentas</SelectItem>
                      {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filter.status || "all"} onValueChange={v => setFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los estados</SelectItem>
                      {Object.entries(STATUS_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" className="h-8 w-36 text-xs" value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} />
                  <Input type="date" className="h-8 w-36 text-xs" value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} />
                  {hasFilters && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setFilter({ type: "", categoryId: "", accountId: "", status: "", from: "", to: "" })}>
                      <X className="h-3 w-3" /> Limpiar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {txLoading ? (
              <Card><CardContent className="h-40 animate-pulse bg-muted rounded-lg mt-4" /></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fecha</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descripción</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Categoría</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden md:table-cell">Cuenta</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Estado</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monto</th>
                          <th className="py-3 px-4 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!txData?.transactions?.length ? (
                          <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Wallet className="h-8 w-8 opacity-20" />
                              <p>Sin movimientos{hasFilters ? " con estos filtros" : ""}</p>
                              {!hasFilters && <Button size="sm" variant="outline" className="mt-2" onClick={() => setTxModal({ open: true, tx: null })}>Cargar primer movimiento</Button>}
                            </div>
                          </td></tr>
                        ) : txData.transactions.map(tx => (
                          <tr key={tx.id} className="border-b hover:bg-muted/30 transition-colors group">
                            <td className="py-3 px-4 text-muted-foreground tabular-nums whitespace-nowrap">{tx.date}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {tx.type === "income"
                                  ? <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                  : <ArrowDownCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                                <span className="truncate max-w-[140px]">{tx.notes || tx.category?.name || (tx.type === "income" ? "Ingreso" : "Gasto")}</span>
                                {tx.isRecurring && <Repeat className="h-3 w-3 text-muted-foreground shrink-0" />}
                              </div>
                            </td>
                            <td className="py-3 px-4 hidden sm:table-cell">
                              {tx.category ? (
                                <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5"
                                  style={{ background: tx.category.color + "22", color: tx.category.color }}>
                                  {tx.category.name}
                                </span>
                              ) : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-xs hidden md:table-cell">
                              {tx.accountId ? acctMap[tx.accountId]?.label ?? "—" : "—"}
                            </td>
                            <td className="py-3 px-4 hidden sm:table-cell">
                              {STATUS_META[tx.status] ? (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[tx.status].color}`}>
                                  {STATUS_META[tx.status].label}
                                </span>
                              ) : tx.status}
                            </td>
                            <td className={`py-3 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${tx.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                              {tx.type === "income" ? "+" : "-"}{fmt(tx.amount)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setTxModal({ open: true, tx })}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteTx(tx.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
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
                      <span>
                        Balance:{" "}
                        <span className={
                          txData.transactions.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0) >= 0
                            ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                            : "text-red-500 dark:text-red-400 font-semibold"
                        }>
                          {fmtSigned(txData.transactions.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0))}
                        </span>
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── CUENTAS TAB ── */}
          <TabsContent value="cuentas" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAcctModal({ open: true, acct: null })} className="gap-1.5">
                <Plus className="h-4 w-4" /> Nueva cuenta
              </Button>
            </div>
            {!accountsData?.length ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Wallet className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-muted-foreground">No tenés cuentas creadas</p>
                  <Button className="mt-4" onClick={() => setAcctModal({ open: true, acct: null })}>Crear primera cuenta</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {accountsData.map(a => {
                  const meta = ACCOUNT_META[a.type] ?? ACCOUNT_META["banco"];
                  const Icon = meta.icon;
                  const bal = parseFloat(a.amount);
                  return (
                    <Card key={a.id} className="group">
                      <CardContent className="pt-5 pb-4 px-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${meta.bgColor}`}>
                              <Icon className={`h-5 w-5 ${meta.color}`} />
                            </div>
                            <div>
                              <p className="font-semibold text-sm leading-tight">{a.label}</p>
                              <p className="text-xs text-muted-foreground">{meta.label} · {a.currency}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAcctModal({ open: true, acct: a })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteAccount(a.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <p className={`text-2xl font-bold tabular-nums mt-3 ${a.type === "deuda" ? "text-red-500 dark:text-red-400" : ""}`}>
                          {a.currency !== "ARS" ? a.currency + " " : ""}{fmt(bal)}
                        </p>
                        {a.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{a.notes}</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── RECURRENCIAS TAB ── */}
          <TabsContent value="recurrencias" className="mt-5 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setRecurModal({ open: true, rule: null })} className="gap-1.5">
                <Plus className="h-4 w-4" /> Nueva recurrencia
              </Button>
            </div>
            {!rulesData?.length ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Repeat className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-muted-foreground">No tenés movimientos recurrentes configurados</p>
                  <Button className="mt-4" onClick={() => setRecurModal({ open: true, rule: null })}>Crear primera recurrencia</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {rulesData.map(rule => {
                  const cat = rule.categoryId ? catMap[rule.categoryId] : null;
                  const acct = rule.accountId ? acctMap[rule.accountId] : null;
                  return (
                    <Card key={rule.id} className={`group ${!rule.isActive ? "opacity-60" : ""}`}>
                      <CardContent className="px-5 py-4">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted shrink-0">
                            {rule.type === "income"
                              ? <ArrowUpCircle className="h-5 w-5 text-emerald-500" />
                              : <ArrowDownCircle className="h-5 w-5 text-red-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{rule.name}</p>
                              {!rule.isActive && <Badge variant="outline" className="text-xs">Inactiva</Badge>}
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
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRecurModal({ open: true, rule })}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteRule(rule.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          size="lg"
          className="h-14 w-14 rounded-full shadow-2xl bg-violet-600 hover:bg-violet-700 text-white p-0"
          onClick={() => setTxModal({ open: true, tx: null })}>
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Modals */}
      {txModal.open && (
        <TransactionModal
          open={txModal.open}
          onClose={() => setTxModal({ open: false, tx: null })}
          tx={txModal.tx}
          categories={categories}
          accounts={accounts}
          onSaved={invalidateAll}
        />
      )}
      {acctModal.open && (
        <AccountModal
          open={acctModal.open}
          onClose={() => setAcctModal({ open: false, acct: null })}
          acct={acctModal.acct}
          onSaved={invalidateAll}
        />
      )}
      {recurModal.open && (
        <RecurringModal
          open={recurModal.open}
          onClose={() => setRecurModal({ open: false, rule: null })}
          rule={recurModal.rule}
          categories={categories}
          accounts={accounts}
          onSaved={invalidateAll}
        />
      )}

      {/* FIX: delete confirmation dialog (replaces native confirm()) */}
      <DeleteConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.title}
        description={deleteConfirm.description}
        onCancel={() => setDeleteConfirm(s => ({ ...s, open: false }))}
        onConfirm={deleteConfirm.onConfirm}
      />
    </div>
  );
}
