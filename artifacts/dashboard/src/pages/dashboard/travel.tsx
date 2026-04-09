import { useListTravelOffers } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Plane, MapPin, Calendar, Building, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function TravelPage() {
  const { data: offers, isLoading, error } = useListTravelOffers();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar ofertas de viaje.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Viajes</h1>
        <p className="text-muted-foreground mt-1">Opciones y beneficios corporativos.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {offers?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <Plane className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No hay ofertas</h3>
            <p className="text-muted-foreground">No se encontraron opciones de viaje disponibles.</p>
          </div>
        ) : (
          offers?.map(offer => (
            <Card key={offer.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="secondary">{offer.offerType}</Badge>
                  <Badge variant="outline">{offer.provider}</Badge>
                </div>
                <CardTitle className="text-xl flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  {offer.destination}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{offer.region}</p>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <div className="text-3xl font-bold text-primary">
                  {offer.currency} ${offer.price.toLocaleString('es-AR')}
                </div>
                
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>Duración: {offer.duration} días</span>
                  </div>
                  {offer.hotel && (
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <span>{offer.hotel} {offer.hotelCategory ? `(${offer.hotelCategory}★)` : ''}</span>
                    </div>
                  )}
                  {offer.validUntil && (
                    <div className="text-xs text-muted-foreground mt-4">
                      Válido hasta: {new Date(offer.validUntil).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full">
                  <a href={offer.link} target="_blank" rel="noopener noreferrer">
                    Ver Oferta <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
