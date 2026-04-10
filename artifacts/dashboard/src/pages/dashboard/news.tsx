import { useState, useMemo } from "react";
import { useListNews, getListNewsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Newspaper, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";

interface CategoryDef {
  value: string;
  label: string;
  dbCategory?: string;
  keywords?: string[];
}

const CATEGORIES: CategoryDef[] = [
  { value: "", label: "Todas" },
  { value: "nacionales", label: "Nacionales", dbCategory: "nacionales" },
  { value: "provinciales", label: "Patagonia", dbCategory: "provinciales" },
  { value: "neuquen", label: "Neuquén", keywords: ["neuquén", "neuquen", "neuquino", "capital neuquina", "añelo"] },
  { value: "rionegro", label: "Río Negro", keywords: ["río negro", "rio negro", "rionegrino", "bariloche", "cipolletti", "general roca", "viedma"] },
  { value: "economia", label: "Economía", dbCategory: "economia" },
  { value: "impuestos", label: "Impuestos", dbCategory: "impuestos" },
  { value: "negocios", label: "Negocios", dbCategory: "negocios", keywords: ["empresa", "pyme", "negocio", "emprendimiento", "startup", "inversión", "inversion", "economía de negocios"] },
  { value: "finanzas", label: "Finanzas", keywords: ["finanzas", "financiero", "fintech", "banca", "crédito", "deuda"] },
  { value: "mercados", label: "Mercados", keywords: ["merval", "bolsa", "acciones", "bonos", "renta fija", "cedear", "s&p", "nasdaq", "dow"] },
  { value: "dolar", label: "Dólar", keywords: ["dólar", "dolar", "divisas", "blue", "oficial", "mep", "ccl", "cripto", "brecha"] },
  { value: "legislacion", label: "Legislación", keywords: ["ley", "decreto", "resolución", "resolucion", "normativa", "reglamento", "legislación", "ordenanza"] },
  { value: "laboral", label: "Laboral", keywords: ["empleo", "trabajo", "sueldo", "salario", "convenio", "sindicato", "laboral", "rrhh", "indemnización"] },
  { value: "energia", label: "Energía", keywords: ["energía", "energia", "petróleo", "petroleo", "gas", "vaca muerta", "ypf", "combustible", "nafta", "gasoil"] },
  { value: "agro", label: "Agro", keywords: ["agro", "campo", "soja", "cereal", "cosecha", "trigo", "maíz", "maiz", "agroindustria", "productor"] },
  { value: "contabilidad", label: "Contabilidad", keywords: ["contador", "contabilidad", "balance", "auditoría", "auditoria", "estados contables", "factura", "facturación"] },
  { value: "afip_arca", label: "ARCA / AFIP", keywords: ["afip", "arca", "monotributo", "iva", "ganancias", "bienes personales", "moratorio", "regularización fiscal"] },
  { value: "rentas", label: "Rentas", keywords: ["rentas", "ingresos brutos", "rentas provinciales", "rentas neuquén"] },
  { value: "boletines", label: "Boletines", keywords: ["boletín oficial", "boletin oficial", "registro oficial", "publicación oficial"] },
  { value: "empresas", label: "Empresas", keywords: ["empresa", "empresarial", "corporativo", "pyme", "startup", "inversión", "inversion"] },
];

interface SourceEntry {
  name: string;
  initials: string;
  bg: string;
  text: string;
  ring: string;
}

const SOURCE_CATALOG: SourceEntry[] = [
  { name: "Ámbito",            initials: "ÁM", bg: "bg-orange-100 dark:bg-orange-900/40",  text: "text-orange-700 dark:text-orange-300", ring: "ring-orange-400" },
  { name: "La Nación",         initials: "LN", bg: "bg-purple-100 dark:bg-purple-900/40",  text: "text-purple-700 dark:text-purple-300", ring: "ring-purple-400" },
  { name: "Diario Río Negro",  initials: "RN", bg: "bg-emerald-100 dark:bg-emerald-900/40",text: "text-emerald-700 dark:text-emerald-300",ring: "ring-emerald-400" },
  { name: "Clarín",            initials: "CL", bg: "bg-red-100 dark:bg-red-900/40",        text: "text-red-700 dark:text-red-300",      ring: "ring-red-400" },
  { name: "Tributum",          initials: "TR", bg: "bg-teal-100 dark:bg-teal-900/40",      text: "text-teal-700 dark:text-teal-300",    ring: "ring-teal-400" },
  { name: "Contadores en Red", initials: "CR", bg: "bg-lime-100 dark:bg-lime-900/40",      text: "text-lime-700 dark:text-lime-300",    ring: "ring-lime-400" },
];

const SOURCE_COLOR_MAP: Record<string, string> = {
  "Ámbito":            "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "La Nación":         "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "Diario Río Negro":  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Clarín":            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Tributum":          "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Contadores en Red": "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400",
};

function getSourceBadgeColor(source: string) {
  return SOURCE_COLOR_MAP[source] ?? "bg-muted text-muted-foreground";
}

function CategoryChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 border whitespace-nowrap
        ${active
          ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
          : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground hover:bg-muted/50"
        }`}
    >
      {label}
    </button>
  );
}

function SourceIcon({ entry, active, onClick }: { entry: SourceEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={entry.name}
      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-150 group min-w-[60px]
        ${active
          ? "bg-primary/8 ring-2 ring-primary/30 shadow-sm"
          : "hover:bg-muted/60"
        }`}
    >
      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-150 shrink-0
        ${entry.bg} ${entry.text}
        ${active ? `ring-2 ${entry.ring} ring-offset-1 ring-offset-background` : "group-hover:ring-1 group-hover:ring-border"}`}
      >
        {entry.initials}
      </div>
      <span className={`text-[10px] font-medium leading-tight text-center line-clamp-2 max-w-[56px] transition-colors
        ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
        {entry.name.length > 12 ? entry.name.split(" ").slice(0, 2).join(" ") : entry.name}
      </span>
    </button>
  );
}

