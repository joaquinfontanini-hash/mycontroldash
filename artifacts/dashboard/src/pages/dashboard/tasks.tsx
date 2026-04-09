import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckSquare, Plus, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

export default function TasksPage() {
  const { data: tasks, isLoading, error } = useListTasks();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();

  const handleMarkDone = (id: number) => {
    updateTask.mutate({ id, data: { status: "done" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      }
    });
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar tareas.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground mt-1">Gestión de actividades pendientes.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Tarea
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tasks?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <CheckSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No hay tareas</h3>
            <p className="text-muted-foreground">Estás al día con tus actividades.</p>
          </div>
        ) : (
          tasks?.map(task => (
            <Card key={task.id} className={task.status === 'done' ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{task.title}</CardTitle>
                  <Badge variant={task.priority === 'high' ? 'destructive' : 'secondary'}>
                    {task.priority}
                  </Badge>
                </div>
                {task.description && <CardDescription>{task.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  {task.dueDate && <><Clock className="h-4 w-4" /> {new Date(task.dueDate).toLocaleDateString()}</>}
                </div>
                <div className="flex justify-end gap-2">
                  {task.status !== 'done' && (
                    <Button size="sm" onClick={() => handleMarkDone(task.id)}>
                      Completar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
