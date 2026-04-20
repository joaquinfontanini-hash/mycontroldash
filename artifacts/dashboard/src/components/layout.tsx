import { ReactNode, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuthContext } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import GlobalSearch, { useGlobalSearch } from "@/components/global-search";
import AlertsBell from "@/components/alerts-bell";
import { NotificationBell } from "@/components/notification-bell";
import ModoHoy from "@/components/modo-hoy";
import ThemeSelector from "@/components/theme-selector";
import {
  LayoutDashboard, CheckSquare, Link as LinkIcon, Newspaper, Mail,
  CloudSun, Briefcase, Plane, CalendarClock, CalendarDays, Settings,
  Shield, Search, LogOut, Menu, Users, Truck, Crown,
  DollarSign, Sparkles, RefreshCw, Brain, Target, Flag,
  ChevronLeft, ChevronRight, Pin, PinOff, PanelLeftClose, PanelLeft,
  MessageSquare, Contact, LayoutGrid, Gauge, FileText, Dumbbell,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentUser, isAdmin } from "@/hooks/use-current-user";

import { BASE } from "@/lib/base-url";

// ── Sidebar state persistence ──────────────────────────────────────────────────

type SidebarState = "expanded" | "collapsed" | "hidden";

function loadSidebarState(): SidebarState {
  try {
    return (localStorage.getItem("sidebar-state") as SidebarState) ?? "expanded";
  } catch {
    return "expanded";
  }
}

function loadSidebarPinned(): boolean {
  try {
    return localStorage.getItem("sidebar-pinned") !== "false";
  } catch {
    return true;
  }
}

function saveSidebarState(state: SidebarState) {
  try { localStorage.setItem("sidebar-state", state); } catch {}
}

function saveSidebarPinned(pinned: boolean) {
  try { localStorage.setItem("sidebar-pinned", String(pinned)); } catch {}
}

// ── Nav items ──────────────────────────────────────────────────────────────────

const ALL_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, moduleKey: "dashboard" },
  { href: "/dashboard/overview", label: "Vista de Módulos", icon: Gauge, moduleKey: "dashboard" },
  { href: "/dashboard/tasks", label: "Tareas", icon: CheckSquare, moduleKey: "tasks" },
  { href: "/dashboard/shortcuts", label: "Accesos Directos", icon: LinkIcon, moduleKey: "shortcuts" },
  { href: "/dashboard/news", label: "Noticias", icon: Newspaper, moduleKey: "news" },
  { href: "/dashboard/emails", label: "Emails", icon: Mail, moduleKey: "emails" },
  { href: "/dashboard/weather", label: "Clima", icon: CloudSun, moduleKey: "weather" },
  { href: "/dashboard/fiscal", label: "Monitor Fiscal", icon: Briefcase, moduleKey: "fiscal" },
  { href: "/dashboard/travel", label: "Viajes", icon: Plane, moduleKey: "travel" },
  { href: "/dashboard/due-dates", label: "Vencimientos", icon: CalendarClock, moduleKey: "due-dates" },
  { href: "/dashboard/clients", label: "Clientes", icon: Users, moduleKey: "clients" },
  { href: "/dashboard/supplier-batches", label: "Proveedores", icon: Truck, moduleKey: "supplier-batches" },
  { href: "/dashboard/tax-calendars", label: "Calendarios", icon: CalendarDays, moduleKey: "tax-calendars" },
  { href: "/dashboard/finance", label: "Finanzas", icon: DollarSign, moduleKey: "finance" },
  { href: "/dashboard/goals", label: "Objetivos", icon: Target, moduleKey: "goals" },
  { href: "/dashboard/strategy", label: "Proyectos", icon: Flag, moduleKey: "strategy" },
  { href: "/dashboard/decisions", label: "Decisiones", icon: Brain, moduleKey: "decisions" },
  { href: "/dashboard/contacts", label: "Contactos", icon: Contact, moduleKey: "contacts" },
  { href: "/dashboard/quotes", label: "Presupuestos y Cob.", icon: FileText, moduleKey: "quotes" },
  { href: "/dashboard/fitness", label: "Actividad Física", icon: Dumbbell, moduleKey: "fitness" },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare, moduleKey: "chat" },
  { href: "/dashboard/studio", label: "Dashboard Studio", icon: LayoutGrid, moduleKey: "dashboard_studio" },
];

interface ModuleData {
  key: string;
  isActive: boolean;
  allowedRoles: string[];
}

