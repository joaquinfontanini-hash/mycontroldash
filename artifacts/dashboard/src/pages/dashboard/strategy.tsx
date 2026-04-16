import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Plus, Pencil, Trash2, Check, X, Flag, Target,
  LayoutList, BarChart2, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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

interface StrategyGoal {
  id: number; title: string; category: string;
  priority: string; status: string; progress: number;
  startDate: string; endDate: string; notes?: string | null;
}

const CATEGORIES: Record<string, { label: string; color: string; bg: string }> = {
  personal:     { label: "Personal",     color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-950/40" },
  profesional:  { label: "Profesional",  color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-100 dark:bg-blue-950/40" },
  financiero:   { label: "Financiero",   color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-950/40" },
  salud:        { label: "Salud",        color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-100 dark:bg-rose-950/40" },
};

const STATUSES: Record<string, { label: string; variant: string }> = {
  active:    { label: "Activo",     variant: "default" },
  paused:    { label: "Pausado",    variant: "secondary" },
  done:      { label: "Completado", variant: "outline" },
  cancelled: { label: "Cancelado",  variant: "destructive" },
};

const PRIORITIES: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Media", low: "Baja",
};

type FormData = {
  title: string; category: string; priority: string;
  status: string; progress: string; startDate: string; endDate: string; notes: string;
};

const EMPTY: FormData = {
  title: "", category: "profesional", priority: "high",
  status: "active", progress: "0", startDate: "", endDate: "", notes: "",
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

function GanttBar({ goal, ganttStart, totalDays }: { goal: StrategyGoal; ganttStart: Date; totalDays: number }) {
  const start = new Date(goal.startDate + "T00:00:00");
  const end = new Date(goal.endDate + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const startOffset = Math.max(0, (start.getTime() - ganttStart.getTime()) / 86_400_000);
  const duration = Math.max(1, (end.getTime() - start.getTime()) / 86_400_000);
  const isDelayed = end < today && goal.status === "active" && goal.progress < 100;

  const leftPct = Math.min(100, (startOffset / totalDays) * 100);
  const widthPct = Math.min(100 - leftPct, (duration / totalDays) * 100);

  const cat = CATEGORIES[goal.category];

  return (
    <div className="relative h-8">
      <div
        className={cn(
          "absolute top-1 h-6 rounded-md flex items-center px-2 min-w-[4px] transition-all",
          isDelayed ? "bg-red-400 dark:bg-red-600" : cat.bg,
          goal.status === "done" ? "opacity-60" : ""
        )}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        title={`${goal.title} — ${goal.progress}%`}
      >
        <span className={cn("text-[10px] font-semibold truncate", isDelayed ? "text-white" : cat.color)}>
          {widthPct > 8 ? goal.title : ""}
        </span>
      </div>
    </div>
  );
}

function GanttView({ goals }: { goals: StrategyGoal[] }) {
  const activeGoals = goals.filter(g => g.status !== "cancelled");
  if (activeGoals.length === 0) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allDates = activeGoals.flatMap(g => [new Date(g.startDate + "T00:00:00"), new Date(g.endDate + "T00:00:00")]);
  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);
  const totalDays = Math.max(30, (maxDate.getTime() - minDate.getTime()) / 86_400_000);

  const todayPct = Math.max(0, Math.min(100, ((today.getTime() - minDate.getTime()) / 86_400_000 / totalDays) * 100));

  const months: { label: string; pct: number }[] = [];
  const cur = new Date(minDate);
  while (cur <= maxDate) {
    const pct = ((cur.getTime() - minDate.getTime()) / 86_400_000 / totalDays) * 100;
    months.push({ label: cur.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }), pct });
    cur.setMonth(cur.getMonth() + 1);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4" />
          Timeline / Gantt
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div style={{ minWidth: 500 }}>
            <div className="relative h-6 border-b mb-2">
              {months.map((m, i) => (
                <span
                  key={i}
                  className="absolute top-0 text-[10px] text-muted-foreground font-medium"
                  style={{ left: `${m.pct}%` }}
                >
                  {m.label}
                </span>
              ))}
              <div
                className="absolute top-0 bottom-0 w-px bg-primary/60"
                style={{ left: `${todayPct}%` }}
                title="Hoy"
              />
            </div>

            <div className="space-y-1">
              {activeGoals.map(goal => (
                <div key={goal.id} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 shrink-0 truncate" title={goal.title}>
                    {goal.title}
                  </span>
                  <div className="flex-1 relative">
                    <GanttBar goal={goal} ganttStart={minDate} totalDays={totalDays} />
                    <div
                      className="absolute top-0 bottom-0 w-px bg-primary/30"
                      style={{ left: `${todayPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{goal.progress}%</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-8 rounded-sm bg-blue-100 dark:bg-blue-950/40" />
                <span>En curso</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-8 rounded-sm bg-red-400/60" />
                <span>Atrasado</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-px w-6 bg-primary/60" />
                <span>Hoy</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StrategyPage() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: goals = [], isLoading } = useQuery<StrategyGoal[]>({
    queryKey: ["strategy-goals"],
    queryFn: () => fetch(`${BASE}/api/strategy-goals`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<FormData, "progress"> & { progress: number }) =>
      fetch(`${BASE}/api/strategy-goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); setDialogOpen(false); toast({ title: "Objetivo creado" }); },
    onError: () => toast({ title: "Error al crear objetivo", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      fetch(`${BASE}/api/strategy-goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); setDialogOpen(false); toast({ title: "Objetivo actualizado" }); },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/strategy-goals/${id}`, { method: "DELETE" }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); toast({ title: "Objetivo eliminado" }); },
    onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
  });

  function openNew() {
    setForm({ ...EMPTY, startDate: todayStr(), endDate: addMonths(3) });
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(g: StrategyGoal) {
    setForm({ title: g.title, category: g.category, priority: g.priority, status: g.status, progress: String(g.progress), startDate: g.startDate, endDate: g.endDate, notes: g.notes ?? "" });
    setEditId(g.id);
    setDialogOpen(true);
  }

  function submit() {
    const data = { ...form, progress: parseInt(form.progress, 10) || 0 };
    if (editId !== null) updateMutation.mutate({ id: editId, data });
    else createMutation.mutate(data);
  }

  const byCategory = Object.entries(CATEGORIES).map(([key, meta]) => ({
    key, meta, goals: goals.filter(g => g.category === key),
  })).filter(c => c.goals.length > 0);

  const avgProgress = goals.filter(g => g.status === "active").length > 0
    ? Math.round(goals.filter(g => g.status === "active").reduce((s, g) => s + g.progress, 0) / goals.filter(g => g.status === "active").length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estrategia</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Objetivos estratégicos y seguimiento</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Nuevo objetivo
        </Button>
      </div>

      {goals.filter(g => g.status === "active").length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Activos</p>
              <p className="text-2xl font-bold mt-1">{goals.filter(g => g.status === "active").length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Completados</p>
              <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{goals.filter(g => g.status === "done").length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Progreso prom.</p>
              <p className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{avgProgress}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Atrasados</p>
              <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">
                {goals.filter(g => {
                  if (g.status !== "active") return false;
                  const diff = (new Date(g.endDate + "T00:00:00").getTime() - Date.now()) / 86_400_000;
                  return diff < 0 && g.progress < 100;
                }).length}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5"><LayoutList className="h-3.5 w-3.5" />Lista</TabsTrigger>
          <TabsTrigger value="gantt" className="gap-1.5"><BarChart2 className="h-3.5 w-3.5" />Gantt</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4 space-y-6">
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
            </div>
          ) : goals.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Flag className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Sin objetivos estratégicos</p>
                <p className="text-xs text-muted-foreground">Definí tus objetivos a mediano y largo plazo por área</p>
                <Button size="sm" variant="outline" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Crear primer objetivo
                </Button>
              </CardContent>
            </Card>
          ) : (
            byCategory.map(({ key, meta, goals: catGoals }) => (
              <div key={key}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn("h-2 w-2 rounded-full", meta.bg.replace("bg-", "bg-").replace("/40", ""))} style={{ background: undefined }}>
                    <div className={cn("h-2 w-2 rounded-full", key === "personal" ? "bg-violet-500" : key === "profesional" ? "bg-blue-500" : key === "financiero" ? "bg-emerald-500" : "bg-rose-500")} />
                  </div>
                  <h3 className={cn("text-sm font-semibold", meta.color)}>{meta.label}</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{catGoals.length}</Badge>
                </div>
                <div className="space-y-2">
                  {catGoals.map(goal => {
                    const isExpanded = expandedId === goal.id;
                    const isDelayed = goal.status === "active" && new Date(goal.endDate + "T00:00:00") < new Date() && goal.progress < 100;
                    const statusMeta = STATUSES[goal.status] ?? STATUSES.active;
                    return (
                      <div key={goal.id} className={cn("rounded-xl border p-4 transition-all", isDelayed ? "border-red-200 dark:border-red-800" : "")}>
                        <div className="flex items-start gap-3">
                          <Target className={cn("h-4 w-4 mt-0.5 shrink-0", meta.color)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">{goal.title}</p>
                              <Badge variant={statusMeta.variant as any} className="text-[10px] h-4 px-1.5">{statusMeta.label}</Badge>
                              {isDelayed && <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Atrasado</Badge>}
                            </div>
                            <div className="flex items-center gap-3 mt-2">
                              <Progress value={goal.progress} className="flex-1 h-1.5" />
                              <span className="text-xs font-semibold tabular-nums w-8 text-right">{goal.progress}%</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatShortDate(goal.startDate)} — {formatShortDate(goal.endDate)}
                              <span className="ml-2 text-muted-foreground/60">· {PRIORITIES[goal.priority]}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedId(isExpanded ? null : goal.id)}>
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(goal)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(goal.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {isExpanded && goal.notes && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-muted-foreground">{goal.notes}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="gantt" className="mt-4">
          {goals.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Sin objetivos para mostrar en el timeline</p>
              </CardContent>
            </Card>
          ) : (
            <GanttView goals={goals} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Editar objetivo" : "Nuevo objetivo estratégico"}</DialogTitle>
            <DialogDescription>
              {editId !== null ? "Actualizá los datos del objetivo estratégico." : "Definí un nuevo objetivo a largo plazo para tu estrategia."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título</Label>
              <Input className="mt-1" placeholder="Ej: Llegar a 50 clientes activos" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoría</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIES).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Prioridad</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUSES).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Progreso ({form.progress}%)</Label>
                <Input type="range" min={0} max={100} value={form.progress} onChange={e => setForm(f => ({ ...f, progress: e.target.value }))} className="mt-1 h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inicio</Label>
                <Input type="date" className="mt-1" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Fin estimado</Label>
                <Input type="date" className="mt-1" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notas (opcional)</Label>
              <Input className="mt-1" placeholder="Contexto, métricas, hitos..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={!form.title || !form.startDate || !form.endDate}>
              {editId !== null ? "Guardar cambios" : "Crear objetivo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
