import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Mail, Calendar, Newspaper, DollarSign, ShieldAlert,
  Save, Loader2, Send, CheckCircle2, Info, ChevronDown, ChevronUp
} from "lucide-react";

import { BASE } from "@/lib/base-url";

interface NotificationPrefs {
  id: number | null;
  userId: number;
  emailEnabled: boolean;
  dueDateEnabled: boolean;
  dueDateDaysBefore: string;
  dueDateSameDay: boolean;
  dueDateSummaryOnly: boolean;
  newsEnabled: boolean;
  newsFrequency: string;
  newsMinPriority: string;
  newsCategories: string;
  newsMaxPerDay: number;
  dollarEnabled: boolean;
  dollarUpThreshold: string | null;
  dollarDownThreshold: string | null;
  dollarMarket: string;
  dollarDailySummary: boolean;
  loginEnabled: boolean;
  loginEveryAccess: boolean;
  loginNewDeviceOnly: boolean;
  loginSuspiciousOnly: boolean;
  loginPasswordChange: boolean;
}

function SectionHeader({ icon, title, description, enabled, onToggle }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-base">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sendingTest, setSendingTest] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["due_date", "login"]));

  const toggleSection = (s: string) => setExpandedSections(prev => {
    const next = new Set(prev);
    next.has(s) ? next.delete(s) : next.add(s);
    return next;
  });

  const { data, isLoading } = useQuery<{ ok: boolean; data: NotificationPrefs }>({
    queryKey: ["notification-prefs"],
    queryFn: () =>
      fetch(`${BASE}/api/me/notification-preferences`, { credentials: "include" }).then(r => r.json()),
  });

  const prefs = data?.data;
  const [local, setLocal] = useState<Partial<NotificationPrefs>>({});
  const merged: NotificationPrefs | null = prefs ? { ...prefs, ...local } : null;

  function update<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) {
    setLocal(prev => ({ ...prev, [key]: value }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/me/notification-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(local),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Error al guardar");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      setLocal({});
      toast({ title: "Preferencias guardadas", description: "Tus alertas fueron actualizadas correctamente." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  async function handleSendTest() {
    setSendingTest(true);
    try {
      const r = await fetch(`${BASE}/api/me/notification-preferences/test`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Error al enviar");
      toast({ title: "Email enviado", description: d.message });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Error al enviar" });
    } finally {
      setSendingTest(false);
    }
  }

  const hasChanges = Object.keys(local).length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!merged) {
    return (
      <Alert>
        <AlertDescription>No se pudieron cargar las preferencias. Intentá de nuevo.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          Alertas y notificaciones
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configurá qué alertas querés recibir y cómo.
        </p>
      </div>

      {/* Global toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2 ${merged.emailEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Notificaciones por email</p>
                <p className="text-sm text-muted-foreground">
                  {merged.emailEnabled ? "Estás recibiendo emails del sistema" : "Todos los emails están desactivados"}
                </p>
              </div>
            </div>
            <Switch
              checked={merged.emailEnabled}
              onCheckedChange={v => update("emailEnabled", v)}
            />
          </div>
          {!merged.emailEnabled && (
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                Con esta opción desactivada no recibirás ningún email, excepto los relacionados con la seguridad de tu cuenta (cambio de contraseña, accesos).
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* A. Vencimientos */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            icon={<Calendar className="h-5 w-5" />}
            title="Alertas de vencimientos"
            description="Recordatorios de vencimientos impositivos de tus clientes"
            enabled={merged.dueDateEnabled}
            onToggle={v => update("dueDateEnabled", v)}
          />
        </CardHeader>
        {merged.dueDateEnabled && (
          <>
            <Separator />
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Días de anticipación</Label>
                <p className="text-xs text-muted-foreground">Recibirás alertas cuando falten estos días para el vencimiento</p>
                <div className="flex flex-wrap gap-2">
                  {["7", "3", "1"].map(day => {
                    const days = merged.dueDateDaysBefore.split(",").filter(Boolean);
                    const active = days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const updated = active
                            ? days.filter(d => d !== day)
                            : [...days, day].sort((a, b) => Number(b) - Number(a));
                          update("dueDateDaysBefore", updated.join(","));
                        }}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-muted-foreground hover:border-primary"
                        }`}
                      >
                        {day === "1" ? "1 día" : `${day} días`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alerta el día del vencimiento</p>
                  <p className="text-xs text-muted-foreground">Recibir alerta cuando el vencimiento es hoy</p>
                </div>
                <Switch checked={merged.dueDateSameDay} onCheckedChange={v => update("dueDateSameDay", v)} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Solo resumen diario</p>
                  <p className="text-xs text-muted-foreground">Un email por día con todos los vencimientos, en lugar de uno por cada uno</p>
                </div>
                <Switch checked={merged.dueDateSummaryOnly} onCheckedChange={v => update("dueDateSummaryOnly", v)} />
              </div>
            </CardContent>
          </>
        )}
      </Card>

      {/* B. Noticias */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            icon={<Newspaper className="h-5 w-5" />}
            title="Alertas de noticias"
            description="Noticias relevantes sobre impuestos, AFIP, economía"
            enabled={merged.newsEnabled}
            onToggle={v => update("newsEnabled", v)}
          />
        </CardHeader>
        {merged.newsEnabled && (
          <>
            <Separator />
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Frecuencia</Label>
                <Select value={merged.newsFrequency} onValueChange={v => update("newsFrequency", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Inmediata (cada noticia relevante)</SelectItem>
                    <SelectItem value="daily">Resumen diario</SelectItem>
                    <SelectItem value="weekly">Resumen semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Prioridad mínima</Label>
                <Select value={merged.newsMinPriority} onValueChange={v => update("newsMinPriority", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baja — todas las noticias</SelectItem>
                    <SelectItem value="medium">Media — noticias moderadas y altas</SelectItem>
                    <SelectItem value="high">Alta — solo noticias importantes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Máximo de emails por día</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={merged.newsMaxPerDay}
                  onChange={e => update("newsMaxPerDay", parseInt(e.target.value) || 3)}
                  className="w-24"
                />
              </div>
            </CardContent>
          </>
        )}
      </Card>

      {/* C. Dólar */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            icon={<DollarSign className="h-5 w-5" />}
            title="Alertas del dólar"
            description="Notificaciones cuando el tipo de cambio supera umbrales"
            enabled={merged.dollarEnabled}
            onToggle={v => update("dollarEnabled", v)}
          />
        </CardHeader>
        {merged.dollarEnabled && (
          <>
            <Separator />
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Mercado de referencia</Label>
                <Select value={merged.dollarMarket} onValueChange={v => update("dollarMarket", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Dólar Blue</SelectItem>
                    <SelectItem value="mep">Dólar MEP (Bolsa)</SelectItem>
                    <SelectItem value="oficial">Dólar Oficial</SelectItem>
                    <SelectItem value="ccl">Dólar CCL</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Alerta si sube (%)</Label>
                  <Input
                    type="number"
                    min={0.5}
                    max={50}
                    step={0.5}
                    placeholder="ej: 3"
                    value={merged.dollarUpThreshold ?? ""}
                    onChange={e => update("dollarUpThreshold", e.target.value || null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Alerta si baja (%)</Label>
                  <Input
                    type="number"
                    min={0.5}
                    max={50}
                    step={0.5}
                    placeholder="ej: 2"
                    value={merged.dollarDownThreshold ?? ""}
                    onChange={e => update("dollarDownThreshold", e.target.value || null)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Resumen diario</p>
                  <p className="text-xs text-muted-foreground">Un email diario con la cotización del día</p>
                </div>
                <Switch checked={merged.dollarDailySummary} onCheckedChange={v => update("dollarDailySummary", v)} />
              </div>
            </CardContent>
          </>
        )}
      </Card>

      {/* D. Login */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            icon={<ShieldAlert className="h-5 w-5" />}
            title="Alertas de acceso"
            description="Notificaciones cuando alguien accede a tu cuenta"
            enabled={merged.loginEnabled}
            onToggle={v => update("loginEnabled", v)}
          />
        </CardHeader>
        {merged.loginEnabled && (
          <>
            <Separator />
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Todos los ingresos</p>
                  <p className="text-xs text-muted-foreground">Recibir alerta en cada inicio de sesión</p>
                </div>
                <Switch checked={merged.loginEveryAccess} onCheckedChange={v => update("loginEveryAccess", v)} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Solo desde dispositivos nuevos</p>
                  <p className="text-xs text-muted-foreground">Alertar solo cuando el navegador o dispositivo es desconocido</p>
                </div>
                <Switch
                  checked={merged.loginNewDeviceOnly}
                  onCheckedChange={v => update("loginNewDeviceOnly", v)}
                  disabled={merged.loginEveryAccess}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Solo accesos sospechosos</p>
                  <p className="text-xs text-muted-foreground">Alertar solo cuando el sistema detecta actividad inusual</p>
                </div>
                <Switch
                  checked={merged.loginSuspiciousOnly}
                  onCheckedChange={v => update("loginSuspiciousOnly", v)}
                  disabled={merged.loginEveryAccess}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Cambios de contraseña</p>
                  <p className="text-xs text-muted-foreground">Recibir confirmación cuando tu contraseña cambia</p>
                </div>
                <Switch checked={merged.loginPasswordChange} onCheckedChange={v => update("loginPasswordChange", v)} />
              </div>
            </CardContent>
          </>
        )}
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 gap-4">
        <Button
          variant="outline"
          onClick={handleSendTest}
          disabled={sendingTest}
          className="gap-2"
        >
          {sendingTest
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Send className="h-4 w-4" />
          }
          Enviarme email de prueba
        </Button>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Save className="h-4 w-4" />
          }
          Guardar cambios
        </Button>
      </div>

      {hasChanges && (
        <p className="text-xs text-center text-amber-600">
          Tenés cambios sin guardar
        </p>
      )}
    </div>
  );
}
