import "@/styles/react-grid-layout.css";
import "@/styles/react-resizable.css";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardSummary, useGetWeather, type DashboardSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Mail, CheckSquare, Plane, CloudSun, CloudRain, Sun, Cloud,
  ArrowRight, TrendingUp, RefreshCw, DollarSign, AlertCircle,
  CalendarClock, Settings2, Eye, EyeOff, RotateCcw,
  BarChart2, Lightbulb, FolderOpen, Users, Target,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, useMemo, useCallback, type ComponentType } from "react";
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
  recurrenceType?: string; source?: string; clientId?: number | null;
}

// ── Widget config persistence ─────────────────────────────────────────────────

const LS_KEY = "dashboard-widget-config-v2";
interface WidgetConfig { order: string[]; hidden: string[] }

const DEFAULT_WIDGET_ORDER = [
  "dolar","bcra","weather","vencimientos","emails","tasks","travel",
  "finanzas","decisiones","proyectos","clientes","objetivos",
];
const DEFAULT_CONFIG: WidgetConfig = { order: DEFAULT_WIDGET_ORDER, hidden: [] };

function loadWidgetConfig(): WidgetConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as WidgetConfig;
    const allIds = DEFAULT_WIDGET_ORDER;
    return {
      order: [
        ...parsed.order.filter(id => allIds.includes(id)),
        ...allIds.filter(id => !parsed.order.includes(id)),
      ],
      hidden: parsed.hidden.filter(id => allIds.includes(id)),
    };
  } catch { return DEFAULT_CONFIG; }
}
function saveWidgetConfig(cfg: WidgetConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

// ── Fetch helpers ── TODOS con credentials: "include" ─────────────────────────
// El original omitía credentials en fetchCurrency y fetchDueDates → 401 en Railway.

async function fetchCurrency(): Promise<DolarRate[]> {
  const res = await fetch(`${BASE}/api/currency`, { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar cotizaciones");
  return res.json() as Promise<DolarRate[]>;
}
async function fetchDueDates(): Promise<DueDate[]> {
  const res = await fetch(`${BASE}/api/due-dates`, { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar vencimientos");
  return res.json() as Promise<DueDate[]>;
}
async function fetchBcraIndicators(): Promise<BcraData> {
  const res = await fetch(`${BASE}/api/bcra/indicators`, { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar indicadores BCRA");
  return res.json() as Promise<BcraData>;
}

// ── Shared InlineError — estado de error consistente en todos los widgets ─────

function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-l-4 border-l-destructive/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm">{message}</span>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry} className="ml-auto h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Reintentar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatRate = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);

function getUrgency(dueDate: string, status: string) {
  if (status === "done" || status === "cancelled") return "done";
  const diff = Math.floor(
    (new Date(dueDate + "T00:00:00").getTime() - new Date().setHours(0,0,0,0)) / 86_400_000
  );
  if (diff < 0)  return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3)  return "soon";
  if (diff <= 7)  return "week";
  return "future";
}

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  if (icon.includes("rain"))  return <CloudRain className={className} />;
  if (icon.includes("sun") || icon.includes("clear")) return <Sun className={className} />;
  if (icon.includes("cloud")) return <Cloud className={className} />;
  return <CloudSun className={className} />;
}

// ── Dollar Widget ──────────────────────────────────────────────────────────────

const DOLAR_DISPLAY = ["oficial", "blue", "bolsa", "cripto"];
const DOLAR_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  oficial: { accent: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/40",    border: "border-l-blue-500" },
  blue:    { accent: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-l-emerald-500" },
  bolsa:   { accent: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40", border: "border-l-purple-500" },
  cripto:  { accent: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-l-orange-500" },
};

function DollarWidget() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: rates, isLoading, isError, refetch } = useQuery<DolarRate[]>({
    queryKey: ["currency"],
    queryFn:  fetchCurrency,
    staleTime: 25 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${BASE}/api/currency/refresh`, { method: "POST", credentials: "include" });
      void refetch();
    } finally { setRefreshing(false); }
  };

  const lastUpdate = rates?.[0]?.fetchedAt
    ? new Date(rates[0].fetchedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (isLoading) return (
    <Card className="border-l-4 border-l-slate-300"><CardContent className="p-4">
      <div className="flex items-center gap-2 mb-3"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-4 w-32" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
    </CardContent></Card>
  );

  if (isError || !rates?.length) {
    return <InlineError message="No se pudieron cargar las cotizaciones." onRetry={handleRefresh} />;
  }

  const displayRates = DOLAR_DISPLAY
    .map(t => rates.find(r => r.type === t))
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
            const c = DOLAR_COLORS[rate.type] ?? { accent:"text-foreground", bg:"bg-muted/40", border:"border-l-muted" };
            return (
              <div key={rate.type} className={`rounded-lg p-3 ${c.bg} border border-border/50 border-l-2 ${c.border} text-center`}>
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">{rate.label}</p>
                <p className={`text-lg font-bold ${c.accent} leading-none`}>{formatRate(rate.sell ?? rate.avg)}</p>
                {rate.buy !== null && rate.sell !== null && (
                  <p className="text-[10px] text-muted-foreground mt-1">Cpr: {formatRate(rate.buy)} · Vta: {formatRate(rate.sell)}</p>
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

// ── BCRA Widget ────────────────────────────────────────────────────────────────

const BCRA_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  ipc_mensual:    { accent: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-50 dark:bg-rose-950/40",    border: "border-l-rose-500" },
  ipc_interanual: { accent: "text-orange-600 dark:text-orange-400",bg: "bg-orange-50 dark:bg-orange-950/40",border: "border-l-orange-500" },
  tamar:          { accent: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/40",    border: "border-l-blue-500" },
  badlar:         { accent: "text-violet-600 dark:text-violet-400",bg: "bg-violet-50 dark:bg-violet-950/40",border: "border-l-violet-500" },
};

function BcraWidget() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<BcraData>({
    queryKey: ["bcra-indicators"],
    queryFn:  fetchBcraIndicators,
    staleTime: 25 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${BASE}/api/bcra/refresh`, { method: "POST", credentials: "include" });
      void refetch();
    } finally { setRefreshing(false); }
  };

  const lastUpdate = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (isLoading) return (
    <Card className="border-l-4 border-l-slate-300"><CardContent className="p-4">
      <div className="flex items-center gap-2 mb-3"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-4 w-40" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
    </CardContent></Card>
  );

  if (isError || !data) {
    return <InlineError message="No se pudieron cargar los indicadores BCRA." onRetry={handleRefresh} />;
  }

  const indicators = data.indicators.filter(i => BCRA_COLORS[i.key]);

  return (
    <Card className="border-l-4 border-l-blue-400">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Indicadores BCRA</p>
              {lastUpdate && (
                <p className="text-[10px] text-muted-foreground">
                  Actualizado {lastUpdate}{data.isStale && <span className="ml-1 text-amber-500">(desactualizado)</span>}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {indicators.map(ind => {
            const c = BCRA_COLORS[ind.key] ?? { accent:"text-foreground", bg:"bg-muted/40", border:"border-l-muted" };
            return (
              <div key={ind.key} className={`rounded-lg p-3 ${c.bg} border border-border/50 border-l-2 ${c.border} text-center`}>
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5 leading-tight">{ind.label}</p>
                <p className={`text-lg font-bold ${c.accent} leading-none`}>
                  {ind.value !== null ? `${ind.value}${ind.unit}` : "—"}
                </p>
                {ind.date && <p className="text-[10px] text-muted-foreground mt-1">{ind.date}</p>}
                {ind.status === "error" && <p className="text-[10px] text-destructive mt-1">Sin datos</p>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Weather Widget ─────────────────────────────────────────────────────────────

function WeatherWidget() {
  const { data: weather, isLoading, isError } = useGetWeather();

  if (isLoading) return (
    <Card><CardContent className="p-4">
      <div className="flex items-center gap-2 mb-3"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-4 w-28" /></div>
      <div className="grid grid-cols-3 gap-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
    </CardContent></Card>
  );

  if (isError || !weather) return <InlineError message="No se pudo cargar el pronóstico del clima." />;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center">
            <CloudSun className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clima</p>
            <p className="text-[10px] text-muted-foreground">{(weather as any).location}</p>
          </div>
          {(weather as any).source === "cache" && (
            <span className="ml-auto text-[10px] text-muted-foreground">caché</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(weather as any).forecast?.slice(0, 3).map((day: any, i: number) => (
            <div key={i} className="flex flex-col items-center rounded-lg bg-muted/40 p-2.5 gap-1">
              <p className="text-[10px] text-muted-foreground font-medium">{day.dayName}</p>
              <WeatherIcon icon={day.conditionIcon ?? ""} className="h-5 w-5 text-sky-500" />
              <div className="flex items-center gap-1 text-xs">
                <span className="font-semibold">{day.tempMax}°</span>
                <span className="text-muted-foreground">{day.tempMin}°</span>
              </div>
              {day.rainProbability > 20 && (
                <p className="text-[10px] text-blue-500">{day.rainProbability}%💧</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Due Dates Widget ───────────────────────────────────────────────────────────

const URGENCY_DOT: Record<string, string> = {
  overdue: "bg-red-500", today: "bg-orange-500", soon: "bg-amber-400",
  week: "bg-blue-500", future: "bg-slate-400", done: "bg-slate-300",
};
const URGENCY_TEXT: Record<string, string> = {
  overdue: "text-red-600 dark:text-red-400", today: "text-orange-600 dark:text-orange-400",
  soon: "text-amber-600 dark:text-amber-400", week: "text-blue-600 dark:text-blue-400",
  future: "text-muted-foreground", done: "text-muted-foreground",
};

function DueDatesWidget() {
  const { data: dueDates, isLoading, isError } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn:  fetchDueDates,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return (
    <Card><CardContent className="p-4">
      <div className="flex items-center gap-2 mb-3"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-4 w-32" /></div>
      <div className="space-y-2">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
    </CardContent></Card>
  );

  if (isError || !dueDates) return <InlineError message="No se pudieron cargar los vencimientos." />;

  const upcoming = dueDates
    .filter(d => d.status === "pending")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
              <CalendarClock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vencimientos</p>
          </div>
          <Link href="/dashboard/due-dates" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
            Ver todos <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">Sin vencimientos próximos</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(d => {
              const urgency = getUrgency(d.dueDate, d.status);
              const [, m, dd] = d.dueDate.split("-");
              return (
                <div key={d.id} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${URGENCY_DOT[urgency] ?? "bg-slate-400"}`} />
                  <span className="flex-1 truncate text-xs">{d.title}</span>
                  <span className={`text-[10px] font-mono shrink-0 ${URGENCY_TEXT[urgency] ?? ""}`}>
                    {dd}/{m}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Summary widgets (emails, tareas, viajes) ───────────────────────────────────

interface WidgetDef {
  id: string; title: string;
  value: (s: DashboardSummary | undefined) => string | number;
  subtitle: () => string; href: string; accent: string; bg: string;
  icon: ComponentType<{ className?: string }>;
}

const WIDGET_DEFS: WidgetDef[] = [
  { id:"emails",  title:"Emails recientes",  icon:Mail,        value:(s) => s?.emailCount24h ?? "—",    subtitle:() => "Últimas 24 horas",  href:"/dashboard/emails",  accent:"text-blue-600 dark:text-blue-400",    bg:"bg-blue-50 dark:bg-blue-950/40" },
  { id:"tasks",   title:"Tareas pendientes", icon:CheckSquare, value:(s) => s?.pendingTasks ?? "—",     subtitle:() => "Requieren atención", href:"/dashboard/tasks",   accent:"text-amber-600 dark:text-amber-400",  bg:"bg-amber-50 dark:bg-amber-950/40" },
  { id:"travel",  title:"Ofertas de viaje",  icon:Plane,       value:(s) => s?.travelOffersCount ?? "—",subtitle:() => "Disponibles hoy",   href:"/dashboard/travel",  accent:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-950/40" },
];

function SummaryWidgets({ hidden }: { hidden: string[] }) {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const visible = WIDGET_DEFS.filter(w => !hidden.includes(w.id));
  return (
    <>
      {visible.map(def => {
        if (isLoading) return (
          <Card key={def.id}><CardContent className="p-4">
            <Skeleton className="h-6 w-24 mb-2" /><Skeleton className="h-8 w-16" />
          </CardContent></Card>
        );
        return (
          <Link key={def.id} href={def.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{def.title}</p>
                    <p className={`text-2xl font-bold mt-1 ${def.accent}`}>{def.value(summary)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{def.subtitle()}</p>
                  </div>
                  <div className={`h-8 w-8 rounded-lg ${def.bg} flex items-center justify-center shrink-0`}>
                    <def.icon className={`h-4 w-4 ${def.accent}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </>
  );
}

// ── Widget config dialog ───────────────────────────────────────────────────────

interface SectionDef { id: string; title: string; icon: ComponentType<{ className?: string }>; group: string }
const SECTION_DEFS: SectionDef[] = [
  { id:"dolar",       title:"Cotizaciones",       icon:DollarSign,   group:"Indicadores" },
  { id:"bcra",        title:"Indicadores BCRA",   icon:TrendingUp,   group:"Indicadores" },
  { id:"weather",     title:"Clima Neuquén",      icon:CloudSun,     group:"Paneles" },
  { id:"vencimientos",title:"Vencimientos",       icon:CalendarClock,group:"Paneles" },
  { id:"emails",      title:"Emails recientes",   icon:Mail,         group:"Paneles" },
  { id:"tasks",       title:"Tareas pendientes",  icon:CheckSquare,  group:"Paneles" },
  { id:"travel",      title:"Ofertas de viaje",   icon:Plane,        group:"Paneles" },
  { id:"finanzas",    title:"Módulo Finanzas",    icon:BarChart2,    group:"Módulos" },
  { id:"decisiones",  title:"Módulo Decisiones",  icon:Lightbulb,    group:"Módulos" },
  { id:"proyectos",   title:"Módulo Proyectos",   icon:FolderOpen,   group:"Módulos" },
  { id:"clientes",    title:"Módulo Clientes",    icon:Users,        group:"Módulos" },
  { id:"objetivos",   title:"Módulo Objetivos",   icon:Target,       group:"Módulos" },
];

function WidgetConfigDialog({ open, onClose, config, onSave }: {
  open: boolean; onClose: () => void;
  config: WidgetConfig; onSave: (c: WidgetConfig) => void;
}) {
  const [hidden, setHidden] = useState<string[]>(config.hidden);
  const toggle = (id: string) => setHidden(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const groups = useMemo(() => {
    const map: Record<string, SectionDef[]> = {};
    for (const d of SECTION_DEFS) { if (!map[d.group]) map[d.group] = []; map[d.group].push(d); }
    return Object.entries(map);
  }, []);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Configurar widgets</DialogTitle>
          <DialogDescription>Mostrá u ocultá secciones del dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {groups.map(([group, defs]) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{group}</p>
              <div className="space-y-1">
                {defs.map(def => {
                  const isHidden = hidden.includes(def.id);
                  return (
                    <button key={def.id} type="button" onClick={() => toggle(def.id)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    >
                      <def.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className={`text-sm flex-1 ${isHidden ? "text-muted-foreground line-through" : ""}`}>{def.title}</span>
                      {isHidden ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => setHidden([])}><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Mostrar todo</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={() => { onSave({ ...config, hidden }); onClose(); }}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main DashboardSummary ──────────────────────────────────────────────────────

export default function DashboardSummary() {
  const [config, setConfig] = useState<WidgetConfig>(loadWidgetConfig);
  const [configOpen, setConfigOpen] = useState(false);

  const handleSaveConfig = useCallback((cfg: WidgetConfig) => {
    setConfig(cfg);
    saveWidgetConfig(cfg);
  }, []);

  const isVisible = (id: string) => !config.hidden.includes(id);

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Resumen ejecutivo — {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
          <Settings2 className="h-3.5 w-3.5 mr-1.5" />Configurar
        </Button>
      </div>

      {isVisible("dolar")       && <DollarWidget />}
      {isVisible("bcra")        && <BcraWidget />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryWidgets hidden={config.hidden} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isVisible("weather")      && <WeatherWidget />}
        {isVisible("vencimientos") && <DueDatesWidget />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isVisible("finanzas")   && <FinanzasWidget />}
        {isVisible("proyectos")  && <ProyectosWidget />}
        {isVisible("clientes")   && <ClientesWidget />}
        {isVisible("decisiones") && <DecisionesWidget />}
        {isVisible("objetivos")  && <ObjetivosWidget />}
      </div>

      <WidgetConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
