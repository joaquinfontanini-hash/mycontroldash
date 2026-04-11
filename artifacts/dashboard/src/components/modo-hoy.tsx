import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import {
  CalendarClock, CheckSquare, DollarSign, AlertTriangle,
  Lightbulb, ArrowRight, Sparkles, Brain, Target, Flag,
  CheckCircle2, Circle,
} from "lucide-react";
import { useDecisionEngine } from "@/hooks/use-decision-engine";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fmtDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

function daysDiff(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ModoHoy({ open, onClose }: Props) {
  const { decisions, scores, dueDates, tasks, finance, dailyGoals } = useDecisionEngine();

  const today = todayStr();
  const todayGoals = dailyGoals.filter(g => g.date === today);
  const doneGoals = todayGoals.filter(g => g.isDone).length;
  const goalPct = todayGoals.length > 0 ? Math.round((doneGoals / todayGoals.length) * 100) : 0;

  const criticalDecisions = decisions.filter(d => d.level === "critical").slice(0, 3);
  const topActions = decisions.filter(d => d.type === "action" || d.type === "problem").slice(0, 3);

  const urgentDueDates = dueDates
    .filter(dd => dd.status === "pending" && daysDiff(dd.dueDate) <= 3 && daysDiff(dd.dueDate) >= 0)
    .sort((a, b) => daysDiff(a.dueDate) - daysDiff(b.dueDate))
    .slice(0, 3);

  const criticalTasks = tasks
    .filter(t => t.status !== "done" && t.status !== "cancelled" && t.priority === "critical")
    .slice(0, 2);

  const fullDate = new Date().toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const scoreColor = (v: number) =>
    v >= 70 ? "text-emerald-400" : v >= 40 ? "text-amber-400" : "text-red-400";

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[440px] p-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-br from-primary/10 to-background">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Modo HOY</span>
            </div>
            <p className="text-sm font-medium capitalize text-muted-foreground">{fullDate}</p>
          </div>

          <div className="px-6 py-4 border-b">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Productividad", value: scores.productividad },
                { label: "Finanzas", value: scores.finanzas },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className={cn("text-2xl font-bold tabular-nums", scoreColor(value))}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {criticalDecisions.length > 0 && (
            <div className="px-6 py-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {criticalDecisions.length === 1 ? "1 alerta crítica" : `${criticalDecisions.length} alertas críticas`}
                </p>
              </div>
              <div className="space-y-2">
                {criticalDecisions.map(d => (
                  <div key={d.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300">{d.title}</p>
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 mt-0.5">{d.detail}</p>
                    </div>
                    {d.href && (
                      <Link href={d.href}>
                        <ArrowRight className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" onClick={onClose} />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {todayGoals.length > 0 && (
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Objetivos del día</p>
                </div>
                <span className={cn("text-sm font-bold tabular-nums",
                  goalPct === 100 ? "text-emerald-500" : goalPct >= 50 ? "text-amber-500" : "text-muted-foreground"
                )}>{doneGoals}/{todayGoals.length}</span>
              </div>
              <Progress value={goalPct} className="h-1.5 mb-3" />
              <div className="space-y-1.5">
                {todayGoals.slice(0, 5).map(g => (
                  <div key={g.id} className="flex items-center gap-2">
                    {g.isDone
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className={cn("text-xs", g.isDone ? "line-through text-muted-foreground" : "font-medium")}>
                      {g.title}
                    </span>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/goals" onClick={onClose}>
                <Button variant="ghost" size="sm" className="w-full mt-3 h-7 text-xs">
                  Ver objetivos completos <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          )}

          {topActions.length > 0 && (
            <div className="px-6 py-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Prioridades recomendadas</p>
              </div>
              <div className="space-y-2">
                {topActions.map((item, i) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className={cn(
                      "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                      item.level === "critical" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" :
                      item.level === "high" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold leading-tight">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{item.detail}</p>
                    </div>
                    {item.href && (
                      <Link href={item.href} onClick={onClose}>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(urgentDueDates.length > 0 || criticalTasks.length > 0) && (
            <div className="px-6 py-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Vencimientos próximos</p>
              </div>
              {urgentDueDates.map(dd => {
                const diff = daysDiff(dd.dueDate);
                return (
                  <div key={dd.id} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="font-medium truncate mr-2">{dd.title}</span>
                    <Badge variant={diff === 0 ? "destructive" : diff === 1 ? "secondary" : "outline"} className="text-[10px] shrink-0">
                      {diff === 0 ? "Hoy" : diff === 1 ? "Mañana" : `${diff}d`}
                    </Badge>
                  </div>
                );
              })}
              {criticalTasks.length > 0 && (
                <>
                  <Separator className="my-2" />
                  <div className="flex items-center gap-2 mb-2">
                    <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold">Tareas críticas</p>
                  </div>
                  {criticalTasks.map(t => (
                    <div key={t.id} className="text-xs text-muted-foreground py-1">{t.title}</div>
                  ))}
                </>
              )}
            </div>
          )}

          {finance && (
            <div className="px-6 py-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Posición financiera</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Patrimonio neto</span>
                  <span className={cn("font-semibold", finance.patrimonio < 0 ? "text-red-500" : "text-emerald-500")}>
                    {fmt(finance.patrimonio)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Liquidez disponible</span>
                  <span className="font-semibold">{fmt(finance.liquidez)}</span>
                </div>
                {finance.inversiones > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Inversiones</span>
                    <span className="font-semibold">{fmt(finance.inversiones)}</span>
                  </div>
                )}
              </div>
              <Link href="/dashboard/finance" onClick={onClose}>
                <Button variant="ghost" size="sm" className="w-full mt-3 h-7 text-xs">
                  Ver finanzas completas <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          )}

          <div className="px-6 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Accesos rápidos</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/dashboard/decisions", label: "Ver decisiones", icon: Brain },
                { href: "/dashboard/goals", label: "Mis objetivos", icon: Target },
                { href: "/dashboard/strategy", label: "Estrategia", icon: Flag },
                { href: "/dashboard/due-dates", label: "Vencimientos", icon: CalendarClock },
              ].map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={onClose}>
                  <Button variant="outline" size="sm" className="w-full h-9 text-xs justify-start gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
