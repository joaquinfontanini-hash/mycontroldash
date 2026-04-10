import { useState } from "react";
import {
  useListShortcuts, useCreateShortcut, useDeleteShortcut, getListShortcutsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Link2, ExternalLink, Plus, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATEGORY_COLORS: Record<string, string> = {
  "impositivo": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "financiero": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "institucional": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "laboral": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "herramientas": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export default function ShortcutsPage() {
  const { data: shortcuts, isLoading, error } = useListShortcuts();
  const createShortcut = useCreateShortcut();
  const deleteShortcut = useDeleteShortcut();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", category: "" });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListShortcutsQueryKey() });

  const handleCreate = () => {
    if (!form.name.trim() || !form.url.trim()) return;
    const url = form.url.startsWith("http") ? form.url : `https://${form.url}`;
    createShortcut.mutate(
      { data: { name: form.name, url, category: form.category || undefined } },
      {
        onSuccess: () => {
          invalidate();
          setCreateOpen(false);
          setForm({ name: "", url: "", category: "" });
        },
      },
    );
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteShortcut.mutate({ id }, { onSuccess: invalidate });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar accesos directos.</div>;
  }

  const categories = [...new Set((shortcuts ?? []).map(s => s.category).filter(Boolean))];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Accesos Directos</h1>
          <p className="text-muted-foreground mt-1 text-sm">{shortcuts?.length ?? 0} enlaces configurados</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Enlace
        </Button>
      </div>

      {shortcuts?.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Link2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin accesos directos</h3>
          <p className="text-muted-foreground text-sm mb-4">Agregá tus sitios más usados para acceso rápido.</p>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Agregar primer enlace
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.length > 0 ? (
            categories.map(cat => {
              const items = shortcuts?.filter(s => s.category === cat) ?? [];
              return (
                <div key={cat}>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${CATEGORY_COLORS[cat!] ?? "bg-muted text-muted-foreground"}`}>
                      {cat}
                    </span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {items.map(s => (
                      <ShortcutCard key={s.id} shortcut={s} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {shortcuts?.map(s => (
                <ShortcutCard key={s.id} shortcut={s} onDelete={handleDelete} />
              ))}
            </div>
          )}

          {shortcuts?.filter(s => !s.category).length > 0 && categories.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Otros</h2>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {shortcuts?.filter(s => !s.category).map(s => (
                  <ShortcutCard key={s.id} shortcut={s} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Acceso Directo</DialogTitle>
            <DialogDescription>Agregá un sitio web para acceso rápido desde el panel.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sc-name">Nombre *</Label>
              <Input
                id="sc-name"
                placeholder="Ej: AFIP"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-url">URL *</Label>
              <Input
                id="sc-url"
                placeholder="Ej: afip.gob.ar"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-cat">Categoría</Label>
              <Input
                id="sc-cat"
                placeholder="Ej: impositivo, financiero..."
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreate}
              disabled={!form.name.trim() || !form.url.trim() || createShortcut.isPending}
            >
              {createShortcut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutCard({
  shortcut,
  onDelete,
}: {
  shortcut: { id: number; name: string; url: string; category?: string | null };
  onDelete: (e: React.MouseEvent, id: number) => void;
}) {
  return (
    <a
      href={shortcut.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <Card className="h-full card-hover border hover:border-primary/50">
        <CardContent className="p-4 flex flex-col items-center text-center gap-3 relative">
          <button
            onClick={e => onDelete(e, shortcut.id)}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Globe className="h-5 w-5 text-primary group-hover:text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{shortcut.name}</p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{getDomain(shortcut.url)}</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
        </CardContent>
      </Card>
    </a>
  );
}
