import { useGetDashboardSummary, useGetWeather } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Mail, CheckSquare, Briefcase, Plane, Newspaper, CloudSun,
  CloudRain, Sun, Cloud, ArrowRight, TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  if (icon.includes("rain")) return <CloudRain className={className} />;
  if (icon.includes("sun") || icon.includes("clear")) return <Sun className={className} />;
  if (icon.includes("cloud")) return <Cloud className={className} />;
  return <CloudSun className={className} />;
}

export default function DashboardSummary() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: weather, isLoading: weatherLoading } = useGetWeather();

  const isLoading = summaryLoading || weatherLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-1/2 mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const today = weather && Array.isArray(weather) ? weather[0] : null;
  const tomorrow = weather && Array.isArray(weather) ? weather[1] : null;

  const widgets = [
    {
      title: "Emails recientes",
      icon: Mail,
      value: summary?.emailCount24h ?? "—",
      subtitle: "Últimas 24 horas",
      href: "/dashboard/emails",
      accent: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      title: "Tareas pendientes",
      icon: CheckSquare,
      value: summary?.pendingTasks ?? "—",
      subtitle: "Requieren atención",
      href: "/dashboard/tasks",
      accent: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      title: "Monitor Fiscal",
      icon: Briefcase,
      value: summary?.fiscalUpdatesCount ?? "—",
      subtitle: `${summary?.fiscalRequireAction ?? 0} requieren acción`,
      href: "/dashboard/fiscal",
      accent: "text-red-500",
      bg: "bg-red-500/10",
    },
    {
      title: "Ofertas de viaje",
      icon: Plane,
      value: summary?.travelOffersCount ?? "—",
      subtitle: "Disponibles hoy",
      href: "/dashboard/travel",
      accent: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      title: "Noticias",
      icon: Newspaper,
      value: summary?.newsCount ?? "—",
      subtitle: "Artículos relevantes",
      href: "/dashboard/news",
      accent: "text-purple-500",
      bg: "bg-purple-500/10",
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Resumen Ejecutivo</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          Panel activo
        </div>
      </div>

      {today && (
        <Card className="card-hover border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/5 to-transparent">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <WeatherIcon icon={today.conditionIcon} className="h-10 w-10 text-amber-500" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Clima Neuquén — Hoy</p>
                  <p className="font-semibold">{today.condition}</p>
                  <div className="flex items-center gap-2 text-sm mt-0.5">
                    <span className="text-blue-500 font-medium">{today.tempMin}°</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-500 font-medium">{today.tempMax}°C</span>
                    <span className="text-muted-foreground ml-2">Lluvia: {today.rainProbability}%</span>
                  </div>
                </div>
              </div>
              {tomorrow && (
                <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide font-medium">Mañana</p>
                    <p className="text-foreground font-medium">{tomorrow.condition}</p>
                    <p className="text-xs">{tomorrow.tempMin}° / {tomorrow.tempMax}°C</p>
                  </div>
                  <WeatherIcon icon={tomorrow.conditionIcon} className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href="/dashboard/weather">
                  Ver pronóstico <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {widgets.map((widget, idx) => (
          <Card key={idx} className="card-hover group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {widget.title}
              </CardTitle>
              <div className={`h-8 w-8 rounded-lg ${widget.bg} flex items-center justify-center`}>
                <widget.icon className={`h-4 w-4 ${widget.accent}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${widget.accent} mb-0.5`}>{widget.value}</div>
              <p className="text-xs text-muted-foreground mb-4">{widget.subtitle}</p>
              <Button asChild variant="outline" size="sm" className="w-full text-xs h-7">
                <Link href={widget.href}>
                  Ver detalle <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
