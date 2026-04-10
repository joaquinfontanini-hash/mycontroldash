import { useState, useMemo } from "react";
import { useListNews, getListNewsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Newspaper, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { value: "afip_arca", label: "ARCA / AFIP", keywords: ["afip", "arca", "monotributo", "iva", "ganancias", "bienes personales", "moratorio", "regularización fiscal"] },
  { value: "rentas", label: "Rentas", keywords: ["rentas", "ingresos brutos", "rentas provinciales", "rentas neuquén"] },
  { value: "contabilidad", label: "Contabilidad", keywords: ["contador", "contabilidad", "balance", "auditoría", "auditoria", "estados contables", "factura", "facturación"] },
  { value: "dolar", label: "Dólar", keywords: ["dólar", "dolar", "divisas", "blue", "oficial", "mep", "ccl", "cripto", "brecha cambiaria"] },
  { value: "inflacion", label: "Inflación", keywords: ["inflación", "inflacion", "ipc", "cpi", "precios", "canasta básica", "tarifas"] },
  { value: "mercados", label: "Mercados", keywords: ["merval", "bolsa", "acciones", "bonos", "renta fija", "cedear", "s&p", "nasdaq", "dow jones"] },
  { value: "finanzas", label: "Finanzas", keywords: ["finanzas", "financiero", "banca", "crédito", "deuda", "fmi", "banco central", "bcra"] },
  { value: "negocios", label: "Negocios", dbCategory: "negocios", keywords: ["empresa", "pyme", "negocio", "emprendimiento", "inversión", "inversion"] },
  { value: "energia", label: "Energía", keywords: ["energía", "energia", "petróleo", "petroleo", "gas", "vaca muerta", "ypf", "combustible", "nafta", "gasoil"] },
  { value: "agro", label: "Agro", keywords: ["agro", "campo", "soja", "cereal", "cosecha", "trigo", "maíz", "maiz", "agroindustria"] },
  { value: "politica", label: "Política", keywords: ["política", "politica", "gobierno", "congreso", "diputados", "senado", "elecciones", "ejecutivo"] },
  { value: "internacional", label: "Internacional", keywords: ["internacional", "exterior", "mundo", "eeuu", "estados unidos", "brasil", "china", "fmi", "banco mundial"] },
  { value: "tecnologia", label: "Tecnología", keywords: ["tecnología", "tecnologia", "tech", "ia", "inteligencia artificial", "digital", "software", "innovación"] },
  { value: "laboral", label: "Laboral", keywords: ["empleo", "trabajo", "sueldo", "salario", "convenio", "sindicato", "laboral", "indemnización"] },
  { value: "legislacion", label: "Legislación", keywords: ["ley", "decreto", "resolución", "resolucion", "normativa", "reglamento", "legislación", "ordenanza"] },
  { value: "boletines", label: "Boletines", keywords: ["boletín oficial", "boletin oficial", "registro oficial", "publicación oficial"] },
];

interface SourceEntry {
  name: string;
  shortName: string;
  initials: string;
  avatarBg: string;
  avatarText: string;
  ringColor: string;
  badgeBg: string;
}

