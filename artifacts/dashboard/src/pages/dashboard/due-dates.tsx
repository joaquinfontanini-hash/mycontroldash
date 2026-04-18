import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, CalendarClock, Plus, Pencil, Trash2,
  CheckCircle2, Circle, X, Tag, RefreshCw, Eye,
  Bell, FileText, Filter, Search, LayoutGrid, List,
  Mail, Shield, ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { BASE } from "@/lib/base-url";

// ── Types ────────────────────────────────────────────────────────────────────

type TrafficLight = "rojo" | "amarillo" | "verde" | "gris";

interface DueDate {
  id: number;
  title: string;
  category: string;
  dueDate: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "done" | "cancelled";
  alertEnabled: boolean;
  recurrenceType?: string;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  isRecurrenceParent?: boolean;
  parentId?: number | null;
  source?: string;
  clientId?: number | null;
  trafficLight: TrafficLight;
  cuitGroup?: string | null;
  cuitTermination?: number | null;
  taxCode?: string | null;
  classificationReason?: string | null;
  alertGenerated?: boolean;
  lastAlertSentAt?: string | null;
  manualReview?: boolean;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  createdAt: string;
}

interface DueDateCategory {
  id: number;
  name: string;
  color: string;
}

interface ClientOption {
  id: number;
  name: string;
}

interface KPIs {
  totalThisMonth: number;
  overdue: number;
  dueToday: number;
  due3days: number;
  errors: number;
  clientsRojo: number;
  clientsAmarillo: number;
  byTrafficLight: { rojo: number; amarillo: number; verde: number; gris: number };
}

interface TraceabilityData {
  dueDate: DueDate;
  traceability: Record<string, unknown>;
  currentTrafficLight: TrafficLight;
  alertHistory: AlertLog[];
  manualReview: {
    reviewed: boolean;
    reviewNotes?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
  };
}

