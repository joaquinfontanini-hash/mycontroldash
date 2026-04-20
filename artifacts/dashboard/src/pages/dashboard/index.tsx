import "@/styles/react-grid-layout.css";
import "@/styles/react-resizable.css";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardSummary, useGetWeather, type DashboardSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Mail, CheckSquare, Plane, CloudSun,
  CloudRain, Sun, Cloud, ArrowRight, TrendingUp, RefreshCw,
  DollarSign, AlertCircle, CheckCircle2, CalendarClock,
  Settings2, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw,
  GripHorizontal,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, useMemo, useCallback, type ComponentType, type ReactNode } from "react";
import ReactGridLayout, { WidthProvider } from "react-grid-layout/legacy";
import type { Layout } from "react-grid-layout/legacy";
const GridLayout = WidthProvider(ReactGridLayout);

import { BASE } from "@/lib/base-url";
import {
  FinanzasWidget, ProyectosWidget, ClientesWidget,
  DecisionesWidget, ObjetivosWidget,
} from "@/pages/dashboard/modules-overview";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DolarRate {
  type: string; label: string;
  buy: number | null; sell: number | null; avg: number | null;
  source: string; sourceUrl: string;
  status: "ok" | "error" | "stale"; fetchedAt: string;
}

interface BcraIndicator {
  key: string; label: string; tooltip: string;
  value: number | null; date: string | null; unit: string;
  status: "ok" | "stale" | "error";
}

interface BcraData {
  indicators: BcraIndicator[];
  fetchedAt: string | null;
  isStale: boolean;
  source: string;
}

interface DueDate {
  id: number; title: string; category: string; dueDate: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "done" | "cancelled"; alertEnabled: boolean;
  recurrenceType?: string;
  source?: string;
  clientId?: number | null;
}

// ── Widget config ─────────────────────────────────────────────────────────────

const LS_KEY = "dashboard-widget-config-v1";

interface WidgetConfig { order: string[]; hidden: string[] }

const DEFAULT_WIDGET_ORDER = ["emails", "tasks", "travel"];
const DEFAULT_CONFIG: WidgetConfig = { order: DEFAULT_WIDGET_ORDER, hidden: [] };

interface WidgetDef {
  id: string;
  title: string;
  subtitle: (summary: DashboardSummary | undefined, dueDates: DueDate[]) => string | number;
  value: (summary: DashboardSummary | undefined, dueDates: DueDate[]) => string | number;
  href: string;
  accent: string;
  bg: string;
  icon: ComponentType<{ className?: string }>;
}

const WIDGET_DEFS: WidgetDef[] = [
  {
    id: "emails",
    title: "Emails recientes",
    icon: Mail,
    value: (s) => s?.emailCount24h ?? "—",
    subtitle: () => "Últimas 24 horas",
    href: "/dashboard/emails",
    accent: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/40",
  },
  {
    id: "tasks",
    title: "Tareas pendientes",
    icon: CheckSquare,
    value: (s) => s?.pendingTasks ?? "—",
    subtitle: () => "Requieren atención",
    href: "/dashboard/tasks",
    accent: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
  },
  {
    id: "travel",
    title: "Ofertas de viaje",
    icon: Plane,
    value: (s) => s?.travelOffersCount ?? "—",
    subtitle: () => "Disponibles hoy",
    href: "/dashboard/travel",
    accent: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
  },
];

