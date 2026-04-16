import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Monitor, Smartphone, Eye, Zap,
  Plus, Trash2, GripVertical, Settings2, X, Loader2,
  BarChart2, PieChart, TrendingUp, Bell, Link, Activity,
  LayoutGrid, DollarSign, Sparkles, ChevronDown,
} from "lucide-react";
import { BASE } from "@/lib/base-url";
import type { DashboardFull, DashboardWidget, LayoutItem, Breakpoint } from "./types";

// ── API helpers ────────────────────────────────────────────────────────────────

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

// ── Widget type catalog (for palette) ─────────────────────────────────────────

const WIDGET_PALETTE: Array<{
  type: string;
  name: string;
  icon: React.ReactNode;
  category: string;
  defaultDataSource?: string;
}> = [
  { type: "kpi_cards",          name: "KPI Cards",              icon: <BarChart2 className="h-4 w-4" />,   category: "datos",    defaultDataSource: "clients.summary" },
  { type: "traffic_light",      name: "Semáforo",               icon: <Activity className="h-4 w-4" />,   category: "fiscal",   defaultDataSource: "dueDates.trafficLight" },
  { type: "upcoming_due_dates", name: "Vencimientos",           icon: <Bell className="h-4 w-4" />,       category: "fiscal",   defaultDataSource: "dueDates.upcoming" },
  { type: "alerts_list",        name: "Lista de alertas",       icon: <Bell className="h-4 w-4" />,       category: "fiscal",   defaultDataSource: "dueDates.upcoming" },
  { type: "bar_chart",          name: "Gráfico de barras",      icon: <BarChart2 className="h-4 w-4" />,  category: "visual",   defaultDataSource: "finance.transactions.recent" },
  { type: "expense_categories", name: "Torta de gastos",        icon: <PieChart className="h-4 w-4" />,   category: "visual",   defaultDataSource: "finance.transactions.recent" },
  { type: "recent_transactions",name: "Movimientos",            icon: <DollarSign className="h-4 w-4" />, category: "finanzas", defaultDataSource: "finance.transactions.recent" },
  { type: "goals_progress",     name: "Objetivos",              icon: <TrendingUp className="h-4 w-4" />, category: "finanzas", defaultDataSource: "finance.goals.progress" },
  { type: "news_feed",          name: "Noticias",               icon: <Activity className="h-4 w-4" />,   category: "info",     defaultDataSource: "news.feed" },
  { type: "ranking",            name: "Ranking",                icon: <TrendingUp className="h-4 w-4" />, category: "info",     defaultDataSource: "news.priority" },
  { type: "pending_tasks",      name: "Tareas pendientes",      icon: <LayoutGrid className="h-4 w-4" />, category: "tareas",   defaultDataSource: "tasks.myOpen" },
  { type: "smart_summary",      name: "Resumen inteligente",    icon: <Sparkles className="h-4 w-4" />,   category: "IA",       defaultDataSource: undefined },
  { type: "text_block",         name: "Bloque de texto",        icon: <LayoutGrid className="h-4 w-4" />, category: "estático", defaultDataSource: "static.text" },
  { type: "quick_links",        name: "Links rápidos",          icon: <Link className="h-4 w-4" />,       category: "estático", defaultDataSource: "static.links" },
  { type: "dynamic_table",      name: "Tabla dinámica",         icon: <LayoutGrid className="h-4 w-4" />, category: "datos",    defaultDataSource: "clients.list" },
];

const PALETTE_CATEGORIES = ["datos", "fiscal", "finanzas", "visual", "info", "tareas", "IA", "estático"];

