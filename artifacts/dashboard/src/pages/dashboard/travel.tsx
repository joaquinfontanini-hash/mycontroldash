import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Plane, MapPin, Calendar, Building, ExternalLink, SlidersHorizontal,
  ShieldCheck, AlertTriangle, Info, Plus, Edit2, Trash2, Users, Clock,
  Globe, DollarSign, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TravelOffer {
  id: number;
  origin?: string | null;
  destination: string;
  description?: string | null;
  price: string;
  currency: string;
  provider: string;
  offerType: string;
  travelType: string;
  duration: number;
  departureDate?: string | null;
  passengers?: number | null;
  hotel?: string | null;
  hotelCategory?: number | null;
  region: string;
  link: string;
  validUntil?: string | null;
  isValid: boolean;
  qualityScore?: number;
  qualityIssues?: string | null;
  needsReview?: boolean;
  createdAt: string;
}

interface TravelOfferForm {
  origin: string;
  destination: string;
  description: string;
  price: string;
  currency: "ARS" | "USD" | "EUR";
  provider: string;
  travelType: "nacional" | "internacional" | "corporativo";
  duration: string;
  departureDate: string;
  passengers: string;
  hotel: string;
  hotelCategory: string;
  region: string;
  link: string;
  validUntil: string;
}

const EMPTY_FORM: TravelOfferForm = {
  origin: "",
  destination: "",
  description: "",
  price: "",
  currency: "USD",
  provider: "",
  travelType: "nacional",
  duration: "",
  departureDate: "",
  passengers: "",
  hotel: "",
  hotelCategory: "",
  region: "argentina",
  link: "",
  validUntil: "",
};

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { value: "", label: "Todos" },
  { value: "nacional", label: "Nacional" },
  { value: "internacional", label: "Internacional" },
  { value: "corporativo", label: "Corporativo" },
];

const REGION_OPTIONS = [
  { value: "patagonia",     label: "Patagonia" },
  { value: "argentina",     label: "Argentina" },
  { value: "sudamerica",    label: "Sudamérica" },
  { value: "caribe",        label: "Caribe" },
  { value: "norteamerica",  label: "Norteamérica" },
  { value: "europa",        label: "Europa" },
  { value: "asia",          label: "Asia" },
  { value: "otro",          label: "Otro" },
];

const REGION_FILTERS = [
  { value: "", label: "Todas las regiones" },
  ...REGION_OPTIONS,
];

