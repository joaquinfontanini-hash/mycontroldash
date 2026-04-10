import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Shield, Users, CheckCircle2, XCircle, Activity,
  Mail, CloudSun, Newspaper, Briefcase, MoreHorizontal, Clock, Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_COLORS = {
  admin: "bg-primary/10 text-primary border-primary/20",
  editor: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  viewer: "bg-muted text-muted-foreground border-muted",
};

interface SyncStatus {
  weather?: { lastSync: string; status: string };
  news?: { lastSync: string; status: string };
  fiscal?: { lastSync: string; status: string };
}

interface SyncLog {
  id: number;
  module: string;
  status: string;
  itemsFound: number;
  itemsNew: number;
  durationMs: number;
  createdAt: string;
  errorMessage?: string;
}

interface DiscardLog {
  id: number;
  module: string;
  source: string;
  title: string;
  sourceUrl?: string | null;
  reason: string;
  discardedAt: string;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

export default function AdminPage() {
  const { data: users, isLoading: usersLoading, error } = useListUsers();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["sync-status"],
    queryFn: async () => {
      const res = await fetch("/api/sync/status");
      if (!res.ok) throw new Error("sync status failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: syncLogs } = useQuery<SyncLog[]>({
    queryKey: ["sync-logs"],
    queryFn: async () => {
      const res = await fetch("/api/sync/logs");
      if (!res.ok) throw new Error("sync logs failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: discardLogs } = useQuery<DiscardLog[]>({
    queryKey: ["discard-logs"],
    queryFn: async () => {
      const res = await fetch("/api/fiscal/discards");
      if (!res.ok) throw new Error("discard logs failed");
      return res.json();
    },
    refetchInterval: 300_000,
  });

  const { data: gmailStatus } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["gmail-status"],
    queryFn: async () => {
      const res = await fetch("/api/emails/oauth/status");
      if (!res.ok) return { connected: false };
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const handleRoleChange = (id: number, role: "admin" | "editor" | "viewer") => {
    updateUser.mutate({ id, data: { role } }, { onSuccess: invalidate });
  };

  const handleToggleActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, { onSuccess: invalidate });
  };

  const integrations = [
    {
      name: "Gmail / Email",
      icon: Mail,
      connected: gmailStatus?.connected ?? false,
      detail: gmailStatus?.connected ? (gmailStatus.email ?? "Conectado") : "Sin configurar",
      color: "text-red-500",
    },
    {
      name: "Open-Meteo (Clima)",
      icon: CloudSun,
      connected: true,
      detail: syncStatus?.weather
        ? `Último sync: ${timeAgo(syncStatus.weather.lastSync)}`
        : "Activo — sin credenciales requeridas",
      color: "text-blue-500",
    },
    {
      name: "Noticias RSS",
      icon: Newspaper,
      connected: true,
      detail: syncStatus?.news
        ? `Último sync: ${timeAgo(syncStatus.news.lastSync)}`
        : "Activo — fuentes argentinas configuradas",
      color: "text-purple-500",
    },
    {
      name: "Monitor Fiscal / AFIP",
      icon: Briefcase,
      connected: true,
      detail: syncStatus?.fiscal
        ? `Último sync: ${timeAgo(syncStatus.fiscal.lastSync)}`
        : "Activo — RSS AFIP y Boletín Oficial",
      color: "text-amber-500",
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Administración</h1>
        <p className="text-muted-foreground mt-1 text-sm">Estado del sistema, usuarios e integraciones.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          { label: "Total usuarios", value: users?.length ?? "—", icon: Users },
          { label: "Activos", value: users?.filter(u => u.isActive).length ?? "—", icon: CheckCircle2 },
          { label: "Admins", value: users?.filter(u => u.role === "admin").length ?? "—", icon: Shield },
          {
            label: "Sincronizaciones",
            value: syncLogs?.length ?? "—",
            icon: Activity,
          },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="integrations">Integraciones</TabsTrigger>
          <TabsTrigger value="sync">Sincronización</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Gestión de Usuarios
              </CardTitle>
              <CardDescription>Controlá el acceso y los roles de cada usuario registrado.</CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : error ? (
                <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                  <XCircle className="h-5 w-5 shrink-0" />
                  Error al cargar usuarios.
                </div>
              ) : users?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium">Sin usuarios registrados</p>
                  <p className="text-sm text-muted-foreground">Los usuarios aparecerán aquí al iniciar sesión.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users?.map(user => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                                {user.name?.charAt(0) ?? user.email?.charAt(0) ?? "U"}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{user.name || "Sin nombre"}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[user.role as keyof typeof ROLE_COLORS] ?? "bg-muted text-muted-foreground"}`}>
                            {user.role === "admin" && <Shield className="h-3 w-3 mr-1" />}
                            {user.role}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
                            ${user.isActive
                              ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                              : "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                            }`}>
                            <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${user.isActive ? "bg-green-500" : "bg-red-500"}`} />
                            {user.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel className="text-xs text-muted-foreground">Cambiar rol</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleRoleChange(user.id, "admin")}>Admin</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleRoleChange(user.id, "editor")}>Editor</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleRoleChange(user.id, "viewer")}>Viewer</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className={user.isActive ? "text-destructive" : "text-emerald-600"}
                                onClick={() => handleToggleActive(user.id, user.isActive)}
                              >
                                {user.isActive ? "Desactivar usuario" : "Activar usuario"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Estado de Integraciones
              </CardTitle>
              <CardDescription>Servicios externos conectados al dashboard.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {integrations.map(integration => (
                  <div
                    key={integration.name}
                    className="flex items-center gap-4 p-4 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <div className={`h-9 w-9 rounded-lg bg-background border flex items-center justify-center`}>
                      <integration.icon className={`h-4 w-4 ${integration.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{integration.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{integration.detail}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusDot ok={integration.connected} />
                      <span className={`text-xs font-medium ${integration.connected ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                        {integration.connected ? "Conectado" : "Sin configurar"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                  Para conectar Gmail
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  Configurá las variables de entorno <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_ID</code> y{" "}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_SECRET</code> en el panel de secretos.
                  Luego ve a la sección Emails para autorizar el acceso.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Registros de Sincronización
              </CardTitle>
              <CardDescription>Historial de actualizaciones automáticas de datos.</CardDescription>
            </CardHeader>
            <CardContent>
              {!syncLogs ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                </div>
              ) : syncLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium">Sin sincronizaciones aún</p>
                  <p className="text-sm text-muted-foreground">Los registros aparecerán aquí automáticamente.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {syncLogs.slice(0, 20).map(log => (
                    <div
                      key={log.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-muted/20 text-sm"
                    >
                      <StatusDot ok={log.status === "success"} />
                      <span className="font-medium capitalize w-16 shrink-0">{log.module}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${log.status === "success"
                          ? "border-green-200 text-green-700 dark:border-green-800 dark:text-green-400"
                          : "border-red-200 text-red-700 dark:border-red-800 dark:text-red-400"}`}
                      >
                        {log.status}
                      </Badge>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {log.itemsNew} nuevos / {log.itemsFound} encontrados
                      </span>
                      {log.durationMs && (
                        <span className="text-muted-foreground text-xs shrink-0">{log.durationMs}ms</span>
                      )}
                      {log.errorMessage && (
                        <span className="text-destructive text-xs truncate flex-1">{log.errorMessage}</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {timeAgo(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-4 w-4" />
                Registros de Descarte
              </CardTitle>
              <CardDescription>
                Ítems descartados automáticamente por calidad insuficiente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!discardLogs ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                </div>
              ) : discardLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CheckCircle2 className="h-9 w-9 text-emerald-500 mb-3" />
                  <p className="font-medium">Sin descartes</p>
                  <p className="text-sm text-muted-foreground">Todos los ítems ingresados superaron el umbral de calidad.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {discardLogs.slice(0, 50).map(log => (
                    <div
                      key={log.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 rounded-lg border bg-muted/20 text-sm"
                    >
                      <Badge variant="outline" className="text-[10px] shrink-0 capitalize w-fit">{log.module}</Badge>
                      <span className="text-xs text-muted-foreground shrink-0">{log.source}</span>
                      <span className="text-xs flex-1 truncate font-medium" title={log.title}>{log.title || "—"}</span>
                      <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">{log.reason}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                        {timeAgo(log.discardedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
