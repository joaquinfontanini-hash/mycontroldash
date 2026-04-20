import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Plus, Search, ChevronDown, ChevronUp, RefreshCw,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Circle, XCircle,
  MoreHorizontal, Eye, Edit2, Copy, GitBranch, CreditCard, Archive,
  CheckCheck, X, Loader2, TrendingUp, BarChart3,
  CalendarClock, ArrowRight, Banknote, Receipt, History,
  ChevronLeft, ChevronRight, Trash2, Repeat, Zap, Building2,
  SquareStack, Percent, CalendarRange, CalendarCheck,
} from "lucide-react";
import { BASE } from "@/lib/base-url";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type QuoteStatus = "draft"|"sent"|"approved"|"rejected"|"expired"|"partially_paid"|"paid";
type QuoteType   = "single" | "recurring_indexed";
type InstallmentStatus = "pending"|"due"|"overdue"|"partially_paid"|"paid"|"cancelled";
type BillingFrequency = "monthly"|"quarterly"|"semiannual"|"annual";
type AdjustmentFrequency = "quarterly"|"semiannual"|"annual";

interface QuoteRow {
  id: number;
  quoteNumber: string;
  clientId: number;
  clientName: string;
  title: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  totalPaid: number;
  balance: number;
  status: QuoteStatus;
  version: number;
  quoteType: QuoteType;
  contractType: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  billingFrequency: BillingFrequency | null;
  nextAdjustmentDate: string | null;
  archivedAt: string | null;
  lastPaymentDate: string | null;
  installmentsTotal?: number;
  installmentsPending?: number;
  installmentsOverdue?: number;
}

interface QuoteDetail extends QuoteRow {
  description: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  notes: string | null;
  parentQuoteId: number | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  clientCuit?: string;
  clientStatus?: string;
  baseAmount?: string | null;
  currentAmount?: string | null;
  adjustmentFrequency?: string | null;
  adjustmentIndex?: string | null;
  lastAdjustmentDate?: string | null;
  items: QuoteItem[];
  revisions: QuoteRevision[];
  payments: QuotePayment[];
  activity: QuoteActivity[];
  installments: QuoteInstallment[];
  adjustments: QuoteAdjustment[];
}

interface QuoteItem {
  id: number;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
}

interface QuoteRevision {
  id: number;
  previousTotalAmount: string;
  newTotalAmount: string;
  changeReason: string | null;
  changedBy: string;
  changedAt: string;
}

interface QuotePayment {
  id: number;
  installmentId?: number | null;
  paymentDate: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
}

interface QuoteActivity {
  id: number;
  actionType: string;
  description: string;
  performedBy: string;
  performedAt: string;
}

interface QuoteInstallment {
  id: number;
  quoteId: number;
  installmentNumber: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  baseAmount: string;
  adjustedAmount: string;
  appliedAdjustmentRate: string;
  status: InstallmentStatus;
  paidAmount: string;
  balanceDue: string;
  isOverdue?: boolean;
  isDueSoon?: boolean;
}

interface QuoteAdjustment {
  id: number;
  quoteId: number;
  adjustmentDate: string;
  periodFrom: string;
  periodTo: string;
  adjustmentRate: string;
  indexUsed: string;
  previousBaseAmount: string;
  newBaseAmount: string;
  installmentsAffected: number;
  notes: string | null;
  appliedBy: string;
  appliedAt: string;
}

interface KPIs {
  totalPresupuestado: number;
  totalCobrado: number;
  saldoPendiente: number;
  cantidadPresupuestos: number;
  cantidadVencidos: number;
  cantidadPendientes: number;
  cantidadParciales: number;
  cantidadPagados: number;
  cobranzasMes: number;
  tasaCobro: number;
  contratosActivos: number;
  contratosProxVencer: number;
  cuotasPendientes: number;
  cuotasVencidas: number;
  cuotasParciales: number;
  ingresosProyMes: number;
  proximoAjuste: string | null;
}

interface Client { id: number; name: string; status: string; }

// ── Status configs ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:          { label: "Borrador",         color: "text-gray-500",    bg: "bg-gray-100 dark:bg-gray-800",           icon: Circle },
  sent:           { label: "Enviado",          color: "text-blue-600",    bg: "bg-blue-100 dark:bg-blue-900/30",        icon: ArrowRight },
  approved:       { label: "Aprobado",         color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30",  icon: CheckCircle2 },
  rejected:       { label: "Rechazado",        color: "text-red-600",     bg: "bg-red-100 dark:bg-red-900/30",          icon: XCircle },
  expired:        { label: "Vencido",          color: "text-orange-600",  bg: "bg-orange-100 dark:bg-orange-900/30",    icon: AlertTriangle },
  partially_paid: { label: "Cobro parcial",    color: "text-amber-600",   bg: "bg-amber-100 dark:bg-amber-900/30",      icon: Clock },
  paid:           { label: "Cobrado",          color: "text-teal-600",    bg: "bg-teal-100 dark:bg-teal-900/30",        icon: CheckCheck },
};

const INST_STATUS_CONFIG: Record<InstallmentStatus, { label: string; color: string; bg: string; dot: string }> = {
  pending:        { label: "Pendiente",    color: "text-blue-600",    bg: "bg-blue-50 dark:bg-blue-900/20",      dot: "bg-blue-500" },
  due:            { label: "A vencer",     color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-900/20",    dot: "bg-amber-500" },
  overdue:        { label: "Vencida",      color: "text-red-600",     bg: "bg-red-50 dark:bg-red-900/20",        dot: "bg-red-500" },
  partially_paid: { label: "Pago parcial", color: "text-orange-600",  bg: "bg-orange-50 dark:bg-orange-900/20",  dot: "bg-orange-500" },
  paid:           { label: "Pagada",       color: "text-teal-600",    bg: "bg-teal-50 dark:bg-teal-900/20",      dot: "bg-teal-500" },
  cancelled:      { label: "Cancelada",    color: "text-gray-500",    bg: "bg-gray-50 dark:bg-gray-800",         dot: "bg-gray-400" },
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Mensual", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual",
};

const PAYMENT_METHODS = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "efectivo",      label: "Efectivo" },
  { value: "cheque",        label: "Cheque" },
  { value: "tarjeta",       label: "Tarjeta" },
  { value: "mercadopago",   label: "MercadoPago" },
  { value: "otro",          label: "Otro" },
];

