/**
 * admin-email-panel.tsx
 *
 * Panel completo de configuración del proveedor de email del sistema.
 * Solo visible y editable para super_admin.
 *
 * Secciones:
 *  1. Estado del proveedor (indicadores en tiempo real)
 *  2. Configuración SMTP (formulario de credenciales)
 *  3. Ajustes de remitente (nombre, reply-to, activo/inactivo)
 *  4. Logs de emails enviados
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2,
  Mail, Send, Eye, EyeOff, Plug, PlugZap, Unplug, Settings,
  Clock, TrendingUp, AlertTriangle, Info, FileText
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface ProviderStatus {
  configured: boolean;
  active: boolean;
  providerType: string;
  senderEmail: string | null;
  senderName: string;
  replyTo: string | null;
  connectionStatus: string;
  lastConnectedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  sentToday: number;
  failedToday: number;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
}

interface EmailLog {
  id: number;
  templateKey: string | null;
  recipientEmail: string;
  subject: string;
  provider: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    connected:      { label: "Conectado",       className: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300", icon: <CheckCircle2 className="h-3 w-3" /> },
    configured:     { label: "Configurado",     className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",  icon: <CheckCircle2 className="h-3 w-3" /> },
    error:          { label: "Error",           className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",      icon: <XCircle className="h-3 w-3" /> },
    not_configured: { label: "No configurado",  className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",     icon: <AlertCircle className="h-3 w-3" /> },
    disabled:       { label: "Desactivado",     className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300", icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const s = map[status] ?? map["not_configured"]!;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.className}`}>
      {s.icon}{s.label}
    </span>
  );
}

function SendStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:          "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
    failed:        "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
    not_configured:"bg-gray-100 text-gray-600",
    pending:       "bg-amber-100 text-amber-800",
    skipped:       "bg-gray-100 text-gray-500",
  };
  const labels: Record<string, string> = {
    sent: "Enviado", failed: "Fallido", not_configured: "Sin config", pending: "Pendiente", skipped: "Saltado",
  };
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${map[status] ?? map["pending"]}`}>
      {labels[status] ?? status}
    </span>
  );
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

// ── Provider Status Card ─────────────────────────────────────────────────────

function ProviderStatusSection({ status, onRefresh, refreshing }: {
  status: ProviderStatus;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Estado del proveedor de email</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} className="h-8 w-8 p-0">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicators */}
        <div className="flex flex-wrap gap-3 items-center">
          <StatusBadge status={status.connectionStatus} />
          {!status.active && status.configured && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
              <AlertTriangle className="h-3 w-3" /> Envíos desactivados
            </span>
          )}
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Proveedor</p>
            <p className="font-medium">{status.providerType === "smtp_gmail" ? "Gmail (SMTP)" : status.providerType}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Remitente</p>
            <p className="font-medium truncate">{status.senderEmail ?? "No configurado"}</p>
          </div>
          {status.smtpHost && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Servidor SMTP</p>
              <p className="font-medium">{status.smtpHost}:{status.smtpPort}</p>
            </div>
          )}
          {status.smtpUser && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Usuario SMTP</p>
              <p className="font-medium font-mono text-xs">{status.smtpUser}</p>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Última conexión", value: formatRelative(status.lastConnectedAt), icon: <Plug className="h-4 w-4 text-muted-foreground" /> },
            { label: "Enviados hoy",    value: String(status.sentToday),   icon: <TrendingUp className="h-4 w-4 text-green-600" /> },
            { label: "Fallidos hoy",   value: String(status.failedToday), icon: <AlertCircle className={`h-4 w-4 ${status.failedToday > 0 ? "text-red-500" : "text-muted-foreground"}`} /> },
          ].map(s => (
            <div key={s.label} className="rounded-lg border bg-muted/30 p-3 text-center">
              <div className="flex justify-center mb-1">{s.icon}</div>
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Error display */}
        {status.lastErrorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">Último error ({formatRelative(status.lastErrorAt)}): </span>
              {status.lastErrorMessage}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ── SMTP Config Form ──────────────────────────────────────────────────────────

function SmtpConfigSection({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    smtpHost:    "smtp.gmail.com",
    smtpPort:    "587",
    smtpUser:    "",
    smtpPass:    "",
    senderEmail: "",
    senderName:  "Sistema Dashboard",
    replyTo:     "",
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.smtpHost || !form.smtpUser || !form.smtpPass) {
      toast({ variant: "destructive", title: "Error", description: "Host, email y App Password son requeridos" });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email-provider/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          smtpPort: parseInt(form.smtpPort),
          senderEmail: form.senderEmail || form.smtpUser,
          providerType: "smtp_gmail",
        }),
      });
      const d = await r.json();
      if (d.ok) {
        toast({ title: "¡Proveedor configurado!", description: d.message });
        onSuccess();
      } else if (d.saved) {
        toast({ title: "Guardado con advertencia", description: d.warning ?? d.error, variant: "destructive" });
        onSuccess();
      } else {
        toast({ variant: "destructive", title: "Error", description: d.error ?? "Error al configurar" });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Error de conexión" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Configurar Gmail del sistema
        </CardTitle>
        <CardDescription>
          Usá una cuenta Gmail con un App Password generado desde la configuración de seguridad de Google.
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary ml-1 hover:underline"
          >
            Crear App Password →
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Servidor SMTP</Label>
              <Input value={form.smtpHost} onChange={set("smtpHost")} placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Puerto</Label>
              <Input value={form.smtpPort} onChange={set("smtpPort")} placeholder="587" type="number" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Email de Gmail (remitente)</Label>
            <Input
              type="email"
              value={form.smtpUser}
              onChange={set("smtpUser")}
              placeholder="sistema@tudominio.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>App Password de Google</Label>
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                value={form.smtpPass}
                onChange={set("smtpPass")}
                placeholder="xxxx xxxx xxxx xxxx"
                required
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              No uses tu contraseña de Gmail. Generá un App Password específico para el sistema.
              La contraseña se guarda encriptada en la base de datos.
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nombre visible del remitente</Label>
              <Input value={form.senderName} onChange={set("senderName")} placeholder="Sistema Dashboard" />
            </div>
            <div className="space-y-1.5">
              <Label>Reply-to (opcional)</Label>
              <Input type="email" value={form.replyTo} onChange={set("replyTo")} placeholder="consultas@ejemplo.com" />
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Al guardar se verificará la conexión inmediatamente. Si el test falla, las credenciales igual quedan guardadas
              pero el sistema no enviará emails hasta que la conexión sea exitosa.
            </AlertDescription>
          </Alert>

          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Guardando y verificando...</>
              : <><PlugZap className="h-4 w-4" />Conectar y verificar</>
            }
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Settings Card ─────────────────────────────────────────────────────────────

