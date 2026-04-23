/**
 * goals.tsx — Objetivos diarios (checklist)
 *
 * MEJORAS vs. original:
 *  1. credentials:"include" en todas las queries y mutations
 *  2. isError en query principal
 *  3. invalidateQueries con queryKey específico (no invalida todo)
 *  4. void prefix en invalidateQueries
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  CheckCircle2, Circle, Plus, Trash2, ChevronLeft, ChevronRight,
  BarChart2, Target, Calendar, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BASE } from "@/lib/base-url";

interface DailyGoal {
  id: number; title: string; date: string;
  priority: string; isDone: boolean; orderIndex: number;
}
interface HistoryDay { date: string; total: number; done: number; completion: number }

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateLabel(str: string) {
  const [y,m,d] = str.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" });
}

const PRIORITY_META: Record<string, { label:string; color:string; dot:string }> = {
  critical: { label:"Crítica", color:"text-red-600 dark:text-red-400",      dot:"bg-red-500" },
  high:     { label:"Alta",    color:"text-amber-600 dark:text-amber-400",  dot:"bg-amber-500" },
  medium:   { label:"Media",   color:"text-blue-600 dark:text-blue-400",    dot:"bg-blue-400" },
  low:      { label:"Baja",    color:"text-muted-foreground",               dot:"bg-muted-foreground/40" },
};

// Helper fetch con credentials
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const b = await res.json().catch(()=>({})) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function GoalsPage() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [newTitle,    setNewTitle]    = useState("");
  const [newPriority, setNewPriority] = useState("high");
  const inputRef = useRef<HTMLInputElement>(null);

  const isToday = selectedDate === toDateStr(new Date());

  function shiftDate(n: number) {
    const [y,m,d] = selectedDate.split("-").map(Number);
    const date = new Date(y, m-1, d);
    date.setDate(date.getDate() + n);
    setSelectedDate(toDateStr(date));
  }

  // ── Queries con credentials ──────────────────────────────────────────────

  const { data: goals = [], isLoading, isError } = useQuery<DailyGoal[]>({
    queryKey: ["daily-goals", selectedDate],
    queryFn: () => apiFetch<DailyGoal[]>(`/api/daily-goals?date=${selectedDate}`),
    staleTime: 30_000,
    enabled: !!isSignedIn,
  });

  const { data: history = [] } = useQuery<HistoryDay[]>({
    queryKey: ["daily-goals-history"],
    queryFn: () => apiFetch<HistoryDay[]>("/api/daily-goals/history"),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  // ── Mutations con credentials ────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: { title:string; priority:string; date:string; orderIndex:number }) =>
      apiFetch("/api/daily-goals", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Solo invalida la query de goals del día, no history
      void qc.invalidateQueries({ queryKey:["daily-goals", selectedDate] });
      setNewTitle("");
      inputRef.current?.focus();
    },
    onError: () => toast({ title:"Error al agregar objetivo", variant:"destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isDone }: { id:number; isDone:boolean }) =>
      apiFetch(`/api/daily-goals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDone }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["daily-goals", selectedDate] });
      // También invalida history porque el % de completado cambia
      void qc.invalidateQueries({ queryKey:["daily-goals-history"] });
    },
    onError: () => toast({ title:"Error al actualizar", variant:"destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/daily-goals/${id}`, { method:"DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["daily-goals", selectedDate] });
    },
    onError: () => toast({ title:"Error al eliminar", variant:"destructive" }),
  });

  function addGoal() {
    if (!newTitle.trim()) return;
    createMutation.mutate({ title:newTitle.trim(), priority:newPriority, date:selectedDate, orderIndex:goals.length });
  }

  const total      = goals.length;
  const done       = goals.filter(g => g.isDone).length;
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;

  const priorityOrder: Record<string,number> = { critical:0, high:1, medium:2, low:3 };
  const sorted = [...goals].sort((a,b) => {
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
    return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
  });

  // Last 14 days for history chart
  const last14 = history.slice(-14);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Objetivos del día</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Checklist diario de ejecución</p>
        </div>
      </div>

      {/* Date navigator */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>shiftDate(-1)}>
          <ChevronLeft className="h-4 w-4"/>
        </Button>
        <div className="flex-1 text-center">
          <span className="text-sm font-semibold capitalize">{formatDateLabel(selectedDate)}</span>
          {isToday && <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">Hoy</Badge>}
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>shiftDate(1)} disabled={isToday}>
          <ChevronRight className="h-4 w-4"/>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Progress */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-muted-foreground"/>
                  <span className="text-sm font-medium">{done} de {total} completados</span>
                </div>
                <span className={cn("text-sm font-bold",
                  completion===100?"text-emerald-600 dark:text-emerald-400":
                  completion>=50 ?"text-amber-600 dark:text-amber-400":
                  "text-muted-foreground"
                )}>{completion}%</span>
              </div>
              <Progress value={completion} className="h-2"/>
            </CardContent>
          </Card>

          {/* Add + list */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-2 mb-4">
                <Input
                  ref={inputRef}
                  placeholder="Nuevo objetivo..."
                  value={newTitle}
                  onChange={e=>setNewTitle(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addGoal()}
                  className="flex-1"
                />
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger className="w-[110px]"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_META).map(([k,m])=>(
                      <SelectItem key={k} value={k}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addGoal} disabled={!newTitle.trim()||createMutation.isPending}>
                  <Plus className="h-4 w-4"/>
                </Button>
              </div>

              {/* Error state */}
              {isError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-3">
                  <AlertTriangle className="h-4 w-4 shrink-0"/>
                  Error al cargar los objetivos del día.
                </div>
              )}

              {isLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i=><Skeleton key={i} className="h-12 rounded-lg"/>)}
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Circle className="h-10 w-10 text-muted-foreground/30"/>
                  <p className="text-sm font-medium text-muted-foreground">
                    {isToday?"Sin objetivos para hoy":"Sin objetivos para este día"}
                  </p>
                  {isToday && (
                    <p className="text-xs text-muted-foreground">
                      Agregá hasta 3 prioridades clave para mantener el foco
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sorted.map(goal => {
                    const meta = PRIORITY_META[goal.priority] ?? PRIORITY_META.medium!;
                    return (
                      <div key={goal.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all group",
                          goal.isDone
                            ? "bg-muted/30 border-transparent opacity-60"
                            : "hover:bg-muted/50 border-transparent hover:border-border"
                        )}>
                        <button
                          onClick={()=>toggleMutation.mutate({ id:goal.id, isDone:!goal.isDone })}
                          className="shrink-0 transition-colors"
                        >
                          {goal.isDone
                            ? <CheckCircle2 className="h-5 w-5 text-emerald-500"/>
                            : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary"/>}
                        </button>
                        <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", meta.dot)}/>
                        <span className={cn("flex-1 text-sm",
                          goal.isDone?"line-through text-muted-foreground":"font-medium"
                        )}>
                          {goal.title}
                        </span>
                        <span className={cn("text-xs shrink-0 hidden group-hover:inline", meta.color)}>
                          {meta.label}
                        </span>
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={()=>deleteMutation.mutate(goal.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3"/>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* History panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground"/>
                Últimos 14 días
              </CardTitle>
            </CardHeader>
            <CardContent>
              {last14.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sin historial disponible</p>
              ) : (
                <div className="space-y-2">
                  {last14.map(day => (
                    <button
                      key={day.date}
                      onClick={() => setSelectedDate(day.date)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors hover:bg-muted/50 text-left",
                        selectedDate === day.date && "bg-muted"
                      )}
                    >
                      <div className="w-16 shrink-0">
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(day.date + "T00:00:00").toLocaleDateString("es-AR", { day:"numeric", month:"short" })}
                        </p>
                      </div>
                      <div className="flex-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              day.completion === 100 ? "bg-emerald-500" :
                              day.completion >= 50  ? "bg-amber-500" :
                              "bg-slate-400"
                            )}
                            style={{ width:`${day.completion}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
                        {day.completion}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground"/>
                Estadísticas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const avg = history.length
                  ? Math.round(history.reduce((s,d)=>s+d.completion,0)/history.length)
                  : 0;
                const streak = (() => {
                  let s = 0;
                  for (let i = history.length-1; i >= 0; i--) {
                    if ((history[i]?.completion ?? 0) === 100) s++;
                    else break;
                  }
                  return s;
                })();
                return (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Promedio completado</span>
                      <span className="font-semibold">{avg}%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Racha actual</span>
                      <span className="font-semibold">{streak} {streak===1?"día":"días"} 🔥</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Días registrados</span>
                      <span className="font-semibold">{history.length}</span>
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
