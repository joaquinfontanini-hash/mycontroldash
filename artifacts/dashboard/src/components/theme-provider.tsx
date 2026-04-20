import React, { createContext, useContext, useEffect, useState } from "react";
import { type AppTheme, DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from "@/lib/themes";

interface ThemeProviderState {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: DEFAULT_THEME,
  setTheme: () => null,
});

function resolveTheme(raw: string | null): AppTheme {
  const valid = THEMES.map(t => t.id);
  if (raw && valid.includes(raw as AppTheme)) return raw as AppTheme;
  const legacy: Record<string, AppTheme> = { dark: "dark-elegant", light: "clean-light", system: DEFAULT_THEME };
  return legacy[raw ?? ""] ?? DEFAULT_THEME;
}

function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  const meta = THEMES.find(t => t.id === theme);
  root.setAttribute("data-theme", theme);
  if (meta?.dark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = THEME_STORAGE_KEY,
}: {
  children: React.ReactNode;
  defaultTheme?: AppTheme | string;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const saved = localStorage.getItem(storageKey) ?? localStorage.getItem("dashboard-theme");
    return resolveTheme(saved) ?? resolveTheme(defaultTheme) ?? DEFAULT_THEME;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (next: AppTheme) => {
    localStorage.setItem(storageKey, next);
    setThemeState(next);
  };

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
