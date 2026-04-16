import { useState, useEffect } from "react";
import {
  AlertTriangle, Zap, TrendingUp, Info, ArrowRight,
  Brain, Activity, Heart, Wind, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useDecisionEngine, type DecisionItem, type DecisionLevel } from "@/hooks/use-decision-engine";
import { usePreferences } from "@/hooks/use-preferences";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  problem:     { icon: AlertTriangle, label: "Problema",     color: "text-red-600 dark:text-red-400" },
  action:      { icon: Zap,           label: "Acción",       color: "text-amber-600 dark:text-amber-400" },
  risk:        { icon: Activity,      label: "Riesgo",       color: "text-orange-600 dark:text-orange-400" },
  opportunity: { icon: TrendingUp,    label: "Oportunidad",  color: "text-emerald-600 dark:text-emerald-400" },
};

const LEVEL_STYLES: Record<DecisionLevel, { dot: string; badge: string; bg: string }> = {
  critical: {
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 border-red-200 dark:border-red-900",
    bg: "border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/10",
  },
  high: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-200 dark:border-amber-900",
    bg: "border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/10",
  },
  medium: {
    dot: "bg-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border-blue-200 dark:border-blue-900",
    bg: "",
  },
  info: {
    dot: "bg-emerald-400",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
    bg: "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/10",
  },
};

const LEVEL_LABEL: Record<DecisionLevel, string> = {
  critical: "Crítico", high: "Alto", medium: "Medio", info: "Info",
};

const LS_KEY_SALUD = "score-salud-v1";
const LS_KEY_ESTRES = "score-estres-v1";

function ScoreRing({ value, label, color, editable, onChange }: {
  value: number; label: string; color: string;
  editable?: boolean; onChange?: (v: number) => void;
}) {
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const dash = (value / 100) * circ;
  const gap = circ - dash;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-20 w-20">
        <svg className="h-20 w-20 -rotate-90" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
          <circle
            cx="36" cy="36" r={radius} fill="none"
            stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="round"
            className={color}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold">{value}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      {editable && onChange && (
        <input
          type="range" min={0} max={100} value={value}
          onChange={e => onChange(parseInt(e.target.value))}
          className="w-16 accent-primary"
        />
      )}
    </div>
  );
}

