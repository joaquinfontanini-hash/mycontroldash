import { useState, useMemo, lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, BookTemplate, Settings, Search, Grid3X3, List, LayoutDashboard,
} from "lucide-react";
import { BASE } from "@/lib/base-url";
import { DashboardCard } from "./components/DashboardCard";
import { ShareDashboardDialog } from "./components/ShareDashboardDialog";
import { DashboardViewer } from "./viewer";
import type { Dashboard, DashboardFull } from "./types";

const CreateFromPromptModal = lazy(() => import("./modals/CreateFromPromptModal").then(m => ({ default: m.CreateFromPromptModal })));
const TemplateGallery        = lazy(() => import("./modals/TemplateGallery").then(m => ({ default: m.TemplateGallery })));
const WizardModal            = lazy(() => import("./modals/WizardModal").then(m => ({ default: m.WizardModal })));
// C3: Must be at module level — never inside a render function (breaks state on re-render)
const DashboardBuilder       = lazy(() => import("./builder").then(m => ({ default: m.DashboardBuilder })));

// ── API helper ────────────────────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewState =
  | { mode: "list" }
  | { mode: "view"; dashId: number }
  | { mode: "build"; dashId: number };

export default function StudioPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [viewState, setViewState] = useState<ViewState>({ mode: "list" });
  const [tab, setTab] = useState("mine");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [shareTarget, setShareTarget] = useState<Dashboard | null>(null);

  const { data: dashboards = [], isLoading } = useQuery<Dashboard[]>({
    queryKey: ["studio-dashboards", tab],
    queryFn: () => apiFetch(`api/studio/dashboards?tab=${tab}`),
    enabled: viewState.mode === "list",
  });

  const filtered = useMemo(() =>
    dashboards.filter(d =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.description?.toLowerCase().includes(search.toLowerCase()) ||
      d.category?.toLowerCase().includes(search.toLowerCase())
    ), [dashboards, search]
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["studio-dashboards"] });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const toggleFavoriteMutation = useMutation({
    mutationFn: (dash: Dashboard) =>
      apiFetch(`api/studio/dashboards/${dash.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isFavorite: !dash.isFavorite }),
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`api/studio/dashboards/${id}/archive`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "Dashboard archivado" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`api/studio/dashboards/${id}/restore`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "Dashboard restaurado" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`api/studio/dashboards/${id}/duplicate`, { method: "POST" }),
    onSuccess: (newDash) => {
      invalidate();
      toast({ title: "Dashboard duplicado" });
      setViewState({ mode: "view", dashId: newDash.id });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (dash: Dashboard) => apiFetch(`api/studio/dashboards/${dash.id}`, { method: "DELETE" }),
    onSuccess: (_, dash) => {
      invalidate();
      toast({ title: `"${dash.name}" eliminado` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreated = (id: number) => {
    setShowPrompt(false);
    setShowTemplates(false);
    setShowWizard(false);
    invalidate();
    setViewState({ mode: "view", dashId: id });
  };

  // ── Render states ─────────────────────────────────────────────────────────

  if (viewState.mode === "view") {
    return (
      <div className="flex-1 overflow-auto p-6">
        <DashboardViewer
          dashId={viewState.dashId}
          onBack={() => { setViewState({ mode: "list" }); invalidate(); }}
          onEdit={(id) => setViewState({ mode: "build", dashId: id })}
          onShare={(dash) => setShareTarget(dash)}
        />
        <ShareDashboardDialog
          dashboard={shareTarget}
          open={!!shareTarget}
          onClose={() => setShareTarget(null)}
        />
      </div>
    );
  }

  if (viewState.mode === "build") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Suspense fallback={<div className="p-6"><Skeleton className="h-12 w-full" /></div>}>
          <DashboardBuilder
            dashId={viewState.dashId}
            onBack={() => { setViewState({ mode: "view", dashId: viewState.dashId }); invalidate(); }}
            onPreview={(id) => setViewState({ mode: "view", dashId: id })}
          />
        </Suspense>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6 w-full">

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
            { icon: <Sparkles className="h-6 w-6 text-purple-500" />, title: "Desde prompt",     desc: "Describí lo que querés ver",     action: () => setShowPrompt(true) },
            { icon: <BookTemplate className="h-6 w-6 text-blue-500" />, title: "Desde plantilla", desc: "Elegí una plantilla lista",      action: () => setShowTemplates(true) },
            { icon: <Settings className="h-6 w-6 text-green-500" />,  title: "Con wizard",       desc: "Seleccioná widgets uno a uno",   action: () => setShowWizard(true) },
          ].map(({ icon, title, desc, action }) => (
            <button
              key={title}
              onClick={action}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border hover:border-primary hover:bg-muted/30 transition-all text-center"
            >
              {icon}
              <span className="font-medium text-sm">{title}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>

        {/* Tabs + search + view toggle */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Tabs value={tab} onValueChange={setTab} className="flex-1">
            <TabsList>
              <TabsTrigger value="mine">Mis dashboards</TabsTrigger>
              <TabsTrigger value="shared">Compartidos</TabsTrigger>
              <TabsTrigger value="favorites">Favoritos</TabsTrigger>
              <TabsTrigger value="archived">Archivados</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-8 h-9 w-48"
              />
            </div>
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Dashboard grid */}
        {isLoading ? (
          <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-2"}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={viewMode === "grid" ? "h-40" : "h-16"} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <LayoutDashboard className="h-12 w-12 opacity-20 mb-3" />
            <p className="font-medium">
              {search ? "Sin resultados para tu búsqueda" : tab === "archived" ? "Sin dashboards archivados" : "Sin dashboards aún"}
            </p>
            {!search && tab === "mine" && (
              <p className="text-sm mt-1">Usá el botón "Crear desde prompt" para empezar</p>
            )}
          </div>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-2"}>
            {filtered.map(d => (
              <DashboardCard
                key={d.id}
                dashboard={d}
                viewMode={viewMode}
                onView={(id) => setViewState({ mode: "view", dashId: id })}
                onEdit={(id) => setViewState({ mode: "build", dashId: id })}
                onToggleFavorite={(dash) => toggleFavoriteMutation.mutate(dash)}
                onArchive={(id) => archiveMutation.mutate(id)}
                onRestore={(id) => restoreMutation.mutate(id)}
                onDuplicate={(id) => duplicateMutation.mutate(id)}
                onDelete={(dash) => deleteMutation.mutate(dash)}
                onShare={(dash) => setShareTarget(dash)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <Suspense fallback={null}>
        {showPrompt && (
          <CreateFromPromptModal
            open={showPrompt}
            onClose={() => setShowPrompt(false)}
            onCreated={handleCreated}
          />
        )}
        {showTemplates && (
          <TemplateGallery
            open={showTemplates}
            onClose={() => setShowTemplates(false)}
            onCreated={handleCreated}
          />
        )}
        {showWizard && (
          <WizardModal
            open={showWizard}
            onClose={() => setShowWizard(false)}
            onCreated={handleCreated}
          />
        )}
      </Suspense>

      <ShareDashboardDialog
        dashboard={shareTarget}
        open={!!shareTarget}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}
