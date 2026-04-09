import { useGetSettings } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings as SettingsIcon, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SettingsPage() {
  const { data: settings, isLoading, error } = useGetSettings();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full max-w-2xl" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar configuraciones.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground mt-1">Configuración personalizada de tu dashboard.</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Preferencias Generales
          </CardTitle>
          <CardDescription>Ajusta el comportamiento y apariencia de tu dashboard personal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="dashboardName">Nombre del Dashboard</Label>
            <Input id="dashboardName" defaultValue={settings?.dashboardName} />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="headerText">Texto del Encabezado</Label>
            <Input id="headerText" defaultValue={settings?.headerText} />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="weatherLocation">Ubicación del Clima</Label>
            <Input id="weatherLocation" defaultValue={settings?.weatherLocation} />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newsCount">Cantidad de Noticias</Label>
              <Input id="newsCount" type="number" defaultValue={settings?.newsCount} />
            </div>
            
            <div className="space-y-2">
              <Label>Tema</Label>
              <Select defaultValue={settings?.theme || "system"}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un tema" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Claro</SelectItem>
                  <SelectItem value="dark">Oscuro</SelectItem>
                  <SelectItem value="system">Sistema</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="pt-4 flex justify-end">
            <Button>
              <Save className="mr-2 h-4 w-4" />
              Guardar Cambios
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
