import { useState } from "react";
import { useListNews, getListNewsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Newspaper, ExternalLink, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = [
  { value: "", label: "Todas" },
  { value: "nacionales", label: "Nacionales" },
  { value: "provinciales", label: "Patagonia" },
  { value: "economia", label: "Economía" },
  { value: "impuestos", label: "Impuestos" },
  { value: "negocios", label: "Negocios" },
];

const ALL_SOURCES = [
  "Ámbito", "La Nación", "Diario Río Negro", "Clarín", "Tributum", "Contadores en Red",
];

const SOURCE_COLORS: Record<string, string> = {
  "AFIP": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Infobae": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  "Ámbito": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "La Nación": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "El Cronista": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "Diario Río Negro": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "LM Neuquén": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  "iProfesional": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  "Clarín": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Página 12": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Tributum": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Contadores en Red": "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400",
};

function getSourceColor(source: string) {
  return SOURCE_COLORS[source] ?? "bg-muted text-muted-foreground";
}

function FilterChip({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 border whitespace-nowrap
        ${active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
        }`}
    >
      {label}
    </button>
  );
}

export default function NewsPage() {
  const [category, setCategory] = useState("");
  const [activeSource, setActiveSource] = useState("");
  const [showSourceFilter, setShowSourceFilter] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: news, isLoading, error } = useListNews(
    {
      category: category || undefined,
      limit: activeSource ? 200 : undefined,
    },
  );

  const filteredNews = activeSource
    ? (news ?? []).filter(n => n.source === activeSource)
    : (news ?? []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/news/refresh", { method: "POST" });
      if (res.ok) {
        setLastRefreshed(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
        queryClient.invalidateQueries({ queryKey: getListNewsQueryKey() });
      }
    } catch {}
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="flex gap-2">
          {CATEGORIES.map(c => <Skeleton key={c.value} className="h-7 w-20 rounded-full" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        Error al cargar noticias.
      </div>
    );
  }

  const hasFilters = category !== "" || activeSource !== "";

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualidad económica, fiscal y regional. {filteredNews.length} artículos
            {activeSource && ` de ${activeSource}`}.
            {lastRefreshed && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400">Actualizado a las {lastRefreshed}.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSourceFilter(!showSourceFilter)}
            className={showSourceFilter ? "border-primary text-primary" : ""}
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Medios
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <FilterChip
              key={cat.value}
              active={category === cat.value}
              label={cat.label}
              onClick={() => setCategory(cat.value)}
            />
          ))}
          {hasFilters && (
            <button
              onClick={() => { setCategory(""); setActiveSource(""); }}
              className="px-3 py-1 rounded-full text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {showSourceFilter && (
          <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/30 rounded-xl border">
            <span className="text-xs font-medium text-muted-foreground mr-1">Medio:</span>
            <FilterChip active={activeSource === ""} label="Todos" onClick={() => setActiveSource("")} />
            {ALL_SOURCES.map(src => (
              <FilterChip
                key={src}
                active={activeSource === src}
                label={src}
                onClick={() => setActiveSource(activeSource === src ? "" : src)}
              />
            ))}
          </div>
        )}
      </div>

      {filteredNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Newspaper className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin noticias</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasFilters ? "No hay artículos para los filtros seleccionados." : "No hay artículos en la base de datos todavía."}
          </p>
          {!hasFilters && (
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Cargar noticias ahora
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredNews.map(article => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block group">
              <Card className="h-full card-hover hover:border-primary/40 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${getSourceColor(article.source)}`}>
                      {article.source}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(article.date).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {article.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">{article.summary}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] capitalize">{article.category}</Badge>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
