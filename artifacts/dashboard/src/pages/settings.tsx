import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings as SettingsIcon, Save, MapPin, Newspaper, Palette, Bell, Check, AlertCircle, FileSpreadsheet, Plus, Pencil, Trash2, X, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";

interface ExternalSource {
  id: number;
  name: string;
  type: string;
  url?: string | null;
  identifier?: string | null;
  status: string;
  notes?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendiente",  color: "text-amber-600 dark:text-amber-400" },
  connected: { label: "Conectado",  color: "text-emerald-600 dark:text-emerald-400" },
  error:     { label: "Error",      color: "text-red-600 dark:text-red-400" },
  paused:    { label: "Pausado",    color: "text-muted-foreground" },
};

const TYPE_LABELS: Record<string, string> = {
  excel: "Excel (.xlsx)",
  google_sheets: "Google Sheets",
  csv: "CSV",
  other: "Otro",
};

const EMPTY_SOURCE_FORM = { name: "", type: "excel", url: "", identifier: "", status: "pending", notes: "" };

function ExternalSourcesSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalSource | null>(null);
  const [form, setForm] = useState({ ...EMPTY_SOURCE_FORM });

  const { data: sources = [], isLoading } = useQuery<ExternalSource[]>({
    queryKey: ["external-sources"],
    queryFn: async () => {
      const res = await fetch("/api/external-sources");
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_SOURCE_FORM) => {
      const res = await fetch("/api/external-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-sources"] });
      setOpen(false);
      toast({ title: "Fuente creada", description: "La fuente externa fue registrada." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof EMPTY_SOURCE_FORM }) => {
      const res = await fetch(`/api/external-sources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-sources"] });
      setOpen(false);
      toast({ title: "Fuente actualizada" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/external-sources/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["external-sources"] }),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_SOURCE_FORM });
    setOpen(true);
  };

  const openEdit = (s: ExternalSource) => {
    setEditing(s);
    setForm({
      name: s.name,
      type: s.type,
      url: s.url ?? "",
      identifier: s.identifier ?? "",
      status: s.status,
      notes: s.notes ?? "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Fuentes Externas</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Vinculá archivos Excel, Google Sheets o CSV para usarlos en el dashboard. La integración completa se activa en el futuro.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nueva fuente
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : sources.length === 0 ? (
          <div className="py-8 text-center border-2 border-dashed border-border/50 rounded-xl">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground/25 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay fuentes externas registradas.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Podés registrar archivos Excel, Google Sheets o CSV para uso futuro.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map(s => {
              const statusCfg = STATUS_LABELS[s.status] ?? STATUS_LABELS["pending"];
              return (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/60 hover:border-border transition-colors">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{TYPE_LABELS[s.type] ?? s.type}</span>
                      <span className="text-[10px] text-muted-foreground/40">·</span>
                      <span className={`text-[10px] font-medium ${statusCfg.color}`}>{statusCfg.label}</span>
                      {s.url && (
                        <>
                          <span className="text-[10px] text-muted-foreground/40">·</span>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                            <LinkIcon className="h-2.5 w-2.5" /> URL
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(s)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteMutation.mutate(s.id)} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <strong>Nota:</strong> Esta sección registra la fuente para uso futuro. La lectura de datos desde Excel o Google Sheets se activará en una próxima versión con soporte de credenciales OAuth.
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar fuente" : "Nueva fuente externa"}</DialogTitle>
            <DialogDescription>Registrá un archivo remoto para uso futuro en el dashboard.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input placeholder="Ej: Planilla de honorarios 2025" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>URL del archivo <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input placeholder="https://docs.google.com/spreadsheets/..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Identificador <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input placeholder="ID del documento o sheet" value={form.identifier} onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notas <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input placeholder="Para qué se usa esta fuente..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

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

      <ExternalSourcesSection />

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
