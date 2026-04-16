import { useState } from "react";
import { useGetWeather } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudSun, CloudRain, Sun, Cloud, Wind, Droplets, Thermometer, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWeatherQueryKey } from "@workspace/api-client-react";

import { BASE } from "@/lib/base-url";

function WeatherIcon({ icon, size = "lg" }: { icon: string; size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-16 w-16" : "h-8 w-8";
  if (icon.includes("rain")) return <CloudRain className={`${cls} text-blue-400`} />;
  if (icon.includes("sun") || icon.includes("clear")) return <Sun className={`${cls} text-amber-400`} />;
  if (icon.includes("cloud")) return <Cloud className={`${cls} text-slate-400`} />;
  return <CloudSun className={`${cls} text-slate-400`} />;
}

function WindDirection({ deg }: { deg: string }) {
  const arrows: Record<string, string> = {
    N: "↑", NE: "↗", E: "→", SE: "↘", S: "↓", SO: "↙", O: "←", NO: "↖",
  };
  return <span>{arrows[deg] ?? deg} {deg}</span>;
}

export default function WeatherPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: weather, isLoading, error } = useGetWeather();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${BASE}/api/weather/refresh`, { method: "POST" });
      if (res.ok) {
        setLastRefreshed(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
        queryClient.invalidateQueries({ queryKey: getGetWeatherQueryKey() });
      }
    } catch {}
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        Error al cargar clima.
      </div>
    );
  }

  const days = Array.isArray(weather) ? weather : [];

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl max-w-xl">
        <CloudSun className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-1">Datos no disponibles</h3>
        <p className="text-muted-foreground text-sm mb-4">No se pudo cargar el pronóstico.</p>
        <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar ahora
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Clima</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pronóstico extendido para <strong>Neuquén Capital</strong>.
            {lastRefreshed && (
              <span className="ml-1 text-green-600 dark:text-green-400">Actualizado a las {lastRefreshed}.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
      </div>

      {days[0] && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <WeatherIcon icon={days[0].conditionIcon} size="lg" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Hoy</p>
                <p className="text-4xl font-bold text-foreground mb-1">
                  {days[0].tempMax}°<span className="text-muted-foreground text-2xl">C</span>
                </p>
                <p className="text-lg font-medium mb-3">{days[0].condition}</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="flex flex-col items-center p-2 rounded-lg bg-muted/60">
                    <Thermometer className="h-4 w-4 text-muted-foreground mb-1" />
                    <span className="font-semibold">{days[0].tempMin}° / {days[0].tempMax}°</span>
                    <span className="text-xs text-muted-foreground">Mín / Máx</span>
                  </div>
                  <div className="flex flex-col items-center p-2 rounded-lg bg-muted/60">
                    <Droplets className="h-4 w-4 text-blue-500 mb-1" />
                    <span className="font-semibold">{days[0].rainProbability}%</span>
                    <span className="text-xs text-muted-foreground">Lluvia</span>
                  </div>
                  <div className="flex flex-col items-center p-2 rounded-lg bg-muted/60">
                    <Wind className="h-4 w-4 text-muted-foreground mb-1" />
                    <span className="font-semibold">{days[0].windSpeed} km/h</span>
                    <span className="text-xs text-muted-foreground">
                      <WindDirection deg={days[0].windDirection} />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {days.slice(1).map((day, idx) => (
          <Card key={idx} className="card-hover">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{day.dayName}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {new Date(day.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                </div>
                <WeatherIcon icon={day.conditionIcon} size="sm" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-medium mb-4">{day.condition}</p>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Thermometer className="h-4 w-4" /> Temperatura</span>
                  <span className="font-medium text-foreground">{day.tempMin}° / {day.tempMax}°C</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Droplets className="h-4 w-4 text-blue-500" /> Lluvia</span>
                  <span className="font-medium text-foreground">{day.rainProbability}%</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Wind className="h-4 w-4" /> Viento</span>
                  <span className="font-medium text-foreground">
                    {day.windSpeed} km/h <WindDirection deg={day.windDirection} />
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
