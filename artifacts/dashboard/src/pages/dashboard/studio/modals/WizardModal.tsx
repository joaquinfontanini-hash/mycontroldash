import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, ChevronRight, Loader2, BarChart2, PieChart, TrendingUp,
  Bell, Link, Activity, LayoutGrid, DollarSign, Sparkles,
} from "lucide-react";
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

const WIDGET_DEFS = [
  { key: "kpi_cards",          name: "KPI Cards",              icon: <BarChart2 className="h-4 w-4" />,   dataSourceKey: "clients.summary" },
  { key: "traffic_light",      name: "Semáforo",               icon: <Activity className="h-4 w-4" />,   dataSourceKey: "dueDates.trafficLight" },
  { key: "upcoming_due_dates", name: "Vencimientos",           icon: <Bell className="h-4 w-4" />,       dataSourceKey: "dueDates.upcoming" },
  { key: "alerts_list",        name: "Lista de alertas",       icon: <Bell className="h-4 w-4" />,       dataSourceKey: "dueDates.upcoming" },
  { key: "bar_chart",          name: "Gráfico de barras",      icon: <BarChart2 className="h-4 w-4" />,  dataSourceKey: "finance.transactions.recent" },
  { key: "expense_categories", name: "Torta de gastos",        icon: <PieChart className="h-4 w-4" />,   dataSourceKey: "finance.transactions.recent" },
  { key: "recent_transactions",name: "Movimientos",            icon: <DollarSign className="h-4 w-4" />, dataSourceKey: "finance.transactions.recent" },
  { key: "goals_progress",     name: "Objetivos financieros",  icon: <TrendingUp className="h-4 w-4" />, dataSourceKey: "finance.goals.progress" },
  { key: "news_feed",          name: "Noticias",               icon: <Activity className="h-4 w-4" />,   dataSourceKey: "news.feed" },
  { key: "ranking",            name: "Ranking",                icon: <TrendingUp className="h-4 w-4" />, dataSourceKey: "news.priority" },
  { key: "pending_tasks",      name: "Tareas pendientes",      icon: <LayoutGrid className="h-4 w-4" />, dataSourceKey: "tasks.myOpen" },
  { key: "smart_summary",      name: "Resumen inteligente",    icon: <Sparkles className="h-4 w-4" />,   dataSourceKey: undefined },
  { key: "text_block",         name: "Bloque de texto",        icon: <LayoutGrid className="h-4 w-4" />, dataSourceKey: "static.text" },
  { key: "quick_links",        name: "Links rápidos",          icon: <Link className="h-4 w-4" />,       dataSourceKey: "static.links" },
  { key: "dynamic_table",      name: "Tabla dinámica",         icon: <LayoutGrid className="h-4 w-4" />, dataSourceKey: "clients.list" },
];

const CATEGORIES = [
  { value: "general",  label: "General",  icon: "📊" },
  { value: "fiscal",   label: "Fiscal",   icon: "📋" },
  { value: "clientes", label: "Clientes", icon: "👥" },
  { value: "finanzas", label: "Finanzas", icon: "💰" },
  { value: "tareas",   label: "Tareas",   icon: "✅" },
  { value: "noticias", label: "Noticias", icon: "📰" },
];

const ICONS = ["📊", "📋", "👥", "💰", "✅", "📰", "🎯", "🏠", "📈", "🔨", "⚡", "🌟"];

export function WizardModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [icon, setIcon] = useState("📊");
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>([]);

  const handleClose = () => {
    setStep(0);
    setName("");
    setDescription("");
    setCategory("general");
    setIcon("📊");
    setSelectedWidgets([]);
    onClose();
  };

  const toggleWidget = (key: string) => {
    setSelectedWidgets(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("api/studio/generate-from-wizard", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category,
          icon,
          selectedWidgets: selectedWidgets.map(key => {
            const def = WIDGET_DEFS.find(d => d.key === key)!;
            return { type: key, title: def.name, dataSourceKey: def.dataSourceKey };
          }),
        }),
      }),
    onSuccess: (data) => {
      toast({ title: `Dashboard "${data.dashboard.name}" creado` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{icon}</span>
            Crear con Wizard
          </DialogTitle>
          <DialogDescription>
            Paso {step + 1} de 3 — {["Información básica", "Elegir widgets", "Confirmación"][step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-1 mb-2">
          {[0, 1, 2].map(s => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-all ${s <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <div className="space-y-4 py-2">

          {/* Step 0: Basic info */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre del dashboard *</Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ej: Mi Dashboard Fiscal"
                />
              </div>

              <div className="space-y-2">
                <Label>Descripción (opcional)</Label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Descripción breve..."
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.icon} {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Ícono</Label>
                <div className="flex flex-wrap gap-2">
                  {ICONS.map(ico => (
                    <button
                      key={ico}
                      onClick={() => setIcon(ico)}
                      className={`w-10 h-10 text-xl rounded-lg border flex items-center justify-center transition-all ${
                        icon === ico ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:border-primary/40"
                      }`}
                    >
                      {ico}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Select widgets */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Seleccioná los widgets que querés incluir. Podés reordenarlos después en el editor.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {WIDGET_DEFS.map(def => {
                  const selected = selectedWidgets.includes(def.key);
                  return (
                    <button
                      key={def.key}
                      onClick={() => toggleWidget(def.key)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all ${
                        selected ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/30"
                      }`}
                    >
                      <span className="text-muted-foreground">{def.icon}</span>
                      <span className="text-sm">{def.name}</span>
                      {selected && <Badge variant="default" className="ml-auto text-xs py-0">✓</Badge>}
                    </button>
                  );
                })}
              </div>
              {selectedWidgets.length === 0 && (
                <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                  Seleccioná al menos un widget para continuar.
                </p>
              )}
            </div>
          )}

          {/* Step 2: Confirmation */}
          {step === 2 && (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{icon}</span>
                <div>
                  <h3 className="font-semibold">{name}</h3>
                  {description && <p className="text-sm text-muted-foreground">{description}</p>}
                  <Badge variant="secondary" className="mt-1 capitalize text-xs">{category}</Badge>
                </div>
              </div>

              {selectedWidgets.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    {selectedWidgets.length} widget{selectedWidgets.length !== 1 ? "s" : ""} seleccionado{selectedWidgets.length !== 1 ? "s" : ""}:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {selectedWidgets.map(k => {
                      const def = WIDGET_DEFS.find(d => d.key === k);
                      return (
                        <div key={k} className="flex items-center gap-2 text-sm p-2 rounded border bg-background">
                          {def?.icon}
                          <span className="truncate">{def?.name ?? k}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-amber-600">Sin widgets seleccionados. Se creará un dashboard vacío.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2 justify-between">
            <Button variant="outline" onClick={step === 0 ? handleClose : () => setStep(s => s - 1)}>
              {step === 0 ? "Cancelar" : "Anterior"}
            </Button>
            {step < 2 ? (
              <Button
                onClick={() => setStep(s => s + 1)}
                disabled={step === 0 ? !name.trim() : step === 1 ? selectedWidgets.length === 0 : false}
              >
                Siguiente <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name.trim()}
              >
                {createMutation.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                  : <><Plus className="mr-2 h-4 w-4" /> Crear dashboard</>
                }
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
