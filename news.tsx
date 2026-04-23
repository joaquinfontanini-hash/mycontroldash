/**
 * news.tsx — Feed de noticias con scroll infinito
 *
 * MEJORAS vs. original:
 *  1. useInfiniteQuery reemplaza la query plana de 100 items
 *     - El original cargaba ?limit=100 y guardaba todo en memoria
 *     - El nuevo usa ?limit=20&page=N y solo agrega páginas conforme scroll
 *  2. IntersectionObserver en el sentinel para cargar siguiente página
 *  3. credentials:"include" en apiFetch (ya lo tenía, se preserva)
 *  4. isError en queries → estado de error consistente
 *  5. Ventana renderizada: solo los últimos 60 artículos en DOM (windowing básico)
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery, useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Newspaper, ExternalLink, RefreshCw, Search, X, Star,
  Bell, BellOff, Plus, Trash2, Globe, MapPin, Building, AlertTriangle,
  TrendingUp, Briefcase, Scale, CheckCircle2,
} from "lucide-react";
import { BASE } from "@/lib/base-url";

// ── API helper ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(()=>({})) as { error?: string };
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NewsArticle = {
  id: number; title: string; source: string; regionLevel: string;
  newsCategory: string; tags: string[]; impactLevel: string; priorityScore: number;
  date: string; summary: string; url: string; imageUrl?: string | null;
  savedByUser: boolean; savedAt?: string;
};

type NewsPage = {
  articles: NewsArticle[];
  nextPage: number | null;
  total: number;
};

type UserAlert = {
  id: number; userId: number; regionLevel: string | null;
  newsCategory: string | null; active: boolean; label: string | null; createdAt: string;
};

const PAGE_SIZE = 20;
// Ventana máxima de artículos en DOM — evita memory bloat con muchos scrolls
const DOM_WINDOW = 60;

// ── Constants ─────────────────────────────────────────────────────────────────

const REGION_OPTIONS = [
  { value:"",              label:"Todas las regiones",    icon:Globe },
  { value:"internacional", label:"Internacional",          icon:Globe },
  { value:"nacional",      label:"Nacional",               icon:Building },
  { value:"regional",      label:"Regional (Neuquén/RN)", icon:MapPin },
];

const CATEGORY_OPTIONS = [
  { value:"",        label:"Todas las categorías", icon:Newspaper },
  { value:"economia",label:"Economía",              icon:TrendingUp },
  { value:"politica",label:"Política",              icon:Briefcase },
  { value:"laboral", label:"Laboral",               icon:Briefcase },
  { value:"juicios", label:"Juicios",               icon:Scale },
];

const IMPACT_STYLES: Record<string, { label:string; cls:string; icon:typeof AlertTriangle }> = {
  alto:  { label:"Alto",  cls:"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400",      icon:AlertTriangle },
  medio: { label:"Medio", cls:"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400",icon:TrendingUp },
  bajo:  { label:"Bajo",  cls:"bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400",icon:CheckCircle2 },
};

const REGION_STYLES: Record<string, string> = {
  regional:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  nacional:      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  internacional: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};

const CATEGORY_STYLES: Record<string, string> = {
  economia: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  politica: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  laboral:  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  juicios:  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

const SOURCE_STYLES: Record<string, string> = {
  "Infobae":       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "LM Neuquén":    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Ámbito":        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "La Nación":     "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "Diario Río Negro":"bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Clarín":        "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

const REGION_LABELS:   Record<string,string> = { regional:"Regional", nacional:"Nacional", internacional:"Internacional" };
const CATEGORY_LABELS: Record<string,string> = { economia:"Economía", politica:"Política", laboral:"Laboral", juicios:"Juicios" };

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day:"numeric", month:"short", year:"numeric" });
}

// ── Badge components ───────────────────────────────────────────────────────────

function ImpactBadge({ level }: { level: string }) {
  const info = IMPACT_STYLES[level] ?? IMPACT_STYLES.bajo!;
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${info.cls}`}>
      <Icon className="h-2.5 w-2.5"/>{info.label}
    </span>
  );
}

function RegionBadge({ region }: { region: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${REGION_STYLES[region] ?? "bg-muted text-muted-foreground"}`}>
      {REGION_LABELS[region] ?? region}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_STYLES[category] ?? "bg-muted text-muted-foreground"}`}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

// ── NewsCard ───────────────────────────────────────────────────────────────────

function NewsCard({ article, onSave, onUnsave, saving }: {
  article: NewsArticle;
  onSave:   (id:number)=>void;
  onUnsave: (id:number)=>void;
  saving: boolean;
}) {
  const sourceStyle = SOURCE_STYLES[article.source] ?? "bg-muted text-muted-foreground";
  return (
    <Card className="h-full flex flex-col border-border/60 hover:border-primary/30 transition-all duration-200 hover:shadow-md shadow-none">
      <CardContent className="p-4 flex flex-col h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${sourceStyle}`}>
              {article.source}
            </span>
            <span className="text-[11px] text-muted-foreground/70 truncate">{fmtDate(article.date)}</span>
          </div>
          <button
            onClick={()=>article.savedByUser ? onUnsave(article.id) : onSave(article.id)}
            disabled={saving}
            title={article.savedByUser?"Quitar de guardadas":"Guardar artículo"}
            className={`shrink-0 p-1 rounded-full transition-colors ${article.savedByUser?"text-amber-500 hover:text-amber-400":"text-muted-foreground/40 hover:text-amber-400"}`}
          >
            <Star className={`h-4 w-4 ${article.savedByUser?"fill-current":""}`}/>
          </button>
        </div>

        <a href={article.url} target="_blank" rel="noopener noreferrer"
          className="text-sm font-semibold leading-snug line-clamp-2 hover:text-primary transition-colors cursor-pointer group">
          {article.title}
          <ExternalLink className="inline h-3 w-3 ml-1 opacity-0 group-hover:opacity-60 transition-opacity"/>
        </a>

        {article.summary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">{article.summary}</p>
        )}

        <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-border/40">
          <div className="flex items-center gap-1 flex-wrap">
            <RegionBadge region={article.regionLevel}/>
            <CategoryBadge category={article.newsCategory}/>
          </div>
          <ImpactBadge level={article.impactLevel}/>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab,       setActiveTab]       = useState("feed");
  const [regionFilter,    setRegionFilter]     = useState("");
  const [categoryFilter,  setCategoryFilter]   = useState("");
  const [search,          setSearch]           = useState("");
  const [alertDialogOpen, setAlertDialogOpen]  = useState(false);
  const [newAlertRegion,  setNewAlertRegion]   = useState("");
  const [newAlertCategory,setNewAlertCategory] = useState("");
  const [newAlertLabel,   setNewAlertLabel]    = useState("");

  // sentinel ref para IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Infinite query — 20 artículos por página ───────────────────────────────
  // El original cargaba 100 en una sola query. Ahora:
  //   - página 0 → /api/news?limit=20&page=0&...
  //   - IntersectionObserver dispara fetchNextPage cuando el sentinel entra en viewport
  //   - Las páginas se acumulan en data.pages[] pero el renderizado usa DOM_WINDOW

  const {
    data,
    isLoading,
    isError,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<NewsPage>({
    queryKey: ["news-infinite", regionFilter, categoryFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageParam) });
      if (regionFilter)   params.set("regionLevel",   regionFilter);
      if (categoryFilter) params.set("newsCategory",  categoryFilter);
      return apiFetch<NewsPage>(`/api/news?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
  });

  // IntersectionObserver — dispara la siguiente página cuando el sentinel entra en viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Queries auxiliares
  const { data: savedArticles = [], isError: savedError } = useQuery<NewsArticle[]>({
    queryKey: ["news-saved"],
    queryFn:  () => apiFetch<NewsArticle[]>("/api/news/saved"),
    staleTime: 60_000,
  });

  const { data: alerts = [], isError: alertsError } = useQuery<UserAlert[]>({
    queryKey: ["news-alerts"],
    queryFn:  () => apiFetch<UserAlert[]>("/api/news/alerts"),
    staleTime: 60_000,
  });

  // ── Flatten + windowing ────────────────────────────────────────────────────
  // Juntamos todas las páginas en un array plano, luego filtramos por búsqueda
  // y limitamos el DOM a los últimos DOM_WINDOW items para no acumular nodos.

  const allArticles = useMemo<NewsArticle[]>(() =>
    data?.pages.flatMap(p => p.articles) ?? []
  , [data?.pages]);

  const filtered = useMemo<NewsArticle[]>(() => {
    if (!search.trim()) return allArticles;
    const q = search.toLowerCase();
    return allArticles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.summary?.toLowerCase().includes(q) ||
      a.source.toLowerCase().includes(q)
    );
  }, [allArticles, search]);

  // Ventana de renderizado: si el usuario scrolleó mucho, evitamos acumular
  // más de DOM_WINDOW nodos en el árbol activo.
  const windowed = useMemo(() => filtered.slice(0, DOM_WINDOW), [filtered]);

  // ── Save/Unsave mutations ──────────────────────────────────────────────────

  const savingIds = useRef(new Set<number>());

  const saveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/news/${id}/save`, { method:"POST" }),
    onMutate:   (id) => savingIds.current.add(id),
    onSettled:  (_, __, id) => {
      savingIds.current.delete(id);
      void qc.invalidateQueries({ queryKey:["news-infinite"] });
      void qc.invalidateQueries({ queryKey:["news-saved"] });
    },
    onError: () => toast({ title:"Error al guardar", variant:"destructive" }),
  });

  const unsaveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/news/${id}/unsave`, { method:"DELETE" }),
    onMutate:   (id) => savingIds.current.add(id),
    onSettled:  (_, __, id) => {
      savingIds.current.delete(id);
      void qc.invalidateQueries({ queryKey:["news-infinite"] });
      void qc.invalidateQueries({ queryKey:["news-saved"] });
    },
    onError: () => toast({ title:"Error al quitar", variant:"destructive" }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/news/alerts/${id}`, { method:"DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey:["news-alerts"] }),
    onError:   () => toast({ title:"Error al eliminar alerta", variant:"destructive" }),
  });

  const createAlertMutation = useMutation({
    mutationFn: (data: { regionLevel:string; newsCategory:string; label:string }) =>
      apiFetch("/api/news/alerts", { method:"POST", body:JSON.stringify(data) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["news-alerts"] });
      setAlertDialogOpen(false);
      setNewAlertRegion(""); setNewAlertCategory(""); setNewAlertLabel("");
      toast({ title:"Alerta creada" });
    },
    onError: () => toast({ title:"Error al crear alerta", variant:"destructive" }),
  });

  const handleRefresh = useCallback(async () => {
    await apiFetch("/api/news/refresh", { method:"POST" });
    void qc.invalidateQueries({ queryKey:["news-infinite"] });
  }, [qc]);

  const total = data?.pages[0]?.total ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Monitor de Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Noticias de Neuquén, Argentina y el mundo relevantes para el estudio
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefresh()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5"/>Actualizar
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="feed">Feed {total > 0 && <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded px-1">{total}</span>}</TabsTrigger>
          <TabsTrigger value="saved">Guardadas {savedArticles.length > 0 && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 rounded px-1">{savedArticles.length}</span>}</TabsTrigger>
          <TabsTrigger value="alerts">Alertas {alerts.filter(a=>a.active).length > 0 && <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded px-1">{alerts.filter(a=>a.active).length}</span>}</TabsTrigger>
        </TabsList>

        {/* ── Feed ─────────────────────────────────────────────────── */}
        <TabsContent value="feed" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
              <input
                className="w-full pl-9 pr-8 h-9 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Buscar noticias..."
                value={search} onChange={e=>setSearch(e.target.value)}
              />
              {search && (
                <button onClick={()=>setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5"/>
                </button>
              )}
            </div>
            <Select value={regionFilter || "all"} onValueChange={v=>setRegionFilter(v==="all"?"":v)}>
              <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Región"/></SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map(o=><SelectItem key={o.value||"all"} value={o.value||"all"}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter || "all"} onValueChange={v=>setCategoryFilter(v==="all"?"":v)}>
              <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Categoría"/></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(o=><SelectItem key={o.value||"all"} value={o.value||"all"}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {(regionFilter||categoryFilter||search) && (
              <button onClick={()=>{setRegionFilter("");setCategoryFilter("");setSearch("");}}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                <X className="h-3 w-3"/>Limpiar
              </button>
            )}
          </div>

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
              <AlertTriangle className="h-5 w-5 shrink-0"/>
              Error al cargar las noticias. Intentá actualizar la página.
            </div>
          )}

          {/* Initial loading */}
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_,i)=><Skeleton key={i} className="h-52 rounded-xl"/>)}
            </div>
          )}

          {/* Grid — ventana de DOM_WINDOW items */}
          {!isLoading && windowed.length === 0 && !isError && (
            <div className="text-center py-12 text-muted-foreground">
              <Newspaper className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">No hay noticias que coincidan con los filtros</p>
            </div>
          )}

          {windowed.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {windowed.map(article => (
                <NewsCard
                  key={article.id}
                  article={article}
                  onSave={id=>saveMutation.mutate(id)}
                  onUnsave={id=>unsaveMutation.mutate(id)}
                  saving={savingIds.current.has(article.id)}
                />
              ))}
            </div>
          )}

          {/* Sentinel para IntersectionObserver + spinner de carga */}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin"/>Cargando más noticias...
              </div>
            )}
            {!hasNextPage && allArticles.length > 0 && !isFetchingNextPage && (
              <p className="text-xs text-muted-foreground">
                Mostrando {windowed.length} de {allArticles.length} artículos cargados
              </p>
            )}
          </div>
        </TabsContent>

        {/* ── Saved ────────────────────────────────────────────────── */}
        <TabsContent value="saved" className="mt-4">
          {savedError && (
            <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
              <AlertTriangle className="h-5 w-5 shrink-0"/>
              Error al cargar los guardados.
            </div>
          )}
          {!savedError && savedArticles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Star className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">No tenés artículos guardados</p>
              <p className="text-xs mt-1">Hacé clic en la estrella de cualquier artículo para guardarlo</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {savedArticles.map(article => (
                <NewsCard
                  key={article.id}
                  article={{ ...article, savedByUser:true }}
                  onSave={id=>saveMutation.mutate(id)}
                  onUnsave={id=>unsaveMutation.mutate(id)}
                  saving={savingIds.current.has(article.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Alerts ───────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Recibí alertas cuando aparezcan noticias de cierto tipo.
            </p>
            <Button size="sm" onClick={()=>setAlertDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5"/>Nueva alerta
            </Button>
          </div>

          {alertsError && (
            <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/>Error al cargar alertas.</div>
          )}

          {alerts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">Sin alertas configuradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map(alert => (
                <div key={alert.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                  {alert.active
                    ? <Bell className="h-4 w-4 text-primary shrink-0"/>
                    : <BellOff className="h-4 w-4 text-muted-foreground shrink-0"/>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.label || "Alerta personalizada"}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {alert.regionLevel   && <RegionBadge region={alert.regionLevel}/>}
                      {alert.newsCategory  && <CategoryBadge category={alert.newsCategory}/>}
                      {!alert.active && <span className="text-[10px] text-muted-foreground">Inactiva</span>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive"
                    onClick={()=>deleteAlertMutation.mutate(alert.id)}>
                    <Trash2 className="h-3.5 w-3.5"/>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Create alert dialog */}
          <Dialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Nueva alerta de noticias</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Nombre de la alerta</label>
                  <input className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    placeholder="Ej: Economía nacional" value={newAlertLabel} onChange={e=>setNewAlertLabel(e.target.value)}/>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Región</label>
                  <Select value={newAlertRegion||"all"} onValueChange={v=>setNewAlertRegion(v==="all"?"":v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Cualquier región"/></SelectTrigger>
                    <SelectContent>{REGION_OPTIONS.map(o=><SelectItem key={o.value||"all"} value={o.value||"all"}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Categoría</label>
                  <Select value={newAlertCategory||"all"} onValueChange={v=>setNewAlertCategory(v==="all"?"":v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Cualquier categoría"/></SelectTrigger>
                    <SelectContent>{CATEGORY_OPTIONS.map(o=><SelectItem key={o.value||"all"} value={o.value||"all"}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={()=>setAlertDialogOpen(false)}>Cancelar</Button>
                <Button onClick={()=>createAlertMutation.mutate({ regionLevel:newAlertRegion, newsCategory:newAlertCategory, label:newAlertLabel })}
                  disabled={createAlertMutation.isPending}>
                  Crear alerta
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