const CURRENCIES = ["ARS", "USD", "EUR", "UYU"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | string, currency = "ARS"): string {
  const val = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(val)) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: 2 }).format(val);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "-";
  const [y, m, dd] = d.split("-");
  if (!y || !m || !dd) return d;
  return `${dd}/${m}/${y}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ── Semaphore ──────────────────────────────────────────────────────────────────

function Semaphore({ quote }: { quote: QuoteRow }) {
  const { status, dueDate, balance } = quote;
  const todayStr = today();

  let color = "bg-gray-400";
  let title = "Sin estado";

  if (status === "paid") {
    color = "bg-teal-500"; title = "Cobrado";
  } else if (status === "rejected" || quote.archivedAt) {
    color = "bg-gray-400"; title = "Inactivo";
  } else if (status === "expired" || (dueDate < todayStr && balance > 0)) {
    color = "bg-red-500"; title = "Vencido";
  } else if (status === "partially_paid") {
    color = "bg-amber-500"; title = "Cobro parcial";
  } else if (dueDate <= addDays(todayStr, 7) && balance > 0) {
    color = "bg-yellow-400"; title = "Vence pronto";
  } else {
    color = "bg-emerald-500"; title = "Al día";
  }

  return (
    <div className="flex items-center justify-center" title={title}>
      <div className={`w-3 h-3 rounded-full ${color} shadow-sm`} />
    </div>
  );
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["draft"];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function InstBadge({ status }: { status: InstallmentStatus }) {
  const cfg = INST_STATUS_CONFIG[status] ?? INST_STATUS_CONFIG["pending"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, iconColor, active, onClick,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; iconColor: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left w-full rounded-xl border p-4 transition-all hover:shadow-md hover:scale-[1.01] ${
        active ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border bg-card hover:border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
          <p className="text-xl font-bold text-foreground mt-0.5 leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={`shrink-0 rounded-lg p-2 ${iconColor.replace("text-", "bg-").replace("-600", "-100").replace("-400", "-900/30").replace("-500", "-100")} dark:opacity-80`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
      </div>
    </button>
  );
}

// ── Quote Form ─────────────────────────────────────────────────────────────────

interface FormItem { description: string; quantity: number; unitPrice: number; lineTotal: number; }

function QuoteForm({
  open, onClose, editQuote, clients,
}: {
  open: boolean;
  onClose: () => void;
  editQuote?: QuoteDetail | null;
  clients: Client[];
}) {
  const qc = useQueryClient();
  const isEdit = !!editQuote;

  const [quoteType, setQuoteType] = useState<QuoteType>(
    (editQuote as QuoteDetail & { quoteType?: QuoteType })?.quoteType ?? "single"
  );

  const [form, setForm] = useState(() => ({
    clientId: editQuote?.clientId?.toString() ?? "",
    title: editQuote?.title ?? "",
    description: editQuote?.description ?? "",
    currency: editQuote?.currency ?? "ARS",
    issueDate: editQuote?.issueDate ?? today(),
    dueDate: editQuote?.dueDate ?? addDays(today(), 30),
    notes: editQuote?.notes ?? "",
    changeReason: "",
  }));

  const [recurring, setRecurring] = useState({
    contractType:      (editQuote as QuoteDetail)?.contractType ?? "fixed_term",
    contractStartDate: (editQuote as QuoteDetail)?.contractStartDate ?? today(),
    contractEndDate:   (editQuote as QuoteDetail)?.contractEndDate   ?? addMonths(today(), 12),
    billingFrequency:  (editQuote as QuoteDetail)?.billingFrequency  ?? "monthly",
    adjustmentFrequency: (editQuote as QuoteDetail)?.adjustmentFrequency ?? "quarterly",
    adjustmentIndex:   (editQuote as QuoteDetail)?.adjustmentIndex   ?? "ipc",
    baseAmount:        (editQuote as QuoteDetail)?.baseAmount?.toString() ?? "",
  });

  const [items, setItems] = useState<FormItem[]>(
    editQuote?.items?.length
      ? editQuote.items.map(i => ({ description: i.description, quantity: parseFloat(i.quantity), unitPrice: parseFloat(i.unitPrice), lineTotal: parseFloat(i.lineTotal) }))
      : [{ description: "", quantity: 1, unitPrice: 0, lineTotal: 0 }]
  );

  const [error, setError] = useState("");

  const updateItem = (idx: number, field: keyof FormItem, val: string | number) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[idx]! } as FormItem;
      (item as unknown as Record<string, unknown>)[field] = val;
      if (field === "quantity" || field === "unitPrice") {
        item.lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      }
      updated[idx] = item;
      return updated;
    });
  };

  const addItem = () => setItems(p => [...p, { description: "", quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const removeItem = (idx: number) => setItems(p => p.filter((_, i) => i !== idx));

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = quoteType === "recurring_indexed"
        ? {
            ...form,
            clientId: parseInt(form.clientId),
            quoteType,
            contractType: recurring.contractType,
            contractStartDate: recurring.contractStartDate,
            contractEndDate: recurring.contractType === "indefinite" ? null : recurring.contractEndDate,
            billingFrequency: recurring.billingFrequency,
            adjustmentFrequency: recurring.adjustmentFrequency,
            adjustmentIndex: recurring.adjustmentIndex,
            baseAmount: parseFloat(recurring.baseAmount),
            subtotal: 0,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            items: [],
          }
        : {
            ...form,
            clientId: parseInt(form.clientId),
            quoteType: "single",
            subtotal,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: subtotal,
            items,
          };

      const url = isEdit ? `${BASE}/api/quotes/${editQuote!.id}` : `${BASE}/api/quotes`;
      const r = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Error al guardar"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = () => {
    setError("");
    if (!form.clientId) { setError("Seleccioná un cliente"); return; }
    if (!form.title.trim()) { setError("El título es requerido"); return; }
    if (quoteType === "recurring_indexed") {
      if (!recurring.baseAmount || parseFloat(recurring.baseAmount) <= 0) { setError("El importe base es requerido"); return; }
      if (!recurring.contractStartDate) { setError("La fecha de inicio del contrato es requerida"); return; }
      if (recurring.contractType === "fixed_term") {
        if (!recurring.contractEndDate) { setError("La fecha de fin es requerida para contratos de plazo fijo"); return; }
        if (recurring.contractStartDate >= recurring.contractEndDate) { setError("La fecha fin debe ser posterior a la fecha inicio"); return; }
      }
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {isEdit ? `Editar ${editQuote!.quoteNumber}` : "Nuevo Presupuesto / Contrato"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Tipo */}
          {!isEdit && (
            <div className="space-y-2">
              <Label>Tipo de presupuesto</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQuoteType("single")}
                  className={`flex items-center gap-2 border rounded-lg px-4 py-3 text-left transition-all ${quoteType === "single" ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/30"}`}
                >
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Cobro único</p>
                    <p className="text-xs text-muted-foreground">Presupuesto tradicional</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setQuoteType("recurring_indexed")}
                  className={`flex items-center gap-2 border rounded-lg px-4 py-3 text-left transition-all ${quoteType === "recurring_indexed" ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/30"}`}
                >
                  <Repeat className="w-5 h-5 text-violet-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Contrato recurrente</p>
                    <p className="text-xs text-muted-foreground">Con cuotas y ajuste IPC</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Cliente + moneda */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cliente <span className="text-destructive">*</span></Label>
              <Select value={form.clientId} onValueChange={v => setForm(p => ({ ...p, clientId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un cliente..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.filter(c => c.status === "active").map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Título <span className="text-destructive">*</span></Label>
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Ej: Honorarios profesionales 2025" />
          </div>

          <div className="space-y-1">
            <Label>Descripción</Label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Descripción del trabajo o servicio..." />
          </div>

          {/* Fechas — modo single */}
          {quoteType === "single" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Fecha de emisión</Label>
                <Input type="date" value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Fecha de vencimiento</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
              </div>
            </div>
          )}

          {/* Campos de contrato recurrente */}
          {quoteType === "recurring_indexed" && (
            <div className="space-y-3 border rounded-lg p-4 bg-violet-50/50 dark:bg-violet-950/20">
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                <Repeat className="w-4 h-4" /> Configuración del contrato
              </p>

              {/* Tipo de contrato */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRecurring(p => ({ ...p, contractType: "fixed_term" }))}
                  className={`border rounded-lg px-3 py-2.5 text-left text-sm transition-all ${recurring.contractType === "fixed_term" ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30 ring-2 ring-violet-200 dark:ring-violet-800" : "border-border hover:border-violet-300"}`}
                >
                  <div className="font-medium text-sm">Plazo fijo</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Fecha de inicio y fin definidas</div>
                </button>
                <button
                  type="button"
                  onClick={() => setRecurring(p => ({ ...p, contractType: "indefinite" }))}
                  className={`border rounded-lg px-3 py-2.5 text-left text-sm transition-all ${recurring.contractType === "indefinite" ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30 ring-2 ring-violet-200 dark:ring-violet-800" : "border-border hover:border-violet-300"}`}
                >
                  <div className="font-medium text-sm">Indefinido</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Sin fecha de vencimiento · extensión rolling</div>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Fecha de emisión</Label>
                  <Input type="date" value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Importe por cuota <span className="text-destructive">*</span></Label>
                  <Input type="number" value={recurring.baseAmount} onChange={e => setRecurring(p => ({ ...p, baseAmount: e.target.value }))} min={0} step={0.01} placeholder="Ej: 150000" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Inicio de vigencia</Label>
                  <Input type="date" value={recurring.contractStartDate} onChange={e => setRecurring(p => ({ ...p, contractStartDate: e.target.value }))} />
                </div>
                {recurring.contractType === "fixed_term" && (
                  <div className="space-y-1">
                    <Label>Fin de vigencia</Label>
                    <Input type="date" value={recurring.contractEndDate} onChange={e => setRecurring(p => ({ ...p, contractEndDate: e.target.value }))} />
                  </div>
                )}
                {recurring.contractType === "indefinite" && (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Sin fecha de fin</Label>
                    <div className="flex items-center h-9 px-3 border rounded-md bg-muted/40 text-xs text-muted-foreground">
                      Se generan 12 meses · extensible
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Frecuencia de cobro</Label>
                  <Select value={recurring.billingFrequency} onValueChange={v => setRecurring(p => ({ ...p, billingFrequency: v as BillingFrequency }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="quarterly">Trimestral</SelectItem>
                      <SelectItem value="semiannual">Semestral</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Frecuencia de ajuste IPC</Label>
                  <Select value={recurring.adjustmentFrequency} onValueChange={v => setRecurring(p => ({ ...p, adjustmentFrequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quarterly">Trimestral</SelectItem>
                      <SelectItem value="semiannual">Semestral</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {recurring.contractStartDate && recurring.billingFrequency && recurring.baseAmount && (
                <div className="text-xs text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30 rounded px-3 py-2">
                  {recurring.contractType === "indefinite"
                    ? <>Se generarán <b>12 cuotas {FREQ_LABELS[recurring.billingFrequency]?.toLowerCase()}</b> desde {fmtDate(recurring.contractStartDate)} (extensibles). Ajuste IPC {FREQ_LABELS[recurring.adjustmentFrequency]?.toLowerCase()} sobre cuotas futuras.</>
                    : <>Se generarán cuotas automáticamente de {FREQ_LABELS[recurring.billingFrequency]?.toLowerCase()} entre{" "}{fmtDate(recurring.contractStartDate)}{recurring.contractEndDate ? ` y ${fmtDate(recurring.contractEndDate)}` : ""}. Ajuste IPC {FREQ_LABELS[recurring.adjustmentFrequency]?.toLowerCase()} sobre cuotas futuras.</>
                  }
                </div>
              )}
            </div>
          )}

          {/* Ítems — solo single */}
          {quoteType === "single" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ítems / Detalle de servicios</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 text-xs gap-1">
                  <Plus className="w-3 h-3" /> Agregar ítem
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-0 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Descripción</span><span className="text-center">Cant.</span><span className="text-right">P. Unit.</span><span className="text-right">Total</span><span />
                </div>
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-0 px-3 py-1.5 border-t items-center">
                    <Input className="h-7 text-sm border-0 shadow-none focus-visible:ring-0 px-0" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} placeholder="Descripción..." />
                    <Input type="number" className="h-7 text-sm text-center border-0 shadow-none focus-visible:ring-0" value={item.quantity} onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} />
                    <Input type="number" className="h-7 text-sm text-right border-0 shadow-none focus-visible:ring-0" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} />
                    <span className="text-sm text-right pr-1 font-medium">{fmt(item.lineTotal, form.currency)}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(idx)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end text-sm font-semibold text-foreground px-1">
                Total: <span className="ml-2 text-primary">{fmt(subtotal, form.currency)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Notas internas</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Observaciones opcionales..." />
          </div>

          {isEdit && (
            <div className="space-y-1">
              <Label>Motivo de la modificación</Label>
              <Input value={form.changeReason} onChange={e => setForm(p => ({ ...p, changeReason: e.target.value }))} placeholder="Ej: Ajuste por variación de costos..." />
            </div>
          )}

          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {quoteType === "recurring_indexed"
              ? (recurring.contractType === "indefinite" ? "Crear contrato indefinido (12 meses)" : "Crear contrato y generar cuotas")
              : "Guardar borrador"
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Payment Modal ──────────────────────────────────────────────────────────────

function PaymentModal({
  quote, onClose,
}: { quote: QuoteDetail; onClose: () => void; }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    paymentDate: today(),
    amount: quote.balance > 0 ? quote.balance.toFixed(2) : "",
    currency: quote.currency,
    paymentMethod: "transferencia",
    reference: "",
    notes: "",
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/${quote.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Error al registrar"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      qc.invalidateQueries({ queryKey: ["quote-detail", quote.id] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const newBalance = quote.balance - (parseFloat(form.amount) || 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Registrar Cobro — {quote.quoteNumber}
          </DialogTitle>
          <DialogDescription>{quote.clientName} · {quote.title}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Total</p>
            <p className="font-semibold">{fmt(quote.totalAmount, quote.currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Cobrado</p>
            <p className="font-semibold text-teal-600">{fmt(quote.totalPaid, quote.currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Saldo</p>
            <p className="font-semibold text-amber-600">{fmt(quote.balance, quote.currency)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Fecha de cobro</Label>
              <Input type="date" value={form.paymentDate} onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Importe</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} min={0} step={0.01} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Medio de pago</Label>
              <Select value={form.paymentMethod} onValueChange={v => setForm(p => ({ ...p, paymentMethod: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Referencia / Comprobante</Label>
            <Input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="Nº transferencia, cheque, etc." />
          </div>

          <div className="space-y-1">
            <Label>Observaciones</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
          </div>

          {form.amount && parseFloat(form.amount) > 0 && (
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${newBalance <= 0 ? "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300" : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"}`}>
              <span>Saldo resultante:</span>
              <span>{fmt(Math.max(0, newBalance), form.currency)}</span>
            </div>
          )}

          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Registrar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Installment Payment Modal ──────────────────────────────────────────────────

function InstallmentPaymentModal({
  quoteId, installment, currency, onClose,
}: {
  quoteId: number;
  installment: QuoteInstallment;
  currency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const balance = parseFloat(installment.balanceDue as string);

  const [form, setForm] = useState({
    paymentDate: today(),
    amount: balance > 0 ? balance.toFixed(2) : "",
    currency,
    paymentMethod: "transferencia",
    reference: "",
    notes: "",
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/${quoteId}/installments/${installment.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Error al registrar"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      qc.invalidateQueries({ queryKey: ["quote-detail", quoteId] });
      qc.invalidateQueries({ queryKey: ["quote-installments", quoteId] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const newBalance = balance - (parseFloat(form.amount) || 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Cobrar Cuota #{installment.installmentNumber}
          </DialogTitle>
          <DialogDescription>
            Período {fmtDate(installment.periodStart)} — {fmtDate(installment.periodEnd)} · Vto. {fmtDate(installment.dueDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Cuota ajustada</p>
            <p className="font-semibold">{fmt(installment.adjustedAmount, currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Cobrado</p>
            <p className="font-semibold text-teal-600">{fmt(installment.paidAmount, currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-xs">Saldo</p>
            <p className="font-semibold text-amber-600">{fmt(installment.balanceDue, currency)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Fecha de cobro</Label>
              <Input type="date" value={form.paymentDate} onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Importe</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} min={0} step={0.01} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Medio de pago</Label>
              <Select value={form.paymentMethod} onValueChange={v => setForm(p => ({ ...p, paymentMethod: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Referencia</Label>
            <Input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="Nº comprobante..." />
          </div>

          {form.amount && parseFloat(form.amount) > 0 && (
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${newBalance <= 0 ? "bg-teal-100 dark:bg-teal-900/30 text-teal-700" : "bg-amber-100 dark:bg-amber-900/30 text-amber-700"}`}>
              <span>Saldo resultante:</span>
              <span>{fmt(Math.max(0, newBalance), form.currency)}</span>
            </div>
          )}

          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Registrar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Apply Adjustment Modal ─────────────────────────────────────────────────────

function ApplyAdjustmentModal({
  quoteId, quote, onClose,
}: {
  quoteId: number;
  quote: QuoteDetail;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    adjustmentDate: today(),
    adjustmentRate: "",     // como porcentaje (ej: 3.4)
    periodFrom: quote.lastAdjustmentDate ?? addMonths(today(), -3),
    periodTo: today(),
    notes: "",
    indexUsed: "ipc",
  });
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ installmentsAffected: number; newBaseAmount: number; previousBaseAmount: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const rate = parseFloat(form.adjustmentRate) / 100;
      const r = await fetch(`${BASE}/api/quotes/${quoteId}/apply-adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adjustmentDate: form.adjustmentDate,
          adjustmentRate: rate,
          periodFrom: form.periodFrom,
          periodTo: form.periodTo,
          notes: form.notes || null,
          indexUsed: form.indexUsed,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Error al aplicar"); }
      return r.json();
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["quote-detail", quoteId] });
      qc.invalidateQueries({ queryKey: ["quote-installments", quoteId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-600" />
            Aplicar Ajuste IPC
          </DialogTitle>
          <DialogDescription>
            Solo afecta cuotas futuras pendientes — nunca vencidas, parciales o pagadas.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg p-4 space-y-2">
              <p className="font-semibold text-teal-700 dark:text-teal-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Ajuste aplicado correctamente
              </p>
              <div className="text-sm space-y-1 text-teal-600 dark:text-teal-400">
                <p>Cuotas afectadas: <strong>{result.installmentsAffected}</strong></p>
                <p>Importe anterior: <strong>{fmt(result.previousBaseAmount, quote.currency)}</strong></p>
                <p>Importe nuevo: <strong>{fmt(result.newBaseAmount, quote.currency)}</strong></p>
              </div>
            </div>
            <Button className="w-full" onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Fecha efectiva del ajuste</Label>
                <Input type="date" value={form.adjustmentDate} onChange={e => setForm(p => ({ ...p, adjustmentDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Tasa de ajuste (%)</Label>
                <div className="relative">
                  <Input type="number" value={form.adjustmentRate} onChange={e => setForm(p => ({ ...p, adjustmentRate: e.target.value }))} step={0.01} min={0} placeholder="Ej: 3.4" className="pr-8" />
                  <Percent className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Índice utilizado</Label>
              <Select value={form.indexUsed} onValueChange={v => setForm(p => ({ ...p, indexUsed: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ipc">IPC — Índice de Precios al Consumidor</SelectItem>
                  <SelectItem value="icl">ICL — Índice de Contratos de Locación</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Período IPC desde</Label>
                <Input type="date" value={form.periodFrom} onChange={e => setForm(p => ({ ...p, periodFrom: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Período IPC hasta</Label>
                <Input type="date" value={form.periodTo} onChange={e => setForm(p => ({ ...p, periodTo: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Notas (opcional)</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Ej: IPC INDEC acumulado Q4 2024" />
            </div>

            {form.adjustmentRate && parseFloat(form.adjustmentRate) > 0 && (
              <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
                Se aplicará un incremento del <strong>{form.adjustmentRate}%</strong> a todas las cuotas con vencimiento posterior al {fmtDate(form.adjustmentDate)}.
              </div>
            )}

            {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !form.adjustmentRate || !form.adjustmentDate}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Aplicar ajuste
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Installments Tab ───────────────────────────────────────────────────────────

function InstallmentsTab({ quote }: { quote: QuoteDetail }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [payInstallment, setPayInstallment] = useState<QuoteInstallment | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const extendMutation = useMutation({
    mutationFn: async (months: number) => {
      const r = await fetch(`${BASE}/api/quotes/${quote.id}/extend-installments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ months }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Error al extender"); }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["quote-installments", quote.id] });
      qc.invalidateQueries({ queryKey: ["quote", quote.id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: "Contrato extendido", description: `${data.newInstallments} cuotas generadas hasta ${fmtDate(data.newLastDueDate)}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data, isLoading } = useQuery<{ installments: QuoteInstallment[]; summary: { total: number; paid: number; overdue: number; pending: number; totalPaid: number; totalAdjusted: number; balance: number } }>({
    queryKey: ["quote-installments", quote.id, statusFilter],
    queryFn: async () => {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const r = await fetch(`${BASE}/api/quotes/${quote.id}/installments${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar cuotas");
      return r.json();
    },
    enabled: quote.quoteType === "recurring_indexed",
  });

  const installments = data?.installments ?? [];
  const summary = data?.summary;

  if (quote.quoteType !== "recurring_indexed") {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <SquareStack className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Solo disponible en contratos recurrentes
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* KPIs cuotas */}
      {summary && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Total", value: summary.total.toString(), color: "text-foreground" },
            { label: "Pagadas", value: summary.paid.toString(), color: "text-teal-600" },
            { label: "Vencidas", value: summary.overdue.toString(), color: "text-red-600" },
            { label: "Pendientes", value: summary.pending.toString(), color: "text-blue-600" },
          ].map(k => (
            <div key={k.label} className="bg-muted/40 rounded-lg p-2 text-center">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className={`font-bold text-lg ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Total contrato</p>
            <p className="font-semibold">{fmt(summary.totalAdjusted, quote.currency)}</p>
          </div>
          <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-2 text-center">
            <p className="text-xs text-teal-600">Cobrado</p>
            <p className="font-semibold text-teal-700">{fmt(summary.totalPaid, quote.currency)}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-center">
            <p className="text-xs text-amber-600">Saldo</p>
            <p className="font-semibold text-amber-700">{fmt(summary.balance, quote.currency)}</p>
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Filtrar estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(INST_STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!quote.archivedAt && quote.status !== "rejected" && (
          <Button
            size="sm" variant="outline"
            className="h-8 text-xs gap-1 text-violet-700 border-violet-300 hover:bg-violet-50"
            onClick={() => setShowAdjust(true)}
          >
            <Zap className="w-3.5 h-3.5" /> Aplicar ajuste IPC
          </Button>
        )}
        {!quote.archivedAt && quote.contractType === "indefinite" && (
          <Button
            size="sm" variant="outline"
            className="h-8 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            onClick={() => extendMutation.mutate(12)}
            disabled={extendMutation.isPending}
          >
            {extendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Extender 12 meses
          </Button>
        )}
      </div>

      {/* Tabla de cuotas */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : installments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <SquareStack className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Sin cuotas en este estado
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_1fr_90px_90px_80px_100px] bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Período</span>
            <span>Vto.</span>
            <span className="text-right">Cuota</span>
            <span className="text-right">Cobrado</span>
            <span className="text-center">Estado</span>
            <span />
          </div>
          {installments.map(inst => {
            const canPay = !["paid", "cancelled"].includes(inst.status) && !quote.archivedAt;
            return (
              <div key={inst.id} className={`grid grid-cols-[40px_1fr_1fr_90px_90px_80px_100px] px-3 py-2.5 border-t items-center text-sm ${inst.status === "overdue" ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}>
                <span className="text-xs text-muted-foreground font-mono">{inst.installmentNumber}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(inst.periodStart)} — {fmtDate(inst.periodEnd)}</span>
                <span className={`text-xs font-medium ${inst.isOverdue ? "text-red-600" : inst.isDueSoon ? "text-amber-600" : "text-foreground"}`}>
                  {fmtDate(inst.dueDate)}
                  {inst.isOverdue && <span className="ml-1 text-red-500">⚠</span>}
                </span>
                <span className="text-right tabular-nums text-xs font-medium">{fmt(inst.adjustedAmount, quote.currency)}</span>
                <span className="text-right tabular-nums text-xs text-teal-600">{parseFloat(inst.paidAmount as string) > 0 ? fmt(inst.paidAmount, quote.currency) : "—"}</span>
                <span className="text-center"><InstBadge status={inst.status} /></span>
                <span className="text-right">
                  {canPay && (
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={() => setPayInstallment(inst)}>
                      <CreditCard className="w-3 h-3" /> Cobrar
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {payInstallment && (
        <InstallmentPaymentModal
          quoteId={quote.id}
          installment={payInstallment}
          currency={quote.currency}
          onClose={() => setPayInstallment(null)}
        />
      )}

      {showAdjust && (
        <ApplyAdjustmentModal
          quoteId={quote.id}
          quote={quote}
          onClose={() => setShowAdjust(false)}
        />
      )}
    </div>
  );
}

// ── Adjustments Tab ────────────────────────────────────────────────────────────

function AdjustmentsTab({ quote, onApplyAdjust }: { quote: QuoteDetail; onApplyAdjust: () => void }) {
  if (quote.quoteType !== "recurring_indexed") {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <Zap className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Solo disponible en contratos recurrentes
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Info del ajuste próximo */}
      <div className="flex items-center justify-between gap-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg px-4 py-3 text-sm">
        <div>
          <p className="font-medium text-violet-700 dark:text-violet-300">Configuración de ajuste</p>
          <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">
            Frecuencia: {FREQ_LABELS[quote.adjustmentFrequency ?? ""] ?? quote.adjustmentFrequency ?? "—"} · Índice: {quote.adjustmentIndex?.toUpperCase() ?? "IPC"}
          </p>
          {quote.nextAdjustmentDate && (
            <p className="text-xs text-violet-600 dark:text-violet-400">Próximo ajuste: {fmtDate(quote.nextAdjustmentDate)}</p>
          )}
        </div>
        {!quote.archivedAt && quote.status !== "rejected" && (
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white gap-1 shrink-0"
            onClick={onApplyAdjust}
          >
            <Zap className="w-3.5 h-3.5" /> Aplicar ajuste
          </Button>
        )}
      </div>

      {/* Historial */}
      {quote.adjustments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Sin ajustes aplicados aún
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Historial de ajustes</p>
          {quote.adjustments.map(adj => (
            <div key={adj.id} className="border rounded-lg px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                    +{(parseFloat(adj.adjustmentRate) * 100).toFixed(2)}% {adj.indexUsed.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">{adj.installmentsAffected} cuota{adj.installmentsAffected !== 1 ? "s" : ""} afectada{adj.installmentsAffected !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-xs text-muted-foreground">{fmtDate(adj.adjustmentDate)}</span>
              </div>
              <div className="text-xs text-muted-foreground flex gap-4">
                <span>Anterior: {fmt(adj.previousBaseAmount, quote.currency)}</span>
                <span className="text-violet-600">Nuevo: {fmt(adj.newBaseAmount, quote.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Período IPC: {fmtDate(adj.periodFrom)} → {fmtDate(adj.periodTo)}</p>
              {adj.notes && <p className="text-xs text-muted-foreground italic">{adj.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quote Detail Sheet ─────────────────────────────────────────────────────────

function QuoteDetailSheet({
  quoteId, onClose, onEdit, onPayment,
}: {
  quoteId: number | null;
  onClose: () => void;
  onEdit: (q: QuoteDetail) => void;
  onPayment: (q: QuoteDetail) => void;
}) {
  const qc = useQueryClient();
  const [showAdjust, setShowAdjust] = useState(false);

  const { data: quote, isLoading } = useQuery<QuoteDetail>({
    queryKey: ["quote-detail", quoteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/${quoteId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar");
      return r.json();
    },
    enabled: !!quoteId,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const r = await fetch(`${BASE}/api/quotes/${quoteId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? "Error al cambiar estado");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      qc.invalidateQueries({ queryKey: ["quote-detail", quoteId] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/${quoteId}/archive`, {
        method: "PATCH", credentials: "include",
      });
      if (!r.ok) throw new Error("Error al archivar");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      onClose();
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: number) => {
      const r = await fetch(`${BASE}/api/quotes/${quoteId}/payments/${paymentId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error("Error al eliminar cobro");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      qc.invalidateQueries({ queryKey: ["quote-detail", quoteId] });
    },
  });

  const isRecurring = quote?.quoteType === "recurring_indexed";

  return (
    <Sheet open={!!quoteId} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        {isLoading || !quote ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SheetTitle className="text-base">{quote.quoteNumber}</SheetTitle>
                    {quote.version > 1 && <Badge variant="outline" className="text-xs">v{quote.version}</Badge>}
                    {isRecurring && (
                      <Badge className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-0 gap-1">
                        <Repeat className="w-2.5 h-2.5" /> Recurrente
                      </Badge>
                    )}
                    {isRecurring && quote.contractType === "indefinite" && (
                      <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0">
                        Indefinido
                      </Badge>
                    )}
                    <StatusBadge status={quote.status} />
                    <Semaphore quote={quote} />
                  </div>
                  <p className="text-sm font-medium text-foreground mt-0.5 truncate">{quote.title}</p>
                  <p className="text-xs text-muted-foreground">{quote.clientName} {quote.clientCuit ? `· ${quote.clientCuit}` : ""}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!quote.archivedAt && quote.status !== "rejected" && quote.status !== "paid" && (
                    <Button size="sm" variant="default" onClick={() => onPayment(quote)} className="gap-1">
                      <CreditCard className="w-3.5 h-3.5" /> Cobrar
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onEdit(quote)} className="gap-1">
                    <Edit2 className="w-3.5 h-3.5" /> Editar
                  </Button>
                </div>
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <Tabs defaultValue="detalle" className="px-6 pt-4">
                <TabsList className="mb-4 flex-wrap h-auto gap-1">
                  <TabsTrigger value="detalle">Detalle</TabsTrigger>
                  {isRecurring && <TabsTrigger value="cuotas">Cuotas ({quote.installments?.length ?? 0})</TabsTrigger>}
                  {isRecurring && <TabsTrigger value="ajustes">Ajustes IPC</TabsTrigger>}
                  <TabsTrigger value="cobros">Cobros ({quote.payments.length})</TabsTrigger>
                  <TabsTrigger value="historial">Historial</TabsTrigger>
                  <TabsTrigger value="actividad">Actividad</TabsTrigger>
                </TabsList>

                {/* Detalle */}
                <TabsContent value="detalle" className="space-y-4 pb-8">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/40 rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-bold text-base">{fmt(quote.totalAmount, quote.currency)}</p>
                    </div>
                    <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-3 text-center">
                      <p className="text-xs text-teal-600">Cobrado</p>
                      <p className="font-bold text-base text-teal-700 dark:text-teal-300">{fmt(quote.totalPaid, quote.currency)}</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${quote.balance > 0 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-muted/40"}`}>
                      <p className={`text-xs ${quote.balance > 0 ? "text-amber-600" : "text-muted-foreground"}`}>Saldo</p>
                      <p className={`font-bold text-base ${quote.balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>{fmt(quote.balance, quote.currency)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">Fecha de emisión</p>
                      <p className="font-medium">{fmtDate(quote.issueDate)}</p>
                    </div>
                    {isRecurring ? (
                      <>
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">Vigencia del contrato</p>
                          <p className="font-medium">
                            {fmtDate(quote.contractStartDate)} —{" "}
                            {quote.contractType === "indefinite"
                              ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">Sin fecha de fin</span>
                              : fmtDate(quote.contractEndDate)
                            }
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">Frecuencia de cobro</p>
                          <p className="font-medium">{FREQ_LABELS[quote.billingFrequency ?? ""] ?? quote.billingFrequency ?? "—"}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">Próximo ajuste</p>
                          <p className="font-medium text-violet-700 dark:text-violet-300">{fmtDate(quote.nextAdjustmentDate)}</p>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Vencimiento</p>
                        <p className={`font-medium ${quote.dueDate < today() && quote.balance > 0 ? "text-red-600" : ""}`}>{fmtDate(quote.dueDate)}</p>
                      </div>
                    )}
                  </div>

                  {quote.description && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Descripción</p>
                      <p className="text-sm">{quote.description}</p>
                    </div>
                  )}

                  {!isRecurring && quote.items.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Ítems</p>
                      <div className="border rounded-lg overflow-hidden text-sm">
                        <div className="grid grid-cols-[1fr_60px_90px_90px] bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground font-medium">
                          <span>Descripción</span><span className="text-center">Cant.</span><span className="text-right">P.Unit.</span><span className="text-right">Total</span>
                        </div>
                        {quote.items.map(it => (
                          <div key={it.id} className="grid grid-cols-[1fr_60px_90px_90px] px-3 py-2 border-t items-center">
                            <span className="truncate">{it.description}</span>
                            <span className="text-center text-muted-foreground">{it.quantity}</span>
                            <span className="text-right text-muted-foreground">{fmt(it.unitPrice, quote.currency)}</span>
                            <span className="text-right font-medium">{fmt(it.lineTotal, quote.currency)}</span>
                          </div>
                        ))}
                        <div className="flex justify-end px-3 py-2 border-t bg-muted/30 font-semibold">
                          <span className="mr-3 text-muted-foreground">Total</span>
                          <span>{fmt(quote.totalAmount, quote.currency)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {quote.notes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Notas</p>
                      <p className="text-sm bg-muted/30 rounded-lg px-3 py-2">{quote.notes}</p>
                    </div>
                  )}

                  {!quote.archivedAt && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {quote.status === "sent" && (
                        <>
                          <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 gap-1" onClick={() => statusMutation.mutate("approved")}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 gap-1" onClick={() => statusMutation.mutate("rejected")}>
                            <XCircle className="w-3.5 h-3.5" /> Rechazar
                          </Button>
                        </>
                      )}
                      {quote.status === "draft" && (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => statusMutation.mutate("sent")}>
                          <ArrowRight className="w-3.5 h-3.5" /> Marcar enviado
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-muted-foreground gap-1" onClick={() => archiveMutation.mutate()}>
                        <Archive className="w-3.5 h-3.5" /> Archivar
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* Cuotas (solo recurrentes) */}
                {isRecurring && (
                  <TabsContent value="cuotas">
                    <InstallmentsTab quote={quote} />
                  </TabsContent>
                )}

                {/* Ajustes IPC (solo recurrentes) */}
                {isRecurring && (
                  <TabsContent value="ajustes">
                    <AdjustmentsTab quote={quote} onApplyAdjust={() => setShowAdjust(true)} />
                  </TabsContent>
                )}

                {/* Cobros */}
                <TabsContent value="cobros" className="space-y-3 pb-8">
                  {quote.payments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No hay cobros registrados
                    </div>
                  ) : (
                    quote.payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-3 border rounded-lg px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{fmt(p.amount, p.currency)}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(p.paymentDate)} · {PAYMENT_METHODS.find(m => m.value === p.paymentMethod)?.label ?? p.paymentMethod}</p>
                          {p.installmentId && <p className="text-xs text-violet-600">Cuota vinculada</p>}
                          {p.reference && <p className="text-xs text-muted-foreground">Ref: {p.reference}</p>}
                          {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                        </div>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => confirm("¿Eliminar este cobro?") && deletePaymentMutation.mutate(p.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </TabsContent>

                {/* Historial de versiones */}
                <TabsContent value="historial" className="space-y-3 pb-8">
                  {quote.revisions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      Sin revisiones — es la versión original
                    </div>
                  ) : (
                    quote.revisions.map(r => (
                      <div key={r.id} className="border rounded-lg px-4 py-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {fmt(r.previousTotalAmount, quote.currency)} → {fmt(r.newTotalAmount, quote.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">{new Date(r.changedAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                        {r.changeReason && <p className="text-xs text-muted-foreground">{r.changeReason}</p>}
                        <p className="text-xs text-muted-foreground">Por: {r.changedBy}</p>
                      </div>
                    ))
                  )}
                </TabsContent>

                {/* Actividad */}
                <TabsContent value="actividad" className="pb-8">
                  <div className="relative pl-4 border-l-2 border-border space-y-4 mt-1">
                    {quote.activity.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">Sin actividad registrada</p>
                    ) : (
                      quote.activity.map(a => (
                        <div key={a.id} className="relative">
                          <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary" />
                          <div className="ml-2">
                            <p className="text-sm">{a.description}</p>
                            <p className="text-xs text-muted-foreground">{new Date(a.performedAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </ScrollArea>

            {showAdjust && quote && (
              <ApplyAdjustmentModal
                quoteId={quote.id}
                quote={quote}
                onClose={() => setShowAdjust(false)}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");
  const [quoteTypeFilter, setQuoteTypeFilter] = useState<string>("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editQuote, setEditQuote] = useState<QuoteDetail | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<QuoteDetail | null>(null);

  const params = useMemo(() => {
    const p: Record<string, string> = { page: page.toString(), limit: "50" };
    if (search)          p.search        = search;
    if (statusFilter)    p.status        = statusFilter;
    if (clientFilter)    p.clientId      = clientFilter;
    if (currencyFilter)  p.currency      = currencyFilter;
    if (quoteTypeFilter) p.quoteType     = quoteTypeFilter;
    if (issueDateFrom)   p.issueDateFrom = issueDateFrom;
    if (issueDateTo)     p.issueDateTo   = issueDateTo;
    if (dueDateFrom)     p.dueDateFrom   = dueDateFrom;
    if (dueDateTo)       p.dueDateTo     = dueDateTo;
    return p;
  }, [search, statusFilter, clientFilter, currencyFilter, quoteTypeFilter, issueDateFrom, issueDateTo, dueDateFrom, dueDateTo, page]);

  const { data, isLoading, refetch } = useQuery<{ data: QuoteRow[]; total: number; page: number; limit: number }>({
    queryKey: ["quotes", params],
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      const r = await fetch(`${BASE}/api/quotes?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  const { data: kpis } = useQuery<KPIs>({
    queryKey: ["quotes-kpis"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/kpis`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients-simple"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/clients`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.map((c: { id: number; name: string; status: string }) => ({ id: c.id, name: c.name, status: c.status }));
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/quotes/${id}/new-version`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    onSuccess: (newQuote: QuoteDetail) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      setSelectedId(newQuote.id);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/quotes/${id}/duplicate`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    onSuccess: (newQuote: QuoteDetail) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes-kpis"] });
      setSelectedId(newQuote.id);
    },
  });

  const setKpiFilter = useCallback((filter: string) => {
    setStatusFilter(p => p === filter ? "" : filter);
    setPage(1);
  }, []);

  const setTypeFilter = useCallback((type: string) => {
    setQuoteTypeFilter(p => p === type ? "" : type);
    setPage(1);
  }, []);

  const quotes = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const clearFilters = () => {
    setSearch(""); setStatusFilter(""); setClientFilter(""); setCurrencyFilter("");
    setQuoteTypeFilter(""); setIssueDateFrom(""); setIssueDateTo(""); setDueDateFrom(""); setDueDateTo(""); setPage(1);
  };

  const hasActiveFilters = search || statusFilter || clientFilter || currencyFilter || quoteTypeFilter || issueDateFrom || issueDateTo || dueDateFrom || dueDateTo;

  const hasRecurring = (kpis?.contratosActivos ?? 0) > 0 || (kpis?.cuotasPendientes ?? 0) > 0;

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Presupuestos y Cobranzas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de presupuestos, contratos recurrentes y cobros</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} className="shrink-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button onClick={() => { setEditQuote(null); setFormOpen(true); }} className="gap-1.5">
            <Plus className="w-4 h-4" /> Nuevo
          </Button>
        </div>
      </div>

      {/* KPI Cards — Fila 1: financieros */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Presupuestado" value={kpis ? fmt(kpis.totalPresupuestado) : "—"} icon={FileText} iconColor="text-blue-600" onClick={() => { setStatusFilter(""); setPage(1); }} />
        <KpiCard label="Cobrado total" value={kpis ? fmt(kpis.totalCobrado) : "—"} icon={CheckCheck} iconColor="text-teal-600" onClick={() => setKpiFilter("paid")} active={statusFilter === "paid"} />
        <KpiCard label="Saldo pendiente" value={kpis ? fmt(kpis.saldoPendiente) : "—"} icon={DollarSign} iconColor="text-amber-600" onClick={() => setKpiFilter("approved")} />
        <KpiCard label="Vencidos" value={kpis?.cantidadVencidos?.toString() ?? "—"} icon={AlertTriangle} iconColor="text-red-600" onClick={() => setKpiFilter("expired")} active={statusFilter === "expired"} />
        <KpiCard label="Pendientes" value={kpis?.cantidadPendientes?.toString() ?? "—"} icon={Clock} iconColor="text-blue-500" onClick={() => setKpiFilter("sent")} active={statusFilter === "sent"} />
        <KpiCard label="Cobro parcial" value={kpis?.cantidadParciales?.toString() ?? "—"} icon={Banknote} iconColor="text-orange-500" onClick={() => setKpiFilter("partially_paid")} active={statusFilter === "partially_paid"} />
        <KpiCard label="Cobros del mes" value={kpis ? fmt(kpis.cobranzasMes) : "—"} icon={TrendingUp} iconColor="text-emerald-600" />
        <KpiCard label="Tasa de cobro" value={kpis ? `${kpis.tasaCobro}%` : "—"} icon={BarChart3} iconColor="text-violet-600" />
      </div>

      {/* KPI Cards — Fila 2: contratos recurrentes */}
      {(hasRecurring || (kpis?.contratosActivos ?? 0) > 0) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Repeat className="w-3 h-3" /> Contratos recurrentes
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="Contratos activos" value={kpis?.contratosActivos?.toString() ?? "—"} icon={Building2} iconColor="text-violet-600" onClick={() => setTypeFilter("recurring_indexed")} active={quoteTypeFilter === "recurring_indexed"} />
            <KpiCard label="Próx. a vencer" value={kpis?.contratosProxVencer?.toString() ?? "—"} sub="en 30 días" icon={CalendarCheck} iconColor="text-orange-500" />
            <KpiCard label="Cuotas pendientes" value={kpis?.cuotasPendientes?.toString() ?? "—"} icon={SquareStack} iconColor="text-blue-600" />
            <KpiCard label="Cuotas vencidas" value={kpis?.cuotasVencidas?.toString() ?? "—"} icon={AlertTriangle} iconColor="text-red-600" />
            <KpiCard label="Ingresos proy. mes" value={kpis ? fmt(kpis.ingresosProyMes) : "—"} icon={TrendingUp} iconColor="text-emerald-600" />
            <KpiCard label="Próximo ajuste IPC" value={kpis?.proximoAjuste ? fmtDate(kpis.proximoAjuste) : "—"} icon={Zap} iconColor="text-violet-600" />
          </div>
        </div>
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nº, título o cliente..."
                className="pl-9"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            <Select value={statusFilter || "all"} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={quoteTypeFilter || "all"} onValueChange={v => { setQuoteTypeFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="single">Cobro único</SelectItem>
                <SelectItem value="recurring_indexed">Recurrente</SelectItem>
              </SelectContent>
            </Select>

            <Select value={clientFilter || "all"} onValueChange={v => { setClientFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowFilters(p => !p)}>
              {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Más filtros
            </Button>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground gap-1">
                <X className="w-3.5 h-3.5" /> Limpiar
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Moneda</p>
                <Select value={currencyFilter || "all"} onValueChange={v => { setCurrencyFilter(v === "all" ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Emisión desde</p>
                <Input type="date" className="h-8 text-sm" value={issueDateFrom} onChange={e => { setIssueDateFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Emisión hasta</p>
                <Input type="date" className="h-8 text-sm" value={issueDateTo} onChange={e => { setIssueDateTo(e.target.value); setPage(1); }} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Vence hasta</p>
                <Input type="date" className="h-8 text-sm" value={dueDateTo} onChange={e => { setDueDateTo(e.target.value); setPage(1); }} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground w-8"></th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Nº / Título</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Cliente</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Tipo</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Vto.</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Total</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground hidden lg:table-cell">Cobrado</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground hidden lg:table-cell">Saldo</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Estado</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground w-8"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : quotes.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {hasActiveFilters ? "No hay presupuestos con esos filtros" : "Todavía no hay presupuestos — ¡creá el primero!"}
                      </p>
                      {!hasActiveFilters && (
                        <Button className="mt-3 gap-1.5" size="sm" onClick={() => { setEditQuote(null); setFormOpen(true); }}>
                          <Plus className="w-4 h-4" /> Nuevo
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  quotes.map(q => (
                    <tr
                      key={q.id}
                      className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${q.archivedAt ? "opacity-50" : ""}`}
                      onClick={() => setSelectedId(q.id)}
                    >
                      <td className="px-4 py-3">
                        <Semaphore quote={q} />
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          <p className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                            {q.quoteNumber}{q.version > 1 ? ` v${q.version}` : ""}
                            {q.quoteType === "recurring_indexed" && <Repeat className="w-2.5 h-2.5 text-violet-500" />}
                          </p>
                          <p className="font-medium text-foreground truncate max-w-[200px]">{q.title}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{q.clientName}</p>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        <span className="text-sm">{q.clientName}</span>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        {q.quoteType === "recurring_indexed" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-violet-600">
                            <Repeat className="w-3 h-3" /> {FREQ_LABELS[q.billingFrequency ?? ""] ?? "Recurrente"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Único</span>
                        )}
                      </td>
                      <td className={`px-3 py-3 hidden md:table-cell text-xs font-medium ${q.dueDate < today() && q.balance > 0 ? "text-red-600" : "text-muted-foreground"}`}>{fmtDate(q.dueDate)}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{fmt(q.totalAmount, q.currency)}</td>
                      <td className="px-3 py-3 text-right text-teal-600 tabular-nums hidden lg:table-cell">{fmt(q.totalPaid, q.currency)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums hidden lg:table-cell ${q.balance > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>{fmt(q.balance, q.currency)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={q.status} />
                        {q.quoteType === "recurring_indexed" && (q.installmentsOverdue ?? 0) > 0 && (
                          <div className="text-xs text-red-600 mt-0.5">{q.installmentsOverdue} cuota{q.installmentsOverdue !== 1 ? "s" : ""} vencida{q.installmentsOverdue !== 1 ? "s" : ""}</div>
                        )}
                      </td>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedId(q.id)}>
                              <Eye className="w-4 h-4 mr-2" /> Ver detalle
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={async () => {
                              const r = await fetch(`${BASE}/api/quotes/${q.id}`, { credentials: "include" });
                              const d = await r.json();
                              setEditQuote(d);
                              setFormOpen(true);
                            }}>
                              <Edit2 className="w-4 h-4 mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicateMutation.mutate(q.id)}>
                              <Copy className="w-4 h-4 mr-2" /> Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => newVersionMutation.mutate(q.id)}>
                              <GitBranch className="w-4 h-4 mr-2" /> Nueva versión
                            </DropdownMenuItem>
                            {!q.archivedAt && q.status !== "rejected" && q.status !== "paid" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={async () => {
                                  const r = await fetch(`${BASE}/api/quotes/${q.id}`, { credentials: "include" });
                                  const d = await r.json();
                                  setPaymentQuote(d);
                                }}>
                                  <CreditCard className="w-4 h-4 mr-2" /> Registrar cobro
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                {total} registro{total !== 1 ? "s" : ""}
                {hasActiveFilters ? " (filtrados)" : ""}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <QuoteDetailSheet
        quoteId={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={(q) => { setEditQuote(q); setFormOpen(true); setSelectedId(null); }}
        onPayment={(q) => { setPaymentQuote(q); setSelectedId(null); }}
      />

      {formOpen && (
        <QuoteForm
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditQuote(null); }}
          editQuote={editQuote}
          clients={clients}
        />
      )}

      {paymentQuote && (
        <PaymentModal
          quote={paymentQuote}
          onClose={() => setPaymentQuote(null)}
        />
      )}
    </div>
  );
}
