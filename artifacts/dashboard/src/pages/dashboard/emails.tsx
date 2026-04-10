import { useEffect, useState } from "react";
import { useListEmails, useGetEmailStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Clock, User, Star, RefreshCw, LinkIcon, Link2Off } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getListEmailsQueryKey, getGetEmailStatsQueryKey } from "@workspace/api-client-react";

const CATEGORY_COLORS: Record<string, string> = {
  trabajo: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  impuestos: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  clientes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  finanzas: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  facturación: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  capacitación: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
};

const IMPORTANT = ["impuestos", "finanzas"];

interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  lastSyncAt?: string | null;
}

function GmailConnectionBanner({
  status,
  onConnect,
  onDisconnect,
  loading,
}: {
  status: GmailStatus | null;
  onConnect: () => void;
  onDisconnect: () => void;
  loading: boolean;
}) {
  if (!status) return null;

  if (!status.configured) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
        <Mail className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Gmail no configurado</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Agrega las variables GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET para conectar Gmail real.
            Mientras tanto se muestra una bandeja de ejemplo.
          </p>
        </div>
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center shrink-0">
          <Mail className="h-4 w-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-green-900 dark:text-green-200">Gmail conectado</p>
          <p className="text-xs text-green-700 dark:text-green-400 truncate">
            {status.email}
            {status.lastSyncAt && (
              <span className="ml-1 opacity-70">
                — sincronizado {new Date(status.lastSyncAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisconnect}
          disabled={loading}
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
        >
          <Link2Off className="h-3.5 w-3.5 mr-1.5" />
          Desconectar
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <LinkIcon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Conectar Gmail</p>
        <p className="text-xs text-muted-foreground">
          Conecta tu cuenta de Gmail para ver tu bandeja real. Se muestra una bandeja de ejemplo.
        </p>
      </div>
      <Button
        size="sm"
        onClick={onConnect}
        disabled={loading}
        className="shrink-0"
      >
        <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
        Conectar
      </Button>
    </div>
  );
}

export default function EmailsPage() {
  const [filter, setFilter] = useState("all");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: emails, isLoading: emailsLoading, error } = useListEmails();
  const { data: stats, isLoading: statsLoading } = useGetEmailStats();

  const isLoading = emailsLoading || statsLoading;

  useEffect(() => {
    fetch("/api/emails/oauth/status")
      .then(r => r.json())
      .then(data => setGmailStatus(data))
      .catch(() => {});
  }, []);

  const handleConnect = () => {
    window.location.href = "/api/emails/oauth/connect";
  };

  const handleDisconnect = async () => {
    setStatusLoading(true);
    try {
      await fetch("/api/emails/oauth/disconnect", { method: "POST" });
      setGmailStatus(s => s ? { ...s, connected: false, email: null } : s);
      queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
    } catch {}
    setStatusLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetEmailStatsQueryKey() });
    } catch {}
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="grid gap-3 md:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        Error al cargar emails.
      </div>
    );
  }

  const filtered = (emails ?? []).filter(e => {
    if (filter === "unread") return !e.isRead;
    if (filter === "important") return IMPORTANT.includes(e.category ?? "");
    return true;
  });

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000 / 60;
    if (diff < 60) return `Hace ${Math.floor(diff)} min`;
    if (diff < 1440) return `Hace ${Math.floor(diff / 60)}h`;
    return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Emails</h1>
          <p className="text-muted-foreground mt-1 text-sm">Bandeja de entrada ejecutiva.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <GmailConnectionBanner
        status={gmailStatus}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        loading={statusLoading}
      />

      {stats && (
        <div className="grid gap-3 grid-cols-3">
          {[
            { label: "Últimas 24h", value: stats.total24h, color: "text-foreground" },
            { label: "No leídos", value: stats.unread, color: "text-amber-600 dark:text-amber-400" },
            { label: "Importantes", value: stats.important, color: "text-red-600 dark:text-red-400" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border bg-card p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {[
          { key: "all", label: "Todos" },
          { key: "unread", label: "No leídos" },
          { key: "important", label: "Importantes" },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border
              ${filter === f.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted"
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">Sin correos</h3>
            <p className="text-muted-foreground text-sm">No hay emails para este filtro.</p>
          </div>
        ) : (
          filtered.map(email => (
            <div
              key={email.id}
              className={`rounded-xl border bg-card p-4 flex gap-4 items-start transition-all duration-150 hover:shadow-sm cursor-pointer
                ${!email.isRead ? "border-l-[3px] border-l-primary" : ""}`}
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-sm truncate ${!email.isRead ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
                      {email.sender}
                    </span>
                    {IMPORTANT.includes(email.category ?? "") && (
                      <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    <Clock className="h-3 w-3" />
                    {formatDate(email.date)}
                  </span>
                </div>
                <p className={`text-sm truncate mb-1 ${!email.isRead ? "font-medium" : "text-muted-foreground"}`}>
                  {email.subject}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground truncate flex-1">{email.preview}</p>
                  {email.category && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${CATEGORY_COLORS[email.category] ?? "bg-muted text-muted-foreground"}`}>
                      {email.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
