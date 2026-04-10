import { useState } from "react";
import { useListTravelOffers } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Plane, MapPin, Calendar, Building, ExternalLink, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TYPE_FILTERS = [
  { value: "", label: "Todos" },
  { value: "nacional", label: "Nacional" },
  { value: "internacional", label: "Internacional" },
  { value: "corporativo", label: "Corporativo" },
];

const REGION_FILTERS = [
  { value: "", label: "Todas las regiones" },
  { value: "patagonia", label: "Patagonia" },
  { value: "argentina", label: "Argentina" },
  { value: "sudamerica", label: "Sudamérica" },
  { value: "caribe", label: "Caribe" },
  { value: "norteamerica", label: "Norteamérica" },
  { value: "europa", label: "Europa" },
];

const TYPE_COLORS: Record<string, string> = {
  "nacional": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "internacional": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "corporativo": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function TravelPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");

  const { data: offers, isLoading, error } = useListTravelOffers({
    type: typeFilter || undefined,
    region: regionFilter || undefined,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
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
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar ofertas de viaje.</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Viajes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Opciones corporativas y beneficios de viaje. {offers?.length ?? 0} disponibles.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Tipo:
          </span>
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all border
                ${typeFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted"
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Región:
          </span>
          {REGION_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setRegionFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all border
                ${regionFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted"
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {offers?.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Plane className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin ofertas</h3>
          <p className="text-muted-foreground text-sm">No hay resultados para los filtros aplicados.</p>
          <Button variant="outline" className="mt-4" onClick={() => { setTypeFilter(""); setRegionFilter(""); }}>
            Limpiar filtros
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers?.map(offer => (
            <Card key={offer.id} className="flex flex-col card-hover hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start mb-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${TYPE_COLORS[offer.travelType ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                    {offer.travelType ?? offer.offerType}
                  </span>
                  <span className="text-xs text-muted-foreground">{offer.provider}</span>
                </div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary shrink-0" />
                  <span className="leading-tight">{offer.destination}</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{offer.region}</p>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Precio desde</p>
                  <p className="text-2xl font-bold text-primary">
                    {offer.currency} {Number(offer.price).toLocaleString("es-AR")}
                  </p>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span>{offer.duration} días de duración</span>
                  </div>
                  {offer.hotel && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Building className="h-4 w-4 shrink-0" />
                      <span className="truncate">{offer.hotel} {offer.hotelCategory ? `· ${offer.hotelCategory}★` : ""}</span>
                    </div>
                  )}
                </div>

                {offer.validUntil && (
                  <p className="text-xs text-muted-foreground border-t pt-3">
                    Válido hasta: {new Date(offer.validUntil).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </CardContent>

              <CardFooter className="pt-0">
                <Button asChild className="w-full" variant="outline">
                  <a href={offer.link} target="_blank" rel="noopener noreferrer">
                    Ver oferta completa <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
