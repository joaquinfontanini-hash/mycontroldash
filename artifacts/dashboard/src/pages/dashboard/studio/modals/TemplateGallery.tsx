import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BookTemplate, Loader2, Plus } from "lucide-react";
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

interface Template {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  category?: string | null;
  tags?: string[];
}

export function TemplateGallery({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["studio-templates"],
    queryFn: () => apiFetch("api/studio/templates"),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("api/studio/generate-from-template", {
        method: "POST",
        body: JSON.stringify({
          templateKey: selectedKey,
          name: customName.trim() || undefined,
        }),
      }),
    onSuccess: (data) => {
      toast({ title: `Dashboard "${data.dashboard.name}" creado desde plantilla` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear dashboard", description: err.message, variant: "destructive" });
    },
  });

  const selectedTemplate = templates.find(t => t.key === selectedKey);

  const handleClose = () => {
    setSelectedKey(null);
    setCustomName("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookTemplate className="h-5 w-5 text-blue-500" />
            Elegir plantilla
          </DialogTitle>
          <DialogDescription>
            Seleccioná una plantilla preconfigurada como punto de partida.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No hay plantillas disponibles</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map(t => (
                <button
                  key={t.key}
                  onClick={() => setSelectedKey(t.key === selectedKey ? null : t.key)}
                  className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-all ${
                    selectedKey === t.key
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/40 hover:bg-muted/30"
                  }`}
                >
                  {t.color && (
                    <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{t.icon ?? "📊"}</span>
                      <span className="font-medium text-sm">{t.name}</span>
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                    )}
                    {t.category && (
                      <Badge variant="secondary" className="mt-2 text-xs capitalize">{t.category}</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedTemplate && (
            <div className="space-y-2 border-t pt-4">
              <Label className="text-sm">Nombre del dashboard (opcional)</Label>
              <Input
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder={selectedTemplate.name}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Dejá vacío para usar el nombre de la plantilla.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2 justify-between">
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!selectedKey || createMutation.isPending}
            >
              {createMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                : <><Plus className="mr-2 h-4 w-4" /> Usar plantilla</>
              }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
