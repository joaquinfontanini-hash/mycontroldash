import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Shield, Users, CheckCircle2, XCircle, Activity,
  Mail, CloudSun, Newspaper, Briefcase, MoreHorizontal, Clock,
  Trash2, Lock, Unlock, Crown, LayoutDashboard, Search,
  AlertTriangle, FileText, ToggleLeft, ToggleRight, Filter,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser, isSuperAdmin, isAdmin } from "@/hooks/use-current-user";
import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface SyncStatus {
  weather?: { lastSync: string; status: string };
  news?: { lastSync: string; status: string };
  fiscal?: { lastSync: string; status: string };
}

interface SyncLog {
  id: number; module: string; status: string; itemsFound: number;
  itemsNew: number; durationMs: number; createdAt: string; errorMessage?: string;
}

interface DiscardLog {
  id: number; module: string; source: string; title: string;
  sourceUrl?: string | null; reason: string; discardedAt: string;
}

interface Module {
  id: number; key: string; name: string; description: string | null;
  isActive: boolean; allowedRoles: string[]; orderIndex: number;
}

interface SecurityLog {
  id: number; actorEmail: string | null; targetEmail: string | null;
  action: string; module: string | null; result: string;
  metadata: Record<string, unknown> | null; ipAddress: string | null;
  createdAt: string;
}

interface UserRecord {
  id: number; clerkId: string; email: string; name: string | null;
  role: string; isActive: boolean; isBlocked: boolean;
  blockedAt: string | null; blockedReason: string | null;
  lastActivityAt: string | null; createdAt: string;
}

const ROLES = ["super_admin", "admin", "editor", "viewer"] as const;
type Role = typeof ROLES[number];

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_BADGE: Record<string, string> = {
  super_admin: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700",
  admin: "bg-primary/10 text-primary border-primary/30",
  editor: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  viewer: "bg-muted text-muted-foreground border-muted",
};

