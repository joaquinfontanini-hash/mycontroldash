import { useState } from "react";
import {
  useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckSquare, Plus, Clock, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const PRIORITY_COLORS = {
  high: "destructive" as const,
  medium: "default" as const,
  low: "secondary" as const,
};

const PRIORITY_LABELS = { high: "Alta", medium: "Media", low: "Baja" };
const STATUS_LABELS = { pending: "Pendiente", "in-progress": "En progreso", done: "Completada" };

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  "in-progress": "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  done: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};

export default function TasksPage() {
  const { data: tasks, isLoading, error } = useListTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", priority: "medium", dueDate: "",
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });

  const handleCreate = () => {
    if (!form.title.trim()) return;
    createTask.mutate(
      {
        data: {
          title: form.title,
          description: form.description || undefined,
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
        },
      },
    );
  };

  const handleStatus = (id: number, status: string) => {
    updateTask.mutate({ id, data: { status: status as "pending" | "in-progress" | "done" } }, { onSuccess: invalidate });
  };

  const handleDelete = (id: number) => {
    deleteTask.mutate({ id }, { onSuccess: invalidate });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar tareas.</div>;
  }

  const pending = tasks?.filter(t => t.status !== "done") ?? [];
  const done = tasks?.filter(t => t.status === "done") ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {pending.length} pendientes · {done.length} completadas
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Tarea
        </Button>
      </div>

      {tasks?.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <CheckSquare className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">Estás al día</h3>
          <p className="text-muted-foreground text-sm mb-4">No hay tareas pendientes.</p>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Crear primera tarea
          </Button>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Pendientes</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {pending.map(task => (
                  <Card key={task.id} className="card-hover border-l-4 border-l-amber-500/60">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start gap-2">
                        <CardTitle className="text-base leading-snug">{task.title}</CardTitle>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleStatus(task.id, "in-progress")}>
                              Marcar En Progreso
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatus(task.id, "done")}>
                              Marcar Completada
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(task.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {task.description && (
                        <CardDescription className="text-xs line-clamp-2">{task.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS]}>
                            {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS] ?? task.priority}
                          </Badge>
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_BADGE[task.status as keyof typeof STATUS_BADGE] ?? ""}`}>
                            {STATUS_LABELS[task.status as keyof typeof STATUS_LABELS] ?? task.status}
                          </span>
                        </div>
                        {task.dueDate && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <Clock className="h-3 w-3" />
                            {new Date(task.dueDate).toLocaleDateString("es-AR")}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Completadas</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {done.map(task => (
                  <Card key={task.id} className="opacity-55">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base line-through text-muted-foreground">{task.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS] ?? task.priority}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDelete(task.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Tarea</DialogTitle>
            <DialogDescription>Completá los datos para crear una nueva actividad.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Título *</Label>
              <Input
                id="task-title"
                placeholder="Ej: Preparar informe mensual"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Descripción</Label>
              <Textarea
                id="task-desc"
                placeholder="Detalle opcional..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!form.title.trim() || createTask.isPending}>
              {createTask.isPending ? "Creando..." : "Crear Tarea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
