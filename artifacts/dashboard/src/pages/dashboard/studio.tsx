import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Sparkles, LayoutGrid, LayoutList, Star, StarOff,
  Archive, RotateCcw, Trash2, Copy, MoreHorizontal, Loader2, Wand2,
  BookTemplate, Settings, ChevronRight, Eye, Pencil,
  BarChart2, Table, Bell, TrafficCone, TrendingUp, Calendar,
  Newspaper, DollarSign, CheckSquare, ClipboardList, PieChart,
  Activity, Link, AlignLeft, X, ArrowLeft,
} from "lucide-react";
import { BASE } from "@/lib/base-url";

// ── API helpers ───────────────────────────────────────────────────────────────

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

interface Dashboard {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  sourceType: string;
  status: string;
  isFavorite: boolean;
  updatedAt: string;
  archivedAt?: string;
}

interface Template {
  id: number;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  configJson: {
    widgets?: unknown[];
    filters?: unknown[];
  };
}

interface WidgetDef {
  id: number;
  key: string;
  name: string;
  description?: string;
  category?: string;
  defaultConfigJson: Record<string, unknown>;
  supportsGlobalFilters?: boolean;
  supportsDateRange?: boolean;
}

interface GeneratedDashboard {
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  widgets: Array<{
    type: string;
    title: string;
    dataSourceKey?: string;
    configJson?: Record<string, unknown>;
    orderIndex: number;
  }>;
  filters: unknown[];
  parsedIntent: {
    domain: string;
    secondaryDomains: string[];
    confidence: number;
    intention: string;
  };
}

// ── Widget icon map ───────────────────────────────────────────────────────────

const WIDGET_ICONS: Record<string, React.ReactNode> = {
  kpi_cards: <TrendingUp className="h-4 w-4" />,
  dynamic_table: <Table className="h-4 w-4" />,
  alerts_list: <Bell className="h-4 w-4" />,
  traffic_light: <TrafficCone className="h-4 w-4" />,
  ranking: <BarChart2 className="h-4 w-4" />,
  bar_chart: <BarChart2 className="h-4 w-4" />,
  line_chart: <TrendingUp className="h-4 w-4" />,
  smart_summary: <Sparkles className="h-4 w-4" />,
  calendar: <Calendar className="h-4 w-4" />,
  news_feed: <Newspaper className="h-4 w-4" />,
  quotes: <DollarSign className="h-4 w-4" />,
  pending_tasks: <CheckSquare className="h-4 w-4" />,
  upcoming_due_dates: <ClipboardList className="h-4 w-4" />,
  expense_categories: <PieChart className="h-4 w-4" />,
  recent_transactions: <Activity className="h-4 w-4" />,
  goals_progress: <TrendingUp className="h-4 w-4" />,
  checklist: <CheckSquare className="h-4 w-4" />,
  recent_activity: <Activity className="h-4 w-4" />,
  quick_links: <Link className="h-4 w-4" />,
  text_block: <AlignLeft className="h-4 w-4" />,
};

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  prompt: { label: "Prompt", color: "bg-purple-100 text-purple-700" },
  template: { label: "Plantilla", color: "bg-blue-100 text-blue-700" },
  wizard: { label: "Wizard", color: "bg-green-100 text-green-700" },
  manual: { label: "Manual", color: "bg-gray-100 text-gray-700" },
};

const PROMPT_EXAMPLES = [
  "Dashboard de control fiscal para mis clientes con vencimientos y semáforo",
  "Panel ejecutivo con KPIs, alertas y actividad reciente",
  "Monitor de finanzas personales con gastos, presupuesto y objetivos",
  "Panel de noticias económicas de alto impacto",
  "Panel de productividad con tareas pendientes y actividad del equipo",
];

const WIZARD_CATEGORIES = [
  { value: "fiscal", label: "Fiscal" },
  { value: "finanzas", label: "Finanzas" },
  { value: "noticias", label: "Noticias" },
  { value: "tareas", label: "Tareas" },
  { value: "ejecutivo", label: "Ejecutivo" },
  { value: "general", label: "General" },
];

const DASHBOARD_ICONS = ["📊", "📋", "💰", "📰", "✅", "🎯", "🏠", "🔨", "📈", "✈️"];

// ── DashboardCard ─────────────────────────────────────────────────────────────

