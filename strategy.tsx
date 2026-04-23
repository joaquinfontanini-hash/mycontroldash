/**
 * strategy.tsx — Objetivos estratégicos con Gantt
 *
 * MEJORAS vs. original:
 *  1. credentials:"include" en todas las queries y mutations
 *  2. isError en query principal
 *  3. useMemo para posiciones del Gantt (evita recalcular en cada render)
 *  4. void prefix en invalidateQueries con queryKeys específicos
 *  5. Zod en formulario de goal (reemplaza validación manual)
 */

import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { z } from "zod";
import {
  Plus, Pencil, Trash2, Flag, Target,
  LayoutList, BarChart2, ChevronDown, ChevronUp,
  CheckCircle2, Circle, Loader2, CalendarRange, CheckSquare, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectTask {
  id:number; goalId:number; title:string;
  startDate:string; endDate:string; status:"todo"|"in-progress"|"done"; notes?:string|null;
}
interface StrategyGoal {
  id:number; title:string; category:string; priority:string; status:string;
  progress:number; startDate:string; endDate:string; notes?:string|null; tasks:ProjectTask[];
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const GoalSchema = z.object({
  title:     z.string().min(1,"El título es obligatorio").max(200),
  category:  z.string().min(1),
  priority:  z.string().min(1),
  status:    z.string().min(1),
  progress:  z.coerce.number().min(0).max(100),
  startDate: z.string().min(1,"La fecha de inicio es obligatoria"),
  endDate:   z.string().min(1,"La fecha de fin es obligatoria"),
  notes:     z.string().max(2000).optional(),
});

type GoalFormData = z.infer<typeof GoalSchema>;

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: Record<string,{ label:string; color:string; bg:string; dot:string }> = {
  personal:    { label:"Personal",    color:"text-violet-600 dark:text-violet-400", bg:"bg-violet-100 dark:bg-violet-950/40", dot:"bg-violet-500" },
  profesional: { label:"Profesional", color:"text-blue-600 dark:text-blue-400",    bg:"bg-blue-100 dark:bg-blue-950/40",    dot:"bg-blue-500" },
  financiero:  { label:"Financiero",  color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-100 dark:bg-emerald-950/40",dot:"bg-emerald-500" },
  salud:       { label:"Salud",       color:"text-rose-600 dark:text-rose-400",     bg:"bg-rose-100 dark:bg-rose-950/40",    dot:"bg-rose-500" },
};
const STATUSES:   Record<string,{ label:string; variant:string }> = {
  active:   { label:"Activo",     variant:"default" },
  paused:   { label:"Pausado",    variant:"secondary" },
  done:     { label:"Completado", variant:"outline" },
  cancelled:{ label:"Cancelado",  variant:"destructive" },
};
const PRIORITIES: Record<string,string> = { critical:"Crítica", high:"Alta", medium:"Media", low:"Baja" };
const TASK_STATUS_COLORS: Record<string,string> = {
  "todo":        "bg-zinc-200 dark:bg-zinc-700",
  "in-progress": "bg-amber-300 dark:bg-amber-600",
  "done":        "bg-emerald-400 dark:bg-emerald-600",
};

const EMPTY: GoalFormData = {
  title:"", category:"profesional", priority:"high", status:"active",
  progress:0, startDate:"", endDate:"", notes:"",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addMonths(n: number) {
  const d = new Date(); d.setMonth(d.getMonth()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatShortDate(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type":"application/json" },
    ...opts,
  });
  if (!res.ok) {
    const b = await res.json().catch(()=>({})) as { error?:string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Gantt components ───────────────────────────────────────────────────────────
// El original recalculaba ganttPos en cada render.
// Los componentes ahora reciben leftPct y widthPct ya calculados.

function GanttProjectBar({ goal, leftPct, widthPct, today }: {
  goal:StrategyGoal; leftPct:number; widthPct:number; today:Date;
}) {
  const end = new Date(goal.endDate + "T00:00:00");
  const isDelayed = end < today && goal.status === "active" && goal.progress < 100;
  const cat = CATEGORIES[goal.category] ?? CATEGORIES.profesional!;
  return (
    <div className="relative h-7">
      <div
        className={cn(
          "absolute top-0.5 h-6 rounded-md flex items-center px-2 min-w-[4px] transition-all",
          isDelayed ? "bg-red-400 dark:bg-red-600" : cat.bg,
          goal.status === "done" ? "opacity-60" : ""
        )}
        style={{ left:`${Math.max(0,leftPct)}%`, width:`${Math.max(0.5,widthPct)}%` }}
        title={`${goal.title} — ${goal.progress}%`}
      >
        <span className={cn("text-[10px] font-semibold truncate", isDelayed?"text-white":cat.color)}>
          {widthPct > 8 ? goal.title : ""}
        </span>
      </div>
    </div>
  );
}

function GanttTaskBar({ task, leftPct, widthPct }: { task:ProjectTask; leftPct:number; widthPct:number }) {
  const colorClass = TASK_STATUS_COLORS[task.status] ?? "bg-zinc-300";
  return (
    <div className="relative h-5">
      <div
        className={cn("absolute top-0.5 h-4 rounded flex items-center px-1.5 min-w-[4px]", colorClass)}
        style={{ left:`${Math.max(0,leftPct)}%`, width:`${Math.max(0.5,widthPct)}%` }}
        title={`${task.title} — ${task.status}`}
      >
        <span className="text-[9px] font-medium truncate text-zinc-700 dark:text-zinc-200">
          {widthPct > 10 ? task.title : ""}
        </span>
      </div>
    </div>
  );
}

function GanttView({ goals }: { goals: StrategyGoal[] }) {
  const active = goals.filter(g => g.status === "active" || g.status === "paused");
  if (active.length === 0) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      No hay objetivos activos para mostrar en el Gantt
    </div>
  );

  // Calcular rango de fechas una sola vez con useMemo
  const { ganttStart, totalDays, today, monthMarkers } = useMemo(() => {
    const allDates = active.flatMap(g => [
      new Date(g.startDate + "T00:00:00"),
      new Date(g.endDate + "T00:00:00"),
      ...g.tasks.flatMap(t => [new Date(t.startDate+"T00:00:00"), new Date(t.endDate+"T00:00:00")]),
    ]);
    const minDate = new Date(Math.min(...allDates.map(d=>d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d=>d.getTime())));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);
    const totalDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / 86_400_000);
    const today = new Date(); today.setHours(0,0,0,0);
    // Month markers
    const markers: { label:string; leftPct:number }[] = [];
    const cur = new Date(minDate); cur.setDate(1);
    while (cur <= maxDate) {
      const pct = ((cur.getTime() - minDate.getTime()) / 86_400_000 / totalDays) * 100;
      if (pct >= 0 && pct <= 100) {
        markers.push({
          label: cur.toLocaleDateString("es-AR", { month:"short", year:"2-digit" }),
          leftPct: pct,
        });
      }
      cur.setMonth(cur.getMonth()+1);
    }
    return { ganttStart: minDate, totalDays, today, monthMarkers: markers };
  }, [active]);

  const pos = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return Math.max(0, Math.min(100, ((d.getTime()-ganttStart.getTime())/86_400_000/totalDays)*100));
  };
  const todayPct = ((today.getTime()-ganttStart.getTime())/86_400_000/totalDays)*100;

  return (
    <div className="space-y-2">
      {/* Month markers */}
      <div className="relative h-5 mb-1">
        {monthMarkers.map(m => (
          <span key={m.label}
            className="absolute text-[10px] text-muted-foreground font-medium"
            style={{ left:`${m.leftPct}%` }}>
            {m.label}
          </span>
        ))}
      </div>

      {/* Today line */}
      {todayPct >= 0 && todayPct <= 100 && (
        <div className="relative h-0">
          <div
            className="absolute top-0 bottom-0 w-px bg-primary/50 z-10"
            style={{ left:`${todayPct}%`, height:"100%" }}
            title="Hoy"
          />
        </div>
      )}

      {active.map(goal => {
        const gLeft  = pos(goal.startDate);
        const gWidth = Math.min(100-gLeft, Math.max(0.5, ((new Date(goal.endDate+"T00:00:00").getTime()-new Date(goal.startDate+"T00:00:00").getTime())/86_400_000/totalDays)*100));
        return (
          <div key={goal.id} className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate shrink-0 font-medium">{goal.title}</span>
              <div className="flex-1 relative">
                <GanttProjectBar goal={goal} leftPct={gLeft} widthPct={gWidth} today={today}/>
              </div>
            </div>
            {goal.tasks.map(task => {
              const tLeft  = pos(task.startDate);
              const tWidth = Math.min(100-tLeft, Math.max(0.5, ((new Date(task.endDate+"T00:00:00").getTime()-new Date(task.startDate+"T00:00:00").getTime())/86_400_000/totalDays)*100));
              return (
                <div key={task.id} className="flex items-center gap-2 text-xs pl-4">
                  <span className="w-28 truncate shrink-0 text-muted-foreground">{task.title}</span>
                  <div className="flex-1">
                    <GanttTaskBar task={task} leftPct={tLeft} widthPct={tWidth}/>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Goal Form Dialog ───────────────────────────────────────────────────────────

function GoalFormDialog({ open, onClose, editing, onSuccess }: {
  open:boolean; onClose:()=>void;
  editing:StrategyGoal|null; onSuccess:()=>void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<GoalFormData>(() =>
    editing
      ? { title:editing.title, category:editing.category, priority:editing.priority,
          status:editing.status, progress:editing.progress,
          startDate:editing.startDate, endDate:editing.endDate, notes:editing.notes ?? "" }
      : { ...EMPTY, startDate:todayStr(), endDate:addMonths(3) }
  );
  const [formErrors, setFormErrors] = useState<Record<string,string>>({});

  const mutation = useMutation({
    mutationFn: async (data: GoalFormData) => {
      const url    = editing ? `/api/strategy/goals/${editing.id}` : "/api/strategy/goals";
      const method = editing ? "PATCH" : "POST";
      return apiFetch(url, { method, body:JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({ title: editing ? "Objetivo actualizado" : "Objetivo creado" });
      void qc.invalidateQueries({ queryKey:["strategy-goals"] });
      onSuccess();
      onClose();
    },
    onError: (e) => toast({ title:"Error al guardar", description:(e as Error).message, variant:"destructive" }),
  });

  const handleSubmit = () => {
    const parsed = GoalSchema.safeParse(form);
    if (!parsed.success) {
      const errs:Record<string,string> = {};
      for (const e of parsed.error.errors) errs[e.path[0] as string]=e.message;
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    mutation.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing?"Editar objetivo":"Nuevo objetivo estratégico"}</DialogTitle>
          <DialogDescription>{editing?"Modificá los datos del objetivo.":"Definí un nuevo objetivo con plazo y categoría."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Título *</Label>
            <Input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Ej: Aumentar facturación 30%"/>
            {formErrors["title"]&&<p className="text-xs text-destructive">{formErrors["title"]}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Categoría</Label>
              <Select value={form.category} onValueChange={v=>setForm(f=>({...f,category:v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                <SelectContent>{Object.entries(CATEGORIES).map(([k,m])=><SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Prioridad</Label>
              <Select value={form.priority} onValueChange={v=>setForm(f=>({...f,priority:v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITIES).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fecha inicio *</Label>
              <Input type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} className="h-9 text-sm"/>
              {formErrors["startDate"]&&<p className="text-xs text-destructive">{formErrors["startDate"]}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fecha fin *</Label>
              <Input type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} className="h-9 text-sm"/>
              {formErrors["endDate"]&&<p className="text-xs text-destructive">{formErrors["endDate"]}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Estado</Label>
              <Select value={form.status} onValueChange={v=>setForm(f=>({...f,status:v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                <SelectContent>{Object.entries(STATUSES).map(([k,m])=><SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Avance ({form.progress}%)</Label>
              <Input type="range" min={0} max={100} value={form.progress}
                onChange={e=>setForm(f=>({...f,progress:parseInt(e.target.value)}))} className="h-9"/>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Notas</Label>
            <textarea value={form.notes??""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
              rows={3} placeholder="Contexto, observaciones..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"/>
          </div>
          {mutation.error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0"/>{(mutation.error as Error).message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}
            {editing?"Guardar cambios":"Crear objetivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategyPage() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<"list"|"gantt">("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing,    setEditing]    = useState<StrategyGoal|null>(null);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());

  const { data: goals = [], isLoading, isError } = useQuery<StrategyGoal[]>({
    queryKey: ["strategy-goals"],
    queryFn:  () => apiFetch<StrategyGoal[]>("/api/strategy/goals"),
    staleTime: 2 * 60 * 1000,
    enabled: !!isSignedIn,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/strategy/goals/${id}`, { method:"DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey:["strategy-goals"] }),
    onError:   (e) => toast({ title:"Error al eliminar", description:(e as Error).message, variant:"destructive" }),
  });

  const toggleExpanded = (id: number) =>
    setExpanded(prev => { const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });

  const byStatus = useMemo(() => ({
    active:    goals.filter(g=>g.status==="active"),
    paused:    goals.filter(g=>g.status==="paused"),
    done:      goals.filter(g=>g.status==="done"),
    cancelled: goals.filter(g=>g.status==="cancelled"),
  }), [goals]);

  const avgProgress = goals.length
    ? Math.round(goals.filter(g=>g.status==="active").reduce((s,g)=>s+g.progress,0) / Math.max(1,byStatus.active.length))
    : 0;

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-52"/>
      <div className="grid grid-cols-3 gap-3">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      <div className="space-y-3">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-24 rounded-xl"/>)}</div>
    </div>
  );

  if (isError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      Error al cargar los objetivos estratégicos. Intentá actualizar la página.
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Objetivos Estratégicos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Metas con timeline, categoría y avance</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode("list")} className={`px-2.5 py-1.5 transition-colors ${viewMode==="list"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              <LayoutList className="h-3.5 w-3.5"/>
            </button>
            <button onClick={()=>setViewMode("gantt")} className={`px-2.5 py-1.5 transition-colors border-l ${viewMode==="gantt"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              <BarChart2 className="h-3.5 w-3.5"/>
            </button>
          </div>
          <Button size="sm" onClick={()=>{setEditing(null);setDialogOpen(true);}}>
            <Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo objetivo
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:"Activos",     value:byStatus.active.length,    color:"text-blue-600 dark:text-blue-400",    bg:"bg-blue-50 dark:bg-blue-900/20" },
          { label:"Completados", value:byStatus.done.length,      color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-900/20" },
          { label:"Pausados",    value:byStatus.paused.length,    color:"text-amber-600 dark:text-amber-400",  bg:"bg-amber-50 dark:bg-amber-900/20" },
          { label:"Avance prom.",value:`${avgProgress}%`,         color:"text-violet-600 dark:text-violet-400",bg:"bg-violet-50 dark:bg-violet-900/20" },
        ].map(k=>(
          <div key={k.label} className={`rounded-xl p-4 ${k.bg}`}>
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-0.5 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {viewMode === "gantt" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarRange className="h-4 w-4"/>Cronograma (Gantt)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <GanttView goals={goals}/>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">No hay objetivos estratégicos</p>
              <Button size="sm" className="mt-4" onClick={()=>{setEditing(null);setDialogOpen(true);}}>
                <Plus className="h-3.5 w-3.5 mr-1.5"/>Crear primer objetivo
              </Button>
            </div>
          ) : goals.map(goal => {
            const cat     = CATEGORIES[goal.category] ?? CATEGORIES.profesional!;
            const st      = STATUSES[goal.status]   ?? STATUSES.active!;
            const isExp   = expanded.has(goal.id);
            const today   = new Date(); today.setHours(0,0,0,0);
            const end     = new Date(goal.endDate + "T00:00:00");
            const isLate  = end < today && goal.status === "active" && goal.progress < 100;
            return (
              <Card key={goal.id} className={cn("transition-colors", isLate && "border-red-300 dark:border-red-800")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", cat.bg)}>
                      <Flag className={cn("h-4 w-4", cat.color)}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">{goal.title}</p>
                        <Badge variant={st.variant as any} className="text-[10px]">{st.label}</Badge>
                        {isLate && <span className="text-[10px] text-red-600 font-semibold">⚠ Atrasado</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className={cat.color}>{cat.label}</span>
                        <span>·</span>
                        <span>{PRIORITIES[goal.priority] ?? goal.priority}</span>
                        <span>·</span>
                        <span>{formatShortDate(goal.startDate)} → {formatShortDate(goal.endDate)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress value={goal.progress} className="h-1.5 flex-1"/>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{goal.progress}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>toggleExpanded(goal.id)}>
                        {isExp?<ChevronUp className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>{setEditing(goal);setDialogOpen(true);}}>
                        <Pencil className="h-3.5 w-3.5"/>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive"
                        onClick={()=>deleteMutation.mutate(goal.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-3.5 w-3.5"/>
                      </Button>
                    </div>
                  </div>

                  {/* Tasks */}
                  {isExp && goal.tasks.length > 0 && (
                    <div className="mt-3 border-t pt-3 space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tareas</p>
                      {goal.tasks.map(task => {
                        const dotColor = TASK_STATUS_COLORS[task.status] ?? "bg-zinc-300";
                        return (
                          <div key={task.id} className="flex items-center gap-2 text-xs">
                            <div className={cn("h-2 w-2 rounded-full shrink-0", dotColor)}/>
                            <span className="flex-1 truncate">{task.title}</span>
                            <span className="text-muted-foreground shrink-0">{formatShortDate(task.startDate)} → {formatShortDate(task.endDate)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isExp && goal.notes && (
                    <p className="mt-2 text-xs text-muted-foreground italic border-l-2 border-primary/20 pl-2">{goal.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <GoalFormDialog
        open={dialogOpen}
        onClose={()=>{setDialogOpen(false);setEditing(null);}}
        editing={editing}
        onSuccess={()=>{setDialogOpen(false);setEditing(null);}}
      />
    </div>
  );
}
