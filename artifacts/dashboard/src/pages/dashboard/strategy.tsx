import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Plus, Pencil, Trash2, Flag, Target,
  LayoutList, BarChart2, ChevronDown, ChevronUp,
  CheckCircle2, Circle, Loader2, CalendarRange, CheckSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  id: number;
  goalId: number;
  title: string;
  startDate: string;
  endDate: string;
  status: "todo" | "in-progress" | "done";
  notes?: string | null;
}

interface StrategyGoal {
  id: number;
  title: string;
  category: string;
  priority: string;
  status: string;
  progress: number;
  startDate: string;
  endDate: string;
  notes?: string | null;
  tasks: ProjectTask[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  personal:    { label: "Personal",    color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-950/40",  dot: "bg-violet-500" },
  profesional: { label: "Profesional", color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-100 dark:bg-blue-950/40",     dot: "bg-blue-500" },
  financiero:  { label: "Financiero",  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-950/40", dot: "bg-emerald-500" },
  salud:       { label: "Salud",       color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-100 dark:bg-rose-950/40",     dot: "bg-rose-500" },
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

const TASK_STATUS_COLORS: Record<string, string> = {
  "todo":        "bg-zinc-200 dark:bg-zinc-700",
  "in-progress": "bg-amber-300 dark:bg-amber-600",
  "done":        "bg-emerald-400 dark:bg-emerald-600",
};

type FormData = {
  title: string; category: string; priority: string;
  status: string; progress: string; startDate: string; endDate: string; notes: string;
};

const EMPTY: FormData = {
  title: "", category: "profesional", priority: "high",
  status: "active", progress: "0", startDate: "", endDate: "", notes: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(n: number) {
  const d = new Date(); d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

// ── Gantt Components ──────────────────────────────────────────────────────────

function ganttPos(dateStr: string, ganttStart: Date, totalDays: number) {
  const d = new Date(dateStr + "T00:00:00");
  return Math.max(0, Math.min(100, ((d.getTime() - ganttStart.getTime()) / 86_400_000 / totalDays) * 100));
}

function GanttProjectBar({ goal, ganttStart, totalDays }: { goal: StrategyGoal; ganttStart: Date; totalDays: number }) {
  const start = new Date(goal.startDate + "T00:00:00");
  const end = new Date(goal.endDate + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isDelayed = end < today && goal.status === "active" && goal.progress < 100;
  const cat = CATEGORIES[goal.category] ?? CATEGORIES.profesional;

  const leftPct = Math.min(100, ((start.getTime() - ganttStart.getTime()) / 86_400_000 / totalDays) * 100);
  const widthPct = Math.min(100 - leftPct, ((end.getTime() - start.getTime()) / 86_400_000 / totalDays) * 100);

  return (
    <div className="relative h-7">
      <div
        className={cn(
          "absolute top-0.5 h-6 rounded-md flex items-center px-2 min-w-[4px] transition-all",
          isDelayed ? "bg-red-400 dark:bg-red-600" : cat.bg,
          goal.status === "done" ? "opacity-60" : ""
        )}
        style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.max(0.5, widthPct)}%` }}
        title={`${goal.title} — ${goal.progress}%`}
      >
        <span className={cn("text-[10px] font-semibold truncate", isDelayed ? "text-white" : cat.color)}>
          {widthPct > 8 ? goal.title : ""}
        </span>
      </div>
    </div>
  );
}

function GanttTaskBar({ task, ganttStart, totalDays }: { task: ProjectTask; ganttStart: Date; totalDays: number }) {
  const leftPct = ganttPos(task.startDate, ganttStart, totalDays);
  const end = new Date(task.endDate + "T00:00:00");
  const start = new Date(task.startDate + "T00:00:00");
  const widthPct = Math.min(100 - leftPct, Math.max(0.5, ((end.getTime() - start.getTime()) / 86_400_000 / totalDays) * 100));
  const colorClass = TASK_STATUS_COLORS[task.status] ?? "bg-zinc-300";

  return (
    <div className="relative h-5">
      <div
        className={cn("absolute top-0.5 h-4 rounded flex items-center px-1.5 min-w-[4px]", colorClass)}
        style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.max(0.5, widthPct)}%` }}
        title={`${task.title} (${task.status})`}
      >
        <span className="text-[9px] font-medium truncate text-foreground/70">
          {widthPct > 10 ? task.title : ""}
        </span>
      </div>
    </div>
  );
}

function GanttView({ goals }: { goals: StrategyGoal[] }) {
  const activeGoals = goals.filter(g => g.status !== "cancelled");
  if (activeGoals.length === 0) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allTasks = activeGoals.flatMap(g => g.tasks);

  const allDates = [
    ...activeGoals.flatMap(g => [new Date(g.startDate + "T00:00:00"), new Date(g.endDate + "T00:00:00")]),
    ...allTasks.flatMap(t => [new Date(t.startDate + "T00:00:00"), new Date(t.endDate + "T00:00:00")]),
  ];
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
          <div style={{ minWidth: 560 }}>
            {/* Month headers */}
            <div className="relative h-6 border-b mb-2">
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 text-[10px] text-muted-foreground font-medium" style={{ left: `${m.pct}%` }}>
                  {m.label}
                </span>
              ))}
              <div className="absolute top-0 bottom-0 w-px bg-primary/60" style={{ left: `${todayPct}%` }} title="Hoy" />
            </div>

            {/* Rows */}
            <div className="space-y-1">
              {activeGoals.map(goal => (
                <div key={goal.id}>
                  {/* Project row */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground/80 w-32 shrink-0 truncate" title={goal.title}>
                      {goal.title}
                    </span>
                    <div className="flex-1 relative">
                      <GanttProjectBar goal={goal} ganttStart={minDate} totalDays={totalDays} />
                      <div className="absolute top-0 bottom-0 w-px bg-primary/30" style={{ left: `${todayPct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{goal.progress}%</span>
                  </div>

                  {/* Task sub-rows */}
                  {goal.tasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground w-32 shrink-0 truncate pl-3 flex items-center gap-1" title={task.title}>
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", TASK_STATUS_COLORS[task.status]?.replace("bg-", "bg-"))} />
                        {task.title}
                      </span>
                      <div className="flex-1 relative">
                        <GanttTaskBar task={task} ganttStart={minDate} totalDays={totalDays} />
                        <div className="absolute top-0 bottom-0 w-px bg-primary/20" style={{ left: `${todayPct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
                        {task.status === "done" ? "✓" : task.status === "in-progress" ? "…" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-8 rounded-sm bg-blue-100 dark:bg-blue-950/40" />
                <span>Proyecto activo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-6 rounded-sm bg-zinc-300 dark:bg-zinc-600" />
                <span>Tarea pendiente</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-6 rounded-sm bg-amber-300 dark:bg-amber-600" />
                <span>En progreso</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-6 rounded-sm bg-emerald-400 dark:bg-emerald-600" />
                <span>Completada</span>
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

// ── Task Panel (shown when project is expanded) ───────────────────────────────

function TaskPanel({ goal, onTaskChange }: { goal: StrategyGoal; onTaskChange: () => void }) {
  const { toast } = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState(goal.startDate);
  const [newEnd, setNewEnd] = useState(goal.endDate);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [editForm, setEditForm] = useState({ title: "", startDate: "", endDate: "", status: "todo" as ProjectTask["status"] });

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/strategy-goals/${goal.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: newTitle.trim(), startDate: newStart, endDate: newEnd, status: "todo" }),
      });
      if (res.ok) {
        setNewTitle(""); setNewStart(goal.startDate); setNewEnd(goal.endDate); setAdding(false);
        onTaskChange();
      } else {
        const e = await res.json();
        toast({ title: e.error ?? "Error al crear tarea", variant: "destructive" });
      }
    } finally { setSaving(false); }
  };

  const handleStatusToggle = async (task: ProjectTask) => {
    const next = task.status === "done" ? "todo" : task.status === "todo" ? "in-progress" : "done";
    await fetch(`${BASE}/api/strategy-goals/${goal.id}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: next }),
    });
    onTaskChange();
  };

  const handleDelete = async (taskId: number) => {
    await fetch(`${BASE}/api/strategy-goals/${goal.id}/tasks/${taskId}`, {
      method: "DELETE", credentials: "include",
    });
    onTaskChange();
  };

  const openEdit = (task: ProjectTask) => {
    setEditingTask(task);
    setEditForm({ title: task.title, startDate: task.startDate, endDate: task.endDate, status: task.status });
  };

  const handleEditSave = async () => {
    if (!editingTask) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/strategy-goals/${goal.id}/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editForm),
      });
      setEditingTask(null);
      onTaskChange();
    } finally { setSaving(false); }
  };

  const statusIcon = (status: ProjectTask["status"]) => {
    if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (status === "in-progress") return <Circle className="h-4 w-4 text-amber-500 fill-amber-200" />;
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  };

  const done = goal.tasks.filter(t => t.status === "done").length;
  const total = goal.tasks.length;

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <CheckSquare className="h-3 w-3" />
          Tareas del proyecto
          {total > 0 && <span className="text-primary font-bold">{done}/{total}</span>}
        </p>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium">
            <Plus className="h-3 w-3" /> Nueva tarea
          </button>
        )}
      </div>

      {/* Task list */}
      {goal.tasks.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground text-center py-2 italic">Sin tareas. Agregá la primera.</p>
      )}

      {goal.tasks.map(task => (
        <div key={task.id}>
          {editingTask?.id === task.id ? (
            <div className="space-y-2 p-2 rounded-lg bg-muted/30 border">
              <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="h-7 text-xs" placeholder="Título" />
              <div className="grid grid-cols-3 gap-2">
                <Input type="date" value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))} className="h-7 text-xs" />
                <Input type="date" value={editForm.endDate} onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))} className="h-7 text-xs" />
                <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as ProjectTask["status"] }))}
                  className="h-7 rounded border border-input bg-background px-2 text-xs">
                  <option value="todo">Pendiente</option>
                  <option value="in-progress">En progreso</option>
                  <option value="done">Completada</option>
                </select>
              </div>
              <div className="flex gap-1 justify-end">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingTask(null)}>Cancelar</Button>
                <Button size="sm" className="h-6 px-2 text-xs" onClick={handleEditSave} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 py-1.5 px-1 rounded-lg hover:bg-muted/30 group transition-colors">
              <button onClick={() => handleStatusToggle(task)} className="mt-0.5 shrink-0 hover:scale-110 transition-transform">
                {statusIcon(task.status)}
              </button>
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs font-medium truncate", task.status === "done" && "line-through text-muted-foreground")}>
                  {task.title}
                </p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CalendarRange className="h-2.5 w-2.5" />
                  {formatShortDate(task.startDate)} — {formatShortDate(task.endDate)}
                </p>
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(task)} className="p-1 hover:text-primary transition-colors">
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={() => handleDelete(task.id)} className="p-1 hover:text-destructive transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add task form */}
      {adding && (
        <div className="space-y-2 p-2 rounded-lg bg-muted/20 border">
          <Input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Título de la tarea..."
            className="h-7 text-xs"
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground mb-0.5">Inicio</p>
              <Input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} className="h-7 text-xs"
                min={goal.startDate} max={goal.endDate} />
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-0.5">Fin</p>
              <Input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} className="h-7 text-xs"
                min={newStart} max={goal.endDate} />
            </div>
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleAdd} disabled={saving || !newTitle.trim()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Agregar"}
            </Button>
          </div>
        </div>
      )}

      {/* Notes */}
      {goal.notes && (
        <p className="text-xs text-muted-foreground italic mt-1">{goal.notes}</p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

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
    queryFn: () => fetch(`${BASE}/api/strategy-goals`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 30_000,
    enabled: !!isSignedIn,
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<FormData, "progress"> & { progress: number }) =>
      fetch(`${BASE}/api/strategy-goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); setDialogOpen(false); toast({ title: "Proyecto creado" }); },
    onError: () => toast({ title: "Error al crear proyecto", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      fetch(`${BASE}/api/strategy-goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); setDialogOpen(false); toast({ title: "Proyecto actualizado" }); },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/strategy-goals/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategy-goals"] }); toast({ title: "Proyecto eliminado" }); },
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

  const activeGoals = goals.filter(g => g.status === "active");
  const avgProgress = activeGoals.length > 0
    ? Math.round(activeGoals.reduce((s, g) => s + g.progress, 0) / activeGoals.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de proyectos con tareas y timeline</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Nuevo proyecto
        </Button>
      </div>

      {/* KPI tiles */}
      {goals.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Activos</p>
              <p className="text-2xl font-bold mt-1">{activeGoals.length}</p>
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
                  return new Date(g.endDate + "T00:00:00") < new Date() && g.progress < 100;
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

        {/* List View */}
        <TabsContent value="list" className="mt-4 space-y-6">
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
            </div>
          ) : goals.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Flag className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Sin proyectos</p>
                <p className="text-xs text-muted-foreground">Creá tu primer proyecto para organizar tareas con fechas</p>
                <Button size="sm" variant="outline" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />Crear primer proyecto
                </Button>
              </CardContent>
            </Card>
          ) : (
            byCategory.map(({ key, meta, goals: catGoals }) => (
              <div key={key}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  <h3 className={cn("text-sm font-semibold", meta.color)}>{meta.label}</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{catGoals.length}</Badge>
                </div>
                <div className="space-y-2">
                  {catGoals.map(goal => {
                    const isExpanded = expandedId === goal.id;
                    const isDelayed = goal.status === "active" && new Date(goal.endDate + "T00:00:00") < new Date() && goal.progress < 100;
                    const statusMeta = STATUSES[goal.status] ?? STATUSES.active;
                    const tasksDone = goal.tasks.filter(t => t.status === "done").length;
                    const totalTasks = goal.tasks.length;

                    return (
                      <div key={goal.id} className={cn("rounded-xl border p-4 transition-all", isDelayed ? "border-red-200 dark:border-red-800" : "")}>
                        <div className="flex items-start gap-3">
                          <Target className={cn("h-4 w-4 mt-0.5 shrink-0", meta.color)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">{goal.title}</p>
                              <Badge variant={statusMeta.variant as any} className="text-[10px] h-4 px-1.5">{statusMeta.label}</Badge>
                              {isDelayed && <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Atrasado</Badge>}
                              {totalTasks > 0 && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                  {tasksDone}/{totalTasks} tareas
                                </span>
                              )}
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
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteMutation.mutate(goal.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <TaskPanel
                            goal={goal}
                            onTaskChange={() => qc.invalidateQueries({ queryKey: ["strategy-goals"] })}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* Gantt View */}
        <TabsContent value="gantt" className="mt-4">
          {goals.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Sin proyectos para mostrar en el timeline</p>
              </CardContent>
            </Card>
          ) : (
            <GanttView goals={goals} />
          )}
        </TabsContent>
      </Tabs>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle>
            <DialogDescription>
              {editId !== null ? "Actualizá los datos del proyecto." : "Definí un nuevo proyecto con sus fechas de inicio y fin."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre del proyecto</Label>
              <Input className="mt-1" placeholder="Ej: Implementación sistema de facturación" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
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
                <Input type="range" min={0} max={100} value={form.progress}
                  onChange={e => setForm(f => ({ ...f, progress: e.target.value }))} className="mt-1 h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fecha de inicio</Label>
                <Input type="date" className="mt-1" value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Fecha de fin</Label>
                <Input type="date" className="mt-1" value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notas (opcional)</Label>
              <Input className="mt-1" placeholder="Contexto, objetivos, hitos..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={!form.title || !form.startDate || !form.endDate}>
              {editId !== null ? "Guardar cambios" : "Crear proyecto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
