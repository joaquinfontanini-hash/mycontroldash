import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
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
  return `hace ${hrs}h`;
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

  if (widgetData.fromSnapshot && widgetData.snapshotAt) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs gap-1 text-muted-foreground cursor-pointer hover:text-foreground"
              onClick={onRefresh}
            >
              <Clock className="h-3 w-3" />
              {relativeTime(widgetData.snapshotAt)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Datos desde caché. Hacé clic para refrescar.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (widgetData.snapshotStatus === "error") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <AlertCircle className="h-3 w-3" />
        Error al refrescar
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-200">
      <CheckCircle2 className="h-3 w-3" />
      En vivo
    </Badge>
  );
}
