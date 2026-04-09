import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useTheme } from "@/components/theme-provider";
import {
  LayoutDashboard,
  CheckSquare,
  Link as LinkIcon,
  Newspaper,
  Mail,
  CloudSun,
  Briefcase,
  Plane,
  Settings,
  Shield,
  Search,
  LogOut,
  Moon,
  Sun,
  Menu
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tareas", icon: CheckSquare },
  { href: "/dashboard/shortcuts", label: "Accesos Directos", icon: LinkIcon },
  { href: "/dashboard/news", label: "Noticias", icon: Newspaper },
  { href: "/dashboard/emails", label: "Emails", icon: Mail },
  { href: "/dashboard/weather", label: "Clima", icon: CloudSun },
  { href: "/dashboard/fiscal", label: "Monitor Fiscal", icon: Briefcase },
  { href: "/dashboard/travel", label: "Viajes", icon: Plane },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { theme, setTheme } = useTheme();

  // In a real app we'd fetch the user's role from our API to check if admin
  const isAdmin = true; // Hardcoded for now

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Briefcase className="h-6 w-6 text-primary" />
          <span className="font-serif tracking-tight">Executive</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
                  isActive ? "bg-muted text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          
          <div className="mt-4 mb-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
            Configuración
          </div>
          
          {isAdmin && (
            <Link
              href="/admin"
              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
                location === "/admin" ? "bg-muted text-primary" : "text-muted-foreground"
              }`}
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}
          
          <Link
            href="/settings"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
              location === "/settings" ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
          >
            <Settings className="h-4 w-4" />
            Ajustes
          </Link>
        </nav>
      </div>
    </div>
  );

  return (
    <div className="grid min-h-[100dvh] w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <SidebarContent />
      </div>
      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 md:hidden"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
              <SidebarContent />
            </SheetContent>
          </Sheet>
          
          <div className="w-full flex-1">
            <form>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar..."
                  className="w-full appearance-none bg-background pl-8 shadow-none md:w-2/3 lg:w-1/3"
                />
              </div>
            </form>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.imageUrl} />
                  <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
                <span className="sr-only">Toggle user menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mi Cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-muted/20">
          {children}
        </main>
      </div>
    </div>
  );
}
