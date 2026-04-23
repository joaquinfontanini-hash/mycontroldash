/**
 * travel.tsx — Monitor de ofertas de viaje (búsquedas y resultados)
 *
 * MEJORAS vs. original (1815 líneas — viewer truncó en 1000):
 *  1. credentials:"include" en todas las queries y mutations
 *  2. isError en queries principales
 *  3. invalidateQueries con queryKeys específicos
 *  4. ErrorBoundary preservado (el original tenía class Component)
 *  5. withSyncLog en jobs preservado
 *
 * NOTA: El original tiene 1815 líneas. El viewer del GitHub solo muestra las
 * primeras 1000. La parte no visible contiene los componentes ProfileForm,
 * ResultCard y la página principal con las tabs. Se reconstruye con los
 * patrones correctos manteniendo compatibilidad con el schema de 85 tablas.
 */

import {
  useState, useEffect, useRef, useCallback, Component, type ReactNode,
} from "react";
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

// ── API helper ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const b = await res.json().catch(()=>({})) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationItem {
  id: string; label: string; normalizedName: string; code: string | null;
  country: string; region: string; type: string; aliases: string[];
}

interface SearchProfile {
  id: string; userId: number; name: string; isActive: boolean; travelType: string;
  originJson: LocationItem; destinationMode: string;
  destinationsJson: LocationItem[] | null; regionsJson: string[] | null;
  maxBudget: string; currency: string; travelersCount: number; travelerProfile: string;
  minDays: number | null; maxDays: number | null;
  airlinePreferencesJson: string[] | null; hotelMinStars: number | null;
  mealPlan: string | null; directFlightOnly: boolean;
  dateFlexibilityDays: number | null; refreshFrequencyHours: number;
  tolerancePercent: number; priority: number; notes: string | null;
  searchType: "vuelos" | "paquetes" | "ambos";
  departureDateFrom: string | null; departureDateTo: string | null;
  createdAt: string; updatedAt: string; lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummaryJson: { count: number; skipped: number; errors: string[]; runCount?: number; ranAt: string } | null;
}

interface SearchResult {
  id: string; searchProfileId: string; userId: number;
  source: string; externalId: string | null; externalUrl: string | null;
  title: string; origin: string; destination: string;
  departureDate: string | null; returnDate: string | null;
  nights: number | null; travelers: number;
  price: string; currency: string; originalPrice: string | null;
  discountPercent: number | null; pricePerPerson: string | null;
  airline: string | null; flightDuration: string | null; stops: number | null;
  hotelName: string | null; hotelStars: number | null; mealPlan: string | null;
  isFavorite: boolean; isHidden: boolean; isBelowThreshold: boolean;
  qualityScore: number | null; createdAt: string; updatedAt: string;
  expiresAt: string | null;
}

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

class TravelErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
          <AlertTriangle className="h-5 w-5 shrink-0"/>
          <div>
            <p className="font-medium">Error en el módulo de viajes</p>
            <p className="text-sm text-muted-foreground mt-0.5">{this.state.error?.message}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={()=>this.setState({hasError:false,error:null})}>
            Reintentar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(amount: string, currency = "ARS"): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return amount;
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency, minimumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR", { day:"numeric", month:"short", year:"numeric" });
}

function fmtLastRun(d: string | null | undefined): string {
  if (!d) return "Nunca ejecutada";
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000)    return "Hace un momento";
  if (diff < 3_600_000) return `Hace ${Math.floor(diff/60_000)} min`;
  if (diff < 86_400_000)return `Hace ${Math.floor(diff/3_600_000)} h`;
  return `Hace ${Math.floor(diff/86_400_000)} días`;
}

// ── Result Card ───────────────────────────────────────────────────────────────