function buildFilterSummary(categoryLabel: string, sources: string[], search: string): string | null {
  const parts: string[] = [];
  if (categoryLabel && categoryLabel !== "Todas") parts.push(categoryLabel);
  if (sources.length > 0) parts.push(sources.join(", "));
  if (search.trim()) parts.push(`"${search.trim()}"`);
  if (parts.length === 0) return null;
  return "Filtrando por: " + parts.join(" · ");
}

export default function NewsPage() {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: allNews, isLoading, error } = useListNews({ limit: 200 });

  const filteredNews = useMemo(() => {
    let items = allNews ?? [];

    if (selectedCategory) {
      const catDef = CATEGORIES.find(c => c.value === selectedCategory);
      if (catDef && (catDef.dbCategory || catDef.keywords)) {
        const kws = catDef.keywords ?? [];
        items = items.filter(n => {
          if (catDef.dbCategory && n.category === catDef.dbCategory) return true;
          if (kws.length > 0) {
            const text = `${n.title} ${n.summary}`.toLowerCase();
            return kws.some(kw => text.includes(kw));
          }
          return false;
        });
      }
    }

    if (activeSources.length > 0) {
      items = items.filter(n => activeSources.includes(n.source));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(n =>
        n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)
      );
    }

    return items;
  }, [allNews, selectedCategory, activeSources, search]);

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

  const toggleSource = (name: string) => {
    setActiveSources(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );
  };

  const clearAllFilters = () => {
    setSelectedCategory("");
    setActiveSources([]);
    setSearch("");
  };

  const activeFilterCount =
    (selectedCategory ? 1 : 0) + activeSources.length + (search.trim() ? 1 : 0);

  const categoryLabel = CATEGORIES.find(c => c.value === selectedCategory)?.label ?? "Todas";
  const filterSummary = buildFilterSummary(categoryLabel, activeSources, search);

  if (isLoading) {
    return (
      <div className="space-y-5 max-w-6xl">
        <Skeleton className="h-9 w-40" />
        <div className="flex gap-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
        </div>
        <div className="flex gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-16 rounded-xl" />)}
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

  return (
    <div className="space-y-0 max-w-6xl">
      <div className="flex items-start justify-between gap-4 pb-5">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualidad económica, fiscal y regional.{" "}
            <span className="font-medium text-foreground">{filteredNews.length}</span> artículos
            {lastRefreshed && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                · Actualizado a las {lastRefreshed}
              </span>
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

      <div className="space-y-4 pb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar en noticias..."
            className="pl-9 pr-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Categoría</span>
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory("")}
                className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                limpiar
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map(cat => (
              <CategoryChip
                key={cat.value}
                active={selectedCategory === cat.value}
                label={cat.label}
                onClick={() => setSelectedCategory(cat.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Medios</span>
            {activeSources.length > 0 && (
              <button
                onClick={() => setActiveSources([])}
                className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                limpiar
              </button>
            )}
            {activeSources.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {activeSources.length}
              </Badge>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {SOURCE_CATALOG.map(entry => (
              <SourceIcon
                key={entry.name}
                entry={entry}
                active={activeSources.includes(entry.name)}
                onClick={() => toggleSource(entry.name)}
              />
            ))}
          </div>
        </div>

        {(activeFilterCount > 0) && (
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
            <p className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-0">
              {filterSummary}
            </p>
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 shrink-0 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <X className="h-3 w-3" />
              Limpiar todo
            </button>
          </div>
        )}
      </div>

      {filteredNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Newspaper className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin resultados</h3>
          <p className="text-muted-foreground text-sm mb-5 max-w-xs">
            {activeFilterCount > 0
              ? "No hay artículos para los filtros seleccionados. Probá combinaciones diferentes."
              : "No hay artículos en la base de datos todavía."}
          </p>
          {activeFilterCount > 0 ? (
            <Button variant="outline" size="sm" onClick={clearAllFilters}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Limpiar filtros
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Cargar noticias ahora
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredNews.map(article => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block group">
              <Card className="h-full card-hover hover:border-primary/40 transition-all duration-200 hover:shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${getSourceBadgeColor(article.source)}`}>
                      {article.source}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {new Date(article.date).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-150">
                    {article.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">{article.summary}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] capitalize">{article.category}</Badge>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors duration-150" />
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
