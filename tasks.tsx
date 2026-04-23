/**
 * tasks.tsx — Módulo de tareas con vista Kanban y lista
 *
 * MEJORAS PRINCIPALES vs. original (1952 líneas):
 *
 * 1. KANBAN — Re-renders eliminados durante drag & drop:
 *    PROBLEMA ORIGINAL: dragOverColumn y dragOverTaskId eran useState en el
 *    componente padre (KanbanBoard). Cada movimiento del mouse disparaba
 *    setState → re-render de TODO el board con TODAS las columnas y tarjetas.
 *    SOLUCIÓN: dragState se mueve a useRef. Los estados de "over" solo se
 *    aplican visualmente mediante clases CSS directas en el DOM, no via state.
 *    TaskCard está envuelta en React.memo() con comparación shallow por id,
 *    status y progress — no re-renderiza si el resto del board cambia.
 *
 * 2. credentials:"include" preservado (ya lo tenía via apiFetch helper)
 *
 * 3. isError en queries principales
 *
 * 4. void prefix en invalidateQueries con queryKeys específicos
 */

import { useState, useMemo, useCallback, memo, useRef, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, CheckSquare, Clock, AlertCircle, MoreHorizontal, LayoutList, LayoutGrid,
  User, UserCheck, CheckCheck, XCircle, Archive, ArrowRightLeft, MessageSquare,
  History, ChevronDown, ChevronRight, Loader2, Search, Flag, X, ListChecks, Trash2,
  AlertTriangle,
} from "lucide-react";
import { BASE } from "@/lib/base-url";

