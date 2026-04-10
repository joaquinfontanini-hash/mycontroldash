import { useState, useMemo } from "react";
import {
  useListFiscalUpdates, useGetFiscalMetrics, useToggleFiscalSaved,
  getListFiscalUpdatesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Briefcase, AlertTriangle, Bookmark, BookmarkCheck, RefreshCw,
  Search, X, SlidersHorizontal, ShieldCheck, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";

type FiscalItem = {
  id: number;
  title: string;
  jurisdiction: string;
  category: string;
  organism: string;
  date: string;
  impact: string;
  summary: string;
  requiresAction: boolean;
  isSaved: boolean;
  isNormative?: boolean;
  sourceUrl?: string | null;
  tags?: string | null;
  qualityScore?: number;
  qualityIssues?: string | null;
  needsReview?: boolean;
  isHidden?: boolean;
  createdAt: string;
};

function qualityColor(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (score >= 60) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

function qualityLabel(score: number) {
  if (score >= 80) return "Verificado";
  if (score >= 60) return "Aceptable";
  return "Revisar";
}

function parseIssues(raw?: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

const IMPACT_COLORS = {
  high: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  low: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};
const IMPACT_LABELS = { high: "Alto", medium: "Medio", low: "Bajo" };

const QUICK_FILTERS = [
  { key: "all", label: "Todas" },
  { key: "requiresAction", label: "Requiere Acción" },
  { key: "high", label: "Alto Impacto" },
  { key: "normative", label: "Normativas" },
  { key: "saved", label: "Guardadas" },
];

const DATE_RANGES = [
  { key: "all", label: "Todo" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "90d", label: "Últimos 90 días" },
];

export default function FiscalPage() {
  const [quickFilter, setQuickFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [qualityMin, setQualityMin] = useState(40);

  const { data: updates, isLoading: updatesLoading, error } = useListFiscalUpdates({
    impact: quickFilter === "high" ? "high" : undefined,
    requiresAction: quickFilter === "requiresAction" ? "true" : undefined,
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

  const handleToggleSave = (id: number) => {
    toggleSaved.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFiscalUpdatesQueryKey() }),
    });
  };

  const displayed = useMemo(() => {
    let items = (updates ?? []) as FiscalItem[];

    // Quality threshold
    items = items.filter(u => (u.qualityScore ?? 70) >= qualityMin);

    if (quickFilter === "saved") items = items.filter(u => u.isSaved);
    if (quickFilter === "normative") items = items.filter(u => u.isNormative);

    if (categoryFilter !== "all") {
      items = items.filter(u => u.category === categoryFilter);
    }

    if (dateRange !== "all") {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      items = items.filter(u => {
        try { return new Date(u.date) >= cutoff; } catch { return true; }
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(u =>
        u.title.toLowerCase().includes(q) ||
        u.summary.toLowerCase().includes(q) ||
        u.organism.toLowerCase().includes(q) ||
        u.category.toLowerCase().includes(q),
      );
    }

    return items;
  }, [updates, quickFilter, categoryFilter, dateRange, searchQuery]);

  const categories = useMemo(() => {
    const cats = [...new Set(((updates ?? []) as FiscalItem[]).map(u => u.category).filter(Boolean))];
    return cats.sort();
  }, [updates]);

  const isLoading = updatesLoading || metricsLoading;

  const hasActiveFilters = categoryFilter !== "all" || dateRange !== "all" || searchQuery.trim() !== "" || qualityMin > 40;

  const clearFilters = () => {
    setCategoryFilter("all");
    setDateRange("all");
    setSearchQuery("");
    setQualityMin(40);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-52" />
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        Error al cargar el Monitor Fiscal. Intentá actualizar la página.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Monitor Fiscal</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualizaciones normativas e impositivas. AFIP, Rentas Neuquén y más.
            {lastRefreshed && (
              <span className="ml-1 text-green-600 dark:text-green-400">
                Actualizado a las {lastRefreshed}.
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
      </div>

      {metrics && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { label: "Total visible", value: metrics.total, color: "text-foreground", bg: "bg-muted/60" },
            { label: "Alto Impacto", value: metrics.highImpact, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
            { label: "Requiere Acción", value: metrics.requiresAction, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
            { label: "Calidad promedio", value: metrics.avgQualityScore != null ? `${metrics.avgQualityScore}` : "–", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
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

      {metrics && (metrics.needsReview ?? 0) > 0 && (
        <div className="flex items-center gap-2.5 text-sm rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            {metrics.needsReview} {metrics.needsReview === 1 ? "registro requiere" : "registros requieren"} revisión manual de fuente.
            {(metrics.discarded ?? 0) > 0 && ` ${metrics.discarded} fueron descartados automáticamente por calidad insuficiente.`}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border
                ${quickFilter === f.key
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                }`}
            >
              {f.label}
            </button>
          ))}

          <button
            onClick={() => setShowFilters(v => !v)}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border
              ${showFilters || hasActiveFilters
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros avanzados
            {hasActiveFilters && (
              <span className="h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {(categoryFilter !== "all" ? 1 : 0) + (dateRange !== "all" ? 1 : 0) + (searchQuery ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="grid gap-3 sm:grid-cols-3 p-4 rounded-xl border bg-muted/30">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Buscar</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Título, organismo..."
                  className="pl-9 h-8 text-sm"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Categoría</p>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Todas las categorías" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Período</p>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGES.map(r => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Calidad mínima: <span className="text-foreground normal-case">{qualityMin}</span>
              </p>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={qualityMin}
                onChange={e => setQualityMin(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">Oculta registros con puntuación por debajo de este valor</p>
            </div>

            {hasActiveFilters && (
              <div className="sm:col-span-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground">
                  <X className="h-3 w-3 mr-1" /> Limpiar filtros
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {displayed.length === 0 ? (
          <Empty className="border-2 border-dashed py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Briefcase />
              </EmptyMedia>
              <EmptyTitle>Sin actualizaciones</EmptyTitle>
              <EmptyDescription>
                {hasActiveFilters
                  ? "No hay resultados para los filtros aplicados."
                  : "No hay novedades fiscales para este criterio."}
              </EmptyDescription>
            </EmptyHeader>
            {hasActiveFilters && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Limpiar filtros
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          displayed.map(update => {
            const score = update.qualityScore ?? 70;
            const issues = parseIssues(update.qualityIssues);
            return (
              <Card
                key={update.id}
                className={`card-hover ${update.needsReview ? "border-l-4 border-l-amber-400" : update.requiresAction ? "border-l-4 border-l-amber-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">{update.organism}</Badge>
                        <Badge variant="secondary" className="text-xs">{update.jurisdiction}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(update.date).toLocaleDateString("es-AR", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${qualityColor(score)}`}>
                          <ShieldCheck className="h-2.5 w-2.5" />
                          {score} · {qualityLabel(score)}
                        </span>
                      </div>
                      <CardTitle className="text-base leading-snug">{update.title}</CardTitle>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${IMPACT_COLORS[update.impact as keyof typeof IMPACT_COLORS] ?? ""}`}>
                        Impacto {IMPACT_LABELS[update.impact as keyof typeof IMPACT_LABELS] ?? update.impact}
                      </span>
                      {update.needsReview && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          Requiere revisión
                        </span>
                      )}
                      {update.requiresAction && (
                        <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 font-medium">
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
                  {issues.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {issues.map((issue, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted/80 text-muted-foreground flex items-center gap-1">
                          <Info className="h-2.5 w-2.5 shrink-0" /> {issue}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs capitalize">{update.category}</Badge>
                      {update.isNormative && (
                        <Badge variant="secondary" className="text-xs">Normativa</Badge>
                      )}
                      {update.sourceUrl && (
                        <a
                          href={update.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Ver fuente
                        </a>
                      )}
                    </div>
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
            );
          })
        )}
      </div>

      {displayed.length > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          Mostrando {displayed.length} de {updates?.length ?? 0} actualizaciones
        </p>
      )}
    </div>
  );
}
