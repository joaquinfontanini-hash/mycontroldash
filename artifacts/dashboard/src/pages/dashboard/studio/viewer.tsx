import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Pencil, Share2, RefreshCw, Monitor, Smartphone, Star } from "lucide-react";
import { BASE } from "@/lib/base-url";
import { WidgetRenderer } from "./components/WidgetRenderer";
import { DashboardFiltersBar, type FilterValues } from "./components/DashboardFiltersBar";
import type { DashboardFull, DashboardWidget, WidgetData, Breakpoint, LayoutItem } from "./types";

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

function detectBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

interface DashboardViewerProps {
  dashId: number;
  onBack: () => void;
  onEdit?: (id: number) => void;
  onShare?: (dash: DashboardFull) => void;
}

export function DashboardViewer({ dashId, onBack, onEdit, onShare }: DashboardViewerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>(detectBreakpoint);
  // T003: active filter values — drive data refetch when changed
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const { data: dash, isLoading } = useQuery<DashboardFull>({
    queryKey: ["studio-dashboard", dashId],
    queryFn: () => apiFetch(`api/studio/dashboards/${dashId}`),
  });

  // Derive refresh interval from dashboard config (min 30s, default 60s if not set)
  const refreshIntervalMs = dash?.refreshIntervalSeconds
    ? Math.max(dash.refreshIntervalSeconds, 30) * 1000
    : 60000;

  // Build filter query param — only if there are active filters
  const filtersParam = Object.keys(filterValues).length > 0
    ? `?filters=${encodeURIComponent(JSON.stringify(filterValues))}`
    : "";

  const { data: widgetDataRaw = {}, refetch: refetchData, isFetching } = useQuery<Record<number, WidgetData>>({
    queryKey: ["studio-dashboard-data", dashId, filterValues],
    queryFn: () => apiFetch(`api/studio/dashboards/${dashId}/data${filtersParam}`),
    enabled: !!dash,
    refetchInterval: refreshIntervalMs,
  });

  const refreshSnapshotMutation = useMutation({
    mutationFn: async (widgetId: number) => {
      const res = await apiFetch(`api/studio/widgets/${widgetId}/refresh-snapshot`, { method: "POST" });
      return { widgetId, ...res };
    },
    onSuccess: (data) => {
      qc.setQueryData(["studio-dashboard-data", dashId], (old: Record<number, WidgetData> | undefined) => ({
        ...(old ?? {}),
        [data.widgetId]: { data: data.data, fromSnapshot: false, snapshotStatus: data.snapshotStatus },
      }));
      toast({ title: "Widget actualizado" });
    },
    onError: () => {
      toast({ title: "Error al refrescar", variant: "destructive" });
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`api/studio/dashboards/${dashId}`, {
        method: "PATCH",
        body: JSON.stringify({ isFavorite: !dash?.isFavorite }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-dashboard", dashId] }),
  });

  const handleRefreshSnapshot = useCallback((widgetId: number) => {
    refreshSnapshotMutation.mutate(widgetId);
  }, [refreshSnapshotMutation]);

  if (isLoading) return <ViewerSkeleton />;
  if (!dash) return <p className="text-muted-foreground p-6">Dashboard no encontrado</p>;

  const visibleWidgets = (dash.widgets ?? []).filter(w => w.visible !== false);

  // Get layout for current breakpoint (fallback chain: mobile→tablet→desktop if not found)
  const getLayout = (): LayoutItem[] | null => {
    const layouts = dash.layouts ?? [];
    const forBreakpoint = layouts.find(l => l.breakpoint === activeBreakpoint);
    if (forBreakpoint) return forBreakpoint.layoutJson;
    // Fallback
    if (activeBreakpoint === "tablet") {
      const desktop = layouts.find(l => l.breakpoint === "desktop");
      if (desktop) return desktop.layoutJson;
    }
    if (activeBreakpoint === "mobile") {
      const desktop = layouts.find(l => l.breakpoint === "desktop");
      if (desktop) {
        // Auto-stack: convert to single-column
        return [...desktop.layoutJson]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((item, i) => ({ ...item, x: 0, y: i * 5, w: 12, h: 5 }));
      }
    }
    return null;
  };

  const layout = getLayout();

  // Build ordered widgets: layout order if available, else orderIndex
  const orderedWidgets = layout
    ? layout
        .map(item => visibleWidgets.find(w => w.id === item.widgetId))
        .filter((w): w is DashboardWidget => !!w)
    : [...visibleWidgets].sort((a, b) => a.orderIndex - b.orderIndex);

  const gridCols = activeBreakpoint === "mobile" ? 1 : 3;

  // D1: Build column-span map from layout (w: 1-3 on a 3-col grid, 1 on mobile)
  // Handles both 3-col system (w=1,2,3) and legacy 12-col system (w=4,8,12)
  const colSpanMap = new Map<number, number>();
  if (layout) {
    for (const item of layout) {
      if (activeBreakpoint === "mobile") { colSpanMap.set(item.widgetId, 1); continue; }
      const rawW = item.w ?? 1;
      const span = rawW >= 4
        ? Math.min(Math.max(Math.round(rawW / 4), 1), gridCols)  // legacy 12-col → 3-col
        : Math.min(Math.max(rawW, 1), gridCols);                  // new 3-col system
      colSpanMap.set(item.widgetId, span);
    }
  }

  const canEdit = dash._access === "owner" || dash._access === "admin" || dash._access === "edit";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-3xl">{dash.icon ?? "📊"}</span>
          <div>
            <h1 className="text-xl font-bold leading-tight">{dash.name}</h1>
            {dash.description && (
              <p className="text-sm text-muted-foreground">{dash.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Breakpoint toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <Button
              variant={activeBreakpoint === "desktop" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-3"
              onClick={() => setActiveBreakpoint("desktop")}
            >
              <Monitor className="h-3 w-3" />
            </Button>
            <Button
              variant={activeBreakpoint === "mobile" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-3"
              onClick={() => setActiveBreakpoint("mobile")}
            >
              <Smartphone className="h-3 w-3" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleFavoriteMutation.mutate()}
          >
            <Star className={`h-4 w-4 ${dash.isFavorite ? "fill-yellow-400 text-yellow-400" : ""}`} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchData()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>

          {onShare && (
            <Button variant="outline" size="sm" onClick={() => onShare(dash)}>
              <Share2 className="h-4 w-4 mr-1" />
              Compartir
            </Button>
          )}

          {canEdit && onEdit && (
            <Button size="sm" onClick={() => onEdit(dashId)}>
              <Pencil className="h-4 w-4 mr-1" />
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="capitalize">{dash.category}</Badge>
        <Badge variant={dash.status === "active" ? "default" : "secondary"} className="capitalize">
          {dash.status === "active" ? "Activo" : dash.status === "draft" ? "Borrador" : dash.status}
        </Badge>
        {dash.status === "draft" && canEdit && (
          <span className="text-xs text-muted-foreground">• Este dashboard está en borrador</span>
        )}
      </div>

      {/* T003: Global filters bar — rendered only when filters are defined for this dashboard */}
      {(dash.filters ?? []).length > 0 && (
        <DashboardFiltersBar
          filters={dash.filters}
          onChange={setFilterValues}
        />
      )}

      {/* Widgets grid */}
      {orderedWidgets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-16 text-center">
          <p className="text-muted-foreground font-medium">Sin widgets</p>
          <p className="text-sm text-muted-foreground mt-1">
            {canEdit ? "Entrá al editor para agregar widgets." : "Este dashboard no tiene widgets configurados."}
          </p>
          {canEdit && onEdit && (
            <Button className="mt-4" onClick={() => onEdit(dashId)}>
              <Pencil className="mr-2 h-4 w-4" />
              Abrir editor
            </Button>
          )}
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {orderedWidgets.map(w => {
            const colSpan = colSpanMap.get(w.id) ?? 1;
            return (
              <div
                key={w.id}
                className="min-h-48"
                style={colSpan > 1 ? { gridColumn: `span ${colSpan}` } : undefined}
              >
                <WidgetRenderer
                  widget={w}
                  widgetData={widgetDataRaw[w.id]}
                  dashboardId={dashId}
                  onRefreshSnapshot={handleRefreshSnapshot}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}
