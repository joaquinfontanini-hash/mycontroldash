import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, CheckSquare, Link as LinkIcon, Newspaper,
  Mail, CloudSun, Briefcase, Plane, Settings, Shield,
  ExternalLink,
} from "lucide-react";
import { useListTasks, useListShortcuts } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tareas", icon: CheckSquare },
  { href: "/dashboard/shortcuts", label: "Accesos Directos", icon: LinkIcon },
  { href: "/dashboard/news", label: "Noticias", icon: Newspaper },
  { href: "/dashboard/emails", label: "Emails", icon: Mail },
  { href: "/dashboard/weather", label: "Clima", icon: CloudSun },
  { href: "/dashboard/fiscal", label: "Monitor Fiscal", icon: Briefcase },
  { href: "/dashboard/travel", label: "Viajes", icon: Plane },
  { href: "/settings", label: "Ajustes", icon: Settings },
  { href: "/admin", label: "Administración", icon: Shield },
];

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [, navigate] = useLocation();
  const { data: tasks } = useListTasks();
  const { data: shortcuts } = useListShortcuts();

  const runAndClose = useCallback((fn: () => void) => {
    fn();
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar secciones, tareas, enlaces..." />
      <CommandList>
        <CommandEmpty>Sin resultados para tu búsqueda.</CommandEmpty>

        <CommandGroup heading="Navegación">
          {NAV_ITEMS.map(item => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => runAndClose(() => navigate(item.href))}
              className="gap-2"
            >
              <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {tasks && tasks.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tareas">
              {tasks.slice(0, 5).map(task => (
                <CommandItem
                  key={task.id}
                  value={`tarea ${task.title}`}
                  onSelect={() => runAndClose(() => navigate("/dashboard/tasks"))}
                  className="gap-2"
                >
                  <CheckSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{task.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
                    ${task.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : task.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"}`}>
                    {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Media" : "Baja"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {shortcuts && shortcuts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accesos Directos">
              {shortcuts.slice(0, 6).map(sc => (
                <CommandItem
                  key={sc.id}
                  value={`enlace ${sc.name}`}
                  onSelect={() => runAndClose(() => window.open(sc.url, "_blank", "noopener,noreferrer"))}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{sc.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {sc.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useGlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
