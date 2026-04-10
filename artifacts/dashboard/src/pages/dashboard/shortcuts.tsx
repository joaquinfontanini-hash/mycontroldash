import { useState } from "react";
import {
  useListShortcuts, useCreateShortcut, useDeleteShortcut, getListShortcutsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Link2, ExternalLink, Plus, Trash2, Globe, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";

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

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function isValidUrl(url: string): boolean {
  try {
    const normalized = normalizeUrl(url);
    new URL(normalized);
    return true;
  } catch {
    return false;
  }
}

interface FormErrors {
  name?: string;
  url?: string;
}

function validateShortcutForm(form: { name: string; url: string }): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) {
    errors.name = "El nombre es obligatorio.";
  } else if (form.name.trim().length > 80) {
    errors.name = "El nombre no puede superar 80 caracteres.";
  }
  if (!form.url.trim()) {
    errors.url = "La URL es obligatoria.";
  } else if (!isValidUrl(form.url)) {
    errors.url = "Ingresá una URL válida (ej: afip.gob.ar).";
  }
  return errors;
}

export default function ShortcutsPage() {
  const { data: shortcuts, isLoading, error } = useListShortcuts();
  const createShortcut = useCreateShortcut();
  const deleteShortcut = useDeleteShortcut();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", category: "" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListShortcutsQueryKey() });

  const handleCreate = () => {
    const errors = validateShortcutForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const url = normalizeUrl(form.url);
    createShortcut.mutate(
      { data: { name: form.name.trim(), url, category: form.category.trim() || undefined } },
      {
        onSuccess: () => {
          invalidate();
          handleCloseDialog(false);
        },
      },
    );
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteShortcut.mutate({ id }, { onSuccess: invalidate });
  };

  const handleCloseDialog = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setForm({ name: "", url: "", category: "" });
      setFormErrors({});
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Error al cargar los accesos directos.
      </div>
    );
  }

  const allShortcuts = shortcuts ?? [];
  const categories = [...new Set(allShortcuts.map(s => s.category).filter(Boolean))];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Accesos Directos</h1>
          <p className="text-muted-foreground mt-1 text-sm">{allShortcuts.length} enlace{allShortcuts.length !== 1 ? "s" : ""} configurado{allShortcuts.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Enlace
        </Button>
      </div>

      {allShortcuts.length === 0 ? (
        <Empty className="border-2 border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 />
            </EmptyMedia>
            <EmptyTitle>Sin accesos directos</EmptyTitle>
            <EmptyDescription>
              Agregá tus sitios más usados para acceso rápido desde el panel.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar primer enlace
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-6">
          {categories.length > 0 ? (
            <>
              {categories.map(cat => {
                const items = allShortcuts.filter(s => s.category === cat);
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
              })}
              {allShortcuts.filter(s => !s.category).length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Otros</h2>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {allShortcuts.filter(s => !s.category).map(s => (
                      <ShortcutCard key={s.id} shortcut={s} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {allShortcuts.map(s => (
                <ShortcutCard key={s.id} shortcut={s} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={handleCloseDialog}>
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
                onChange={e => {
                  setForm(f => ({ ...f, name: e.target.value }));
                  if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }));
                }}
                className={formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {formErrors.name && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {formErrors.name}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-url">URL *</Label>
              <Input
                id="sc-url"
                placeholder="Ej: afip.gob.ar"
                value={form.url}
                onChange={e => {
                  setForm(f => ({ ...f, url: e.target.value }));
                  if (formErrors.url) setFormErrors(prev => ({ ...prev, url: undefined }));
                }}
                className={formErrors.url ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {formErrors.url && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {formErrors.url}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-cat">Categoría <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input
                id="sc-cat"
                placeholder="Ej: impositivo, financiero..."
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Los atajos sin categoría aparecen al final.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleCloseDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createShortcut.isPending}>
              {createShortcut.isPending ? (
                <>
                  <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Guardando...
                </>
              ) : "Guardar"}
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
    <a href={shortcut.url} target="_blank" rel="noopener noreferrer" className="block group">
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
