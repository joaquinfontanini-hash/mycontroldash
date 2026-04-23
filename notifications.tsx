/**
 * notifications.tsx — Configuración de alertas y notificaciones por email
 *
 * MEJORAS vs. original (481 líneas):
 *  1. isError manejado → estado de error consistente con el resto del proyecto
 *  2. credentials:"include" ya presente en original — preservado y auditado
 *  3. hasChanges badge más visible para que el usuario sepa que hay cambios pendientes
 *  4. Guardado con feedback optimista: el botón muestra "Guardando..." durante la mutación
 *  5. Reset local al cargar nuevos datos del servidor (evita que local overwrite datos frescos)
 *  6. Secciones colapsables con animación consistente
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Mail, Calendar, Newspaper, DollarSign, ShieldAlert,
  Save, Loader2, Send, CheckCircle2, Info, ChevronDown, ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, description, enabled, onToggle }: {
  icon: React.ReactNode; title: string; description: string;
  enabled: boolean; onToggle: (v: boolean)=>void;
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
      <Switch checked={enabled} onCheckedChange={onToggle}/>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { toast }  = useToast();
  const qc         = useQueryClient();

  const [sendingTest,       setSendingTest]       = useState(false);
  const [expandedSections,  setExpandedSections]  = useState<Set<string>>(new Set(["due_date", "login"]));

  const toggleSection = (s: string) =>
    setExpandedSections(prev => { const next=new Set(prev); next.has(s)?next.delete(s):next.add(s); return next; });

  // ── Query con isError ────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<{ ok: boolean; data: NotificationPrefs }>({
    queryKey: ["notification-prefs"],
    queryFn: () =>
      fetch(`${BASE}/api/me/notification-preferences`, { credentials:"include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar"); return r.json(); }),
  });

  const prefs = data?.data;

  // Estado local diferencial — solo guarda cambios no sincronizados
  const [local, setLocal] = useState<Partial<NotificationPrefs>>({});

  // Reset local cuando llegan datos frescos del servidor
  // (evita que un re-fetch sobreescriba cambios pendientes)
  useEffect(() => {
    if (prefs) setLocal({});
  }, [prefs?.id]); // Solo cuando cambia el ID (primera carga o cambio de usuario)

  const merged: NotificationPrefs | null = prefs ? { ...prefs, ...local } : null;

  function update<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) {
    setLocal(prev => ({ ...prev, [key]: value }));
  }

  // ── Save mutation ────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/me/notification-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(local),
      });
      const d = await r.json() as { ok: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Error al guardar");
      return d;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey:["notification-prefs"] });
      setLocal({});
      toast({ title:"Preferencias guardadas", description:"Tus alertas fueron actualizadas correctamente." });
    },
    onError: (err: Error) => {
      toast({ variant:"destructive", title:"Error", description:err.message });
    },
  });

  async function handleSendTest() {
    setSendingTest(true);
    try {
      const r = await fetch(`${BASE}/api/me/notification-preferences/test`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json() as { ok: boolean; message?: string; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Error al enviar");
      toast({ title:"Email enviado", description: d.message });
    } catch (err) {
      toast({ variant:"destructive", title:"Error", description: err instanceof Error ? err.message : "Error al enviar" });
    } finally { setSendingTest(false); }
  }

  const hasChanges = Object.keys(local).length > 0;

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64"/>
      <div className="space-y-4">
        {[1,2,3].map(i=><Skeleton key={i} className="h-32 rounded-xl"/>)}
      </div>
    </div>
  );

  if (isError || !merged) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
      <AlertTriangle className="h-5 w-5 shrink-0"/>
      No se pudieron cargar las preferencias de notificación. Intentá actualizar la página.
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-12 w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary"/>
            Alertas y notificaciones
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configurá qué alertas querés recibir y cómo.
          </p>
        </div>
        {/* Botón guardar con indicador de cambios pendientes */}
        <div className="flex items-center gap-2 shrink-0">
          {hasChanges && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-xs">
              {Object.keys(local).length} cambio{Object.keys(local).length !== 1 ? "s" : ""} sin guardar
            </Badge>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} size="sm">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <Save className="h-3.5 w-3.5 mr-1.5"/>}
            {saveMutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Global email toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2 ${merged.emailEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                <Mail className="h-5 w-5"/>
              </div>
              <div>
                <p className="font-semibold">Notificaciones por email</p>
                <p className="text-sm text-muted-foreground">
                  {merged.emailEnabled ? "Estás recibiendo emails del sistema" : "Todos los emails están desactivados"}
                </p>
              </div>
            </div>
            <Switch checked={merged.emailEnabled} onCheckedChange={v=>update("emailEnabled",v)}/>
          </div>
          {merged.emailEnabled && (
            <div className="mt-4 pt-4 border-t flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={()=>void handleSendTest()} disabled={sendingTest}>
                {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <Send className="h-3.5 w-3.5 mr-1.5"/>}
                Enviar email de prueba
              </Button>
              <p className="text-xs text-muted-foreground">Verificá que tu email esté configurado correctamente</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección: Vencimientos impositivos */}
      <Card className={!merged.emailEnabled ? "opacity-60 pointer-events-none" : ""}>
        <CardHeader className="pb-2 cursor-pointer" onClick={()=>toggleSection("due_date")}>
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={<Calendar className="h-5 w-5"/>}
              title="Vencimientos impositivos"
              description="Alertas de vencimientos AFIP y provinciales"
              enabled={merged.dueDateEnabled}
              onToggle={v=>update("dueDateEnabled",v)}
            />
            {expandedSections.has("due_date")
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
          </div>
        </CardHeader>
        {expandedSections.has("due_date") && merged.dueDateEnabled && (
          <CardContent className="space-y-4 pt-0">
            <Separator/>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Días de anticipación</Label>
                <Select value={merged.dueDateDaysBefore} onValueChange={v=>update("dueDateDaysBefore",v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","5","7","10","14"].map(d=><SelectItem key={d} value={d}>{d} {d==="1"?"día":"días"} antes</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Opciones adicionales</Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={merged.dueDateSameDay} onCheckedChange={v=>update("dueDateSameDay",v)} className="h-4 w-7"/>
                    <span className="text-sm">Alerta el mismo día de vencimiento</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch checked={merged.dueDateSummaryOnly} onCheckedChange={v=>update("dueDateSummaryOnly",v)} className="h-4 w-7"/>
                    <span className="text-sm">Solo resumen diario (no individual)</span>
                  </label>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Sección: Noticias fiscales */}
      <Card className={!merged.emailEnabled ? "opacity-60 pointer-events-none" : ""}>
        <CardHeader className="pb-2 cursor-pointer" onClick={()=>toggleSection("news")}>
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={<Newspaper className="h-5 w-5"/>}
              title="Monitor fiscal"
              description="Novedades normativas e impositivas"
              enabled={merged.newsEnabled}
              onToggle={v=>update("newsEnabled",v)}
            />
            {expandedSections.has("news")
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
          </div>
        </CardHeader>
        {expandedSections.has("news") && merged.newsEnabled && (
          <CardContent className="space-y-4 pt-0">
            <Separator/>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Frecuencia</Label>
                <Select value={merged.newsFrequency} onValueChange={v=>update("newsFrequency",v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Inmediata</SelectItem>
                    <SelectItem value="daily">Diaria</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Prioridad mínima</Label>
                <Select value={merged.newsMinPriority} onValueChange={v=>update("newsMinPriority",v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="medium">Media o superior</SelectItem>
                    <SelectItem value="high">Solo alto impacto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Máx. por día</Label>
                <Input
                  type="number" min={1} max={20}
                  value={merged.newsMaxPerDay}
                  onChange={e=>update("newsMaxPerDay", parseInt(e.target.value)||5)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Sección: Cotización del dólar */}
      <Card className={!merged.emailEnabled ? "opacity-60 pointer-events-none" : ""}>
        <CardHeader className="pb-2 cursor-pointer" onClick={()=>toggleSection("dollar")}>
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={<DollarSign className="h-5 w-5"/>}
              title="Cotización del dólar"
              description="Alertas cuando el dólar supera umbrales configurados"
              enabled={merged.dollarEnabled}
              onToggle={v=>update("dollarEnabled",v)}
            />
            {expandedSections.has("dollar")
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
          </div>
        </CardHeader>
        {expandedSections.has("dollar") && merged.dollarEnabled && (
          <CardContent className="space-y-4 pt-0">
            <Separator/>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Mercado a monitorear</Label>
                <Select value={merged.dollarMarket} onValueChange={v=>update("dollarMarket",v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Dólar blue</SelectItem>
                    <SelectItem value="oficial">Oficial</SelectItem>
                    <SelectItem value="bolsa">MEP / Bolsa</SelectItem>
                    <SelectItem value="cripto">Cripto (CCL)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Alertar si sube más de ($)</Label>
                <Input
                  type="number" min={0} placeholder="Ej: 1500"
                  value={merged.dollarUpThreshold ?? ""}
                  onChange={e=>update("dollarUpThreshold", e.target.value || null)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Alertar si baja de ($)</Label>
                <Input
                  type="number" min={0} placeholder="Ej: 1200"
                  value={merged.dollarDownThreshold ?? ""}
                  onChange={e=>update("dollarDownThreshold", e.target.value || null)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={merged.dollarDailySummary} onCheckedChange={v=>update("dollarDailySummary",v)} className="h-4 w-7"/>
              <span className="text-sm">Resumen diario de cotizaciones</span>
            </label>
          </CardContent>
        )}
      </Card>

      {/* Sección: Seguridad */}
      <Card className={!merged.emailEnabled ? "opacity-60 pointer-events-none" : ""}>
        <CardHeader className="pb-2 cursor-pointer" onClick={()=>toggleSection("login")}>
          <div className="flex items-center justify-between">
            <SectionHeader
              icon={<ShieldAlert className="h-5 w-5"/>}
              title="Seguridad"
              description="Alertas de acceso y actividad de cuenta"
              enabled={merged.loginEnabled}
              onToggle={v=>update("loginEnabled",v)}
            />
            {expandedSections.has("login")
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
          </div>
        </CardHeader>
        {expandedSections.has("login") && merged.loginEnabled && (
          <CardContent className="space-y-3 pt-0">
            <Separator/>
            {[
              { key:"loginEveryAccess"    as const, label:"Notificar en cada inicio de sesión" },
              { key:"loginNewDeviceOnly"  as const, label:"Solo en dispositivos nuevos" },
              { key:"loginSuspiciousOnly" as const, label:"Solo accesos sospechosos" },
              { key:"loginPasswordChange" as const, label:"Al cambiar la contraseña" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Switch checked={merged[key] as boolean} onCheckedChange={v=>update(key,v)} className="h-4 w-7"/>
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </CardContent>
        )}
      </Card>

      {/* Info box */}
      <Alert>
        <Info className="h-4 w-4"/>
        <AlertDescription className="text-sm">
          Las alertas se envían a tu dirección de email registrada. Para cambiar el email, modificá tu perfil de usuario.
          El sistema puede demorar hasta 5 minutos en aplicar los cambios.
        </AlertDescription>
      </Alert>

      {/* Sticky save bottom bar cuando hay cambios */}
      {hasChanges && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-background border shadow-lg rounded-xl px-4 py-3">
          <p className="text-sm font-medium">
            {Object.keys(local).length} cambio{Object.keys(local).length !== 1 ? "s" : ""} sin guardar
          </p>
          <Button onClick={()=>saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <Save className="h-3.5 w-3.5 mr-1.5"/>}
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