const SOURCE_CATALOG: SourceEntry[] = [
  {
    name: "Ámbito",
    shortName: "Ámbito",
    initials: "ÁM",
    avatarBg: "bg-orange-500/15",
    avatarText: "text-orange-600 dark:text-orange-400",
    ringColor: "ring-orange-500/50",
    badgeBg: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  },
  {
    name: "La Nación",
    shortName: "La Nación",
    initials: "LN",
    avatarBg: "bg-violet-500/15",
    avatarText: "text-violet-600 dark:text-violet-400",
    ringColor: "ring-violet-500/50",
    badgeBg: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  {
    name: "Diario Río Negro",
    shortName: "Río Negro",
    initials: "RN",
    avatarBg: "bg-emerald-500/15",
    avatarText: "text-emerald-600 dark:text-emerald-400",
    ringColor: "ring-emerald-500/50",
    badgeBg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  {
    name: "Clarín",
    shortName: "Clarín",
    initials: "CL",
    avatarBg: "bg-rose-500/15",
    avatarText: "text-rose-600 dark:text-rose-400",
    ringColor: "ring-rose-500/50",
    badgeBg: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  {
    name: "Tributum",
    shortName: "Tributum",
    initials: "TR",
    avatarBg: "bg-cyan-500/15",
    avatarText: "text-cyan-600 dark:text-cyan-400",
    ringColor: "ring-cyan-500/50",
    badgeBg: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
  {
    name: "Contadores en Red",
    shortName: "Cont. en Red",
    initials: "CR",
    avatarBg: "bg-lime-500/15",
    avatarText: "text-lime-600 dark:text-lime-500",
    ringColor: "ring-lime-500/50",
    badgeBg: "bg-lime-500/10 text-lime-700 dark:text-lime-400",
  },
];

function getSourceStyle(sourceName: string): string {
  const entry = SOURCE_CATALOG.find(s => s.name === sourceName);
  return entry?.badgeBg ?? "bg-muted text-muted-foreground";
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
  const categoryLabel = CATEGORIES.find(c => c.value === selectedCategory)?.label;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="flex gap-2">
          {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-full shrink-0" />)}
        </div>
        <div className="flex gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[72px] w-[76px] rounded-xl shrink-0" />)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl text-destructive p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-sm">
        Error al cargar noticias. Verificá la conexión e intentá de nuevo.
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-0">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pb-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualidad económica, fiscal y regional
            {" · "}
            <span className="font-semibold text-foreground">{filteredNews.length}</span>
            {" artículos"}
            {lastRefreshed && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                · Actualizado {lastRefreshed}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 h-8 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando…" : "Actualizar"}
        </Button>
      </div>

      {/* ── Filter panel ───────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card/50 divide-y divide-border/60 mb-6">

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar en noticias…"
              className="w-full h-8 pl-8 pr-8 text-sm rounded-lg bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Categoría</span>
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory("")}
                className="text-[10px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
              >
                limpiar
              </button>
            )}
          </div>
          <div className="relative">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {CATEGORIES.map(cat => {
                const active = selectedCategory === cat.value;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setSelectedCategory(cat.value)}
                    className={`
                      shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium
                      border whitespace-nowrap transition-all duration-150
                      ${active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-transparent text-muted-foreground border-border/60 hover:border-border hover:text-foreground hover:bg-muted/40"
                      }
                    `}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-card/80 to-transparent" />
          </div>
        </div>

        {/* Source icons */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Medios</span>
            {activeSources.length > 0 && (
              <>
                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                  {activeSources.length}
                </span>
                <button
                  onClick={() => setActiveSources([])}
                  className="text-[10px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
                >
                  limpiar
                </button>
              </>
            )}
          </div>
          <div className="relative">
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
              {SOURCE_CATALOG.map(entry => {
                const active = activeSources.includes(entry.name);
                return (
                  <button
                    key={entry.name}
                    onClick={() => toggleSource(entry.name)}
                    title={entry.name}
                    className={`
                      shrink-0 flex flex-col items-center gap-1.5 w-[76px] pt-2.5 pb-2 px-1 rounded-xl
                      border transition-all duration-150 group
                      ${active
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "border-transparent hover:border-border/60 hover:bg-muted/30"
                      }
                    `}
                  >
                    <div className={`
                      h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0
                      transition-all duration-150
                      ${entry.avatarBg} ${entry.avatarText}
                      ${active ? `ring-2 ${entry.ringColor}` : "group-hover:ring-1 group-hover:ring-border/60"}
                    `}>
                      {entry.initials}
                    </div>
                    <span className={`
                      text-[10px] font-medium leading-tight text-center w-full px-0.5
                      transition-colors duration-150 line-clamp-2
                      ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"}
                    `}>
                      {entry.shortName}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-card/80 to-transparent" />
          </div>
        </div>

        {/* Active filter pills */}
        {activeFilterCount > 0 && (
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground mr-0.5">Filtrando:</span>
            {categoryLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
                {categoryLabel}
                <button onClick={() => setSelectedCategory("")} className="ml-0.5 hover:text-primary/60 transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
            {activeSources.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border/60 text-[11px] font-medium text-foreground/80">
                {s}
                <button onClick={() => toggleSource(s)} className="ml-0.5 hover:text-muted-foreground transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {search.trim() && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border/60 text-[11px] font-medium text-foreground/80">
                "{search.trim()}"
                <button onClick={() => setSearch("")} className="ml-0.5 hover:text-muted-foreground transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
            <button
              onClick={clearAllFilters}
              className="ml-1 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              limpiar todo
            </button>
          </div>
        )}
      </div>

      {/* ── News grid ──────────────────────────────────────── */}
      {filteredNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
          <Newspaper className="h-10 w-10 text-muted-foreground/25 mb-4" />
          <h3 className="text-base font-semibold mb-1">Sin resultados</h3>
          <p className="text-muted-foreground text-sm mb-5 max-w-xs">
            {activeFilterCount > 0
              ? "No hay artículos para los filtros seleccionados."
              : "No hay artículos en la base de datos todavía."}
          </p>
          {activeFilterCount > 0 ? (
            <Button variant="outline" size="sm" onClick={clearAllFilters}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Limpiar filtros
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Cargar noticias
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredNews.map(article => (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
            >
              <Card className="h-full flex flex-col border-border/60 hover:border-primary/30 transition-all duration-200 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20">
                <CardHeader className="pb-2 flex-none">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${getSourceStyle(article.source)}`}>
                      {article.source}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70 truncate">
                      {new Date(article.date).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <CardTitle className="text-[15px] font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-150">
                    {article.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex-1 flex flex-col justify-between">
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                    {article.summary}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground/60 capitalize border border-border/50 rounded px-1.5 py-0.5">
                      {article.category}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary/60 transition-colors duration-150 shrink-0" />
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