function ProviderSettingsSection({ status, onSuccess }: { status: ProviderStatus; onSuccess: () => void }) {
  const { toast } = useToast();
  const [senderName, setSenderName] = useState(status.senderName);
  const [replyTo, setReplyTo]       = useState(status.replyTo ?? "");
  const [isActive, setIsActive]     = useState(status.active);
  const [loading, setLoading]       = useState(false);

  async function handleSave() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email-provider/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ senderName, replyTo: replyTo || null, isActive }),
      });
      const d = await r.json();
      if (d.ok) { toast({ title: "Ajustes guardados" }); onSuccess(); }
      else toast({ variant: "destructive", title: "Error", description: d.error });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Error de conexión" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ajustes del remitente</CardTitle>
        <CardDescription>Modificá el nombre visible y el estado del módulo de email.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Envíos de email activos</p>
            <p className="text-xs text-muted-foreground">Activar o pausar todos los envíos del sistema</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Nombre del remitente</Label>
            <Input value={senderName} onChange={e => setSenderName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Reply-to</Label>
            <Input type="email" value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="opcional" />
          </div>
        </div>
        <Button onClick={handleSave} disabled={loading} size="sm" className="gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar ajustes
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Email Logs ────────────────────────────────────────────────────────────────

function EmailLogsSection() {
  const { data, isLoading } = useQuery<{ ok: boolean; data: EmailLog[] }>({
    queryKey: ["admin-email-logs"],
    queryFn: () =>
      fetch(`${BASE}/api/admin/email-logs?limit=30`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const logs = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Últimos emails enviados
        </CardTitle>
        <CardDescription>Historial de los últimos 30 emails del sistema</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No hay emails registrados todavía</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <div className="mt-0.5">
                  <SendStatusBadge status={log.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{log.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    Para: {log.recipientEmail}
                    {log.templateKey && <> · <span className="font-mono">{log.templateKey}</span></>}
                  </p>
                  {log.errorMessage && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">{log.errorMessage}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                  {formatRelative(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AdminEmailPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [testLoading, setTestLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [reconnectLoading, setReconnectLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ ok: boolean; data: ProviderStatus }>({
    queryKey: ["admin-email-provider-status"],
    queryFn: () =>
      fetch(`${BASE}/api/admin/email-provider/status`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const status = data?.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-email-provider-status"] });
    qc.invalidateQueries({ queryKey: ["admin-email-logs"] });
  };

  async function handleTest() {
    setTestLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email-provider/test`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.ok) toast({ title: "Email de prueba enviado", description: d.message });
      else toast({ variant: "destructive", title: "Error", description: d.error });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Error de conexión" });
    } finally {
      setTestLoading(false);
      invalidate();
    }
  }

  async function handleDisconnect() {
    if (!confirm("¿Desconectar el proveedor de email? Se borrarán las credenciales guardadas.")) return;
    setDisconnectLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email-provider/disconnect`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (d.ok) toast({ title: "Proveedor desconectado" });
      else toast({ variant: "destructive", title: "Error", description: d.error });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Error de conexión" });
    } finally {
      setDisconnectLoading(false);
      invalidate();
    }
  }

  async function handleReconnect() {
    setReconnectLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email-provider/reconnect`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (d.ok) toast({ title: "Conexión verificada", description: `Latencia: ${d.latencyMs ?? "?"}ms` });
      else toast({ variant: "destructive", title: "Error de conexión", description: d.error });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Error de conexión" });
    } finally {
      setReconnectLoading(false);
      invalidate();
    }
  }

  if (isLoading || !status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <ProviderStatusSection
        status={status}
        onRefresh={() => refetch()}
        refreshing={isLoading}
      />

      {/* Action buttons */}
      {status.configured && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testLoading} className="gap-2">
            {testLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Enviar email de prueba
          </Button>
          <Button variant="outline" size="sm" onClick={handleReconnect} disabled={reconnectLoading} className="gap-2">
            {reconnectLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Verificar conexión
          </Button>
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnectLoading} className="gap-2 text-destructive hover:text-destructive">
            {disconnectLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
            Desconectar
          </Button>
        </div>
      )}

      {/* Settings (if configured) */}
      {status.configured && (
        <ProviderSettingsSection status={status} onSuccess={invalidate} />
      )}

      {/* SMTP Config Form */}
      <SmtpConfigSection onSuccess={invalidate} />

      {/* Email Logs */}
      <EmailLogsSection />
    </div>
  );
}
