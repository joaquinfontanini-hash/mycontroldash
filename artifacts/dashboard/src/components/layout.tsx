import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/components/theme-provider";
import GlobalSearch, { useGlobalSearch } from "@/components/global-search";
import {
  LayoutDashboard,
  CheckSquare,
  Link as LinkIcon,
  Newspaper,
  Mail,
  CloudSun,
  Briefcase,
  Plane,
  CalendarClock,
  CalendarDays,
  Settings,
  Shield,
  Search,
  LogOut,
  Moon,
  Sun,
  Menu,
  Users,
  Truck,
  Crown,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { useCurrentUser, isAdmin } from "@/hooks/use-current-user";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const ALL_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, moduleKey: "dashboard" },
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

function NavLink({ href, label, icon: Icon, location, onClick }: {
  href: string;
  label: string;
  icon: React.ElementType;
  location: string;
  onClick?: () => void;
}) {
  const isActive = location === href || (href !== "/dashboard" && location.startsWith(href));
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
      <span>{label}</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { data: me } = useCurrentUser();
  const visibleItems = useVisibleModules();
  const canSeeAdmin = isAdmin(me);

  return (
    <div className="flex h-full flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-[60px] items-center px-5 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onNavigate}>
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
            <Briefcase className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-serif font-bold text-sm tracking-tight text-foreground">Executive</span>
            <span className="text-[10px] text-muted-foreground">Dashboard Personal</span>
          </div>
        </Link>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto py-3 px-2">
        <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Principal
        </p>
        <nav className="flex flex-col gap-0.5">
          {visibleItems.map((item) => (
            <NavLink key={item.href} {...item} location={location} onClick={onNavigate} />
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
              ? <Crown className="h-3 w-3 text-amber-500" />
              : <Shield className="h-3 w-3 text-muted-foreground" />}
            <span className="text-[10px] font-medium text-muted-foreground capitalize">{me.role.replace("_", " ")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { theme, setTheme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { open: searchOpen, setOpen: setSearchOpen } = useGlobalSearch();

  const initials = [user?.firstName?.charAt(0), user?.lastName?.charAt(0)]
    .filter(Boolean).join("") || "U";

  return (
    <div className="flex min-h-[100dvh] w-full">
      <aside className="hidden md:flex w-[240px] lg:w-[260px] flex-col shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-[60px] items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-4 lg:px-6 shrink-0 sticky top-0 z-10">
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
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Tema</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{user?.fullName || "Mi Cuenta"}</span>
                    <span className="text-xs font-normal text-muted-foreground truncate">
                      {user?.primaryEmailAddress?.emailAddress}
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
                  onClick={() => signOut()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar Sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 bg-muted/30">
          {children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
