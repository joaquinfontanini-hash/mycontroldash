import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plane, MapPin, Search, Plus, Edit2, Trash2, Play, Pause, Copy,
  AlertTriangle, CheckCircle2, Clock, Star, Users, Calendar,
  DollarSign, RefreshCw, Filter, ChevronDown, X, Building,
  Globe, Bookmark, Eye, XCircle, Info, Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationItem {
  id: string;
  label: string;
  normalizedName: string;
  code: string | null;
  country: string;
  region: string;
  type: string;
  aliases: string[];
}

interface SearchProfile {
  id: string;
  userId: number;
  name: string;
  isActive: boolean;
  travelType: string;
  originJson: LocationItem;
  destinationMode: string;
  destinationsJson: LocationItem[] | null;
  regionsJson: string[] | null;
  maxBudget: string;
  currency: string;
  travelersCount: number;
  travelerProfile: string;
  minDays: number | null;
  maxDays: number | null;
  airlinePreferencesJson: string[] | null;
  hotelMinStars: number | null;
  mealPlan: string | null;
  directFlightOnly: boolean;
  dateFlexibilityDays: number | null;
  refreshFrequencyHours: number;
  tolerancePercent: number;
  priority: number;
  notes: string | null;
  searchType: "vuelos" | "paquetes" | "ambos";
  departureDateFrom: string | null;
  departureDateTo: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummaryJson: { count: number; skipped: number; errors: string[]; runCount?: number; ranAt: string } | null;
}

interface SearchResult {
  id: string;
  searchProfileId: string;
  userId: number;
  source: string;
  externalId: string | null;
  externalUrl: string | null;
  title: string;
  originJson: LocationItem;
  destinationJson: LocationItem;
  region: string | null;
  country: string | null;
  price: string;
  currency: string;
  priceOriginal: string | null;
  priceOriginalCurrency: string | null;
  pricePerPerson: string | null;
  exchangeRate: string | null;
  days: number | null;
  nights: number | null;
  travelersCount: number | null;
  airline: string | null;
  hotelName: string | null;
  hotelStars: number | null;
  mealPlan: string | null;
  departureDate: string | null;
  returnDate: string | null;
  confidenceScore: number;
  validationStatus: string;
  status: string;
  foundAt: string;
  searchType: "vuelo" | "paquete" | null;
  apiSource: "serpapi" | "amadeus" | "simulado" | null;
  durationMinutes: number | null;
  stops: number | null;
  departureTime: string | null;
  arrivalTime: string | null;
}

