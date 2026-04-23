/**
 * clients.tsx — Módulo de gestión de clientes
 *
 * MEJORAS APLICADAS vs. original:
 *  1. Zod schema para create/edit client — valida antes de enviar al backend
 *  2. credentials:"include" en todos los fetch (GroupManagerDialog, GroupSelector, mutations)
 *  3. isError en query de clientes → estado de error consistente
 *  4. updateMutation con la misma validación Zod que createMutation
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Plus, Search, Edit2, Trash2, RefreshCw, CheckCircle2,
  AlertCircle, X, CalendarClock, Zap, ChevronDown, ChevronUp,
  FolderOpen, Settings2, Loader2, FileText, CreditCard, ExternalLink,
  TrendingDown, Receipt,
} from "lucide-react";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { BASE } from "@/lib/base-url";

// ── Zod Schemas ───────────────────────────────────────────────────────────────

// Validación CUIT con algoritmo verificador
function isCuitValid(cuit: string): boolean {
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  const validPrefixes = ["20","23","24","25","26","27","30","33","34"];
  if (!validPrefixes.includes(clean.slice(0,2))) return false;
  const weights = [5,4,3,2,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i]!) * weights[i]!;
  const rem = sum % 11;
  if (rem === 1) return false;
  const expected = rem === 0 ? 0 : 11 - rem;
  return parseInt(clean[10]!) === expected;
}

const ClientSchema = z.object({
  name:     z.string().min(1, "El nombre es obligatorio").max(200),
  cuit:     z.string()
    .min(1, "El CUIT es obligatorio")
    .refine(v => isCuitValid(v), { message: "CUIT inválido (verificá los dígitos)" }),
  email:    z.string().email("Email inválido").or(z.literal("")).optional(),
  phone:    z.string().max(50).optional(),
  status:   z.enum(["active","inactive"]),
  notes:    z.string().max(2000).optional(),
  taxTypes: z.array(z.string()),
  groupId:  z.string().optional(),
});

type ClientFormData = z.infer<typeof ClientSchema>;

const GroupSchema = z.object({
  name:        z.string().min(1, "El nombre del grupo es obligatorio").max(100),
  color:       z.string(),
  description: z.string().max(200).optional(),
});

// ── Constants ─────────────────────────────────────────────────────────────────

const TAX_TYPES = [
  { key:"iva",                   label:"IVA",                        category:"impuestos" },
  { key:"ganancias",             label:"Ganancias",                  category:"impuestos" },
  { key:"anticipo_ganancias",    label:"Anticipo de IG",             category:"impuestos" },
  { key:"monotributo",           label:"Monotributo",                category:"impuestos" },
  { key:"autonomos",             label:"Autónomos",                  category:"impuestos" },
  { key:"convenio_multilateral", label:"Convenio Multilateral",      category:"impuestos" },
  { key:"sicore_1q",             label:"SICORE 1° Quincena",         category:"impuestos" },
  { key:"sicore_ddjj",           label:"SICORE DDJJ",                category:"impuestos" },
  { key:"iibb_neuquen",          label:"IIBB Neuquén",               category:"impuestos" },
  { key:"iibb_rio_negro",        label:"IIBB Río Negro",             category:"impuestos" },
  { key:"cargas_sociales",       label:"Cargas Sociales (SICOSS)",   category:"cargas" },
  { key:"empleada_domestica",    label:"Personal de Casas Part.",    category:"cargas" },
  { key:"sindicato",             label:"Sindicato",                  category:"cargas" },
  { key:"facturacion",           label:"Facturación",                category:"otros" },
];

const GROUP_COLORS = [
  { key:"blue",    label:"Azul",    bg:"bg-blue-100 dark:bg-blue-900/30",    text:"text-blue-700 dark:text-blue-300",    dot:"bg-blue-500" },
  { key:"emerald", label:"Verde",   bg:"bg-emerald-100 dark:bg-emerald-900/30",text:"text-emerald-700 dark:text-emerald-300",dot:"bg-emerald-500" },
  { key:"amber",   label:"Amarillo",bg:"bg-amber-100 dark:bg-amber-900/30",  text:"text-amber-700 dark:text-amber-300",  dot:"bg-amber-500" },
  { key:"rose",    label:"Rojo",    bg:"bg-rose-100 dark:bg-rose-900/30",    text:"text-rose-700 dark:text-rose-300",    dot:"bg-rose-500" },
  { key:"violet",  label:"Violeta", bg:"bg-violet-100 dark:bg-violet-900/30",text:"text-violet-700 dark:text-violet-300",dot:"bg-violet-500" },
  { key:"orange",  label:"Naranja", bg:"bg-orange-100 dark:bg-orange-900/30",text:"text-orange-700 dark:text-orange-300",dot:"bg-orange-500" },
  { key:"cyan",    label:"Cyan",    bg:"bg-cyan-100 dark:bg-cyan-900/30",    text:"text-cyan-700 dark:text-cyan-300",    dot:"bg-cyan-500" },
  { key:"pink",    label:"Rosa",    bg:"bg-pink-100 dark:bg-pink-900/30",    text:"text-pink-700 dark:text-pink-300",    dot:"bg-pink-500" },
];

function getGroupColor(color: string) {
  return GROUP_COLORS.find(c => c.key === color) ?? GROUP_COLORS[0]!;
}

function formatCuit(raw: string): string {
  const d = raw.replace(/\D/g,"").slice(0,11);
  if (d.length<=2) return d;
  if (d.length<=10) return `${d.slice(0,2)}-${d.slice(2)}`;
  return `${d.slice(0,2)}-${d.slice(2,10)}-${d.slice(10)}`;
}

function cuitLastDigit(cuit: string): string {
  const c = cuit.replace(/\D/g,"");
  return c[c.length-1] ?? "–";
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface TaxAssignment { id:number; clientId:number; taxType:string; enabled:boolean; }
interface ClientGroup {
  id:number; name:string; color:string; description?:string|null; userId?:string|null; createdAt:string;
}
interface Client {
  id:number; name:string; cuit:string; email?:string|null; phone?:string|null;
  status:string; notes?:string|null; groupId?:number|null; group?:ClientGroup|null;
  createdAt:string; taxAssignments:TaxAssignment[];
}

const EMPTY_FORM: ClientFormData = {
  name:"", cuit:"", email:"", phone:"", status:"active", notes:"", taxTypes:[], groupId:"",
};

const STATUS_BADGE: Record<string,string> = {
  active:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-muted text-muted-foreground",
};

// ── GroupBadge ────────────────────────────────────────────────────────────────

function GroupBadge({ group }: { group: ClientGroup }) {
  const cfg = getGroupColor(group.color);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {group.name}
    </span>
  );
}

// ── GroupManagerDialog ────────────────────────────────────────────────────────

function GroupManagerDialog({
  open, onClose, groups, onRefresh,
}: {
  open:boolean; onClose:()=>void; groups:ClientGroup[]; onRefresh:()=>void;
}) {
  const [editingId,  setEditingId]  = useState<number|null>(null);
  const [editName,   setEditName]   = useState("");
  const [editColor,  setEditColor]  = useState("blue");
  const [editDesc,   setEditDesc]   = useState("");
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<number|null>(null);
  const [formError,  setFormError]  = useState<string|null>(null);

  const startEdit = (g:ClientGroup) => { setEditingId(g.id); setEditName(g.name); setEditColor(g.color); setEditDesc(g.description??""); setFormError(null); };
  const cancelEdit = () => { setEditingId(null); setEditName(""); setEditColor("blue"); setEditDesc(""); setFormError(null); };

  const handleSave = async () => {
    // Validar con Zod antes de enviar
    const parsed = GroupSchema.safeParse({ name:editName.trim(), color:editColor, description:editDesc });
    if (!parsed.success) { setFormError(parsed.error.errors[0]?.message ?? "Error de validación"); return; }
    if (!editingId) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/clients/groups/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type":"application/json" },
        // credentials:"include" añadido — el original lo omitía
        credentials: "include",
        body: JSON.stringify(parsed.data),
      });
      onRefresh(); cancelEdit();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id:number) => {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/clients/groups/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      onRefresh();
    } finally { setDeletingId(null); }
  };

  return (
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4"/>Gestionar grupos</DialogTitle>
          <DialogDescription>Editá el nombre, color o eliminá grupos existentes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1">
          {groups.length===0&&<p className="text-sm text-muted-foreground text-center py-4">No hay grupos creados aún.</p>}
          {groups.map(g=>{
            const cfg=getGroupColor(g.color);
            if (editingId===g.id) return (
              <div key={g.id} className="space-y-2 p-3 border rounded-xl bg-muted/20">
                <Input value={editName} onChange={e=>{setEditName(e.target.value);setFormError(null);}} className="h-8 text-sm" placeholder="Nombre del grupo"/>
                {formError&&<p className="text-xs text-destructive">{formError}</p>}
                <Input value={editDesc} onChange={e=>setEditDesc(e.target.value)} className="h-8 text-sm" placeholder="Descripción (opcional)"/>
                <div className="flex flex-wrap gap-1.5">
                  {GROUP_COLORS.map(c=>(
                    <button key={c.key} type="button" onClick={()=>setEditColor(c.key)}
                      className={`h-6 w-6 rounded-full ${c.dot} transition-all ${editColor===c.key?"ring-2 ring-offset-1 ring-foreground scale-110":"opacity-60 hover:opacity-100"}`}
                      title={c.label}/>
                  ))}
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>Cancelar</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving||!editName.trim()}>
                    {saving?<Loader2 className="h-3 w-3 animate-spin"/>:"Guardar"}
                  </Button>
                </div>
              </div>
            );
            return (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2 border rounded-xl hover:bg-muted/30 transition-colors group">
                <span className={`h-3 w-3 rounded-full ${cfg.dot} shrink-0`}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.name}</p>
                  {g.description&&<p className="text-[10px] text-muted-foreground truncate">{g.description}</p>}
                </div>
                <button onClick={()=>startEdit(g)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-primary"><Edit2 className="h-3.5 w-3.5"/></button>
                <button onClick={()=>handleDelete(g.id)} disabled={deletingId===g.id} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive">
                  {deletingId===g.id?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Trash2 className="h-3.5 w-3.5"/>}
                </button>
              </div>
            );
          })}
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── GroupSelector ─────────────────────────────────────────────────────────────

function GroupSelector({
  groups, value, onChange, onGroupCreated,
}: {
  groups:ClientGroup[]; value:string;
  onChange:(id:string)=>void; onGroupCreated:(g:ClientGroup)=>void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string|null>(null);

  const handleCreate = async () => {
    // Validar con Zod antes de enviar
    const parsed = GroupSchema.safeParse({ name:newName.trim(), color:newColor });
    if (!parsed.success) { setError(parsed.error.errors[0]?.message ?? "Error de validación"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/clients/groups`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        // credentials:"include" añadido — el original lo omitía
        credentials: "include",
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        const g: ClientGroup = await res.json();
        onGroupCreated(g);
        onChange(String(g.id));
        setNewName(""); setNewColor("blue"); setCreating(false); setError(null);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      <select value={value} onChange={e=>onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
        <option value="">Sin grupo</option>
        {groups.map(g=><option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>
      {!creating?(
        <button type="button" onClick={()=>setCreating(true)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
          <Plus className="h-3 w-3"/>Crear nuevo grupo
        </button>
      ):(
        <div className="space-y-2 p-3 border rounded-xl bg-muted/20">
          <Input autoFocus value={newName}
            onChange={e=>{setNewName(e.target.value);setError(null);}}
            placeholder="Nombre del grupo..."
            className="h-7 text-xs"
            onKeyDown={e=>{if(e.key==="Enter")handleCreate();if(e.key==="Escape")setCreating(false);}}/>
          {error&&<p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-1.5">
            {GROUP_COLORS.map(c=>(
              <button key={c.key} type="button" onClick={()=>setNewColor(c.key)}
                className={`h-5 w-5 rounded-full ${c.dot} transition-all ${newColor===c.key?"ring-2 ring-offset-1 ring-foreground scale-110":"opacity-50 hover:opacity-100"}`}
                title={c.label}/>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={()=>{setCreating(false);setError(null);}}>Cancelar</Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleCreate} disabled={saving||!newName.trim()}>
              {saving?<Loader2 className="h-3 w-3 animate-spin"/>:"Crear"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ClientQuotesSummary ────────────────────────────────────────────────────────

type QuoteStatus2 = "draft"|"sent"|"approved"|"rejected"|"expired"|"partially_paid"|"paid";
const STATUS_LABEL: Record<QuoteStatus2,string> = {
  draft:"Borrador",sent:"Enviado",approved:"Aprobado",rejected:"Rechazado",
  expired:"Vencido",partially_paid:"Parcial",paid:"Cobrado",
};
const STATUS_COLOR: Record<QuoteStatus2,string> = {
  draft:"bg-gray-100 dark:bg-gray-800 text-gray-600",
  sent:"bg-blue-100 dark:bg-blue-900/30 text-blue-700",
  approved:"bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700",
  rejected:"bg-red-100 dark:bg-red-900/30 text-red-700",
  expired:"bg-orange-100 dark:bg-orange-900/30 text-orange-700",
  partially_paid:"bg-amber-100 dark:bg-amber-900/30 text-amber-700",
  paid:"bg-teal-100 dark:bg-teal-900/30 text-teal-700",
};

function fmtMoney(n:number|string,currency="ARS"){const v=typeof n==="string"?parseFloat(n):n;if(isNaN(v))return"-";return new Intl.NumberFormat("es-AR",{style:"currency",currency,minimumFractionDigits:0}).format(v);}
function fmtDateShort(d:string|null|undefined){if(!d)return"-";const[y,m,dd]=d.split("-");if(!y||!m||!dd)return d;return`${dd}/${m}/${y.slice(2)}`;}

interface ClientQSummary { totalPresupuestos:number;totalPresupuestado:number;totalCobrado:number;saldoPendiente:number;cantidadVencidos:number;cantidadParciales:number;contratosActivos:number;lastQuote:{id:number;quoteNumber:string;issueDate:string;title:string;totalAmount:string;status:string}|null;lastPayment:{id:number;paymentDate:string;amount:string;currency:string}|null; }
interface ClientQRow { id:number;quoteNumber:string;title:string;issueDate:string;dueDate:string;totalAmount:string;status:string;currency:string;version:number;totalPaid:number;balance:number;lastPaymentDate:string|null;quoteType?:string;installmentsTotal?:number;installmentsOverdue?:number; }
interface ClientPaymentRow { id:number;quoteNumber:string;paymentDate:string;amount:string;currency:string;paymentMethod:string;reference:string|null; }
interface ClientInstallmentRow { id:number;quoteId:number;quoteNumber:string;installmentNumber:number;periodStart:string;periodEnd:string;dueDate:string;adjustedAmount:string;status:string;paidAmount:string;balanceDue:string; }

const INST_STATUS_LABEL:Record<string,string>={pending:"Pendiente",due:"Por vencer",overdue:"Vencida",partially_paid:"Parcial",paid:"Pagada",cancelled:"Cancelada"};
const INST_STATUS_COLOR:Record<string,string>={pending:"bg-slate-100 text-slate-600",due:"bg-amber-100 text-amber-700",overdue:"bg-red-100 text-red-700",partially_paid:"bg-orange-100 text-orange-700",paid:"bg-teal-100 text-teal-700",cancelled:"bg-gray-100 text-gray-500"};

function ClientQuotesSummary({ clientId }: { clientId:number; clientName:string }) {
  const { data, isLoading, isError } = useQuery<{summary:ClientQSummary;quotes:ClientQRow[];payments:ClientPaymentRow[];installments:ClientInstallmentRow[]}>({
    queryKey: ["client-quotes", clientId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/client/${clientId}`, { credentials:"include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="space-y-2 py-2">{[1,2,3].map(i=><Skeleton key={i} className="h-8 w-full"/>)}</div>;
  if (isError||!data) return <p className="text-xs text-muted-foreground py-3">No se pudieron cargar los presupuestos</p>;

  const { summary, quotes, payments, installments=[] } = data;
  const todayStr = new Date().toISOString().slice(0,10);

  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          {label:"Presupuestado", value:fmtMoney(summary.totalPresupuestado),     color:"text-foreground"},
          {label:"Cobrado",       value:fmtMoney(summary.totalCobrado),           color:"text-teal-600"},
          {label:"Saldo pend.",   value:fmtMoney(summary.saldoPendiente),         color:summary.saldoPendiente>0?"text-amber-600":"text-foreground"},
        ].map(k=>(
          <div key={k.label} className="bg-muted/40 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={`text-sm font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-muted/40 rounded-lg px-3 py-2 text-center"><p className="text-[10px] text-muted-foreground">Vencidos</p><p className={`text-sm font-bold ${summary.cantidadVencidos>0?"text-red-600":"text-muted-foreground"}`}>{summary.cantidadVencidos}</p></div>
        <div className="bg-muted/40 rounded-lg px-3 py-2 text-center"><p className="text-[10px] text-muted-foreground">Parciales</p><p className={`text-sm font-bold ${summary.cantidadParciales>0?"text-orange-600":"text-muted-foreground"}`}>{summary.cantidadParciales}</p></div>
        <div className="bg-muted/40 rounded-lg px-3 py-2 text-center"><p className="text-[10px] text-muted-foreground">Último pago</p><p className="text-sm font-bold text-foreground">{summary.lastPayment?fmtDateShort(summary.lastPayment.paymentDate):"—"}</p></div>
      </div>
      <div className="flex justify-end">
        <Link href="/dashboard/quotes" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
          <ExternalLink className="w-3 h-3"/>Ver en módulo completo
        </Link>
      </div>
      <Tabs defaultValue="presupuestos">
        <TabsList className="h-7 text-xs">
          <TabsTrigger value="presupuestos" className="text-xs h-6">Presupuestos ({summary.totalPresupuestos})</TabsTrigger>
          <TabsTrigger value="cobros" className="text-xs h-6">Cobros ({payments.length})</TabsTrigger>
          {installments.length>0&&<TabsTrigger value="cuotas" className="text-xs h-6">Cuotas ({installments.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value="presupuestos" className="mt-2">
          {quotes.length===0?<p className="text-xs text-muted-foreground text-center py-3">Sin presupuestos</p>:(
            <div className="space-y-1.5">
              {quotes.slice(0,8).map(q=>(
                <div key={q.id} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2 bg-card">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${q.status==="paid"?"bg-teal-500":q.status==="expired"?"bg-red-500":q.status==="partially_paid"?"bg-amber-500":q.balance>0&&q.dueDate<=todayStr?"bg-red-500":"bg-emerald-500"}`}/>
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{q.quoteNumber}</span>
                    <span className="ml-1.5 truncate">{q.title}</span>
                    {q.quoteType==="recurring_indexed"&&<span className="ml-1 text-[9px] bg-violet-100 text-violet-700 px-1 rounded">Recurrente</span>}
                  </div>
                  <span className="font-medium shrink-0">{fmtMoney(q.totalAmount,q.currency)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${STATUS_COLOR[q.status as QuoteStatus2]??"bg-gray-100 text-gray-600"}`}>{STATUS_LABEL[q.status as QuoteStatus2]??q.status}</span>
                </div>
              ))}
              {quotes.length>8&&<p className="text-[10px] text-muted-foreground text-center">+{quotes.length-8} más</p>}
            </div>
          )}
        </TabsContent>
        <TabsContent value="cobros" className="mt-2">
          {payments.length===0?<p className="text-xs text-muted-foreground text-center py-3">Sin cobros registrados</p>:(
            <div className="space-y-1.5">
              {payments.slice(0,8).map(p=>(
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2 bg-card">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground">{p.quoteNumber}</span>
                    <span className="ml-1.5 text-muted-foreground">{fmtDateShort(p.paymentDate)}</span>
                    {p.reference&&<span className="ml-1.5 italic text-[10px] text-muted-foreground">Ref: {p.reference}</span>}
                  </div>
                  <span className="font-semibold text-teal-600 shrink-0">{fmtMoney(p.amount,p.currency)}</span>
                </div>
              ))}
              {payments.length>8&&<p className="text-[10px] text-muted-foreground text-center">+{payments.length-8} más</p>}
            </div>
          )}
        </TabsContent>
        <TabsContent value="cuotas" className="mt-2">
          {installments.length===0?<p className="text-xs text-muted-foreground text-center py-3">Sin cuotas</p>:(
            <div className="space-y-1.5">
              {installments.slice(0,15).map(inst=>(
                <div key={inst.id} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2 bg-card">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${inst.status==="paid"?"bg-teal-500":inst.status==="overdue"?"bg-red-500":inst.status==="partially_paid"?"bg-orange-500":inst.status==="due"?"bg-amber-500":"bg-slate-400"}`}/>
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{inst.quoteNumber}</span>
                    <span className="ml-1.5 text-muted-foreground">#{inst.installmentNumber}</span>
                    <span className="ml-1.5 text-muted-foreground">Vto: {fmtDateShort(inst.dueDate)}</span>
                  </div>
                  <span className="font-medium shrink-0">{fmtMoney(inst.adjustedAmount)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${INST_STATUS_COLOR[inst.status]??"bg-gray-100 text-gray-600"}`}>{INST_STATUS_LABEL[inst.status]??inst.status}</span>
                </div>
              ))}
              {installments.length>15&&<p className="text-[10px] text-muted-foreground text-center">+{installments.length-15} más</p>}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const qc = useQueryClient();

  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editing,         setEditing]         = useState<Client|null>(null);
  const [form,            setForm]            = useState<ClientFormData>({...EMPTY_FORM});
  const [formErrors,      setFormErrors]      = useState<Record<string,string>>({});
  const [search,          setSearch]          = useState("");
  const [filterStatus,    setFilterStatus]    = useState("all");
  const [filterGroupId,   setFilterGroupId]   = useState<number|null>(null);
  const [expandedId,      setExpandedId]      = useState<number|null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number|null>(null);
  const [groupManagerOpen,setGroupManagerOpen]= useState(false);

  const { data: clients=[], isLoading, isError } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients`, { credentials:"include" });
      if (!res.ok) throw new Error("Error al cargar clientes");
      return res.json();
    },
  });

  const { data: groups=[], refetch: refetchGroups } = useQuery<ClientGroup[]>({
    queryKey: ["client-groups"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients/groups`, { credentials:"include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // validate form and return payload or null
  const validateForm = (): { data: ClientFormData; payload: Record<string,unknown> } | null => {
    const parsed = ClientSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string,string> = {};
      for (const e of parsed.error.errors) {
        const key = e.path[0] as string;
        errs[key] = e.message;
      }
      setFormErrors(errs);
      return null;
    }
    setFormErrors({});
    return {
      data: parsed.data,
      payload: {
        ...parsed.data,
        cuit:    parsed.data.cuit.replace(/\D/g,""),
        groupId: parsed.data.groupId || null,
      },
    };
  };

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string,unknown>) => {
      const res = await fetch(`${BASE}/api/clients`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error((err as any).error ?? "Error al crear cliente");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({queryKey:["clients"]});
      setDialogOpen(false);
      setForm({...EMPTY_FORM});
      setFormErrors({});
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({id,payload}:{id:number;payload:Record<string,unknown>}) => {
      const res = await fetch(`${BASE}/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error((err as any).error ?? "Error al actualizar cliente");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({queryKey:["clients"]});
      setDialogOpen(false);
      setEditing(null);
      setForm({...EMPTY_FORM});
      setFormErrors({});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id:number) => {
      const res = await fetch(`${BASE}/api/clients/${id}`, { method:"DELETE", credentials:"include" });
      if (!res.ok) throw new Error("Error al eliminar cliente");
    },
    onSuccess: () => {
      void qc.invalidateQueries({queryKey:["clients"]});
      setConfirmDeleteId(null);
    },
  });

  const handleSubmit = () => {
    const result = validateForm();
    if (!result) return;
    if (editing) {
      updateMutation.mutate({ id:editing.id, payload:result.payload });
    } else {
      createMutation.mutate(result.payload);
    }
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setForm({
      name:     client.name,
      cuit:     formatCuit(client.cuit),
      email:    client.email ?? "",
      phone:    client.phone ?? "",
      status:   client.status as "active"|"inactive",
      notes:    client.notes ?? "",
      taxTypes: client.taxAssignments.filter(t=>t.enabled).map(t=>t.taxType),
      groupId:  client.groupId ? String(client.groupId) : "",
    });
    setFormErrors({});
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({...EMPTY_FORM});
    setFormErrors({});
    setDialogOpen(true);
  };

  const filtered = useMemo(()=>clients.filter(c=>{
    const matchSearch = search===""||c.name.toLowerCase().includes(search.toLowerCase())||c.cuit.includes(search);
    const matchStatus = filterStatus==="all"||c.status===filterStatus;
    const matchGroup  = filterGroupId===null||c.groupId===filterGroupId;
    return matchSearch&&matchStatus&&matchGroup;
  }),[clients,search,filterStatus,filterGroupId]);

  const summary = useMemo(()=>({
    total:    clients.length,
    active:   clients.filter(c=>c.status==="active").length,
    inactive: clients.filter(c=>c.status==="inactive").length,
  }),[clients]);

  // ── Estados de carga y error ─────────────────────────────────────────────────

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-48"/>
      <div className="grid grid-cols-3 gap-3">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      <div className="space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
    </div>
  );

  if (isError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertCircle className="h-5 w-5 shrink-0"/>
      Error al cargar los clientes. Intentá actualizar la página.
    </div>
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const mutationError = (createMutation.error || updateMutation.error) as Error | null;

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1 text-sm">Cartera de clientes del estudio</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={()=>setGroupManagerOpen(true)}>
            <Settings2 className="h-3.5 w-3.5 mr-1.5"/>Grupos
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo cliente
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {label:"Total",    value:summary.total,    color:"text-foreground",                  bg:"bg-muted/60"},
          {label:"Activos",  value:summary.active,   color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-900/20"},
          {label:"Inactivos",value:summary.inactive, color:"text-slate-500",                   bg:"bg-slate-50 dark:bg-slate-900/20"},
        ].map(k=>(
          <div key={k.label} className={`rounded-xl p-4 ${k.bg}`}>
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nombre o CUIT..." className="pl-9 h-9 text-sm"/>
        </div>
        <div className="flex items-center gap-1">
          {["all","active","inactive"].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${filterStatus===s?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
              {s==="all"?"Todos":s==="active"?"Activos":"Inactivos"}
            </button>
          ))}
        </div>
        {groups.length>0&&(
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={()=>setFilterGroupId(null)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-all ${filterGroupId===null?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
              Todos
            </button>
            {groups.map(g=>{
              const cfg=getGroupColor(g.color);
              return(
                <button key={g.id} onClick={()=>setFilterGroupId(filterGroupId===g.id?null:g.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-all ${filterGroupId===g.id?`${cfg.bg} ${cfg.text} border-current`:"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}/>{g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Client list */}
      {filtered.length===0?(
        <Empty>
          <EmptyHeader>
            <EmptyMedia><Users className="h-8 w-8 text-muted-foreground"/></EmptyMedia>
            <EmptyTitle>{search?"Sin resultados":"Sin clientes"}</EmptyTitle>
            <EmptyDescription>{search?`No hay clientes que coincidan con "${search}"`:"Todavía no hay clientes en la cartera."}</EmptyDescription>
          </EmptyHeader>
          {!search&&<EmptyContent><Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1.5"/>Agregar primer cliente</Button></EmptyContent>}
        </Empty>
      ):(
        <div className="space-y-2">
          {filtered.map(client=>{
            const isExpanded = expandedId===client.id;
            const lastDigit  = cuitLastDigit(client.cuit);
            return(
              <Card key={client.id} className={`transition-colors ${isExpanded?"border-primary/30":""}`}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {/* Avatar CUIT */}
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">{lastDigit}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">{client.name}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[client.status]??"bg-muted text-muted-foreground"}`}>
                          {client.status==="active"?"Activo":"Inactivo"}
                        </span>
                        {client.group&&<GroupBadge group={client.group}/>}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono">{formatCuit(client.cuit)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={()=>setExpandedId(isExpanded?null:client.id)}
                        className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                        {isExpanded?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}
                      </button>
                      <button onClick={()=>openEdit(client)} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Edit2 className="h-3.5 w-3.5"/></button>
                      <button onClick={()=>setConfirmDeleteId(client.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5"/></button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded&&(
                  <CardContent className="pt-0 px-4 pb-4">
                    <div className="border-t pt-3 space-y-4">
                      {/* Tax assignments */}
                      {client.taxAssignments.filter(t=>t.enabled).length>0&&(
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Impuestos asignados</p>
                          <div className="flex flex-wrap gap-1.5">
                            {client.taxAssignments.filter(t=>t.enabled).map(t=>{
                              const tt=TAX_TYPES.find(x=>x.key===t.taxType);
                              return tt?<span key={t.id} className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] font-medium">{tt.label}</span>:null;
                            })}
                          </div>
                        </div>
                      )}
                      {/* Quotes summary */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Presupuestos y cobranzas</p>
                        <ClientQuotesSummary clientId={client.id} clientName={client.name}/>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v=>{if(!v){setDialogOpen(false);setEditing(null);setForm({...EMPTY_FORM});setFormErrors({});}}}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?"Editar cliente":"Nuevo cliente"}</DialogTitle>
            <DialogDescription>{editing?"Modificá los datos del cliente.":"Completá los datos para agregar un nuevo cliente."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Nombre */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Nombre / Razón Social *</label>
              <Input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Ej: García, Juan Carlos"/>
              {formErrors["name"]&&<p className="text-xs text-destructive">{formErrors["name"]}</p>}
            </div>
            {/* CUIT */}
            <div className="space-y-1">
              <label className="text-xs font-medium">CUIT *</label>
              <Input value={form.cuit}
                onChange={e=>setForm(f=>({...f,cuit:formatCuit(e.target.value)}))}
                placeholder="20-12345678-9" maxLength={13}/>
              {formErrors["cuit"]&&<p className="text-xs text-destructive">{formErrors["cuit"]}</p>}
            </div>
            {/* Email + Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Email</label>
                <Input type="email" value={form.email??""} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="cliente@ejemplo.com"/>
                {formErrors["email"]&&<p className="text-xs text-destructive">{formErrors["email"]}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Teléfono</label>
                <Input value={form.phone??""} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+54 299 ..."/>
              </div>
            </div>
            {/* Estado */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Estado</label>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as "active"|"inactive"}))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            {/* Grupo */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Grupo</label>
              <GroupSelector
                groups={groups}
                value={form.groupId??""}
                onChange={v=>setForm(f=>({...f,groupId:v}))}
                onGroupCreated={(g)=>{ void qc.invalidateQueries({queryKey:["client-groups"]}); }}
              />
            </div>
            {/* Impuestos */}
            <div className="space-y-2">
              <label className="text-xs font-medium">Impuestos y Regímenes</label>
              {["impuestos","cargas","otros"].map(cat=>{
                const items=TAX_TYPES.filter(t=>t.category===cat);
                const catLabel=cat==="impuestos"?"Impuestos":cat==="cargas"?"Cargas Sociales":"Otros";
                return(
                  <div key={cat}>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{catLabel}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map(t=>{
                        const active=(form.taxTypes??[]).includes(t.key);
                        return(
                          <button key={t.key} type="button"
                            onClick={()=>setForm(f=>({...f,taxTypes:active?f.taxTypes.filter(x=>x!==t.key):[...f.taxTypes,t.key]}))}
                            className={`px-2.5 py-1 rounded-full text-xs border transition-all ${active?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-muted-foreground/20 hover:border-primary/40"}`}>
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Notas */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Notas</label>
              <textarea value={form.notes??""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                placeholder="Notas internas..." rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"/>
            </div>
            {/* Mutation error */}
            {mutationError&&(
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0"/>
                {mutationError.message}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>{setDialogOpen(false);setEditing(null);setForm({...EMPTY_FORM});setFormErrors({});}}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}
              {editing?"Guardar cambios":"Crear cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete */}
      <Dialog open={confirmDeleteId!==null} onOpenChange={v=>!v&&setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar cliente</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer. ¿Estás seguro?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setConfirmDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" size="sm"
              disabled={deleteMutation.isPending}
              onClick={()=>{if(confirmDeleteId!==null)deleteMutation.mutate(confirmDeleteId);}}>
              {deleteMutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Manager */}
      <GroupManagerDialog
        open={groupManagerOpen}
        onClose={()=>setGroupManagerOpen(false)}
        groups={groups}
        onRefresh={()=>void refetchGroups()}
      />
    </div>
  );
}