function loadWidgetConfig(): WidgetConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as WidgetConfig;
    // Ensure all widget IDs are present in order (add new ones at end)
    const allIds = DEFAULT_WIDGET_ORDER;
    const order = [
      ...parsed.order.filter(id => allIds.includes(id)),
      ...allIds.filter(id => !parsed.order.includes(id)),
    ];
    return { order, hidden: parsed.hidden.filter(id => allIds.includes(id)) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveWidgetConfig(cfg: WidgetConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchCurrency(): Promise<DolarRate[]> {
  const res = await fetch(`${BASE}/api/currency`);
  if (!res.ok) throw new Error("Error al cargar cotizaciones");
  return res.json();
}

async function fetchDueDates(): Promise<DueDate[]> {
  const res = await fetch(`${BASE}/api/due-dates`);
  if (!res.ok) throw new Error("Error al cargar vencimientos");
  return res.json();
}

async function fetchBcraIndicators(): Promise<BcraData> {
  const res = await fetch(`${BASE}/api/bcra/indicators`);
  if (!res.ok) throw new Error("Error al cargar indicadores BCRA");
  return res.json();
}

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  if (icon.includes("rain")) return <CloudRain className={className} />;
  if (icon.includes("sun") || icon.includes("clear")) return <Sun className={className} />;
  if (icon.includes("cloud")) return <Cloud className={className} />;
  return <CloudSun className={className} />;
}

function getUrgency(dueDate: string, status: string) {
  if (status === "done" || status === "cancelled") return "done";
  const due = new Date(dueDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  if (diff <= 7) return "week";
  return "future";
}

const formatRate = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);

// ── Dollar Widget ─────────────────────────────────────────────────────────────

const DOLAR_DISPLAY = ["oficial", "blue", "bolsa", "cripto"];
const DOLAR_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  oficial: { accent: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/40",    border: "border-l-blue-500" },
  blue:    { accent: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-l-emerald-500" },
  bolsa:   { accent: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40", border: "border-l-purple-500" },
  cripto:  { accent: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-l-orange-500" },
};

function DollarWidget() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: rates, isLoading, error, refetch } = useQuery<DolarRate[]>({
    queryKey: ["currency"],
    queryFn: fetchCurrency,
    staleTime: 25 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${BASE}/api/currency/refresh`, { method: "POST" });
      refetch();
    } finally { setRefreshing(false); }
  };

  const lastUpdate = rates?.[0]?.fetchedAt
    ? new Date(rates[0].fetchedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-slate-300">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !rates?.length) {
    return (
      <Card className="border-l-4 border-l-destructive/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm">No se pudieron cargar las cotizaciones.</span>
            <Button variant="ghost" size="sm" onClick={handleRefresh} className="ml-auto h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayRates = DOLAR_DISPLAY
    .map(type => rates.find(r => r.type === type))
    .filter(Boolean) as DolarRate[];

  return (
    <Card className="border-l-4 border-l-slate-400">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cotizaciones</p>
              {lastUpdate && <p className="text-[10px] text-muted-foreground">Actualizado {lastUpdate}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {displayRates.map(rate => {
            const colors = DOLAR_COLORS[rate.type] ?? { accent: "text-foreground", bg: "bg-muted/40", border: "border-l-muted" };
            return (
              <div key={rate.type} className={`rounded-lg p-3 ${colors.bg} border border-border/50 border-l-2 ${colors.border}`}>
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">{rate.label}</p>
                <p className={`text-lg font-bold ${colors.accent} leading-none`}>{formatRate(rate.sell ?? rate.avg)}</p>
                {rate.buy !== null && rate.sell !== null && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Cpr: {formatRate(rate.buy)} · Vta: {formatRate(rate.sell)}
                  </p>
                )}
                {rate.status === "error" && <p className="text-[10px] text-destructive mt-1">Sin datos</p>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── BCRA Indicators Widget ────────────────────────────────────────────────────

const BCRA_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  ipc_mensual:    { accent: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-950/40",    border: "border-l-rose-500" },
  ipc_interanual: { accent: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-l-orange-500" },
  tamar:          { accent: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/40",    border: "border-l-blue-500" },
  badlar:         { accent: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-l-violet-500" },
};

function BcraWidget() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery<BcraData>({
    queryKey: ["bcra-indicators"],
    queryFn: fetchBcraIndicators,
    staleTime: 25 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${BASE}/api/bcra/refresh`, { method: "POST" });
      refetch();
    } finally { setRefreshing(false); }
  };

  const lastUpdate = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-slate-300">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-l-4 border-l-destructive/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm">No se pudieron cargar los indicadores BCRA.</span>
            <Button variant="ghost" size="sm" onClick={handleRefresh} className="ml-auto h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-slate-400">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Indicadores BCRA
              </p>
              <div className="flex items-center gap-1.5">
                {lastUpdate && <p className="text-[10px] text-muted-foreground">Actualizado {lastUpdate}</p>}
                {data.isStale && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                    Dato anterior
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {data.indicators.map(ind => {
            const colors = BCRA_COLORS[ind.key] ?? { accent: "text-foreground", bg: "bg-muted/40", border: "border-l-muted" };
            const hasValue = ind.value !== null && ind.status !== "error";
            const unit = (ind.unit ?? "").replace(/\s*(i\.a\.|n\.a\.)\s*/gi, "").trim();
            const formatted = hasValue
              ? `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(ind.value!)} ${unit}`
              : "—";
            return (
              <div
                key={ind.key}
                className={`rounded-lg p-3 ${colors.bg} border border-border/50 border-l-2 ${colors.border}`}
                title={ind.tooltip}
              >
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">{ind.label}</p>
                <p className={`text-lg font-bold ${colors.accent} leading-none`}>{formatted}</p>
                {ind.date && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(ind.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                  </p>
                )}
                {ind.status === "error" && !hasValue && (
                  <p className="text-[10px] text-destructive mt-1">Sin datos</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Widget Personalización Dialog ─────────────────────────────────────────────

function WidgetConfigDialog({
  open,
  onOpenChange,
  config,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: WidgetConfig;
  onChange: (cfg: WidgetConfig) => void;
}) {
  const move = (id: string, dir: -1 | 1) => {
    const arr = [...config.order];
    const i = arr.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ ...config, order: arr });
  };

  const toggle = (id: string) => {
    const hidden = config.hidden.includes(id)
      ? config.hidden.filter(h => h !== id)
      : [...config.hidden, id];
    onChange({ ...config, hidden });
  };

  const reset = () => onChange(DEFAULT_CONFIG);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Personalizar widgets</DialogTitle>
          <DialogDescription className="text-xs">
            Activá, desactivá y reordenás los widgets del panel principal. Los cambios se guardan automáticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          {config.order.map((id, idx) => {
            const def = WIDGET_DEFS.find(w => w.id === id);
            if (!def) return null;
            const isHidden = config.hidden.includes(id);
            return (
              <div
                key={id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${isHidden ? "border-border/30 bg-muted/20 opacity-50" : "border-border/60 bg-muted/10"}`}
              >
                <def.icon className={`h-4 w-4 shrink-0 ${isHidden ? "text-muted-foreground/40" : def.accent}`} />
                <span className={`flex-1 text-sm font-medium ${isHidden ? "text-muted-foreground" : ""}`}>{def.title}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => move(id, -1)}
                    disabled={idx === 0}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-25 disabled:pointer-events-none"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => move(id, 1)}
                    disabled={idx === config.order.length - 1}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-25 disabled:pointer-events-none"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toggle(id)}
                    className={`p-1 rounded transition-colors ${isHidden ? "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60" : "text-primary hover:text-muted-foreground hover:bg-muted/60"}`}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between pt-1">
          <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground gap-1" onClick={reset}>
            <RotateCcw className="h-3 w-3" /> Restablecer
          </Button>
          <Button size="sm" className="text-xs h-7" onClick={() => onOpenChange(false)}>
            Listo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Vencimientos Sidebar Widget ───────────────────────────────────────────────

const URGENCY_CFG = {
  overdue: { dot: "bg-red-500",    label: "Vencido",      text: "text-red-600 dark:text-red-400" },
  today:   { dot: "bg-orange-500", label: "Hoy",          text: "text-orange-600 dark:text-orange-400" },
  soon:    { dot: "bg-amber-500",  label: "3 días",       text: "text-amber-600 dark:text-amber-400" },
  week:    { dot: "bg-blue-500",   label: "Esta semana",  text: "text-blue-600 dark:text-blue-400" },
  future:  { dot: "bg-muted-foreground/30", label: "Próximo", text: "text-muted-foreground" },
  done:    { dot: "bg-muted-foreground/20", label: "Listo",   text: "text-muted-foreground" },
};

const VENC_TABS = [
  { key: "all", label: "Todos" },
  { key: "impuestos", label: "Impuestos" },
  { key: "cargas_sociales", label: "Cargas" },
  { key: "proveedores", label: "Proveedores" },
  { key: "alquileres", label: "Alquileres" },
];

function VencimientosWidget({ dueDates, isLoading }: { dueDates: DueDate[]; isLoading: boolean }) {
  const [activeTab, setActiveTab] = useState("all");

  const thisMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const thisMonthPending = useMemo(() =>
    dueDates.filter(d => d.status === "pending" && d.dueDate.startsWith(thisMonth)),
    [dueDates, thisMonth]
  );

  const pending = useMemo(() => {
    let items = thisMonthPending;
    if (activeTab !== "all") {
      items = items.filter(d => {
        const cat = d.category?.toLowerCase() ?? "";
        if (activeTab === "impuestos") return cat === "impuestos";
        if (activeTab === "cargas_sociales") return cat === "cargas sociales" || cat === "cargas_sociales";
        if (activeTab === "proveedores") return cat === "proveedores";
        if (activeTab === "alquileres") return cat === "alquileres";
        return true;
      });
    }
    return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10);
  }, [thisMonthPending, activeTab]);

  const critical = useMemo(() =>
    thisMonthPending.filter(d => {
      const u = getUrgency(d.dueDate, d.status);
      return u === "overdue" || u === "today";
    }).length,
    [thisMonthPending]
  );

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary shrink-0" />
            Vencimientos
            {critical > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                {critical}
              </span>
            )}
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground px-1.5">
            <Link href="/dashboard/due-dates">
              Ver todos <ArrowRight className="ml-1 h-2.5 w-2.5" />
            </Link>
          </Button>
        </div>
        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto scrollbar-none mt-1.5 pb-0.5">
          {VENC_TABS.map(tab => {
            const count = tab.key === "all"
              ? thisMonthPending.length
              : thisMonthPending.filter(d => d.category?.toLowerCase() === tab.key || d.category?.toLowerCase() === tab.key.replace("_", " ")).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium transition-all border
                  ${activeTab === tab.key
                    ? "bg-primary/10 text-primary border-primary/25"
                    : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"
                  }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-3 h-3 px-0.5 rounded-full text-[8px] font-bold ${activeTab === tab.key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3 px-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : pending.length === 0 ? (
          <div className="py-5 text-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-500/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              {activeTab === "all" ? "Sin vencimientos pendientes" : `Sin vencimientos en "${VENC_TABS.find(t => t.key === activeTab)?.label}"`}
            </p>
            {activeTab === "all" && (
              <Button asChild variant="link" size="sm" className="text-[10px] h-6 mt-1">
                <Link href="/dashboard/due-dates">Agregar vencimiento</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {pending.map(item => {
              const urgency = getUrgency(item.dueDate, item.status);
              const cfg = URGENCY_CFG[urgency as keyof typeof URGENCY_CFG] ?? URGENCY_CFG.future;
              const date = new Date(item.dueDate + "T00:00:00").toLocaleDateString("es-AR", {
                day: "numeric", month: "short",
              });
              const isRecurring = item.recurrenceType && item.recurrenceType !== "none";
              return (
                <Link key={item.id} href="/dashboard/due-dates" className="block">
                  <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors group">
                    <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`text-[9px] font-semibold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
                        <span className="text-[9px] text-muted-foreground/60">·</span>
                        <span className="text-[9px] text-muted-foreground">{date}</span>
                        {isRecurring && <span className="text-[9px] text-primary/60">↻</span>}
                        {item.source === "afip-engine" && <span className="text-[8px] font-semibold text-blue-500/70 uppercase">AFIP</span>}
                        {item.source === "supplier-batch" && <span className="text-[8px] font-semibold text-amber-500/70 uppercase">Prov.</span>}
                      </div>
                    </div>
                    {(item.priority === "critical" || item.priority === "high") && urgency === "overdue" && (
                      <AlertCircle className="h-3 w-3 text-red-500 shrink-0 mt-1" />
                    )}
                  </div>
                </Link>
              );
            })}
            {thisMonthPending.length > 10 && (
              <Button asChild variant="ghost" size="sm" className="w-full h-7 text-[10px] text-muted-foreground mt-0.5">
                <Link href="/dashboard/due-dates">
                  +{thisMonthPending.length - 10} más este mes
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Summary Grid ─────────────────────────────────────────────────────────────

const SUMMARY_LS_KEY = "dashboard-summary-layout-v1";

const DEFAULT_SUMMARY_LAYOUT: Layout[] = [
  { i: "weather",      x: 0, y: 0,  w: 9, h: 4,  minH: 3, minW: 4 },
  { i: "dollar",       x: 0, y: 4,  w: 9, h: 8,  minH: 5, minW: 4 },
  { i: "bcra",         x: 0, y: 12, w: 9, h: 7,  minH: 5, minW: 4 },
  { i: "emails",       x: 0, y: 19, w: 3, h: 7,  minH: 4, minW: 2 },
  { i: "tasks",        x: 3, y: 19, w: 3, h: 7,  minH: 4, minW: 2 },
  { i: "travel",       x: 6, y: 19, w: 3, h: 7,  minH: 4, minW: 2 },
  { i: "vencimientos", x: 9, y: 0,  w: 3, h: 26, minH: 6, minW: 2 },
];

const SUMMARY_KEYS = ["weather", "dollar", "bcra", "emails", "tasks", "travel", "vencimientos"];

function loadSummaryLayout(): Layout[] {
  try {
    const raw = localStorage.getItem(SUMMARY_LS_KEY);
    if (!raw) return DEFAULT_SUMMARY_LAYOUT;
    const parsed = JSON.parse(raw) as Layout[];
    if (!Array.isArray(parsed) || parsed.length !== SUMMARY_KEYS.length || !parsed.every(p => SUMMARY_KEYS.includes(p.i))) {
      return DEFAULT_SUMMARY_LAYOUT;
    }
    return parsed;
  } catch { return DEFAULT_SUMMARY_LAYOUT; }
}

interface SummaryGridProps {
  today: { condition: string; conditionIcon: string; tempMin: number; tempMax: number; rainProbability: number } | null;
  tomorrow: { condition: string; conditionIcon: string; tempMin: number; tempMax: number } | null;
  summary: DashboardSummary | undefined;
  dueDates: DueDate[];
  dueDatesLoading: boolean;
}

function SummaryGrid({ today, tomorrow, summary, dueDates, dueDatesLoading }: SummaryGridProps) {
  const [layout, setLayout] = useState<Layout[]>(loadSummaryLayout);

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayout(newLayout);
    localStorage.setItem(SUMMARY_LS_KEY, JSON.stringify(newLayout));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_SUMMARY_LAYOUT);
    localStorage.setItem(SUMMARY_LS_KEY, JSON.stringify(DEFAULT_SUMMARY_LAYOUT));
  }, []);

  const panels: Record<string, ReactNode> = {
    weather: today ? (
      <Card className="h-full border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-500/5 to-transparent overflow-auto">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <WeatherIcon icon={today.conditionIcon} className="h-10 w-10 text-amber-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Clima Neuquén — Hoy</p>
                <p className="font-semibold">{today.condition}</p>
                <div className="flex items-center gap-2 text-sm mt-0.5">
                  <span className="text-blue-500 font-medium">{today.tempMin}°</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-red-500 font-medium">{today.tempMax}°C</span>
                  <span className="text-muted-foreground ml-2">Lluvia: {today.rainProbability}%</span>
                </div>
              </div>
            </div>
            {tomorrow && (
              <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide font-medium">Mañana</p>
                  <p className="text-foreground font-medium">{tomorrow.condition}</p>
                  <p className="text-xs">{tomorrow.tempMin}° / {tomorrow.tempMax}°C</p>
                </div>
                <WeatherIcon icon={tomorrow.conditionIcon} className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link href="/dashboard/weather">Ver pronóstico <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    ) : null,

    dollar: <div className="h-full overflow-auto"><DollarWidget /></div>,

    bcra: <div className="h-full overflow-auto"><BcraWidget /></div>,

    ...Object.fromEntries(
      WIDGET_DEFS.map(def => {
        const val = def.value(summary, dueDates);
        const sub = def.subtitle(summary, dueDates);
        return [
          def.id,
          <Card key={def.id} className="h-full flex flex-col card-hover">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {def.title}
              </CardTitle>
              <div className={`h-8 w-8 rounded-lg ${def.bg} flex items-center justify-center`}>
                <def.icon className={`h-4 w-4 ${def.accent}`} />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 justify-between">
              <div>
                <div className={`text-3xl font-bold ${def.accent} mb-0.5`}>{val}</div>
                <p className="text-xs text-muted-foreground mb-4">{sub}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="w-full text-xs h-7">
                <Link href={def.href}>Ver detalle <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </CardContent>
          </Card>,
        ];
      })
    ),

    vencimientos: (
      <div className="h-full overflow-auto">
        <VencimientosWidget dueDates={dueDates} isLoading={dueDatesLoading} />
      </div>
    ),
  };

  return (
    <div className="space-y-2">
      {/* tiny reset */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground/40 hover:text-muted-foreground" onClick={resetLayout}>
          <RotateCcw className="h-2.5 w-2.5" /> Restablecer disposición
        </Button>
      </div>

      <GridLayout
        layout={layout}
        cols={12}
        rowHeight={30}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={true}
        isResizable={true}
        draggableHandle=".drag-handle"
        onLayoutChange={handleLayoutChange}
        resizeHandles={["se"]}
        className="summary-grid"
      >
        {SUMMARY_KEYS.map(key => (
          <div key={key} className="group/widget">
            <div className="h-full flex flex-col overflow-hidden rounded-xl">
              <div className="drag-handle flex items-center justify-center h-4 shrink-0 cursor-grab active:cursor-grabbing select-none opacity-0 group-hover/widget:opacity-100 transition-opacity bg-muted/40 border-b border-border/30 rounded-t-xl">
                <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {panels[key]}
              </div>
            </div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}

// ── Modules Grid ─────────────────────────────────────────────────────────────

const MODULES_LS_KEY = "modules-grid-layout-v1";

const MODULES_ITEMS: { key: string; label: string; Component: ComponentType }[] = [
  { key: "finanzas",   label: "Finanzas",   Component: FinanzasWidget },
  { key: "decisiones", label: "Decisiones", Component: DecisionesWidget },
  { key: "proyectos",  label: "Proyectos",  Component: ProyectosWidget },
  { key: "clientes",   label: "Clientes",   Component: ClientesWidget },
  { key: "objetivos",  label: "Objetivos",  Component: ObjetivosWidget },
];

const DEFAULT_MODULES_LAYOUT: Layout[] = [
  { i: "finanzas",   x: 0, y: 0,  w: 6, h: 12, minW: 3, minH: 6 },
  { i: "decisiones", x: 6, y: 0,  w: 6, h: 12, minW: 3, minH: 6 },
  { i: "proyectos",  x: 0, y: 12, w: 4, h: 11, minW: 2, minH: 5 },
  { i: "clientes",   x: 4, y: 12, w: 4, h: 11, minW: 2, minH: 5 },
  { i: "objetivos",  x: 8, y: 12, w: 4, h: 11, minW: 2, minH: 5 },
];

function loadModulesLayout(): Layout[] {
  try {
    const raw = localStorage.getItem(MODULES_LS_KEY);
    if (!raw) return DEFAULT_MODULES_LAYOUT;
    const parsed = JSON.parse(raw) as Layout[];
    const keys = MODULES_ITEMS.map(m => m.key);
    if (parsed.length !== keys.length || !parsed.every(p => keys.includes(p.i))) {
      return DEFAULT_MODULES_LAYOUT;
    }
    return parsed;
  } catch { return DEFAULT_MODULES_LAYOUT; }
}

function ModulesGrid() {
  const [layout, setLayout] = useState<Layout[]>(loadModulesLayout);

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayout(newLayout);
    localStorage.setItem(MODULES_LS_KEY, JSON.stringify(newLayout));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_MODULES_LAYOUT);
    localStorage.setItem(MODULES_LS_KEY, JSON.stringify(DEFAULT_MODULES_LAYOUT));
  }, []);

  return (
    <div className="space-y-3">
      {/* Separator */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Módulos</span>
        <div className="h-px flex-1 bg-border/60" />
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground/50 hover:text-muted-foreground" onClick={resetLayout}>
          <RotateCcw className="h-2.5 w-2.5" /> Restablecer
        </Button>
      </div>

      {/* Grid — always draggable/resizable */}
      <GridLayout
        layout={layout}
        cols={12}
        rowHeight={30}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={true}
        isResizable={true}
        draggableHandle=".drag-handle"
        onLayoutChange={handleLayoutChange}
        resizeHandles={["se"]}
        className="modules-grid"
      >
        {MODULES_ITEMS.map(({ key, Component }) => (
          <div key={key} className="group/widget">
            <div className="h-full flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
              {/* Drag strip — thin top border, only visible on hover */}
              <div className="drag-handle flex items-center justify-center h-4 shrink-0 cursor-grab active:cursor-grabbing select-none opacity-0 group-hover/widget:opacity-100 transition-opacity bg-muted/30 border-b border-border/40">
                <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                <Component />
              </div>
            </div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardSummary() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: weather, isLoading: weatherLoading } = useGetWeather();
  const { data: dueDates = [], isLoading: dueDatesLoading } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: fetchDueDates,
    staleTime: 2 * 60 * 1000,
  });

  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig>(loadWidgetConfig);
  const [configOpen, setConfigOpen] = useState(false);

  const handleWidgetChange = useCallback((cfg: WidgetConfig) => {
    setWidgetConfig(cfg);
    saveWidgetConfig(cfg);
  }, []);

  const isLoading = summaryLoading || weatherLoading;

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_288px] max-w-6xl">
        <div className="space-y-5">
          <div>
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-1/3" /></CardHeader>
                <CardContent><Skeleton className="h-8 w-1/2 mb-2" /><Skeleton className="h-4 w-2/3" /></CardContent>
              </Card>
            ))}
          </div>
        </div>
        <Skeleton className="hidden lg:block h-80 rounded-xl" />
      </div>
    );
  }

  const today = weather && Array.isArray(weather) ? weather[0] : null;
  const tomorrow = weather && Array.isArray(weather) ? weather[1] : null;

  const visibleWidgets = widgetConfig.order
    .filter(id => !widgetConfig.hidden.includes(id))
    .map(id => WIDGET_DEFS.find(w => w.id === id))
    .filter(Boolean) as WidgetDef[];

  return (
    <>
      <WidgetConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={widgetConfig}
        onChange={handleWidgetChange}
      />

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between max-w-6xl">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Resumen Ejecutivo</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            Panel activo
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setConfigOpen(true)}
            title="Personalizar widgets"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Summary Grid ─────────────────────────────────────── */}
      <div className="max-w-6xl">
        <SummaryGrid
          today={today}
          tomorrow={tomorrow}
          summary={summary}
          dueDates={dueDates}
          dueDatesLoading={dueDatesLoading}
        />
      </div>

      {/* ── Módulos Grid ─────────────────────────────────────── */}
      <div className="max-w-6xl mt-2">
        <ModulesGrid />
      </div>
    </>
  );
}
