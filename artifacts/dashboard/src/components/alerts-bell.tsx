import { Bell, CalendarClock, CheckSquare, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "wouter";
import { useAlerts, type Alert } from "@/hooks/use-alerts";
import { ScrollArea } from "@/components/ui/scroll-area";

const ICONS = {
  vencimiento: CalendarClock,
  tarea: CheckSquare,
  fiscal: AlertTriangle,
};

const LEVEL_STYLES: Record<Alert["level"], { dot: string; badge: string }> = {
  critical: {
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 border-red-200 dark:border-red-800",
  },
  high: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  },
  medium: {
    dot: "bg-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  },
};

const LEVEL_LABEL: Record<Alert["level"], string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
};

function AlertItem({ alert }: { alert: Alert }) {
  const Icon = ICONS[alert.type];
  const styles = LEVEL_STYLES[alert.level];
  return (
    <Link href={alert.href}>
      <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors cursor-pointer rounded-md">
        <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${styles.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight truncate">{alert.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>
        </div>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border shrink-0 ${styles.badge}`}>
          {LEVEL_LABEL[alert.level]}
        </span>
      </div>
    </Link>
  );
}

export default function AlertsBell() {
  const { alerts, criticalCount, totalCount } = useAlerts();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-lg">
          <Bell className="h-4 w-4" />
          {totalCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white leading-none
                ${criticalCount > 0 ? "bg-red-500" : "bg-amber-500"}`}
            >
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
          <span className="sr-only">Alertas</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold">Alertas</span>
            {totalCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {totalCount}
              </Badge>
            )}
          </div>
          {criticalCount > 0 && (
            <span className="text-[10px] font-semibold text-red-500">
              {criticalCount} crítica{criticalCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Sin alertas pendientes</p>
            <p className="text-xs text-muted-foreground">Todo al día</p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[320px]">
              <div className="p-1.5 flex flex-col gap-0.5">
                {alerts.map(alert => (
                  <AlertItem key={alert.id} alert={alert} />
                ))}
              </div>
            </ScrollArea>
            <div className="border-t px-3 py-2">
              <Link href="/dashboard/due-dates" className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors">
                <span>Ver todos los vencimientos</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
