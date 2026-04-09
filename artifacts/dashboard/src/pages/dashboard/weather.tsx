import { useGetWeather } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CloudSun, CloudRain, Sun, Cloud, Wind, Droplets } from "lucide-react";

export default function WeatherPage() {
  const { data: weather, isLoading, error } = useGetWeather();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar clima.</div>;
  }

  // Simplified icon mapping
  const getIcon = (iconStr: string) => {
    if (iconStr.includes("rain")) return <CloudRain className="h-12 w-12 text-blue-500" />;
    if (iconStr.includes("sun") || iconStr.includes("clear")) return <Sun className="h-12 w-12 text-yellow-500" />;
    if (iconStr.includes("cloud")) return <Cloud className="h-12 w-12 text-gray-500" />;
    return <CloudSun className="h-12 w-12 text-gray-500" />;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Clima</h1>
        <p className="text-muted-foreground mt-1">Pronóstico extendido para Neuquén.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {weather && Array.isArray(weather) && weather.length > 0 ? (
          weather.map((day, idx) => (
            <Card key={idx} className={idx === 0 ? "border-primary shadow-md" : ""}>
              <CardHeader className="text-center pb-2">
                <CardTitle>{day.dayName}</CardTitle>
                <p className="text-sm text-muted-foreground">{new Date(day.date).toLocaleDateString()}</p>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                <div className="my-4">{getIcon(day.conditionIcon)}</div>
                <div className="text-xl font-medium mb-1">{day.condition}</div>
                <div className="flex gap-4 text-lg font-bold my-4">
                  <span className="text-blue-500">{day.tempMin}°</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-red-500">{day.tempMax}°</span>
                </div>
                <div className="w-full space-y-2 text-sm text-muted-foreground mt-2 border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1"><Droplets className="h-4 w-4" /> Lluvia</span>
                    <span>{day.rainProbability}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1"><Wind className="h-4 w-4" /> Viento</span>
                    <span>{day.windSpeed} km/h {day.windDirection}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <CloudSun className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Datos no disponibles</h3>
            <p className="text-muted-foreground">No se pudo cargar el pronóstico del clima.</p>
          </div>
        )}
      </div>
    </div>
  );
}
