import { Bell, BellDot, CheckCheck, Trash2, CalendarClock, TrendingUp, Shield, Newspaper, CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  useNotifications, useUnreadCount, useMarkRead,
  useMarkAllRead, useDeleteNotification,
  type InAppNotification, type NotificationSeverity,
} from "@/hooks/use-notifications";

const TYPE_ICONS: Record<string, React.ElementType> = {
  due_date: CalendarClock,
  news:     Newspaper,
  finance:  TrendingUp,
  system:   Shield,
  task:     CheckSquare,
};

const SEVERITY_STYLES: Record<NotificationSeverity, { dot: string; bg: string }> = {
  critical: { dot: "bg-red-500",   bg: "bg-red-50 dark:bg-red-950/20" },
  warning:  { dot: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
  info:     { dot: "bg-blue-400",  bg: "" },
};

function relTime(dateStr: string) {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
}

function NotificationItem({ n }: { n: InAppNotification }) {
  const markRead = useMarkRead();
  const del = useDeleteNotification();
  const Icon = TYPE_ICONS[n.type] ?? Bell;
  const sev = SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info;

  const inner = (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-md transition-colors group relative
        ${!n.isRead ? sev.bg + " " : ""}
        hover:bg-muted/60 cursor-pointer`}
      onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
    >
      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${!n.isRead ? sev.dot : "bg-transparent"}`} />
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-tight ${!n.isRead ? "font-semibold" : "font-medium"} truncate`}>{n.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">{relTime(n.createdAt)}</p>
      </div>
      <Button
        variant="ghost" size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={e => { e.stopPropagation(); del.mutate(n.id); }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );

  return n.linkUrl ? <Link href={n.linkUrl}>{inner}</Link> : inner;
}

export function NotificationBell() {
  const { data: listData } = useNotifications();
  const { data: countData } = useUnreadCount();
  const markAll = useMarkAllRead();

  const notifications = listData?.data ?? [];
  const unread = countData?.count ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          {unread > 0 ? (
            <>
              <BellDot className="h-5 w-5" />
              <Badge
                className="absolute -top-0.5 -right-0.5 h-4 min-w-[1rem] px-1 flex items-center justify-center text-[10px] font-bold leading-none bg-red-500 text-white border-0 rounded-full"
              >
                {unread > 99 ? "99+" : unread}
              </Badge>
            </>
          ) : (
            <Bell className="h-5 w-5" />
          )}
          <span className="sr-only">Notificaciones</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 shadow-lg" sideOffset={6}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Notificaciones</h3>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Marcar todo leído
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No hay notificaciones</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="p-1 space-y-0.5">
              {notifications.map(n => (
                <NotificationItem key={n.id} n={n} />
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