function useVisibleModules() {
  const { data: me } = useCurrentUser();
  const { data: modules } = useQuery<ModuleData[]>({
    queryKey: ["modules"],
    queryFn: () => fetch(`${BASE}/api/modules`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
  });

  if (!modules || !me) return ALL_NAV_ITEMS;
  const moduleMap = new Map(modules.map(m => [m.key, m]));
  return ALL_NAV_ITEMS.filter(item => {
    const mod = moduleMap.get(item.moduleKey);
    if (!mod) return true;
    if (!mod.isActive) return false;
    return mod.allowedRoles.includes(me.role);
  });
}

// ── Unread messages hook ────────────────────────────────────────────────────────

function useUnreadMessages() {
  const { data } = useQuery<{ total: number }>({
    queryKey: ["chat-unread"],
    queryFn: () => fetch(`${BASE}/api/conversations/unread`).then(r => r.ok ? r.json() : { total: 0 }),
    refetchInterval: 10_000,
    staleTime: 0,
  });
  return data?.total ?? 0;
}

// ── NavLink ────────────────────────────────────────────────────────────────────

function NavLink({
  href, label, icon: Icon, location, onClick, collapsed, badge,
}: {
  href: string; label: string; icon: React.ElementType;
  location: string; onClick?: () => void; collapsed?: boolean; badge?: number;
}) {
  const isActive = location === href || (href !== "/dashboard" && location.startsWith(href));

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            onClick={onClick}
            className={`relative flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-all duration-150
              ${isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {badge != null && badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs font-medium">
          {label}{badge != null && badge > 0 ? ` (${badge})` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 group
        ${isActive
          ? "bg-primary/10 text-primary font-semibold border-l-[3px] border-primary pl-[calc(0.75rem-3px)]"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-l-[3px] border-transparent pl-[calc(0.75rem-3px)]"
        }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
      <span className="truncate flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto h-5 min-w-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1 shrink-0">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

// ── SidebarContent ─────────────────────────────────────────────────────────────

function SidebarContent({
  onNavigate, collapsed, pinned, onTogglePin, onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  onToggleCollapse?: () => void;
}) {
  const [location] = useLocation();
  const { data: me } = useCurrentUser();
  const visibleItems = useVisibleModules();
  const canSeeAdmin = isAdmin(me);
  const chatUnread = useUnreadMessages();

  if (collapsed) {
    return (
      <div className="flex h-full flex-col bg-sidebar border-r border-sidebar-border items-center py-3 gap-1">
        <div className="flex flex-col items-center h-[60px] justify-center mb-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/dashboard" onClick={onNavigate} className="flex items-center justify-center">
                <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
                  <Briefcase className="h-4 w-4 text-primary-foreground" />
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs font-medium">Executive Dashboard</TooltipContent>
          </Tooltip>
        </div>

        <Separator className="w-8 mb-1" />

        <nav className="flex flex-col gap-1 flex-1 overflow-y-auto w-full items-center px-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href} {...item} location={location} onClick={onNavigate} collapsed
              badge={item.moduleKey === "chat" ? chatUnread : undefined}
            />
          ))}

          <Separator className="w-8 my-1" />

          {canSeeAdmin && (
            <NavLink href="/admin" label="Admin" icon={Shield} location={location} onClick={onNavigate} collapsed />
          )}
          <NavLink href="/settings" label="Ajustes" icon={Settings} location={location} onClick={onNavigate} collapsed />
        </nav>

        <div className="flex flex-col items-center gap-1 pb-2">
          {onTogglePin && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={onTogglePin}
                  className={`flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-150
                    ${pinned ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
                >
                  {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {pinned ? "Desanclar sidebar" : "Anclar sidebar"}
              </TooltipContent>
            </Tooltip>
          )}
          {onToggleCollapse && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleCollapse}
                  className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-150"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Expandir sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-[60px] items-center px-4 shrink-0 gap-2">
        <Link href="/dashboard" className="flex items-center gap-2.5 flex-1 min-w-0" onClick={onNavigate}>
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Briefcase className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="font-serif font-bold text-sm tracking-tight text-foreground">Executive</span>
            <span className="text-[10px] text-muted-foreground">Dashboard Personal</span>
          </div>
        </Link>

        <div className="flex items-center gap-0.5 shrink-0">
          {onTogglePin && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={onTogglePin}
                  className={`flex items-center justify-center h-7 w-7 rounded-md transition-all duration-150
                    ${pinned ? "text-primary hover:bg-primary/10" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60"}`}
                >
                  {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {pinned ? "Desanclar — puede ocultarse" : "Anclar — siempre visible"}
              </TooltipContent>
            </Tooltip>
          )}
          {onToggleCollapse && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleCollapse}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-all duration-150"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Colapsar sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto py-3 px-2">
        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Principal
        </p>
        <nav className="flex flex-col gap-0.5">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href} {...item} location={location} onClick={onNavigate}
              badge={item.moduleKey === "chat" ? chatUnread : undefined}
            />
          ))}
        </nav>

        <Separator className="my-3" />

        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Sistema
        </p>
        <nav className="flex flex-col gap-0.5">
          {canSeeAdmin && (
            <NavLink href="/admin" label="Admin" icon={Shield} location={location} onClick={onNavigate} />
          )}
          <NavLink href="/settings" label="Ajustes" icon={Settings} location={location} onClick={onNavigate} />
        </nav>

        {me?.role && (
          <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-md bg-muted/60 flex items-center gap-2">
            {me.role === "super_admin"
              ? <Crown className="h-3 w-3 text-amber-500 shrink-0" />
              : <Shield className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="text-[10px] font-medium text-muted-foreground capitalize truncate">
              {me.role.replace("_", " ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Layout ────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const auth = useAuthContext();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modoHoyOpen, setModoHoyOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { open: searchOpen, setOpen: setSearchOpen } = useGlobalSearch();
  const qc = useQueryClient();

  const [sidebarState, setSidebarStateRaw] = useState<SidebarState>(loadSidebarState);
  const [sidebarPinned, setSidebarPinnedRaw] = useState(loadSidebarPinned);

  const setSidebarState = useCallback((s: SidebarState) => {
    setSidebarStateRaw(s);
    saveSidebarState(s);
  }, []);

  const setSidebarPinned = useCallback((p: boolean) => {
    setSidebarPinnedRaw(p);
    saveSidebarPinned(p);
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setSidebarState(sidebarState === "collapsed" ? "expanded" : "collapsed");
  }, [sidebarState, setSidebarState]);

  const handleTogglePin = useCallback(() => {
    setSidebarPinned(!sidebarPinned);
  }, [sidebarPinned, setSidebarPinned]);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarState === "hidden") {
      setSidebarState("expanded");
    } else {
      setSidebarState("hidden");
    }
  }, [sidebarState, setSidebarState]);

  async function handleRefresh() {
    setRefreshing(true);
    await qc.invalidateQueries();
    setTimeout(() => setRefreshing(false), 800);
  }

  const initials = auth.initials;

  const isCollapsed = sidebarState === "collapsed";
  const isHidden = sidebarState === "hidden";

  return (
    <div className="flex min-h-[100dvh] w-full overflow-x-hidden">
      {/* ── Desktop Sidebar ─────────────────────────────────────── */}
      <aside
        className={`hidden md:flex flex-col shrink-0 sticky top-0 h-screen overflow-hidden
          transition-[width] duration-300 ease-in-out
          ${isHidden ? "w-0" : isCollapsed ? "w-14" : "w-[260px]"}`}
      >
        <SidebarContent
          collapsed={isCollapsed}
          pinned={sidebarPinned}
          onTogglePin={handleTogglePin}
          onToggleCollapse={handleToggleCollapse}
        />
      </aside>

      {/* ── Main Content ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-[60px] items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-4 lg:px-6 shrink-0 sticky top-0 z-10">

          {/* Mobile hamburger */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menú</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[260px]">
              <SidebarContent onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Desktop sidebar toggle */}
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={handleToggleSidebar}
              >
                {isHidden ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                <span className="sr-only">{isHidden ? "Mostrar sidebar" : "Ocultar sidebar"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {isHidden ? "Mostrar sidebar" : "Ocultar sidebar"}
            </TooltipContent>
          </Tooltip>

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 max-w-xs items-center gap-2 h-8 px-3 rounded-md bg-muted/50 border border-transparent hover:border-border hover:bg-background text-sm text-muted-foreground transition-all duration-150"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Buscar...</span>
            <Kbd className="hidden sm:inline-flex text-[10px]">⌘K</Kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex h-8 px-3 gap-1.5 text-xs font-semibold bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
              onClick={() => setModoHoyOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Modo HOY
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={handleRefresh}
              title="Actualizar datos"
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="sr-only">Actualizar datos</span>
            </Button>
            <AlertsBell />
            <NotificationBell />
            <ThemeSelector />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={auth.userImageUrl} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{auth.userFullName || "Mi Cuenta"}</span>
                    <span className="text-xs font-normal text-muted-foreground truncate">
                      {auth.userEmail}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Ajustes
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => { void auth.signOut(); }}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar Sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 bg-muted/30 overflow-x-hidden">
          {children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <ModoHoy open={modoHoyOpen} onClose={() => setModoHoyOpen(false)} />
    </div>
  );
}