const TYPE_COLORS: Record<string, string> = {
  nacional:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  internacional:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  corporativo:    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const CURRENCY_OPTIONS = ["ARS", "USD", "EUR"] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function qualityColor(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (score >= 60) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

function parseIssues(raw?: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

function fmtPrice(price: string, currency: string) {
  const num = Number(price);
  if (isNaN(num) || num <= 0) return null;
  const locale = currency === "ARS" ? "es-AR" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(num);
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Offer Form Dialog ──────────────────────────────────────────────────────────

function OfferFormDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: TravelOffer | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<TravelOfferForm>(() =>
    editing
      ? {
          origin:       editing.origin ?? "",
          destination:  editing.destination,
          description:  editing.description ?? "",
          price:        editing.price,
          currency:     (editing.currency as "ARS" | "USD" | "EUR") ?? "USD",
          provider:     editing.provider,
          travelType:   (editing.travelType as "nacional" | "internacional" | "corporativo") ?? "nacional",
          duration:     String(editing.duration),
          departureDate: editing.departureDate ?? "",
          passengers:   editing.passengers != null ? String(editing.passengers) : "",
          hotel:        editing.hotel ?? "",
          hotelCategory: editing.hotelCategory != null ? String(editing.hotelCategory) : "",
          region:       editing.region,
          link:         editing.link === "#" ? "" : editing.link,
          validUntil:   editing.validUntil ?? "",
        }
      : { ...EMPTY_FORM }
  );
  const [formError, setFormError] = useState<string | null>(null);

  const set = (k: keyof TravelOfferForm, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async (data: TravelOfferForm) => {
      const body = {
        origin:        data.origin.trim() || null,
        destination:   data.destination.trim(),
        description:   data.description.trim() || null,
        price:         Number(data.price),
        currency:      data.currency,
        provider:      data.provider.trim(),
        offerType:     "paquete",
        travelType:    data.travelType,
        duration:      Number(data.duration),
        departureDate: data.departureDate || null,
        passengers:    data.passengers ? Number(data.passengers) : null,
        hotel:         data.hotel.trim() || null,
        hotelCategory: data.hotelCategory ? Number(data.hotelCategory) : null,
        region:        data.region,
        link:          data.link.trim() || "#",
        validUntil:    data.validUntil || null,
      };
      if (editing) {
        return apiFetch(`/api/travel/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      }
      return apiFetch("/api/travel", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast({ title: editing ? "Oferta actualizada" : "Oferta creada" });
      onSaved();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const handleSubmit = () => {
    setFormError(null);
    if (!form.destination.trim()) return setFormError("El destino es obligatorio.");
    if (!form.provider.trim()) return setFormError("El proveedor es obligatorio.");
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0)
      return setFormError("El precio debe ser mayor a 0.");
    if (!form.duration || isNaN(Number(form.duration)) || Number(form.duration) < 1)
      return setFormError("La duración debe ser al menos 1 día.");
    if (!form.region) return setFormError("La región es obligatoria.");
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar oferta de viaje" : "Nueva oferta de viaje"}</DialogTitle>
          <DialogDescription>
            {editing ? `Editando: ${editing.destination}` : "Completá los datos de la oferta. Destino, precio y proveedor son obligatorios."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {formError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {formError}
            </div>
          )}

          {/* Tipo + Región */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tipo de viaje *
              </Label>
              <select
                value={form.travelType}
                onChange={e => set("travelType", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="nacional">Nacional</option>
                <option value="internacional">Internacional</option>
                <option value="corporativo">Corporativo</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Región *
              </Label>
              <select
                value={form.region}
                onChange={e => set("region", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {REGION_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Origen + Destino */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Origen</Label>
              <Input
                value={form.origin}
                onChange={e => set("origin", e.target.value)}
                placeholder="Buenos Aires, Bariloche..."
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Destino *
              </Label>
              <Input
                value={form.destination}
                onChange={e => set("destination", e.target.value)}
                placeholder="Cancún, París, Neuquén..."
                className="h-9"
              />
            </div>
          </div>

          {/* Precio + Moneda + Duración */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Precio *
              </Label>
              <Input
                type="number"
                min="0"
                value={form.price}
                onChange={e => set("price", e.target.value)}
                placeholder="1500"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Moneda</Label>
              <select
                value={form.currency}
                onChange={e => set("currency", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Duración (días) *
              </Label>
              <Input
                type="number"
                min="1"
                value={form.duration}
                onChange={e => set("duration", e.target.value)}
                placeholder="7"
                className="h-9"
              />
            </div>
          </div>

          {/* Proveedor + Pasajeros */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Proveedor *
              </Label>
              <Input
                value={form.provider}
                onChange={e => set("provider", e.target.value)}
                placeholder="Aerolíneas Argentinas, TUI..."
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Personas
              </Label>
              <Input
                type="number"
                min="1"
                value={form.passengers}
                onChange={e => set("passengers", e.target.value)}
                placeholder="2"
                className="h-9"
              />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha de salida
              </Label>
              <Input
                type="date"
                value={form.departureDate}
                onChange={e => set("departureDate", e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Válido hasta
              </Label>
              <Input
                type="date"
                value={form.validUntil}
                onChange={e => set("validUntil", e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* Hotel */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Hotel <span className="font-normal normal-case">(opcional)</span>
              </Label>
              <Input
                value={form.hotel}
                onChange={e => set("hotel", e.target.value)}
                placeholder="Nombre del hotel"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categoría (★)
              </Label>
              <select
                value={form.hotelCategory}
                onChange={e => set("hotelCategory", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sin especificar</option>
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n} estrella{n > 1 ? "s" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Link */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Link de la oferta
            </Label>
            <Input
              type="url"
              value={form.link}
              onChange={e => set("link", e.target.value)}
              placeholder="https://..."
              className="h-9"
            />
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Descripción <span className="font-normal normal-case">(opcional)</span>
            </Label>
            <textarea
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Detalles adicionales de la oferta..."
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando..." : editing ? "Guardar cambios" : "Crear oferta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TravelPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TravelOffer | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (typeFilter)   params.set("type", typeFilter);
  if (regionFilter) params.set("region", regionFilter);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data: offers, isLoading, error } = useQuery<TravelOffer[]>({
    queryKey: ["travel-offers", typeFilter, regionFilter],
    queryFn: () => apiFetch<TravelOffer[]>(`/api/travel${qs}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/travel/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["travel-offers"] });
      setConfirmDeleteId(null);
      toast({ title: "Oferta eliminada" });
    },
    onError: (err: Error) => toast({ title: "Error al eliminar", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (offer: TravelOffer) => {
    setEditing(offer);
    setDialogOpen(true);
  };

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ["travel-offers"] });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        Error al cargar ofertas de viaje. Intentá recargar la página.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Viajes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Ofertas corporativas y de beneficios. {offers?.length ?? 0} disponibles.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Agregar oferta
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Tipo:
          </span>
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border whitespace-nowrap
                ${typeFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                }`}
            >
              {f.label}
            </button>
          ))}
          {typeFilter && (
            <button onClick={() => setTypeFilter("")} className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1">
              limpiar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
            <Globe className="h-3.5 w-3.5" /> Región:
          </span>
          {REGION_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setRegionFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border whitespace-nowrap
                ${regionFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                }`}
            >
              {f.label}
            </button>
          ))}
          {regionFilter && (
            <button onClick={() => setRegionFilter("")} className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1">
              limpiar
            </button>
          )}
        </div>

        {(typeFilter || regionFilter) && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground">Filtrando:</span>
            {typeFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
                {TYPE_FILTERS.find(f => f.value === typeFilter)?.label}
                <button onClick={() => setTypeFilter("")}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {regionFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
                {REGION_FILTERS.find(f => f.value === regionFilter)?.label}
                <button onClick={() => setRegionFilter("")}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            <button
              onClick={() => { setTypeFilter(""); setRegionFilter(""); }}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              limpiar todo
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {offers?.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Plane className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold mb-1">
            {typeFilter || regionFilter ? "Sin resultados" : "Sin ofertas de viaje"}
          </h3>
          <p className="text-muted-foreground text-sm max-w-sm">
            {typeFilter || regionFilter
              ? "No hay ofertas que coincidan con los filtros. Probá cambiando la selección."
              : "Todavía no hay ofertas cargadas. Agregá la primera usando el botón de arriba."}
          </p>
          {(typeFilter || regionFilter) ? (
            <Button variant="outline" className="mt-4" onClick={() => { setTypeFilter(""); setRegionFilter(""); }}>
              Limpiar filtros
            </Button>
          ) : (
            <Button className="mt-4 gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Agregar primera oferta
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers?.map(offer => {
            const score = offer.qualityScore ?? 70;
            const issues = parseIssues(offer.qualityIssues);
            const priceFormatted = fmtPrice(offer.price, offer.currency);
            const isExpired = offer.validUntil ? new Date(offer.validUntil) < new Date() : false;

            return (
              <Card
                key={offer.id}
                className={`flex flex-col border-border/60 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20 transition-all duration-200
                  ${offer.needsReview ? "border-amber-300 dark:border-amber-700" : "hover:border-primary/40"}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${TYPE_COLORS[offer.travelType] ?? "bg-muted text-muted-foreground"}`}>
                      {offer.travelType.charAt(0).toUpperCase() + offer.travelType.slice(1)}
                    </span>
                    <div className="flex items-center gap-1">
                      {offer.needsReview && (
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                          <AlertTriangle className="h-2.5 w-2.5" /> Revisar
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(offer)}
                        title="Editar"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDeleteId(offer.id)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <CardTitle className="text-xl flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary shrink-0" />
                    <span className="leading-tight">{offer.destination}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {offer.origin && (
                      <span className="text-xs text-muted-foreground">desde {offer.origin}</span>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal capitalize">
                      {offer.region}
                    </Badge>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${qualityColor(score)}`}>
                      <ShieldCheck className="h-2.5 w-2.5" /> {score}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 space-y-3">
                  {/* Price */}
                  <div className={`rounded-lg p-3 text-center ${!priceFormatted ? "bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800" : "bg-primary/5 border border-primary/10"}`}>
                    {!priceFormatted ? (
                      <p className="text-sm text-red-600 dark:text-red-400 font-medium flex items-center justify-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Precio no disponible
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-0.5">Precio desde</p>
                        <p className="text-2xl font-bold text-primary">{priceFormatted}</p>
                      </>
                    )}
                  </div>

                  {/* Details */}
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>{offer.duration} días</span>
                      {offer.passengers && (
                        <>
                          <span className="text-border">·</span>
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          <span>{offer.passengers} persona{offer.passengers > 1 ? "s" : ""}</span>
                        </>
                      )}
                    </div>
                    {offer.departureDate && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span>Salida: {fmtDate(offer.departureDate)}</span>
                      </div>
                    )}
                    {offer.hotel && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {offer.hotel}
                          {offer.hotelCategory ? ` · ${offer.hotelCategory}★` : ""}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs">{offer.provider}</span>
                    </div>
                  </div>

                  {offer.description && (
                    <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-relaxed line-clamp-2">
                      {offer.description}
                    </p>
                  )}

                  {offer.validUntil && (
                    <p className={`text-xs border-t pt-2 ${isExpired ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                      {isExpired ? "⚠ Oferta vencida: " : "Válido hasta: "}
                      <span className={isExpired ? "line-through" : ""}>{fmtDate(offer.validUntil)}</span>
                    </p>
                  )}

                  {issues.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-t pt-2">
                      {issues.map((issue, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/80 text-muted-foreground flex items-center gap-0.5">
                          <Info className="h-2.5 w-2.5 shrink-0" /> {issue}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-0">
                  {offer.link && offer.link !== "#" ? (
                    <Button asChild className="w-full" variant="outline" size="sm">
                      <a href={offer.link} target="_blank" rel="noopener noreferrer">
                        Ver oferta completa <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full text-muted-foreground" disabled>
                      Sin link externo
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit dialog */}
      {dialogOpen && (
        <OfferFormDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditing(null); }}
          editing={editing}
          onSaved={onSaved}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={v => { if (!v) setConfirmDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar oferta?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
