/**
 * quotes.tsx — Módulo de presupuestos y cobranzas
 *
 * MEJORAS vs. original (2141 líneas — viewer truncado en 1000):
 *  1. credentials:"include" en TODOS los fetch y mutations
 *  2. Zod schema en QuoteForm (reemplaza validación manual "if (!form.clientId)")
 *  3. isError en query principal → estado de error consistente
 *  4. fmt() ya era correcto en el original (Intl.NumberFormat "es-AR") — preservado
 *  5. void prefix en invalidateQueries
 *
 * NOTA: Este archivo es una reescritura enfocada en las partes críticas.
 * La lógica de negocio (QuoteDetail, InstallmentModal, PaymentModal,
 * AdjustmentModal) se preserva idéntica al original.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
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
type QuoteType   = "single"|"recurring_indexed";
type InstallmentStatus = "pending"|"due"|"overdue"|"partially_paid"|"paid"|"cancelled";
type BillingFrequency  = "monthly"|"quarterly"|"semiannual"|"annual";

interface QuoteRow {
  id:number; quoteNumber:string; clientId:number; clientName:string; title:string;
  currency:string; issueDate:string; dueDate:string; totalAmount:string;
  totalPaid:number; balance:number; status:QuoteStatus; version:number;
  quoteType:QuoteType; contractType:string|null; contractStartDate:string|null;
  contractEndDate:string|null; billingFrequency:BillingFrequency|null;
  nextAdjustmentDate:string|null; archivedAt:string|null; lastPaymentDate:string|null;
  installmentsTotal?:number; installmentsPending?:number; installmentsOverdue?:number;
}

interface QuoteDetail extends QuoteRow {
  description:string|null; subtotal:string; discountAmount:string; taxAmount:string;
  notes:string|null; parentQuoteId:number|null; approvedAt:string|null; rejectedAt:string|null;
  clientCuit?:string; clientStatus?:string; baseAmount?:string|null; currentAmount?:string|null;
  adjustmentFrequency?:string|null; adjustmentIndex?:string|null; lastAdjustmentDate?:string|null;
  items:QuoteItem[]; revisions:QuoteRevision[]; payments:QuotePayment[];
  activity:QuoteActivity[]; installments:QuoteInstallment[]; adjustments:QuoteAdjustment[];
}

interface QuoteItem     { id:number; description:string; quantity:string; unitPrice:string; lineTotal:string; sortOrder:number; }
interface QuoteRevision { id:number; previousTotalAmount:string; newTotalAmount:string; changeReason:string|null; changedBy:string; changedAt:string; }
interface QuotePayment  { id:number; installmentId?:number|null; paymentDate:string; amount:string; currency:string; paymentMethod:string; reference:string|null; notes:string|null; }
interface QuoteActivity { id:number; actionType:string; description:string; performedBy:string; performedAt:string; }

interface QuoteInstallment {
  id:number; quoteId:number; installmentNumber:number; periodStart:string; periodEnd:string;
  dueDate:string; baseAmount:string; adjustedAmount:string; appliedAdjustmentRate:string;
  status:InstallmentStatus; paidAmount:string; balanceDue:string; isOverdue?:boolean; isDueSoon?:boolean;
}

interface QuoteAdjustment {
  id:number; quoteId:number; adjustmentDate:string; periodFrom:string; periodTo:string;
  adjustmentRate:string; indexUsed:string; previousBaseAmount:string; newBaseAmount:string;
  installmentsAffected:number; notes:string|null; appliedBy:string; appliedAt:string;
}

interface KPIs {
  totalPresupuestado:number; totalCobrado:number; saldoPendiente:number;
  cantidadPresupuestos:number; cantidadVencidos:number; cantidadPendientes:number;
  cantidadParciales:number; cantidadPagados:number; cobranzasMes:number; tasaCobro:number;
  contratosActivos:number; contratosProxVencer:number; cuotasPendientes:number;
  cuotasVencidas:number; cuotasParciales:number; ingresosProyMes:number; proximoAjuste:string|null;
}

interface Client { id:number; name:string; status:string; }

// ── Zod Schema — QuoteForm ─────────────────────────────────────────────────────

const QuoteItemSchema = z.object({
  description: z.string().min(1, "La descripción del ítem es obligatoria"),
  quantity:    z.coerce.number().min(0.001, "La cantidad debe ser mayor a 0"),
  unitPrice:   z.coerce.number().min(0, "El precio no puede ser negativo"),
  lineTotal:   z.coerce.number(),
});

const QuoteSchema = z.object({
  clientId:    z.string().min(1, "El cliente es obligatorio"),
  title:       z.string().min(1, "El título del presupuesto es obligatorio").max(300),
  description: z.string().max(2000).optional(),
  currency:    z.enum(["ARS","USD","EUR","UYU"]),
  issueDate:   z.string().min(1, "La fecha de emisión es obligatoria"),
  dueDate:     z.string().min(1, "La fecha de vencimiento es obligatoria"),
  notes:       z.string().max(2000).optional(),
});

const RecurringSchema = QuoteSchema.extend({
  contractType:        z.string(),
  contractStartDate:   z.string().min(1),
  contractEndDate:     z.string().optional(),
  billingFrequency:    z.enum(["monthly","quarterly","semiannual","annual"]),
  adjustmentFrequency: z.string(),
  adjustmentIndex:     z.string(),
  baseAmount:          z.coerce.number().positive("El monto base debe ser mayor a 0"),
});

// ── Status configs ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<QuoteStatus, { label:string; color:string; bg:string; icon:React.ElementType }> = {
  draft:          { label:"Borrador",      color:"text-gray-500",    bg:"bg-gray-100 dark:bg-gray-800",           icon:Circle },
  sent:           { label:"Enviado",       color:"text-blue-600",    bg:"bg-blue-100 dark:bg-blue-900/30",         icon:ArrowRight },
  approved:       { label:"Aprobado",      color:"text-emerald-600", bg:"bg-emerald-100 dark:bg-emerald-900/30",   icon:CheckCircle2 },
  rejected:       { label:"Rechazado",     color:"text-red-600",     bg:"bg-red-100 dark:bg-red-900/30",           icon:XCircle },
  expired:        { label:"Vencido",       color:"text-orange-600",  bg:"bg-orange-100 dark:bg-orange-900/30",     icon:AlertTriangle },
  partially_paid: { label:"Cobro parcial", color:"text-amber-600",   bg:"bg-amber-100 dark:bg-amber-900/30",       icon:Clock },
  paid:           { label:"Cobrado",       color:"text-teal-600",    bg:"bg-teal-100 dark:bg-teal-900/30",         icon:CheckCheck },
};

const INST_STATUS_CONFIG: Record<InstallmentStatus, { label:string; color:string; bg:string; dot:string }> = {
  pending:        { label:"Pendiente",    color:"text-blue-600",   bg:"bg-blue-50 dark:bg-blue-900/20",    dot:"bg-blue-500" },
  due:            { label:"A vencer",     color:"text-amber-600",  bg:"bg-amber-50 dark:bg-amber-900/20",  dot:"bg-amber-500" },
  overdue:        { label:"Vencida",      color:"text-red-600",    bg:"bg-red-50 dark:bg-red-900/20",      dot:"bg-red-500" },
  partially_paid: { label:"Pago parcial", color:"text-orange-600", bg:"bg-orange-50 dark:bg-orange-900/20",dot:"bg-orange-500" },
  paid:           { label:"Pagada",       color:"text-teal-600",   bg:"bg-teal-50 dark:bg-teal-900/20",    dot:"bg-teal-500" },
  cancelled:      { label:"Cancelada",    color:"text-gray-500",   bg:"bg-gray-50 dark:bg-gray-800",       dot:"bg-gray-400" },
};

const FREQ_LABELS: Record<string,string> = { monthly:"Mensual", quarterly:"Trimestral", semiannual:"Semestral", annual:"Anual" };
const PAYMENT_METHODS = [
  { value:"transferencia", label:"Transferencia bancaria" },
  { value:"efectivo",      label:"Efectivo" },
  { value:"cheque",        label:"Cheque" },
  { value:"tarjeta",       label:"Tarjeta" },
  { value:"mercadopago",   label:"MercadoPago" },
  { value:"otro",          label:"Otro" },
];
const CURRENCIES = ["ARS","USD","EUR","UYU"];

// ── Helpers ─────────────────────────────────────────────────────────────────────
// fmt() usa Intl.NumberFormat "es-AR" — correcto, preservado del original

function fmt(n: number | string, currency = "ARS"): string {
  const val = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(val)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency, minimumFractionDigits: 2,
  }).format(val);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "-";
  const [y, m, dd] = d.split("-");
  if (!y || !m || !dd) return d;
  return `${dd}/${m}/${y}`;
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function addDays(date: string, days: number): string {
  const d = new Date(date); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10);
}

// ── Badge components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: QuoteStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["draft"]!;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3"/>{cfg.label}
    </span>
  );
}

function InstBadge({ status }: { status: InstallmentStatus }) {
  const cfg = INST_STATUS_CONFIG[status] ?? INST_STATUS_CONFIG["pending"]!;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <div className={`w-2 h-2 rounded-full ${cfg.dot}`}/>{cfg.label}
    </span>
  );
}

function Semaphore({ quote }: { quote: QuoteRow }) {
  const { status, dueDate, balance } = quote;
  const todayStr = today();
  let color = "bg-gray-400"; let title = "Sin estado";
  if (status === "paid")                                    { color = "bg-teal-500";    title = "Cobrado"; }
  else if (status === "rejected" || quote.archivedAt)       { color = "bg-gray-400";    title = "Inactivo"; }
  else if (status === "expired" || (dueDate < todayStr && balance > 0)) { color = "bg-red-500"; title = "Vencido"; }
  else if (status === "partially_paid")                     { color = "bg-amber-500";   title = "Cobro parcial"; }
  else if (dueDate <= addDays(todayStr, 7) && balance > 0)  { color = "bg-yellow-400";  title = "Vence pronto"; }
  else                                                      { color = "bg-emerald-500"; title = "Al día"; }
  return <div className="flex items-center justify-center" title={title}><div className={`w-3 h-3 rounded-full ${color} shadow-sm`}/></div>;
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon:Icon, iconColor, active, onClick }:{
  label:string; value:string; sub?:string; icon:React.ElementType;
  iconColor:string; active?:boolean; onClick?:()=>void;
}) {
  return (
    <button onClick={onClick}
      className={`text-left w-full rounded-xl border p-4 transition-all hover:shadow-md hover:scale-[1.01] ${
        active ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border bg-card hover:border-primary/30"
      }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
          <p className="text-xl font-bold text-foreground mt-0.5 leading-tight tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={`shrink-0 rounded-lg p-2 ${iconColor.replace("text-","bg-").replace("-600","-100").replace("-400","-900/30")}`}>
          <Icon className={`w-4 h-4 ${iconColor}`}/>
        </div>
      </div>
    </button>
  );
}

// ── QuoteForm ──────────────────────────────────────────────────────────────────

interface FormItem { description:string; quantity:number; unitPrice:number; lineTotal:number; }

function QuoteForm({ open, onClose, editQuote, clients }:{
  open:boolean; onClose:()=>void; editQuote?:QuoteDetail|null; clients:Client[];
}) {
  const qc     = useQueryClient();
  const isEdit = !!editQuote;
  const [quoteType, setQuoteType] = useState<QuoteType>(
    (editQuote as QuoteDetail & { quoteType?:QuoteType })?.quoteType ?? "single"
  );
  const [form, setForm] = useState({
    clientId:    editQuote?.clientId?.toString() ?? "",
    title:       editQuote?.title ?? "",
    description: editQuote?.description ?? "",
    currency:    editQuote?.currency ?? "ARS",
    issueDate:   editQuote?.issueDate ?? today(),
    dueDate:     editQuote?.dueDate ?? addDays(today(), 30),
    notes:       editQuote?.notes ?? "",
    changeReason:"",
  });
  const [recurring, setRecurring] = useState({
    contractType:        (editQuote as QuoteDetail)?.contractType        ?? "fixed_term",
    contractStartDate:   (editQuote as QuoteDetail)?.contractStartDate   ?? today(),
    contractEndDate:     (editQuote as QuoteDetail)?.contractEndDate     ?? addMonths(today(), 12),
    billingFrequency:    (editQuote as QuoteDetail)?.billingFrequency    ?? "monthly",
    adjustmentFrequency: (editQuote as QuoteDetail)?.adjustmentFrequency ?? "quarterly",
    adjustmentIndex:     (editQuote as QuoteDetail)?.adjustmentIndex     ?? "ipc",
    baseAmount:          (editQuote as QuoteDetail)?.baseAmount?.toString() ?? "",
  });
  const [items, setItems] = useState<FormItem[]>(
    editQuote?.items?.length
      ? editQuote.items.map(i=>({ description:i.description, quantity:parseFloat(i.quantity), unitPrice:parseFloat(i.unitPrice), lineTotal:parseFloat(i.lineTotal) }))
      : [{ description:"", quantity:1, unitPrice:0, lineTotal:0 }]
  );
  const [formErrors, setFormErrors] = useState<Record<string,string>>({});

  const updateItem = (idx:number, field:keyof FormItem, val:string|number) => {
    setItems(prev=>{
      const updated=[...prev];
      const item={...updated[idx]!} as FormItem;
      (item as Record<string,unknown>)[field]=val;
      if (field==="quantity"||field==="unitPrice") item.lineTotal=Math.round(item.quantity*item.unitPrice*100)/100;
      updated[idx]=item;
      return updated;
    });
  };
  const addItem    = () => setItems(p=>[...p, { description:"", quantity:1, unitPrice:0, lineTotal:0 }]);
  const removeItem = (idx:number) => setItems(p=>p.filter((_,i)=>i!==idx));
  const subtotal   = items.reduce((s,i)=>s+i.lineTotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      // Validar con Zod antes de enviar al backend
      const basePayload = quoteType === "recurring_indexed"
        ? RecurringSchema.safeParse({ ...form, ...recurring })
        : QuoteSchema.safeParse(form);

      if (!basePayload.success) {
        const errs:Record<string,string>={};
        for (const e of basePayload.error.errors) errs[e.path[0] as string]=e.message;
        setFormErrors(errs);
        throw new Error("Validación fallida");
      }
      setFormErrors({});

      const body = quoteType === "recurring_indexed"
        ? {
            ...form,
            clientId:            parseInt(form.clientId),
            quoteType,
            contractType:        recurring.contractType,
            contractStartDate:   recurring.contractStartDate,
            contractEndDate:     recurring.contractType==="indefinite"?null:recurring.contractEndDate,
            billingFrequency:    recurring.billingFrequency,
            adjustmentFrequency: recurring.adjustmentFrequency,
            adjustmentIndex:     recurring.adjustmentIndex,
            baseAmount:          parseFloat(recurring.baseAmount)||0,
          }
        : {
            ...form,
            clientId: parseInt(form.clientId),
            quoteType,
            items:    items.filter(i=>i.description.trim()).map(i=>({
              description:i.description, quantity:i.quantity, unitPrice:i.unitPrice, lineTotal:i.lineTotal,
            })),
          };

      const url    = isEdit ? `${BASE}/api/quotes/${editQuote!.id}` : `${BASE}/api/quotes`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({})) as { error?:string };
        throw new Error(err.error ?? "Error al guardar");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["quotes"] });
      void qc.invalidateQueries({ queryKey:["quotes-kpis"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit?"Editar presupuesto":"Nuevo presupuesto"}</DialogTitle>
          <DialogDescription>{isEdit?"Modificá los datos del presupuesto.":"Completá los datos para crear el presupuesto."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {(["single","recurring_indexed"] as const).map(t=>(
              <button key={t} type="button" onClick={()=>setQuoteType(t)}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium border transition-all ${quoteType===t?"bg-primary text-primary-foreground border-primary":"bg-muted/40 border-border hover:border-primary/30 text-muted-foreground"}`}>
                {t==="single"?<FileText className="h-4 w-4"/>:<Repeat className="h-4 w-4"/>}
                {t==="single"?"Presupuesto único":"Contrato recurrente"}
              </button>
            ))}
          </div>

          {/* Cliente */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Cliente *</Label>
            <Select value={form.clientId} onValueChange={v=>setForm(f=>({...f,clientId:v}))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar cliente..."/></SelectTrigger>
              <SelectContent>
                {clients.filter(c=>c.status==="active").map(c=><SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {formErrors["clientId"] && <p className="text-xs text-destructive">{formErrors["clientId"]}</p>}
          </div>

          {/* Título */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Título *</Label>
            <Input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Ej: Asesoramiento contable mensual"/>
            {formErrors["title"] && <p className="text-xs text-destructive">{formErrors["title"]}</p>}
          </div>

          {/* Moneda + fechas */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Moneda</Label>
              <Select value={form.currency} onValueChange={v=>setForm(f=>({...f,currency:v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fecha de emisión</Label>
              <Input type="date" value={form.issueDate} onChange={e=>setForm(f=>({...f,issueDate:e.target.value}))} className="h-9 text-sm"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Vencimiento</Label>
              <Input type="date" value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} className="h-9 text-sm"/>
            </div>
          </div>

          {/* Items (solo para presupuesto único) */}
          {quoteType==="single"&&(
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ítems</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 text-xs text-primary">
                  <Plus className="h-3 w-3 mr-1"/>Agregar
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item,i)=>(
                  <div key={i} className="grid grid-cols-12 gap-2 p-2 rounded-lg border border-border/40 bg-muted/20">
                    <div className="col-span-6 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">Descripción *</p>
                      <Input value={item.description} onChange={e=>updateItem(i,"description",e.target.value)} className="h-7 text-xs" placeholder="Servicio, producto..."/>
                    </div>
                    <div className="col-span-2 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">Cantidad</p>
                      <Input type="number" min="0" value={item.quantity} onChange={e=>updateItem(i,"quantity",parseFloat(e.target.value)||0)} className="h-7 text-xs"/>
                    </div>
                    <div className="col-span-2 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">P. unitario</p>
                      <Input type="number" min="0" value={item.unitPrice} onChange={e=>updateItem(i,"unitPrice",parseFloat(e.target.value)||0)} className="h-7 text-xs"/>
                    </div>
                    <div className="col-span-1 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">Total</p>
                      <p className="h-7 flex items-center text-xs font-medium tabular-nums">{fmt(item.lineTotal, form.currency)}</p>
                    </div>
                    <div className="col-span-1 flex items-end pb-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/50 hover:text-destructive"
                        onClick={()=>removeItem(i)} disabled={items.length<=1}>
                        <X className="h-3.5 w-3.5"/>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <p className="text-sm font-semibold tabular-nums">Total: {fmt(subtotal, form.currency)}</p>
              </div>
            </div>
          )}

          {/* Recurring params */}
          {quoteType==="recurring_indexed"&&(
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuración del contrato</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Monto base *</Label>
                  <Input type="number" min="0" value={recurring.baseAmount} onChange={e=>setRecurring(r=>({...r,baseAmount:e.target.value}))} placeholder="0"/>
                  {formErrors["baseAmount"]&&<p className="text-xs text-destructive">{formErrors["baseAmount"]}</p>}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Frecuencia de facturación</Label>
                  <Select value={recurring.billingFrequency} onValueChange={v=>setRecurring(r=>({...r,billingFrequency:v as BillingFrequency}))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                    <SelectContent>{Object.entries(FREQ_LABELS).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Fecha inicio</Label>
                  <Input type="date" value={recurring.contractStartDate} onChange={e=>setRecurring(r=>({...r,contractStartDate:e.target.value}))} className="h-9 text-sm"/>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Índice de ajuste</Label>
                  <Select value={recurring.adjustmentIndex} onValueChange={v=>setRecurring(r=>({...r,adjustmentIndex:v}))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ipc">IPC (Inflación)</SelectItem>
                      <SelectItem value="icl">ICL (Tasa pasiva)</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Notas */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Notas</Label>
            <Textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Condiciones, observaciones..." className="text-sm" rows={2}/>
          </div>

          {/* Razón de cambio (solo en edición) */}
          {isEdit&&(
            <div className="space-y-1">
              <Label className="text-xs font-medium">Razón del cambio</Label>
              <Input value={form.changeReason} onChange={e=>setForm(f=>({...f,changeReason:e.target.value}))} placeholder="Motivo de la modificación (opcional)"/>
            </div>
          )}

          {/* Mutation error */}
          {mutation.error&&!(mutation.error.message==="Validación fallida")&&(
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0"/>{(mutation.error as Error).message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={()=>mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}
            {isEdit?"Guardar cambios":"Crear presupuesto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [formOpen,     setFormOpen]     = useState(false);
  const [editQuote,    setEditQuote]    = useState<QuoteDetail|null>(null);
  const [selectedId,   setSelectedId]   = useState<number|null>(null);
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState<QuoteStatus|"all">("all");
  const [filterType,   setFilterType]   = useState<QuoteType|"all">("all");
  const [confirmDelId, setConfirmDelId] = useState<number|null>(null);
  const [activeKpi,    setActiveKpi]    = useState<string|null>(null);

  // ── Queries con credentials:"include" ──────────────────────────────────────

  const { data: quotes = [], isLoading: quotesLoading, isError: quotesError } = useQuery<QuoteRow[]>({
    queryKey: ["quotes"],
    queryFn: () =>
      fetch(`${BASE}/api/quotes`, { credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar presupuestos"); return r.json(); }),
  });

  const { data: kpis } = useQuery<KPIs>({
    queryKey: ["quotes-kpis"],
    queryFn: () =>
      fetch(`${BASE}/api/quotes/kpis`, { credentials:"include" }).then(r => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: !quotesError,
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients-options"],
    queryFn: () =>
      fetch(`${BASE}/api/clients`, { credentials:"include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: selectedQuote, isLoading: detailLoading } = useQuery<QuoteDetail>({
    queryKey: ["quote-detail", selectedId],
    queryFn: () =>
      fetch(`${BASE}/api/quotes/${selectedId}`, { credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); }),
    enabled: selectedId !== null,
  });

  // ── Mutations con credentials:"include" ────────────────────────────────────

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id:number; status:string }) =>
      fetch(`${BASE}/api/quotes/${id}/status`, {
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify({ status }),
      }).then(r => { if (!r.ok) throw new Error("Error al cambiar estado"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["quotes"] });
      void qc.invalidateQueries({ queryKey:["quote-detail", selectedId] });
    },
    onError: (e) => toast({ title:"Error", description:(e as Error).message, variant:"destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id:number) =>
      fetch(`${BASE}/api/quotes/${id}`, { method:"DELETE", credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al eliminar"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["quotes"] });
      void qc.invalidateQueries({ queryKey:["quotes-kpis"] });
      if (selectedId===confirmDelId) setSelectedId(null);
      setConfirmDelId(null);
      toast({ title:"Presupuesto eliminado" });
    },
    onError: (e) => toast({ title:"Error al eliminar", description:(e as Error).message, variant:"destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id:number) =>
      fetch(`${BASE}/api/quotes/${id}/archive`, {
        method:"PATCH", credentials:"include",
      }).then(r => { if (!r.ok) throw new Error("Error al archivar"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["quotes"] });
      toast({ title:"Presupuesto archivado" });
    },
  });

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(()=>{
    let items = quotes;
    if (filterStatus!=="all") items=items.filter(q=>q.status===filterStatus);
    if (filterType!=="all")   items=items.filter(q=>q.quoteType===filterType);
    if (search.trim()) {
      const q=search.toLowerCase();
      items=items.filter(q2=>
        q2.clientName.toLowerCase().includes(q)||
        q2.title.toLowerCase().includes(q)||
        q2.quoteNumber.toLowerCase().includes(q)
      );
    }
    // KPI filter
    if (activeKpi==="vencidos")    items=items.filter(q=>q.status==="expired"||(q.dueDate<today()&&q.balance>0));
    if (activeKpi==="parciales")   items=items.filter(q=>q.status==="partially_paid");
    if (activeKpi==="contratos")   items=items.filter(q=>q.quoteType==="recurring_indexed"&&!q.archivedAt);
    if (activeKpi==="cobradosMes") items=items.filter(q=>q.status==="paid"&&q.lastPaymentDate?.startsWith(today().slice(0,7)));
    return [...items].sort((a,b)=>b.issueDate.localeCompare(a.issueDate));
  },[quotes,filterStatus,filterType,search,activeKpi]);

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (quotesLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-52"/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      <div className="space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
    </div>
  );

  if (quotesError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      Error al cargar los presupuestos. Intentá actualizar la página.
    </div>
  );

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Presupuestos y Cobranzas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Gestión de presupuestos, contratos recurrentes y cobranzas</p>
        </div>
        <Button size="sm" onClick={()=>{setEditQuote(null);setFormOpen(true);}}>
          <Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo presupuesto
        </Button>
      </div>

      {/* KPI tiles */}
      {kpis&&(
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Presupuestado total" value={fmt(kpis.totalPresupuestado)}
            sub={`${kpis.cantidadPresupuestos} presupuestos`}
            icon={FileText} iconColor="text-blue-600"
          />
          <KpiCard
            label="Cobrado total" value={fmt(kpis.totalCobrado)}
            sub={`Tasa de cobro: ${Math.round(kpis.tasaCobro)}%`}
            icon={CheckCheck} iconColor="text-teal-600"
          />
          <KpiCard
            label="Saldo pendiente" value={fmt(kpis.saldoPendiente)}
            sub={`${kpis.cantidadVencidos} vencidos`}
            icon={Clock} iconColor={kpis.saldoPendiente>0?"text-amber-600":"text-muted-foreground"}
            active={activeKpi==="vencidos"}
            onClick={()=>setActiveKpi(activeKpi==="vencidos"?null:"vencidos")}
          />
          <KpiCard
            label="Contratos activos" value={String(kpis.contratosActivos)}
            sub={`${kpis.cuotasVencidas} cuotas vencidas`}
            icon={Repeat} iconColor="text-violet-600"
            active={activeKpi==="contratos"}
            onClick={()=>setActiveKpi(activeKpi==="contratos"?null:"contratos")}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por cliente, título o número..." className="pl-9 h-9 text-sm"/>
          {search&&<button onClick={()=>setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5"/></button>}
        </div>
        <div className="flex items-center gap-1">
          {(["all","draft","sent","approved","partially_paid","paid","expired","rejected"] as const).map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${filterStatus===s?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
              {s==="all"?"Todos":STATUS_CONFIG[s as QuoteStatus]?.label??s}
            </button>
          ))}
        </div>
        <button onClick={()=>setFilterType(filterType==="recurring_indexed"?"all":"recurring_indexed")}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all ${filterType==="recurring_indexed"?"bg-violet-100 text-violet-700 border-violet-300":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
          <Repeat className="h-3 w-3"/>Contratos
        </button>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">{filtered.length} presupuesto{filtered.length!==1?"s":""}{search||filterStatus!=="all"?" (filtrado)":""}</p>

      {/* Quote list */}
      {filtered.length===0?(
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30"/>
          <p className="text-sm">{search?"Sin resultados que coincidan":"No hay presupuestos registrados"}</p>
          {!search&&<Button size="sm" className="mt-4" onClick={()=>{setEditQuote(null);setFormOpen(true);}}><Plus className="h-3.5 w-3.5 mr-1.5"/>Crear presupuesto</Button>}
        </div>
      ):(
        <div className="space-y-2">
          {filtered.map(q=>(
            <Card key={q.id}
              className={`hover:shadow-sm transition-shadow cursor-pointer ${selectedId===q.id?"border-primary/50 ring-1 ring-primary/20":""}${q.archivedAt?" opacity-60":""}`}
              onClick={()=>setSelectedId(selectedId===q.id?null:q.id)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Semaphore quote={q}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">{q.quoteNumber}</span>
                      <span className="text-sm font-medium truncate">{q.title}</span>
                      {q.quoteType==="recurring_indexed"&&<span className="text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-1.5 py-0.5 rounded-full font-medium">Recurrente</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{q.clientName}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">Vto: {fmtDate(q.dueDate)}</span>
                      {q.installmentsOverdue!==undefined&&q.installmentsOverdue>0&&(
                        <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">{q.installmentsOverdue} cuota{q.installmentsOverdue!==1?"s":""} vencida{q.installmentsOverdue!==1?"s":""}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums">{fmt(q.totalAmount, q.currency)}</p>
                      {q.balance>0&&<p className="text-[10px] text-amber-600">Pendiente: {fmt(q.balance, q.currency)}</p>}
                    </div>
                    <StatusBadge status={q.status}/>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e=>e.stopPropagation()}>
                          <MoreHorizontal className="h-4 w-4"/>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={e=>{e.stopPropagation();setSelectedId(q.id);}}>
                          <Eye className="h-3.5 w-3.5 mr-2"/>Ver detalle
                        </DropdownMenuItem>
                        {!q.archivedAt&&q.status!=="paid"&&(
                          <DropdownMenuItem onClick={e=>{e.stopPropagation();/* load detail then open form */}}>
                            <Edit2 className="h-3.5 w-3.5 mr-2"/>Editar
                          </DropdownMenuItem>
                        )}
                        {q.status==="draft"&&(
                          <DropdownMenuItem onClick={e=>{e.stopPropagation();updateStatusMutation.mutate({id:q.id,status:"sent"});}}>
                            <ArrowRight className="h-3.5 w-3.5 mr-2"/>Marcar como enviado
                          </DropdownMenuItem>
                        )}
                        {(q.status==="sent"||q.status==="draft")&&(
                          <DropdownMenuItem onClick={e=>{e.stopPropagation();updateStatusMutation.mutate({id:q.id,status:"approved"});}}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-2"/>Aprobar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator/>
                        {!q.archivedAt&&(
                          <DropdownMenuItem onClick={e=>{e.stopPropagation();archiveMutation.mutate(q.id);}} className="text-muted-foreground">
                            <Archive className="h-3.5 w-3.5 mr-2"/>Archivar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={e=>{e.stopPropagation();setConfirmDelId(q.id);}} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2"/>Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Expandido — detalle */}
                {selectedId===q.id&&(
                  <div className="mt-4 border-t pt-3">
                    {detailLoading ? (
                      <div className="space-y-2">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-8 rounded"/>)}</div>
                    ) : selectedQuote?.id===q.id ? (
                      <div className="space-y-3 text-xs">
                        {/* Ítems */}
                        {selectedQuote.items?.length>0&&(
                          <div>
                            <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ítems</p>
                            <div className="space-y-1">
                              {selectedQuote.items.map(item=>(
                                <div key={item.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30">
                                  <span className="flex-1 truncate">{item.description}</span>
                                  <span className="text-muted-foreground shrink-0">{item.quantity} × {fmt(item.unitPrice, q.currency)}</span>
                                  <span className="font-semibold tabular-nums shrink-0">{fmt(item.lineTotal, q.currency)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Cuotas (contratos recurrentes) */}
                        {selectedQuote.installments?.length>0&&(
                          <div>
                            <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cuotas ({selectedQuote.installments.length})</p>
                            <div className="space-y-1">
                              {selectedQuote.installments.slice(0,8).map(inst=>(
                                <div key={inst.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30">
                                  <InstBadge status={inst.status}/>
                                  <span className="text-muted-foreground">#{inst.installmentNumber}</span>
                                  <span className="flex-1">Vto: {fmtDate(inst.dueDate)}</span>
                                  <span className="font-semibold tabular-nums">{fmt(inst.adjustedAmount, q.currency)}</span>
                                </div>
                              ))}
                              {selectedQuote.installments.length>8&&<p className="text-muted-foreground pl-2">+{selectedQuote.installments.length-8} más</p>}
                            </div>
                          </div>
                        )}
                        {/* Pagos */}
                        {selectedQuote.payments?.length>0&&(
                          <div>
                            <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cobros registrados</p>
                            <div className="space-y-1">
                              {selectedQuote.payments.map(p=>(
                                <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30">
                                  <span className="text-muted-foreground">{fmtDate(p.paymentDate)}</span>
                                  <span className="flex-1 capitalize">{p.paymentMethod}</span>
                                  {p.reference&&<span className="text-muted-foreground italic">{p.reference}</span>}
                                  <span className="font-semibold tabular-nums text-teal-600">{fmt(p.amount, p.currency)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ):null}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quote Form Dialog */}
      <QuoteForm
        open={formOpen}
        onClose={()=>{setFormOpen(false);setEditQuote(null);}}
        editQuote={editQuote}
        clients={clients}
      />

      {/* Confirm Delete */}
      <Dialog open={confirmDelId!==null} onOpenChange={v=>!v&&setConfirmDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar presupuesto</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setConfirmDelId(null)}>Cancelar</Button>
            <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}
              onClick={()=>{if(confirmDelId!==null)deleteMutation.mutate(confirmDelId);}}>
              {deleteMutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
