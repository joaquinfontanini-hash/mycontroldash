/**
 * due-dates.tsx — Módulo de vencimientos impositivos
 *
 * MEJORAS APLICADAS vs. original:
 *  1. Zod schema para formulario create/edit — valida antes de enviar
 *  2. credentials:"include" en todos los fetch (TraceabilityModal, mutations)
 *  3. isError en queries de categorías y clientes
 *  4. Estado de error consistente con el resto de módulos
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, CalendarClock, Plus, Pencil, Trash2,
  CheckCircle2, Circle, X, Tag, RefreshCw, Eye,
  Bell, FileText, Filter, Search, LayoutGrid, List,
  Mail, Shield, ChevronDown, ChevronRight, AlertTriangle,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

type TrafficLight = "rojo"|"amarillo"|"verde"|"gris";

interface DueDate {
  id:number; title:string; category:string; dueDate:string;
  description?:string|null; priority:"low"|"medium"|"high"|"critical";
  status:"pending"|"done"|"cancelled"; alertEnabled:boolean;
  recurrenceType?:string; recurrenceRule?:string|null;
  recurrenceEndDate?:string|null; isRecurrenceParent?:boolean;
  parentId?:number|null; source?:string; clientId?:number|null;
  trafficLight:TrafficLight; cuitGroup?:string|null;
  cuitTermination?:number|null; taxCode?:string|null;
  classificationReason?:string|null; alertGenerated?:boolean;
  lastAlertSentAt?:string|null; manualReview?:boolean;
  reviewNotes?:string|null; reviewedAt?:string|null;
  reviewedBy?:string|null; createdAt:string;
}
interface DueDateCategory { id:number; name:string; color:string; }
interface ClientOption { id:number; name:string; }
interface KPIs { totalThisMonth:number;overdue:number;dueToday:number;due3days:number;errors:number;clientsRojo:number;clientsAmarillo:number;byTrafficLight:{rojo:number;amarillo:number;verde:number;gris:number}; }
interface TraceabilityData { dueDate:DueDate;traceability:Record<string,unknown>;currentTrafficLight:TrafficLight;alertHistory:AlertLog[];manualReview:{reviewed:boolean;reviewNotes?:string|null;reviewedAt?:string|null;reviewedBy?:string|null;}; }
interface AlertLog { id:number;clientId?:number|null;dueDateId?:number|null;alertType:string;recipient:string;subject:string;sendStatus:string;errorMessage?:string|null;isAutomatic:boolean;retriggeredBy?:string|null;sentAt?:string|null;createdAt:string; }

// ── Zod Schema ────────────────────────────────────────────────────────────────

const DueDateSchema = z.object({
  title:       z.string().min(1,"El título es obligatorio").max(300),
  category:    z.string().min(1,"La categoría es obligatoria"),
  dueDate:     z.string().min(1,"La fecha de vencimiento es obligatoria")
    .regex(/^\d{4}-\d{2}-\d{2}$/,"Formato de fecha inválido (YYYY-MM-DD)"),
  description: z.string().max(2000).optional(),
  priority:    z.enum(["low","medium","high","critical"]),
  status:      z.enum(["pending","done","cancelled"]),
  alertEnabled:z.boolean(),
  clientId:    z.number().nullable().optional(),
  recurrenceType: z.string().optional(),
});

type DueDateFormData = z.infer<typeof DueDateSchema>;

// ── Style helpers ──────────────────────────────────────────────────────────────

const SEMAFORO_CONFIG: Record<TrafficLight,{label:string;dot:string;badge:string;border:string}> = {
  rojo:     {label:"🔴 Vencido/Urgente",      dot:"bg-red-500",     badge:"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400",        border:"border-l-red-500"},
  amarillo: {label:"🟡 Próximo (≤7d)",         dot:"bg-amber-400",   badge:"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400",border:"border-l-amber-400"},
  verde:    {label:"🟢 A tiempo (>7d)",         dot:"bg-emerald-500", badge:"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",border:"border-l-emerald-500"},
  gris:     {label:"⚪ Completado/Inactivo",   dot:"bg-slate-400",   badge:"bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400",  border:"border-l-slate-400"},
};
const PRIORITY_CONFIG = {
  low:      {label:"Baja",    color:"text-slate-500",   bg:"bg-slate-100 dark:bg-slate-800"},
  medium:   {label:"Media",   color:"text-amber-600",   bg:"bg-amber-100 dark:bg-amber-900/40"},
  high:     {label:"Alta",    color:"text-orange-600",  bg:"bg-orange-100 dark:bg-orange-900/40"},
  critical: {label:"Crítica", color:"text-red-600",     bg:"bg-red-100 dark:bg-red-900/40"},
};
const CATEGORY_COLORS: Record<string,string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  green:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  purple: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  teal:   "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  gray:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function formatDate(dateStr:string):string{try{return new Date(dateStr+"T00:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short",year:"numeric"});}catch{return dateStr;}}
function formatDateTime(dateStr:string):string{try{return new Date(dateStr).toLocaleString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch{return dateStr;}}
function getDaysRemaining(dueDate:string):number{const due=new Date(dueDate+"T00:00:00");const now=new Date();now.setHours(0,0,0,0);return Math.floor((due.getTime()-now.getTime())/(1000*60*60*24));}

// ── KPI types ─────────────────────────────────────────────────────────────────
type KpiFilter = "all"|"overdue"|"today"|"week"|"month";
type FilterField = "status"|"priority"|"trafficLight"|"category"|"source";
interface FilterRule { field:FilterField; values:string[]; }
interface CustomFilter { id:string; name:string; rules:FilterRule[]; dateFrom?:string; dateTo?:string; }

function loadCustomFilters():CustomFilter[]{try{return JSON.parse(localStorage.getItem("due-date-custom-filters")??"[]");}catch{return[];}}
function saveCustomFilters(filters:CustomFilter[]){localStorage.setItem("due-date-custom-filters",JSON.stringify(filters));}

// ── SemaforoBadge ──────────────────────────────────────────────────────────────

function SemaforoBadge({light,compact=false}:{light:TrafficLight;compact?:boolean}){
  const cfg=SEMAFORO_CONFIG[light];
  if(compact)return(<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}/>{light.toUpperCase()}</span>);
  return(<span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border ${cfg.badge}`}><span className={`h-2 w-2 rounded-full ${cfg.dot}`}/>{cfg.label}</span>);
}

// ── TraceabilityModal ──────────────────────────────────────────────────────────

function TraceabilityModal({dueDateId,open,onClose}:{dueDateId:number|null;open:boolean;onClose:()=>void;}){
  const {toast}=useToast();
  const qc=useQueryClient();
  const [reviewNote,setReviewNote]=useState("");
  const [showReviewForm,setShowReviewForm]=useState(false);

  const {data,isLoading}=useQuery<TraceabilityData>({
    queryKey: ["due-date-trace",dueDateId],
    queryFn: async()=>{
      const res=await fetch(`${BASE}/api/due-dates/${dueDateId}/traceability`,{credentials:"include"});
      if(!res.ok)throw new Error("Error");
      return res.json();
    },
    enabled: open&&dueDateId!==null,
  });

  const reviewMutation=useMutation({
    mutationFn: async()=>{
      const res=await fetch(`${BASE}/api/due-dates/${dueDateId}/mark-reviewed`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify({reviewNotes:reviewNote.trim()||null}),
      });
      if(!res.ok)throw new Error("Error");
      return res.json();
    },
    onSuccess:()=>{
      toast({title:"Marcado como revisado"});
      void qc.invalidateQueries({queryKey:["due-dates"]});
      void qc.invalidateQueries({queryKey:["due-date-trace",dueDateId]});
      setShowReviewForm(false);
    },
  });

  return(
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4"/>Trazabilidad del vencimiento</DialogTitle>
          <DialogDescription>Historial de alertas y estado del semáforo</DialogDescription>
        </DialogHeader>
        {isLoading?(
          <div className="space-y-3 py-4">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-12 rounded-lg"/>)}</div>
        ):data?(
          <div className="space-y-4 py-2">
            {/* Datos del vencimiento */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{data.dueDate.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(data.dueDate.dueDate)}</p>
                </div>
                <SemaforoBadge light={data.currentTrafficLight}/>
              </div>
              {data.dueDate.classificationReason&&(
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver razón de clasificación</summary>
                  <p className="mt-1 font-mono text-[10px] bg-muted p-2 rounded">{data.dueDate.classificationReason}</p>
                </details>
              )}
            </div>
            {/* Review status */}
            {data.manualReview.reviewed?(
              <div className="flex items-start gap-2 text-sm rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
                <Shield className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5"/>
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-300">Revisado manualmente</p>
                  {data.manualReview.reviewNotes&&<p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">{data.manualReview.reviewNotes}</p>}
                  {data.manualReview.reviewedAt&&<p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(data.manualReview.reviewedAt)}</p>}
                </div>
              </div>
            ):(
              <div>
                {!showReviewForm?(
                  <Button variant="outline" size="sm" onClick={()=>setShowReviewForm(true)}>
                    <Shield className="h-3.5 w-3.5 mr-1.5"/>Marcar como revisado
                  </Button>
                ):(
                  <div className="space-y-2 p-3 border rounded-xl bg-muted/20">
                    <textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)}
                      placeholder="Nota de revisión (opcional)..." rows={2}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"/>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={()=>setShowReviewForm(false)}>Cancelar</Button>
                      <Button size="sm" onClick={()=>reviewMutation.mutate()} disabled={reviewMutation.isPending}>
                        {reviewMutation.isPending?<Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/>:null}
                        Confirmar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Alert history */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Historial de alertas ({data.alertHistory.length})</p>
              {data.alertHistory.length===0?(
                <p className="text-sm text-muted-foreground">Sin alertas enviadas</p>
              ):(
                <div className="space-y-2">
                  {data.alertHistory.map(log=>(
                    <div key={log.id} className="flex items-start gap-3 text-xs border rounded-lg px-3 py-2 bg-card">
                      <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${log.sendStatus==="sent"?"bg-emerald-500":log.sendStatus==="failed"?"bg-red-500":"bg-amber-400"}`}/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{log.subject}</span>
                          {log.isAutomatic&&<span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded">Auto</span>}
                        </div>
                        <p className="text-muted-foreground truncate">{log.recipient}</p>
                        {log.errorMessage&&<p className="text-destructive text-[10px] mt-0.5">{log.errorMessage}</p>}
                      </div>
                      <span className="text-muted-foreground shrink-0">{log.sentAt?formatDateTime(log.sentAt):"-"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ):null}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DueDateForm Dialog ────────────────────────────────────────────────────────

function DueDateFormDialog({
  open,onClose,editing,categories,clients,onSuccess,
}:{
  open:boolean;onClose:()=>void;
  editing:DueDate|null;
  categories:DueDateCategory[];
  clients:ClientOption[];
  onSuccess:()=>void;
}){
  const {toast}=useToast();
  const [form,setForm]=useState<DueDateFormData>({
    title:"",category:"",dueDate:"",description:"",
    priority:"medium",status:"pending",alertEnabled:true,clientId:null,recurrenceType:"",
  });
  const [formErrors,setFormErrors]=useState<Record<string,string>>({});

  // Populate form when editing
  useEffect(()=>{
    if(editing){
      setForm({
        title:editing.title,category:editing.category,dueDate:editing.dueDate,
        description:editing.description??"",priority:editing.priority,
        status:editing.status,alertEnabled:editing.alertEnabled,
        clientId:editing.clientId??null,
        recurrenceType:editing.recurrenceType??"",
      });
    } else {
      setForm({title:"",category:"",dueDate:"",description:"",priority:"medium",status:"pending",alertEnabled:true,clientId:null,recurrenceType:""});
    }
    setFormErrors({});
  },[editing,open]);

  const qc=useQueryClient();

  const mutation=useMutation({
    mutationFn: async(payload:Record<string,unknown>)=>{
      const url=editing?`${BASE}/api/due-dates/${editing.id}`:`${BASE}/api/due-dates`;
      const method=editing?"PATCH":"POST";
      const res=await fetch(url,{
        method,
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify(payload),
      });
      if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error((e as any).error??"Error al guardar");}
      return res.json();
    },
    onSuccess:()=>{
      toast({title:editing?"Vencimiento actualizado":"Vencimiento creado"});
      void qc.invalidateQueries({queryKey:["due-dates"]});
      onSuccess();onClose();
    },
  });

  const handleSubmit=()=>{
    // Validar con Zod antes de enviar al backend
    const parsed=DueDateSchema.safeParse(form);
    if(!parsed.success){
      const errs:Record<string,string>={};
      for(const e of parsed.error.errors){const key=e.path[0] as string;errs[key]=e.message;}
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    mutation.mutate({...parsed.data,clientId:parsed.data.clientId??null,recurrenceType:parsed.data.recurrenceType||null});
  };

  return(
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing?"Editar vencimiento":"Nuevo vencimiento"}</DialogTitle>
          <DialogDescription>{editing?"Modificá los datos del vencimiento.":"Completá los datos para agregar un nuevo vencimiento."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Título */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Título *</Label>
            <Input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Ej: IVA mensual — García"/>
            {formErrors["title"]&&<p className="text-xs text-destructive">{formErrors["title"]}</p>}
          </div>
          {/* Categoría + Fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Categoría *</Label>
              <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Seleccionar...</option>
                {categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              {formErrors["category"]&&<p className="text-xs text-destructive">{formErrors["category"]}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fecha de vencimiento *</Label>
              <Input type="date" value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))}/>
              {formErrors["dueDate"]&&<p className="text-xs text-destructive">{formErrors["dueDate"]}</p>}
            </div>
          </div>
          {/* Prioridad + Estado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Prioridad</Label>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value as DueDateFormData["priority"]}))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                {Object.entries(PRIORITY_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Estado</Label>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as DueDateFormData["status"]}))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="pending">Pendiente</option>
                <option value="done">Completado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          </div>
          {/* Cliente */}
          {clients.length>0&&(
            <div className="space-y-1">
              <Label className="text-xs font-medium">Cliente (opcional)</Label>
              <select value={form.clientId!=null?String(form.clientId):""} onChange={e=>setForm(f=>({...f,clientId:e.target.value?Number(e.target.value):null}))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Sin cliente específico</option>
                {clients.map(c=><option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
          )}
          {/* Descripción */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Descripción</Label>
            <textarea value={form.description??""} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Notas adicionales..." rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"/>
          </div>
          {/* Alerta */}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="alertEnabled" checked={form.alertEnabled}
              onChange={e=>setForm(f=>({...f,alertEnabled:e.target.checked}))}
              className="h-4 w-4 rounded border-input"/>
            <label htmlFor="alertEnabled" className="text-sm cursor-pointer">Activar alerta por email</label>
          </div>
          {/* Mutation error */}
          {mutation.error&&(
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0"/>
              {(mutation.error as Error).message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}
            {editing?"Guardar cambios":"Crear vencimiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DueDatesPage(){
  const {toast}=useToast();
  const qc=useQueryClient();

  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editing,         setEditing]         = useState<DueDate|null>(null);
  const [search,          setSearch]          = useState("");
  const [filterStatus,    setFilterStatus]    = useState<string>("pending");
  const [filterTraffic,   setFilterTraffic]   = useState<TrafficLight|"all">("all");
  const [filterCategory,  setFilterCategory]  = useState("all");
  const [viewMode,        setViewMode]        = useState<"list"|"grid">("list");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number|null>(null);
  const [traceId,         setTraceId]         = useState<number|null>(null);
  const [traceOpen,       setTraceOpen]       = useState(false);
  const [activeKpi,       setActiveKpi]       = useState<KpiFilter>("all");
  const [customFilters,   setCustomFilters]   = useState<CustomFilter[]>(loadCustomFilters);
  const [activeCustomFilter,setActiveCustomFilter]=useState<string|null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data:dueDates=[], isLoading:ddLoading, isError:ddError } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: async()=>{
      const res=await fetch(`${BASE}/api/due-dates`,{credentials:"include"});
      if(!res.ok)throw new Error("Error al cargar vencimientos");
      return res.json();
    },
  });

  const { data:categories=[], isError:catError } = useQuery<DueDateCategory[]>({
    queryKey: ["due-date-categories"],
    queryFn: async()=>{
      const res=await fetch(`${BASE}/api/due-dates/categories`,{credentials:"include"});
      if(!res.ok)return[];
      return res.json();
    },
  });

  const { data:clients=[] } = useQuery<ClientOption[]>({
    queryKey: ["clients-options"],
    queryFn: async()=>{
      const res=await fetch(`${BASE}/api/clients`,{credentials:"include"});
      if(!res.ok)return[];
      return (await res.json() as {id:number;name:string}[]).map(c=>({id:c.id,name:c.name}));
    },
  });

  const { data:kpis } = useQuery<KPIs>({
    queryKey: ["due-dates-kpis"],
    queryFn: async()=>{
      const res=await fetch(`${BASE}/api/due-dates/kpis`,{credentials:"include"});
      if(!res.ok)throw new Error("Error al cargar KPIs");
      return res.json();
    },
    enabled: !ddError,
  });

  // ── Recalculate traffic lights ─────────────────────────────────────────────

  const [isRecalculating,setIsRecalculating]=useState(false);
  const handleRecalculate=async()=>{
    setIsRecalculating(true);
    try{
      const res=await fetch(`${BASE}/api/due-dates/recalculate-traffic`,{method:"POST",credentials:"include"});
      if(res.ok){
        void qc.invalidateQueries({queryKey:["due-dates"]});
        void qc.invalidateQueries({queryKey:["due-dates-kpis"]});
        toast({title:"Semáforos actualizados"});
      }
    }catch{}
    setIsRecalculating(false);
  };

  // ── Toggle status ──────────────────────────────────────────────────────────

  const toggleStatusMutation=useMutation({
    mutationFn: async({id,status}:{id:number;status:"pending"|"done"|"cancelled"})=>{
      const res=await fetch(`${BASE}/api/due-dates/${id}`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify({status}),
      });
      if(!res.ok)throw new Error("Error al actualizar");
      return res.json();
    },
    onSuccess:()=>void qc.invalidateQueries({queryKey:["due-dates"]}),
  });

  const deleteMutation=useMutation({
    mutationFn: async(id:number)=>{
      const res=await fetch(`${BASE}/api/due-dates/${id}`,{method:"DELETE",credentials:"include"});
      if(!res.ok)throw new Error("Error al eliminar");
    },
    onSuccess:()=>{void qc.invalidateQueries({queryKey:["due-dates"]});setConfirmDeleteId(null);toast({title:"Vencimiento eliminado"});},
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  const today=new Date();today.setHours(0,0,0,0);
  const todayStr=today.toISOString().split("T")[0]!;

  const filtered=useMemo(()=>{
    let items=dueDates;
    // KPI filter
    if(activeKpi==="overdue")  items=items.filter(d=>d.status==="pending"&&d.dueDate<todayStr);
    if(activeKpi==="today")    items=items.filter(d=>d.status==="pending"&&d.dueDate===todayStr);
    if(activeKpi==="week")     {const end=new Date(today);end.setDate(today.getDate()+7);const endStr=end.toISOString().split("T")[0]!;items=items.filter(d=>d.status==="pending"&&d.dueDate>=todayStr&&d.dueDate<=endStr);}
    if(activeKpi==="month")    items=items.filter(d=>d.status==="pending"&&d.dueDate.startsWith(todayStr.slice(0,7)));
    // Custom filter
    if(activeCustomFilter){
      const cf=customFilters.find(f=>f.id===activeCustomFilter);
      if(cf){
        for(const rule of cf.rules){if(rule.values.length>0)items=items.filter(d=>rule.values.includes((d as Record<string,unknown>)[rule.field] as string));}
        if(cf.dateFrom)items=items.filter(d=>d.dueDate>=cf.dateFrom!);
        if(cf.dateTo)  items=items.filter(d=>d.dueDate<=cf.dateTo!);
      }
    }
    if(filterStatus!=="all")   items=items.filter(d=>d.status===filterStatus);
    if(filterTraffic!=="all")  items=items.filter(d=>d.trafficLight===filterTraffic);
    if(filterCategory!=="all") items=items.filter(d=>d.category===filterCategory);
    if(search.trim()){const q=search.toLowerCase();items=items.filter(d=>d.title.toLowerCase().includes(q)||d.category.toLowerCase().includes(q));}
    return items.sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  },[dueDates,activeKpi,activeCustomFilter,customFilters,filterStatus,filterTraffic,filterCategory,search,todayStr]);

  // ── Loading / Error ────────────────────────────────────────────────────────

  if(ddLoading) return(
    <div className="space-y-4">
      <Skeleton className="h-9 w-48"/>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      <div className="space-y-2">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div>
    </div>
  );

  if(ddError) return(
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      Error al cargar los vencimientos. Intentá actualizar la página.
    </div>
  );

  return(
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Vencimientos</h1>
          <p className="text-muted-foreground mt-1 text-sm">Vencimientos impositivos con semáforo automático</p>
        </div>
        <Button size="sm" onClick={()=>{setEditing(null);setDialogOpen(true);}}>
          <Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo vencimiento
        </Button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          {label:"Vencidos",    value:kpis?.overdue??0,       color:"text-red-600",                  bg:"bg-red-50 dark:bg-red-900/20 border border-red-200/60",   activeBg:"ring-2 ring-red-500",    kpi:"overdue" as KpiFilter},
          {label:"Hoy",         value:kpis?.dueToday??0,      color:"text-orange-600",               bg:"bg-orange-50 dark:bg-orange-900/20 border border-orange-200/60",activeBg:"ring-2 ring-orange-500",kpi:"today" as KpiFilter},
          {label:"Esta semana", value:dueDates.filter(d=>{const end=new Date(today);end.setDate(today.getDate()+7);const e=end.toISOString().split("T")[0]!;return d.status==="pending"&&d.dueDate>=todayStr&&d.dueDate<=e;}).length,
                                               color:"text-amber-600",                bg:"bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60",   activeBg:"ring-2 ring-amber-500",  kpi:"week" as KpiFilter},
          {label:"Este mes",    value:dueDates.filter(d=>d.status==="pending"&&d.dueDate.startsWith(todayStr.slice(0,7))).length,
                                               color:"text-blue-600 dark:text-blue-400",bg:"bg-blue-50 dark:bg-blue-900/20 border border-blue-200/60",     activeBg:"ring-2 ring-blue-500",   kpi:"month" as KpiFilter},
        ].map(t=>{
          const isActive=activeKpi===t.kpi;
          return(
            <button key={t.label} onClick={()=>setActiveKpi(isActive?"all":t.kpi)}
              className={["rounded-lg p-3 text-center transition-all cursor-pointer hover:scale-105 hover:shadow-md",t.bg,isActive?t.activeBg:""].join(" ")}>
              <p className={`text-2xl font-bold tabular-nums leading-none ${t.color}`}>{t.value}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{t.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." className="pl-9 h-9 text-sm"/>
        </div>
        {/* Estado */}
        <div className="flex items-center gap-1">
          {["all","pending","done","cancelled"].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${filterStatus===s?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
              {s==="all"?"Todos":s==="pending"?"Pendientes":s==="done"?"Completados":"Cancelados"}
            </button>
          ))}
        </div>
        {/* Semáforo */}
        <div className="flex items-center gap-1">
          {(["all","rojo","amarillo","verde","gris"] as const).map(t=>{
            const cfg=t!=="all"?SEMAFORO_CONFIG[t]:null;
            return(
              <button key={t} onClick={()=>setFilterTraffic(t)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${filterTraffic===t?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}>
                {cfg&&<span className={`h-2 w-2 rounded-full ${cfg.dot}`}/>}
                {t==="all"?"🚦 Todos":t}
              </button>
            );
          })}
        </div>
        {/* Recalcular + vista */}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleRecalculate} disabled={isRecalculating}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded hover:bg-muted/60">
            <RefreshCw className={`h-3 w-3 ${isRecalculating?"animate-spin":""}`}/>
            {isRecalculating?"Recalculando...":"Actualizar semáforos"}
          </button>
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode("list")} className={`px-2.5 py-1.5 transition-colors ${viewMode==="list"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}><List className="h-3.5 w-3.5"/></button>
            <button onClick={()=>setViewMode("grid")} className={`px-2.5 py-1.5 transition-colors border-l ${viewMode==="grid"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}><LayoutGrid className="h-3.5 w-3.5"/></button>
          </div>
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">{filtered.length} vencimiento{filtered.length!==1?"s":""} {activeKpi!=="all"||filterStatus!=="all"?"(filtrado)":""}</p>

      {/* List */}
      {filtered.length===0?(
        <div className="text-center py-12 text-muted-foreground">
          <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-30"/>
          <p className="text-sm">Sin vencimientos que coincidan con los filtros</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={()=>{setEditing(null);setDialogOpen(true);}}>
            <Plus className="h-3.5 w-3.5 mr-1.5"/>Agregar vencimiento
          </Button>
        </div>
      ):(
        <div className={viewMode==="grid"?"grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3":"space-y-2"}>
          {filtered.map(dd=>{
            const days=getDaysRemaining(dd.dueDate);
            const sc=SEMAFORO_CONFIG[dd.trafficLight];
            const pc=PRIORITY_CONFIG[dd.priority];
            const catColor=CATEGORY_COLORS[categories.find(c=>c.name===dd.category)?.color??"gray"]??CATEGORY_COLORS["gray"]!;
            return(
              <Card key={dd.id} className={`border-l-4 ${sc.border} transition-colors hover:shadow-sm`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button onClick={()=>toggleStatusMutation.mutate({id:dd.id,status:dd.status==="done"?"pending":"done"})}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors">
                      {dd.status==="done"?<CheckCircle2 className="h-5 w-5 text-emerald-500"/>:<Circle className="h-5 w-5"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium leading-snug ${dd.status==="done"?"line-through text-muted-foreground":""}`}>{dd.title}</p>
                        <SemaforoBadge light={dd.trafficLight} compact/>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${catColor}`}>{dd.category}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.color}`}>{pc.label}</span>
                        <span className="text-[10px] text-muted-foreground">{formatDate(dd.dueDate)}</span>
                        {dd.status==="pending"&&days<=0&&<span className="text-[10px] text-red-600 font-semibold">{days===0?"Hoy":`Hace ${Math.abs(days)}d`}</span>}
                        {dd.status==="pending"&&days>0&&<span className="text-[10px] text-muted-foreground">en {days}d</span>}
                        {dd.alertEnabled&&<Bell className="h-3 w-3 text-muted-foreground/60"/>}
                        {dd.source==="afip-engine"&&<span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded">AFIP Engine</span>}
                      </div>
                      {dd.description&&<p className="text-xs text-muted-foreground mt-1 line-clamp-2">{dd.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={()=>{setTraceId(dd.id);setTraceOpen(true);}} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Ver trazabilidad"><Eye className="h-3.5 w-3.5"/></button>
                      <button onClick={()=>{setEditing(dd);setDialogOpen(true);}} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="h-3.5 w-3.5"/></button>
                      <button onClick={()=>setConfirmDeleteId(dd.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Eliminar"><Trash2 className="h-3.5 w-3.5"/></button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Dialog */}
      <DueDateFormDialog
        open={dialogOpen}
        onClose={()=>{setDialogOpen(false);setEditing(null);}}
        editing={editing}
        categories={categories}
        clients={clients}
        onSuccess={()=>{setDialogOpen(false);setEditing(null);}}
      />

      {/* Confirm Delete */}
      <Dialog open={confirmDeleteId!==null} onOpenChange={v=>!v&&setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar vencimiento</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setConfirmDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}
              onClick={()=>{if(confirmDeleteId!==null)deleteMutation.mutate(confirmDeleteId);}}>
              {deleteMutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Traceability */}
      <TraceabilityModal dueDateId={traceId} open={traceOpen} onClose={()=>{setTraceOpen(false);setTraceId(null);}}/>
    </div>
  );
}
