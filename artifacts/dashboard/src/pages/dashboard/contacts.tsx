import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, MessageSquare, Edit2, Phone, Mail, User, Shield, Eye,
  CheckCircle, XCircle, RefreshCw,
} from "lucide-react";
import { useCurrentUser, isAdmin } from "@/hooks/use-current-user";
import { apiGet, apiPatch, apiPost } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface UserProfile {
  id: number;
  userId: number;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  area: string | null;
}

interface Contact {
  id: number;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  isBlocked: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  profile: UserProfile | null;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Visualizador",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  editor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  viewer: "bg-muted text-muted-foreground",
};

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function Avatar({ contact, size = "lg" }: { contact: Contact; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-16 w-16 text-lg" : "h-10 w-10 text-sm";
  if (contact.profile?.avatarUrl) {
    return (
      <img
        src={contact.profile.avatarUrl}
        alt={contact.name ?? contact.email}
        className={`${dim} rounded-full object-cover ring-2 ring-background`}
      />
    );
  }
  const initials = getInitials(contact.name, contact.email);
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500",
    "bg-amber-500", "bg-rose-500", "bg-cyan-500",
  ];
  const color = colors[contact.id % colors.length];
  return (
    <div className={`${dim} rounded-full ${color} text-white font-semibold flex items-center justify-center ring-2 ring-background`}>
      {initials}
    </div>
  );
}

interface EditForm {
  name: string;
  phone: string;
  bio: string;
  avatarUrl: string;
  area: string;
}

function EditDialog({
  contact, open, onClose, isAdminUser,
}: {
  contact: Contact;
  open: boolean;
  onClose: () => void;
  isAdminUser: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const isOwn = me?.id === contact.id;

  const [form, setForm] = useState<EditForm>({
    name: contact.name ?? "",
    phone: contact.profile?.phone ?? "",
    bio: contact.profile?.bio ?? "",
    avatarUrl: contact.profile?.avatarUrl ?? "",
    area: contact.profile?.area ?? "",
  });

  const mutation = useMutation({
    mutationFn: async (data: EditForm) => {
      if (isOwn) {
        await apiPatch(`/api/contacts/me`, {
          phone: data.phone,
          bio: data.bio,
          avatarUrl: data.avatarUrl,
          area: data.area,
        });
        if (isAdminUser && data.name !== contact.name) {
          await apiPatch(`/api/contacts/${contact.id}`, { name: data.name });
        }
      } else if (isAdminUser) {
        await apiPatch(`/api/contacts/${contact.id}`, data);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast({ title: "Perfil actualizado" });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const canEdit = isOwn || isAdminUser;
  if (!canEdit) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isAdminUser && (
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nombre completo"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>Teléfono</Label>
            <Input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+54 299 000-0000"
            />
          </div>
          <div className="space-y-1">
            <Label>Área</Label>
            <Input
              value={form.area}
              onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
              placeholder="Ej: Contabilidad, Impuestos..."
            />
          </div>
          <div className="space-y-1">
            <Label>URL de avatar</Label>
            <Input
              value={form.avatarUrl}
              onChange={e => setForm(f => ({ ...f, avatarUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1">
            <Label>Breve descripción</Label>
            <Textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              placeholder="Sobre mí..."
              rows={3}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [, navigate] = useLocation();
  const { data: me } = useCurrentUser();
  const { toast } = useToast();

  const { data: contacts = [], isLoading, error, refetch } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => apiGet("/api/contacts"),
    staleTime: 30_000,
  });

  const startChat = async (contact: Contact) => {
    if (!me) return;
    try {
      const result = await apiPost<{ id: number }>(`/api/conversations`, { targetUserId: contact.id });
      navigate(`/dashboard/chat?conv=${result.id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      c.email.toLowerCase().includes(q) ||
      (c.profile?.area?.toLowerCase().includes(q) ?? false)
    );
  });

  const adminUser = isAdmin(me);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center gap-4 text-center">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">Error al cargar contactos</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contactos</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {contacts.length} usuario{contacts.length !== 1 ? "s" : ""} en el sistema
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, email o área..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <User className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {search ? "No se encontraron contactos con ese criterio" : "No hay contactos disponibles"}
          </p>
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Limpiar búsqueda
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(contact => {
            const isOwn = me?.id === contact.id;
            const canEdit = isOwn || adminUser;
            const status = contact.isBlocked
              ? { label: "Bloqueado", cls: "bg-destructive/10 text-destructive" }
              : contact.isActive
              ? { label: "Activo", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" }
              : { label: "Inactivo", cls: "bg-muted text-muted-foreground" };

            return (
              <Card
                key={contact.id}
                className="group relative hover:shadow-md transition-shadow duration-200"
              >
                {isOwn && (
                  <div className="absolute top-3 right-3">
                    <Badge variant="outline" className="text-xs">Tú</Badge>
                  </div>
                )}
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <Avatar contact={contact} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm leading-tight truncate">
                        {contact.name ?? "(Sin nombre)"}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge className={cn("text-xs px-1.5 py-0", ROLE_COLORS[contact.role] ?? ROLE_COLORS.viewer)}>
                          {ROLE_LABELS[contact.role] ?? contact.role}
                        </Badge>
                        <Badge className={cn("text-xs px-1.5 py-0", status.cls)}>
                          {status.label}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {contact.profile?.area && (
                    <p className="text-xs text-muted-foreground font-medium">{contact.profile.area}</p>
                  )}

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </div>
                    {contact.profile?.phone ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span>{contact.profile.phone}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground/50">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span className="italic">Sin teléfono</span>
                      </div>
                    )}
                  </div>

                  {contact.profile?.bio && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {contact.profile.bio}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    {!isOwn && (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1 h-8 text-xs"
                        onClick={() => startChat(contact)}
                      >
                        <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                        Mensaje
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5"
                        onClick={() => setEditing(contact)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditDialog
          contact={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          isAdminUser={adminUser}
        />
      )}
    </div>
  );
}
