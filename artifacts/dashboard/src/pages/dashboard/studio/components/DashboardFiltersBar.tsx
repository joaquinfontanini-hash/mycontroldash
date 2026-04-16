import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter } from "lucide-react";
import type { DashboardFilter } from "../types";

// ── Filter values shape ───────────────────────────────────────────────────────

export type FilterValues = Record<string, string | null>;

interface DashboardFiltersBarProps {
  filters: DashboardFilter[];
  onChange: (values: FilterValues) => void;
}

// Common select options for known filter keys
const KNOWN_SELECT_OPTIONS: Record<string, { label: string; value: string }[]> = {
  client_status: [
    { label: "Activo", value: "active" },
    { label: "Inactivo", value: "inactive" },
  ],
  news_category: [
    { label: "Economía", value: "economia" },
    { label: "Política", value: "politica" },
    { label: "Mercados", value: "mercados" },
    { label: "Tecnología", value: "tecnologia" },
  ],
};

export function DashboardFiltersBar({ filters, onChange }: DashboardFiltersBarProps) {
  const [values, setValues] = useState<FilterValues>(() => {
    const initial: FilterValues = {};
    for (const f of filters) {
      if (f.type === "date_range") {
        // Use dateFrom/dateTo keys — these are the params the backend resolvers expect
        initial["dateFrom"] = null;
        initial["dateTo"]   = null;
      } else {
        initial[f.key] = f.defaultValueJson != null ? String(f.defaultValueJson) : null;
      }
    }
    return initial;
  });

  const activeCount = Object.values(values).filter(v => v !== null && v !== "").length;

  const update = useCallback((key: string, value: string | null) => {
    setValues(prev => {
      const next = { ...prev, [key]: value };
      // Emit flattened filter values — dateFrom/dateTo handled specially
      const out: FilterValues = {};
      for (const [k, v] of Object.entries(next)) {
        if (v !== null && v !== "") out[k] = v;
      }
      onChange(out);
      return next;
    });
  }, [onChange]);

  const clearAll = useCallback(() => {
    const cleared: FilterValues = {};
    for (const key of Object.keys(values)) cleared[key] = null;
    setValues(cleared);
    onChange({});
  }, [values, onChange]);

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-3 px-1 py-2 rounded-lg border bg-muted/30">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
        <Filter className="h-3.5 w-3.5" />
        <span className="font-medium">Filtros</span>
        {activeCount > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-xs">{activeCount}</Badge>
        )}
      </div>

      {filters.map(filter => (
        <FilterControl
          key={filter.id}
          filter={filter}
          values={values}
          onUpdate={update}
        />
      ))}

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={clearAll}
        >
          <X className="h-3 w-3 mr-1" />
          Limpiar
        </Button>
      )}
    </div>
  );
}

// ── Individual filter control ─────────────────────────────────────────────────

function FilterControl({
  filter,
  values,
  onUpdate,
}: {
  filter: DashboardFilter;
  values: FilterValues;
  onUpdate: (key: string, value: string | null) => void;
}) {
  if (filter.type === "date_range") {
    // dateFrom/dateTo are the canonical backend param names
    return (
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{filter.label} — desde</Label>
          <Input
            type="date"
            className="h-8 text-xs w-36"
            value={values["dateFrom"] ?? ""}
            onChange={e => onUpdate("dateFrom", e.target.value || null)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">hasta</Label>
          <Input
            type="date"
            className="h-8 text-xs w-36"
            value={values["dateTo"] ?? ""}
            onChange={e => onUpdate("dateTo", e.target.value || null)}
          />
        </div>
      </div>
    );
  }

  if (filter.type === "select") {
    const options = KNOWN_SELECT_OPTIONS[filter.key] ?? [];
    if (options.length === 0) return null; // Unknown select key, skip rendering
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{filter.label}</Label>
        <Select
          value={values[filter.key] ?? ""}
          onValueChange={v => onUpdate(filter.key, v || null)}
        >
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (filter.type === "text") {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{filter.label}</Label>
        <Input
          type="text"
          className="h-8 text-xs w-40"
          placeholder="Buscar..."
          value={values[filter.key] ?? ""}
          onChange={e => onUpdate(filter.key, e.target.value || null)}
        />
      </div>
    );
  }

  return null;
}