// ── apiFetch helper (credentials ya incluido) ──────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(()=>({})) as { error?: string };
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Task = {
  id:number; title:string; description?:string|null; status:string; priority:string;
  progress:number; dueDate?:string|null; userId?:string|null; assignedToUserId?:string|null;
  requiresAcceptance:boolean; rejectionReason?:string|null; initialObservations?:string|null;
  parentTaskId?:number|null; completedAt?:string|null; createdAt:string; updatedAt:string;
  creatorName?:string; assigneeName?:string;
};
type TaskComment      = { id:number; taskId:number; userId:string; content:string; createdAt:string; authorName?:string; };
type TaskHistoryItem  = { id:number; taskId:number; userId:string; action:string; previousValue?:string|null; newValue?:string|null; comment?:string|null; createdAt:string; actorName?:string; };
type AssignableUser   = { id:number; name?:string|null; email:string; };
type CurrentUser      = { id:number; name?:string|null; email:string; role:string; };

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string,{ label:string; cls:string }> = {
  pending:            { label:"Pendiente",         cls:"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  pending_acceptance: { label:"Pend. Aceptación",  cls:"bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800" },
  in_progress:        { label:"En progreso",        cls:"bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  "in-progress":      { label:"En progreso",        cls:"bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  completed:          { label:"Completada",         cls:"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  done:               { label:"Completada",         cls:"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  rejected:           { label:"Rechazada",          cls:"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
  cancelled:          { label:"Cancelada",          cls:"bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
  archived:           { label:"Archivada",          cls:"bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
};
const PRIORITY_MAP: Record<string,{ label:string; cls:string }> = {
  urgent: { label:"Urgente", cls:"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400" },
  high:   { label:"Alta",    cls:"bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400" },
  medium: { label:"Media",   cls:"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400" },
  low:    { label:"Baja",    cls:"bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400" },
};

function sInfo(s:string){ return STATUS_MAP[s] ?? { label:s, cls:"bg-gray-100 text-gray-600 border-gray-200" }; }
function pInfo(p:string){ return PRIORITY_MAP[p] ?? { label:p, cls:"bg-gray-100 text-gray-600 border-gray-200" }; }

function isOverdue(t:Task):boolean { if(!t.dueDate)return false; if(["completed","done","archived","cancelled","rejected"].includes(t.status))return false; return new Date(t.dueDate)<new Date(); }
function isActive(t:Task):boolean  { return !["archived","cancelled","rejected"].includes(t.status); }
function isCompleted(t:Task):boolean { return t.status==="completed"||t.status==="done"; }

function fmtDate(d:string)      { return new Date(d).toLocaleDateString("es-AR",{day:"numeric",month:"short",year:"numeric"}); }
function fmtDateShort(d:string) { return new Date(d).toLocaleDateString("es-AR",{day:"numeric",month:"short"}); }
function fmtDateTime(d:string)  { return new Date(d).toLocaleString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); }
function userName(u:AssignableUser){ return u.name&&u.name.trim()?u.name.trim():u.email; }

type CardFilterKey = "total"|"pending_acceptance"|"in_progress"|"overdue"|"completed"|"rejected";
function applyCardFilter(tasks:Task[], key:CardFilterKey, me:string|null):Task[]{
  switch(key){
    case "total":              return tasks;
    case "pending_acceptance": return tasks.filter(t=>t.status==="pending_acceptance"&&t.assignedToUserId===me);
    case "in_progress":        return tasks.filter(t=>(t.status==="in_progress"||t.status==="in-progress")&&isActive(t));
    case "overdue":            return tasks.filter(t=>isOverdue(t));
    case "completed":          return tasks.filter(t=>isCompleted(t));
    case "rejected":           return tasks.filter(t=>t.status==="rejected");
    default:                   return tasks;
  }
}

// ── Shared badges ─────────────────────────────────────────────────────────────

function StatusBadge({ status }:{ status:string }) {
  const { label, cls } = sInfo(status);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}
function PriorityBadge({ priority }:{ priority:string }) {
  const { label, cls } = pInfo(priority);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}
function ProgressBar({ value, className="" }:{ value:number; className?:string }) {
  const pct = Math.min(100,Math.max(0,value));
  const color = pct===100?"bg-emerald-500":pct>=70?"bg-blue-500":pct>=30?"bg-amber-500":"bg-slate-300";
  return(
    <div className={`w-full bg-muted rounded-full overflow-hidden ${className}`} style={{height:6}}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{width:`${pct}%`}}/>
    </div>
  );
}

// ── API call wrappers ─────────────────────────────────────────────────────────

const fetchTasks         = () => apiFetch<Task[]>("/api/tasks?view=all");
const fetchCurrentUser   = () => apiFetch<CurrentUser>("/api/users/me");
const fetchAssignableUsers= () => apiFetch<AssignableUser[]>("/api/users/assignable");
const fetchComments      = (id:number) => apiFetch<TaskComment[]>(`/api/tasks/${id}/comments`);
const fetchHistory       = (id:number) => apiFetch<TaskHistoryItem[]>(`/api/tasks/${id}/history`);
const fetchSubtasks      = (id:number) => apiFetch<Task[]>(`/api/tasks/${id}/subtasks`);

// ── TaskCard — memo para evitar re-renders durante drag ────────────────────────
// El original no tenía memo(). Cada setState del drag re-renderizaba TODAS las
// tarjetas de todas las columnas. Con memo() y comparación por id+status+progress,
// solo se re-renderiza la tarjeta afectada.

const TaskCard = memo(function TaskCard({
  task, users, currentUser, onRefresh, onOpenDetail,
}: {
  task: Task;
  users: AssignableUser[];
  currentUser: CurrentUser | null;
  onRefresh: () => void;
  onOpenDetail: (t: Task) => void;
}) {
  const { toast } = useToast();
  const overdue = isOverdue(task);

  return (
    <div
      draggable
      data-task-id={task.id}
      data-task-status={task.status}
      className={`
        bg-card border rounded-lg p-3 cursor-grab active:cursor-grabbing
        hover:shadow-sm transition-shadow select-none
        ${overdue ? "border-red-300/60 dark:border-red-800/60" : "border-border/60"}
      `}
      onClick={() => onOpenDetail(task)}
    >
      {/* Priority dot + title */}
      <div className="flex items-start gap-2 mb-2">
        <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
          task.priority==="urgent"?"bg-red-500":task.priority==="high"?"bg-orange-500":task.priority==="medium"?"bg-amber-400":"bg-slate-300"
        }`}/>
        <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{task.title}</p>
      </div>
      {/* Progress */}
      {task.progress > 0 && (
        <div className="mb-2">
          <ProgressBar value={task.progress} className="h-1"/>
        </div>
      )}
      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1 flex-wrap">
          {overdue && task.dueDate && (
            <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">
              Vence {fmtDateShort(task.dueDate)}
            </span>
          )}
          {!overdue && task.dueDate && (
            <span className="text-[10px] text-muted-foreground">{fmtDateShort(task.dueDate)}</span>
          )}
        </div>
        {task.assigneeName && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
            <UserCheck className="h-2.5 w-2.5"/>
            {task.assigneeName.split(" ")[0]}
          </span>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  // Memo comparison: solo re-renderiza si cambia contenido relevante
  prev.task.id        === next.task.id &&
  prev.task.status    === next.task.status &&
  prev.task.progress  === next.task.progress &&
  prev.task.title     === next.task.title &&
  prev.task.dueDate   === next.task.dueDate &&
  prev.task.assigneeName === next.task.assigneeName &&
  prev.task.priority  === next.task.priority
);

// ── KanbanColumn ──────────────────────────────────────────────────────────────
// dragState en useRef — no causa re-renders durante el drag

const KANBAN_COLUMNS: { id:string; label:string; color:string }[] = [
  { id:"pending",    label:"Pendiente",   color:"text-amber-600" },
  { id:"in_progress",label:"En progreso", color:"text-blue-600" },
  { id:"completed",  label:"Completada",  color:"text-emerald-600" },
];

function KanbanBoard({
  tasks, users, currentUser, onRefresh, onOpenDetail,
}: {
  tasks: Task[];
  users: AssignableUser[];
  currentUser: CurrentUser | null;
  onRefresh: () => void;
  onOpenDetail: (t:Task) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // dragState en useRef — clave para evitar re-renders
  // El original tenía useState que re-renderizaba el board completo en cada
  // dragover. Con useRef, el componente NO re-renderiza durante el drag.
  // La retroalimentación visual se hace modificando clases CSS directamente.
  const dragState = useRef<{
    taskId: number | null;
    fromStatus: string | null;
    overCol: HTMLElement | null;
  }>({ taskId:null, fromStatus:null, overCol:null });

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const taskId     = e.currentTarget.dataset["taskId"];
    const taskStatus = e.currentTarget.dataset["taskStatus"];
    if (!taskId) return;
    dragState.current.taskId     = parseInt(taskId);
    dragState.current.fromStatus = taskStatus ?? null;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const col = e.currentTarget;
    if (dragState.current.overCol && dragState.current.overCol !== col) {
      dragState.current.overCol.classList.remove("ring-2","ring-primary/40","bg-primary/5");
    }
    col.classList.add("ring-2","ring-primary/40","bg-primary/5");
    dragState.current.overCol = col;
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const col = e.currentTarget;
    // Solo limpiar si realmente salió del column (no de un hijo)
    if (!col.contains(e.relatedTarget as Node)) {
      col.classList.remove("ring-2","ring-primary/40","bg-primary/5");
      if (dragState.current.overCol === col) dragState.current.overCol = null;
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>, newStatus: string) => {
    e.preventDefault();
    const col = e.currentTarget;
    col.classList.remove("ring-2","ring-primary/40","bg-primary/5");
    dragState.current.overCol = null;

    const { taskId, fromStatus } = dragState.current;
    dragState.current.taskId = null;
    dragState.current.fromStatus = null;

    if (!taskId || fromStatus === newStatus) return;

    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      void qc.invalidateQueries({ queryKey:["tasks"] });
    } catch (err) {
      toast({ title:"Error al mover tarea", description:(err as Error).message, variant:"destructive" });
    }
  }, [qc, toast]);

  const handleDragEnd = useCallback(() => {
    // Limpiar clases visuales si drag terminó sin drop
    if (dragState.current.overCol) {
      dragState.current.overCol.classList.remove("ring-2","ring-primary/40","bg-primary/5");
      dragState.current.overCol = null;
    }
    dragState.current.taskId = null;
    dragState.current.fromStatus = null;
  }, []);

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of KANBAN_COLUMNS) map[col.id] = [];
    for (const t of tasks) {
      const key = t.status === "in-progress" ? "in_progress"
        : isCompleted(t) ? "completed"
        : isActive(t) ? t.status
        : null;
      if (key && map[key]) map[key].push(t);
    }
    return map;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 min-h-[400px]">
      {KANBAN_COLUMNS.map(col => {
        const colTasks = byStatus[col.id] ?? [];
        return (
          <div key={col.id}
            className="flex flex-col gap-2 p-3 rounded-xl bg-muted/30 border border-border/40 min-h-[200px] transition-colors"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={e => void handleDrop(e, col.id)}
          >
            <div className="flex items-center justify-between mb-1">
              <p className={`text-xs font-semibold uppercase tracking-wide ${col.color}`}>{col.label}</p>
              <span className="text-[10px] text-muted-foreground">{colTasks.length}</span>
            </div>
            {colTasks.map(task => (
              <div key={task.id} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <TaskCard
                  task={task}
                  users={users}
                  currentUser={currentUser}
                  onRefresh={onRefresh}
                  onOpenDetail={onOpenDetail}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Task Detail Sheet ──────────────────────────────────────────────────────────

function TaskDetailSheet({ task, open, onClose, users, currentUser, onRefresh }: {
  task: Task | null; open:boolean; onClose:()=>void;
  users: AssignableUser[]; currentUser: CurrentUser|null; onRefresh:()=>void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"detail"|"comments"|"history">("detail");
  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  const { data:comments=[], isLoading:commentsLoading } = useQuery<TaskComment[]>({
    queryKey: ["task-comments", task?.id],
    queryFn:  () => fetchComments(task!.id),
    enabled:  open && !!task && activeTab === "comments",
    staleTime: 30_000,
  });
  const { data:history=[], isLoading:historyLoading } = useQuery<TaskHistoryItem[]>({
    queryKey: ["task-history", task?.id],
    queryFn:  () => fetchHistory(task!.id),
    enabled:  open && !!task && activeTab === "history",
    staleTime: 30_000,
  });

  const handleSendComment = async () => {
    if (!newComment.trim() || !task) return;
    setSendingComment(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/comments`, {
        method: "POST", body: JSON.stringify({ content: newComment.trim() }),
      });
      void qc.invalidateQueries({ queryKey:["task-comments", task.id] });
      setNewComment("");
    } catch (err) {
      toast({ title:"Error al enviar comentario", variant:"destructive" });
    } finally { setSendingComment(false); }
  };

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={v=>!v&&onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-left leading-snug pr-8">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <StatusBadge status={task.status}/>
              <PriorityBadge priority={task.priority}/>
              {task.dueDate && (
                <span className={`text-xs ${isOverdue(task)?"text-red-600":"text-muted-foreground"}`}>
                  Vence {fmtDate(task.dueDate)}
                </span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={v=>setActiveTab(v as any)}>
          <TabsList className="mb-4">
            <TabsTrigger value="detail">Detalle</TabsTrigger>
            <TabsTrigger value="comments">Comentarios</TabsTrigger>
            <TabsTrigger value="history">Historial</TabsTrigger>
          </TabsList>

          <TabsContent value="detail" className="space-y-4">
            {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Progreso</Label>
              <div className="flex items-center gap-3">
                <ProgressBar value={task.progress} className="flex-1"/>
                <span className="text-sm font-medium tabular-nums">{task.progress}%</span>
              </div>
            </div>
            {task.assigneeName && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Asignado a</Label>
                <p className="text-sm flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5 text-muted-foreground"/>{task.assigneeName}</p>
              </div>
            )}
            {task.creatorName && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Creador</Label>
                <p className="text-sm">{task.creatorName}</p>
              </div>
            )}
            {task.initialObservations && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Observaciones iniciales</Label>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.initialObservations}</p>
              </div>
            )}
            {task.rejectionReason && (
              <div className="space-y-1 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <Label className="text-xs text-red-600 uppercase tracking-wide">Razón de rechazo</Label>
                <p className="text-sm text-red-700 dark:text-red-300">{task.rejectionReason}</p>
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Creada: {fmtDateTime(task.createdAt)}</p>
              {task.completedAt && <p>Completada: {fmtDateTime(task.completedAt)}</p>}
            </div>
          </TabsContent>

          <TabsContent value="comments" className="space-y-3">
            {commentsLoading ? (
              <div className="space-y-2">{[1,2].map(i=><Skeleton key={i} className="h-16 rounded-lg"/>)}</div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin comentarios aún</p>
            ) : (
              <div className="space-y-3">
                {comments.map(c=>(
                  <div key={c.id} className="flex gap-2 text-sm">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-semibold text-primary">
                      {(c.authorName ?? c.userId).slice(0,1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs">{c.authorName ?? "Usuario"}</p>
                      <p className="text-muted-foreground whitespace-pre-wrap">{c.content}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(c.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t">
              <Textarea
                placeholder="Escribí un comentario..."
                value={newComment} onChange={e=>setNewComment(e.target.value)}
                className="flex-1 min-h-[60px] text-sm resize-none"
                onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)void handleSendComment();}}
              />
              <Button size="sm" onClick={()=>void handleSendComment()} disabled={sendingComment||!newComment.trim()}>
                {sendingComment?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:"Enviar"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-2">
            {historyLoading ? (
              <div className="space-y-2">{[1,2,3].map(i=><Skeleton key={i} className="h-10 rounded"/>)}</div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin historial</p>
            ) : (
              <div className="space-y-2">
                {history.map(h=>(
                  <div key={h.id} className="flex items-start gap-2 text-xs">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{h.actorName ?? "Sistema"} · <span className="text-muted-foreground font-normal">{h.action}</span></p>
                      {h.previousValue && h.newValue && (
                        <p className="text-muted-foreground">{h.previousValue} → {h.newValue}</p>
                      )}
                      {h.comment && <p className="text-muted-foreground italic">"{h.comment}"</p>}
                      <p className="text-[10px] text-muted-foreground">{fmtDateTime(h.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ── New Task Modal ─────────────────────────────────────────────────────────────

function NewTaskModal({ open, onClose, users, currentUserId, onCreated }: {
  open:boolean; onClose:()=>void;
  users:AssignableUser[]; currentUserId:number; onCreated:()=>void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title:"", description:"", priority:"medium", dueDate:"",
    assignedToUserId:"", requiresAcceptance:false, initialObservations:"",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title:"El título es obligatorio", variant:"destructive" }); return; }
    setSaving(true);
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          assignedToUserId: form.assignedToUserId || null,
          dueDate: form.dueDate || null,
        }),
      });
      onCreated();
      onClose();
      setForm({ title:"", description:"", priority:"medium", dueDate:"", assignedToUserId:"", requiresAcceptance:false, initialObservations:"" });
    } catch (err) {
      toast({ title:"Error al crear tarea", description:(err as Error).message, variant:"destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>Completá los datos para crear la tarea.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Título *</Label>
            <Input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="¿Qué hay que hacer?"/>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Descripción</Label>
            <Textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={3} className="resize-none text-sm"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Prioridad</Label>
              <Select value={form.priority} onValueChange={v=>setForm(f=>({...f,priority:v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_MAP).map(([k,m])=><SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Fecha límite</Label>
              <Input type="date" value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} className="h-9 text-sm"/>
            </div>
          </div>
          {users.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">Asignar a</Label>
              <Select value={form.assignedToUserId||"_none"} onValueChange={v=>setForm(f=>({...f,assignedToUserId:v==="_none"?"":v}))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin asignar"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none"><span className="italic text-muted-foreground">Sin asignar</span></SelectItem>
                  {users.map(u=><SelectItem key={u.id} value={String(u.id)}>{userName(u)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.assignedToUserId && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="req-acc" checked={form.requiresAcceptance}
                onChange={e=>setForm(f=>({...f,requiresAcceptance:e.target.checked}))} className="h-3.5 w-3.5"/>
              <label htmlFor="req-acc" className="text-xs cursor-pointer">Requiere aceptación del asignado</label>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Observaciones iniciales</Label>
            <Textarea value={form.initialObservations} onChange={e=>setForm(f=>({...f,initialObservations:e.target.value}))} rows={2} className="resize-none text-sm" placeholder="Contexto adicional..."/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={()=>void handleSave()} disabled={saving}>
            {saving?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:null}Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [viewMode,     setViewMode]     = useState<"list"|"kanban">("kanban");
  const [newTaskOpen,  setNewTaskOpen]  = useState(false);
  const [detailTask,   setDetailTask]   = useState<Task|null>(null);
  const [search,       setSearch]       = useState("");
  const [cardFilter,   setCardFilter]   = useState<CardFilterKey>("total");

  const { data:tasks=[],     isLoading:tasksLoading,   isError:tasksError }    = useQuery<Task[]>({    queryKey:["tasks"],            queryFn:fetchTasks });
  const { data:currentUser               }                                       = useQuery<CurrentUser>({queryKey:["current-user"],     queryFn:fetchCurrentUser, staleTime:10*60_000 });
  const { data:users=[],                  isError:usersError  }                 = useQuery<AssignableUser[]>({ queryKey:["assignable-users"],queryFn:fetchAssignableUsers, staleTime:5*60_000 });

  const me = currentUser ? String(currentUser.id) : null;

  const onRefresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey:["tasks"] });
  }, [qc]);

  // Filtering
  const filtered = useMemo(() => {
    let items = applyCardFilter(tasks, cardFilter, me);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
    }
    return [...items].sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  }, [tasks, cardFilter, me, search]);

  // KPI counts
  const counts = useMemo(() => ({
    total:              tasks.length,
    pending_acceptance: tasks.filter(t=>t.status==="pending_acceptance"&&t.assignedToUserId===me).length,
    in_progress:        tasks.filter(t=>(t.status==="in_progress"||t.status==="in-progress")&&isActive(t)).length,
    overdue:            tasks.filter(t=>isOverdue(t)).length,
    completed:          tasks.filter(t=>isCompleted(t)).length,
    rejected:           tasks.filter(t=>t.status==="rejected").length,
  }), [tasks, me]);

  // ── Loading / Error ────────────────────────────────────────────────────────

  if (tasksLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-48"/>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{[...Array(6)].map((_,i)=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      <div className="grid grid-cols-3 gap-4">{[...Array(3)].map((_,i)=><Skeleton key={i} className="h-64 rounded-xl"/>)}</div>
    </div>
  );

  if (tasksError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      Error al cargar las tareas. Intentá actualizar la página.
    </div>
  );

  const KPI_DEFS: { key:CardFilterKey; label:string; color:string; bg:string }[] = [
    { key:"total",              label:"Total",            color:"text-foreground",                    bg:"bg-muted/60" },
    { key:"pending_acceptance", label:"Pend. Aceptación", color:"text-orange-600 dark:text-orange-400",bg:"bg-orange-50 dark:bg-orange-900/20" },
    { key:"in_progress",        label:"En progreso",      color:"text-blue-600 dark:text-blue-400",   bg:"bg-blue-50 dark:bg-blue-900/20" },
    { key:"overdue",            label:"Vencidas",         color:"text-red-600 dark:text-red-400",     bg:"bg-red-50 dark:bg-red-900/20" },
    { key:"completed",          label:"Completadas",      color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-900/20" },
    { key:"rejected",           label:"Rechazadas",       color:"text-gray-500",                      bg:"bg-gray-50 dark:bg-gray-900/20" },
  ];

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Gestión de tareas del estudio</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode("kanban")} className={`px-2.5 py-1.5 transition-colors ${viewMode==="kanban"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="h-3.5 w-3.5"/>
            </button>
            <button onClick={()=>setViewMode("list")} className={`px-2.5 py-1.5 transition-colors border-l ${viewMode==="list"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
              <LayoutList className="h-3.5 w-3.5"/>
            </button>
          </div>
          <Button size="sm" onClick={()=>setNewTaskOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5"/>Nueva tarea
          </Button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {KPI_DEFS.map(kpi=>{
          const isActive = cardFilter === kpi.key;
          const count    = counts[kpi.key];
          return(
            <button key={kpi.key}
              onClick={()=>setCardFilter(isActive?"total":kpi.key)}
              className={`rounded-xl p-3 text-center transition-all hover:scale-[1.02] hover:shadow-md ${kpi.bg} ${isActive?"ring-2 ring-primary/40":""}`}>
              <p className={`text-2xl font-bold tabular-nums ${kpi.color}`}>{count}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{kpi.label}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar tareas..." className="pl-9 h-9"/>
        {search && <button onClick={()=>setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5"/></button>}
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">{filtered.length} tarea{filtered.length!==1?"s":""}{cardFilter!=="total"||search?" (filtrado)":""}</p>

      {/* Main content */}
      {viewMode === "kanban" ? (
        <KanbanBoard
          tasks={filtered}
          users={users}
          currentUser={currentUser ?? null}
          onRefresh={onRefresh}
          onOpenDetail={setDetailTask}
        />
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckSquare className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">{search?"Sin resultados":"Sin tareas"}</p>
            </div>
          ) : filtered.map(task => {
            const overdue = isOverdue(task);
            return(
              <div key={task.id}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer hover:bg-muted/30 transition-colors ${overdue?"border-red-300/60 dark:border-red-800/60":""}`}
                onClick={()=>setDetailTask(task)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={task.status}/>
                    <PriorityBadge priority={task.priority}/>
                    {task.dueDate && <span className={`text-[10px] ${overdue?"text-red-600":"text-muted-foreground"}`}>{fmtDate(task.dueDate)}</span>}
                  </div>
                </div>
                {task.progress > 0 && (
                  <div className="w-20 shrink-0">
                    <ProgressBar value={task.progress}/>
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5">{task.progress}%</p>
                  </div>
                )}
                {task.assigneeName && (
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:flex items-center gap-1">
                    <UserCheck className="h-3 w-3"/>{task.assigneeName.split(" ")[0]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <NewTaskModal
        open={newTaskOpen} onClose={()=>setNewTaskOpen(false)}
        users={users} currentUserId={currentUser?.id ?? 0}
        onCreated={()=>{ void qc.invalidateQueries({queryKey:["tasks"]}); setNewTaskOpen(false); }}
      />

      <TaskDetailSheet
        task={detailTask} open={!!detailTask} onClose={()=>setDetailTask(null)}
        users={users} currentUser={currentUser ?? null} onRefresh={onRefresh}
      />
    </div>
  );
}
