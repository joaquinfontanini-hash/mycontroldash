import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart2, TrendingUp, Sparkles, Bell, Link, PieChart,
  Activity, AlertCircle, LayoutGrid, DollarSign, CloudSun, RefreshCw,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend,
} from "recharts";
import { BASE } from "@/lib/base-url";
import type { DashboardWidget, WidgetData } from "../types";
import { SnapshotStatusBadge } from "./SnapshotStatusBadge";

const WIDGET_ICONS: Record<string, React.ReactNode> = {
  kpi_cards:          <BarChart2 className="h-4 w-4" />,
  traffic_light:      <Activity className="h-4 w-4" />,
  dynamic_table:      <LayoutGrid className="h-4 w-4" />,
  upcoming_due_dates: <Bell className="h-4 w-4" />,
  news_feed:          <Activity className="h-4 w-4" />,
  ranking:            <TrendingUp className="h-4 w-4" />,
  alerts_list:        <Bell className="h-4 w-4" />,
  recent_transactions:<DollarSign className="h-4 w-4" />,
  goals_progress:     <TrendingUp className="h-4 w-4" />,
  pending_tasks:      <LayoutGrid className="h-4 w-4" />,
  bar_chart:          <BarChart2 className="h-4 w-4" />,
  line_chart:         <TrendingUp className="h-4 w-4" />,
  smart_summary:      <Sparkles className="h-4 w-4" />,
  expense_categories: <PieChart className="h-4 w-4" />,
  recent_activity:    <Activity className="h-4 w-4" />,
  text_block:         <LayoutGrid className="h-4 w-4" />,
  quick_links:        <Link className="h-4 w-4" />,
  weather_widget:     <CloudSun className="h-4 w-4" />,
  dollar_quotes:      <DollarSign className="h-4 w-4" />,
};

const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

interface WidgetRendererProps {
  widget: DashboardWidget;
  widgetData?: WidgetData;
  dashboardId?: number;
  editable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onRefreshSnapshot?: (widgetId: number) => void;
}

