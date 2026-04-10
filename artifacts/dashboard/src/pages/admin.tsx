import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

const ROLE_COLORS = {
  admin: "bg-primary/10 text-primary border-primary/20",
  editor: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  viewer: "bg-muted text-muted-foreground border-muted",
};

export default function AdminPage() {
  const { data: users, isLoading, error } = useListUsers();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const handleRoleChange = (id: number, role: "admin" | "editor" | "viewer") => {
    updateUser.mutate({ id, data: { role } }, { onSuccess: invalidate });
  };

  const handleToggleActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, { onSuccess: invalidate });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar datos.</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Administración</h1>
        <p className="text-muted-foreground mt-1 text-sm">Gestión de usuarios y accesos de la plataforma.</p>
      </div>

      <div className="grid gap-4 grid-cols-3">
        {[
          { label: "Total usuarios", value: users?.length ?? 0 },
          { label: "Activos", value: users?.filter(u => u.isActive).length ?? 0 },
          { label: "Admins", value: users?.filter(u => u.role === "admin").length ?? 0 },
        ].map(s => (
          <div key={s.label} className="rounded-xl border bg-card p-4 text-center">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4.5 w-4.5" />
            Gestión de Usuarios
          </CardTitle>
          <CardDescription>Controlá el acceso y los roles de cada usuario registrado.</CardDescription>
        </CardHeader>
        <CardContent>
          {users?.length === 0 ? (
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
    </div>
  );
}
