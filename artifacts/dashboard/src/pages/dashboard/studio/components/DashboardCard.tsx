import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Eye, Pencil, Star, Archive, RotateCcw, Copy, Trash2,
  MoreVertical, Share2, LayoutGrid,
} from "lucide-react";
import type { Dashboard } from "../types";

interface DashboardCardProps {
  dashboard: Dashboard;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onToggleFavorite: (dash: Dashboard) => void;
  onArchive: (id: number) => void;
  onRestore: (id: number) => void;
  onDuplicate: (id: number) => void;
  onDelete: (dash: Dashboard) => void;
  onShare: (dash: Dashboard) => void;
  viewMode: "grid" | "list";
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active:   { label: "Activo",    variant: "default" },
  draft:    { label: "Borrador",  variant: "secondary" },
  archived: { label: "Archivado", variant: "outline" },
};

export function DashboardCard({
  dashboard: dash,
  onView, onEdit, onToggleFavorite, onArchive, onRestore,
  onDuplicate, onDelete, onShare, viewMode,
}: DashboardCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const status = STATUS_LABELS[dash.status] ?? { label: dash.status, variant: "secondary" };
  const isArchived = dash.status === "archived";

  const handleDelete = () => {
    setDeleteOpen(false);
    onDelete(dash);
  };

  if (viewMode === "list") {
    return (
      <>
        <div className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors group">
          <span className="text-3xl flex-shrink-0">{dash.icon ?? "📊"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{dash.name}</h3>
              <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
              {dash.category && <Badge variant="outline" className="text-xs capitalize">{dash.category}</Badge>}
              {dash.isFavorite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
            </div>
            {dash.description && <p className="text-sm text-muted-foreground truncate mt-0.5">{dash.description}</p>}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="sm" onClick={() => onView(dash.id)}>
              <Eye className="h-4 w-4" />
            </Button>
            {!isArchived && !dash.isSystem && (
              <Button variant="ghost" size="sm" onClick={() => onEdit(dash.id)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <DashboardMenu dash={dash} isArchived={isArchived}
              onToggleFavorite={onToggleFavorite} onArchive={onArchive} onRestore={onRestore}
              onDuplicate={onDuplicate} onShare={onShare} onDelete={() => setDeleteOpen(true)} />
          </div>
        </div>
        <DeleteConfirmDialog open={deleteOpen} name={dash.name} onConfirm={handleDelete} onCancel={() => setDeleteOpen(false)} />
      </>
    );
  }

  return (
    <>
      <Card className="group hover:shadow-md transition-all cursor-pointer relative overflow-hidden" onClick={() => onView(dash.id)}>
        {/* Color accent bar */}
        {dash.color && (
          <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: dash.color }} />
        )}

        <CardHeader className="pt-5 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{dash.icon ?? "📊"}</span>
              <div>
                <CardTitle className="text-base leading-tight">{dash.name}</CardTitle>
                {dash.category && (
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{dash.category}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              {dash.isFavorite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 flex-shrink-0" />}
              <DashboardMenu dash={dash} isArchived={isArchived}
                onToggleFavorite={onToggleFavorite} onArchive={onArchive} onRestore={onRestore}
                onDuplicate={onDuplicate} onShare={onShare} onDelete={() => setDeleteOpen(true)} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {dash.description && (
            <CardDescription className="text-xs line-clamp-2 mb-3">{dash.description}</CardDescription>
          )}
          <div className="flex items-center justify-between">
            <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              {!isArchived && !dash.isSystem && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEdit(dash.id)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onView(dash.id)}>
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DeleteConfirmDialog open={deleteOpen} name={dash.name} onConfirm={handleDelete} onCancel={() => setDeleteOpen(false)} />
    </>
  );
}

function DashboardMenu({
  dash, isArchived,
  onToggleFavorite, onArchive, onRestore, onDuplicate, onShare, onDelete,
}: {
  dash: Dashboard;
  isArchived: boolean;
  onToggleFavorite: (d: Dashboard) => void;
  onArchive: (id: number) => void;
  onRestore: (id: number) => void;
  onDuplicate: (id: number) => void;
  onShare: (d: Dashboard) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onToggleFavorite(dash)}>
          <Star className="mr-2 h-4 w-4" />
          {dash.isFavorite ? "Quitar favorito" : "Marcar favorito"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onShare(dash)}>
          <Share2 className="mr-2 h-4 w-4" />
          Compartir
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDuplicate(dash.id)}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isArchived ? (
          <DropdownMenuItem onClick={() => onRestore(dash.id)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Restaurar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onArchive(dash.id)}>
            <Archive className="mr-2 h-4 w-4" />
            Archivar
          </DropdownMenuItem>
        )}
        {!dash.isSystem && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteConfirmDialog({
  open, name, onConfirm, onCancel,
}: { open: boolean; name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={v => { if (!v) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar "{name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Se eliminarán el dashboard y todos sus widgets.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
