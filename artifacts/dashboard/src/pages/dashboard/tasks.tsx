import { useState } from "react";
import {
  useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckSquare, Plus, Clock, Trash2, MoreHorizontal, AlertCircle, Star,
  ChevronRight, ChevronLeft, CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const PRIORITY_LABELS: Record<string, string> = { high: "Alta", medium: "Media", low: "Baja" };
const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  low: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

const COLUMNS = [
  {
    key: "pending",
    label: "Pendiente",
    color: "border-t-amber-400",
    headerBg: "bg-amber-50 dark:bg-amber-950/30",
    headerText: "text-amber-700 dark:text-amber-400",
    countBg: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400",
  },
  {
    key: "in-progress",
    label: "En progreso",
    color: "border-t-blue-400",
    headerBg: "bg-blue-50 dark:bg-blue-950/30",
    headerText: "text-blue-700 dark:text-blue-400",
    countBg: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    key: "done",
    label: "Terminado",
    color: "border-t-emerald-400",
    headerBg: "bg-emerald-50 dark:bg-emerald-950/30",
    headerText: "text-emerald-700 dark:text-emerald-400",
    countBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400",
  },
] as const;

type ColumnKey = typeof COLUMNS[number]["key"];

interface FormErrors { title?: string }

function validateForm(form: { title: string }): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) errors.title = "El título es obligatorio.";
  else if (form.title.trim().length < 3) errors.title = "Al menos 3 caracteres.";
  else if (form.title.trim().length > 200) errors.title = "Máximo 200 caracteres.";
  return errors;
}

function getNextStatus(current: ColumnKey): ColumnKey | null {
  const keys: ColumnKey[] = ["pending", "in-progress", "done"];
  const idx = keys.indexOf(current);
  return idx < keys.length - 1 ? keys[idx + 1] : null;
}

function getPrevStatus(current: ColumnKey): ColumnKey | null {
  const keys: ColumnKey[] = ["pending", "in-progress", "done"];
  const idx = keys.indexOf(current);
  return idx > 0 ? keys[idx - 1] : null;
}

