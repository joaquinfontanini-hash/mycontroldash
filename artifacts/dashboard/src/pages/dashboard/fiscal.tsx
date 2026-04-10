import { useState } from "react";
import {
  useListFiscalUpdates, useGetFiscalMetrics, useToggleFiscalSaved,
  getListFiscalUpdatesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, AlertTriangle, Bookmark, BookmarkCheck, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

const IMPACT_COLORS = {
  high: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  low: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};

const IMPACT_LABELS = { high: "Alto", medium: "Medio", low: "Bajo" };

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "requiresAction", label: "Requiere Acción" },
  { key: "high", label: "Alto Impacto" },
  { key: "saved", label: "Guardadas" },
];

export default function FiscalPage() {
  const [activeFilter, setActiveFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const { data: updates, isLoading: updatesLoading, error } = useListFiscalUpdates({
    impact: activeFilter === "high" ? "high" : undefined,
    requiresAction: activeFilter === "requiresAction" ? "true" : undefined,
  });
  const { data: metrics, isLoading: metricsLoading } = useGetFiscalMetrics();
  const toggleSaved = useToggleFiscalSaved();
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/fiscal/refresh", { method: "POST" });
      if (res.ok) {
        setLastRefreshed(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
        queryClient.invalidateQueries({ queryKey: getListFiscalUpdatesQueryKey() });
      }
    } catch {}
    setRefreshing(false);
  };

  const isLoading = updatesLoading || metricsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-52" />
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar monitor fiscal.</div>;
  }

  const displayed = activeFilter === "saved"
    ? (updates ?? []).filter(u => u.isSaved)
    : updates ?? [];

  const handleToggleSave = (id: number) => {
    toggleSaved.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFiscalUpdatesQueryKey() });
      },
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Monitor Fiscal</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualizaciones normativas e impositivas. AFIP, Rentas Neuquén y más.
            {lastRefreshed && (
              <span className="ml-1 text-green-600 dark:text-green-400">Actualizado a las {lastRefreshed}.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
      </div>

      {metrics && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { label: "Total", value: metrics.total, color: "text-foreground", bg: "bg-muted/60" },
            { label: "Alto Impacto", value: metrics.highImpact, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
            { label: "Requiere Acción", value: metrics.requiresAction, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
            { label: "Normativas", value: metrics.normative, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20" },
          ].map(m => (
            <Card key={m.label} className={`${m.bg} border-0`}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border
              ${activeFilter === f.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">Sin actualizaciones</h3>
            <p className="text-muted-foreground text-sm">No hay novedades para este filtro.</p>
          </div>
        ) : (
          displayed.map(update => (
            <Card key={update.id} className={`card-hover ${update.requiresAction ? "border-l-4 border-l-amber-500" : ""}`}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{update.organism}</Badge>
                      <Badge variant="secondary" className="text-xs">{update.jurisdiction}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(update.date).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <CardTitle className="text-base leading-snug">{update.title}</CardTitle>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${IMPACT_COLORS[update.impact as keyof typeof IMPACT_COLORS] ?? ""}`}>
                      Impacto {IMPACT_LABELS[update.impact as keyof typeof IMPACT_LABELS] ?? update.impact}
                    </span>
                    {update.requiresAction && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        Acción requerida
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/60 p-3.5 rounded-lg text-sm text-muted-foreground mb-3 leading-relaxed">
                  {update.summary}
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs capitalize">{update.category}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 text-xs gap-1.5 ${update.isSaved ? "text-primary" : "text-muted-foreground"}`}
                    onClick={() => handleToggleSave(update.id)}
                    disabled={toggleSaved.isPending}
                  >
                    {update.isSaved
                      ? <><BookmarkCheck className="h-3.5 w-3.5" /> Guardada</>
                      : <><Bookmark className="h-3.5 w-3.5" /> Guardar</>
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
