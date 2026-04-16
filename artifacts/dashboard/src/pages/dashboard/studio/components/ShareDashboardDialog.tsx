import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, Eye, Pencil, Crown, Trash2, Loader2 } from "lucide-react";
import { BASE } from "@/lib/base-url";
import type { Dashboard } from "../types";

interface ShareDashboardDialogProps {
  dashboard: Dashboard | null;
  open: boolean;
  onClose: () => void;
}

const LEVEL_LABELS = {
  view:  { label: "Solo ver",   icon: <Eye className="h-3 w-3" />,    variant: "secondary" as const },
  edit:  { label: "Editar",     icon: <Pencil className="h-3 w-3" />, variant: "outline" as const },
  admin: { label: "Administrar",icon: <Crown className="h-3 w-3" />,  variant: "default" as const },
};

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Error desconocido");
  }
  return res.json();
}

export function ShareDashboardDialog({ dashboard, open, onClose }: ShareDashboardDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<"view" | "edit" | "admin">("view");

  const dashId = dashboard?.id;

  const { data: perms = [], isLoading } = useQuery({
    queryKey: ["studio-permissions", dashId],
    queryFn: () => apiFetch(`api/studio/dashboards/${dashId}/permissions`),
    enabled: open && !!dashId,
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      apiFetch(`api/studio/dashboards/${dashId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({
          op: "grant",
          subjectType: "user",
          subjectId: parseInt(userId),
          permissionLevel: level,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studio-permissions", dashId] });
      setUserId("");
      toast({ title: "Permiso otorgado correctamente" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (subjectId: number) =>
      apiFetch(`api/studio/dashboards/${dashId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ op: "revoke", subjectType: "user", subjectId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studio-permissions", dashId] });
      toast({ title: "Permiso revocado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canManage = dashboard?._access === "owner" || dashboard?._access === "admin";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Compartir "{dashboard?.name ?? ""}"
          </DialogTitle>
          <DialogDescription>
            Gestioná quién puede ver o editar este dashboard.
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Agregar acceso por ID de usuario</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="ID de usuario"
                  value={userId}
                  onChange={e => setUserId(e.target.value)}
                  className="flex-1"
                />
                <Select value={level} onValueChange={(v: any) => setLevel(v)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Solo ver</SelectItem>
                    <SelectItem value="edit">Editar</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={() => grantMutation.mutate()}
                disabled={!userId || isNaN(parseInt(userId)) || grantMutation.isPending}
                className="w-full"
              >
                {grantMutation.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
                  : "Dar acceso"
                }
              </Button>
            </div>
            <Separator />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Usuarios con acceso</span>
          </div>

          {isLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : perms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Solo vos tenés acceso a este dashboard.
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {(perms as Array<{
                id: number;
                subjectId: number;
                subjectType: string;
                permissionLevel: string;
                user?: { email?: string; name?: string } | null;
              }>).map(perm => {
                const lvl = LEVEL_LABELS[perm.permissionLevel as keyof typeof LEVEL_LABELS];
                return (
                  <div key={perm.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {perm.user?.name ?? perm.user?.email ?? `Usuario #${perm.subjectId}`}
                        </p>
                        {perm.user?.email && perm.user?.name && (
                          <p className="text-xs text-muted-foreground truncate">{perm.user.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {lvl && (
                        <Badge variant={lvl.variant} className="text-xs gap-1">
                          {lvl.icon} {lvl.label}
                        </Badge>
                      )}
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => revokeMutation.mutate(perm.subjectId)}
                          disabled={revokeMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
