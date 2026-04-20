import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import {
  DollarSign, FolderKanban, Users, Lightbulb, Target,
  ArrowRight, TrendingUp, TrendingDown, AlertCircle,
  CheckCircle2, Circle, Clock, Zap, ChevronRight,
  CheckSquare, CalendarRange, BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useDecisionEngine, type DecisionItem, type DecisionLevel } from "@/hooks/use-decision-engine";
import { cn } from "@/lib/utils";
import { BASE } from "@/lib/base-url";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}/${m}`;
}

function daysLeft(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FinanceSummary {
  monthlyIncome: number;
  monthlyExpenses: number;
  saldoLibre: number;
  recentTransactions: {
    id: number; type: string; amount: number; date: string;
    category: { name: string; color: string } | null;
    notes: string | null;
  }[];
}

interface ProjectTask { id: number; status: string; }
interface StrategyGoal {
  id: number; title: string; status: string; progress: number;
  startDate: string; endDate: string; category: string; priority: string;
  tasks: ProjectTask[];
}

interface ClientGroup { id: number; name: string; color: string; }
interface Client {
  id: number; name: string; status: string;
  groupId?: number | null;
  group?: ClientGroup | null;
  createdAt: string;
}

interface DailyGoal {
  id: number; title: string; priority: string; isDone: boolean; orderIndex: number;
}

// ── Finanzas Widget ───────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  income: "text-emerald-600 dark:text-emerald-400",
  expense: "text-rose-600 dark:text-rose-400",
};

function FinanzasWidget() {
  const { data, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary-overview"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
    staleTime: 60_000,
  });

  const income = data?.monthlyIncome ?? 0;
  const expenses = data?.monthlyExpenses ?? 0;
  const balance = income - expenses;
  const incomeBar = income + expenses > 0 ? (income / (income + expenses)) * 100 : 50;
  const expenseBar = 100 - incomeBar;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            Finanzas
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Link href="/dashboard/finance">Ver módulo <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {isLoading ? (
          <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : (
          <>
            {/* Balance */}
            <div className={cn("rounded-xl p-3 border", balance >= 0 ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800")}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Balance del mes</p>
              <div className="flex items-center gap-2">
                {balance >= 0
                  ? <TrendingUp className="h-5 w-5 text-emerald-500" />
                  : <TrendingDown className="h-5 w-5 text-rose-500" />}
                <p className={cn("text-xl font-bold", balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {ARS.format(balance)}
                </p>
              </div>
            </div>

            {/* Income vs Expense bars */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <TrendingUp className="h-3 w-3" /> Ingresos
                </span>
                <span className="font-semibold">{ARS.format(income)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${incomeBar}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                  <TrendingDown className="h-3 w-3" /> Gastos
                </span>
                <span className="font-semibold">{ARS.format(expenses)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${expenseBar}%` }} />
              </div>
            </div>

            {/* Recent transactions */}
            {data?.recentTransactions && data.recentTransactions.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Últimos movimientos</p>
                <div className="space-y-1.5">
                  {data.recentTransactions.slice(0, 4).map(tx => (
                    <div key={tx.id} className="flex items-center gap-2 py-1">
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: tx.category?.color ?? (tx.type === "income" ? "#10b981" : "#ef4444") }}
                      />
                      <span className="text-xs flex-1 truncate">{tx.notes ?? tx.category?.name ?? (tx.type === "income" ? "Ingreso" : "Gasto")}</span>
                      <span className={cn("text-xs font-semibold shrink-0", tx.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {tx.type === "income" ? "+" : "-"}{ARS.format(tx.amount)}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 w-8 text-right">{shortDate(tx.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data && (
              <p className="text-xs text-muted-foreground text-center py-4">Sin datos financieros este mes.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Proyectos Widget ──────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  personal:    "bg-violet-500",
  profesional: "bg-blue-500",
  financiero:  "bg-emerald-500",
  salud:       "bg-rose-500",
};

function ProyectosWidget() {
  const { isSignedIn } = useAuth();
  const { data: goals = [], isLoading } = useQuery<StrategyGoal[]>({
    queryKey: ["strategy-goals"],
    queryFn: () => fetch(`${BASE}/api/strategy-goals`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 30_000,
    enabled: !!isSignedIn,
  });

  const active = goals.filter(g => g.status === "active");
  const overdue = active.filter(g => new Date(g.endDate + "T00:00:00") < new Date() && g.progress < 100);
  const upcoming = active.slice().sort((a, b) => a.endDate.localeCompare(b.endDate));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
              <FolderKanban className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            Proyectos
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Link href="/dashboard/strategy">Ver módulo <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-xl font-bold">{goals.length}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-2.5 text-center">
                <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{active.length}</p>
                <p className="text-[10px] text-muted-foreground">Activos</p>
              </div>
              <div className={cn("rounded-lg p-2.5 text-center", overdue.length > 0 ? "bg-rose-50 dark:bg-rose-950/20" : "bg-muted/40")}>
                <p className={cn("text-xl font-bold", overdue.length > 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                  {overdue.length}
                </p>
                <p className="text-[10px] text-muted-foreground">Atrasados</p>
              </div>
            </div>

            {/* Project list */}
            {upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4 italic">Sin proyectos activos.</p>
            ) : (
              <div className="space-y-2.5">
                {upcoming.slice(0, 4).map(g => {
                  const done = g.tasks.filter(t => t.status === "done").length;
                  const total = g.tasks.length;
                  const dl = daysLeft(g.endDate);
                  const isOverdue = dl < 0 && g.progress < 100;
                  return (
                    <div key={g.id} className={cn("rounded-lg border p-2.5 space-y-1.5", isOverdue && "border-rose-200 dark:border-rose-800")}>
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", CAT_COLORS[g.category] ?? "bg-zinc-400")} />
                          <p className="text-xs font-medium truncate">{g.title}</p>
                        </div>
                        <span className={cn("text-[10px] shrink-0 font-medium", isOverdue ? "text-rose-500" : "text-muted-foreground")}>
                          {isOverdue ? `${Math.abs(dl)}d atrás` : dl === 0 ? "Hoy" : `${dl}d`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={g.progress} className="flex-1 h-1.5" />
                        <span className="text-[10px] font-semibold w-7 text-right">{g.progress}%</span>
                      </div>
                      {total > 0 && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <CheckSquare className="h-2.5 w-2.5" />
                          {done}/{total} tareas completadas
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Clientes Widget ───────────────────────────────────────────────────────────

const GROUP_DOT: Record<string, string> = {
  blue:    "bg-blue-500",    emerald: "bg-emerald-500", amber:  "bg-amber-500",
  rose:    "bg-rose-500",    violet:  "bg-violet-500",  orange: "bg-orange-500",
  cyan:    "bg-cyan-500",    pink:    "bg-pink-500",
};

function ClientesWidget() {
  const { isSignedIn } = useAuth();
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => fetch(`${BASE}/api/clients`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const active = clients.filter(c => c.status === "active");
  const inactive = clients.filter(c => c.status !== "active");

  const byGroup = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    clients.forEach(c => {
      if (c.group) {
        const key = String(c.group.id);
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { name: c.group.name, color: c.group.color, count: 1 }); }
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [clients]);

  const recent = clients.slice(0, 4);
  const activePercent = clients.length > 0 ? Math.round((active.length / clients.length) * 100) : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
              <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            Clientes
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Link href="/dashboard/clients">Ver módulo <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <>
            {/* Stats */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Clientes activos</span>
                <span className="font-semibold">{active.length} / {clients.length}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${activePercent}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="text-lg font-bold">{clients.length}</p>
                  <p className="text-[10px] text-muted-foreground">Total</p>
                </div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2 text-center">
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{active.length}</p>
                  <p className="text-[10px] text-muted-foreground">Activos</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="text-lg font-bold text-muted-foreground">{inactive.length}</p>
                  <p className="text-[10px] text-muted-foreground">Inactivos</p>
                </div>
              </div>
            </div>

            {/* Groups */}
            {byGroup.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Por grupo</p>
                <div className="flex flex-wrap gap-1.5">
                  {byGroup.map(g => (
                    <span key={g.name} className="flex items-center gap-1 text-[10px] bg-muted/50 px-2 py-0.5 rounded-full">
                      <span className={cn("h-1.5 w-1.5 rounded-full", GROUP_DOT[g.color] ?? "bg-zinc-500")} />
                      {g.name} <span className="font-semibold">({g.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Recent clients */}
            {recent.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Recientes</p>
                <div className="space-y-1">
                  {recent.map(c => (
                    <div key={c.id} className="flex items-center gap-2 py-0.5">
                      <div className={cn("h-2 w-2 rounded-full shrink-0", c.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className="text-xs flex-1 truncate">{c.name}</span>
                      {c.group && (
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full", GROUP_DOT[c.group.color]?.replace("bg-", "bg-") + "/20 text-foreground/60")}>
                          {c.group.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {clients.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4 italic">Sin clientes registrados.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Decisiones Widget ─────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<DecisionLevel, { dot: string; badge: string; bg: string }> = {
  critical: { dot: "bg-red-500",    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",    bg: "border-l-red-500" },
  high:     { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", bg: "border-l-orange-500" },
  medium:   { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",  bg: "border-l-amber-500" },
  info:     { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",   bg: "border-l-blue-500" },
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  problem:     AlertCircle,
  risk:        Clock,
  opportunity: Zap,
  action:      CheckCircle2,
};

const LEVEL_LABEL: Record<DecisionLevel, string> = {
  critical: "Crítico", high: "Alto", medium: "Medio", info: "Info",
};

function DecisionesWidget() {
  const { decisions } = useDecisionEngine();

  const critical = decisions.filter(d => d.level === "critical");
  const high = decisions.filter(d => d.level === "high");
  const byType = {
    problem:     decisions.filter(d => d.type === "problem").length,
    risk:        decisions.filter(d => d.type === "risk").length,
    opportunity: decisions.filter(d => d.type === "opportunity").length,
    action:      decisions.filter(d => d.type === "action").length,
  };
  const top = decisions.slice(0, 5);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
              <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            Decisiones
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Link href="/dashboard/decisions">Ver módulo <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Problemas", val: byType.problem, color: "text-red-500" },
            { label: "Riesgos",   val: byType.risk,    color: "text-orange-500" },
            { label: "Acciones",  val: byType.action,  color: "text-blue-500" },
            { label: "Opport.",   val: byType.opportunity, color: "text-emerald-500" },
          ].map(item => (
            <div key={item.label} className="rounded-lg bg-muted/40 p-2 text-center">
              <p className={cn("text-lg font-bold", item.color)}>{item.val}</p>
              <p className="text-[9px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>

        {/* Alert badges */}
        {(critical.length > 0 || high.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {critical.length > 0 && (
              <span className="text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {critical.length} crítico{critical.length > 1 ? "s" : ""}
              </span>
            )}
            {high.length > 0 && (
              <span className="text-[11px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded-full">
                {high.length} alto{high.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* Decision list */}
        {top.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Sin alertas activas. Todo en orden.
          </div>
        ) : (
          <div className="space-y-1.5">
            {top.map(item => {
              const styles = LEVEL_STYLES[item.level];
              const Icon = TYPE_ICON[item.type] ?? AlertCircle;
              return (
                <Link key={item.id} href={item.href ?? "/dashboard/decisions"}>
                  <div className={cn("flex items-start gap-2 rounded-lg border border-l-2 px-2.5 py-2 hover:bg-muted/40 transition-colors cursor-pointer", styles.bg)}>
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", styles.dot.replace("bg-", "text-"))} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight line-clamp-1">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{item.detail}</p>
                    </div>
                    <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0", styles.badge)}>
                      {LEVEL_LABEL[item.level]}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Objetivos Widget ──────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-500",
  high:     "text-orange-500",
  medium:   "text-blue-500",
  low:      "text-muted-foreground",
};

function ObjetivosWidget() {
  const { isSignedIn } = useAuth();
  const today = todayStr();

  const { data: dailyGoals = [], isLoading: loadingDaily } = useQuery<DailyGoal[]>({
    queryKey: ["daily-goals", today],
    queryFn: () => fetch(`${BASE}/api/daily-goals?date=${today}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 30_000,
    enabled: !!isSignedIn,
  });

  const { data: strategyGoals = [], isLoading: loadingStrategy } = useQuery<StrategyGoal[]>({
    queryKey: ["strategy-goals"],
    queryFn: () => fetch(`${BASE}/api/strategy-goals`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const done = dailyGoals.filter(g => g.isDone).length;
  const total = dailyGoals.length;
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const activeStrategy = strategyGoals.filter(g => g.status === "active");
  const avgProgress = activeStrategy.length > 0
    ? Math.round(activeStrategy.reduce((s, g) => s + g.progress, 0) / activeStrategy.length)
    : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
              <Target className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            Objetivos
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground">
            <Link href="/dashboard/goals">Ver módulo <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {loadingDaily || loadingStrategy ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <>
            {/* Daily goals section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Objetivos de hoy</p>
                <span className={cn(
                  "text-[11px] font-bold px-2 py-0.5 rounded-full",
                  completionPct === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" :
                  completionPct > 50 ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" :
                  "bg-muted text-muted-foreground"
                )}>
                  {done}/{total} {completionPct === 100 ? "✓" : `(${completionPct}%)`}
                </span>
              </div>
              {total > 0 ? (
                <>
                  <Progress value={completionPct} className="h-2 mb-2" />
                  <div className="space-y-1">
                    {dailyGoals.slice(0, 5).map(g => (
                      <div key={g.id} className="flex items-center gap-2 py-0.5">
                        {g.isDone
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          : <Circle className={cn("h-3.5 w-3.5 shrink-0", PRIORITY_COLORS[g.priority] ?? "text-muted-foreground")} />
                        }
                        <span className={cn("text-xs flex-1 truncate", g.isDone && "line-through text-muted-foreground")}>
                          {g.title}
                        </span>
                      </div>
                    ))}
                    {dailyGoals.length > 5 && (
                      <p className="text-[10px] text-muted-foreground">+{dailyGoals.length - 5} más...</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">Sin objetivos cargados para hoy.</p>
              )}
            </div>

            {/* Strategy goals */}
            {activeStrategy.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <BarChart3 className="h-3 w-3" /> Objetivos estratégicos
                  </p>
                  <span className="text-[11px] text-muted-foreground">{avgProgress}% prom.</span>
                </div>
                <div className="space-y-2">
                  {activeStrategy.slice(0, 3).map(g => {
                    const dl = daysLeft(g.endDate);
                    return (
                      <div key={g.id} className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs truncate max-w-[70%]">{g.title}</p>
                          <span className={cn("text-[10px]", dl < 0 ? "text-rose-500 font-medium" : "text-muted-foreground")}>
                            {dl < 0 ? `${Math.abs(dl)}d atrás` : dl === 0 ? "Hoy" : `${dl}d`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Progress value={g.progress} className="flex-1 h-1" />
                          <span className="text-[10px] font-semibold w-6 text-right">{g.progress}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ModulesOverviewPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Vista de Módulos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Resumen interactivo de finanzas, proyectos, clientes, decisiones y objetivos.
        </p>
      </div>

      {/* Top row: Finance (large) + Decisions */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <FinanzasWidget />
        <DecisionesWidget />
      </div>

      {/* Bottom row: Proyectos + Clientes + Objetivos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ProyectosWidget />
        <ClientesWidget />
        <ObjetivosWidget />
      </div>
    </div>
  );
}
