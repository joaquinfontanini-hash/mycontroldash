import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Plus, Search, ChevronDown, ChevronUp, RefreshCw,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Circle, XCircle,
  MoreHorizontal, Eye, Edit2, Copy, GitBranch, CreditCard, Archive,
  CheckCheck, X, Loader2, TrendingUp, TrendingDown, BarChart3,
  CalendarClock, Users, ArrowRight, Banknote, Receipt, History,
  ChevronLeft, ChevronRight, AlertCircle, Trash2,
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

// ── Types ──────────────────────────────────────────────────────────────────────

type QuoteStatus = "draft"|"sent"|"approved"|"rejected"|"expired"|"partially_paid"|"paid";

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
  archivedAt: string | null;
  lastPaymentDate: string | null;
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
  items: QuoteItem[];
  revisions: QuoteRevision[];
  payments: QuotePayment[];
  activity: QuoteActivity[];
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
}

interface Client { id: number; name: string; status: string; }

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:          { label: "Borrador",         color: "text-gray-500",   bg: "bg-gray-100 dark:bg-gray-800",      icon: Circle },
  sent:           { label: "Enviado",          color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-900/30",   icon: ArrowRight },
  approved:       { label: "Aprobado",         color: "text-emerald-600",bg: "bg-emerald-100 dark:bg-emerald-900/30", icon: CheckCircle2 },
  rejected:       { label: "Rechazado",        color: "text-red-600",    bg: "bg-red-100 dark:bg-red-900/30",     icon: XCircle },
  expired:        { label: "Vencido",          color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30", icon: AlertTriangle },
  partially_paid: { label: "Cobro parcial",    color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-900/30", icon: Clock },
  paid:           { label: "Cobrado",          color: "text-teal-600",   bg: "bg-teal-100 dark:bg-teal-900/30",   icon: CheckCheck },
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
        <div className={`shrink-0 rounded-lg p-2 ${iconColor.replace("text-", "bg-").replace("-600", "-100").replace("-400", "-900/30")} dark:opacity-80`}>
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

  const [form, setForm] = useState(() => ({
    clientId: editQuote?.clientId?.toString() ?? "",
    title: editQuote?.title ?? "",
    description: editQuote?.description ?? "",
    currency: editQuote?.currency ?? "ARS",
    issueDate: editQuote?.issueDate ?? today(),
    dueDate: editQuote?.dueDate ?? addDays(today(), 30),
    notes: editQuote?.notes ?? "",
    changeReason: "",
    status: editQuote?.status ?? "draft",
  }));

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
      (item as Record<string, unknown>)[field] = typeof val === "string" ? val : val;
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
  const totalAmount = subtotal;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        clientId: parseInt(form.clientId),
        subtotal,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount,
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

  const handleSubmit = (status: "draft" | "sent") => {
    setError("");
    if (!form.clientId) { setError("Seleccioná un cliente"); return; }
    if (!form.title.trim()) { setError("El título es requerido"); return; }
    mutation.mutate();
    setForm(p => ({ ...p, status }));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {isEdit ? `Editar ${editQuote!.quoteNumber}` : "Nuevo Presupuesto"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Cliente + título */}
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
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Ej: Consultoría impositiva Q1 2025" />
          </div>

          <div className="space-y-1">
            <Label>Descripción</Label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Descripción del trabajo o servicio..." />
          </div>

          {/* Fechas */}
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

          {/* Ítems */}
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
              Total: <span className="ml-2 text-primary">{fmt(totalAmount, form.currency)}</span>
            </div>
          </div>

          {/* Notas */}
          <div className="space-y-1">
            <Label>Notas internas</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Observaciones opcionales..." />
          </div>

          {/* Razón de cambio (solo en edición) */}
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
          <Button variant="outline" onClick={() => handleSubmit("draft")} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Guardar borrador
          </Button>
          <Button onClick={() => handleSubmit("sent")} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Guardar y marcar enviado
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

        {/* Resumen financiero */}
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
            <Label>Referencia / Comprobante (opcional)</Label>
            <Input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="Nº transferencia, cheque, etc." />
          </div>

          <div className="space-y-1">
            <Label>Observaciones (opcional)</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
          </div>

          {/* Saldo resultante */}
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
      if (!r.ok) throw new Error("Error al cambiar estado");
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
                <TabsList className="mb-4">
                  <TabsTrigger value="detalle">Detalle</TabsTrigger>
                  <TabsTrigger value="cobros">Cobros ({quote.payments.length})</TabsTrigger>
                  <TabsTrigger value="historial">Historial ({quote.revisions.length})</TabsTrigger>
                  <TabsTrigger value="actividad">Actividad</TabsTrigger>
                </TabsList>

                {/* Detalle */}
                <TabsContent value="detalle" className="space-y-4 pb-8">
                  {/* Financiero */}
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

                  {/* Fechas */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">Fecha de emisión</p>
                      <p className="font-medium">{fmtDate(quote.issueDate)}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">Vencimiento</p>
                      <p className={`font-medium ${quote.dueDate < today() && quote.balance > 0 ? "text-red-600" : ""}`}>{fmtDate(quote.dueDate)}</p>
                    </div>
                  </div>

                  {quote.description && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Descripción</p>
                      <p className="text-sm">{quote.description}</p>
                    </div>
                  )}

                  {/* Ítems */}
                  {quote.items.length > 0 && (
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

                  {/* Acciones de estado */}
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type FilterStatus = "" | QuoteStatus | "overdue" | "pending";

export default function QuotesPage() {
  const qc = useQueryClient();

  // Filters state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // UI state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editQuote, setEditQuote] = useState<QuoteDetail | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<QuoteDetail | null>(null);

  // Build query params
  const params = useMemo(() => {
    const p: Record<string, string> = { page: page.toString(), limit: "50" };
    if (search)         p.search       = search;
    if (statusFilter)   p.status       = statusFilter;
    if (clientFilter)   p.clientId     = clientFilter;
    if (currencyFilter) p.currency     = currencyFilter;
    if (issueDateFrom)  p.issueDateFrom = issueDateFrom;
    if (issueDateTo)    p.issueDateTo   = issueDateTo;
    if (dueDateFrom)    p.dueDateFrom   = dueDateFrom;
    if (dueDateTo)      p.dueDateTo     = dueDateTo;
    return p;
  }, [search, statusFilter, clientFilter, currencyFilter, issueDateFrom, issueDateTo, dueDateFrom, dueDateTo, page]);

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

  const quotes = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const clearFilters = () => {
    setSearch(""); setStatusFilter(""); setClientFilter(""); setCurrencyFilter("");
    setIssueDateFrom(""); setIssueDateTo(""); setDueDateFrom(""); setDueDateTo(""); setPage(1);
  };

  const hasActiveFilters = search || statusFilter || clientFilter || currencyFilter || issueDateFrom || issueDateTo || dueDateFrom || dueDateTo;

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Presupuestos y Cobranzas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de presupuestos, versiones y cobros</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} className="shrink-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button onClick={() => { setEditQuote(null); setFormOpen(true); }} className="gap-1.5">
            <Plus className="w-4 h-4" /> Nuevo presupuesto
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          label="Presupuestado"
          value={kpis ? fmt(kpis.totalPresupuestado) : "—"}
          icon={FileText}
          iconColor="text-blue-600"
          onClick={() => { setStatusFilter(""); setPage(1); }}
        />
        <KpiCard
          label="Cobrado total"
          value={kpis ? fmt(kpis.totalCobrado) : "—"}
          icon={CheckCheck}
          iconColor="text-teal-600"
          onClick={() => setKpiFilter("paid")}
          active={statusFilter === "paid"}
        />
        <KpiCard
          label="Saldo pendiente"
          value={kpis ? fmt(kpis.saldoPendiente) : "—"}
          icon={DollarSign}
          iconColor="text-amber-600"
          onClick={() => setKpiFilter("approved")}
        />
        <KpiCard
          label="Vencidos"
          value={kpis?.cantidadVencidos?.toString() ?? "—"}
          icon={AlertTriangle}
          iconColor="text-red-600"
          onClick={() => setKpiFilter("expired")}
          active={statusFilter === "expired"}
        />
        <KpiCard
          label="Pendientes"
          value={kpis?.cantidadPendientes?.toString() ?? "—"}
          icon={Clock}
          iconColor="text-blue-500"
          onClick={() => setKpiFilter("sent")}
          active={statusFilter === "sent"}
        />
        <KpiCard
          label="Cobro parcial"
          value={kpis?.cantidadParciales?.toString() ?? "—"}
          icon={Banknote}
          iconColor="text-orange-500"
          onClick={() => setKpiFilter("partially_paid")}
          active={statusFilter === "partially_paid"}
        />
        <KpiCard
          label="Cobros del mes"
          value={kpis ? fmt(kpis.cobranzasMes) : "—"}
          icon={TrendingUp}
          iconColor="text-emerald-600"
        />
        <KpiCard
          label="Tasa de cobro"
          value={kpis ? `${kpis.tasaCobro}%` : "—"}
          icon={BarChart3}
          iconColor="text-violet-600"
        />
      </div>

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

            <Select value={clientFilter || "all"} onValueChange={v => { setClientFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setShowFilters(p => !p)}
            >
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
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Emisión</th>
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
                          <Plus className="w-4 h-4" /> Nuevo presupuesto
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
                          <p className="font-mono text-xs text-muted-foreground">{q.quoteNumber}{q.version > 1 ? ` v${q.version}` : ""}</p>
                          <p className="font-medium text-foreground truncate max-w-[200px]">{q.title}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{q.clientName}</p>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        <span className="text-sm">{q.clientName}</span>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell text-muted-foreground text-xs">{fmtDate(q.issueDate)}</td>
                      <td className={`px-3 py-3 hidden md:table-cell text-xs font-medium ${q.dueDate < today() && q.balance > 0 ? "text-red-600" : "text-muted-foreground"}`}>{fmtDate(q.dueDate)}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{fmt(q.totalAmount, q.currency)}</td>
                      <td className="px-3 py-3 text-right text-teal-600 tabular-nums hidden lg:table-cell">{fmt(q.totalPaid, q.currency)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums hidden lg:table-cell ${q.balance > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>{fmt(q.balance, q.currency)}</td>
                      <td className="px-3 py-3"><StatusBadge status={q.status} /></td>
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

          {/* Paginación */}
          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                {total} presupuesto{total !== 1 ? "s" : ""}
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

      {/* Detail Sheet */}
      <QuoteDetailSheet
        quoteId={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={(q) => { setEditQuote(q); setFormOpen(true); setSelectedId(null); }}
        onPayment={(q) => { setPaymentQuote(q); setSelectedId(null); }}
      />

      {/* Form Dialog */}
      {formOpen && (
        <QuoteForm
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditQuote(null); }}
          editQuote={editQuote}
          clients={clients}
        />
      )}

      {/* Payment Modal */}
      {paymentQuote && (
        <PaymentModal
          quote={paymentQuote}
          onClose={() => setPaymentQuote(null)}
        />
      )}
    </div>
  );
}
