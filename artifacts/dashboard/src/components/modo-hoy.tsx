import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  CalendarClock, CheckSquare, DollarSign, AlertTriangle,
  Lightbulb, ArrowRight, Sparkles,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface DueDate {
  id: number; title: string; dueDate: string;
  priority: string; status: string; category: string;
}

interface Task {
  id: number; title: string; priority: string;
  status: string; dueDate?: string | null;
}

interface FinanceSummary {
  patrimonio: number; liquidez: number;
  alerts: { type: string; level: string; message: string }[];
}

function daysDiff(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}

function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fmtDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

interface Priority {
  id: string;
  icon: React.ElementType;
  label: string;
  detail: string;
  href: string;
  level: "critical" | "high" | "medium";
}

function useModoHoyData() {
  const { isSignedIn } = useAuth();

  const { data: dueDates = [] } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: () => fetch(`${BASE}/api/due-dates`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => fetch(`${BASE}/api/tasks`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const { data: finance } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`).then(r => r.ok ? r.json() : null),
    staleTime: 60_000,
    enabled: !!isSignedIn,
  });

  const priorities: Priority[] = [];

  const urgentDueDates = dueDates
    .filter(dd => dd.status === "pending")
    .map(dd => ({ ...dd, diff: daysDiff(dd.dueDate) }))
    .filter(dd => dd.diff <= 3)
    .sort((a, b) => a.diff - b.diff);

  for (const dd of urgentDueDates.slice(0, 2)) {
    priorities.push({
      id: `dd-${dd.id}`,
      icon: CalendarClock,
      label: dd.title,
      detail: dd.diff < 0
        ? `Vencido hace ${Math.abs(dd.diff)} día${Math.abs(dd.diff) !== 1 ? "s" : ""}`
        : dd.diff === 0
        ? "Vence hoy"
        : `Vence en ${dd.diff} día${dd.diff !== 1 ? "s" : ""} — ${fmtDate(dd.dueDate)}`,
      href: "/dashboard/due-dates",
      level: dd.diff <= 0 ? "critical" : dd.diff <= 1 ? "high" : "medium",
    });
  }

  const urgentTasks = tasks
    .filter(t => t.status !== "done" && t.status !== "cancelled" && (t.priority === "critical" || t.priority === "high"))
    .slice(0, 2);

  for (const t of urgentTasks) {
    if (priorities.length >= 3) break;
    priorities.push({
      id: `task-${t.id}`,
      icon: CheckSquare,
      label: t.title,
      detail: t.priority === "critical" ? "Tarea crítica pendiente" : "Prioridad alta",
      href: "/dashboard/tasks",
      level: t.priority === "critical" ? "critical" : "high",
    });
  }

  if (finance?.liquidez !== undefined && priorities.length < 3) {
    const liquidezMin = 100_000;
    if (finance.liquidez < liquidezMin) {
      priorities.push({
        id: "finance-liquidez",
        icon: DollarSign,
        label: "Liquidez baja",
        detail: `Posición actual: ${fmt(finance.liquidez)} — Revisar flujo de caja`,
        href: "/dashboard/finance",
        level: "critical",
      });
    }
  }

  const criticalAlerts = [
    ...(finance?.alerts?.filter(a => a.level === "critical" || a.level === "high") ?? []),
  ];

  let recommendation = "";
  if (priorities.length === 0 && criticalAlerts.length === 0) {
    recommendation = "Todo en orden. Buen momento para revisar objetivos o actualizar cuentas financieras.";
  } else if (priorities[0]?.level === "critical") {
    recommendation = `Enfocate en: "${priorities[0].label}" antes de terminar el día.`;
  } else if (urgentDueDates.length > 0) {
    recommendation = `Verificá el vencimiento de "${urgentDueDates[0].title}" y marcalo como completado si ya fue procesado.`;
  } else {
    recommendation = "Revisá las prioridades del día y completá al menos una tarea de alta prioridad.";
  }

  const today = new Date();
  const dayName = today.toLocaleDateString("es-AR", { weekday: "long" });
  const dateStr = today.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

  return { priorities, criticalAlerts, recommendation, dayName, dateStr, finance };
}

const LEVEL_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 border-red-200 dark:border-red-800",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border-blue-200 dark:border-blue-800",
};

const LEVEL_LABEL: Record<string, string> = {
  critical: "Crítico", high: "Alta", medium: "Media",
};

interface ModoHoyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ModoHoy({ open, onOpenChange }: ModoHoyProps) {
  const { priorities, criticalAlerts, recommendation, dayName, dateStr, finance } = useModoHoyData();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-4 border-b">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <SheetTitle className="text-base">Modo HOY</SheetTitle>
          </div>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">
            {dayName}, {dateStr}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary">1</span>
              </div>
              <h3 className="text-sm font-semibold">Prioridades del día</h3>
              {priorities.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1.5">{priorities.length}</Badge>
              )}
            </div>

            {priorities.length === 0 ? (
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-muted/50 text-muted-foreground">
                <CheckSquare className="h-4 w-4 shrink-0" />
                <p className="text-sm">Sin prioridades urgentes para hoy</p>
              </div>
            ) : (
              <div className="space-y-2">
                {priorities.map((p, idx) => {
                  const Icon = p.icon;
                  return (
                    <Link key={p.id} href={p.href} onClick={() => onOpenChange(false)}>
                      <div className="flex items-start gap-3 px-3 py-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[10px] font-bold text-muted-foreground">{idx + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight truncate group-hover:text-foreground">{p.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.detail}</p>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${LEVEL_BADGE[p.level]}`}>
                            {LEVEL_LABEL[p.level]}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <Separator />

          {criticalAlerts.length > 0 && (
            <>
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400">!</span>
                  </div>
                  <h3 className="text-sm font-semibold">Alertas críticas</h3>
                </div>
                <div className="space-y-1.5">
                  {criticalAlerts.map((alert, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      <p className="text-sm">{alert.message}</p>
                    </div>
                  ))}
                </div>
              </section>
              <Separator />
            </>
          )}

          {finance && (
            <>
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                    <DollarSign className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-semibold">Posición financiera</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Patrimonio", value: fmt(finance.patrimonio), accent: finance.patrimonio >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500" },
                    { label: "Liquidez", value: fmt(finance.liquidez), accent: "text-blue-600 dark:text-blue-400" },
                  ].map(item => (
                    <Link key={item.label} href="/dashboard/finance" onClick={() => onOpenChange(false)}>
                      <div className="px-3 py-2.5 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-base font-bold mt-0.5 ${item.accent}`}>{item.value}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
              <Separator />
            </>
          )}

          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
                <Lightbulb className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold">Acción recomendada</h3>
            </div>
            <div className="px-3 py-3 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">{recommendation}</p>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