interface ProfileForm {
  name: string;
  travelType: "nacional" | "internacional" | "corporativo" | "beneficio";
  origin: LocationItem | null;
  destinationMode: "specific" | "region" | "mixed";
  destinations: LocationItem[];
  regions: string[];
  maxBudget: string;
  currency: "ARS" | "USD" | "EUR";
  travelersCount: string;
  travelerProfile: "solo" | "pareja" | "familia" | "corporativo";
  minDays: string;
  maxDays: string;
  airlines: string;
  hotelMinStars: string;
  mealPlan: string;
  directFlightOnly: boolean;
  dateFlexibilityDays: string;
  refreshFrequencyHours: string;
  tolerancePercent: string;
  notes: string;
  isActive: boolean;
  searchType: "vuelos" | "paquetes" | "ambos";
  departureDateFrom: string;
  departureDateTo: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FORM: ProfileForm = {
  name: "",
  travelType: "nacional",
  origin: null,
  destinationMode: "specific",
  destinations: [],
  regions: [],
  maxBudget: "",
  currency: "ARS",
  travelersCount: "2",
  travelerProfile: "pareja",
  minDays: "",
  maxDays: "",
  airlines: "",
  hotelMinStars: "",
  mealPlan: "",
  directFlightOnly: false,
  dateFlexibilityDays: "",
  refreshFrequencyHours: "24",
  tolerancePercent: "20",
  notes: "",
  isActive: true,
  searchType: "ambos",
  departureDateFrom: "",
  departureDateTo: "",
};

const TRAVEL_TYPES = [
  { value: "nacional", label: "Nacional", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "internacional", label: "Internacional", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "corporativo", label: "Corporativo", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "beneficio", label: "Beneficio", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
];

const TRAVELER_PROFILES = [
  { value: "solo", label: "Solo" },
  { value: "pareja", label: "Pareja" },
  { value: "familia", label: "Familia" },
  { value: "corporativo", label: "Corporativo" },
];

const REGIONS = [
  "Patagonia", "Argentina", "Centro", "Norte", "Litoral",
  "Cuyo", "Caribe", "Sudamérica", "Norteamérica", "Europa", "Asia",
];

const VALIDATION_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  validated:    { label: "Validado",      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  weak_match:   { label: "Coincidencia parcial", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: AlertTriangle },
  broken_link:  { label: "Link roto",     color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle },
  expired:      { label: "Expirado",      color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: Clock },
  pending:      { label: "Pendiente",     color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: Clock },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new:       { label: "Nueva",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  seen:      { label: "Vista",     color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  saved:     { label: "Guardada",  color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  dismissed: { label: "Descartada", color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
  expired:   { label: "Expirada",  color: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function fmtPrice(price: string, currency: string) {
  const num = Number(price);
  if (isNaN(num) || num <= 0) return "—";
  const locale = currency === "ARS" ? "es-AR" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(num);
}

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelative(d?: string | null) {
  if (!d) return null;
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hs = Math.floor(mins / 60);
  if (hs < 24) return `hace ${hs} h`;
  const days = Math.floor(hs / 24);
  return `hace ${days} día${days > 1 ? "s" : ""}`;
}

function travelTypeColor(type: string) {
  return TRAVEL_TYPES.find(t => t.value === type)?.color
    ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
}

function travelTypeLabel(type: string) {
  return TRAVEL_TYPES.find(t => t.value === type)?.label ?? type;
}

// ── LocationAutocomplete ──────────────────────────────────────────────────────

function LocationAutocomplete({
  value,
  onChange,
  placeholder = "Buscar ciudad o aeropuerto...",
  label,
  required,
}: {
  value: LocationItem | null;
  onChange: (loc: LocationItem | null) => void;
  placeholder?: string;
  label: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const debouncedQuery = query;
  const { data: results = [], isFetching } = useQuery<LocationItem[]>({
    queryKey: ["travel-locations", debouncedQuery],
    queryFn: () => apiFetch<LocationItem[]>(`/api/travel/locations?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length >= 1,
    staleTime: 10000,
  });

  useEffect(() => {
    if (value) setQuery(value.label);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
        if (!value) setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [value]);

  const handleSelect = (loc: LocationItem) => {
    onChange(loc);
    setQuery(loc.label);
    setOpen(false);
    setFocused(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="space-y-1.5" ref={ref}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onChange(null);
          }}
          onFocus={() => { setFocused(true); setOpen(query.length >= 1); }}
          placeholder={placeholder}
          className="h-9 pl-8 pr-8"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {open && query.length >= 1 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {isFetching && (
              <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Buscando...
              </div>
            )}
            {!isFetching && results.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Sin resultados para "{query}"</div>
            )}
            {results.map(loc => (
              <button
                key={loc.id}
                type="button"
                onClick={() => handleSelect(loc)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-start gap-2"
              >
                <span className="shrink-0 mt-0.5 text-muted-foreground">
                  {loc.type === "airport" ? "✈" : "📍"}
                </span>
                <span>
                  <span className="font-medium">{loc.label}</span>
                  <span className="text-muted-foreground text-xs block">{loc.country} · {loc.region}</span>
                </span>
                {loc.code && (
                  <span className="ml-auto text-xs font-mono text-muted-foreground shrink-0">{loc.code}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {value && (
        <p className="text-xs text-muted-foreground">{value.country} · {value.region}</p>
      )}
    </div>
  );
}

// ── MultiLocationAutocomplete ─────────────────────────────────────────────────

function MultiLocationAutocomplete({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: LocationItem[];
  onChange: (locs: LocationItem[]) => void;
  label: string;
  placeholder?: string;
}) {
  const [single, setSingle] = useState<LocationItem | null>(null);

  const handleAdd = (loc: LocationItem | null) => {
    if (!loc) return;
    if (!value.find(v => v.label === loc.label)) {
      onChange([...value, loc]);
    }
    setSingle(null);
  };

  return (
    <div className="space-y-2">
      <LocationAutocomplete
        value={single}
        onChange={handleAdd}
        label={label}
        placeholder={placeholder}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {value.map((loc, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full"
            >
              {loc.code ? `${loc.label} (${loc.code})` : loc.label}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Search Profile Form Dialog ────────────────────────────────────────────────

function ProfileFormDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: SearchProfile | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ProfileForm>(() => {
    if (editing) {
      return {
        name: editing.name,
        travelType: editing.travelType as ProfileForm["travelType"],
        origin: editing.originJson,
        destinationMode: editing.destinationMode as ProfileForm["destinationMode"],
        destinations: editing.destinationsJson ?? [],
        regions: editing.regionsJson ?? [],
        maxBudget: editing.maxBudget,
        currency: editing.currency as ProfileForm["currency"],
        travelersCount: String(editing.travelersCount),
        travelerProfile: editing.travelerProfile as ProfileForm["travelerProfile"],
        minDays: editing.minDays != null ? String(editing.minDays) : "",
        maxDays: editing.maxDays != null ? String(editing.maxDays) : "",
        airlines: editing.airlinePreferencesJson?.join(", ") ?? "",
        hotelMinStars: editing.hotelMinStars != null ? String(editing.hotelMinStars) : "",
        mealPlan: editing.mealPlan ?? "",
        directFlightOnly: editing.directFlightOnly,
        dateFlexibilityDays: editing.dateFlexibilityDays != null ? String(editing.dateFlexibilityDays) : "",
        refreshFrequencyHours: String(editing.refreshFrequencyHours),
        tolerancePercent: String(editing.tolerancePercent),
        notes: editing.notes ?? "",
        isActive: editing.isActive,
        searchType: editing.searchType ?? "ambos",
        departureDateFrom: editing.departureDateFrom ?? "",
        departureDateTo: editing.departureDateTo ?? "",
      };
    }
    return { ...EMPTY_FORM };
  });
  const [formError, setFormError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) =>
    setForm(f => ({ ...f, [k]: v })), []);

  const mutation = useMutation({
    mutationFn: async (data: ProfileForm) => {
      if (!data.origin) throw new Error("El origen es obligatorio.");
      if (data.destinationMode === "specific" && data.destinations.length === 0)
        throw new Error("Agregá al menos un destino.");
      if (data.destinationMode === "region" && data.regions.length === 0)
        throw new Error("Seleccioná al menos una región.");

      const body = {
        name: data.name.trim(),
        travelType: data.travelType,
        originJson: data.origin,
        destinationMode: data.destinationMode,
        destinationsJson: data.destinations.length > 0 ? data.destinations : null,
        regionsJson: data.regions.length > 0 ? data.regions : null,
        maxBudget: Number(data.maxBudget),
        currency: data.currency,
        travelersCount: Number(data.travelersCount) || 1,
        travelerProfile: data.travelerProfile,
        minDays: data.minDays ? Number(data.minDays) : null,
        maxDays: data.maxDays ? Number(data.maxDays) : null,
        airlinePreferencesJson: data.airlines
          ? data.airlines.split(",").map(s => s.trim()).filter(Boolean)
          : null,
        hotelMinStars: data.hotelMinStars ? Number(data.hotelMinStars) : null,
        mealPlan: data.mealPlan || null,
        directFlightOnly: data.directFlightOnly,
        dateFlexibilityDays: data.dateFlexibilityDays ? Number(data.dateFlexibilityDays) : null,
        refreshFrequencyHours: Number(data.refreshFrequencyHours) || 24,
        tolerancePercent: Number(data.tolerancePercent) || 20,
        notes: data.notes.trim() || null,
        isActive: data.isActive,
        searchType: data.searchType,
        departureDateFrom: data.departureDateFrom || null,
        departureDateTo: data.departureDateTo || null,
      };

      if (editing) {
        return apiFetch(`/api/travel/search-profiles/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return apiFetch("/api/travel/search-profiles", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast({ title: editing ? "Búsqueda actualizada" : "Búsqueda creada" });
      onSaved();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const handleSubmit = () => {
    setFormError(null);
    if (!form.name.trim()) return setFormError("El nombre es obligatorio.");
    if (!form.origin)       return setFormError("El origen es obligatorio.");
    if (!form.maxBudget || isNaN(Number(form.maxBudget)) || Number(form.maxBudget) <= 0)
      return setFormError("El presupuesto debe ser mayor a 0.");
    if (form.destinationMode === "specific" && form.destinations.length === 0)
      return setFormError("Agregá al menos un destino.");
    if (form.destinationMode === "region" && form.regions.length === 0)
      return setFormError("Seleccioná al menos una región.");
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar búsqueda" : "Nueva búsqueda guardada"}</DialogTitle>
          <DialogDescription>
            Definí las reglas de monitoreo y el sistema buscará ofertas que coincidan automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {formError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {formError}
            </div>
          )}

          {/* Nombre */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Nombre de la búsqueda <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Ej: Escapada familiar Bariloche invierno"
              className="h-9"
            />
          </div>

          {/* Tipo de viaje + Perfil de viajero */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tipo de viaje <span className="text-destructive">*</span>
              </Label>
              <select
                value={form.travelType}
                onChange={e => set("travelType", e.target.value as ProfileForm["travelType"])}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {TRAVEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Perfil de viajero
              </Label>
              <select
                value={form.travelerProfile}
                onChange={e => set("travelerProfile", e.target.value as ProfileForm["travelerProfile"])}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {TRAVELER_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Origen */}
          <LocationAutocomplete
            value={form.origin}
            onChange={loc => set("origin", loc)}
            label="Origen"
            placeholder="Neuquén, Buenos Aires..."
            required
          />

          {/* Modo de destino */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Destino <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              {(["specific", "region", "mixed"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => set("destinationMode", mode)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all
                    ${form.destinationMode === mode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted"
                    }`}
                >
                  {mode === "specific" ? "Ciudad específica" : mode === "region" ? "Por región" : "Mixto"}
                </button>
              ))}
            </div>

            {(form.destinationMode === "specific" || form.destinationMode === "mixed") && (
              <MultiLocationAutocomplete
                value={form.destinations}
                onChange={locs => set("destinations", locs)}
                label="Destinos"
                placeholder="Bariloche, Cancún, París..."
              />
            )}

            {(form.destinationMode === "region" || form.destinationMode === "mixed") && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Regiones</Label>
                <div className="flex flex-wrap gap-1.5">
                  {REGIONS.map(r => {
                    const active = form.regions.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => set("regions", active ? form.regions.filter(x => x !== r) : [...form.regions, r])}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                          ${active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted"
                          }`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Presupuesto + Moneda + Personas */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Presupuesto máx. <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min="0"
                value={form.maxBudget}
                onChange={e => set("maxBudget", e.target.value)}
                placeholder="250000"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Moneda</Label>
              <select
                value={form.currency}
                onChange={e => set("currency", e.target.value as ProfileForm["currency"])}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {(["ARS", "USD", "EUR"] as const).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Personas <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                value={form.travelersCount}
                onChange={e => set("travelersCount", e.target.value)}
                placeholder="2"
                className="h-9"
              />
            </div>
          </div>

          {/* Tolerancia + Frecuencia */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tolerancia de precio (%)
              </Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.tolerancePercent}
                onChange={e => set("tolerancePercent", e.target.value)}
                placeholder="20"
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Acepta ofertas hasta este % sobre el presupuesto</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Actualizar cada (horas)
              </Label>
              <Input
                type="number"
                min="1"
                value={form.refreshFrequencyHours}
                onChange={e => set("refreshFrequencyHours", e.target.value)}
                placeholder="24"
                className="h-9"
              />
            </div>
          </div>

          {/* Opcional — duración */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Duración mín. (días) <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input
                type="number" min="1"
                value={form.minDays}
                onChange={e => set("minDays", e.target.value)}
                placeholder="Sin mínimo"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Duración máx. (días) <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input
                type="number" min="1"
                value={form.maxDays}
                onChange={e => set("maxDays", e.target.value)}
                placeholder="Sin máximo"
                className="h-9"
              />
            </div>
          </div>

          {/* Opcional — aerolínea + hotel */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Aerolínea preferida <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input
                value={form.airlines}
                onChange={e => set("airlines", e.target.value)}
                placeholder="Aerolíneas, LATAM, Flybondi..."
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Separadas por coma</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Hotel mín. (★) <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <select
                value={form.hotelMinStars}
                onChange={e => set("hotelMinStars", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sin preferencia</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} ★</option>)}
              </select>
            </div>
          </div>

          {/* Régimen + Vuelo directo */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Régimen de comidas <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <select
                value={form.mealPlan}
                onChange={e => set("mealPlan", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sin preferencia</option>
                <option value="sin comidas">Sin comidas</option>
                <option value="desayuno">Desayuno</option>
                <option value="media pensión">Media pensión</option>
                <option value="pensión completa">Pensión completa</option>
                <option value="todo incluido">Todo incluido</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Opciones</Label>
              <label className="flex items-center gap-2 h-9 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.directFlightOnly}
                  onChange={e => set("directFlightOnly", e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Solo vuelo directo</span>
              </label>
            </div>
          </div>

          {/* Tipo de búsqueda + Fechas de salida */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5 col-span-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo de búsqueda</Label>
              <div className="flex gap-1">
                {(["vuelos", "paquetes", "ambos"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => set("searchType", opt)}
                    className={`flex-1 text-xs py-1.5 rounded border font-medium transition-colors ${
                      form.searchType === opt
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    {opt === "vuelos" ? "✈ Vuelos" : opt === "paquetes" ? "🏨 Paquetes" : "⚡ Ambos"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Período de búsqueda <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
              </Label>
              <p className="text-xs text-muted-foreground -mt-1">
                El sistema buscará ofertas con salida dentro de este período. Sin fechas, busca desde hoy hasta 60 días adelante.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Desde</span>
                  <Input
                    type="date"
                    value={form.departureDateFrom}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={e => set("departureDateFrom", e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Hasta</span>
                  <Input
                    type="date"
                    value={form.departureDateTo}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={e => set("departureDateTo", e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notas <span className="text-xs font-normal normal-case text-muted-foreground/60">(opcional)</span>
            </Label>
            <textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Observaciones adicionales sobre esta búsqueda..."
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando..." : editing ? "Guardar cambios" : "Crear búsqueda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Search Profile Card ────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  onEdit,
  onDelete,
  onRun,
  onToggle,
  onDuplicate,
  resultsCount,
}: {
  profile: SearchProfile;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  resultsCount: number;
  isRunning?: boolean;
}) {
  const origin = profile.originJson;
  const dests = profile.destinationsJson ?? [];
  const regions = profile.regionsJson ?? [];

  const destLabel = profile.destinationMode === "region"
    ? regions.join(", ")
    : dests.map(d => d.code ?? d.label).join(", ") || "—";

  return (
    <Card className={`transition-all hover:shadow-md ${!profile.isActive ? "opacity-60 bg-muted/30" : "bg-card"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-xs ${travelTypeColor(profile.travelType)}`}>
                {travelTypeLabel(profile.travelType)}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {profile.searchType === "vuelos" ? "✈ Vuelos" : profile.searchType === "paquetes" ? "🏨 Paquetes" : "⚡ Ambos"}
              </Badge>
              {!profile.isActive && (
                <Badge variant="outline" className="text-xs text-muted-foreground">Pausada</Badge>
              )}
            </div>
            <CardTitle className="text-base mt-1.5 leading-snug">{profile.name}</CardTitle>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggle} title={profile.isActive ? "Pausar" : "Activar"}>
              {profile.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Editar">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate} title="Duplicar">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} title="Eliminar">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Origen → Destino */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">
            <span className="text-foreground font-medium">{origin.code ?? origin.label}</span>
            {" → "}
            <span className="text-foreground">{destLabel}</span>
          </span>
        </div>

        {/* Presupuesto + Personas */}
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">{fmtPrice(profile.maxBudget, profile.currency)}</span>
            <span className="text-xs">(±{profile.tolerancePercent}%)</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{profile.travelersCount} pax · {profile.travelerProfile}</span>
          </span>
        </div>

        {/* Filtros opcionales */}
        <div className="flex flex-wrap gap-1.5">
          {profile.minDays != null && profile.maxDays != null && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {profile.minDays}–{profile.maxDays} días
            </span>
          )}
          {profile.minDays != null && profile.maxDays == null && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              mín. {profile.minDays} días
            </span>
          )}
          {profile.hotelMinStars != null && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {"★".repeat(profile.hotelMinStars)} mín.
            </span>
          )}
          {profile.directFlightOnly && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              Vuelo directo
            </span>
          )}
          {profile.airlinePreferencesJson && profile.airlinePreferencesJson.length > 0 && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {profile.airlinePreferencesJson.join(", ")}
            </span>
          )}
          {profile.mealPlan && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {profile.mealPlan}
            </span>
          )}
        </div>

        {/* Período de búsqueda */}
        {(profile.departureDateFrom || profile.departureDateTo) && (
          <p className="text-xs text-muted-foreground">
            📅{" "}
            {profile.departureDateFrom
              ? new Date(profile.departureDateFrom + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
              : "Hoy"}
            {" → "}
            {profile.departureDateTo
              ? new Date(profile.departureDateTo + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
              : "Sin límite"}
          </p>
        )}

        {/* Estado de última ejecución */}
        {profile.lastRunStatus === "error" && (
          <div className="mt-1">
            <span className="text-destructive text-xs font-medium">● Error en última ejecución</span>
            {profile.lastRunSummaryJson?.errors?.length > 0 && (
              <p className="text-xs text-destructive/80 mt-0.5 leading-relaxed line-clamp-2">
                {profile.lastRunSummaryJson.errors[0]}
              </p>
            )}
          </div>
        )}
        {profile.lastRunStatus === "ok" && profile.lastRunSummaryJson?.count === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            ● Sin resultados — precio por debajo del mercado actual
          </p>
        )}
        {profile.lastRunStatus === "ok" && (profile.lastRunSummaryJson?.count ?? 0) > 0 && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            ● {profile.lastRunSummaryJson!.count} oferta{profile.lastRunSummaryJson!.count > 1 ? "s" : ""} encontrada{profile.lastRunSummaryJson!.count > 1 ? "s" : ""}
          </p>
        )}

        {/* Footer: última ejecución + botón */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="text-xs text-muted-foreground">
            {profile.lastRunAt ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {fmtRelative(profile.lastRunAt)}
                {profile.lastRunSummaryJson?.runCount != null && (
                  <span className="text-muted-foreground/60">· #{profile.lastRunSummaryJson.runCount}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground/60">Sin ejecutar</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {resultsCount > 0 && (
              <span className="text-xs font-medium text-primary">
                {resultsCount} oferta{resultsCount !== 1 ? "s" : ""}
              </span>
            )}
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRun}>
              <Play className="h-3 w-3" />
              Ejecutar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Result Card ───────────────────────────────────────────────────────────────

function ResultCard({
  result,
  profileName,
  onStatusChange,
}: {
  result: SearchResult;
  profileName: string;
  onStatusChange: (status: string) => void;
}) {
  const validConf = VALIDATION_CONFIG[result.validationStatus] ?? VALIDATION_CONFIG.pending!;
  const statusConf = STATUS_CONFIG[result.status] ?? STATUS_CONFIG.new!;
  const ValidIcon = validConf.icon;

  const isWeak = result.validationStatus === "weak_match";
  const isInactive = result.validationStatus === "broken_link" || result.validationStatus === "expired" || result.status === "dismissed";

  return (
    <Card className={`transition-all hover:shadow-md
      ${isWeak ? "border-amber-300 dark:border-amber-700" : ""}
      ${isInactive ? "opacity-50 bg-muted/20" : "bg-card"}
    `}>
      <CardContent className="pt-4 space-y-3">
        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${validConf.color}`}>
            <ValidIcon className="h-3 w-3 mr-1" />
            {validConf.label}
          </Badge>
          <Badge className={`text-xs ${statusConf.color}`}>{statusConf.label}</Badge>
          {result.searchType && (
            <Badge variant="outline" className="text-xs">
              {result.searchType === "vuelo" ? "✈ Vuelo" : "🏨 Paquete"}
            </Badge>
          )}
          {result.apiSource && (
            <Badge variant="outline" className={`text-xs ${
              result.apiSource === "serpapi" ? "border-green-400 text-green-700 dark:text-green-400" :
              result.apiSource === "amadeus" ? "border-blue-400 text-blue-700 dark:text-blue-400" :
              "border-gray-300 text-muted-foreground"
            }`}>
              {result.apiSource === "serpapi" ? "SerpAPI" : result.apiSource === "amadeus" ? "Amadeus" : "Simulado"}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">score {result.confidenceScore}</span>
        </div>

        {/* Title + Source */}
        <div>
          <p className="font-medium text-sm leading-snug">{result.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{result.source} · {profileName}</p>
        </div>

        {/* Origin → Destination */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span>{(result.originJson as LocationItem).code ?? (result.originJson as LocationItem).label}</span>
          <span>→</span>
          <span className="text-foreground font-medium">{(result.destinationJson as LocationItem).label}</span>
          {result.departureTime && <span className="ml-1 text-xs">dep {result.departureTime}</span>}
          {result.arrivalTime && <span className="text-xs">arr {result.arrivalTime}</span>}
        </div>
        {(result.durationMinutes != null || result.stops != null) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {result.durationMinutes != null && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{Math.floor(result.durationMinutes / 60)}h {result.durationMinutes % 60}m</span>
            )}
            {result.stops != null && (
              <span>{result.stops === 0 ? "Directo" : `${result.stops} escala${result.stops > 1 ? "s" : ""}`}</span>
            )}
          </div>
        )}

        {/* Price */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xl font-bold">{fmtPrice(result.price, result.currency)}</div>
            {(result.travelersCount ?? 1) > 1 && result.pricePerPerson && (
              <div className="text-xs text-muted-foreground">
                {fmtPrice(result.pricePerPerson, result.currency)} por persona · {result.travelersCount} pax
              </div>
            )}
            {result.priceOriginal && result.priceOriginalCurrency && result.currency !== result.priceOriginalCurrency && (
              <div className="text-xs text-muted-foreground">
                USD {Number(result.priceOriginal).toLocaleString("es-AR")}
                {result.exchangeRate && ` · TC BNA: $${Number(result.exchangeRate).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-0.5">
            {result.nights != null && <div>{result.nights} noches</div>}
            {result.days != null && !result.nights && <div>{result.days} días</div>}
            {result.airline && <div className="flex items-center gap-1 justify-end"><Plane className="h-3 w-3" />{result.airline}</div>}
            {result.hotelName && <div className="flex items-center gap-1 justify-end"><Building className="h-3 w-3" />{result.hotelName}</div>}
          </div>
        </div>

        {/* Dates */}
        {result.departureDate && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {fmtDate(result.departureDate)}
            {result.returnDate && <> → {fmtDate(result.returnDate)}</>}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-1 border-t border-border/50">
          {result.externalUrl ? (
            <a
              href={result.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Globe className="h-3.5 w-3.5" />
              Ver en Google Flights →
            </a>
          ) : (
            <p className="text-xs text-center text-muted-foreground py-1">Link no disponible</p>
          )}
          <div className="flex gap-2">
            {result.status !== "saved" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs flex-1" onClick={() => onStatusChange("saved")}>
                <Bookmark className="h-3 w-3" /> Guardar
              </Button>
            )}
            {result.status !== "seen" && result.status !== "saved" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs flex-1" onClick={() => onStatusChange("seen")}>
                <Eye className="h-3 w-3" /> Vista
              </Button>
            )}
            {result.status !== "dismissed" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs flex-1 text-muted-foreground" onClick={() => onStatusChange("dismissed")}>
                <XCircle className="h-3 w-3" /> Descartar
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground/50">Encontrado {fmtRelative(result.foundAt)}</p>
      </CardContent>
    </Card>
  );
}

// ── Tab Error Boundary ────────────────────────────────────────────────────────

class TabErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-6 text-center text-muted-foreground rounded-lg border border-dashed">
          <p className="text-sm">Error al cargar este panel. Intentá recargar la página.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Api Quota Panel ───────────────────────────────────────────────────────────

interface ApiQuotaEntry {
  callsUsed: number;
  callsLimit: number;
  callsRemaining: number;
  percentUsed: number;
  status: "ok" | "warning" | "exhausted";
  dailyBudgetRemaining: number;
}

type ApiQuotasResponse = Record<string, ApiQuotaEntry>;

function BnaRateCard() {
  const { data, isLoading } = useQuery<{ rate: number; fetchedAt: string; source: string }>({
    queryKey: ["bna-rate"],
    queryFn: () => apiFetch("/api/travel/bna-rate"),
    refetchInterval: 60 * 60 * 1000,
    retry: 1,
  });

  const isFallback = data?.source === "fallback";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Tipo de cambio BNA
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-8 w-40 rounded" />
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-2xl font-bold">
              USD → ARS: ${data.rate.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <div className="flex flex-col text-xs text-muted-foreground">
              <span>
                Actualizado{" "}
                {new Date(data.fetchedAt).toLocaleString("es-AR", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </span>
              <span className={isFallback ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                Fuente: {isFallback ? "Estimado (BNA no disponible)" : "BNA (Banco Nación Argentina)"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApiQuotaPanel() {
  const { data: quotas, isLoading, isError } = useQuery<ApiQuotasResponse>({
    queryKey: ["travel-api-quotas"],
    queryFn: () => apiFetch<ApiQuotasResponse>("/api/travel/api-quotas"),
    refetchInterval: 30000,
    retry: 1,
  });

  const API_INFO: Record<string, { label: string; monthlyLimit: number; color: string }> = {
    serpapi:  { label: "SerpAPI",  monthlyLimit: 100,  color: "bg-green-500"  },
    amadeus:  { label: "Amadeus",  monthlyLimit: 2000, color: "bg-blue-500"   },
  };

  if (isError) {
    return (
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4">
        <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          No se pudo cargar el estado de las APIs. Verificá que las variables de entorno SERPAPI_KEY y AMADEUS_CLIENT_ID estén configuradas.
        </p>
      </div>
    );
  }

  if (isLoading || !quotas) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />APIs de búsqueda</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-20 rounded-lg" /></CardContent>
      </Card>
    );
  }

  const now = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          APIs de búsqueda — cuotas {now.toLocaleString("es-AR", { month: "long", year: "numeric" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(API_INFO).map(([apiName, info]) => {
          const quota = quotas[apiName];
          const used = quota?.callsUsed ?? 0;
          const limit = quota?.callsLimit ?? info.monthlyLimit;
          const pct = Math.min((used / limit) * 100, 100);
          const configured = quota != null;
          return (
            <div key={apiName} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{info.label}</span>
                <span className="text-muted-foreground text-xs">
                  {used} / {limit} llamadas
                  {!configured && <span className="ml-1 text-amber-600 dark:text-amber-400">(sin configurar)</span>}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all ${info.color} ${pct >= 90 ? "!bg-red-500" : pct >= 70 ? "!bg-amber-500" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pct >= 90 && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Cuota casi agotada
                </p>
              )}
              {quota?.dailyBudgetRemaining != null && (
                <p className="text-xs text-muted-foreground">{quota.dailyBudgetRemaining} llamadas restantes hoy</p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1 border-t border-border/40">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          SERPAPI_KEY activa búsquedas reales en Google Flights. AMADEUS_CLIENT_ID/SECRET activa paquetes y vuelos alternativos.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TravelPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SearchProfile | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchTypeFilter, setSearchTypeFilter] = useState<string>("");
  const [apiSourceFilter, setApiSourceFilter] = useState<string>("");
  const [seeding, setSeeding] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery<SearchProfile[]>({
    queryKey: ["travel-profiles"],
    queryFn: () => apiFetch<SearchProfile[]>("/api/travel/search-profiles"),
  });

  const { data: results = [], isLoading: loadingResults } = useQuery<SearchResult[]>({
    queryKey: ["travel-results"],
    queryFn: () => apiFetch<SearchResult[]>("/api/travel/search-results"),
  });

  const { data: locations = [] } = useQuery<LocationItem[]>({
    queryKey: ["travel-locations-catalog"],
    queryFn: () => apiFetch<LocationItem[]>("/api/travel/locations-catalog"),
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/travel/search-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["travel-profiles"] });
      qc.invalidateQueries({ queryKey: ["travel-results"] });
      setDeleteId(null);
      toast({ title: "Búsqueda eliminada" });
    },
    onError: (err: Error) => toast({ title: "Error al eliminar", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/api/travel/search-profiles/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["travel-profiles"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean; resultsFound: number }>(`/api/travel/search-profiles/${id}/run`, { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["travel-profiles"] });
      qc.invalidateQueries({ queryKey: ["travel-results"] });
      setRunningId(null);
      toast({ title: `Búsqueda completada`, description: `${data.resultsFound} oferta${data.resultsFound !== 1 ? "s" : ""} encontrada${data.resultsFound !== 1 ? "s" : ""}` });
    },
    onError: (err: Error) => {
      setRunningId(null);
      toast({ title: "Error al ejecutar", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/travel/search-results/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["travel-results"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const handleRun = (id: string) => {
    setRunningId(id);
    runMutation.mutate(id);
  };

  const handleDuplicate = async (profile: SearchProfile) => {
    try {
      await apiFetch("/api/travel/search-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: `${profile.name} (copia)`,
          travelType: profile.travelType,
          originJson: profile.originJson,
          destinationMode: profile.destinationMode,
          destinationsJson: profile.destinationsJson,
          regionsJson: profile.regionsJson,
          maxBudget: Number(profile.maxBudget),
          currency: profile.currency,
          travelersCount: profile.travelersCount,
          travelerProfile: profile.travelerProfile,
          minDays: profile.minDays,
          maxDays: profile.maxDays,
          airlinePreferencesJson: profile.airlinePreferencesJson,
          hotelMinStars: profile.hotelMinStars,
          mealPlan: profile.mealPlan,
          directFlightOnly: profile.directFlightOnly,
          dateFlexibilityDays: profile.dateFlexibilityDays,
          refreshFrequencyHours: profile.refreshFrequencyHours,
          tolerancePercent: profile.tolerancePercent,
          notes: profile.notes,
          isActive: false,
          searchType: profile.searchType ?? "ambos",
          departureDateFrom: profile.departureDateFrom ?? null,
          departureDateTo: profile.departureDateTo ?? null,
        }),
      });
      qc.invalidateQueries({ queryKey: ["travel-profiles"] });
      toast({ title: "Búsqueda duplicada (pausada)" });
    } catch (err: unknown) {
      toast({ title: "Error al duplicar", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleSeedLocations = async () => {
    setSeeding(true);
    try {
      const result = await apiFetch<{ ok: boolean; count: number; message?: string }>("/api/travel/seed-locations", { method: "POST" });
      qc.invalidateQueries({ queryKey: ["travel-locations-catalog"] });
      toast({ title: result.message ?? `${result.count} ubicaciones cargadas` });
    } catch (err: unknown) {
      toast({ title: "Error al cargar ubicaciones", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const profileResultCounts = profiles.reduce<Record<string, number>>((acc, p) => {
    acc[p.id] = results.filter(r => r.searchProfileId === p.id && r.status !== "dismissed" && r.status !== "expired").length;
    return acc;
  }, {});

  const filteredResults = results.filter(r => {
    if (resultFilter && r.searchProfileId !== resultFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchTypeFilter && r.searchType !== searchTypeFilter) return false;
    if (apiSourceFilter && r.apiSource !== apiSourceFilter) return false;
    return true;
  });

  const profileNameMap = profiles.reduce<Record<string, string>>((acc, p) => {
    acc[p.id] = p.name;
    return acc;
  }, {});

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Viajes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Búsquedas guardadas y ofertas detectadas automáticamente.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2 shrink-0">
          <Search className="h-4 w-4" />
          Nueva búsqueda
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profiles">
        <TabsList className="mb-4">
          <TabsTrigger value="profiles" className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Mis búsquedas
            {profiles.length > 0 && (
              <span className="ml-1 text-xs bg-primary/20 text-primary rounded-full px-1.5 py-0.5">{profiles.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1.5">
            <Plane className="h-3.5 w-3.5" />
            Ofertas encontradas
            {results.filter(r => r.status === "new").length > 0 && (
              <span className="ml-1 text-xs bg-blue-500 text-white rounded-full px-1.5 py-0.5">
                {results.filter(r => r.status === "new").length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Configuración
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Mis búsquedas ─────────────────────────────────────────── */}
        <TabsContent value="profiles">
          {loadingProfiles ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
            </div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground bg-muted/10">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No tenés búsquedas guardadas todavía</p>
              <p className="text-sm mt-1">Creá una regla de monitoreo y el sistema buscará ofertas que coincidan.</p>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" />
                Nueva búsqueda
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {profiles.map(profile => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  resultsCount={profileResultCounts[profile.id] ?? 0}
                  isRunning={runningId === profile.id}
                  onEdit={() => { setEditing(profile); setDialogOpen(true); }}
                  onDelete={() => setDeleteId(profile.id)}
                  onRun={() => handleRun(profile.id)}
                  onToggle={() => toggleMutation.mutate({ id: profile.id, isActive: !profile.isActive })}
                  onDuplicate={() => handleDuplicate(profile)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: Ofertas encontradas ────────────────────────────────────── */}
        <TabsContent value="results">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={resultFilter}
                onChange={e => setResultFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Todas las búsquedas</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select
              value={searchTypeFilter}
              onChange={e => setSearchTypeFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Vuelos + Paquetes</option>
              <option value="vuelo">✈ Solo vuelos</option>
              <option value="paquete">🏨 Solo paquetes</option>
            </select>
            <select
              value={apiSourceFilter}
              onChange={e => setApiSourceFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Todas las fuentes</option>
              <option value="serpapi">SerpAPI</option>
              <option value="amadeus">Amadeus</option>
              <option value="simulado">Simulado</option>
            </select>
            {(resultFilter || statusFilter || searchTypeFilter || apiSourceFilter) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setResultFilter(""); setStatusFilter(""); setSearchTypeFilter(""); setApiSourceFilter(""); }}>
                <X className="h-3 w-3" /> Limpiar
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground self-center">
              {filteredResults.length} oferta{filteredResults.length !== 1 ? "s" : ""}
            </span>
          </div>

          {loadingResults ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground bg-muted/10">
              <Plane className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay ofertas encontradas aún</p>
              <p className="text-sm mt-1">
                {profiles.length === 0
                  ? "Primero creá una búsqueda guardada para que el sistema detecte ofertas."
                  : 'Ejecutá una búsqueda desde "Mis búsquedas" para encontrar resultados.'
                }
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredResults.map(result => (
                <ResultCard
                  key={result.id}
                  result={result}
                  profileName={profileNameMap[result.searchProfileId] ?? "—"}
                  onStatusChange={status => statusMutation.mutate({ id: result.id, status })}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: Configuración ─────────────────────────────────────────── */}
        <TabsContent value="config">
          <div className="space-y-6">
            {/* Catálogo de ubicaciones */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Catálogo de ubicaciones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground flex-1">
                    El catálogo incluye aeropuertos y ciudades para el autocomplete.
                    {locations.length > 0
                      ? ` Actualmente hay ${locations.length} ubicaciones cargadas.`
                      : " No hay ubicaciones cargadas."}
                  </p>
                  <Button variant="outline" size="sm" onClick={handleSeedLocations} disabled={seeding || locations.length > 0}>
                    {seeding ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                    {locations.length > 0 ? "Ya cargado" : "Cargar ubicaciones"}
                  </Button>
                </div>

                {locations.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <span>Ubicación</span>
                      <span>Código</span>
                      <span>País</span>
                      <span>Región</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
                      {locations.slice(0, 60).map(loc => (
                        <div key={loc.id} className="grid grid-cols-4 gap-2 px-3 py-2 text-sm hover:bg-muted/30">
                          <span className="font-medium truncate">{loc.label}</span>
                          <span className="text-muted-foreground font-mono">{loc.code ?? "—"}</span>
                          <span className="text-muted-foreground truncate">{loc.country}</span>
                          <span className="text-muted-foreground truncate">{loc.region}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* TC BNA */}
            <BnaRateCard />

            {/* API Quota Panel */}
            <TabErrorBoundary>
              <ApiQuotaPanel />
            </TabErrorBoundary>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}

      <ProfileFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        editing={editing}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["travel-profiles"] });
        }}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={v => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar búsqueda</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará la búsqueda y todos los resultados asociados. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