const DATA_SOURCES = [
  { key: "clients.summary",             label: "Clientes — Resumen" },
  { key: "clients.list",                label: "Clientes — Listado" },
  { key: "dueDates.upcoming",           label: "Vencimientos — Próximos" },
  { key: "dueDates.trafficLight",       label: "Vencimientos — Semáforo" },
  { key: "news.feed",                   label: "Noticias — Feed" },
  { key: "news.priority",               label: "Noticias — Alta prioridad" },
  { key: "finance.summary",             label: "Finanzas — Resumen" },
  { key: "finance.transactions.recent", label: "Finanzas — Movimientos" },
  { key: "finance.budgets.status",      label: "Finanzas — Presupuestos" },
  { key: "finance.goals.progress",      label: "Finanzas — Objetivos" },
  { key: "tasks.myOpen",                label: "Tareas — Mis abiertas" },
  { key: "tasks.teamBoard",             label: "Tareas — Panel de equipo" },
  { key: "audit.activity",              label: "Auditoría — Actividad" },
  { key: "system.notifications",        label: "Sistema — Notificaciones" },
  { key: "static.text",                 label: "Texto estático" },
  { key: "static.links",                label: "Links rápidos" },
];

// ── Sortable widget item ───────────────────────────────────────────────────────

function SortableWidgetItem({
  widget,
  selected,
  onSelect,
  onDelete,
}: {
  widget: DashboardWidget;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
        selected ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/30"
      } ${isDragging ? "shadow-lg" : ""}`}
      onClick={onSelect}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{widget.title}</p>
        <p className="text-xs text-muted-foreground truncate">{widget.type.replace(/_/g, " ")}</p>
      </div>
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={`text-xs ${widget.visible ? "" : "opacity-50"}`}>
          {widget.visible ? "visible" : "oculto"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Widget config panel ───────────────────────────────────────────────────────

function WidgetConfigPanel({
  widget,
  onUpdate,
  onClose,
  currentWidth = 1,
  onWidthChange,
  breakpoint = "desktop",
}: {
  widget: DashboardWidget;
  onUpdate: (updates: Partial<DashboardWidget>) => void;
  onClose: () => void;
  currentWidth?: number;
  onWidthChange?: (w: 1 | 2 | 3) => void;
  breakpoint?: Breakpoint;
}) {
  const [title, setTitle] = useState(widget.title);
  const [subtitle, setSubtitle] = useState(widget.subtitle ?? "");
  const [dataSourceKey, setDataSourceKey] = useState(widget.dataSourceKey ?? "");
  const [visible, setVisible] = useState(widget.visible !== false);
  const [contentText, setContentText] = useState((widget.configJson?.content as string) ?? "");

  useEffect(() => {
    setTitle(widget.title);
    setSubtitle(widget.subtitle ?? "");
    setDataSourceKey(widget.dataSourceKey ?? "");
    setVisible(widget.visible !== false);
    setContentText((widget.configJson?.content as string) ?? "");
  }, [widget.id]);

  const handleApply = () => {
    const updates: Partial<DashboardWidget> = {
      title: title.trim() || widget.title,
      subtitle: subtitle.trim() || null,
      dataSourceKey: dataSourceKey || null,
      visible,
    };
    if (widget.type === "text_block") {
      updates.configJson = { ...widget.configJson, content: contentText };
    }
    onUpdate(updates);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Configuración del widget
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <p className="text-sm text-muted-foreground capitalize">{widget.type.replace(/_/g, " ")}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="widget-title">Título</Label>
          <Input
            id="widget-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="h-8 text-sm"
            placeholder="Título del widget"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="widget-subtitle">Subtítulo</Label>
          <Input
            id="widget-subtitle"
            value={subtitle}
            onChange={e => setSubtitle(e.target.value)}
            className="h-8 text-sm"
            placeholder="Opcional"
          />
        </div>

        {widget.type !== "smart_summary" && (
          <div className="space-y-1">
            <Label className="text-xs">Fuente de datos</Label>
            <Select value={dataSourceKey} onValueChange={setDataSourceKey}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Ninguna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Ninguna</SelectItem>
                {DATA_SOURCES.map(ds => (
                  <SelectItem key={ds.key} value={ds.key}>
                    {ds.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {widget.type === "text_block" && (
          <div className="space-y-1">
            <Label className="text-xs">Contenido del texto</Label>
            <Textarea
              value={contentText}
              onChange={e => setContentText(e.target.value)}
              className="text-sm"
              rows={3}
              placeholder="Escribí el texto aquí..."
            />
          </div>
        )}

        {/* Width selector — only relevant on desktop (mobile auto-stacks to 1 col) */}
        {breakpoint !== "mobile" && onWidthChange && (
          <div className="space-y-1">
            <Label className="text-xs">Ancho en desktop</Label>
            <Select
              value={String(currentWidth)}
              onValueChange={v => onWidthChange(Number(v) as 1 | 2 | 3)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 columna (angosto)</SelectItem>
                <SelectItem value="2">2 columnas (mediano)</SelectItem>
                <SelectItem value="3">Ancho completo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Se guarda al presionar "Guardar"
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="widget-visible"
            checked={visible}
            onCheckedChange={setVisible}
          />
          <Label htmlFor="widget-visible" className="text-xs cursor-pointer">
            {visible ? "Visible" : "Oculto"}
          </Label>
        </div>
      </div>

      <Button size="sm" className="w-full" onClick={handleApply}>
        Aplicar cambios
      </Button>
    </div>
  );
}

// ── Main Builder ───────────────────────────────────────────────────────────────

interface DashboardBuilderProps {
  dashId: number;
  onBack: () => void;
  onPreview: (id: number) => void;
}

export function DashboardBuilder({ dashId, onBack, onPreview }: DashboardBuilderProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>("desktop");
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [selectedWidgetId, setSelectedWidgetId] = useState<number | null>(null);
  const [dashName, setDashName] = useState("");
  const [dashStatus, setDashStatus] = useState("draft");
  const [dashRefreshInterval, setDashRefreshInterval] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [paletteCategory, setPaletteCategory] = useState<string>("datos");
  // T002: per-breakpoint column-width map (widgetId → 1|2|3)
  const [layoutWidthsByBreakpoint, setLayoutWidthsByBreakpoint] = useState<Record<string, Record<number, number>>>({});

  // Load dashboard
  const { data: dash, isLoading } = useQuery<DashboardFull>({
    queryKey: ["studio-dashboard", dashId],
    queryFn: () => apiFetch(`api/studio/dashboards/${dashId}`),
    staleTime: 0,
  });

  useEffect(() => {
    if (dash) {
      setWidgets([...(dash.widgets ?? [])].sort((a, b) => a.orderIndex - b.orderIndex));
      setDashName(dash.name);
      setDashStatus(dash.status);
      setDashRefreshInterval(dash.refreshIntervalSeconds ?? null);
      setHasUnsavedChanges(false);
      // T002: Initialize layout widths from persisted layouts
      const widthsByBp: Record<string, Record<number, number>> = {};
      for (const layout of dash.layouts ?? []) {
        const bp = layout.breakpoint;
        widthsByBp[bp] = {};
        for (const item of layout.layoutJson ?? []) {
          widthsByBp[bp][item.widgetId] = item.w ?? 1;
        }
      }
      setLayoutWidthsByBreakpoint(widthsByBp);
    }
  }, [dash]);

  // E3: Warn browser on page reload/close when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  // E3: Guard navigation back with unsaved layout changes
  const handleBack = useCallback(() => {
    if (hasUnsavedChanges) {
      const ok = window.confirm("Tenés cambios sin guardar en el layout. ¿Salir de todas formas?");
      if (!ok) return;
    }
    onBack();
  }, [hasUnsavedChanges, onBack]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setWidgets(prev => {
      const oldIdx = prev.findIndex(w => w.id === active.id);
      const newIdx = prev.findIndex(w => w.id === over.id);
      const reordered = arrayMove(prev, oldIdx, newIdx).map((w, i) => ({ ...w, orderIndex: i }));
      return reordered;
    });
    setHasUnsavedChanges(true);
  };

  // Add widget mutation
  const addWidgetMutation = useMutation({
    mutationFn: (def: typeof WIDGET_PALETTE[0]) =>
      apiFetch(`api/studio/dashboards/${dashId}/widgets`, {
        method: "POST",
        body: JSON.stringify({
          type: def.type,
          title: def.name,
          dataSourceKey: def.defaultDataSource ?? null,
          configJson: {},
          orderIndex: widgets.length,
        }),
      }),
    onSuccess: (newWidget: DashboardWidget) => {
      setWidgets(prev => [...prev, newWidget]);
      setSelectedWidgetId(newWidget.id);
      setHasUnsavedChanges(true);
      toast({ title: `Widget "${newWidget.title}" agregado` });
    },
    onError: (err: Error) => {
      toast({ title: "Error al agregar widget", description: err.message, variant: "destructive" });
    },
  });

  // Update widget mutation
  const updateWidgetMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<DashboardWidget> }) =>
      apiFetch(`api/studio/widgets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    onSuccess: (updated: DashboardWidget) => {
      setWidgets(prev => prev.map(w => w.id === updated.id ? { ...w, ...updated } : w));
      // E4: Do NOT reset hasUnsavedChanges here — widget properties are saved,
      // but layout order/position changes may still be pending.
      toast({ title: "Widget actualizado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Delete widget mutation
  const deleteWidgetMutation = useMutation({
    mutationFn: (widgetId: number) =>
      apiFetch(`api/studio/widgets/${widgetId}`, { method: "DELETE" }),
    onSuccess: (_, widgetId) => {
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
      if (selectedWidgetId === widgetId) setSelectedWidgetId(null);
      setHasUnsavedChanges(true);
      toast({ title: "Widget eliminado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
    },
  });

  // T002: Handler for widget width change
  const handleWidgetWidthChange = useCallback((widgetId: number, w: 1 | 2 | 3) => {
    setLayoutWidthsByBreakpoint(prev => ({
      ...prev,
      [activeBreakpoint]: { ...(prev[activeBreakpoint] ?? {}), [widgetId]: w },
    }));
    setHasUnsavedChanges(true);
  }, [activeBreakpoint]);

  // Save layout + reorder mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // D2: Atomic batch save — single request, backend wraps in a transaction
      const currentWidths = layoutWidthsByBreakpoint[activeBreakpoint] ?? {};
      const layout: LayoutItem[] = widgets.map((w, i) => ({
        widgetId: w.id,
        x: activeBreakpoint === "mobile" ? 0 : (i % 3),
        y: activeBreakpoint === "mobile" ? i : Math.floor(i / 3),
        // T002: use saved width for desktop, always 1 for mobile
        w: activeBreakpoint === "mobile" ? 1 : (currentWidths[w.id] ?? 1),
        h: 1,
      }));

      await apiFetch(`api/studio/dashboards/${dashId}/save`, {
        method: "POST",
        body: JSON.stringify({
          name: dashName,
          status: dashStatus,
          refreshIntervalSeconds: dashRefreshInterval,
          widgetOrder: widgets.map((w, i) => ({ id: w.id, orderIndex: i })),
          layout: { breakpoint: activeBreakpoint, layoutJson: layout },
        }),
      });
    },
    onSuccess: () => {
      setHasUnsavedChanges(false);
      qc.invalidateQueries({ queryKey: ["studio-dashboard", dashId] });
      qc.invalidateQueries({ queryKey: ["studio-dashboards"] });
      toast({ title: "Dashboard guardado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    },
  });

  // Activate mutation
  const activateMutation = useMutation({
    mutationFn: () =>
      apiFetch(`api/studio/dashboards/${dashId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: dashStatus === "active" ? "draft" : "active" }),
      }),
    onSuccess: (updated) => {
      setDashStatus(updated.status);
      qc.invalidateQueries({ queryKey: ["studio-dashboard", dashId] });
      toast({ title: updated.status === "active" ? "Dashboard activado" : "Dashboard puesto en borrador" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleWidgetUpdate = useCallback((updates: Partial<DashboardWidget>) => {
    if (!selectedWidgetId) return;
    updateWidgetMutation.mutate({ id: selectedWidgetId, updates });
  }, [selectedWidgetId, updateWidgetMutation]);

  const selectedWidget = widgets.find(w => w.id === selectedWidgetId);
  const paletteDefs = WIDGET_PALETTE.filter(w => w.category === paletteCategory);

  if (isLoading) return <BuilderSkeleton />;
  if (!dash) return <p className="p-6 text-muted-foreground">Dashboard no encontrado</p>;

  const canEdit = dash._access === "owner" || dash._access === "admin" || dash._access === "edit";
  if (!canEdit) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">No tenés permisos para editar este dashboard.</p>
        <Button className="mt-4" onClick={onBack}>Volver</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Input
          value={dashName}
          onChange={e => { setDashName(e.target.value); setHasUnsavedChanges(true); }}
          className="h-8 max-w-56 text-sm font-medium"
        />

        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">Sin guardar</Badge>
        )}

        <div className="flex-1" />

        {/* Breakpoint toggle */}
        <div className="flex rounded-lg border overflow-hidden">
          <Button
            variant={activeBreakpoint === "desktop" ? "default" : "ghost"}
            size="sm" className="rounded-none h-8 px-3 gap-1"
            onClick={() => setActiveBreakpoint("desktop")}
          >
            <Monitor className="h-3 w-3" />
            <span className="hidden sm:inline text-xs">Desktop</span>
          </Button>
          <Button
            variant={activeBreakpoint === "mobile" ? "default" : "ghost"}
            size="sm" className="rounded-none h-8 px-3 gap-1"
            onClick={() => setActiveBreakpoint("mobile")}
          >
            <Smartphone className="h-3 w-3" />
            <span className="hidden sm:inline text-xs">Mobile</span>
          </Button>
        </div>

        <Button
          variant="outline" size="sm"
          onClick={() => onPreview(dashId)}
        >
          <Eye className="h-4 w-4 mr-1" />
          Preview
        </Button>

        <Button
          variant="outline" size="sm"
          onClick={() => activateMutation.mutate()}
          disabled={activateMutation.isPending}
        >
          <Zap className={`h-4 w-4 mr-1 ${dashStatus === "active" ? "text-yellow-500" : ""}`} />
          {dashStatus === "active" ? "Activo" : "Activar"}
        </Button>

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending
            ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Guardando...</>
            : <><Save className="h-4 w-4 mr-1" /> Guardar</>
          }
        </Button>
      </div>

      {/* Main layout: palette | canvas | config */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel — widget palette */}
        <div className="w-56 border-r flex flex-col bg-muted/20 flex-shrink-0">
          <div className="p-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Widgets</p>
          </div>
          {/* Category tabs */}
          <ScrollArea className="flex-shrink-0 border-b">
            <div className="p-2 flex flex-wrap gap-1">
              {PALETTE_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setPaletteCategory(cat)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    paletteCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {paletteDefs.map(def => (
                <button
                  key={def.type}
                  onClick={() => addWidgetMutation.mutate(def)}
                  disabled={addWidgetMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-muted transition-colors text-sm disabled:opacity-50"
                >
                  <span className="text-muted-foreground">{def.icon}</span>
                  <span className="truncate">{def.name}</span>
                  <Plus className="h-3 w-3 ml-auto text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Center — sortable widget list / canvas */}
        <div className="flex-1 overflow-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">
              {widgets.filter(w => w.visible !== false).length} widget{widgets.length !== 1 ? "s" : ""} visible{widgets.length !== 1 ? "s" : ""}
              {" "}<span className="text-xs">— layout {activeBreakpoint}</span>
            </p>
            {hasUnsavedChanges && (
              <p className="text-xs text-amber-600">Hay cambios sin guardar</p>
            )}
          </div>

          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-lg border-2 border-dashed text-muted-foreground">
              <LayoutGrid className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">Sin widgets</p>
              <p className="text-sm mt-1">Seleccioná un widget del panel izquierdo para agregar</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={widgets.map(w => w.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {widgets.map(w => (
                    <SortableWidgetItem
                      key={w.id}
                      widget={w}
                      selected={selectedWidgetId === w.id}
                      onSelect={() => setSelectedWidgetId(w.id === selectedWidgetId ? null : w.id)}
                      onDelete={() => deleteWidgetMutation.mutate(w.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Right panel — config */}
        <div className="w-64 border-l flex flex-col bg-muted/20 flex-shrink-0">
          <div className="p-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {selectedWidget ? "Configurar widget" : "Propiedades"}
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              {selectedWidget ? (
                <WidgetConfigPanel
                  widget={selectedWidget}
                  onUpdate={handleWidgetUpdate}
                  onClose={() => setSelectedWidgetId(null)}
                  currentWidth={(layoutWidthsByBreakpoint[activeBreakpoint] ?? {})[selectedWidget.id] ?? 1}
                  onWidthChange={(w) => handleWidgetWidthChange(selectedWidget.id, w)}
                  breakpoint={activeBreakpoint}
                />
              ) : (
                <DashboardPropertiesPanel
                  dashName={dashName}
                  dashStatus={dashStatus}
                  refreshIntervalSeconds={dashRefreshInterval}
                  onChangeName={n => { setDashName(n); setHasUnsavedChanges(true); }}
                  onChangeStatus={s => { setDashStatus(s); setHasUnsavedChanges(true); }}
                  onChangeRefreshInterval={v => { setDashRefreshInterval(v); setHasUnsavedChanges(true); }}
                  breakpoint={activeBreakpoint}
                  widgetCount={widgets.length}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard properties panel ─────────────────────────────────────────────────

function DashboardPropertiesPanel({
  dashName, dashStatus, refreshIntervalSeconds, onChangeName, onChangeStatus, onChangeRefreshInterval, breakpoint, widgetCount,
}: {
  dashName: string;
  dashStatus: string;
  refreshIntervalSeconds: number | null;
  onChangeName: (n: string) => void;
  onChangeStatus: (s: string) => void;
  onChangeRefreshInterval: (v: number | null) => void;
  breakpoint: Breakpoint;
  widgetCount: number;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Nombre del dashboard</Label>
        <Input
          value={dashName}
          onChange={e => onChangeName(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Estado</Label>
        <Select value={dashStatus} onValueChange={onChangeStatus}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Borrador</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Auto-refresh de datos</Label>
        <Select
          value={refreshIntervalSeconds ? String(refreshIntervalSeconds) : "none"}
          onValueChange={v => onChangeRefreshInterval(v === "none" ? null : parseInt(v))}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Manual (sin auto-refresh)</SelectItem>
            <SelectItem value="30">Cada 30 segundos</SelectItem>
            <SelectItem value="60">Cada 1 minuto</SelectItem>
            <SelectItem value="300">Cada 5 minutos</SelectItem>
            <SelectItem value="900">Cada 15 minutos</SelectItem>
            <SelectItem value="3600">Cada hora</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="space-y-2 text-xs text-muted-foreground">
        <p><span className="font-medium text-foreground">{widgetCount}</span> widgets en total</p>
        <p>Layout activo: <span className="font-medium text-foreground">{breakpoint}</span></p>
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1 text-xs">Cómo usar el editor:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Seleccioná un widget para configurarlo</li>
          <li>Arrastrá los widgets para reordenarlos</li>
          <li>Usá los botones del panel izquierdo para agregar</li>
          <li>Guardá cuando termines</li>
        </ul>
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function BuilderSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-8 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-56 border-r p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
        </div>
        <div className="flex-1 p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
        <div className="w-64 border-l p-3 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      </div>
    </div>
  );
}