export function WidgetRenderer({
  widget,
  widgetData,
  dashboardId,
  editable = false,
  selected = false,
  onSelect,
  onRefreshSnapshot,
}: WidgetRendererProps) {
  const data = widgetData?.data;
  const isEmpty = data === null || data === undefined;

  // Smart summary uses its own endpoint when no data is provided
  const isSmart = widget.type === "smart_summary";

  const { data: smartData, isLoading: smartLoading, refetch: refetchSmart } = useQuery({
    queryKey: ["studio-smart-summary", dashboardId],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/studio/dashboards/${dashboardId}/smart-summary`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: isSmart && !!dashboardId,
    staleTime: 2 * 60 * 1000,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefreshSnapshot) return;
    setIsRefreshing(true);
    try {
      await onRefreshSnapshot(widget.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderContent = () => {
    if (isSmart) {
      if (smartLoading) return <SmartSummarySkeleton />;
      if (!smartData) return <EmptyState icon={WIDGET_ICONS[widget.type]} />;
      return <SmartSummaryContent data={smartData} />;
    }

    if (isEmpty) return <EmptyState icon={WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-8 w-8 opacity-30" />} />;

    switch (widget.type) {
      case "kpi_cards": {
        const d = data as Record<string, number | string>;
        return (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(d).slice(0, 4).map(([k, v]) => (
              <div key={k} className="text-center p-3 rounded-lg bg-muted/40">
                <p className="text-2xl font-bold">{typeof v === "number" ? v.toLocaleString("es-AR") : v}</p>
                <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
              </div>
            ))}
          </div>
        );
      }

      case "traffic_light": {
        const d = data as { verde: number; amarillo: number; rojo: number; total: number };
        return (
          <div className="flex justify-around py-2">
            {[
              { color: "bg-green-500", label: "Al día",      count: d.verde },
              { color: "bg-yellow-500",label: "Por vencer",  count: d.amarillo },
              { color: "bg-red-500",   label: "Vencidos",    count: d.rojo },
            ].map(({ color, label, count }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className={`w-12 h-12 rounded-full ${color} flex items-center justify-center text-white font-bold text-lg`}>
                  {count}
                </div>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        );
      }

      case "dynamic_table":
      case "upcoming_due_dates": {
        const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Sin registros</p>;
        const keys = Object.keys(rows[0]).slice(0, 4);
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {keys.map(k => (
                    <th key={k} className="text-left py-1 pr-3 text-muted-foreground capitalize font-medium">
                      {k.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {keys.map(k => (
                      <td key={k} className="py-1.5 pr-3 truncate max-w-24">
                        {String(row[k] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case "news_feed":
      case "ranking": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex gap-2 items-start py-1 border-b last:border-0">
                <span className="text-muted-foreground text-xs mt-0.5 shrink-0 w-4">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2">
                    {String(item.title ?? item.name ?? item.label ?? "")}
                  </p>
                  {item.source && <p className="text-xs text-muted-foreground">{String(item.source)}</p>}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "alerts_list": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-green-600 py-4 text-center">Sin alertas activas ✓</p>
            ) : items.slice(0, 5).map((item, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-100">
                <Bell className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm truncate">{String(item.title ?? item.name ?? item.description ?? "")}</p>
              </div>
            ))}
          </div>
        );
      }

      case "recent_transactions": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-2">
            {items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <span className="text-sm truncate max-w-36">{String(item.description ?? item.title ?? "")}</span>
                <span className={`text-sm font-medium shrink-0 ml-2 ${Number(item.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {item.amount ? `$${Math.abs(Number(item.amount)).toLocaleString("es-AR")}` : ""}
                </span>
              </div>
            ))}
          </div>
        );
      }

      case "goals_progress": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        return (
          <div className="space-y-3">
            {items.slice(0, 4).map((g, i) => {
              const current = Number(g.currentAmount ?? g.current ?? 0);
              const target = Number(g.targetAmount ?? g.target ?? 1);
              const pct = Math.min(100, Math.round((current / target) * 100));
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="truncate max-w-36">{String(g.title ?? g.name ?? "Objetivo")}</span>
                    <span className="text-muted-foreground ml-2 shrink-0">{pct}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {items.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Sin objetivos registrados</p>}
          </div>
        );
      }

      case "pending_tasks": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (items.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Sin tareas pendientes ✓</p>;
        return (
          <div className="space-y-1.5">
            {items.slice(0, 6).map((t, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="w-4 h-4 rounded border-2 border-muted-foreground/40 shrink-0" />
                <span className="text-sm truncate">{String(t.title ?? t.name ?? "")}</span>
                {t.status && <Badge variant="outline" className="text-xs ml-auto shrink-0">{String(t.status)}</Badge>}
              </div>
            ))}
          </div>
        );
      }

      case "bar_chart": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (items.length === 0) return <EmptyState icon={WIDGET_ICONS["bar_chart"]} />;
        // Build chart data: group by month or use raw items
        const chartData = items.slice(0, 10).map(item => ({
          name: String(item.date ?? item.month ?? item.label ?? item.name ?? ""),
          ingreso: Number(item.ingreso ?? (item.type === "income" || item.type === "ingreso" ? item.amount : 0) ?? 0),
          gasto: Number(item.gasto ?? (item.type === "expense" || item.type === "gasto" ? item.amount : 0) ?? 0),
          value: Number(item.amount ?? item.value ?? 0),
        }));
        return (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RechartTooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="value" fill="#6366f1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      }

      case "expense_categories": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        // Aggregate by category
        const categoryMap: Record<string, number> = {};
        for (const item of items) {
          const cat = String(item.category ?? item.tipo ?? "Otros");
          categoryMap[cat] = (categoryMap[cat] ?? 0) + Math.abs(Number(item.amount ?? 0));
        }
        const pieData = Object.entries(categoryMap).map(([name, value]) => ({ name, value })).slice(0, 6);
        if (pieData.length === 0) return <EmptyState icon={WIDGET_ICONS["expense_categories"]} />;
        return (
          <ResponsiveContainer width="100%" height={130}>
            <RPieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={50} dataKey="value" label={false}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <RechartTooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => `$${v.toLocaleString("es-AR")}`} />
            </RPieChart>
          </ResponsiveContainer>
        );
      }

      case "recent_activity": {
        const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (items.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Sin actividad reciente</p>;
        return (
          <div className="space-y-2">
            {items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-start gap-2 py-1 border-b last:border-0">
                <Activity className="h-3 w-3 text-muted-foreground mt-1 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm truncate">{String(item.detail ?? item.action ?? item.title ?? "")}</p>
                  {item.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(String(item.createdAt)).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "text_block":
        return (
          <p className="text-sm text-muted-foreground">
            {String((widget.configJson?.content as string) ?? "Sin contenido configurado")}
          </p>
        );

      case "quick_links": {
        const links = (widget.configJson?.links as Array<{ label: string; url: string }>) ?? [];
        if (links.length === 0) {
          return <p className="text-sm text-muted-foreground py-4 text-center">No hay links configurados</p>;
        }
        return (
          <div className="space-y-2">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline py-1"
                onClick={e => e.stopPropagation()}
              >
                <Link className="h-3 w-3 shrink-0" /> {l.label}
              </a>
            ))}
          </div>
        );
      }

      default:
        return (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            {WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-8 w-8 opacity-30" />}
            <p className="text-xs mt-2 capitalize">{widget.type.replace(/_/g, " ")}</p>
          </div>
        );
    }
  };

  return (
    <Card
      className={`h-full flex flex-col transition-all ${editable ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-primary" : ""}`}
      onClick={onSelect}
    >
      <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0">{WIDGET_ICONS[widget.type] ?? <BarChart2 className="h-4 w-4" />}</span>
            <div className="min-w-0">
              <CardTitle className="text-sm leading-tight truncate">{widget.title}</CardTitle>
              {widget.subtitle && (
                <CardDescription className="text-xs truncate">{widget.subtitle}</CardDescription>
              )}
            </div>
          </div>
          <SnapshotStatusBadge
            widgetData={widgetData}
            onRefresh={onRefreshSnapshot ? handleRefresh : undefined}
            isRefreshing={isRefreshing}
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-4 pb-4 overflow-hidden min-h-0">
        {renderContent()}
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon }: { icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <span className="opacity-30 [&>svg]:h-8 [&>svg]:w-8">{icon ?? <BarChart2 className="h-8 w-8" />}</span>
      <p className="text-xs mt-2">Sin datos</p>
    </div>
  );
}

function SmartSummarySkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}
    </div>
  );
}

interface SmartSummaryData {
  insights: Array<{ level: string; text: string; icon: string }>;
  generatedAt: string;
}

function SmartSummaryContent({ data }: { data: SmartSummaryData }) {
  const levelClass = {
    alert:   "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info:    "bg-blue-50 border-blue-200 text-blue-800",
  };

  return (
    <div className="space-y-2">
      {data.insights.slice(0, 5).map((insight, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${levelClass[insight.level as keyof typeof levelClass] ?? levelClass.info}`}
        >
          <span className="text-sm shrink-0">{insight.icon}</span>
          <p>{insight.text}</p>
        </div>
      ))}
      <p className="text-xs text-muted-foreground text-right mt-1">
        {new Date(data.generatedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}