export default function TasksPage() {
  const { data: tasks, isLoading, error } = useListTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", dueDate: "" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [defaultColumn, setDefaultColumn] = useState<ColumnKey>("pending");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });

  const handleCreate = () => {
    const errors = validateForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    createTask.mutate(
      {
        data: {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority as "high" | "medium" | "low",
          dueDate: form.dueDate || undefined,
          status: defaultColumn,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setCreateOpen(false);
          setForm({ title: "", description: "", priority: "medium", dueDate: "" });
          setFormErrors({});
        },
      },
    );
  };

  const handleMove = (id: number, newStatus: ColumnKey) => {
    updateTask.mutate(
      { id, data: { status: newStatus } },
      { onSuccess: invalidate },
    );
  };

  const handleDelete = (id: number) => {
    deleteTask.mutate({ id }, { onSuccess: invalidate });
  };

  const handleCloseDialog = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setForm({ title: "", description: "", priority: "medium", dueDate: "" });
      setFormErrors({});
    }
  };

  const openCreate = (col: ColumnKey) => {
    setDefaultColumn(col);
    setCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
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

  const allTasks = tasks ?? [];

  let filtered = allTasks;
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
  }
  if (priorityFilter !== "all") {
    filtered = filtered.filter(t => t.priority === priorityFilter);
  }

  const byColumn = (col: ColumnKey) => filtered.filter(t => t.status === col);
  const pending = allTasks.filter(t => t.status === "pending").length;
  const inProgress = allTasks.filter(t => t.status === "in-progress").length;
  const done = allTasks.filter(t => t.status === "done").length;

  const isOverdue = (dueDate: string | null | undefined) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {pending} pendiente{pending !== 1 ? "s" : ""} · {inProgress} en progreso · {done} completada{done !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => openCreate("pending")} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Nueva Tarea
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Input
            placeholder="Buscar tareas..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm pl-3 pr-3"
          />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="Prioridad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="medium">Media</SelectItem>
            <SelectItem value="low">Baja</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map(col => {
          const colTasks = byColumn(col.key);
          return (
            <div key={col.key} className={`rounded-xl border-t-4 ${col.color} bg-muted/30 dark:bg-muted/10 flex flex-col min-h-[400px]`}>
              <div className={`px-4 py-3 ${col.headerBg} rounded-t-lg flex items-center justify-between`}>
                <span className={`font-semibold text-sm ${col.headerText}`}>{col.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${col.countBg}`}>
                    {colTasks.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => openCreate(col.key)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                {colTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    {col.key === "done"
                      ? <CheckCheck className="h-8 w-8 text-muted-foreground/40 mb-2" />
                      : <CheckSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                    }
                    <p className="text-xs text-muted-foreground">
                      {col.key === "done" ? "Ninguna completada aún" : "Sin tareas"}
                    </p>
                  </div>
                ) : (
                  colTasks.map(task => {
                    const overdue = isOverdue(task.dueDate) && task.status !== "done";
                    return (
                      <Card
                        key={task.id}
                        className={`shadow-none border ${task.priority === "high" ? "border-l-4 border-l-red-400" : ""} ${task.status === "done" ? "opacity-60" : ""}`}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium leading-snug ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                                {task.title}
                              </p>
                              {task.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                              )}
                              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${PRIORITY_BADGE[task.priority] ?? ""}`}>
                                  {task.priority === "high" && <Star className="h-2.5 w-2.5 mr-0.5 fill-current" />}
                                  {PRIORITY_LABELS[task.priority] ?? task.priority}
                                </span>
                                {task.dueDate && (
                                  <span className={`flex items-center gap-0.5 text-[10px] ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                                    <Clock className="h-2.5 w-2.5" />
                                    {new Date(task.dueDate).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                                    {overdue && " (vencido)"}
                                  </span>
                                )}
                              </div>
                            </div>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-sm">
                                {getPrevStatus(col.key as ColumnKey) && (
                                  <DropdownMenuItem onClick={() => handleMove(task.id, getPrevStatus(col.key as ColumnKey)!)}>
                                    <ChevronLeft className="h-3.5 w-3.5 mr-2" />
                                    Mover a {COLUMNS.find(c => c.key === getPrevStatus(col.key as ColumnKey))?.label}
                                  </DropdownMenuItem>
                                )}
                                {getNextStatus(col.key as ColumnKey) && (
                                  <DropdownMenuItem onClick={() => handleMove(task.id, getNextStatus(col.key as ColumnKey)!)}>
                                    <ChevronRight className="h-3.5 w-3.5 mr-2" />
                                    Mover a {COLUMNS.find(c => c.key === getNextStatus(col.key as ColumnKey))?.label}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => handleDelete(task.id)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-border/50">
                            {getPrevStatus(col.key as ColumnKey) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground flex-1"
                                onClick={() => handleMove(task.id, getPrevStatus(col.key as ColumnKey)!)}
                              >
                                <ChevronLeft className="h-3 w-3 mr-0.5" />
                                {COLUMNS.find(c => c.key === getPrevStatus(col.key as ColumnKey))?.label}
                              </Button>
                            )}
                            {getNextStatus(col.key as ColumnKey) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground flex-1"
                                onClick={() => handleMove(task.id, getNextStatus(col.key as ColumnKey)!)}
                              >
                                {COLUMNS.find(c => c.key === getNextStatus(col.key as ColumnKey))?.label}
                                <ChevronRight className="h-3 w-3 ml-0.5" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Tarea</DialogTitle>
            <DialogDescription>
              Agregá una tarea a <strong>{COLUMNS.find(c => c.key === defaultColumn)?.label}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Título *</Label>
              <Input
                id="task-title"
                placeholder="Ej: Presentar declaración jurada"
                value={form.title}
                onChange={e => {
                  setForm(f => ({ ...f, title: e.target.value }));
                  if (formErrors.title) setFormErrors({});
                }}
                className={formErrors.title ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {formErrors.title && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {formErrors.title}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Descripción</Label>
              <Textarea
                id="task-desc"
                placeholder="Detalles adicionales..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="resize-none"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Prioridad</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger id="task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Vencimiento</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-col">Estado inicial</Label>
              <Select value={defaultColumn} onValueChange={v => setDefaultColumn(v as ColumnKey)}>
                <SelectTrigger id="task-col">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMNS.map(c => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleCloseDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createTask.isPending}>
              {createTask.isPending ? (
                <>
                  <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Guardando...
                </>
              ) : "Guardar Tarea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
