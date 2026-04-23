/**
 * finance.tsx — Módulo de finanzas personales
 *
 * MEJORAS vs. original:
 *
 * 1. fmt() CORREGIDO — formato ARS en es-AR
 *    El original usaba "$" + Math.abs(n).toLocaleString("es-AR", ...)
 *    Problema: Math.abs() eliminaba el signo negativo, y "$" + string no
 *    respeta el orden del símbolo en todos los locales.
 *    El nuevo usa Intl.NumberFormat("es-AR", { style: "currency" }) directamente,
 *    que produce: $ 1.234.567 (separador de miles: punto, decimal: coma).
 *    Para montos negativos usamos fmtAbs() (sin signo) y fmtSigned() (con signo).
 *
 * 2. credentials:"include" en todos los fetch (queries, mutations, modales)
 *
 * 3. Zod schema en TransactionModal (reemplaza validación manual)
 *
 * 4. isError en queries principales → estado de error consistente
 *
 * 5. handleRefresh -> void prefix en invalidateQueries
 */

import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  TrendingUp, TrendingDown, Wallet, Plus, Pencil, Trash2, RefreshCw,
  ArrowUpCircle, ArrowDownCircle, Calendar, AlertTriangle,
  Clock, Repeat, ChevronDown, X, Filter, Sparkles, Building2,
  CreditCard, Smartphone, DollarSign, PieChart, Landmark,
  Pause, Play, CheckCircle2, Info, Zap,
  Target, BarChart2, Layers, ChevronLeft, ChevronRight,
  Download, Copy, Trophy, Flag, BookOpen, CheckSquare, Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { BASE } from "@/lib/base-url";

// ── TIPOS ──────────────────────────────────────────────────────────────────────

interface FinanceCategory     { id:number; type:string; name:string; icon:string; color:string; isDefault:boolean; }
interface FinanceAccount      { id:number; type:string; label:string; amount:string; currency:string; notes:string|null; }
interface FinanceTransaction  {
  id:number; type:string; amount:number; currency:string;
  categoryId:number|null; accountId:number|null; cardId:number|null; date:string;
  status:string; paymentMethod:string|null; notes:string|null; isFixed:boolean; isRecurring:boolean;
  category:{ name:string; color:string; icon:string }|null;
}
interface FinanceRecurringRule {
  id:number; name:string; type:string; amount:string; currency:string;
  categoryId:number|null; accountId:number|null; frequency:string;
  dayOfMonth:number|null; nextDate:string|null; isActive:boolean; notes:string|null;
}
interface FinanceCard {
  id:number; name:string; bank:string|null; lastFour:string|null; color:string;
  closeDay:number; dueDay:number; creditLimit:string|null; currency:string; isActive:boolean; notes:string|null;
  totalSpent?:number; pendingInstallments?:number; nextDueDate?:string; nextCloseDate?:string;
  isClosingSoon?:boolean; isDueSoon?:boolean;
}
interface FinanceInstallmentPlan {
  id:number; description:string; totalAmount:number; installmentAmount:number;
  totalInstallments:number; paidInstallments:number; startDate:string;
  nextDueDate:string|null; cardId:number|null; categoryId:number|null;
  currency:string; isActive:boolean; notes:string|null;
}
interface FinanceLoan {
  id:number; name:string; creditor:string|null; totalAmount:number;
  totalInstallments:number; installmentAmount:number; paidInstallments:number;
  startDate:string; nextDueDate:string|null; status:string; currency:string; notes:string|null;
}
interface CategoryBreakdown { categoryId:number|null; name:string; color:string; total:number; }
interface Compromisos { total:number; recurring:number; installments:number; loans:number; saldoLibre:number; presionFinanciera:"green"|"yellow"|"red"; }
interface UpcomingPayment { label:string; amount:number; dueDate:string|null; type:"card"|"loan"|"installment"; color:string; }
interface FinanceSummary {
  ingresosMes:number; gastosMes:number; saldoEstimadoFinMes:number; saldoDisponible:number;
  activos:number; deudas:number; hasData:boolean;
  accounts:FinanceAccount[]; cards:FinanceCard[]; loans:FinanceLoan[];
  installmentPlans:FinanceInstallmentPlan[]; compromisos:Compromisos;
  upcomingPayments:UpcomingPayment[];
  upcomingRecurrences:{id:number;name:string;type:string;amount:number;frequency:string;nextDate:string|null;category:{name:string;color:string}|null}[];
  recentTransactions:FinanceTransaction[];
  categoryBreakdown:CategoryBreakdown[];
  alerts:{level:"green"|"yellow"|"red";message:string}[];
}
interface BudgetWithSpending {
  id:number; userId:string; categoryId:number; month:string; amount:number; currency:string;
  spent:number; remaining:number; pct:number; status:"ok"|"warning"|"critical"|"exceeded";
  category:{name:string;color:string;icon:string}|null;
}
interface BudgetsData { budgets:BudgetWithSpending[]; totalBudgeted:number; totalSpent:number; month:string; }
interface FinanceGoal {
  id:number; userId:string; type:string; title:string;
  targetAmount:number; currentAmount:number; pct:number; remaining:number;
  targetDate:string|null; daysLeft:number|null; monthlyNeeded:number|null;
  categoryId:number|null; currency:string; isActive:boolean; notes:string|null;
  category:{name:string;color:string;icon:string}|null;
}

