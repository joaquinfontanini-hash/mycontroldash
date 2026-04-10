import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings as SettingsIcon, Save, MapPin, Newspaper, Palette, Bell, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";

interface FormState {
  dashboardName: string;
  headerText: string;
  theme: string;
  weatherLocation: string;
  newsCount: number;
}

interface FormErrors {
  dashboardName?: string;
  newsCount?: string;
}

export default function SettingsPage() {
  const { data: settings, isLoading, error } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const { setTheme } = useTheme();

  const [form, setForm] = useState<FormState>({
    dashboardName: "",
    headerText: "",
    theme: "system",
    weatherLocation: "",
    newsCount: 8,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [notifications, setNotifications] = useState({
    fiscal: true,
    vencimientos: true,
    viajes: false,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        dashboardName: settings.dashboardName ?? "Mi Dashboard",
        headerText: settings.headerText ?? "Resumen Ejecutivo",
        theme: settings.theme ?? "system",
        weatherLocation: settings.weatherLocation ?? "Neuquén, Argentina",
        newsCount: settings.newsCount ?? 8,
      });
    }
  }, [settings]);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!form.dashboardName.trim() || form.dashboardName.trim().length < 2) {
      newErrors.dashboardName = "El nombre debe tener al menos 2 caracteres.";
    }
    if (form.newsCount < 1 || form.newsCount > 30) {
      newErrors.newsCount = "Debe ser un número entre 1 y 30.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    updateSettings.mutate(
      {
        data: {
          dashboardName: form.dashboardName.trim(),
          headerText: form.headerText.trim() || undefined,
          theme: form.theme,
          weatherLocation: form.weatherLocation.trim() || undefined,
          newsCount: Number(form.newsCount),
        },
      },
      {
        onSuccess: () => {
          setTheme(form.theme as "light" | "dark" | "system");
          toast({
            title: "Configuración guardada",
            description: "Los cambios se aplicaron correctamente.",
          });
        },
        onError: () => {
          toast({
            title: "Error al guardar",
            description: "No se pudieron guardar los cambios. Intentá nuevamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5 max-w-2xl">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span>Error al cargar la configuración. Recargá la página.</span>
      </div>
    );
  }

  const isSaving = updateSettings.isPending;

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
          <CardDescription>Nombre y texto de bienvenida de tu panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="dashboardName">Nombre del Dashboard *</Label>
            <Input
              id="dashboardName"
              value={form.dashboardName}
              onChange={e => {
                setForm(f => ({ ...f, dashboardName: e.target.value }));
                if (errors.dashboardName) setErrors(prev => ({ ...prev, dashboardName: undefined }));
              }}
              className={errors.dashboardName ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {errors.dashboardName && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" /> {errors.dashboardName}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="headerText">Texto de bienvenida</Label>
            <Input
              id="headerText"
              value={form.headerText}
              onChange={e => setForm(f => ({ ...f, headerText: e.target.value }))}
              placeholder="Resumen Ejecutivo"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4" />
            Apariencia
          </CardTitle>
          <CardDescription>El tema también se puede cambiar con el botón del header.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Tema visual</p>
              <p className="text-xs text-muted-foreground">Oscuro, claro, o según el sistema.</p>
            </div>
            <Select value={form.theme} onValueChange={v => setForm(f => ({ ...f, theme: v }))}>
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
            <Input
              id="weatherLocation"
              value={form.weatherLocation}
              onChange={e => setForm(f => ({ ...f, weatherLocation: e.target.value }))}
              placeholder="Neuquén, Argentina"
            />
            <p className="text-xs text-muted-foreground">
              Las coordenadas se actualizan automáticamente al ingresar la ciudad.
            </p>
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
            <Input
              id="newsCount"
              type="number"
              min={1}
              max={30}
              value={form.newsCount}
              onChange={e => {
                setForm(f => ({ ...f, newsCount: Number(e.target.value) }));
                if (errors.newsCount) setErrors(prev => ({ ...prev, newsCount: undefined }));
              }}
              className={`w-32 ${errors.newsCount ? "border-destructive" : ""}`}
            />
            {errors.newsCount && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" /> {errors.newsCount}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notificaciones
          </CardTitle>
          <CardDescription>Configurá qué tipo de alertas querés recibir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            {
              key: "fiscal" as const,
              label: "Alertas fiscales urgentes",
              desc: "Novedades de AFIP y Rentas que requieren acción",
            },
            {
              key: "vencimientos" as const,
              label: "Vencimientos próximos",
              desc: "Tareas con fecha límite en las próximas 48 horas",
            },
            {
              key: "viajes" as const,
              label: "Nuevas ofertas de viaje",
              desc: "Destinos y tarifas nuevas disponibles",
            },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={notifications[item.key]}
                onCheckedChange={v => setNotifications(n => ({ ...n, [item.key]: v }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        {updateSettings.isSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <Check className="h-4 w-4" /> Cambios guardados
          </span>
        )}
        {!updateSettings.isSuccess && <span />}
        <Button onClick={handleSave} disabled={isSaving} className="min-w-[140px]">
          {isSaving ? (
            <>
              <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar Cambios
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
