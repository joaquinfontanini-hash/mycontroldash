import { useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useTheme } from "@/components/theme-provider";
import { THEMES, type AppTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

function ThemeCard({ id, name, dark, preview, active, onClick }: {
  id: AppTheme;
  name: string;
  dark: boolean;
  preview: { bg: string; surface: string; primary: string; accent: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full text-left rounded-xl border-2 p-2.5 transition-all duration-150",
        "hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary shadow-sm ring-1 ring-primary/30"
          : "border-border hover:border-primary/40",
      )}
      style={{ backgroundColor: preview.bg }}
      aria-label={`Aplicar tema ${name}`}
      aria-pressed={active}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          <span className="block h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: preview.primary }} />
          <span className="block h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: preview.accent }} />
          <span className="block h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: preview.surface }} />
        </div>
        {active && (
          <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5" style={{ color: dark ? "#121417" : "#fff" }} />
          </span>
        )}
      </div>
      <div
        className="h-8 rounded-lg mb-2 border border-black/10"
        style={{ background: `linear-gradient(135deg, ${preview.primary}88 0%, ${preview.accent}88 100%)` }}
      />
      <p
        className="text-[11px] font-semibold leading-none truncate"
        style={{ color: dark ? "#EAECEE" : "#1C1C1C" }}
      >
        {name}
      </p>
      {dark && (
        <span
          className="text-[9px] font-medium mt-0.5 block"
          style={{ color: "#A6ACAF" }}
        >
          Oscuro
        </span>
      )}
    </button>
  );
}

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const currentMeta = THEMES.find(t => t.id === theme);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 relative"
          aria-label="Cambiar tema de color"
          title="Cambiar tema de color"
        >
          <Palette className="h-4 w-4" />
          <span
            className="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-background"
            style={{ backgroundColor: currentMeta?.preview.primary ?? "#7FB3D5" }}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 p-3"
      >
        <div className="mb-3">
          <p className="text-sm font-semibold text-foreground">Tema de color</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Elegí el look de tu dashboard
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {THEMES.map(t => (
            <ThemeCard
              key={t.id}
              {...t}
              active={theme === t.id}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            />
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            Tu preferencia se guarda automáticamente
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
