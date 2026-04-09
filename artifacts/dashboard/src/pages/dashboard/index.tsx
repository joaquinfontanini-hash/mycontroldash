import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, CheckSquare, Briefcase, Plane, Newspaper } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function DashboardSummary() {
  const { data: summary, isLoading, error } = useGetDashboardSummary();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-1/2 mb-2" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !summary) {
    return <div className="text-destructive">Error al cargar el resumen.</div>;
  }

  const widgets = [
    {
      title: "Emails 24h",
      icon: Mail,
      value: summary.emailCount24h,
      subtitle: "Mensajes recientes",
      href: "/dashboard/emails"
    },
    {
      title: "Tareas Pendientes",
      icon: CheckSquare,
      value: summary.pendingTasks,
      subtitle: "Requieren atención",
      href: "/dashboard/tasks"
    },
    {
      title: "Monitor Fiscal",
      icon: Briefcase,
      value: summary.fiscalUpdatesCount,
      subtitle: `${summary.fiscalRequireAction} requieren acción`,
      href: "/dashboard/fiscal"
    },
    {
      title: "Ofertas de Viaje",
      icon: Plane,
      value: summary.travelOffersCount,
      subtitle: "Opciones disponibles",
      href: "/dashboard/travel"
    },
    {
      title: "Noticias",
      icon: Newspaper,
      value: summary.newsCount,
      subtitle: "Artículos relevantes",
      href: "/dashboard/news"
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Resumen Ejecutivo</h1>
        <p className="text-muted-foreground mt-1">Tu vista rápida del día.</p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {widgets.map((widget, idx) => (
          <Card key={idx} className="hover-elevate transition-all">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
              <widget.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{widget.value}</div>
              <p className="text-xs text-muted-foreground mb-4">{widget.subtitle}</p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href={widget.href}>Ver detalle</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
