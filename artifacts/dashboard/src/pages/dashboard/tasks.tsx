import { useState, useMemo } from "react";
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
  History, ChevronDown, Loader2, Search, Flag, X, ListChecks, Trash2,
} from "lucide-react";

import { BASE } from "@/lib/base-url";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  progress: number;
  dueDate?: string | null;
  userId?: string | null;
  assignedToUserId?: string | null;
  requiresAcceptance: boolean;
  rejectionReason?: string | null;
  initialObservations?: string | null;
  parentTaskId?: number | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  creatorName?: string;
  assigneeName?: string;
};

type TaskComment = {
  id: number;
  taskId: number;
  userId: string;
  content: string;
  createdAt: string;
  authorName?: string;
};

type TaskHistoryItem = {
  id: number;
  taskId: number;
  userId: string;
  action: string;
  previousValue?: string | null;
  newValue?: string | null;
  comment?: string | null;
  createdAt: string;
  actorName?: string;
};

type AssignableUser = {
  id: number;
  name?: string | null;
  email: string;
};

type CurrentUser = {
  id: number;
  name?: string | null;
  email: string;
  role: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending:            { label: "Pendiente",         cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  pending_acceptance: { label: "Pend. Aceptación",  cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800" },
  in_progress:        { label: "En progreso",       cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  "in-progress":      { label: "En progreso",       cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  completed:          { label: "Completada",        cls: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  done:               { label: "Completada",        cls: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
  rejected:           { label: "Rechazada",         cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
  cancelled:          { label: "Cancelada",         cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
  archived:           { label: "Archivada",         cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
};

const PRIORITY_MAP: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgente", cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400" },
  high:   { label: "Alta",    cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400" },
  medium: { label: "Media",   cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400" },
  low:    { label: "Baja",    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400" },
};

const HISTORY_LABELS: Record<string, string> = {
  created: "Tarea creada", edited: "Tarea editada", status_changed: "Estado cambiado",
  progress_updated: "Avance actualizado", assigned: "Asignada", reassigned: "Reasignada",
  unassigned: "Desasignada",
  accepted: "Aceptada", rejected: "Rechazada", cancelled: "Cancelada",
  archived: "Archivada", completed: "Completada", commented: "Comentario agregado",
};

// Card filter keys and their task filter predicates
type CardFilterKey = "total" | "pending_acceptance" | "in_progress" | "overdue" | "completed" | "rejected";

const CARD_FILTER_LABELS: Record<CardFilterKey, string> = {
  total: "Total",
  pending_acceptance: "Pend. Aceptación",
  in_progress: "En Progreso",
  overdue: "Vencidas",
  completed: "Completadas",
  rejected: "Rechazadas",
};

function applyCardFilter(tasks: Task[], key: CardFilterKey, me: string | null): Task[] {
  switch (key) {
    case "total":              return tasks;
    case "pending_acceptance": return tasks.filter(t => t.status === "pending_acceptance" && t.assignedToUserId === me);
    case "in_progress":        return tasks.filter(t => (t.status === "in_progress" || t.status === "in-progress") && isActive(t));
    case "overdue":            return tasks.filter(t => isOverdue(t));
    case "completed":          return tasks.filter(t => isCompleted(t));
    case "rejected":           return tasks.filter(t => t.status === "rejected");
    default:                   return tasks;
  }
}

function sInfo(s: string) { return STATUS_MAP[s] ?? { label: s, cls: "bg-gray-100 text-gray-600 border-gray-200" }; }
function pInfo(p: string) { return PRIORITY_MAP[p] ?? { label: p, cls: "bg-gray-100 text-gray-600 border-gray-200" }; }

function isOverdue(t: Task): boolean {
  if (!t.dueDate) return false;
  if (["completed", "done", "archived", "cancelled", "rejected"].includes(t.status)) return false;
  return new Date(t.dueDate) < new Date();
}

function isActive(t: Task): boolean {
  return !["archived", "cancelled", "rejected"].includes(t.status);
}

function isCompleted(t: Task): boolean {
  return t.status === "completed" || t.status === "done";
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function userName(u: AssignableUser) {
  return u.name && u.name.trim() ? u.name.trim() : u.email;
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { label, cls } = sInfo(status);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const { label, cls } = pInfo(priority);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct === 100 ? "bg-emerald-500" : pct >= 70 ? "bg-blue-500" : pct >= 30 ? "bg-amber-500" : "bg-slate-300";
  return (
    <div className={`w-full bg-muted rounded-full overflow-hidden ${className}`} style={{ height: 6 }}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── API calls ─────────────────────────────────────────────────────────────────

const fetchTasks = () => apiFetch<Task[]>("/api/tasks?view=all");
const fetchCurrentUser = () => apiFetch<CurrentUser>("/api/users/me");
const fetchAssignableUsers = () => apiFetch<AssignableUser[]>("/api/users/assignable");
const fetchComments = (id: number) => apiFetch<TaskComment[]>(`/api/tasks/${id}/comments`);
const fetchHistory = (id: number) => apiFetch<TaskHistoryItem[]>(`/api/tasks/${id}/history`);
const fetchSubtasks = (id: number) => apiFetch<Task[]>(`/api/tasks/${id}/subtasks`);

// ── Assignee Popover ──────────────────────────────────────────────────────────
// Inline, clickable assignee cell — shows a popover to assign, reassign or
// remove the assignee without opening the full ReassignModal.

function AssigneePopover({ task, users, currentUser, onRefresh }: {
  task: Task;
  users: AssignableUser[];
  currentUser: CurrentUser | null;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>(task.assignedToUserId ?? "");
  const [reqAcc, setReqAcc] = useState(task.requiresAcceptance ?? false);
  const [loading, setLoading] = useState(false);

  const me = currentUser ? String(currentUser.id) : null;
  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "admin";
  const isCreator = me !== null && task.userId === me;
  const canReassign = isCreator || isAdmin;

  // Reset local state whenever the popover opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setSelectedUser(task.assignedToUserId ?? "");
      setReqAcc(task.requiresAcceptance ?? false);
    }
    setOpen(v);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/reassign`, {
        method: "POST",
        body: JSON.stringify({
          assignedToUserId: selectedUser || null,
          requiresAcceptance: reqAcc,
        }),
      });
      setOpen(false);
      onRefresh();
      const target = users.find(u => String(u.id) === selectedUser);
      toast({ title: target ? `Asignada a ${userName(target)}` : "Asignación eliminada" });
    } catch (e: unknown) {
      toast({ title: "Error al reasignar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally {
      setLoading(false);
    }
  };

  // Non-admins who are not the creator can only view the assignee, not change it
  if (!canReassign) {
    if (task.assigneeName) {
      return (
        <span className="flex items-center gap-1 text-xs">
          <UserCheck className="h-3 w-3 text-muted-foreground shrink-0" />
          {task.assigneeName}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground italic">Sin asignar</span>;
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 text-xs rounded px-1 -mx-1 py-0.5 hover:bg-muted transition-colors group"
          title="Cambiar asignación"
        >
          {task.assigneeName ? (
            <>
              <UserCheck className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="group-hover:underline underline-offset-2">{task.assigneeName}</span>
            </>
          ) : (
            <>
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="italic text-muted-foreground group-hover:text-foreground">Sin asignar</span>
            </>
          )}
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start" side="bottom">
        <div className="space-y-3">
          <p className="text-xs font-semibold">Asignar tarea</p>
          <Select
            value={selectedUser === "" ? "_none" : selectedUser}
            onValueChange={v => setSelectedUser(v === "_none" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">
                <span className="italic text-muted-foreground">Sin asignar</span>
              </SelectItem>
              {users.map(u => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {userName(u)}{u.id === currentUser?.id ? " (Yo)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedUser && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`req-acc-pop-${task.id}`}
                checked={reqAcc}
                onChange={e => setReqAcc(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
              <label htmlFor={`req-acc-pop-${task.id}`} className="text-xs cursor-pointer select-none leading-tight">
                Requiere aceptación del asignado
              </label>
            </div>
          )}

          {task.requiresAcceptance && selectedUser && selectedUser !== task.assignedToUserId && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
              Al asignar a otro usuario con aceptación requerida, la tarea pasará a "Pend. Aceptación".
            </p>
          )}

          <div className="flex items-center gap-2 pt-1 border-t">
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── New Task Modal ────────────────────────────────────────────────────────────

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  users: AssignableUser[];
  currentUserId: number;
  onCreated: () => void;
}

function NewTaskModal({ open, onClose, users, currentUserId, onCreated }: NewTaskModalProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", description: "", priority: "medium", dueDate: "",
    assignedToUserId: "", requiresAcceptance: false, initialObservations: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setForm({ title: "", description: "", priority: "medium", dueDate: "", assignedToUserId: "", requiresAcceptance: false, initialObservations: "" });
    setError("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!form.title.trim()) { setError("El título es obligatorio"); return; }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          priority: form.priority,
          dueDate: form.dueDate || null,
          assignedToUserId: form.assignedToUserId || null,
          requiresAcceptance: form.requiresAcceptance,
          initialObservations: form.initialObservations.trim() || null,
        }),
      });
      toast({ title: "Tarea creada exitosamente" });
      handleClose();
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al crear tarea");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Tarea</DialogTitle>
          <DialogDescription>Completá los datos de la nueva tarea.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input placeholder="Ej: Presentar declaración jurada" value={form.title}
              onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setError(""); }}
              className={error && !form.title.trim() ? "border-destructive" : ""} />
            {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Textarea placeholder="Detalles adicionales..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">🔴 Urgente</SelectItem>
                  <SelectItem value="high">🟠 Alta</SelectItem>
                  <SelectItem value="medium">🟡 Media</SelectItem>
                  <SelectItem value="low">⚪ Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vencimiento</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Asignar a</Label>
            <Select value={form.assignedToUserId}
              onValueChange={v => setForm(f => ({ ...f, assignedToUserId: v === "_none" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin asignar</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {userName(u)} {u.id === currentUserId ? "(Yo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.assignedToUserId && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
              <input type="checkbox" id="req-acceptance" checked={form.requiresAcceptance}
                onChange={e => setForm(f => ({ ...f, requiresAcceptance: e.target.checked }))}
                className="h-4 w-4 rounded" />
              <Label htmlFor="req-acceptance" className="cursor-pointer text-sm font-normal">
                Requiere aceptación del asignado antes de iniciar
              </Label>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Observaciones iniciales</Label>
            <Textarea placeholder="Notas para el asignado..." value={form.initialObservations}
              onChange={e => setForm(f => ({ ...f, initialObservations: e.target.value }))} rows={2} className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : "Crear Tarea"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Progress Modal ────────────────────────────────────────────────────────────

function ProgressModal({ task, onClose, onUpdated }: { task: Task | null; onClose: () => void; onUpdated: () => void }) {
  const { toast } = useToast();
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  if (!task) return null;

  const handle = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/progress`, {
        method: "PATCH",
        body: JSON.stringify({ progress, comment: comment.trim() || null }),
      });
      toast({ title: `Avance actualizado: ${progress}%` });
      onClose();
      onUpdated();
    } catch (e: unknown) {
      toast({ title: "Error al actualizar avance", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Actualizar avance</DialogTitle>
          <DialogDescription className="line-clamp-2">{task.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Porcentaje completado</Label>
              <span className="text-2xl font-bold tabular-nums">{progress}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={progress}
              onChange={e => setProgress(Number(e.target.value))}
              className="w-full accent-primary" />
            <ProgressBar value={progress} className="mt-1" />
          </div>
          <div className="space-y-1.5">
            <Label>Comentario (opcional)</Label>
            <Textarea placeholder="¿Qué avanzaste?" value={comment}
              onChange={e => setComment(e.target.value)} rows={2} className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handle} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({ task, onClose, onRejected }: { task: Task | null; onClose: () => void; onRejected: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  if (!task) return null;

  const handle = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      toast({ title: "Tarea rechazada" });
      onClose();
      onRejected();
    } catch (e: unknown) {
      toast({ title: "Error al rechazar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rechazar tarea</DialogTitle>
          <DialogDescription className="line-clamp-2">{task.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Motivo de rechazo (opcional)</Label>
          <Textarea placeholder="Explicá por qué rechazás esta tarea..." value={reason}
            onChange={e => setReason(e.target.value)} rows={3} className="resize-none" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={handle} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechazar tarea"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reassign Modal ────────────────────────────────────────────────────────────

function ReassignModal({ task, users, currentUserId, onClose, onReassigned }: {
  task: Task | null; users: AssignableUser[]; currentUserId: number; onClose: () => void; onReassigned: () => void;
}) {
  const { toast } = useToast();
  const [assignedTo, setAssignedTo] = useState(task?.assignedToUserId ?? "");
  const [reqAcc, setReqAcc] = useState(task?.requiresAcceptance ?? false);
  const [loading, setLoading] = useState(false);

  if (!task) return null;

  const handle = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/reassign`, {
        method: "POST",
        body: JSON.stringify({
          assignedToUserId: assignedTo || null,
          requiresAcceptance: reqAcc,
        }),
      });
      toast({ title: "Tarea reasignada" });
      onClose();
      onReassigned();
    } catch (e: unknown) {
      toast({ title: "Error al reasignar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reasignar tarea</DialogTitle>
          <DialogDescription className="line-clamp-2">{task.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Asignar a</Label>
            <Select value={assignedTo} onValueChange={v => setAssignedTo(v === "_none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sin asignar</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {userName(u)} {u.id === currentUserId ? "(Yo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {assignedTo && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="req-acc-r" checked={reqAcc}
                onChange={e => setReqAcc(e.target.checked)} className="h-4 w-4 rounded" />
              <Label htmlFor="req-acc-r" className="cursor-pointer text-sm font-normal">
                Requiere aceptación
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handle} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reasignar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Subtasks Section ──────────────────────────────────────────────────────────

function SubtasksSection({
  task, users, canAct,
}: {
  task: Task;
  users: AssignableUser[];
  canAct: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { data: subtasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["task-subtasks", task.id],
    queryFn: () => fetchSubtasks(task.id),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["task-subtasks", task.id] });

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          assignedToUserId: newAssignee === "none" ? null : newAssignee,
        }),
      });
      setNewTitle("");
      setNewAssignee("none");
      setAdding(false);
      refresh();
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setSaving(false); }
  };

  const handleToggle = async (sub: Task) => {
    setTogglingId(sub.id);
    try {
      await apiFetch(`/api/tasks/${task.id}/subtasks/${sub.id}/complete`, { method: "POST" });
      refresh();
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setTogglingId(null); }
  };

  const handleDelete = async (subId: number) => {
    setDeletingId(subId);
    try {
      await apiFetch(`/api/tasks/${task.id}/subtasks/${subId}`, { method: "DELETE" });
      refresh();
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setDeletingId(null); }
  };

  const done = subtasks.filter(s => s.status === "completed" || s.status === "done").length;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Subtareas
          {subtasks.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({done}/{subtasks.length})</span>
          )}
        </h3>
        {canAct && !adding && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Agregar
          </Button>
        )}
      </div>

      {/* Progress bar for subtasks */}
      {subtasks.length > 0 && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${Math.round((done / subtasks.length) * 100)}%` }}
          />
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}

      {/* Subtask list */}
      {subtasks.length > 0 && (
        <div className="space-y-1">
          {subtasks.map(sub => {
            const isDone = sub.status === "completed" || sub.status === "done";
            return (
              <div key={sub.id} className="flex items-center gap-2 group py-1 px-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                <button
                  onClick={() => handleToggle(sub)}
                  disabled={togglingId === sub.id}
                  className="shrink-0 flex items-center justify-center h-4 w-4 rounded border border-muted-foreground/40 hover:border-primary transition-colors"
                  style={{ background: isDone ? "rgb(16 185 129)" : undefined, borderColor: isDone ? "rgb(16 185 129)" : undefined }}
                >
                  {isDone && <CheckCheck className="h-2.5 w-2.5 text-white" />}
                  {togglingId === sub.id && <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />}
                </button>
                <span className={`flex-1 text-xs leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}>
                  {sub.title}
                </span>
                {sub.assigneeName && (
                  <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full shrink-0">
                    {sub.assigneeName}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(sub.id)}
                  disabled={deletingId === sub.id}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {deletingId === sub.id
                    ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    : <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive transition-colors" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add subtask inline form */}
      {adding && (
        <div className="space-y-2 pt-1 pb-0.5 border rounded-lg px-3 py-2.5 bg-muted/30">
          <Input
            autoFocus
            placeholder="Título de la subtarea…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
          />
          <Select value={newAssignee} onValueChange={setNewAssignee}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin asignar</SelectItem>
              {users.map(u => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name ?? u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleAdd} disabled={saving || !newTitle.trim()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && subtasks.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">Sin subtareas. {canAct && "Hacé click en \"Agregar\" para crear una."}</p>
      )}
    </div>
  );
}

// ── Task Detail Sheet ─────────────────────────────────────────────────────────

function TaskDetailSheet({
  task, currentUser, users, onClose, onAction,
}: {
  task: Task | null;
  currentUser: CurrentUser | null;
  users: AssignableUser[];
  onClose: () => void;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const qc = useQueryClient();
  const { data: comments } = useQuery<TaskComment[]>({
    queryKey: ["task-comments", task?.id],
    queryFn: () => fetchComments(task!.id),
    enabled: !!task,
  });
  const { data: history } = useQuery<TaskHistoryItem[]>({
    queryKey: ["task-history", task?.id],
    queryFn: () => fetchHistory(task!.id),
    enabled: !!task,
  });

  if (!task) return null;

  const me = currentUser ? String(currentUser.id) : null;
  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "admin";
  const isCreator = me !== null && task.userId === me;
  const isAssignee = me !== null && task.assignedToUserId === me;
  const canAct = isCreator || isAssignee || isAdmin;

  const doAction = async (action: string, method = "POST") => {
    setActionLoading(action);
    try {
      await apiFetch(`/api/tasks/${task.id}/${action}`, { method });
      toast({ title: `Acción completada` });
      qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
      qc.invalidateQueries({ queryKey: ["task-history", task.id] });
      onAction();
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setActionLoading(null); }
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    setAddingComment(true);
    try {
      await apiFetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: comment.trim() }),
      });
      setComment("");
      qc.invalidateQueries({ queryKey: ["task-comments", task.id] });
      qc.invalidateQueries({ queryKey: ["task-history", task.id] });
    } catch (e: unknown) {
      toast({ title: "Error al comentar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally { setAddingComment(false); }
  };

  const { cls: stCls } = sInfo(task.status);
  const overdue = isOverdue(task);

  return (
    <Sheet open={!!task} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-6 py-4 z-10">
          <SheetHeader className="pb-0">
            <SheetTitle className="text-left text-base font-semibold leading-snug pr-8">{task.title}</SheetTitle>
            <SheetDescription className="text-left">
              <div className="flex flex-wrap gap-1.5 mt-2">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                {overdue && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-red-100 text-red-700 border-red-200">
                    <AlertCircle className="h-2.5 w-2.5 mr-1" />Vencida
                  </span>
                )}
              </div>
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">Avance</span>
              <span className="font-semibold tabular-nums">{task.progress}%</span>
            </div>
            <ProgressBar value={task.progress} />
          </div>

          {/* Description */}
          {task.description && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Descripción</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Initial observations */}
          {task.initialObservations && (
            <div className="space-y-1 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Observaciones iniciales</p>
              <p className="text-sm text-amber-900 dark:text-amber-300 leading-relaxed">{task.initialObservations}</p>
            </div>
          )}

          {/* Rejection reason */}
          {task.rejectionReason && (
            <div className="space-y-1 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">Motivo de rechazo</p>
              <p className="text-sm text-red-900 dark:text-red-300">{task.rejectionReason}</p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Creada por</p>
              <p className="font-medium">{task.creatorName ?? "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Asignada a</p>
              <div className="font-medium">
                <AssigneePopover task={task} users={users} currentUser={currentUser} onRefresh={onAction} />
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Vencimiento</p>
              <p className={`font-medium ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                {task.dueDate ? fmtDate(task.dueDate) : "—"}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Completada el</p>
              <p className="font-medium">{task.completedAt ? fmtDate(task.completedAt) : "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Creada el</p>
              <p className="font-medium">{fmtDate(task.createdAt)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Última actualización</p>
              <p className="font-medium">{fmtDate(task.updatedAt)}</p>
            </div>
          </div>

          {/* Subtasks */}
          <SubtasksSection
            task={task}
            users={users}
            canAct={canAct}
          />

          {/* Action buttons */}
          {canAct && (
            <div className="flex flex-wrap gap-2 pt-1 border-t">
              {task.status === "pending_acceptance" && isAssignee && (
                <>
                  <Button size="sm" onClick={() => doAction("accept")} disabled={!!actionLoading}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                    {actionLoading === "accept" ? "Aceptando..." : "Aceptar"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => doAction("reject")} disabled={!!actionLoading}>
                    <XCircle className="h-3.5 w-3.5 mr-1.5" />Rechazar
                  </Button>
                </>
              )}
              {["in_progress", "in-progress", "pending", "pending_acceptance"].includes(task.status) && canAct && (
                <Button size="sm" variant="outline" onClick={() => doAction("complete")} disabled={!!actionLoading}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1.5" />Completar
                </Button>
              )}
              {isActive(task) && !isCompleted(task) && (isCreator || isAdmin) && (
                <Button size="sm" variant="outline" onClick={() => doAction("cancel")} disabled={!!actionLoading}>
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />Cancelar
                </Button>
              )}
              {(isCreator || isAdmin) && (
                <Button size="sm" variant="outline" onClick={() => doAction("archive")} disabled={!!actionLoading}>
                  <Archive className="h-3.5 w-3.5 mr-1.5" />Archivar
                </Button>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />Comentarios
              {comments && comments.length > 0 && <span className="text-xs text-muted-foreground">({comments.length})</span>}
            </h3>
            {comments && comments.length > 0 ? (
              <div className="space-y-3">
                {comments.map(c => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-semibold text-primary">
                        {(c.authorName ?? c.userId).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 bg-muted/40 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{c.authorName ?? c.userId}</span>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                      </div>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sin comentarios aún.</p>
            )}
            <div className="flex gap-2">
              <Textarea placeholder="Escribí un comentario..." value={comment}
                onChange={e => setComment(e.target.value)} rows={2} className="resize-none text-sm" />
              <Button size="sm" onClick={submitComment} disabled={addingComment || !comment.trim()} className="self-end">
                {addingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
              </Button>
            </div>
          </div>

          {/* History */}
          <div className="space-y-3 border-t pt-4 pb-6">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <History className="h-4 w-4 text-muted-foreground" />Historial
            </h3>
            {history && history.length > 0 ? (
              <div className="relative pl-5 space-y-3">
                <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
                {history.map(h => (
                  <div key={h.id} className="relative flex gap-2.5">
                    <div className="absolute -left-3.5 top-1 h-2.5 w-2.5 rounded-full bg-muted border-2 border-border" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold">{HISTORY_LABELS[h.action] ?? h.action}</span>
                        <span className="text-[10px] text-muted-foreground">por {h.actorName ?? h.userId}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{fmtDateTime(h.createdAt)}</span>
                      </div>
                      {h.comment && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{h.comment}</p>
                      )}
                      {(h.previousValue || h.newValue) && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {h.previousValue && <span className="line-through opacity-60 mr-1">{h.previousValue}</span>}
                          {h.newValue && <span className="text-foreground/70">{h.newValue}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sin historial.</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Task Actions Dropdown ─────────────────────────────────────────────────────

function TaskActions({
  task, currentUser, onDetail, onProgress, onReject, onReassign, onRefresh,
}: {
  task: Task;
  currentUser: CurrentUser | null;
  onDetail: () => void;
  onProgress: () => void;
  onReject: () => void;
  onReassign: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const me = currentUser ? String(currentUser.id) : null;
  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "admin";
  const isCreator = me !== null && task.userId === me;
  const isAssignee = me !== null && task.assignedToUserId === me;

  const doAction = async (action: string, method = "POST") => {
    try {
      await apiFetch(`/api/tasks/${task.id}/${action}`, { method });
      toast({ title: "Acción realizada" });
      onRefresh();
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-sm w-48">
          <DropdownMenuItem onClick={onDetail}>
            <CheckSquare className="h-3.5 w-3.5 mr-2" />Ver detalle
          </DropdownMenuItem>

          {task.status === "pending_acceptance" && isAssignee && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => doAction("accept")} className="text-emerald-600 dark:text-emerald-400">
                <UserCheck className="h-3.5 w-3.5 mr-2" />Aceptar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onReject} className="text-destructive">
                <XCircle className="h-3.5 w-3.5 mr-2" />Rechazar
              </DropdownMenuItem>
            </>
          )}

          {(isCreator || isAssignee || isAdmin) && isActive(task) && !isCompleted(task) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onProgress}>
                <ChevronDown className="h-3.5 w-3.5 mr-2" />Actualizar avance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doAction("complete")}>
                <CheckCheck className="h-3.5 w-3.5 mr-2" />Completar
              </DropdownMenuItem>
            </>
          )}

          {(isCreator || isAdmin) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onReassign}>
                <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />Reasignar
              </DropdownMenuItem>
              {isActive(task) && (
                <DropdownMenuItem onClick={() => setConfirmAction("cancel")} className="text-amber-600 dark:text-amber-400">
                  <XCircle className="h-3.5 w-3.5 mr-2" />Cancelar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setConfirmAction("archive")} className="text-muted-foreground">
                <Archive className="h-3.5 w-3.5 mr-2" />Archivar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmAction("delete")} className="text-destructive">
                <XCircle className="h-3.5 w-3.5 mr-2" />Eliminar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!confirmAction} onOpenChange={v => !v && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "delete" ? "¿Eliminar tarea?" :
               confirmAction === "cancel" ? "¿Cancelar tarea?" : "¿Archivar tarea?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "delete" ? "Esta acción no se puede deshacer. Se eliminará la tarea y todo su historial." :
               confirmAction === "cancel" ? "La tarea pasará al estado Cancelada." : "La tarea pasará al estado Archivada."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction === "delete" ? "bg-destructive hover:bg-destructive/90" : ""}
              onClick={async () => {
                const action = confirmAction!;
                setConfirmAction(null);
                if (action === "delete") {
                  try {
                    await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
                    toast({ title: "Tarea eliminada" });
                    onRefresh();
                  } catch (e: unknown) {
                    toast({ title: "Error al eliminar", variant: "destructive", description: e instanceof Error ? e.message : "" });
                  }
                } else {
                  await doAction(action);
                }
              }}>
              {confirmAction === "delete" ? "Sí, eliminar" :
               confirmAction === "cancel" ? "Sí, cancelar" : "Sí, archivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Task Table ────────────────────────────────────────────────────────────────

function TaskTable({ tasks, currentUser, users, onDetail, onProgress, onReject, onReassign, onRefresh }: {
  tasks: Task[];
  currentUser: CurrentUser | null;
  users: AssignableUser[];
  onDetail: (t: Task) => void;
  onProgress: (t: Task) => void;
  onReject: (t: Task) => void;
  onReassign: (t: Task) => void;
  onRefresh: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <CheckSquare className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">No hay tareas en esta vista.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Estado</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs">Título</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Prioridad</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Creador</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Asignado</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap w-28">Avance</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs whitespace-nowrap">Venc.</th>
            <th className="px-3 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map(task => {
            const overdue = isOverdue(task);
            return (
              <tr key={task.id} className="hover:bg-muted/30 transition-colors group">
                <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={task.status} /></td>
                <td className="px-3 py-2.5">
                  <button onClick={() => onDetail(task)}
                    className="text-left font-medium hover:underline underline-offset-2 line-clamp-1 max-w-xs text-sm">
                    {task.title}
                  </button>
                  {task.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{task.description}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap"><PriorityBadge priority={task.priority} /></td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{task.creatorName ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <AssigneePopover task={task} users={users} currentUser={currentUser} onRefresh={onRefresh} />
                </td>
                <td className="px-3 py-2.5 w-28">
                  <div className="flex items-center gap-1.5">
                    <ProgressBar value={task.progress} className="flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground w-6 text-right">{task.progress}%</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                  {task.dueDate ? (
                    <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                      {fmtDateShort(task.dueDate)}
                      {overdue && " ⚠"}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <TaskActions task={task} currentUser={currentUser}
                    onDetail={() => onDetail(task)} onProgress={() => onProgress(task)}
                    onReject={() => onReject(task)} onReassign={() => onReassign(task)}
                    onRefresh={onRefresh} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Task Cards ────────────────────────────────────────────────────────────────

function TaskCards({ tasks, currentUser, users, onDetail, onProgress, onReject, onReassign, onRefresh }: {
  tasks: Task[];
  currentUser: CurrentUser | null;
  users: AssignableUser[];
  onDetail: (t: Task) => void;
  onProgress: (t: Task) => void;
  onReject: (t: Task) => void;
  onReassign: (t: Task) => void;
  onRefresh: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <CheckSquare className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">No hay tareas en esta vista.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {tasks.map(task => {
        const overdue = isOverdue(task);
        return (
          <Card key={task.id} className={`shadow-none transition-shadow hover:shadow-sm ${
            task.priority === "urgent" ? "border-l-4 border-l-red-500" :
            task.priority === "high" ? "border-l-4 border-l-orange-500" : ""}`}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onDetail(task)}
                  className="text-left text-sm font-semibold leading-snug hover:underline underline-offset-2 flex-1 line-clamp-2">
                  {task.title}
                </button>
                <TaskActions task={task} currentUser={currentUser}
                  onDetail={() => onDetail(task)} onProgress={() => onProgress(task)}
                  onReject={() => onReject(task)} onReassign={() => onReassign(task)}
                  onRefresh={onRefresh} />
              </div>

              {task.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avance</span>
                  <span className="tabular-nums font-medium">{task.progress}%</span>
                </div>
                <ProgressBar value={task.progress} />
              </div>

              <div className="flex items-center justify-between text-xs border-t pt-2">
                <AssigneePopover task={task} users={users} currentUser={currentUser} onRefresh={onRefresh} />
                {task.dueDate && (
                  <div className={`flex items-center gap-0.5 ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    <Clock className="h-3 w-3" />
                    {fmtDateShort(task.dueDate)}
                    {overdue && " ⚠"}
                  </div>
                )}
              </div>

              {task.status === "pending_acceptance" && task.assignedToUserId === String(currentUser?.id) && (
                <div className="flex gap-1.5 pt-1 border-t">
                  <Button size="sm" className="flex-1 h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={async () => {
                      await apiFetch(`/api/tasks/${task.id}/accept`, { method: "POST" });
                      onRefresh();
                    }}>
                    <UserCheck className="h-3 w-3 mr-1" />Aceptar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-xs text-destructive"
                    onClick={() => onReject(task)}>
                    <XCircle className="h-3 w-3 mr-1" />Rechazar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Metric Card (clickable filter) ────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, color, filterKey, activeFilter, onFilterClick }: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  filterKey: CardFilterKey;
  activeFilter: CardFilterKey | null;
  onFilterClick: (key: CardFilterKey) => void;
}) {
  const isActive = activeFilter === filterKey;
  return (
    <Card
      className={`shadow-none cursor-pointer select-none transition-all hover:shadow-sm ${
        isActive
          ? "ring-2 ring-primary border-primary/30"
          : "hover:border-border/80"
      }`}
      onClick={() => onFilterClick(filterKey)}
      role="button"
      aria-pressed={isActive}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            {isActive && (
              <span className="text-[9px] uppercase font-bold tracking-widest text-primary block mb-0.5">
                Filtro activo
              </span>
            )}
            <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{value}</p>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ml-2 ${color} ${isActive ? "ring-2 ring-primary/30" : ""}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");

  // Card filter — null means no card filter applied; otherwise overrides tab filter
  const [cardFilter, setCardFilter] = useState<CardFilterKey | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const [rejectTask, setRejectTask] = useState<Task | null>(null);
  const [reassignTask, setReassignTask] = useState<Task | null>(null);

  const { data: tasks = [], isLoading, error } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
  });
  const { data: currentUser } = useQuery<CurrentUser>({
    queryKey: ["current-user"],
    queryFn: fetchCurrentUser,
  });
  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ["assignable-users"],
    queryFn: fetchAssignableUsers,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task-comments", detailTask?.id] });
    qc.invalidateQueries({ queryKey: ["task-history", detailTask?.id] });
  };

  const me = currentUser ? String(currentUser.id) : null;

  // ── Metrics (always computed from all tasks) ──────────────────────────────
  const metrics = useMemo(() => ({
    total: tasks.length,
    pendingAcceptance: tasks.filter(t => t.status === "pending_acceptance" && t.assignedToUserId === me).length,
    inProgress: tasks.filter(t => (t.status === "in_progress" || t.status === "in-progress") && isActive(t)).length,
    overdue: tasks.filter(t => isOverdue(t)).length,
    completed: tasks.filter(t => isCompleted(t)).length,
    rejected: tasks.filter(t => t.status === "rejected").length,
  }), [tasks, me]);

  // ── Tab filtering ──────────────────────────────────────────────────────────
  const tabTasks = useMemo(() => {
    let list = tasks;
    switch (activeTab) {
      case "created":       list = tasks.filter(t => t.userId === me); break;
      case "assigned":      list = tasks.filter(t => t.assignedToUserId === me); break;
      case "pending_acc":   list = tasks.filter(t => t.status === "pending_acceptance" && t.assignedToUserId === me); break;
      case "completed":     list = tasks.filter(t => isCompleted(t)); break;
      case "archived":      list = tasks.filter(t => !isActive(t) && !isCompleted(t)); break;
      default:              list = tasks.filter(t => isActive(t)); break;
    }
    return list;
  }, [tasks, activeTab, me]);

  // ── Card filter layer ──────────────────────────────────────────────────────
  // When a card filter is active it works on ALL tasks (not just the current
  // tab) so the count displayed on the card always matches the filtered list.
  const cardFilteredTasks = useMemo(() => {
    if (!cardFilter) return tabTasks;
    return applyCardFilter(tasks, cardFilter, me);
  }, [tasks, tabTasks, cardFilter, me]);

  // ── Search + priority filter ───────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let list = cardFilteredTasks;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
    }
    if (filterPriority !== "all") {
      list = list.filter(t => t.priority === filterPriority);
    }
    return list;
  }, [cardFilteredTasks, search, filterPriority]);

  const tabCount = (tab: string) => {
    switch (tab) {
      case "all":         return tasks.filter(t => isActive(t)).length;
      case "created":     return tasks.filter(t => t.userId === me).length;
      case "assigned":    return tasks.filter(t => t.assignedToUserId === me).length;
      case "pending_acc": return tasks.filter(t => t.status === "pending_acceptance" && t.assignedToUserId === me).length;
      case "completed":   return tasks.filter(t => isCompleted(t)).length;
      case "archived":    return tasks.filter(t => !isActive(t) && !isCompleted(t)).length;
      default: return 0;
    }
  };

  const handleCardFilter = (key: CardFilterKey) => {
    // Toggle off if clicking the same card
    setCardFilter(prev => prev === key ? null : key);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Error al cargar las tareas. Intentá recargar la página.
      </div>
    );
  }

  const taskListProps = {
    tasks: filteredTasks,
    currentUser: currentUser ?? null,
    users: assignableUsers,
    onDetail: setDetailTask,
    onProgress: setProgressTask,
    onReject: setRejectTask,
    onReassign: setReassignTask,
    onRefresh: refresh,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {metrics.total} tarea{metrics.total !== 1 ? "s" : ""} en total
            {metrics.pendingAcceptance > 0 && ` · ${metrics.pendingAcceptance} pend. aceptación`}
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />Nueva Tarea
        </Button>
      </div>

      {/* Metric Cards — clickable quick filters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total" value={metrics.total}
          icon={CheckSquare} color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          filterKey="total" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
        <MetricCard
          label="Pend. Aceptación" value={metrics.pendingAcceptance}
          icon={UserCheck} color="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
          filterKey="pending_acceptance" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
        <MetricCard
          label="En Progreso" value={metrics.inProgress}
          icon={Loader2} color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
          filterKey="in_progress" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
        <MetricCard
          label="Vencidas" value={metrics.overdue}
          icon={AlertCircle} color="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
          filterKey="overdue" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
        <MetricCard
          label="Completadas" value={metrics.completed}
          icon={CheckCheck} color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
          filterKey="completed" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
        <MetricCard
          label="Rechazadas" value={metrics.rejected}
          icon={XCircle} color="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          filterKey="rejected" activeFilter={cardFilter} onFilterClick={handleCardFilter}
        />
      </div>

      {/* Active card-filter indicator */}
      {cardFilter && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
            Filtrando: {CARD_FILTER_LABELS[cardFilter]}
            <button
              onClick={() => setCardFilter(null)}
              className="ml-1 hover:text-primary/70 transition-colors"
              aria-label="Quitar filtro"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          <span className="text-muted-foreground">
            {filteredTasks.length} tarea{filteredTasks.length !== 1 ? "s" : ""}
            {(search || filterPriority !== "all") ? " (filtros adicionales activos)" : ""}
          </span>
        </div>
      )}

      {/* Tabs + controls */}
      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); setCardFilter(null); }}>
        <div className="flex items-center gap-3 flex-wrap">
          <TabsList className={`h-9 flex-1 min-w-0 overflow-x-auto justify-start ${cardFilter ? "opacity-60" : ""}`}>
            {[
              { value: "all",         label: "Activas" },
              { value: "created",     label: "Creadas por mí" },
              { value: "assigned",    label: "Asignadas a mí" },
              { value: "pending_acc", label: "Pend. Aceptación" },
              { value: "completed",   label: "Completadas" },
              { value: "archived",    label: "Archivadas" },
            ].map(tab => {
              const count = tabCount(tab.value);
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-1.5 whitespace-nowrap">
                  {tab.label}
                  {count > 0 && (
                    <span className="bg-muted text-muted-foreground text-[10px] px-1.5 rounded-full font-medium">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"} size="icon" className="h-9 w-9"
              onClick={() => setViewMode("table")} title="Vista tabla">
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"} size="icon" className="h-9 w-9"
              onClick={() => setViewMode("cards")} title="Vista tarjetas">
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar tareas..." value={search} onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm pl-8" />
          </div>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <Flag className="h-3 w-3 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Prioridad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las prioridades</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Media</SelectItem>
              <SelectItem value="low">Baja</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tab content — shared render for all tabs */}
        {["all", "created", "assigned", "pending_acc", "completed", "archived"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-3">
            {viewMode === "table"
              ? <TaskTable {...taskListProps} />
              : <TaskCards {...taskListProps} />
            }
          </TabsContent>
        ))}
      </Tabs>

      {/* Modals */}
      <NewTaskModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        users={assignableUsers}
        currentUserId={currentUser?.id ?? 0}
        onCreated={refresh}
      />

      <TaskDetailSheet
        task={detailTask}
        currentUser={currentUser ?? null}
        users={assignableUsers}
        onClose={() => setDetailTask(null)}
        onAction={() => { refresh(); }}
      />

      {progressTask && (
        <ProgressModal
          task={progressTask}
          onClose={() => setProgressTask(null)}
          onUpdated={refresh}
        />
      )}

      {rejectTask && (
        <RejectModal
          task={rejectTask}
          onClose={() => setRejectTask(null)}
          onRejected={refresh}
        />
      )}

      {reassignTask && (
        <ReassignModal
          task={reassignTask}
          users={assignableUsers}
          currentUserId={currentUser?.id ?? 0}
          onClose={() => setReassignTask(null)}
          onReassigned={refresh}
        />
      )}
    </div>
  );
}
