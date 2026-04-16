import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, Save, RefreshCw } from "lucide-react";
import { BASE } from "@/lib/base-url";

async function apiFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(body.error ?? "Error");
  }
  return r.json();
}

const PROMPT_EXAMPLES = [
  "Dashboard de gestión de clientes y vencimientos fiscales",
  "Resumen ejecutivo con KPIs y alertas del sistema",
  "Control financiero personal con gastos y objetivos de ahorro",
  "Dashboard de tareas y productividad del equipo",
  "Noticias económicas y cotizaciones del dólar",
];

export function CreateFromPromptModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<{ generated: { name: string; icon: string; category: string; description: string; widgets: Array<{ type: string; title: string }> } } | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiFetch("api/studio/generate-from-prompt", {
        method: "POST",
        body: JSON.stringify({ prompt, save: false }),
      }),
    onSuccess: (data) => setPreview(data),
    onError: (err: Error) => {
      toast({ title: "Error al generar preview", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch("api/studio/generate-from-prompt", {
        method: "POST",
        body: JSON.stringify({ prompt, save: true }),
      }),
    onSuccess: (data) => {
      toast({ title: `Dashboard "${data.dashboard.name}" creado` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear dashboard", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setPrompt("");
    setPreview(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Crear dashboard desde prompt
          </DialogTitle>
          <DialogDescription>
            Describí el dashboard que querés y lo generamos automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>¿Qué dashboard querés crear?</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Ej: Dashboard de vencimientos fiscales con semáforo de alertas y mis últimas 10 noticias económicas"
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">Mínimo 5 caracteres. Cuanto más específico, mejor.</p>
          </div>

          {/* Examples */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Ejemplos:</p>
            <div className="flex flex-wrap gap-2">
              {PROMPT_EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="text-xs px-3 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Preview result */}
          {previewMutation.isPending && (
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            </div>
          )}

          {preview && (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{preview.generated.icon}</span>
                <div>
                  <h3 className="font-semibold">{preview.generated.name}</h3>
                  {preview.generated.description && (
                    <p className="text-xs text-muted-foreground">{preview.generated.description}</p>
                  )}
                  <Badge variant="secondary" className="mt-1 capitalize text-xs">{preview.generated.category}</Badge>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {preview.generated.widgets.length} widgets generados:
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {preview.generated.widgets.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 rounded border bg-background">
                      <span className="truncate">{w.title}</span>
                      <Badge variant="outline" className="text-xs ml-auto shrink-0">{w.type.replace(/_/g, " ")}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2 justify-between">
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <div className="flex gap-2">
              {!preview ? (
                <Button
                  variant="outline"
                  onClick={() => previewMutation.mutate()}
                  disabled={prompt.trim().length < 5 || previewMutation.isPending}
                >
                  {previewMutation.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando...</>
                    : <><Sparkles className="mr-2 h-4 w-4" /> Preview</>
                  }
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => { setPreview(null); previewMutation.mutate(); }}
                  disabled={previewMutation.isPending}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerar
                </Button>
              )}
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={prompt.trim().length < 5 || saveMutation.isPending}
              >
                {saveMutation.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                  : <><Save className="mr-2 h-4 w-4" /> Crear dashboard</>
                }
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
