import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Clock, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import type { WidgetData } from "../types";

interface SnapshotStatusBadgeProps {
  widgetData?: WidgetData;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "hace un momento";
  if (mins === 1) return "hace 1 min";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? "hace 1 hora" : `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function exactTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cacheAgeClass(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 15) return "text-muted-foreground border-muted";
  if (mins < 60) return "text-amber-600 border-amber-200";
  return "text-orange-600 border-orange-200";
}

export function SnapshotStatusBadge({ widgetData, onRefresh, isRefreshing }: SnapshotStatusBadgeProps) {
  if (!widgetData) return null;

  if (isRefreshing) {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Actualizando
      </Badge>
    );
  }

  if (widgetData.snapshotStatus === "error") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="destructive"
              className="text-xs gap-1 cursor-pointer"
              onClick={onRefresh}
            >
              <AlertCircle className="h-3 w-3" />
              Error
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Error al actualizar. Hacé clic para reintentar.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (widgetData.snapshotStatus === "stale") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs gap-1 text-amber-600 border-amber-200 cursor-pointer hover:text-amber-700"
              onClick={onRefresh}
            >
              <AlertTriangle className="h-3 w-3" />
              {widgetData.snapshotAt ? relativeTime(widgetData.snapshotAt) : "Desactualizado"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {widgetData.snapshotAt
                ? `Snapshot vencido del ${exactTime(widgetData.snapshotAt)}. Hacé clic para refrescar.`
                : "Datos desactualizados. Hacé clic para refrescar."}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (widgetData.fromSnapshot && widgetData.snapshotAt) {
    const ageClass = cacheAgeClass(widgetData.snapshotAt);
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`text-xs gap-1 cursor-pointer hover:opacity-80 transition-opacity ${ageClass}`}
              onClick={onRefresh}
            >
              <Clock className="h-3 w-3" />
              {relativeTime(widgetData.snapshotAt)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Caché del {exactTime(widgetData.snapshotAt)}. Hacé clic para refrescar.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-200">
            <CheckCircle2 className="h-3 w-3" />
            En vivo
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Datos en tiempo real</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