interface AlertLog {
  id: number;
  clientId?: number | null;
  dueDateId?: number | null;
  alertType: string;
  recipient: string;
  subject: string;
  sendStatus: string;
  errorMessage?: string | null;
  isAutomatic: boolean;
  retriggeredBy?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const SEMAFORO_CONFIG: Record<TrafficLight, { label: string; dot: string; badge: string; border: string }> = {
  rojo:     { label: "🔴 Vencido/Urgente",   dot: "bg-red-500",    badge: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400",     border: "border-l-red-500" },
  amarillo: { label: "🟡 Próximo (≤7d)",      dot: "bg-amber-400",  badge: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400", border: "border-l-amber-400" },
  verde:    { label: "🟢 A tiempo (>7d)",     dot: "bg-emerald-500",badge: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400", border: "border-l-emerald-500" },
  gris:     { label: "⚪ Completado/Inactivo",dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400", border: "border-l-slate-400" },
};

const PRIORITY_CONFIG = {
  low:      { label: "Baja",     color: "text-slate-500",  bg: "bg-slate-100 dark:bg-slate-800" },
  medium:   { label: "Media",    color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-900/40" },
  high:     { label: "Alta",     color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/40" },
  critical: { label: "Crítica",  color: "text-red-600",    bg: "bg-red-100 dark:bg-red-900/40" },
};

const CATEGORY_COLORS: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  green:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  purple: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  teal:   "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  gray:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("es-AR", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("es-AR", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return dateStr; }
}

function getDaysRemaining(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ── KPI Bar ───────────────────────────────────────────────────────────────────

type KpiFilter = "all" | "overdue" | "today" | "3days" | "rojo" | "amarillo" | "verde";

function KpiBar({ kpis, onRecalculate, isRecalculating, activeKpi, onKpiClick }: {
  kpis?: KPIs;
  onRecalculate: () => void;
  isRecalculating: boolean;
  activeKpi: KpiFilter;
  onKpiClick: (k: KpiFilter) => void;
}) {
  if (!kpis) return <Skeleton className="h-24 rounded-xl" />;

  const tiles: { label: string; value: number; color: string; bg: string; activeBg: string; kpi: KpiFilter | null }[] = [
    { label: "Este mes",    value: kpis.totalThisMonth,          color: "text-foreground",   bg: "bg-card border",                                                        activeBg: "ring-2 ring-primary",             kpi: null },
    { label: "Vencidos",    value: kpis.overdue,                 color: "text-red-600",      bg: "bg-red-50 dark:bg-red-900/20 border border-red-200/60",                  activeBg: "ring-2 ring-red-500",             kpi: "overdue" },
    { label: "Hoy",         value: kpis.dueToday,                color: "text-orange-600",   bg: "bg-orange-50 dark:bg-orange-900/20 border border-orange-200/60",         activeBg: "ring-2 ring-orange-500",          kpi: "today" },
    { label: "Próx. 3d",    value: kpis.due3days,                color: "text-amber-600",    bg: "bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60",            activeBg: "ring-2 ring-amber-500",           kpi: "3days" },
    { label: "🔴 Rojos",    value: kpis.byTrafficLight.rojo,     color: "text-red-600",      bg: "bg-red-50 dark:bg-red-900/20 border border-red-200/60",                  activeBg: "ring-2 ring-red-500",             kpi: "rojo" },
    { label: "🟡 Amarillo", value: kpis.byTrafficLight.amarillo, color: "text-amber-600",    bg: "bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60",            activeBg: "ring-2 ring-amber-500",           kpi: "amarillo" },
    { label: "🟢 Verdes",   value: kpis.byTrafficLight.verde,    color: "text-emerald-600",  bg: "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/60",      activeBg: "ring-2 ring-emerald-500",         kpi: "verde" },
    { label: "Clientes ⚠",  value: kpis.clientsRojo + kpis.clientsAmarillo, color: "text-orange-600", bg: "bg-card border", activeBg: "ring-2 ring-orange-400",          kpi: null },
    { label: "Errores",     value: kpis.errors,                  color: kpis.errors > 0 ? "text-red-600" : "text-muted-foreground", bg: "bg-card border", activeBg: "ring-2 ring-destructive", kpi: null },
  ];

  return (
    <div className="space-y-2 pb-5">
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {tiles.map(t => {
          const isActive = t.kpi !== null && activeKpi === t.kpi;
          const isClickable = t.kpi !== null;
          return (
            <button
              key={t.label}
              onClick={() => {
                if (!isClickable) return;
                onKpiClick(isActive ? "all" : t.kpi!);
              }}
              disabled={!isClickable}
              className={[
                "rounded-lg p-2.5 text-center transition-all",
                t.bg,
                isClickable ? "cursor-pointer hover:scale-105 hover:shadow-md" : "cursor-default",
                isActive ? t.activeBg : "",
              ].join(" ")}
              title={isClickable ? (isActive ? "Quitar filtro" : `Filtrar: ${t.label}`) : undefined}
            >
              <p className={`text-2xl font-bold tabular-nums leading-none ${t.color}`}>{t.value}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{t.label}</p>
              {isActive && <div className="w-4 h-0.5 bg-current rounded-full mx-auto mt-1 opacity-60" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        {activeKpi !== "all" ? (
          <button
            onClick={() => onKpiClick("all")}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded bg-primary/10 hover:bg-primary/20"
          >
            <X className="h-3 w-3" />
            Quitar filtro
          </button>
        ) : <span />}
        <button
          onClick={onRecalculate}
          disabled={isRecalculating}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/60"
        >
          <RefreshCw className={`h-3 w-3 ${isRecalculating ? "animate-spin" : ""}`} />
          {isRecalculating ? "Recalculando..." : "Actualizar semáforos"}
        </button>
      </div>
    </div>
  );
}

// ── Semáforo Badge ────────────────────────────────────────────────────────────

function SemaforoBadge({ light, compact = false }: { light: TrafficLight; compact?: boolean }) {
  const cfg = SEMAFORO_CONFIG[light];
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {light.toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border ${cfg.badge}`}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Trazabilidad Modal ────────────────────────────────────────────────────────

function TraceabilityModal({
  dueDateId,
  open,
  onClose,
}: {
  dueDateId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reviewNote, setReviewNote] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);

  const { data, isLoading } = useQuery<TraceabilityData>({
    queryKey: ["due-date-trace", dueDateId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates/${dueDateId}/traceability`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: open && dueDateId !== null,
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates/${dueDateId}/mark-reviewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: reviewNote }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-date-trace", dueDateId] });
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      setShowReviewForm(false);
      toast({ title: "Revisión registrada", description: "El vencimiento fue marcado como revisado." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo registrar la revisión", variant: "destructive" }),
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates/${dueDateId}/resend-alert`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-date-trace", dueDateId] });
      toast({ title: "Alerta enviada", description: "El email de alerta fue reenviado al cliente." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo enviar el email", variant: "destructive" }),
  });

  const traceRows = data?.traceability
    ? Object.entries(data.traceability).filter(([k]) => k !== "origen")
    : [];

  const alertStatusColor: Record<string, string> = {
    sent:    "text-emerald-600",
    skipped: "text-amber-600",
    failed:  "text-red-600",
    pending: "text-muted-foreground",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Trazabilidad del Vencimiento
          </DialogTitle>
          <DialogDescription>
            Auditoría completa: origen, clasificación, semáforo e historial de alertas.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="py-8 text-center text-muted-foreground text-sm">Cargando...</div>}

        {data && (
          <div className="space-y-5">
            {/* Header summary */}
            <div className="flex items-start justify-between gap-3 p-4 rounded-lg border bg-muted/30">
              <div className="space-y-1">
                <p className="font-semibold text-sm">{data.dueDate.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(data.dueDate.dueDate)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <SemaforoBadge light={data.currentTrafficLight} />
                {data.manualReview.reviewed && (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Revisado el {formatDateTime(data.manualReview.reviewedAt ?? "")}
                  </span>
                )}
              </div>
            </div>

            {/* Source info */}
            {data.dueDate.source && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                Origen: <span className="font-medium text-foreground">{data.traceability["origen"] as string ?? data.dueDate.source}</span>
              </div>
            )}

            {/* Trace data table */}
            {traceRows.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Datos de Clasificación</h4>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {traceRows.map(([key, val]) => (
                        <tr key={key} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium text-muted-foreground w-1/3 capitalize">
                            {key.replace(/_/g, " ")}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px]">
                            {typeof val === "object" ? JSON.stringify(val) : String(val ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Alert history */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Historial de Alertas</h4>
                <button
                  onClick={() => resendMutation.mutate()}
                  disabled={resendMutation.isPending}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
                >
                  <Mail className="h-3 w-3" />
                  {resendMutation.isPending ? "Enviando..." : "Reenviar ahora"}
                </button>
              </div>
              {data.alertHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Sin alertas enviadas todavía.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.alertHistory.map(log => (
                    <div key={log.id} className="flex items-center gap-3 text-xs p-2.5 rounded-lg border bg-card">
                      <span className={`font-semibold capitalize min-w-16 ${alertStatusColor[log.sendStatus] ?? "text-muted-foreground"}`}>
                        {log.sendStatus}
                      </span>
                      <span className="text-muted-foreground">{log.alertType}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{log.recipient}</span>
                      <span className="ml-auto text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Review form */}
            {!data.manualReview.reviewed && (
              <div>
                {!showReviewForm ? (
                  <button
                    onClick={() => setShowReviewForm(true)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Marcar como revisado manualmente
                  </button>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs">Nota de revisión (opcional)</Label>
                    <Input
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                      placeholder="Ej: Verificado, fecha correcta..."
                      className="text-xs h-8"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending} className="h-7 text-xs">
                        {reviewMutation.isPending ? "Guardando..." : "Confirmar revisión"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowReviewForm(false)} className="h-7 text-xs">Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {data.manualReview.reviewed && data.manualReview.reviewNotes && (
              <div className="text-xs text-muted-foreground italic border-l-2 border-emerald-400 pl-3">
                Nota: {data.manualReview.reviewNotes}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Select-all checkbox (handles indeterminate state via ref) ─────────────────

function SelectAllCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-primary"
    />
  );
}

// ── Due Date Row (table view) ─────────────────────────────────────────────────

function DueDateRow({
  item,
  categories,
  onEdit,
  onDelete,
  onToggleStatus,
  onViewTrace,
  isSelected,
  onToggleSelect,
}: {
  item: DueDate;
  categories: DueDateCategory[];
  onEdit: (item: DueDate) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (id: number, status: string) => void;
  onViewTrace: (id: number) => void;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const tl = item.trafficLight ?? "gris";
  const cfg = SEMAFORO_CONFIG[tl];
  const daysRemaining = getDaysRemaining(item.dueDate);

  return (
    <tr className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isSelected ? "bg-primary/5" : ""} ${item.status === "done" ? "opacity-50" : ""}`}>
      <td className="py-2.5 pl-3 pr-1 w-8">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-primary"
          onClick={e => e.stopPropagation()}
        />
      </td>
      <td className="py-2.5 px-1 w-6">
        <div className={`h-3 w-3 rounded-full ${cfg.dot}`} title={cfg.label} />
      </td>
      <td className="py-2.5 px-2 max-w-[200px]">
        <p className={`text-sm font-medium leading-snug truncate ${item.status === "done" ? "line-through text-muted-foreground" : ""}`}>
          {item.title}
        </p>
        {item.source === "afip-engine" && (
          <span className="text-[10px] text-muted-foreground">Motor AFIP</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-xs whitespace-nowrap">
        <div>{formatDate(item.dueDate)}</div>
        {item.status === "pending" && (
          <div className={`text-[10px] font-medium mt-0.5 ${
            daysRemaining < 0 ? "text-red-500" :
            daysRemaining === 0 ? "text-orange-500" :
            daysRemaining <= 3 ? "text-amber-500" :
            "text-muted-foreground"
          }`}>
            {daysRemaining < 0 ? `Vencido hace ${Math.abs(daysRemaining)}d` :
             daysRemaining === 0 ? "Vence hoy" :
             `${daysRemaining}d restantes`}
          </div>
        )}
      </td>
      <td className="py-2.5 px-2 hidden sm:table-cell">
        <SemaforoBadge light={tl} compact />
      </td>
      <td className="py-2.5 px-2 hidden md:table-cell">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_CONFIG[item.priority].bg} ${PRIORITY_CONFIG[item.priority].color}`}>
          {PRIORITY_CONFIG[item.priority].label}
        </span>
      </td>
      <td className="py-2.5 px-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onViewTrace(item.id)}
            title="Ver trazabilidad"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onToggleStatus(item.id, item.status === "done" ? "pending" : "done")}
            title={item.status === "done" ? "Marcar pendiente" : "Marcar cumplido"}
            className="p-1 rounded text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            {item.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5" />}
          </button>
          {item.source !== "afip-engine" && (
            <>
              <button
                onClick={() => onEdit(item)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(item.id)}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Due Date Card (card view) ─────────────────────────────────────────────────

function DueDateCard({
  item,
  categories,
  onEdit,
  onDelete,
  onToggleStatus,
  onViewTrace,
  isSelected,
  onToggleSelect,
}: {
  item: DueDate;
  categories: DueDateCategory[];
  onEdit: (item: DueDate) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (id: number, status: string) => void;
  onViewTrace: (id: number) => void;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const tl = item.trafficLight ?? "gris";
  const cfg = SEMAFORO_CONFIG[tl];
  const daysRemaining = getDaysRemaining(item.dueDate);
  const cat = categories.find(c => c.name === item.category);
  const catColor = cat ? (CATEGORY_COLORS[cat.color] ?? CATEGORY_COLORS["gray"]) : CATEGORY_COLORS["gray"];

  return (
    <Card className={`transition-all border-l-4 ${cfg.border} ${isSelected ? "ring-1 ring-primary/40 bg-primary/5" : ""} ${item.status === "done" ? "opacity-50" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(item.id)}
            className="mt-1 h-3.5 w-3.5 rounded border-border cursor-pointer accent-primary shrink-0"
          />
          <button
            onClick={() => onToggleStatus(item.id, item.status === "done" ? "pending" : "done")}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-emerald-600 transition-colors"
          >
            {item.status === "done"
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              : <Circle className="h-5 w-5" />
            }
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className={`font-medium text-sm leading-snug ${item.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                {item.title}
              </p>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onViewTrace(item.id)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Trazabilidad"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                {item.source !== "afip-engine" && (
                  <>
                    <button onClick={() => onEdit(item)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onDelete(item.id)} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <SemaforoBadge light={tl} compact />
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${catColor}`}>
                {item.category}
              </span>
              {item.status === "pending" && daysRemaining < 0 && (
                <span className="text-[10px] font-medium text-red-500">Vencido hace {Math.abs(daysRemaining)}d</span>
              )}
              {item.status === "pending" && daysRemaining === 0 && (
                <span className="text-[10px] font-medium text-orange-500">Vence hoy</span>
              )}
              <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(item.dueDate)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── CRUD Form ─────────────────────────────────────────────────────────────────

interface DueDateForm {
  title: string;
  category: string;
  dueDate: string;
  description: string;
  priority: DueDate["priority"];
  status: DueDate["status"];
  alertEnabled: boolean;
  recurrenceType: string;
  recurrenceDay: number | "";
  recurrenceEndDate: string;
}

const EMPTY_FORM: DueDateForm = {
  title: "",
  category: "",
  dueDate: "",
  description: "",
  priority: "medium",
  status: "pending",
  alertEnabled: true,
  recurrenceType: "none",
  recurrenceDay: "",
  recurrenceEndDate: new Date().getFullYear() + "-12-31",
};

// ── Alert Logs Tab ────────────────────────────────────────────────────────────

function AlertLogsTab() {
  const { data: logs = [], isLoading } = useQuery<AlertLog[]>({
    queryKey: ["alert-logs"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/alert-logs?limit=100`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const statusColor: Record<string, string> = {
    sent:    "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20",
    skipped: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
    failed:  "text-red-600 bg-red-50 dark:bg-red-900/20",
    pending: "text-muted-foreground bg-muted/40",
  };

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{logs.length} alertas registradas</p>
      </div>
      {logs.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm border-2 border-dashed border-border/50 rounded-xl">
          Sin historial de alertas por email todavía.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Estado</th>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground hidden sm:table-cell">Tipo</th>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Destinatario</th>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground hidden md:table-cell">Asunto</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${statusColor[log.sendStatus] ?? ""}`}>
                      {log.sendStatus}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground hidden sm:table-cell capitalize">{log.alertType}</td>
                  <td className="py-2.5 px-3 font-mono text-[10px]">{log.recipient}</td>
                  <td className="py-2.5 px-3 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">{log.subject}</td>
                  <td className="py-2.5 px-3 text-right text-muted-foreground whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DueDatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // View state
  const [activeTab, setActiveTab] = useState<"vencimientos" | "alertas">("vencimientos");
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [traceId, setTraceId] = useState<number | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  // CRUD state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DueDate | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("blue");

  // Filters
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterClient, setFilterClient] = useState<string>("");
  const [filterTrafficLight, setFilterTrafficLight] = useState<TrafficLight | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"pending" | "done" | "all">("pending");
  const [filterKpi, setFilterKpi] = useState<KpiFilter>("all");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length && sorted.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map(d => d.id)));
    }
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ── Data ──

  const { data: dueDates = [], isLoading } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const { data: categories = [] } = useQuery<DueDateCategory[]>({
    queryKey: ["due-date-categories"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-date-categories`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const { data: clientOptions = [] } = useQuery<ClientOption[]>({
    queryKey: ["clients-list-simple"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      const data = await res.json();
      return (data as { id: number; name: string }[]).map(c => ({ id: c.id, name: c.name }));
    },
  });

  const { data: kpis } = useQuery<KPIs>({
    queryKey: ["due-dates-kpis"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates/kpis`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_FORM) => {
      const res = await fetch(`${BASE}/api/due-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      qc.invalidateQueries({ queryKey: ["due-dates-kpis"] });
      setDialogOpen(false);
      toast({ title: "Vencimiento creado" });
    },
    onError: () => toast({ title: "Error al crear", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<DueDateForm> }) => {
      const res = await fetch(`${BASE}/api/due-dates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      qc.invalidateQueries({ queryKey: ["due-dates-kpis"] });
      setDialogOpen(false);
    },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/due-dates/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      qc.invalidateQueries({ queryKey: ["due-dates-kpis"] });
    },
  });

  const createCatMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const res = await fetch(`${BASE}/api/due-date-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["due-date-categories"] });
      setNewCatName("");
      setCatDialogOpen(false);
      toast({ title: "Categoría creada" });
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/due-date-categories/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["due-date-categories"] }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch(`${BASE}/api/due-dates/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: (data: { deleted: number }) => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      qc.invalidateQueries({ queryKey: ["due-dates-kpis"] });
      clearSelection();
      toast({ title: `${data.deleted} vencimiento${data.deleted !== 1 ? "s" : ""} eliminado${data.deleted !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates/recalculate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      qc.invalidateQueries({ queryKey: ["due-dates-kpis"] });
      toast({
        title: "Semáforos actualizados",
        description: `${data.updated} vencimientos recalculados.`,
      });
    },
    onError: () => toast({ title: "Error recalculando", variant: "destructive" }),
  });

  // ── Handlers ──

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: categories[0]?.name ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (item: DueDate) => {
    setEditing(item);
    setForm({
      title: item.title,
      category: item.category,
      dueDate: item.dueDate,
      description: item.description ?? "",
      priority: item.priority,
      status: item.status,
      alertEnabled: item.alertEnabled,
      recurrenceType: item.recurrenceType ?? "none",
      recurrenceDay: item.recurrenceRule ? parseInt(item.recurrenceRule) || "" : "",
      recurrenceEndDate: item.recurrenceEndDate ?? (new Date().getFullYear() + "-12-31"),
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.dueDate) return;
    const payload = {
      ...form,
      recurrenceType: form.recurrenceType,
      recurrenceRule: form.recurrenceType === "monthly-day" && form.recurrenceDay !== ""
        ? String(form.recurrenceDay)
        : null,
      recurrenceEndDate: form.recurrenceType === "monthly-day" ? form.recurrenceEndDate : null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleToggleStatus = (id: number, status: string) => {
    updateMutation.mutate({ id, data: { status: status as DueDateForm["status"] } });
  };

  const openTrace = (id: number) => {
    setTraceId(id);
    setTraceOpen(true);
  };

  // ── Filters ──

  const filtered = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const in3d = new Date(today); in3d.setDate(in3d.getDate() + 3);
    const in3dStr = in3d.toISOString().split("T")[0];

    let items = dueDates;

    // KPI quick-filter takes precedence over other status/traffic-light filters
    if (filterKpi !== "all") {
      switch (filterKpi) {
        case "overdue":
          items = items.filter(d => d.status === "pending" && d.dueDate < todayStr);
          break;
        case "today":
          items = items.filter(d => d.status === "pending" && d.dueDate === todayStr);
          break;
        case "3days":
          items = items.filter(d => d.status === "pending" && d.dueDate > todayStr && d.dueDate <= in3dStr);
          break;
        case "rojo":
          items = items.filter(d => d.trafficLight === "rojo");
          break;
        case "amarillo":
          items = items.filter(d => d.trafficLight === "amarillo");
          break;
        case "verde":
          items = items.filter(d => d.trafficLight === "verde");
          break;
      }
    } else {
      if (filterStatus !== "all") items = items.filter(d => d.status === filterStatus);
    }

    if (filterCategory) items = items.filter(d => d.category === filterCategory);
    if (filterClient) items = items.filter(d => d.clientId === parseInt(filterClient));
    if (filterTrafficLight !== "all") items = items.filter(d => (d.trafficLight ?? "gris") === filterTrafficLight);
    if (searchText) {
      const q = searchText.toLowerCase();
      items = items.filter(d => d.title.toLowerCase().includes(q) || (d.description ?? "").toLowerCase().includes(q));
    }
    return items;
  }, [dueDates, filterStatus, filterCategory, filterClient, filterTrafficLight, filterKpi, searchText]);

  // Sort: rojo first, then by date ascending
  const sorted = useMemo(() => {
    const lightOrder: Record<TrafficLight, number> = { rojo: 0, amarillo: 1, verde: 2, gris: 3 };
    return [...filtered].sort((a, b) => {
      const la = lightOrder[a.trafficLight ?? "gris"];
      const lb = lightOrder[b.trafficLight ?? "gris"];
      if (la !== lb) return la - lb;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [filtered]);

  // ── Loading ──

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 rounded-xl" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const pendingCount = dueDates.filter(d => d.status === "pending").length;
  const rojosCount = (kpis?.byTrafficLight.rojo ?? 0) + (kpis?.overdue ?? 0);

  // ── RENDER ──

  return (
    <div className="max-w-4xl space-y-0">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-5">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight flex items-center gap-2">
            Vencimientos
            {rojosCount > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                {rojosCount}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {pendingCount} pendientes
            {kpis && (
              <>
                {" · "}
                <span className="text-red-500 font-medium">{kpis.byTrafficLight.rojo} 🔴</span>
                {" "}
                <span className="text-amber-500 font-medium">{kpis.byTrafficLight.amarillo} 🟡</span>
                {" "}
                <span className="text-emerald-500 font-medium">{kpis.byTrafficLight.verde} 🟢</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setCatDialogOpen(true)}>
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Categorías
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nuevo vencimiento
          </Button>
        </div>
      </div>

      {/* KPI Bar */}
      <KpiBar
        kpis={kpis}
        onRecalculate={() => recalculateMutation.mutate()}
        isRecalculating={recalculateMutation.isPending}
        activeKpi={filterKpi}
        onKpiClick={(k) => {
          setFilterKpi(k);
          if (k !== "all") setFilterTrafficLight("all");
        }}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/60 pb-0 mb-5">
        {(["vencimientos", "alertas"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "vencimientos" ? (
              <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Vencimientos</span>
            ) : (
              <span className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" />Alertas enviadas</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Vencimientos */}
      {activeTab === "vencimientos" && (
        <div className="space-y-4">
          {/* Filter + search bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Buscar..."
                className="h-8 w-full pl-8 pr-3 rounded-md border border-border text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Status filter */}
            {(["all", "pending", "done"] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  filterStatus === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Todos" : s === "pending" ? "Pendientes" : "Cumplidos"}
              </button>
            ))}

            {/* Traffic light filter */}
            {(["all", "rojo", "amarillo", "verde", "gris"] as const).map(tl => (
              <button
                key={tl}
                onClick={() => setFilterTrafficLight(tl)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  filterTrafficLight === tl
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {tl === "all" ? "🔵 Todos" :
                 tl === "rojo" ? "🔴" :
                 tl === "amarillo" ? "🟡" :
                 tl === "verde" ? "🟢" : "⚪"}
              </button>
            ))}

            {/* Category filter */}
            {categories.length > 0 && (
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="h-8 px-2 rounded-md border border-border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Categorías</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}

            {/* Client filter */}
            {clientOptions.length > 0 && (
              <select
                value={filterClient}
                onChange={e => setFilterClient(e.target.value)}
                className="h-8 px-2 rounded-md border border-border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Clientes</option>
                {clientOptions.map(c => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            )}

            {/* View toggle */}
            <div className="flex border border-border/60 rounded-md overflow-hidden ml-auto">
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista tabla"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={`p-1.5 transition-colors ${viewMode === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista tarjetas"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm">
              <span className="font-medium text-primary">
                {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={clearSelection}
                  className="px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/60 bg-background"
                >
                  Deseleccionar
                </button>
                <button
                  onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
                  disabled={bulkDeleteMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {bulkDeleteMutation.isPending ? "Eliminando..." : `Eliminar ${selectedIds.size}`}
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {sorted.length === 0 && (
            <div className="flex flex-col items-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
              <CalendarClock className="h-10 w-10 text-muted-foreground/25 mb-4" />
              <h3 className="text-base font-semibold mb-1">
                {dueDates.length === 0 ? "Sin vencimientos" : "Sin resultados"}
              </h3>
              <p className="text-muted-foreground text-sm mb-5">
                {dueDates.length === 0
                  ? "Agregá fechas importantes para no olvidar nada."
                  : "Ajustá los filtros para ver más resultados."}
              </p>
              {dueDates.length === 0 && (
                <Button size="sm" variant="outline" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Agregar vencimiento
                </Button>
              )}
            </div>
          )}

          {/* List view */}
          {sorted.length > 0 && viewMode === "list" && (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="py-2 pl-3 pr-1 w-8">
                      <SelectAllCheckbox
                        checked={sorted.length > 0 && selectedIds.size === sorted.length}
                        indeterminate={selectedIds.size > 0 && selectedIds.size < sorted.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="py-2 px-1 w-6" />
                    <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground">Vencimiento</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground">Fecha</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Semáforo</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Prioridad</th>
                    <th className="py-2 px-2 w-28" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(item => (
                    <DueDateRow
                      key={item.id}
                      item={item}
                      categories={categories}
                      onEdit={openEdit}
                      onDelete={id => deleteMutation.mutate(id)}
                      onToggleStatus={handleToggleStatus}
                      onViewTrace={openTrace}
                      isSelected={selectedIds.has(item.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-t">
                {sorted.length} resultado{sorted.length !== 1 ? "s" : ""}
              </div>
            </div>
          )}

          {/* Cards view */}
          {sorted.length > 0 && viewMode === "cards" && (
            <div className="space-y-3">
              {sorted.map(item => (
                <DueDateCard
                  key={item.id}
                  item={item}
                  categories={categories}
                  onEdit={openEdit}
                  onDelete={id => deleteMutation.mutate(id)}
                  onToggleStatus={handleToggleStatus}
                  onViewTrace={openTrace}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Alertas */}
      {activeTab === "alertas" && <AlertLogsTab />}

      {/* Traceability Modal */}
      <TraceabilityModal
        dueDateId={traceId}
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
      />

      {/* CRUD Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar vencimiento" : "Nuevo vencimiento"}</DialogTitle>
            <DialogDescription>
              {editing ? "Modificá los datos del vencimiento." : "Completá los datos para agregar un nuevo vencimiento."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs">Título *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Ej: IVA DDJJ Mayo"
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dueDate" className="text-xs">Fecha de vencimiento *</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="priority" className="text-xs">Prioridad</Label>
                <select
                  id="priority"
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as DueDateForm["priority"] }))}
                  className="h-9 w-full px-3 rounded-md border border-border text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="category" className="text-xs">Categoría</Label>
                <select
                  id="category"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="h-9 w-full px-3 rounded-md border border-border text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Sin categoría</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs">Estado</Label>
                <select
                  id="status"
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as DueDateForm["status"] }))}
                  className="h-9 w-full px-3 rounded-md border border-border text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="pending">Pendiente</option>
                  <option value="done">Cumplido</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs">Descripción (opcional)</Label>
              <textarea
                id="description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Notas adicionales..."
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-border text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.alertEnabled}
                onChange={e => setForm(f => ({ ...f, alertEnabled: e.target.checked }))}
                className="rounded border-border"
              />
              <span className="text-sm">Habilitar alertas por email</span>
            </label>

            {/* Recurrence */}
            {!editing && (
              <div className="border border-border/60 rounded-lg p-3 space-y-3 bg-muted/20">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.recurrenceType === "monthly-day"}
                    onChange={e => setForm(f => ({
                      ...f,
                      recurrenceType: e.target.checked ? "monthly-day" : "none",
                      recurrenceDay: e.target.checked ? (f.recurrenceDay || 20) : "",
                    }))}
                    className="rounded border-border"
                  />
                  <span className="text-sm font-medium">Repetir mensualmente</span>
                </label>
                {form.recurrenceType === "monthly-day" && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Día del mes (1–31)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={form.recurrenceDay}
                        onChange={e => setForm(f => ({ ...f, recurrenceDay: parseInt(e.target.value) || "" }))}
                        placeholder="20"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Hasta</Label>
                      <Input
                        type="date"
                        value={form.recurrenceEndDate}
                        onChange={e => setForm(f => ({ ...f, recurrenceEndDate: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                    {form.recurrenceDay !== "" && form.dueDate && (
                      <p className="col-span-2 text-[11px] text-muted-foreground">
                        Se crearán instancias el día <strong>{form.recurrenceDay}</strong> de cada mes
                        desde <strong>{new Date(form.dueDate + "T00:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" })}</strong> hasta{" "}
                        <strong>{form.recurrenceEndDate ? new Date(form.recurrenceEndDate + "T00:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : "fin de año"}</strong>.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} className="h-8 text-xs">
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!form.title.trim() || !form.dueDate || createMutation.isPending || updateMutation.isPending}
              className="h-8 text-xs"
            >
              {editing ? "Guardar cambios" : "Crear vencimiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gestionar Categorías</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin categorías todavía.</p>
              )}
              {categories.map(cat => {
                const color = CATEGORY_COLORS[cat.color] ?? CATEGORY_COLORS["gray"];
                return (
                  <div key={cat.id} className="flex items-center justify-between py-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{cat.name}</span>
                    <button
                      onClick={() => deleteCatMutation.mutate(cat.id)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="border-t pt-4 space-y-2">
              <Label className="text-xs">Nueva categoría</Label>
              <div className="flex gap-2">
                <Input
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="Nombre"
                  className="h-8 text-sm"
                />
                <select
                  value={newCatColor}
                  onChange={e => setNewCatColor(e.target.value)}
                  className="h-8 px-2 rounded-md border border-border text-xs bg-background"
                >
                  {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button
                  size="sm"
                  onClick={() => newCatName.trim() && createCatMutation.mutate({ name: newCatName.trim(), color: newCatColor })}
                  disabled={!newCatName.trim() || createCatMutation.isPending}
                  className="h-8 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(false)} className="h-8 text-xs">
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