function DashboardCard({
  dash,
  onOpen,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete,
  onToggleFavorite,
}: {
  dash: Dashboard;
  onOpen: () => void;
  onDuplicate: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const src = SOURCE_LABELS[dash.sourceType] ?? { label: dash.sourceType, color: "bg-gray-100 text-gray-700" };
  const isArchived = dash.status === "archived";

  return (
    <Card
      className="group relative overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={onOpen}
    >
      {/* Color stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: dash.color ?? "#6b7280" }}
      />

      <CardHeader className="pt-5 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl">{dash.icon ?? "📊"}</span>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight truncate">{dash.name}</CardTitle>
              {dash.description && (
                <CardDescription className="mt-0.5 line-clamp-2 text-xs">{dash.description}</CardDescription>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
              onClick={onToggleFavorite}
              title={dash.isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
            >
              {dash.isFavorite
                ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                : <StarOff className="h-4 w-4 text-muted-foreground" />}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onOpen}>
                  <Eye className="mr-2 h-4 w-4" /> Ver dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {!isArchived && onArchive && (
                  <DropdownMenuItem onClick={onArchive}>
                    <Archive className="mr-2 h-4 w-4" /> Archivar
                  </DropdownMenuItem>
                )}
                {isArchived && onRestore && (
                  <DropdownMenuItem onClick={onRestore}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Restaurar
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${src.color}`}>
              {src.label}
            </span>
            {dash.category && (
              <span className="text-xs text-muted-foreground capitalize">{dash.category}</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(dash.updatedAt).toLocaleDateString("es-AR")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── CreateFromPromptModal ─────────────────────────────────────────────────────

function CreateFromPromptModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<GeneratedDashboard | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [step, setStep] = useState<"input" | "preview">("input");

  const previewMutation = useMutation({
    mutationFn: () => apiFetch<{ preview: boolean; run: { id: number }; generated: GeneratedDashboard }>(
      "/api/studio/generate-from-prompt",
      { method: "POST", body: JSON.stringify({ prompt, save: false }) }
    ),
    onSuccess: (data) => {
      setPreview(data.generated);
      setRunId(data.run.id);
      setStep("preview");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: () => apiFetch<{ dashboard: Dashboard }>(
      "/api/studio/generate-from-prompt",
      { method: "POST", body: JSON.stringify({ prompt, save: true }) }
    ),
    onSuccess: (data) => {
      toast({ title: "Dashboard creado", description: `"${data.dashboard.name}" listo` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setPrompt("");
    setPreview(null);
    setRunId(null);
    setStep("input");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Crear desde prompt
          </DialogTitle>
          <DialogDescription>
            Describí qué querés ver en tu dashboard y el sistema lo genera automáticamente
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4">
            <Textarea
              placeholder="Ej: Dashboard de control fiscal para clientes con vencimientos próximos, semáforo y alertas..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              className="resize-none"
            />

            <div>
              <p className="text-xs text-muted-foreground mb-2">Ejemplos:</p>
              <div className="flex flex-wrap gap-2">
                {PROMPT_EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors text-left"
                    onClick={() => setPrompt(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setStep("input")}
            >
              <ArrowLeft className="h-4 w-4" /> Volver al prompt
            </button>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{preview.icon}</span>
                <div>
                  <h3 className="font-semibold text-base">{preview.name}</h3>
                  <p className="text-sm text-muted-foreground">{preview.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="capitalize">{preview.category}</Badge>
                <Badge variant="outline" className="text-xs">
                  Confianza: {Math.round(preview.parsedIntent.confidence * 100)}%
                </Badge>
                {preview.parsedIntent.secondaryDomains.map(d => (
                  <Badge key={d} variant="outline" className="text-xs capitalize">{d}</Badge>
                ))}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Widgets sugeridos ({preview.widgets.length}):
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {preview.widgets.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border bg-muted/30">
                      {WIDGET_ICONS[w.type] ?? <BarChart2 className="h-4 w-4" />}
                      <span className="truncate">{w.title}</span>
                    </div>
                  ))}
                </div>
              </div>

              {preview.filters.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Filtros:</p>
                  <div className="flex gap-2 flex-wrap">
                    {(preview.filters as Array<{ label: string }>).map((f, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{f.label}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          {step === "input" && (
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={prompt.trim().length < 5 || previewMutation.isPending}
            >
              {previewMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando...</>
              ) : (
                <><Wand2 className="mr-2 h-4 w-4" /> Previsualizar</>
              )}
            </Button>
          )}
          {step === "preview" && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Crear dashboard</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── TemplateGallery ───────────────────────────────────────────────────────────

function TemplateGallery({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["studio-templates"],
    queryFn: () => apiFetch("/api/studio/templates"),
    enabled: open,
  });

  const filtered = useMemo(() =>
    templates.filter(t =>
      !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.category?.toLowerCase().includes(search.toLowerCase())
    ), [templates, search]
  );

  const useMutationFn = useMutation({
    mutationFn: (t: Template) => apiFetch<{ dashboard: Dashboard }>(
      "/api/studio/generate-from-template",
      { method: "POST", body: JSON.stringify({ templateKey: t.key }) }
    ),
    onSuccess: (data) => {
      toast({ title: "Dashboard creado", description: `"${data.dashboard.name}" creado desde plantilla` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={() => { onClose(); setSelected(null); setSearch(""); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookTemplate className="h-5 w-5 text-blue-500" />
            Galería de plantillas
          </DialogTitle>
          <DialogDescription>Elegí una plantilla para empezar rápido</DialogDescription>
        </DialogHeader>

        {!selected && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar plantillas..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 p-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 p-1">
                  {filtered.map(t => (
                    <button
                      key={t.key}
                      className="text-left p-4 rounded-lg border hover:border-primary hover:shadow-sm transition-all group"
                      onClick={() => setSelected(t)}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{t.icon}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{t.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                          <span
                            className="mt-2 inline-block text-xs px-2 py-0.5 rounded-full bg-muted capitalize"
                          >
                            {t.category}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {selected && (
          <div className="flex-1 overflow-y-auto space-y-4">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft className="h-4 w-4" /> Volver a la galería
            </button>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{selected.icon}</span>
                <div>
                  <h3 className="font-semibold">{selected.name}</h3>
                  <p className="text-sm text-muted-foreground">{selected.description}</p>
                </div>
              </div>

              {selected.configJson.widgets && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Incluye {selected.configJson.widgets.length} widgets:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(selected.configJson.widgets as Array<{ type: string; title: string }>).map((w, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border bg-muted/30">
                        {WIDGET_ICONS[w.type] ?? <BarChart2 className="h-4 w-4" />}
                        <span className="truncate">{w.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setSelected(null); setSearch(""); }}>
            Cancelar
          </Button>
          {selected && (
            <Button
              onClick={() => useMutationFn.mutate(selected)}
              disabled={useMutationFn.isPending}
            >
              {useMutationFn.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Usar plantilla</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── WizardModal ───────────────────────────────────────────────────────────────

function WizardModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [icon, setIcon] = useState("📊");
  const [description, setDescription] = useState("");
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>([]);

  const { data: widgetDefs = [] } = useQuery<WidgetDef[]>({
    queryKey: ["studio-widget-defs"],
    queryFn: () => apiFetch("/api/studio/widget-definitions"),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () => apiFetch<{ dashboard: Dashboard }>(
      "/api/studio/generate-from-wizard",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          icon,
          description,
          selectedWidgets: selectedWidgets.map(k => {
            const def = widgetDefs.find(d => d.key === k);
            return { type: k, title: def?.name ?? k, configJson: def?.defaultConfigJson ?? {} };
          }),
        }),
      }
    ),
    onSuccess: (data) => {
      toast({ title: "Dashboard creado", description: `"${data.dashboard.name}" listo` });
      onCreated(data.dashboard.id);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setStep(0); setName(""); setCategory("general"); setIcon("📊");
    setDescription(""); setSelectedWidgets([]);
    onClose();
  };

  const toggleWidget = (key: string) => {
    setSelectedWidgets(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const groupedWidgets = useMemo(() => {
    const groups: Record<string, WidgetDef[]> = {};
    for (const w of widgetDefs) {
      const cat = w.category ?? "otros";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(w);
    }
    return groups;
  }, [widgetDefs]);

  const steps = ["Información básica", "Elegir widgets", "Confirmar"];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-green-500" />
            Crear con wizard
          </DialogTitle>
          <DialogDescription>
            Paso {step + 1} de {steps.length}: {steps[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className={`h-1.5 rounded-full flex-1 transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === 0 && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Nombre del dashboard *</label>
                <Input
                  placeholder="Ej: Mi panel fiscal"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Descripción</label>
                <Textarea
                  placeholder="¿Para qué usarás este dashboard?"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Categoría</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WIZARD_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Ícono</label>
                <div className="flex gap-2 flex-wrap">
                  {DASHBOARD_ICONS.map(emoji => (
                    <button
                      key={emoji}
                      className={`text-2xl p-2 rounded-lg border-2 transition-colors hover:bg-muted ${icon === emoji ? "border-primary" : "border-transparent"}`}
                      onClick={() => setIcon(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Seleccioná los widgets que querés incluir ({selectedWidgets.length} seleccionados)
              </p>
              {Object.entries(groupedWidgets).map(([cat, widgets]) => (
                <div key={cat}>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 capitalize">
                    {cat}
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {widgets.map(w => (
                      <button
                        key={w.key}
                        className={`text-left p-3 rounded-lg border-2 transition-all ${
                          selectedWidgets.includes(w.key)
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground"
                        }`}
                        onClick={() => toggleWidget(w.key)}
                      >
                        <div className="flex items-center gap-2">
                          {WIDGET_ICONS[w.key] ?? <BarChart2 className="h-4 w-4" />}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{w.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{w.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{icon}</span>
                  <div>
                    <h3 className="font-semibold">{name}</h3>
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                    <Badge variant="secondary" className="mt-1 capitalize">{category}</Badge>
                  </div>
                </div>

                {selectedWidgets.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Widgets seleccionados ({selectedWidgets.length}):
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedWidgets.map(k => {
                        const def = widgetDefs.find(d => d.key === k);
                        return (
                          <div key={k} className="flex items-center gap-2 text-sm p-2 rounded border bg-muted/30">
                            {WIDGET_ICONS[k] ?? <BarChart2 className="h-4 w-4" />}
                            <span className="truncate">{def?.name ?? k}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedWidgets.length === 0 && (
                  <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                    No seleccionaste widgets. Se creará un dashboard vacío.
                  </p>
                )}
              </div>
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
                disabled={step === 0 && !name.trim()}
              >
                Siguiente <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name.trim()}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                ) : (
                  <><Plus className="mr-2 h-4 w-4" /> Crear dashboard</>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── WidgetRenderer ────────────────────────────────────────────────────────────

function WidgetRenderer({
  widget,
  data,
}: {
  widget: {
    id: number;
    type: string;
    title: string;
    subtitle?: string | null;
    dataSourceKey?: string | null;
    configJson?: Record<string, unknown>;
    visible?: boolean;
  };
  data?: unknown;
}) {
  const isEmpty = data === null || data === undefined;

  const renderContent = () => {
    if (isEmpty) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          {WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-8 w-8 opacity-30" />}
          <p className="text-xs mt-2">Sin datos</p>
        </div>
      );
    }

    switch (widget.type) {
      case "kpi_cards": {
        const d = data as Record<string, number>;
        return (
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(d).map(([k, v]) => (
              <div key={k} className="text-center p-3 rounded-lg bg-muted/40">
                <p className="text-2xl font-bold">{v}</p>
                <p className="text-xs text-muted-foreground capitalize">{k}</p>
              </div>
            ))}
          </div>
        );
      }

      case "traffic_light": {
        const d = data as { verde: number; amarillo: number; rojo: number; total: number };
        return (
          <div className="flex justify-around py-2">
            {[
              { color: "bg-green-500", label: "Al día", count: d.verde },
              { color: "bg-yellow-500", label: "Por vencer", count: d.amarillo },
              { color: "bg-red-500", label: "Vencidos", count: d.rojo },
            ].map(({ color, label, count }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-white font-bold`}>
                  {count}
                </div>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        );
      }

      case "dynamic_table":
      case "upcoming_due_dates": {
        const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Sin registros</p>;
        const keys = Object.keys(rows[0]).slice(0, 4);
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {keys.map(k => (
                    <th key={k} className="text-left py-1 pr-3 text-muted-foreground capitalize font-medium">
                      {k.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {keys.map(k => (
                      <td key={k} className="py-1.5 pr-3 truncate max-w-24">
                        {String(row[k] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case "news_feed":
      case "ranking": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex gap-2 items-start py-1 border-b last:border-0">
                <span className="text-muted-foreground text-xs mt-0.5 shrink-0 w-4">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{String(item.title ?? item.name ?? item.label ?? "")}</p>
                  {item.source && <p className="text-xs text-muted-foreground">{String(item.source)}</p>}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "alerts_list": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-green-600 py-4 text-center">Sin alertas activas ✓</p>
            ) : items.slice(0, 5).map((item, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-100">
                <Bell className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm truncate">{String(item.title ?? item.name ?? "")}</p>
              </div>
            ))}
          </div>
        );
      }

      case "recent_transactions": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <span className="text-sm truncate max-w-40">{String(item.description ?? item.title ?? "")}</span>
                <span className={`text-sm font-medium ${Number(item.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {item.amount ? `$${Number(item.amount).toLocaleString("es-AR")}` : ""}
                </span>
              </div>
            ))}
          </div>
        );
      }

      case "goals_progress": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-3">
            {items.slice(0, 4).map((g, i) => {
              const current = Number(g.currentAmount ?? 0);
              const target = Number(g.targetAmount ?? 1);
              const pct = Math.min(100, Math.round((current / target) * 100));
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{String(g.title ?? "Objetivo")}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      case "pending_tasks": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-1.5">
            {items.slice(0, 6).map((t, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="w-4 h-4 rounded border-2 border-muted-foreground/40 shrink-0" />
                <span className="text-sm truncate">{String(t.title ?? t.name ?? "")}</span>
              </div>
            ))}
          </div>
        );
      }

      case "text_block":
        return (
          <div className="prose prose-sm max-w-none">
            <p className="text-sm text-muted-foreground">
              {String((widget.configJson?.content as string) ?? "Sin contenido configurado")}
            </p>
          </div>
        );

      case "quick_links": {
        const links = (widget.configJson?.links as Array<{ label: string; url: string }>) ?? [];
        return links.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No hay links configurados</p>
        ) : (
          <div className="space-y-2">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline py-1"
                onClick={e => e.stopPropagation()}
              >
                <Link className="h-3 w-3" /> {l.label}
              </a>
            ))}
          </div>
        );
      }

      default:
        return (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            {WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-8 w-8 opacity-30" />}
            <p className="text-xs mt-2">Widget: {widget.type}</p>
          </div>
        );
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-4 w-4" />}</span>
          <div>
            <CardTitle className="text-sm">{widget.title}</CardTitle>
            {widget.subtitle && <CardDescription className="text-xs">{widget.subtitle}</CardDescription>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-4 pb-4 overflow-hidden">
        {renderContent()}
      </CardContent>
    </Card>
  );
}

// ── DashboardViewer ───────────────────────────────────────────────────────────

function DashboardViewer({ dashId, onBack }: { dashId: number; onBack: () => void }) {
  const { toast } = useToast();

  const { data: dash, isLoading } = useQuery<Dashboard & {
    widgets: Array<{ id: number; type: string; title: string; subtitle?: string | null; dataSourceKey?: string | null; configJson?: Record<string, unknown>; visible?: boolean; orderIndex: number }>;
    filters: unknown[];
    layouts: unknown[];
  }>({
    queryKey: ["studio-dashboard", dashId],
    queryFn: () => apiFetch(`/api/studio/dashboards/${dashId}`),
  });

  const { data: widgetData = {} } = useQuery<Record<number, unknown>>({
    queryKey: ["studio-dashboard-data", dashId],
    queryFn: () => apiFetch(`/api/studio/dashboards/${dashId}/data`),
    enabled: !!dash,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  if (!dash) return <p className="text-muted-foreground">Dashboard no encontrado</p>;

  const visibleWidgets = (dash.widgets ?? [])
    .filter(w => w.visible !== false)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-3xl">{dash.icon ?? "📊"}</span>
          <div>
            <h1 className="text-xl font-bold">{dash.name}</h1>
            {dash.description && <p className="text-sm text-muted-foreground">{dash.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{dash.category}</Badge>
          <Badge variant={dash.status === "active" ? "default" : "secondary"} className="capitalize">
            {dash.status}
          </Badge>
        </div>
      </div>

      {/* Widgets grid */}
      {visibleWidgets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-16 text-center">
          <LayoutGrid className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="font-medium text-muted-foreground">Sin widgets</h3>
          <p className="text-sm text-muted-foreground mt-1">Este dashboard no tiene widgets configurados todavía</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleWidgets.map(w => (
            <WidgetRenderer key={w.id} widget={w} data={widgetData[w.id]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main StudioPage ───────────────────────────────────────────────────────────

export default function StudioPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState("mine");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dashboard | null>(null);
  const [viewingDash, setViewingDash] = useState<number | null>(null);

  const { data: dashboards = [], isLoading } = useQuery<Dashboard[]>({
    queryKey: ["studio-dashboards", tab],
    queryFn: () => apiFetch(`/api/studio/dashboards?tab=${tab}`),
  });

  const filtered = useMemo(() =>
    dashboards.filter(d =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.description?.toLowerCase().includes(search.toLowerCase()) ||
      d.category?.toLowerCase().includes(search.toLowerCase())
    ), [dashboards, search]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["studio-dashboards"] });
  };

  async function handleAction(path: string, method = "POST") {
    try {
      await apiFetch(path, { method });
      invalidate();
      toast({ title: "Acción realizada" });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleDelete(dash: Dashboard) {
    try {
      await apiFetch(`/api/studio/dashboards/${dash.id}`, { method: "DELETE" });
      invalidate();
      toast({ title: "Dashboard eliminado" });
      setDeleteTarget(null);
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleToggleFavorite(dash: Dashboard) {
    try {
      await apiFetch(`/api/studio/dashboards/${dash.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isFavorite: !dash.isFavorite }),
      });
      invalidate();
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    }
  }

  const handleCreated = (id: number) => {
    setShowPrompt(false);
    setShowTemplates(false);
    setShowWizard(false);
    invalidate();
    setViewingDash(id);
  };

  if (viewingDash !== null) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <DashboardViewer dashId={viewingDash} onBack={() => { setViewingDash(null); invalidate(); }} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span>📊</span> Dashboard Studio
            </h1>
            <p className="text-muted-foreground mt-1">
              Creá y gestioná dashboards dinámicos personalizados
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowTemplates(true)}>
              <BookTemplate className="mr-2 h-4 w-4" />
              Plantillas
            </Button>
            <Button variant="outline" onClick={() => setShowWizard(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Wizard
            </Button>
            <Button onClick={() => setShowPrompt(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Crear desde prompt
            </Button>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: <Sparkles className="h-6 w-6 text-purple-500" />,
              title: "Desde prompt",
              desc: "Describí lo que querés ver",
              action: () => setShowPrompt(true),
            },
            {
              icon: <BookTemplate className="h-6 w-6 text-blue-500" />,
              title: "Desde plantilla",
              desc: "10 plantillas prediseñadas",
              action: () => setShowTemplates(true),
            },
            {
              icon: <Settings className="h-6 w-6 text-green-500" />,
              title: "Con wizard",
              desc: "Paso a paso personalizado",
              action: () => setShowWizard(true),
            },
          ].map(({ icon, title, desc, action }) => (
            <button
              key={title}
              className="text-left p-4 rounded-lg border-2 border-dashed hover:border-solid hover:border-primary/50 hover:bg-muted/50 transition-all group"
              onClick={action}
            >
              <div className="mb-2">{icon}</div>
              <p className="font-medium text-sm">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </button>
          ))}
        </div>

        {/* Search + view toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar dashboards..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(v => v === "grid" ? "list" : "grid")}
          >
            {viewMode === "grid" ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="mine">Mis dashboards</TabsTrigger>
            <TabsTrigger value="shared">Compartidos</TabsTrigger>
            <TabsTrigger value="archived">Archivados</TabsTrigger>
          </TabsList>

          {["mine", "shared", "archived"].map(t => (
            <TabsContent key={t} value={t} className="mt-4">
              {isLoading ? (
                <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed p-16 text-center">
                  <LayoutGrid className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                  <h3 className="font-medium text-muted-foreground">
                    {tab === "mine" ? "Todavía no creaste ningún dashboard" : "Sin dashboards"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {tab === "mine" ? "Empezá con un prompt, una plantilla o el wizard" : ""}
                  </p>
                  {tab === "mine" && (
                    <Button className="mt-4" onClick={() => setShowPrompt(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Crear mi primer dashboard
                    </Button>
                  )}
                </div>
              ) : (
                <div className={`grid gap-4 ${viewMode === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
                  {filtered.map(d => (
                    <DashboardCard
                      key={d.id}
                      dash={d}
                      onOpen={() => setViewingDash(d.id)}
                      onDuplicate={() => handleAction(`/api/studio/dashboards/${d.id}/duplicate`)}
                      onArchive={tab !== "archived" ? () => handleAction(`/api/studio/dashboards/${d.id}/archive`) : undefined}
                      onRestore={tab === "archived" ? () => handleAction(`/api/studio/dashboards/${d.id}/restore`) : undefined}
                      onDelete={() => setDeleteTarget(d)}
                      onToggleFavorite={() => handleToggleFavorite(d)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Modals */}
      <CreateFromPromptModal
        open={showPrompt}
        onClose={() => setShowPrompt(false)}
        onCreated={handleCreated}
      />
      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onCreated={handleCreated}
      />
      <WizardModal
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onCreated={handleCreated}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar dashboard</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar "{deleteTarget?.name}"? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
