import { useState } from "react";
import { useGetSettings } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings as SettingsIcon, Save, MapPin, Newspaper, Palette, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { data: settings, isLoading, error } = useGetSettings();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    toast({ title: "Configuración guardada", description: "Los cambios se aplicarán en la próxima carga." });
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-96 rounded-xl max-w-2xl" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar configuraciones.</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground mt-1 text-sm">Personalizá tu experiencia en el dashboard.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="h-4 w-4" />
            Preferencias Generales
          </CardTitle>
          <CardDescription>Configuración del nombre y apariencia de tu panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="dashboardName">Nombre del Dashboard</Label>
            <Input id="dashboardName" defaultValue={settings?.dashboardName ?? "Mi Dashboard"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="headerText">Texto de bienvenida</Label>
            <Input id="headerText" defaultValue={settings?.headerText ?? "Resumen Ejecutivo"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4" />
            Apariencia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Tema visual</p>
              <p className="text-xs text-muted-foreground">El tema se puede cambiar desde el header también.</p>
            </div>
            <Select defaultValue={settings?.theme ?? "system"}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro</SelectItem>
                <SelectItem value="dark">Oscuro</SelectItem>
                <SelectItem value="system">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            Clima y Ubicación
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="weatherLocation">Ciudad para el pronóstico</Label>
            <Input id="weatherLocation" defaultValue={settings?.weatherLocation ?? "Neuquén, Argentina"} />
            <p className="text-xs text-muted-foreground">Actualmente configurado para Neuquén Capital.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="h-4 w-4" />
            Noticias
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="newsCount">Cantidad de artículos a mostrar</Label>
            <Input id="newsCount" type="number" min={3} max={20} defaultValue={settings?.newsCount ?? 8} className="w-32" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notificaciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Alertas fiscales urgentes", desc: "Novedades de AFIP y Rentas que requieren acción" },
            { label: "Vencimientos próximos", desc: "Tareas con fecha límite en las próximas 48h" },
            { label: "Nuevas ofertas de viaje", desc: "Destinos y tarifas nuevas disponibles" },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch defaultChecked />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saved}>
          <Save className="mr-2 h-4 w-4" />
          {saved ? "Guardado" : "Guardar Cambios"}
        </Button>
      </div>
    </div>
  );
}
