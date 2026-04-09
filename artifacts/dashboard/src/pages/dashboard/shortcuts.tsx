import { useListShortcuts } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { LinkIcon, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ShortcutsPage() {
  const { data: shortcuts, isLoading, error } = useListShortcuts();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar accesos directos.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Accesos Directos</h1>
          <p className="text-muted-foreground mt-1">Tus enlaces frecuentes.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Enlace
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {shortcuts?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <LinkIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No hay accesos directos</h3>
            <p className="text-muted-foreground">Añade enlaces importantes aquí.</p>
          </div>
        ) : (
          shortcuts?.map(shortcut => (
            <a 
              key={shortcut.id} 
              href={shortcut.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="block group"
            >
              <Card className="h-full hover:border-primary transition-colors">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="p-3 bg-primary/10 text-primary rounded-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <ExternalLink className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-medium">{shortcut.name}</h3>
                    {shortcut.category && <p className="text-xs text-muted-foreground">{shortcut.category}</p>}
                  </div>
                </CardContent>
              </Card>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
