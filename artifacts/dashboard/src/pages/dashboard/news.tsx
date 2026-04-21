import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
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
  Newspaper, ExternalLink, RefreshCw, Search, X, Star, StarOff,
  Bell, BellOff, Plus, Trash2, Globe, MapPin, Building, AlertTriangle,
  TrendingUp, Briefcase, Scale, CheckCircle2,
} from "lucide-react";

import { BASE } from "@/lib/base-url";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? `HTTP ${res.status}`;
    console.error(`[News] apiFetch error: ${opts?.method ?? "GET"} ${url} → ${res.status}`, body);
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NewsArticle = {
  id: number;
  title: string;
  source: string;
  regionLevel: string;
  newsCategory: string;
  tags: string[];
  impactLevel: string;
  priorityScore: number;
  date: string;
  summary: string;
  url: string;
  imageUrl?: string | null;
  savedByUser: boolean;
  savedAt?: string;
};

type UserAlert = {
  id: number;
  userId: number;
  regionLevel: string | null;
  newsCategory: string | null;
  active: boolean;
  label: string | null;
  createdAt: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REGION_OPTIONS = [
  { value: "",              label: "Todas las regiones",   icon: Globe },
  { value: "internacional", label: "Internacional",         icon: Globe },
  { value: "nacional",      label: "Nacional",              icon: Building },
  { value: "regional",      label: "Regional (Neuquén/RN)", icon: MapPin },
];

const CATEGORY_OPTIONS = [
  { value: "",          label: "Todas las categorías", icon: Newspaper },
  { value: "economia",  label: "Economía",              icon: TrendingUp },
  { value: "politica",  label: "Política",              icon: Briefcase },
  { value: "laboral",   label: "Laboral",               icon: Briefcase },
  { value: "juicios",   label: "Juicios",               icon: Scale },
];

const IMPACT_STYLES: Record<string, { label: string; cls: string; icon: typeof AlertTriangle }> = {
  alto:  { label: "Alto",  cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400",      icon: AlertTriangle },
  medio: { label: "Medio", cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400", icon: TrendingUp },
  bajo:  { label: "Bajo",  cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400",   icon: CheckCircle2 },
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
  "Infobae":          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "LM Neuquén":       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Ámbito":           "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "La Nación":        "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "Diario Río Negro": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Clarín":           "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

const REGION_LABELS: Record<string, string> = {
  regional: "Regional",
  nacional: "Nacional",
  internacional: "Internacional",
};

const CATEGORY_LABELS: Record<string, string> = {
  economia: "Economía",
  politica: "Política",
  laboral: "Laboral",
  juicios: "Juicios",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

// ── News fetchers ─────────────────────────────────────────────────────────────

const fetchNews = (regionLevel?: string, newsCategory?: string) =>
  apiFetch<NewsArticle[]>(`/api/news?limit=100${regionLevel ? `&regionLevel=${regionLevel}` : ""}${newsCategory ? `&newsCategory=${newsCategory}` : ""}`);

const fetchSaved = () => apiFetch<NewsArticle[]>("/api/news/saved");
const fetchAlerts = () => apiFetch<UserAlert[]>("/api/news/alerts");

// ── Shared components ─────────────────────────────────────────────────────────

function ImpactBadge({ level }: { level: string }) {
  const info = IMPACT_STYLES[level] ?? IMPACT_STYLES.bajo;
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${info.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {info.label}
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

// ── News Card ─────────────────────────────────────────────────────────────────

function NewsCard({
  article,
  onSave,
  onUnsave,
  saving,
}: {
  article: NewsArticle;
  onSave: (id: number) => void;
  onUnsave: (id: number) => void;
  saving: boolean;
}) {
  const sourceStyle = SOURCE_STYLES[article.source] ?? "bg-muted text-muted-foreground";

  return (
    <Card className="h-full flex flex-col border-border/60 hover:border-primary/30 transition-all duration-200 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20 shadow-none">
      <CardContent className="p-4 flex flex-col h-full gap-3">

        {/* Header row: source + date + save button */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${sourceStyle}`}>
              {article.source}
            </span>
            <span className="text-[11px] text-muted-foreground/70 truncate">
              {fmtDate(article.date)}
            </span>
          </div>
          <button
            onClick={() => article.savedByUser ? onUnsave(article.id) : onSave(article.id)}
            disabled={saving}
            title={article.savedByUser ? "Quitar de guardadas" : "Guardar artículo"}
            className={`shrink-0 p-1 rounded-full transition-colors ${article.savedByUser ? "text-amber-500 hover:text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`}
          >
            {article.savedByUser
              ? <Star className="h-4 w-4 fill-current" />
              : <Star className="h-4 w-4" />}
          </button>
        </div>

        {/* Title */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold leading-snug line-clamp-2 hover:text-primary transition-colors cursor-pointer group"
        >
          {article.title}
          <ExternalLink className="inline h-3 w-3 ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
        </a>

        {/* Summary */}
        {article.summary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">
            {article.summary}
          </p>
        )}

        {/* Footer: tags + impact + link */}
        <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-border/40">
          <div className="flex items-center gap-1 flex-wrap">
            <RegionBadge region={article.regionLevel} />
            <CategoryBadge category={article.newsCategory} />
            <ImpactBadge level={article.impactLevel} />
          </div>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary font-medium transition-colors"
          >
            Ver <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>

      </CardContent>
    </Card>
  );
}

// ── Filter Panel ──────────────────────────────────────────────────────────────

function FilterPanel({
  onlyToday, setOnlyToday,
  regionLevel, setRegionLevel,
  newsCategory, setNewsCategory,
  search, setSearch,
}: {
  onlyToday: boolean;
  setOnlyToday: (v: boolean) => void;
  regionLevel: string;
  setRegionLevel: (v: string) => void;
  newsCategory: string;
  setNewsCategory: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
}) {
  const activeCount = (onlyToday ? 1 : 0) + (regionLevel ? 1 : 0) + (newsCategory ? 1 : 0) + (search.trim() ? 1 : 0);

  const todayStr = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 divide-y divide-border/60">

      {/* Solo hoy — primer filtro */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyToday(!onlyToday)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              onlyToday
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-transparent text-muted-foreground border-border/60 hover:border-border hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <span className="text-sm">📅</span>
            Solo hoy
          </button>
          {onlyToday && (
            <span className="text-xs text-muted-foreground capitalize">{todayStr}</span>
          )}
        </div>
        {onlyToday && (
          <button onClick={() => setOnlyToday(false)} className="text-[10px] text-primary/70 hover:text-primary underline">
            limpiar
          </button>
        )}
      </div>

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
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters: Region + Category */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Region group */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Región</span>
            {regionLevel && (
              <button onClick={() => setRegionLevel("")} className="text-[10px] text-primary/70 hover:text-primary underline ml-auto">
                limpiar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REGION_OPTIONS.map(opt => {
              const active = regionLevel === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setRegionLevel(opt.value)}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-all ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-transparent text-muted-foreground border-border/60 hover:border-border hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category group */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Newspaper className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Categoría</span>
            {newsCategory && (
              <button onClick={() => setNewsCategory("")} className="text-[10px] text-primary/70 hover:text-primary underline ml-auto">
                limpiar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map(opt => {
              const active = newsCategory === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setNewsCategory(opt.value)}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-all ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-transparent text-muted-foreground border-border/60 hover:border-border hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active filter pills */}
      {activeCount > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground mr-0.5">Filtrando:</span>
          {onlyToday && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
              📅 Hoy
              <button onClick={() => setOnlyToday(false)} className="ml-0.5 hover:text-primary/60">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {regionLevel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
              {REGION_OPTIONS.find(o => o.value === regionLevel)?.label}
              <button onClick={() => setRegionLevel("")} className="ml-0.5 hover:text-primary/60">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {newsCategory && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
              {CATEGORY_OPTIONS.find(o => o.value === newsCategory)?.label}
              <button onClick={() => setNewsCategory("")} className="ml-0.5 hover:text-primary/60">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {search.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border/60 text-[11px] font-medium text-foreground/80">
              "{search.trim()}"
              <button onClick={() => setSearch("")} className="ml-0.5 hover:text-muted-foreground">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          <button
            onClick={() => { setOnlyToday(false); setRegionLevel(""); setNewsCategory(""); setSearch(""); }}
            className="ml-1 text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            limpiar todo
          </button>
        </div>
      )}
    </div>
  );
}

// ── Alerts Section ────────────────────────────────────────────────────────────

function AlertsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newRegion, setNewRegion] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: alerts = [], isLoading } = useQuery<UserAlert[]>({
    queryKey: ["news-alerts"],
    queryFn: fetchAlerts,
  });

  const handleCreate = async () => {
    if (!newRegion && !newCategory) {
      toast({ title: "Seleccioná al menos una región o categoría", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/news/alerts", {
        method: "POST",
        body: JSON.stringify({
          regionLevel: newRegion || null,
          newsCategory: newCategory || null,
          label: newLabel.trim() || null,
        }),
      });
      toast({ title: "Alerta creada" });
      qc.invalidateQueries({ queryKey: ["news-alerts"] });
      setShowCreate(false);
      setNewRegion("");
      setNewCategory("");
      setNewLabel("");
    } catch (e: unknown) {
      toast({ title: "Error al crear alerta", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (alert: UserAlert) => {
    try {
      await apiFetch(`/api/news/alerts/${alert.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !alert.active }),
      });
      qc.invalidateQueries({ queryKey: ["news-alerts"] });
    } catch {
      toast({ title: "Error al actualizar alerta", variant: "destructive" });
    }
  };

  const handleDelete = async (alertId: number) => {
    try {
      await apiFetch(`/api/news/alerts/${alertId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["news-alerts"] });
      toast({ title: "Alerta eliminada" });
    } catch {
      toast({ title: "Error al eliminar alerta", variant: "destructive" });
    }
  };

  const describeAlert = (a: UserAlert) => {
    if (a.label) return a.label;
    const parts: string[] = [];
    if (a.newsCategory) parts.push(CATEGORY_LABELS[a.newsCategory] ?? a.newsCategory);
    if (a.regionLevel) parts.push(REGION_LABELS[a.regionLevel] ?? a.regionLevel);
    return parts.join(" + ") || "Todas las noticias";
  };

  if (isLoading) {
    return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Alertas personalizadas</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configura combinaciones de región + categoría para monitorear.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />Nueva alerta
        </Button>
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border/50 rounded-xl">
          <Bell className="h-10 w-10 text-muted-foreground/25 mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No tenés alertas configuradas.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Crear primera alerta
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${
                alert.active
                  ? "border-primary/20 bg-primary/3 dark:bg-primary/5"
                  : "border-border/40 bg-muted/20 opacity-60"
              }`}
            >
              {/* Active indicator */}
              <div className={`h-2 w-2 rounded-full shrink-0 ${alert.active ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />

              {/* Alert description */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{describeAlert(alert)}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {alert.regionLevel && <RegionBadge region={alert.regionLevel} />}
                  {alert.newsCategory && <CategoryBadge category={alert.newsCategory} />}
                  {!alert.regionLevel && !alert.newsCategory && (
                    <span className="text-[10px] text-muted-foreground italic">Todas las noticias</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleToggle(alert)}
                  title={alert.active ? "Desactivar" : "Activar"}
                  className={`p-1.5 rounded-lg transition-colors ${alert.active ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {alert.active ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleDelete(alert.id)}
                  title="Eliminar"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Alert Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva alerta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre (opcional)</label>
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Ej: Economía regional"
                className="w-full h-9 px-3 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Región</label>
              <Select value={newRegion} onValueChange={setNewRegion}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Todas las regiones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas las regiones</SelectItem>
                  <SelectItem value="regional">Regional (Neuquén/Río Negro)</SelectItem>
                  <SelectItem value="nacional">Nacional</SelectItem>
                  <SelectItem value="internacional">Internacional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Categoría</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Todas las categorías" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas las categorías</SelectItem>
                  <SelectItem value="economia">Economía</SelectItem>
                  <SelectItem value="politica">Política</SelectItem>
                  <SelectItem value="laboral">Laboral</SelectItem>
                  <SelectItem value="juicios">Juicios</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Las noticias que coincidan con esta configuración se destacarán automáticamente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Guardando..." : "Crear alerta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Saved Section ─────────────────────────────────────────────────────────────

function SavedSection({
  onUnsave,
  savingId,
}: {
  onUnsave: (id: number) => void;
  savingId: number | null;
}) {
  const { data: saved = [], isLoading } = useQuery<NewsArticle[]>({
    queryKey: ["news-saved"],
    queryFn: fetchSaved,
  });

  if (isLoading) {
    return <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>;
  }

  if (saved.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
        <Star className="h-10 w-10 text-muted-foreground/25 mb-3" />
        <p className="text-sm text-muted-foreground">No tenés noticias guardadas aún.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Hacé clic en ⭐ en cualquier artículo para guardarlo aquí.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {saved.map(article => (
        <NewsCard
          key={article.id}
          article={article}
          onSave={() => {}}
          onUnsave={onUnsave}
          saving={savingId === article.id}
        />
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ activeFilters, onClear, onRefresh, refreshing }: {
  activeFilters: boolean;
  onClear: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
      <Newspaper className="h-10 w-10 text-muted-foreground/25 mb-4" />
      <h3 className="text-base font-semibold mb-1">Sin resultados</h3>
      <p className="text-muted-foreground text-sm mb-5 max-w-xs">
        {activeFilters
          ? "No hay artículos para los filtros seleccionados. Probá con otras combinaciones."
          : "No hay artículos en la base de datos todavía."}
      </p>
      {activeFilters ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-3.5 w-3.5 mr-1.5" />Limpiar filtros
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Cargar noticias
        </Button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("news");
  const [onlyToday, setOnlyToday] = useState(false);
  const [regionLevel, setRegionLevel] = useState("");
  const [newsCategory, setNewsCategory] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const { data: allNews = [], isLoading, error } = useQuery<NewsArticle[]>({
    queryKey: ["news", regionLevel, newsCategory],
    queryFn: () => fetchNews(regionLevel || undefined, newsCategory || undefined),
    staleTime: 5 * 60 * 1000,
  });

  // Client-side filters: "solo hoy" first, then search
  const filteredNews = useMemo(() => {
    let result = allNews;
    if (onlyToday) {
      const todayUTC = new Date().toISOString().split("T")[0]!;
      result = result.filter(n => {
        const dateStr = n.date?.trim() ?? "";
        // ISO date-only string
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr === todayUTC;
        // Full datetime (RSS): parse and compare UTC date
        const d = new Date(dateStr);
        return !isNaN(d.getTime()) && d.toISOString().split("T")[0] === todayUTC;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allNews, onlyToday, search]);

  const hasActiveFilters = !!(onlyToday || regionLevel || newsCategory || search.trim());

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiFetch<{ ok: boolean; newItems: number }>("/api/news/refresh", { method: "POST" });
      setLastRefreshed(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
      qc.invalidateQueries({ queryKey: ["news"] });
      toast({ title: `Noticias actualizadas`, description: `${data.newItems} artículos nuevos` });
    } catch (e: unknown) {
      toast({ title: "Error al actualizar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async (newsId: number) => {
    setSavingId(newsId);
    try {
      await apiFetch(`/api/news/${newsId}/save`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["news"] });
      qc.invalidateQueries({ queryKey: ["news-saved"] });
      toast({ title: "Artículo guardado" });
    } catch (e: unknown) {
      toast({ title: "Error al guardar", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally {
      setSavingId(null);
    }
  };

  const handleUnsave = async (newsId: number) => {
    setSavingId(newsId);
    try {
      await apiFetch(`/api/news/${newsId}/save`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["news"] });
      qc.invalidateQueries({ queryKey: ["news-saved"] });
      toast({ title: "Artículo quitado de guardadas" });
    } catch (e: unknown) {
      toast({ title: "Error", variant: "destructive", description: e instanceof Error ? e.message : "" });
    } finally {
      setSavingId(null);
    }
  };

  const clearFilters = () => {
    setOnlyToday(false);
    setRegionLevel("");
    setNewsCategory("");
    setSearch("");
  };

  return (
    <div className="space-y-6 w-full">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Monitoreo inteligente de información relevante
            {activeTab === "news" && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{filteredNews.length}</span> artículos
              </>
            )}
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

      {/* ── Tabs: Noticias / Guardadas / Alertas ────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-9">
          <TabsTrigger value="news" className="text-xs gap-1.5">
            <Newspaper className="h-3.5 w-3.5" />Noticias
          </TabsTrigger>
          <TabsTrigger value="saved" className="text-xs gap-1.5">
            <Star className="h-3.5 w-3.5" />Guardadas
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs gap-1.5">
            <Bell className="h-3.5 w-3.5" />Alertas
          </TabsTrigger>
        </TabsList>

        {/* ── NOTICIAS ───────────────────────────────────────── */}
        <TabsContent value="news" className="mt-4 space-y-4">
          <FilterPanel
            onlyToday={onlyToday}
            setOnlyToday={setOnlyToday}
            regionLevel={regionLevel}
            setRegionLevel={setRegionLevel}
            newsCategory={newsCategory}
            setNewsCategory={setNewsCategory}
            search={search}
            setSearch={setSearch}
          />

          {isLoading ? (
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-sm text-destructive space-y-1">
              <p className="font-medium">Error al cargar noticias</p>
              <p className="text-xs opacity-70">{error instanceof Error ? error.message : "Error desconocido"} · Verificá la conexión e intentá de nuevo.</p>
            </div>
          ) : filteredNews.length === 0 ? (
            <EmptyState
              activeFilters={hasActiveFilters}
              onClear={clearFilters}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredNews.map(article => (
                <NewsCard
                  key={article.id}
                  article={article}
                  onSave={handleSave}
                  onUnsave={handleUnsave}
                  saving={savingId === article.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── GUARDADAS ──────────────────────────────────────── */}
        <TabsContent value="saved" className="mt-4">
          <SavedSection onUnsave={handleUnsave} savingId={savingId} />
        </TabsContent>

        {/* ── ALERTAS ────────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-4">
          <AlertsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