function DecisionCard({ item }: { item: DecisionItem }) {
  const meta = TYPE_META[item.type] ?? TYPE_META.action;
  const styles = LEVEL_STYLES[item.level];
  const Icon = meta.icon;

  return (
    <div className={cn("flex items-start gap-3 p-4 rounded-xl border transition-all", styles.bg)}>
      <div className={cn("h-2 w-2 rounded-full mt-2 shrink-0", styles.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} />
          <p className="text-sm font-semibold">{item.title}</p>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border", styles.badge)}>
            {LEVEL_LABEL[item.level]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
      </div>
      {item.href && (
        <Link href={item.href}>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      )}
    </div>
  );
}

export default function DecisionsPage() {
  const qc = useQueryClient();
  const { decisions, scores } = useDecisionEngine();

  const prefs = usePreferences();

  // Start from localStorage as immediate fallback while DB loads
  const [salud, setSaludRaw] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_KEY_SALUD) ?? "70");
    return isNaN(v) ? 70 : v;
  });
  const [estres, setEstresRaw] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_KEY_ESTRES) ?? "40");
    return isNaN(v) ? 40 : v;
  });

  // Once preferences load from DB, sync local state
  useEffect(() => {
    if (!prefs.isLoading) {
      const dbSalud = prefs.getNumber(LS_KEY_SALUD, -1);
      const dbEstres = prefs.getNumber(LS_KEY_ESTRES, -1);
      if (dbSalud >= 0) setSaludRaw(dbSalud);
      if (dbEstres >= 0) setEstresRaw(dbEstres);
    }
  }, [prefs.isLoading]);

  function setSalud(v: number) {
    setSaludRaw(v);
    localStorage.setItem(LS_KEY_SALUD, String(v)); // local fallback
    prefs.set(LS_KEY_SALUD, v);
  }
  function setEstres(v: number) {
    setEstresRaw(v);
    localStorage.setItem(LS_KEY_ESTRES, String(v));
    prefs.set(LS_KEY_ESTRES, v);
  }

  const problems = decisions.filter(d => d.type === "problem");
  const actions = decisions.filter(d => d.type === "action");
  const risks = decisions.filter(d => d.type === "risk");
  const opportunities = decisions.filter(d => d.type === "opportunity");
  const top5 = decisions.slice(0, 5);

  const criticalCount = decisions.filter(d => d.level === "critical").length;
  const systemHealth = criticalCount === 0
    ? "Sistema operando con normalidad"
    : criticalCount === 1
    ? "1 alerta crítica activa"
    : `${criticalCount} alertas críticas activas`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Motor de Decisiones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Análisis inteligente del estado del sistema</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Acciones prioritarias
                </CardTitle>
                <div className={cn("flex items-center gap-2 text-xs px-2.5 py-1 rounded-full",
                  criticalCount > 0 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                )}>
                  <div className={cn("h-1.5 w-1.5 rounded-full", criticalCount > 0 ? "bg-red-500" : "bg-emerald-500")} />
                  {systemHealth}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {top5.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                    <Brain className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium">Sin decisiones urgentes pendientes</p>
                  <p className="text-xs text-muted-foreground">El motor no detecta situaciones críticas en este momento</p>
                </div>
              ) : (
                top5.map(item => <DecisionCard key={item.id} item={item} />)
              )}
            </CardContent>
          </Card>

          {(problems.length > 0 || risks.length > 0 || opportunities.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Problemas", items: problems, color: "text-red-600 dark:text-red-400", icon: AlertTriangle },
                { label: "Riesgos", items: risks, color: "text-orange-600 dark:text-orange-400", icon: Activity },
                { label: "Oportunidades", items: opportunities, color: "text-emerald-600 dark:text-emerald-400", icon: TrendingUp },
              ].map(({ label, items, color, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Icon className={cn("h-3.5 w-3.5", color)} />
                      <span className="text-xs font-semibold">{label}</span>
                    </div>
                    <p className={cn("text-2xl font-bold", color)}>{items.length}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {items.length === 0 ? "Sin " + label.toLowerCase() : items.length === 1 ? "1 detectado" : `${items.length} detectados`}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {actions.length > 5 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Otras acciones detectadas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {decisions.slice(5).map(item => <DecisionCard key={item.id} item={item} />)}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scoring general</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <ScoreRing
                  value={scores.productividad}
                  label="Productividad"
                  color={scores.productividad >= 70 ? "text-emerald-500" : scores.productividad >= 40 ? "text-amber-500" : "text-red-500"}
                />
                <ScoreRing
                  value={scores.finanzas}
                  label="Finanzas"
                  color={scores.finanzas >= 70 ? "text-emerald-500" : scores.finanzas >= 40 ? "text-amber-500" : "text-red-500"}
                />
                <ScoreRing
                  value={salud}
                  label="Salud"
                  color={salud >= 70 ? "text-emerald-500" : salud >= 40 ? "text-amber-500" : "text-red-500"}
                  editable
                  onChange={setSalud}
                />
                <ScoreRing
                  value={estres}
                  label="Estrés"
                  color={estres <= 40 ? "text-emerald-500" : estres <= 70 ? "text-amber-500" : "text-red-500"}
                  editable
                  onChange={setEstres}
                />
              </div>
              <Separator className="my-4" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium mb-2">Cómo se calculan:</p>
                <p>· <span className="font-medium">Productividad</span>: objetivos del día + tareas + estrategia</p>
                <p>· <span className="font-medium">Finanzas</span>: patrimonio, liquidez, inversiones, alertas</p>
                <p>· <span className="font-medium">Salud / Estrés</span>: manual — deslizá para actualizar</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Reglas activas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {[
                  "vencimiento_atrasado → Crítico",
                  "vencimiento_hoy → Acción crítica",
                  "vencimiento_proximo → Acción alta",
                  "tarea_critica → Problema crítico",
                  "sobrecarga_tareas → Riesgo alto",
                  "liquidez_baja → Problema crítico",
                  "deuda_elevada → Riesgo alto",
                  "oportunidad_inversion → Oportunidad",
                  "objetivos_vacios → Acción media",
                  "objetivo_estrategico_atrasado → Riesgo",
                  "sin_urgencias → Oportunidad info",
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Info className="h-3 w-3 shrink-0" />
                    <span className="font-mono text-[10px]">{rule}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
