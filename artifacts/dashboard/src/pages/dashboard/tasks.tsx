import { useState } from "react";
import {
  useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CheckSquare, Plus, Clock, Trash2, MoreHorizontal, AlertCircle, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";

const PRIORITY_LABELS = { high: "Alta", medium: "Media", low: "Baja" };
const STATUS_LABELS = { pending: "Pendiente", "in-progress": "En progreso", done: "Completada" };

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  "in-progress": "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  done: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};

const PRIORITY_BADGE = {
  high: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  low: "bg-muted text-muted-foreground border-muted",
};

interface FormErrors {
  title?: string;
}

function validateForm(form: { title: string }): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) {
    errors.title = "El título es obligatorio.";
  } else if (form.title.trim().length < 3) {
    errors.title = "El título debe tener al menos 3 caracteres.";
  } else if (form.title.trim().length > 200) {
    errors.title = "El título no puede superar 200 caracteres.";
  }
  return errors;
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
  const [statusFilter, setStatusFilter] = useState("all");

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
          status: "pending",
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

  const handleStatus = (id: number, status: string) => {
    updateTask.mutate(
      { id, data: { status: status as "pending" | "in-progress" | "done" } },
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
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
  const filtered = statusFilter === "all" ? allTasks : allTasks.filter(t => t.status === statusFilter);

  const pending = allTasks.filter(t => t.status === "pending").length;
  const inProgress = allTasks.filter(t => t.status === "in-progress").length;
  const done = allTasks.filter(t => t.status === "done").length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {pending} pendiente{pending !== 1 ? "s" : ""} · {inProgress} en progreso · {done} completada{done !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Nueva Tarea
        </Button>
      </div>

      {allTasks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: "all", label: "Todas" },
            { key: "pending", label: "Pendientes" },
            { key: "in-progress", label: "En progreso" },
            { key: "done", label: "Completadas" },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border
                ${statusFilter === f.key
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty className="border-2 border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckSquare />
            </EmptyMedia>
            <EmptyTitle>
              {allTasks.length === 0 ? "Sin tareas todavía" : "Sin resultados"}
            </EmptyTitle>
            <EmptyDescription>
              {allTasks.length === 0
                ? "Creá tu primera tarea para organizarte mejor."
                : "No hay tareas para el filtro seleccionado."}
            </EmptyDescription>
          </EmptyHeader>
          {allTasks.length === 0 && (
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear primera tarea
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => (
            <Card
              key={task.id}
              className={`card-hover ${task.status === "done" ? "opacity-60" : ""} ${task.priority === "high" && task.status !== "done" ? "border-l-4 border-l-red-500" : ""}`}
            >
              <CardHeader className="p-4">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleStatus(task.id, task.status === "done" ? "pending" : "done")}
                    className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
                      ${task.status === "done"
                        ? "bg-green-500 border-green-500 text-white"
                        : "border-muted-foreground hover:border-primary"
                      }`}
                  >
                    {task.status === "done" && <CheckSquare className="h-3 w-3" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_BADGE[task.status as keyof typeof STATUS_BADGE] ?? ""}`}>
                        {STATUS_LABELS[task.status as keyof typeof STATUS_LABELS] ?? task.status}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${PRIORITY_BADGE[task.priority as keyof typeof PRIORITY_BADGE] ?? ""}`}>
                        {task.priority === "high" && <Star className="h-2.5 w-2.5 mr-1 fill-current" />}
                        {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS] ?? task.priority}
                      </span>
                      {task.dueDate && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(task.dueDate).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleStatus(task.id, "pending")}>
                        Marcar Pendiente
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleStatus(task.id, "in-progress")}>
                        Marcar En Progreso
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleStatus(task.id, "done")}>
                        Marcar Completada
                      </DropdownMenuItem>
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
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Tarea</DialogTitle>
            <DialogDescription>Agregá una tarea a tu lista de pendientes.</DialogDescription>
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