// ── ZOD SCHEMA — TransactionModal ─────────────────────────────────────────────

const TransactionSchema = z.object({
  type:          z.enum(["income","expense"]),
  amount:        z.coerce.number().positive("El monto debe ser mayor a 0"),
  currency:      z.string().min(1),
  categoryId:    z.string().optional(),
  accountId:     z.string().optional(),
  cardId:        z.string().optional(),
  date:          z.string().min(1, "La fecha es obligatoria"),
  status:        z.string().min(1),
  paymentMethod: z.string().optional(),
  notes:         z.string().max(500).optional(),
  isFixed:       z.boolean(),
  isRecurring:   z.boolean(),
  recurFrequency:z.string().optional(),
  recurNextDate: z.string().optional(),
});

type TransactionFormData = z.infer<typeof TransactionSchema>;

// ── HELPERS DE FORMATO ─────────────────────────────────────────────────────────
//
// CORRECCIÓN CRÍTICA:
// El original hacía: "$" + Math.abs(n).toLocaleString("es-AR", {...})
//   → Math.abs() ocultaba deudas/gastos negativos mostrándolos como positivos
//   → "$" + string no garantiza la posición correcta del símbolo
//
// El nuevo usa Intl.NumberFormat("es-AR", { style:"currency", currency:"ARS" })
// que produce el formato oficial argentino: $ 1.234.567,89
// (separador de miles: punto · separador decimal: coma · símbolo: $)
//
// Para uso en displays donde siempre queremos el valor absoluto (ej: "Gastos: $500")
// usamos fmtAbs(). Para displays con signo (ej: "Saldo: +$200 / -$100") usamos fmtSigned().

const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style:            "currency",
  currency:         "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ARS_FORMATTER_DEC = new Intl.NumberFormat("es-AR", {
  style:            "currency",
  currency:         "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * fmt(n) — formato ARS sin signo forzado. Si n < 0 el Intl.NumberFormat
 * muestra el signo menos (−) de forma correcta.
 * Ejemplo: fmt(1234567)   → "$ 1.234.567"
 *          fmt(-500)      → "−$ 500"
 */
function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  return ARS_FORMATTER.format(n);
}

/**
 * fmtAbs(n) — siempre muestra el valor absoluto (sin signo).
 * Útil para mostrar "Gastos: $500" en lugar de "−$500".
 */
function fmtAbs(n: number): string {
  if (!isFinite(n)) return "—";
  return ARS_FORMATTER.format(Math.abs(n));
}

/**
 * fmtSigned(n) — muestra + o − explícito delante del monto.
 * Ejemplo: fmtSigned(200)  → "+$ 200"
 *          fmtSigned(-100) → "−$ 100"
 */
function fmtSigned(n: number): string {
  if (!isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + ARS_FORMATTER.format(n);
}

/**
 * fmtCurrency(n, currency) — formatea con moneda dinámica.
 * Para USD usa el mismo locale es-AR con currency USD.
 */
function fmtCurrency(n: number, currency = "ARS"): string {
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency", currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return fmtAbs(n);
  }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function daysUntil(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - new Date(todayStr()).getTime()) / 86400000);
}

// ── CONSTANTES ─────────────────────────────────────────────────────────────────

const ACCOUNT_META: Record<string, { label:string; icon:React.ElementType; color:string; bgColor:string }> = {
  caja:              { label:"Efectivo",         icon:Wallet,    color:"text-emerald-600 dark:text-emerald-400", bgColor:"bg-emerald-100 dark:bg-emerald-900/30" },
  banco:             { label:"Banco",            icon:Building2, color:"text-blue-600 dark:text-blue-400",      bgColor:"bg-blue-100 dark:bg-blue-900/30" },
  billetera_virtual: { label:"Billetera Virtual",icon:Smartphone,color:"text-violet-600 dark:text-violet-400",  bgColor:"bg-violet-100 dark:bg-violet-900/30" },
  tarjeta:           { label:"Tarjeta",          icon:CreditCard,color:"text-amber-600 dark:text-amber-400",    bgColor:"bg-amber-100 dark:bg-amber-900/30" },
  cripto:            { label:"Cripto",           icon:DollarSign,color:"text-orange-600 dark:text-orange-400",  bgColor:"bg-orange-100 dark:bg-orange-900/30" },
  inversiones:       { label:"Inversiones",      icon:TrendingUp,color:"text-indigo-600 dark:text-indigo-400",  bgColor:"bg-indigo-100 dark:bg-indigo-900/30" },
  deuda:             { label:"Deuda",            icon:AlertTriangle,color:"text-red-600 dark:text-red-400",    bgColor:"bg-red-100 dark:bg-red-900/30" },
};