const ACTION_LABELS: Record<string, string> = {
  user_registered: "Registro de usuario",
  user_updated: "Actualización de usuario",
  user_blocked: "Usuario bloqueado",
  user_unblocked: "Usuario desbloqueado",
  user_promoted_super_admin: "Promovido a super admin",
  module_activated: "Módulo activado",
  module_deactivated: "Módulo desactivado",
  module_roles_updated: "Roles de módulo actualizados",
};

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />;
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

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_BADGE[role] ?? ROLE_BADGE.viewer}`}>
      {role === "super_admin" && <Crown className="h-3 w-3" />}
      {role === "admin" && <Shield className="h-3 w-3" />}
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function UserStatusBadge({ user }: { user: UserRecord }) {
  if (user.isBlocked) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400">
      <Lock className="h-3 w-3" /> Bloqueado
    </span>
  );
  if (!user.isActive) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400">
      <XCircle className="h-3 w-3" /> Inactivo
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" /> Activo
    </span>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const { data: users, isLoading: usersLoading, error } = useListUsers();
  const updateUser = useUpdateUser();

  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [blockTarget, setBlockTarget] = useState<UserRecord | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [logAction, setLogAction] = useState("");
  const [logEmail, setLogEmail] = useState("");
  const [logResult, setLogResult] = useState("all");

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["sync-status"],
    queryFn: () => fetch(`${BASE}/api/sync/status`).then(r => r.ok ? r.json() : {}),
    refetchInterval: 60_000,
  });

  const { data: syncLogs } = useQuery<SyncLog[]>({
    queryKey: ["sync-logs"],
    queryFn: () => fetch(`${BASE}/api/sync/logs`).then(r => r.ok ? r.json() : []),
    refetchInterval: 60_000,
  });

  const { data: discardLogs } = useQuery<DiscardLog[]>({
    queryKey: ["discard-logs"],
    queryFn: () => fetch(`${BASE}/api/fiscal/discards`).then(r => r.ok ? r.json() : []),
    refetchInterval: 300_000,
  });

  const { data: gmailStatus } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["gmail-status"],
    queryFn: () => fetch(`${BASE}/api/emails/oauth/status`).then(r => r.ok ? r.json() : { connected: false }),
  });

  const { data: modules = [], isLoading: modulesLoading } = useQuery<Module[]>({
    queryKey: ["modules"],
    queryFn: () => fetch(`${BASE}/api/modules`).then(r => r.ok ? r.json() : []),
  });

  const securityLogsParams = new URLSearchParams();
  if (logAction) securityLogsParams.set("action", logAction);
  if (logEmail) securityLogsParams.set("email", logEmail);
  if (logResult !== "all") securityLogsParams.set("result", logResult);

  const { data: securityLogs = [], isLoading: secLogsLoading } = useQuery<SecurityLog[]>({
    queryKey: ["security-logs", logAction, logEmail, logResult],
    queryFn: () => fetch(`${BASE}/api/security-logs?${securityLogsParams}`).then(r => r.ok ? r.json() : []),
  });

  const toggleModuleMutation = useMutation({
    mutationFn: (key: string) =>
      fetch(`${BASE}/api/modules/${key}/toggle`, { method: "PUT" }).then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["modules"] });
      toast({ title: data.isActive ? "Módulo activado" : "Módulo desactivado", description: data.name });
    },
    onError: () => toast({ title: "Error al cambiar módulo", variant: "destructive" }),
  });

  const blockMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      fetch(`${BASE}/api/users/${id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      qc.invalidateQueries({ queryKey: ["security-logs"] });
      toast({ title: "Usuario bloqueado" });
      setBlockTarget(null);
      setBlockReason("");
    },
    onError: () => toast({ title: "Error al bloquear", variant: "destructive" }),
  });

  const unblockMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/users/${id}/unblock`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      qc.invalidateQueries({ queryKey: ["security-logs"] });
      toast({ title: "Usuario desbloqueado" });
    },
    onError: () => toast({ title: "Error al desbloquear", variant: "destructive" }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: ["security-logs"] });
  };

  const handleRoleChange = (id: number, role: string) => {
    updateUser.mutate({ id, data: { role } as any }, { onSuccess: invalidate });
  };

  const handleToggleActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, { onSuccess: invalidate });
  };

  const filteredUsers = (users as UserRecord[] | undefined)?.filter(u => {
    const matchSearch = !userSearch || u.email.includes(userSearch) || u.name?.toLowerCase().includes(userSearch.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  }) ?? [];

  const canManageUsers = isAdmin(me);
  const canPromoteSuperAdmin = isSuperAdmin(me);

  const integrations = [
    { name: "Gmail / Email", icon: Mail, connected: gmailStatus?.connected ?? false, detail: gmailStatus?.connected ? (gmailStatus.email ?? "Conectado") : "Sin configurar", color: "text-red-500" },
    { name: "Open-Meteo (Clima)", icon: CloudSun, connected: true, detail: syncStatus?.weather ? `Último sync: ${timeAgo(syncStatus.weather.lastSync)}` : "Activo", color: "text-blue-500" },
    { name: "Noticias RSS", icon: Newspaper, connected: true, detail: syncStatus?.news ? `Último sync: ${timeAgo(syncStatus.news.lastSync)}` : "Activo", color: "text-purple-500" },
    { name: "Monitor Fiscal / AFIP", icon: Briefcase, connected: true, detail: syncStatus?.fiscal ? `Último sync: ${timeAgo(syncStatus.fiscal.lastSync)}` : "Activo", color: "text-amber-500" },
  ];

  const totalUsers = (users as UserRecord[] | undefined)?.length ?? 0;
  const activeUsers = (users as UserRecord[] | undefined)?.filter(u => u.isActive && !u.isBlocked).length ?? 0;
  const adminCount = (users as UserRecord[] | undefined)?.filter(u => ["admin", "super_admin"].includes(u.role)).length ?? 0;
  const blockedCount = (users as UserRecord[] | undefined)?.filter(u => u.isBlocked).length ?? 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Administración</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Control de acceso, módulos, usuarios y auditoría de seguridad.
          {me && <span className="ml-2 font-medium text-foreground">— {ROLE_LABEL[me.role] ?? me.role}</span>}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          { label: "Total usuarios", value: totalUsers, icon: Users, color: "" },
          { label: "Activos", value: activeUsers, icon: CheckCircle2, color: "text-emerald-500" },
          { label: "Admins", value: adminCount, icon: Shield, color: "text-primary" },
          { label: "Bloqueados", value: blockedCount, icon: Lock, color: blockedCount > 0 ? "text-red-500" : "" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <s.icon className={`h-4 w-4 ${s.color || "text-muted-foreground"}`} />
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1.5" />Usuarios</TabsTrigger>
          <TabsTrigger value="modules"><LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />Módulos</TabsTrigger>
          <TabsTrigger value="security-logs"><FileText className="h-3.5 w-3.5 mr-1.5" />Auditoría</TabsTrigger>
          <TabsTrigger value="integrations"><Activity className="h-3.5 w-3.5 mr-1.5" />Integraciones</TabsTrigger>
          <TabsTrigger value="sync"><Clock className="h-3.5 w-3.5 mr-1.5" />Sincronización</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-0 space-y-4">
          {!canManageUsers && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Solo administradores pueden gestionar usuarios.
            </div>
          )}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Gestión de Usuarios
              </CardTitle>
              <CardDescription>Control de roles, acceso y estado de cada usuario.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Buscar por email o nombre..." className="pl-9 h-8 text-sm"
                    value={userSearch} onChange={e => setUserSearch(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  {["all", ...ROLES].map(r => (
                    <button key={r} onClick={() => setRoleFilter(r)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${roleFilter === r ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}>
                      {r === "all" ? "Todos" : ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>

              {usersLoading ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
              ) : error ? (
                <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                  <XCircle className="h-5 w-5 shrink-0" /> Error al cargar usuarios.
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium">Sin resultados</p>
                  <p className="text-sm text-muted-foreground">Probá con otro filtro o búsqueda.</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Última actividad</TableHead>
                        {canManageUsers && <TableHead className="text-right">Acciones</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map(user => (
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
                                {user.blockedReason && (
                                  <p className="text-xs text-red-500 mt-0.5">Motivo: {user.blockedReason}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><RoleBadge role={user.role} /></TableCell>
                          <TableCell><UserStatusBadge user={user} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {user.lastActivityAt ? timeAgo(user.lastActivityAt) : "—"}
                          </TableCell>
                          {canManageUsers && (
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel className="text-xs text-muted-foreground">Cambiar rol</DropdownMenuLabel>
                                  {ROLES.filter(r => r !== "super_admin" || canPromoteSuperAdmin).map(r => (
                                    <DropdownMenuItem key={r} onClick={() => handleRoleChange(user.id, r)}
                                      disabled={user.role === r}>
                                      {r === "super_admin" && <Crown className="h-3.5 w-3.5 mr-2 text-amber-500" />}
                                      {r === "admin" && <Shield className="h-3.5 w-3.5 mr-2 text-primary" />}
                                      {ROLE_LABEL[r]}
                                      {user.role === r && " ✓"}
                                    </DropdownMenuItem>
                                  ))}
                                  <DropdownMenuSeparator />
                                  {user.isBlocked ? (
                                    <DropdownMenuItem className="text-emerald-600"
                                      onClick={() => unblockMutation.mutate(user.id)}>
                                      <Unlock className="h-3.5 w-3.5 mr-2" /> Desbloquear
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem className="text-red-500"
                                      onClick={() => setBlockTarget(user)}>
                                      <Lock className="h-3.5 w-3.5 mr-2" /> Bloquear
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    className={user.isActive ? "text-orange-500" : "text-emerald-600"}
                                    onClick={() => handleToggleActive(user.id, user.isActive)}>
                                    {user.isActive ? <><XCircle className="h-3.5 w-3.5 mr-2" /> Desactivar</> : <><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Activar</>}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="modules" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutDashboard className="h-4 w-4" /> Módulos del Sistema
              </CardTitle>
              <CardDescription>
                Activá o desactivá módulos. Los módulos inactivos no aparecen en el menú y sus rutas quedan bloqueadas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {modulesLoading ? (
                <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
              ) : (
                <div className="space-y-2">
                  {modules.map(mod => (
                    <div key={mod.key} className={`flex items-center gap-4 p-3.5 rounded-lg border transition-colors ${mod.isActive ? "bg-card" : "bg-muted/30 opacity-70"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{mod.name}</span>
                          {mod.isActive
                            ? <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]">Activo</Badge>
                            : <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>
                          }
                        </div>
                        {mod.description && <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {mod.allowedRoles.map(r => (
                            <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{r}</span>
                          ))}
                        </div>
                      </div>
                      {canManageUsers && (
                        <button
                          onClick={() => toggleModuleMutation.mutate(mod.key)}
                          disabled={toggleModuleMutation.isPending}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          title={mod.isActive ? "Desactivar módulo" : "Activar módulo"}
                        >
                          {mod.isActive
                            ? <ToggleRight className="h-7 w-7 text-emerald-500" />
                            : <ToggleLeft className="h-7 w-7" />
                          }
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security-logs" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Auditoría de Seguridad
              </CardTitle>
              <CardDescription>Registro de todas las acciones de seguridad y administración.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Filtrar por email..." className="pl-9 h-8 text-sm"
                    value={logEmail} onChange={e => setLogEmail(e.target.value)} />
                </div>
                <Input placeholder="Acción (ej: user_blocked)..." className="h-8 text-sm flex-1"
                  value={logAction} onChange={e => setLogAction(e.target.value)} />
                <div className="flex gap-2">
                  {["all", "success", "failure"].map(r => (
                    <button key={r} onClick={() => setLogResult(r)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${logResult === r ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}>
                      {r === "all" ? "Todos" : r === "success" ? "OK" : "Error"}
                    </button>
                  ))}
                </div>
              </div>

              {secLogsLoading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
              ) : securityLogs.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <FileText className="h-9 w-9 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">Sin logs registrados con esos filtros.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {securityLogs.map(log => (
                    <div key={log.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border bg-muted/20 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${log.result === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="font-medium shrink-0">{ACTION_LABELS[log.action] ?? log.action}</span>
                      {log.actorEmail && <span className="text-muted-foreground shrink-0">por <span className="font-mono">{log.actorEmail}</span></span>}
                      {log.targetEmail && <span className="text-muted-foreground shrink-0">→ <span className="font-mono">{log.targetEmail}</span></span>}
                      {log.module && <Badge variant="outline" className="text-[10px] shrink-0">{log.module}</Badge>}
                      {log.ipAddress && <span className="text-muted-foreground/60 font-mono shrink-0">{log.ipAddress}</span>}
                      <span className="ml-auto text-muted-foreground shrink-0">{timeAgo(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" /> Estado de Integraciones
              </CardTitle>
              <CardDescription>Servicios externos conectados al dashboard.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {integrations.map(integration => (
                  <div key={integration.name} className="flex items-center gap-4 p-4 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors">
                    <div className="h-9 w-9 rounded-lg bg-background border flex items-center justify-center">
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
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">Para conectar Gmail</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  Configurá <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_ID</code> y{" "}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_SECRET</code> en el panel de secretos. Luego ir a Emails para autorizar.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" /> Registros de Sincronización
              </CardTitle>
              <CardDescription>Historial de actualizaciones automáticas de datos.</CardDescription>
            </CardHeader>
            <CardContent>
              {!syncLogs ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
              ) : syncLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium">Sin sincronizaciones aún</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {syncLogs.slice(0, 30).map(log => (
                    <div key={log.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-muted/20 text-sm">
                      <StatusDot ok={log.status === "success"} />
                      <span className="font-medium capitalize w-16 shrink-0">{log.module}</span>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${log.status === "success" ? "border-green-200 text-green-700 dark:border-green-800 dark:text-green-400" : "border-red-200 text-red-700"}`}>
                        {log.status}
                      </Badge>
                      <span className="text-muted-foreground shrink-0 text-xs">{log.itemsNew} nuevos / {log.itemsFound} encontrados</span>
                      {log.durationMs && <span className="text-muted-foreground text-xs shrink-0">{log.durationMs}ms</span>}
                      {log.errorMessage && <span className="text-destructive text-xs truncate flex-1">{log.errorMessage}</span>}
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{timeAgo(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-4 w-4" /> Registros de Descarte
              </CardTitle>
              <CardDescription>Ítems descartados automáticamente por calidad insuficiente.</CardDescription>
            </CardHeader>
            <CardContent>
              {!discardLogs ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
              ) : discardLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CheckCircle2 className="h-9 w-9 text-emerald-500 mb-3" />
                  <p className="font-medium">Sin descartes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {discardLogs.slice(0, 50).map(log => (
                    <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 rounded-lg border bg-muted/20 text-sm">
                      <Badge variant="outline" className="text-[10px] shrink-0 capitalize w-fit">{log.module}</Badge>
                      <span className="text-xs text-muted-foreground shrink-0">{log.source}</span>
                      <span className="text-xs flex-1 truncate font-medium">{log.title || "—"}</span>
                      <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">{log.reason}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-auto">{timeAgo(log.discardedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!blockTarget} onOpenChange={open => { if (!open) { setBlockTarget(null); setBlockReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-red-500" /> Bloquear usuario
            </DialogTitle>
            <DialogDescription>
              El usuario <strong>{blockTarget?.email}</strong> no podrá acceder al sistema. Podés desbloquearlo en cualquier momento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Motivo del bloqueo (opcional)</label>
            <Input placeholder="Ej: Acceso no autorizado, cuenta comprometida..." value={blockReason} onChange={e => setBlockReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBlockTarget(null); setBlockReason(""); }}>Cancelar</Button>
            <Button variant="destructive" onClick={() => blockTarget && blockMutation.mutate({ id: blockTarget.id, reason: blockReason })}
              disabled={blockMutation.isPending}>
              <Lock className="h-3.5 w-3.5 mr-1.5" /> Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
