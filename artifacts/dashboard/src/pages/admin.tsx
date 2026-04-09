import { useListUsers } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Users, UserCog } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function AdminPage() {
  const { data: users, isLoading, error } = useListUsers();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar datos de administración.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Administración</h1>
        <p className="text-muted-foreground mt-1">Gestión de plataforma y usuarios.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Gestión de Usuarios
          </CardTitle>
          <CardDescription>Administra el acceso y roles de los usuarios del dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                    No se encontraron usuarios.
                  </TableCell>
                </TableRow>
              ) : (
                users?.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name || 'Sin nombre'}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'outline' : 'destructive'} className={user.isActive ? 'bg-green-50 text-green-700 border-green-200' : ''}>
                        {user.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon">
                        <UserCog className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