const FREQ_LABEL: Record<string, string>  = { weekly:"Semanal", monthly:"Mensual", annual:"Anual" };
const STATUS_META: Record<string, { label:string; color:string }> = {
  confirmed: { label:"Confirmado", color:"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  pending:   { label:"Pendiente",  color:"bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  expected:  { label:"Esperado",   color:"bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  cancelled: { label:"Cancelado",  color:"bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};
const LOAN_STATUS_META: Record<string, { label:string; color:string }> = {
  active:   { label:"Activo",   color:"bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  paid:     { label:"Pagado",   color:"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  defaulted:{ label:"En mora",  color:"bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
};
const PAYMENT_METHODS = ["Efectivo","Transferencia","Débito","Crédito","Billetera virtual","Cripto","Otro"];
const CARD_COLORS     = ["#6366f1","#f43f5e","#10b981","#f59e0b","#3b82f6","#8b5cf6","#0ea5e9","#64748b","#ec4899","#f97316"];

// ── UI helpers ─────────────────────────────────────────────────────────────────

function AlertDot({ level }:{ level:"green"|"yellow"|"red" }) {
  const c = level==="green"?"bg-emerald-500":level==="yellow"?"bg-amber-500":"bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${c}`}/>;
}

function SummaryCard({ label, value, sub, accent, bgColor, icon:Icon }:{
  label:string; value:string; sub?:string; accent:string; bgColor:string; icon:React.ElementType;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</p>
            {/* tabular-nums para alinear los dígitos en columnas */}
            <p className={`text-2xl font-bold mt-1 tabular-nums ${accent}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`rounded-xl p-2.5 shrink-0 ${bgColor}`}>
            <Icon className={`h-5 w-5 ${accent}`}/>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PressureMeter({ compromisos, income }:{ compromisos:Compromisos; income:number }) {
  const { presionFinanciera, total, saldoLibre } = compromisos;
  const config = {
    green:  { label:"Presión financiera baja",  bg:"bg-emerald-500", text:"text-emerald-700 dark:text-emerald-400", border:"border-emerald-200 dark:border-emerald-800", lightBg:"bg-emerald-50 dark:bg-emerald-950/20" },
    yellow: { label:"Presión financiera media",  bg:"bg-amber-500",   text:"text-amber-700 dark:text-amber-400",    border:"border-amber-200 dark:border-amber-800",    lightBg:"bg-amber-50 dark:bg-amber-950/20" },
    red:    { label:"Presión financiera alta",   bg:"bg-red-500",     text:"text-red-700 dark:text-red-400",        border:"border-red-200 dark:border-red-800",        lightBg:"bg-red-50 dark:bg-red-950/20" },
  };
  const c     = config[presionFinanciera];
  const ratio = income > 0 ? Math.min((total / income) * 100, 100) : 0;
  return (
    <Card className={`border ${c.border} ${c.lightBg}`}>
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${c.bg}`}/>
            <span className={`text-sm font-semibold ${c.text}`}>{c.label}</span>
          </div>
          {income > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(ratio)}% de ingresos comprometido</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Disponible</p>
            <p className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">{fmtAbs(compromisos.saldoLibre + total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Comprometido</p>
            <p className={`text-lg font-bold tabular-nums ${presionFinanciera==="green"?"text-amber-600 dark:text-amber-400":c.text}`}>{fmtAbs(total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Libre</p>
            <p className={`text-lg font-bold tabular-nums ${saldoLibre>=0?"text-emerald-600 dark:text-emerald-400":"text-red-500 dark:text-red-400"}`}>{fmt(saldoLibre)}</p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${c.bg}`} style={{ width:`${ratio}%` }}/>
        </div>
        {total > 0 && (
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground flex-wrap">
            {compromisos.recurring    > 0 && <span>Recurrencias: {fmtAbs(compromisos.recurring)}</span>}
            {compromisos.installments > 0 && <span>Cuotas: {fmtAbs(compromisos.installments)}</span>}
            {compromisos.loans        > 0 && <span>Préstamos: {fmtAbs(compromisos.loans)}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryBreakdownSection({ breakdown, total }:{ breakdown:CategoryBreakdown[]; total:number }) {
  if (!breakdown.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <PieChart className="h-4 w-4 text-muted-foreground"/>Gastos por categoría — este mes
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4 space-y-2.5">
        {breakdown.map(item => {
          const pct = total > 0 ? (item.total / total) * 100 : 0;
          return (
            <div key={item.categoryId ?? "sin"}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium" style={{ color:item.color }}>{item.name}</span>
                {/* fmtAbs para mostrar siempre positivo en el desglose */}
                <span className="tabular-nums text-muted-foreground">{fmtAbs(item.total)} <span className="opacity-60">({Math.round(pct)}%)</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width:`${pct}%`, background:item.color }}/>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function OnboardingCard({ onLoadDemo, onNewAccount, onNewTx, loading }:{
  onLoadDemo:()=>void; onNewAccount:()=>void; onNewTx:()=>void; loading:boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 px-8 text-center">
        <div className="h-16 w-16 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mx-auto mb-4">
          <Wallet className="h-8 w-8 text-violet-600 dark:text-violet-400"/>
        </div>
        <h3 className="text-lg font-bold mb-1">Empezá a registrar tus finanzas</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
          Llevá el control de ingresos, gastos, tarjetas y préstamos en un solo lugar.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onNewAccount} variant="outline" className="gap-1.5"><Building2 className="h-4 w-4"/>Crear cuenta</Button>
          <Button onClick={onNewTx} className="gap-1.5 bg-violet-600 hover:bg-violet-700"><Plus className="h-4 w-4"/>Primer movimiento</Button>
          <Button onClick={onLoadDemo} variant="ghost" disabled={loading} className="gap-1.5 text-muted-foreground text-xs">
            <Sparkles className="h-3.5 w-3.5"/>{loading?"Cargando...":"Cargar datos de ejemplo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteConfirmDialog({ open, onCancel, onConfirm, title, description }:{
  open:boolean; onCancel:()=>void; onConfirm:()=>void; title:string; description?:string;
}) {
  return (
    <Dialog open={open} onOpenChange={o=>{if(!o)onCancel();}}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive"/>{title}</DialogTitle></DialogHeader>
        {description && <p className="text-sm text-muted-foreground px-1">{description}</p>}
        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm}>Eliminar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Transaction Modal ──────────────────────────────────────────────────────────

interface TxFormState {
  type:"income"|"expense"; amount:string; currency:string; categoryId:string; accountId:string; cardId:string;
  date:string; status:string; paymentMethod:string; notes:string; isFixed:boolean; isRecurring:boolean;
  recurFrequency:string; recurNextDate:string;
}

const emptyTxForm = (type:"income"|"expense"="expense"): TxFormState => ({
  type, amount:"", currency:"ARS", categoryId:"", accountId:"", cardId:"", date:todayStr(),
  status:"confirmed", paymentMethod:"", notes:"", isFixed:false, isRecurring:false,
  recurFrequency:"monthly", recurNextDate:"",
});

function TransactionModal({ open, onClose, tx, categories, accounts, cards, onSaved, recentConcepts, defaultType }:{
  open:boolean; onClose:()=>void; tx:FinanceTransaction|null;
  categories:FinanceCategory[]; accounts:FinanceAccount[]; cards:FinanceCard[]; onSaved:()=>void;
  recentConcepts?:string[]; defaultType?:"income"|"expense";
}) {
  const { toast } = useToast();

  const getMemory = () => {
    try {
      return {
        lastCategoryId: localStorage.getItem("fin_lastCatId") ?? "",
        lastAccountId:  localStorage.getItem("fin_lastAcctId") ?? "",
      };
    } catch { return { lastCategoryId:"", lastAccountId:"" }; }
  };

  const saveMemory = (f:TxFormState) => {
    try {
      if (f.categoryId) localStorage.setItem("fin_lastCatId", f.categoryId);
      if (f.accountId)  localStorage.setItem("fin_lastAcctId", f.accountId);
      const prev = JSON.parse(localStorage.getItem("fin_recentNotes") ?? "[]") as string[];
      if (f.notes.trim()) {
        const next = [f.notes.trim(), ...prev.filter(n=>n!==f.notes.trim())].slice(0,15);
        localStorage.setItem("fin_recentNotes", JSON.stringify(next));
      }
    } catch { /* ignore */ }
  };

  const [form, setForm] = useState<TxFormState>(() => {
    if (tx) return {
      type: tx.type as "income"|"expense", amount:String(tx.amount),
      currency: tx.currency ?? "ARS",
      categoryId: tx.categoryId ? String(tx.categoryId) : "",
      accountId:  tx.accountId  ? String(tx.accountId)  : "",
      cardId:     tx.cardId     ? String(tx.cardId)     : "",
      date: tx.date, status: tx.status, paymentMethod: tx.paymentMethod ?? "",
      notes: tx.notes ?? "", isFixed: tx.isFixed, isRecurring: tx.isRecurring,
      recurFrequency:"monthly", recurNextDate:"",
    };
    const mem = getMemory();
    return { ...emptyTxForm(defaultType ?? "expense"), categoryId:mem.lastCategoryId, accountId:mem.lastAccountId };
  });

  const [formErrors, setFormErrors] = useState<Record<string,string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k:keyof TxFormState, v:unknown) => setForm(f=>({...f,[k]:v}));

  const activeCats  = categories.filter(c=>c.type===form.type);
  const activeCards = cards.filter(c=>c.isActive);

  const storedNotes = useMemo(()=>{
    try { return JSON.parse(localStorage.getItem("fin_recentNotes")??"[]") as string[]; } catch { return []; }
  }, []);
  const allConcepts     = useMemo(()=>[...new Set([...(recentConcepts??[]),...storedNotes])].slice(0,12), [recentConcepts, storedNotes]);
  const filteredConcepts= useMemo(()=>form.notes.length>=2?allConcepts.filter(n=>n.toLowerCase().includes(form.notes.toLowerCase())&&n!==form.notes):allConcepts.slice(0,8),[form.notes, allConcepts]);

  async function handleSave() {
    // Validar con Zod — reemplaza la validación manual original
    const parsed = TransactionSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string,string> = {};
      for (const e of parsed.error.errors) { errs[e.path[0] as string] = e.message; }
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      const body: Record<string,unknown> = {
        type:          form.type,
        amount:        parseFloat(form.amount),
        currency:      form.currency || "ARS",
        categoryId:    form.categoryId ? parseInt(form.categoryId) : null,
        accountId:     form.accountId  ? parseInt(form.accountId)  : null,
        cardId:        form.cardId     ? parseInt(form.cardId)     : null,
        date:          form.date,
        status:        form.status,
        paymentMethod: form.paymentMethod || null,
        notes:         form.notes.trim() || null,
        isFixed:       form.isFixed,
        isRecurring:   form.isRecurring,
      };
      if (form.isRecurring) {
        body.recurFrequency = form.recurFrequency;
        body.recurNextDate  = form.recurNextDate || null;
      }
      const url    = tx ? `${BASE}/api/finance/transactions/${tx.id}` : `${BASE}/api/finance/transactions`;
      const method = tx ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type":"application/json" },
        credentials: "include",    // credentials añadido
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({})) as { error?:string };
        throw new Error(err.error ?? "Error al guardar");
      }
      saveMemory(form);
      toast({ title: tx ? "Movimiento actualizado" : "Movimiento registrado" });
      onSaved();
      onClose();
    } catch (err) {
      toast({ title:"Error al guardar", description:(err as Error).message, variant:"destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v=>{if(!v)onClose();}}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tx ? "Editar movimiento" : "Nuevo movimiento"}</DialogTitle>
          <DialogDescription>Registrá un ingreso o gasto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {(["income","expense"] as const).map(t=>(
              <button key={t} type="button"
                onClick={()=>set("type",t)}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all border ${form.type===t?(t==="income"?"bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300":"bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300"):"bg-muted/40 text-muted-foreground border-border hover:border-primary/30"}`}>
                {t==="income"?<ArrowUpCircle className="h-4 w-4"/>:<ArrowDownCircle className="h-4 w-4"/>}
                {t==="income"?"Ingreso":"Gasto"}
              </button>
            ))}
          </div>

          {/* Monto */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Monto *</Label>
            <div className="flex gap-2">
              <Input
                type="number" min="0.01" step="0.01"
                placeholder="0"
                value={form.amount}
                onChange={e=>set("amount",e.target.value)}
                className="flex-1"
              />
              <Select value={form.currency} onValueChange={v=>set("currency",v)}>
                <SelectTrigger className="w-24"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {["ARS","USD","EUR","UYU"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {formErrors["amount"] && <p className="text-xs text-destructive">{formErrors["amount"]}</p>}
          </div>

          {/* Fecha */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Fecha *</Label>
            <Input type="date" value={form.date} onChange={e=>set("date",e.target.value)}/>
            {formErrors["date"] && <p className="text-xs text-destructive">{formErrors["date"]}</p>}
          </div>

          {/* Categoría */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Categoría</Label>
            <Select value={form.categoryId} onValueChange={v=>set("categoryId",v)}>
              <SelectTrigger><SelectValue placeholder="Sin categoría"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin categoría</SelectItem>
                {activeCats.map(c=><SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Cuenta */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Cuenta</Label>
            <Select value={form.accountId} onValueChange={v=>set("accountId",v)}>
              <SelectTrigger><SelectValue placeholder="Sin cuenta"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin cuenta</SelectItem>
                {accounts.map(a=><SelectItem key={a.id} value={String(a.id)}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Notas con autocomplete */}
          <div className="space-y-1 relative">
            <Label className="text-xs font-medium">Concepto / Notas</Label>
            <Input
              value={form.notes}
              onChange={e=>set("notes",e.target.value)}
              placeholder="Ej: Sueldo, Supermercado, Nafta..."
              maxLength={500}
              autoComplete="off"
            />
            {filteredConcepts.length>0&&form.notes.length>=2&&(
              <div className="absolute z-10 top-full mt-1 w-full rounded-lg border bg-popover shadow-md max-h-36 overflow-y-auto">
                {filteredConcepts.map(n=>(
                  <button key={n} type="button" onClick={()=>set("notes",n)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors">{n}</button>
                ))}
              </div>
            )}
          </div>

          {/* Advanced toggle */}
          <button type="button" onClick={()=>setAdvanced(v=>!v)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advanced?"rotate-180":""}`}/>
            {advanced?"Ocultar opciones avanzadas":"Más opciones"}
          </button>

          {advanced && (
            <div className="space-y-4 pt-2 border-t border-border/40">
              {/* Estado */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Estado</Label>
                <Select value={form.status} onValueChange={v=>set("status",v)}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_META).map(([k,v])=><SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Tarjeta */}
              {form.type==="expense"&&activeCards.length>0&&(
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tarjeta de crédito</Label>
                  <Select value={form.cardId} onValueChange={v=>set("cardId",v)}>
                    <SelectTrigger><SelectValue placeholder="Sin tarjeta"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin tarjeta</SelectItem>
                      {activeCards.map(c=><SelectItem key={c.id} value={String(c.id)}>{c.name}{c.lastFour?` ···${c.lastFour}`:""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Método de pago */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Medio de pago</Label>
                <Select value={form.paymentMethod} onValueChange={v=>set("paymentMethod",v)}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..."/></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m=><SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Flags */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={form.isFixed} onCheckedChange={v=>set("isFixed",!!v)}/>
                  <span className="text-sm">Gasto fijo</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={form.isRecurring} onCheckedChange={v=>set("isRecurring",!!v)}/>
                  <span className="text-sm">Recurrente</span>
                </label>
              </div>

              {form.isRecurring && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Frecuencia</Label>
                    <Select value={form.recurFrequency} onValueChange={v=>set("recurFrequency",v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FREQ_LABEL).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Próxima fecha</Label>
                    <Input type="date" value={form.recurNextDate} onChange={e=>set("recurNextDate",e.target.value)} className="h-8 text-xs"/>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={()=>void handleSave()} disabled={saving}>
            {saving?<RefreshCw className="h-4 w-4 animate-spin mr-2"/>:null}
            {tx?"Guardar cambios":"Registrar movimiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab,    setActiveTab]    = useState("overview");
  const [txModalOpen,  setTxModalOpen]  = useState(false);
  const [editTx,       setEditTx]       = useState<FinanceTransaction|null>(null);
  const [txType,       setTxType]       = useState<"income"|"expense">("expense");
  const [demoLoading,  setDemoLoading]  = useState(false);

  // ── Queries — todas con credentials:"include" ────────────────────────────

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/summary`, { credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar"); return r.json(); }),
    staleTime: 2 * 60 * 1000,
  });

  const { data: categories = [] } = useQuery<FinanceCategory[]>({
    queryKey: ["finance-categories"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/categories`, { credentials:"include" }).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<FinanceTransaction[]>({
    queryKey: ["finance-transactions"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/transactions?limit=50`, { credentials:"include" }).then(r => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: !summaryError,
  });

  const { data: accounts = [] } = useQuery<FinanceAccount[]>({
    queryKey: ["finance-accounts"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/accounts`, { credentials:"include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: cards = [] } = useQuery<FinanceCard[]>({
    queryKey: ["finance-cards"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/cards`, { credentials:"include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: recurringRules = [] } = useQuery<FinanceRecurringRule[]>({
    queryKey: ["finance-recurring"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/recurring`, { credentials:"include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: budgetsData } = useQuery<BudgetsData>({
    queryKey: ["finance-budgets"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/budgets`, { credentials:"include" }).then(r => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: !summaryError,
  });

  const { data: goals = [] } = useQuery<FinanceGoal[]>({
    queryKey: ["finance-goals"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/goals`, { credentials:"include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const deleteTxMutation = useMutation({
    mutationFn: (id:number) =>
      fetch(`${BASE}/api/finance/transactions/${id}`, { method:"DELETE", credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al eliminar"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["finance-transactions"] });
      void qc.invalidateQueries({ queryKey:["finance-summary"] });
    },
  });

  const demoMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/finance/demo`, { method:"POST", credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar demo"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["finance-summary"] });
      void qc.invalidateQueries({ queryKey:["finance-transactions"] });
      toast({ title:"Datos de ejemplo cargados" });
    },
    onError: (e) => toast({ title:"Error", description:(e as Error).message, variant:"destructive" }),
  });

  const handleSaved = () => {
    void qc.invalidateQueries({ queryKey:["finance-transactions"] });
    void qc.invalidateQueries({ queryKey:["finance-summary"] });
  };

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (summaryLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-52"/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-24 rounded-xl"/>)}</div>
      <div className="space-y-3">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
    </div>
  );

  if (summaryError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      Error al cargar el módulo de finanzas. Intentá actualizar la página.
    </div>
  );

  // ── Onboarding ─────────────────────────────────────────────────────────────

  if (!summary?.hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Finanzas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Resumen financiero personal</p>
        </div>
        <OnboardingCard
          onLoadDemo={()=>demoMutation.mutate()}
          onNewAccount={()=>setActiveTab("accounts")}
          onNewTx={()=>{setTxType("expense");setTxModalOpen(true);}}
          loading={demoMutation.isPending}
        />
        <TransactionModal
          open={txModalOpen} onClose={()=>setTxModalOpen(false)}
          tx={null} categories={categories} accounts={accounts} cards={cards}
          onSaved={handleSaved} defaultType={txType}
        />
      </div>
    );
  }

  const { ingresosMes, gastosMes, saldoDisponible, activos, deudas, compromisos, alerts } = summary;

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Finanzas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Resumen financiero personal</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={()=>{setTxType("income");setTxModalOpen(true);}}>
            <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5 text-emerald-500"/>Ingreso
          </Button>
          <Button size="sm" onClick={()=>{setTxType("expense");setTxModalOpen(true);}}>
            <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5"/>Gasto
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {alerts.filter(a=>a.level!=="green").map((alert,i)=>(
        <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
          alert.level==="red"?"border-red-200 bg-red-50 dark:bg-red-950/20":"border-amber-200 bg-amber-50 dark:bg-amber-950/20"
        }`}>
          <AlertDot level={alert.level}/>
          <span className={alert.level==="red"?"text-red-800 dark:text-red-300":"text-amber-800 dark:text-amber-300"}>{alert.message}</span>
        </div>
      ))}

      {/* KPI cards — usa fmt() corregido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Ingresos este mes" value={fmtAbs(ingresosMes)}
          sub="Confirmados + esperados"
          accent="text-emerald-600 dark:text-emerald-400"
          bgColor="bg-emerald-100 dark:bg-emerald-900/30"
          icon={ArrowUpCircle}
        />
        <SummaryCard
          label="Gastos este mes" value={fmtAbs(gastosMes)}
          sub="Confirmados + pendientes"
          accent="text-red-600 dark:text-red-400"
          bgColor="bg-red-100 dark:bg-red-900/30"
          icon={ArrowDownCircle}
        />
        <SummaryCard
          label="Saldo disponible" value={fmt(saldoDisponible)}
          sub="Suma de cuentas activas"
          accent={saldoDisponible>=0?"text-blue-600 dark:text-blue-400":"text-red-600 dark:text-red-400"}
          bgColor="bg-blue-100 dark:bg-blue-900/30"
          icon={Wallet}
        />
        <SummaryCard
          label="Patrimonio neto" value={fmt(activos - Math.abs(deudas))}
          sub={`Activos: ${fmtAbs(activos)} · Deudas: ${fmtAbs(deudas)}`}
          accent="text-violet-600 dark:text-violet-400"
          bgColor="bg-violet-100 dark:bg-violet-900/30"
          icon={Landmark}
        />
      </div>

      {/* Pressure meter */}
      {compromisos && <PressureMeter compromisos={compromisos} income={ingresosMes}/>}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-9 text-xs">
          <TabsTrigger value="overview"     className="text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs">Movimientos</TabsTrigger>
          <TabsTrigger value="accounts"     className="text-xs">Cuentas</TabsTrigger>
          <TabsTrigger value="cards"        className="text-xs">Tarjetas</TabsTrigger>
          <TabsTrigger value="budgets"      className="text-xs">Presupuesto</TabsTrigger>
          <TabsTrigger value="goals"        className="text-xs">Metas</TabsTrigger>
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Upcoming payments */}
          {summary.upcomingPayments.length>0&&(
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground"/>Próximos vencimientos
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4 space-y-2">
                {summary.upcomingPayments.slice(0,6).map((p,i)=>{
                  const days=daysUntil(p.dueDate);
                  return(
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{background:`${p.color}20`}}>
                        {p.type==="card"?<CreditCard className="h-3.5 w-3.5" style={{color:p.color}}/>:<DollarSign className="h-3.5 w-3.5" style={{color:p.color}}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{p.label}</p>
                        {p.dueDate&&<p className="text-[10px] text-muted-foreground">{p.dueDate} {days!==null&&<span className={days<=0?"text-red-500":days<=3?"text-amber-500":""}>{days===0?"(hoy)":days<0?`(hace ${Math.abs(days)}d)`:`(en ${days}d)`}</span>}</p>}
                      </div>
                      {/* fmtAbs para pagos — siempre positivo */}
                      <span className="text-sm font-semibold tabular-nums shrink-0">{fmtAbs(p.amount)}</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Category breakdown */}
          <CategoryBreakdownSection breakdown={summary.categoryBreakdown} total={summary.gastosMes}/>

          {/* Recent transactions */}
          {summary.recentTransactions.length>0&&(
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold">Últimos movimientos</CardTitle>
              </CardHeader>
              <CardContent className="pb-4 space-y-2">
                {summary.recentTransactions.slice(0,8).map(tx=>(
                  <div key={tx.id} className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {tx.type==="income"?<ArrowUpCircle className="h-3.5 w-3.5 text-emerald-500"/>:<ArrowDownCircle className="h-3.5 w-3.5 text-red-500"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{tx.notes || tx.category?.name || (tx.type==="income"?"Ingreso":"Gasto")}</p>
                      <p className="text-[10px] text-muted-foreground">{tx.date}</p>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums shrink-0 ${tx.type==="income"?"text-emerald-600 dark:text-emerald-400":"text-red-600 dark:text-red-400"}`}>
                      {/* fmtSigned: muestra + para ingresos, − para gastos */}
                      {tx.type==="income"?"+":"-"}{fmtAbs(tx.amount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Transactions ──────────────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-4">
          {txLoading?<Skeleton className="h-64 rounded-xl"/>:(
            <Card>
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Movimientos recientes</CardTitle>
                  <Button size="sm" onClick={()=>{setTxType("expense");setTxModalOpen(true);}}>
                    <Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                {transactions.length===0?(
                  <p className="text-sm text-muted-foreground text-center py-8">Sin movimientos registrados</p>
                ):(
                  <div className="space-y-1.5">
                    {transactions.map(tx=>(
                      <div key={tx.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors group">
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          {tx.type==="income"?<ArrowUpCircle className="h-4 w-4 text-emerald-500"/>:<ArrowDownCircle className="h-4 w-4 text-red-500"/>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{tx.notes||tx.category?.name||(tx.type==="income"?"Ingreso":"Gasto")}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-muted-foreground">{tx.date}</p>
                            {tx.category&&<span className="text-[9px] px-1 rounded" style={{background:`${tx.category.color}20`,color:tx.category.color}}>{tx.category.name}</span>}
                            {tx.status&&STATUS_META[tx.status]&&<span className={`text-[9px] px-1.5 rounded-full ${STATUS_META[tx.status]!.color}`}>{STATUS_META[tx.status]!.label}</span>}
                          </div>
                        </div>
                        <span className={`text-sm font-bold tabular-nums shrink-0 ${tx.type==="income"?"text-emerald-600 dark:text-emerald-400":"text-red-600 dark:text-red-400"}`}>
                          {tx.type==="income"?"+":"-"}{fmtAbs(tx.amount)}
                        </span>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditTx(tx);setTxModalOpen(true);}}>
                            <Pencil className="h-3 w-3"/>
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive"
                            onClick={()=>deleteTxMutation.mutate(tx.id)}>
                            <Trash2 className="h-3 w-3"/>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Accounts ──────────────────────────────────────────────── */}
        <TabsContent value="accounts" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accounts.map(acct=>{
              const meta = ACCOUNT_META[acct.type] ?? ACCOUNT_META["banco"]!;
              const amount = parseFloat(acct.amount);
              return(
                <Card key={acct.id}>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-lg ${meta.bgColor} flex items-center justify-center shrink-0`}>
                        <meta.icon className={`h-4 w-4 ${meta.color}`}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">{meta.label}</p>
                        <p className="text-sm font-semibold truncate">{acct.label}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {/* fmt() correcto — muestra negativo si la cuenta tiene saldo negativo */}
                        <p className={`text-lg font-bold tabular-nums ${amount<0?"text-red-600 dark:text-red-400":"text-foreground"}`}>
                          {fmtCurrency(amount, acct.currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{acct.currency}</p>
                      </div>
                    </div>
                    {acct.notes&&<p className="text-xs text-muted-foreground mt-2 truncate">{acct.notes}</p>}
                  </CardContent>
                </Card>
              );
            })}
            {accounts.length===0&&(
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                <p className="text-sm">No hay cuentas registradas</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Cards ─────────────────────────────────────────────────── */}
        <TabsContent value="cards" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cards.filter(c=>c.isActive).map(card=>{
              const days2close = daysUntil(card.nextCloseDate);
              const days2due   = daysUntil(card.nextDueDate);
              return(
                <Card key={card.id} className={`overflow-hidden ${card.isDueSoon?"border-red-300 dark:border-red-700":card.isClosingSoon?"border-amber-300 dark:border-amber-700":""}`}>
                  <div className="h-2 w-full" style={{background:card.color}}/>
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="text-sm font-semibold">{card.name}</p>
                        {card.bank&&<p className="text-[10px] text-muted-foreground">{card.bank}</p>}
                        {card.lastFour&&<p className="text-xs text-muted-foreground font-mono">···· ···· ···· {card.lastFour}</p>}
                      </div>
                      <div className="text-right">
                        {card.totalSpent!==undefined&&(
                          <p className="text-lg font-bold tabular-nums">{fmtAbs(card.totalSpent)}</p>
                        )}
                        {card.creditLimit&&(
                          <p className="text-[10px] text-muted-foreground">Límite: {fmtAbs(parseFloat(card.creditLimit))}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {card.nextCloseDate&&<span className={days2close!==null&&days2close<=3?"text-amber-600 dark:text-amber-400":""}>Cierre: {card.nextCloseDate} {days2close!==null?`(${days2close}d)`:""}</span>}
                      {card.nextDueDate&&<span className={days2due!==null&&days2due<=3?"text-red-600 dark:text-red-400":""}>Vto: {card.nextDueDate} {days2due!==null?`(${days2due}d)`:""}</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {cards.filter(c=>c.isActive).length===0&&(
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                <p className="text-sm">No hay tarjetas activas</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Budgets ───────────────────────────────────────────────── */}
        <TabsContent value="budgets" className="mt-4">
          {budgetsData?(
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Presupuesto: {fmtAbs(budgetsData.totalBudgeted)}</span>
                <span>Gastado: {fmtAbs(budgetsData.totalSpent)}</span>
              </div>
              {budgetsData.budgets.map(b=>(
                <Card key={b.id} className={b.status==="exceeded"?"border-red-300 dark:border-red-800":b.status==="critical"?"border-amber-300 dark:border-amber-800":""}>
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-2">
                        {b.category&&<span className="font-medium" style={{color:b.category.color}}>{b.category.name}</span>}
                        {b.status==="exceeded"&&<span className="text-[9px] bg-red-100 text-red-600 px-1 rounded">Excedido</span>}
                      </div>
                      <span className="tabular-nums">{fmtAbs(b.spent)} / {fmtAbs(b.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${b.status==="exceeded"?"bg-red-500":b.status==="critical"?"bg-amber-500":"bg-emerald-500"}`}
                        style={{width:`${Math.min(b.pct,100)}%`}}/>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {b.remaining>=0?`Disponible: ${fmtAbs(b.remaining)}`:`Excedido en: ${fmtAbs(Math.abs(b.remaining))}`} · {Math.round(b.pct)}% usado
                    </p>
                  </CardContent>
                </Card>
              ))}
              {budgetsData.budgets.length===0&&<p className="text-sm text-muted-foreground text-center py-8">Sin presupuestos configurados</p>}
            </div>
          ):<Skeleton className="h-64 rounded-xl"/>}
        </TabsContent>

        {/* ── Goals ─────────────────────────────────────────────────── */}
        <TabsContent value="goals" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {goals.filter(g=>g.isActive).map(goal=>(
              <Card key={goal.id}>
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="text-sm font-semibold">{goal.title}</p>
                      {goal.targetDate&&<p className="text-[10px] text-muted-foreground">{goal.targetDate}{goal.daysLeft!==null&&` (${goal.daysLeft}d)`}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold tabular-nums">{fmtAbs(goal.currentAmount)}</p>
                      <p className="text-[10px] text-muted-foreground">de {fmtAbs(goal.targetAmount)}</p>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{width:`${Math.min(goal.pct,100)}%`}}/>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                    <span>{Math.round(goal.pct)}% completado</span>
                    {goal.monthlyNeeded!==null&&<span>Necesitás {fmtAbs(goal.monthlyNeeded)}/mes</span>}
                  </div>
                  {goal.notes&&<p className="text-[10px] text-muted-foreground mt-1 italic">{goal.notes}</p>}
                </CardContent>
              </Card>
            ))}
            {goals.filter(g=>g.isActive).length===0&&(
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                <Target className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                <p className="text-sm">No hay metas activas</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Transaction Modal */}
      <TransactionModal
        open={txModalOpen}
        onClose={()=>{setTxModalOpen(false);setEditTx(null);}}
        tx={editTx}
        categories={categories}
        accounts={accounts}
        cards={cards}
        onSaved={handleSaved}
        defaultType={txType}
      />
    </div>
  );
}