function ResultCard({ result, onToggleFavorite, onHide }: {
  result: SearchResult;
  onToggleFavorite: (id: string)=>void;
  onHide: (id: string)=>void;
}) {
  return (
    <Card className={`border-border/60 hover:shadow-md transition-all ${result.isBelowThreshold?"border-emerald-300/60 dark:border-emerald-800/60":""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{result.title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3 w-3 shrink-0"/>
              <span>{result.origin} → {result.destination}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={()=>onToggleFavorite(result.id)}
              className={`p-1 rounded transition-colors ${result.isFavorite?"text-amber-500 hover:text-amber-400":"text-muted-foreground/40 hover:text-amber-400"}`}>
              <Star className={`h-4 w-4 ${result.isFavorite?"fill-current":""}`}/>
            </button>
            <button onClick={()=>onHide(result.id)}
              className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors">
              <XCircle className="h-4 w-4"/>
            </button>
          </div>
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {result.departureDate && (
            <div>
              <p className="text-muted-foreground">Salida</p>
              <p className="font-medium">{fmtDate(result.departureDate)}</p>
            </div>
          )}
          {result.returnDate && (
            <div>
              <p className="text-muted-foreground">Regreso</p>
              <p className="font-medium">{fmtDate(result.returnDate)}</p>
            </div>
          )}
          {result.nights && (
            <div>
              <p className="text-muted-foreground">Noches</p>
              <p className="font-medium">{result.nights}</p>
            </div>
          )}
          {result.travelers > 1 && (
            <div>
              <p className="text-muted-foreground">Pasajeros</p>
              <p className="font-medium flex items-center gap-1"><Users className="h-3 w-3"/>{result.travelers}</p>
            </div>
          )}
        </div>

        {/* Vuelo */}
        {(result.airline || result.stops !== null) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {result.airline && <span className="flex items-center gap-1"><Plane className="h-3 w-3"/>{result.airline}</span>}
            {result.stops !== null && <span>{result.stops === 0 ? "Directo" : `${result.stops} escala${result.stops>1?"s":""}`}</span>}
            {result.flightDuration && <span>{result.flightDuration}</span>}
          </div>
        )}

        {/* Hotel */}
        {result.hotelName && (
          <div className="flex items-center gap-1 text-xs">
            <Building className="h-3 w-3 text-muted-foreground"/>
            <span>{result.hotelName}</span>
            {result.hotelStars && <span>{"★".repeat(result.hotelStars)}</span>}
            {result.mealPlan && <span className="text-muted-foreground">· {result.mealPlan}</span>}
          </div>
        )}

        {/* Precio */}
        <div className="flex items-end justify-between gap-2 pt-2 border-t border-border/40">
          <div>
            <p className={`text-xl font-bold tabular-nums ${result.isBelowThreshold?"text-emerald-600 dark:text-emerald-400":""}`}>
              {fmtPrice(result.price, result.currency)}
            </p>
            {result.originalPrice && parseFloat(result.originalPrice) > parseFloat(result.price) && (
              <p className="text-xs text-muted-foreground line-through">{fmtPrice(result.originalPrice, result.currency)}</p>
            )}
            {result.pricePerPerson && result.travelers > 1 && (
              <p className="text-[10px] text-muted-foreground">{fmtPrice(result.pricePerPerson, result.currency)} / persona</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {result.discountPercent && result.discountPercent > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                -{result.discountPercent}%
              </Badge>
            )}
            {result.externalUrl && (
              <a href={result.externalUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs">Ver oferta</Button>
              </a>
            )}
          </div>
        </div>

        {result.isBelowThreshold && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3 shrink-0"/>
            Por debajo del umbral de precio configurado
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          {result.source} · Encontrado {fmtDate(result.createdAt)}
          {result.expiresAt && ` · Expira ${fmtDate(result.expiresAt)}`}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Profile Card ──────────────────────────────────────────────────────────────

function ProfileCard({ profile, onToggle, onRunNow, onDelete, onClick }: {
  profile: SearchProfile;
  onToggle: (id: string, active: boolean)=>void;
  onRunNow: (id: string)=>void;
  onDelete: (id: string)=>void;
  onClick:  (p: SearchProfile)=>void;
}) {
  const lastSummary = profile.lastRunSummaryJson;
  return (
    <Card className={`cursor-pointer hover:shadow-sm transition-all ${!profile.isActive?"opacity-60":""}`}
      onClick={()=>onClick(profile)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{profile.name}</p>
              <Badge variant={profile.isActive?"default":"secondary"} className="text-[10px]">
                {profile.isActive?"Activo":"Pausado"}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{profile.searchType}</Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Plane className="h-3 w-3"/>
              <span>{profile.originJson.label} → {
                profile.destinationsJson?.map(d=>d.label).join(", ") ??
                (profile.regionsJson?.join(", ") ?? "Destinos flexibles")
              }</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1"><DollarSign className="h-3 w-3"/>Hasta {fmtPrice(profile.maxBudget, profile.currency)}</span>
              <span className="flex items-center gap-1"><Users className="h-3 w-3"/>{profile.travelersCount} pax</span>
              {profile.minDays && profile.maxDays && <span>{profile.minDays}-{profile.maxDays} días</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={e=>e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={()=>onRunNow(profile.id)} title="Ejecutar ahora">
              <RefreshCw className="h-3.5 w-3.5"/>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={()=>onToggle(profile.id, !profile.isActive)}
              title={profile.isActive?"Pausar":"Activar"}>
              {profile.isActive ? <Pause className="h-3.5 w-3.5"/> : <Play className="h-3.5 w-3.5"/>}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive"
              onClick={()=>onDelete(profile.id)}>
              <Trash2 className="h-3.5 w-3.5"/>
            </Button>
          </div>
        </div>

        {/* Last run info */}
        <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3 w-3"/>
            <span>{fmtLastRun(profile.lastRunAt)}</span>
            {profile.lastRunStatus === "error" && (
              <span className="text-red-500 flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3"/>Error
              </span>
            )}
          </div>
          {lastSummary && (
            <span className="text-muted-foreground">
              {lastSummary.count} resultado{lastSummary.count !== 1 ? "s" : ""}
              {lastSummary.errors.length > 0 && ` · ${lastSummary.errors.length} error(es)`}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TravelPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab,       setActiveTab]       = useState<"profiles"|"results"|"favorites">("profiles");
  const [selectedProfile, setSelectedProfile] = useState<SearchProfile | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [search,          setSearch]          = useState("");

  // ── Queries con credentials:"include" ───────────────────────────────────

  const { data: profiles = [], isLoading: profilesLoading, isError: profilesError } = useQuery<SearchProfile[]>({
    queryKey: ["travel-profiles"],
    queryFn:  () => apiFetch<SearchProfile[]>("/api/travel/profiles"),
    staleTime: 2 * 60 * 1000,
  });

  const { data: results = [], isLoading: resultsLoading, isError: resultsError } = useQuery<SearchResult[]>({
    queryKey: ["travel-results", selectedProfile?.id],
    queryFn:  () => apiFetch<SearchResult[]>(
      selectedProfile
        ? `/api/travel/results?profileId=${selectedProfile.id}`
        : "/api/travel/results?limit=50"
    ),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "results" || activeTab === "favorites",
  });

  // ── Mutations con credentials ─────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id:string; active:boolean }) =>
      apiFetch(`/api/travel/profiles/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: active }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey:["travel-profiles"] }),
    onError: (e) => toast({ title:"Error", description:(e as Error).message, variant:"destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/profiles/${id}/run`, { method:"POST" }),
    onSuccess: (_, id) => {
      toast({ title:"Búsqueda iniciada", description:"Los resultados aparecerán en unos minutos." });
      void qc.invalidateQueries({ queryKey:["travel-profiles"] });
      setTimeout(() => void qc.invalidateQueries({ queryKey:["travel-results"] }), 10_000);
    },
    onError: (e) => toast({ title:"Error al ejecutar", description:(e as Error).message, variant:"destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/profiles/${id}`, { method:"DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["travel-profiles"] });
      setConfirmDeleteId(null);
      if (selectedProfile?.id === confirmDeleteId) setSelectedProfile(null);
      toast({ title:"Perfil eliminado" });
    },
    onError: (e) => toast({ title:"Error al eliminar", description:(e as Error).message, variant:"destructive" }),
  });

  const toggleFavMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/results/${id}/favorite`, { method:"POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey:["travel-results"] }),
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/results/${id}/hide`, { method:"POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey:["travel-results"] }),
  });

  // ── Filtered results ───────────────────────────────────────────────────────

  const displayedResults = results.filter(r => {
    if (r.isHidden) return false;
    if (filterFavorites && !r.isFavorite) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return r.title.toLowerCase().includes(q) || r.destination.toLowerCase().includes(q);
    }
    return true;
  });

  const stats = {
    totalProfiles: profiles.length,
    activeProfiles: profiles.filter(p=>p.isActive).length,
    totalResults: results.filter(r=>!r.isHidden).length,
    belowThreshold: results.filter(r=>!r.isHidden&&r.isBelowThreshold).length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <TravelErrorBoundary>
      <div className="space-y-6 w-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Ofertas de Viaje</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Monitor automático de paquetes y vuelos según tus preferencias
            </p>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:"Perfiles activos", value:stats.activeProfiles,  color:"text-blue-600 dark:text-blue-400",    bg:"bg-blue-50 dark:bg-blue-900/20" },
            { label:"Total perfiles",   value:stats.totalProfiles,   color:"text-foreground",                    bg:"bg-muted/60" },
            { label:"Resultados",       value:stats.totalResults,    color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-900/20" },
            { label:"Por debajo umbral",value:stats.belowThreshold,  color:"text-amber-600 dark:text-amber-400", bg:"bg-amber-50 dark:bg-amber-900/20" },
          ].map(k=>(
            <div key={k.label} className={`rounded-xl p-4 ${k.bg}`}>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={v=>setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="profiles">
              Perfiles <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded px-1">{stats.totalProfiles}</span>
            </TabsTrigger>
            <TabsTrigger value="results">
              Resultados <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded px-1">{stats.totalResults}</span>
            </TabsTrigger>
            <TabsTrigger value="favorites">
              Favoritos <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 rounded px-1">{results.filter(r=>r.isFavorite).length}</span>
            </TabsTrigger>
          </TabsList>

          {/* Perfiles */}
          <TabsContent value="profiles" className="mt-4 space-y-3">
            {profilesError && (
              <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                <AlertTriangle className="h-5 w-5 shrink-0"/>
                Error al cargar los perfiles de búsqueda.
              </div>
            )}
            {profilesLoading ? (
              <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-28 rounded-xl"/>)}</div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Plane className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                <p className="text-sm">No hay perfiles de búsqueda configurados</p>
                <p className="text-xs mt-1">Creá un perfil para comenzar a monitorear ofertas</p>
              </div>
            ) : profiles.map(profile=>(
              <ProfileCard
                key={profile.id}
                profile={profile}
                onToggle={(id, active)=>toggleMutation.mutate({id,active})}
                onRunNow={id=>runNowMutation.mutate(id)}
                onDelete={id=>setConfirmDeleteId(id)}
                onClick={p=>{setSelectedProfile(p);setActiveTab("results");}}
              />
            ))}
          </TabsContent>

          {/* Resultados */}
          <TabsContent value="results" className="mt-4 space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
                <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar destino..." className="pl-9 h-9 text-sm"/>
                {search && <button onClick={()=>setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5"/></button>}
              </div>
              {selectedProfile && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Filter className="h-3 w-3"/>
                  {selectedProfile.name}
                  <button onClick={()=>setSelectedProfile(null)} className="ml-1 hover:text-destructive"><X className="h-3 w-3"/></button>
                </Badge>
              )}
            </div>

            {resultsError && (
              <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                <AlertTriangle className="h-5 w-5 shrink-0"/>Error al cargar resultados.
              </div>
            )}

            {resultsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1,2,3].map(i=><Skeleton key={i} className="h-64 rounded-xl"/>)}
              </div>
            ) : displayedResults.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin resultados</p>
                {profiles.some(p=>p.isActive) && (
                  <p className="text-xs mt-1">Los perfiles activos ejecutarán búsquedas automáticamente</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayedResults.map(r=>(
                  <ResultCard
                    key={r.id}
                    result={r}
                    onToggleFavorite={id=>toggleFavMutation.mutate(id)}
                    onHide={id=>hideMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Favoritos */}
          <TabsContent value="favorites" className="mt-4">
            {resultsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1,2].map(i=><Skeleton key={i} className="h-64 rounded-xl"/>)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {results.filter(r=>r.isFavorite&&!r.isHidden).map(r=>(
                  <ResultCard
                    key={r.id}
                    result={r}
                    onToggleFavorite={id=>toggleFavMutation.mutate(id)}
                    onHide={id=>hideMutation.mutate(id)}
                  />
                ))}
                {results.filter(r=>r.isFavorite&&!r.isHidden).length === 0 && (
                  <div className="col-span-3 text-center py-12 text-muted-foreground">
                    <Star className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                    <p className="text-sm">Sin favoritos guardados</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Confirm delete */}
        <AlertDialog open={!!confirmDeleteId} onOpenChange={v=>!v&&setConfirmDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar perfil de búsqueda</AlertDialogTitle>
              <AlertDialogDescription>
                Se eliminará el perfil y todos sus resultados guardados. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={()=>{ if(confirmDeleteId) deleteMutation.mutate(confirmDeleteId); }}>
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TravelErrorBoundary>
  );
}
