import { useListFiscalUpdates, useGetFiscalMetrics } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, AlertTriangle, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function FiscalPage() {
  const { data: updates, isLoading: updatesLoading, error: updatesError } = useListFiscalUpdates();
  const { data: metrics, isLoading: metricsLoading } = useGetFiscalMetrics();

  if (updatesLoading || metricsLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (updatesError) {
    return <div className="text-destructive">Error al cargar monitor fiscal.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Monitor Fiscal</h1>
        <p className="text-muted-foreground mt-1">Actualizaciones normativas e impositivas.</p>
      </div>

      {metrics && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Total</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{metrics.total}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Alto Impacto</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-destructive">{metrics.highImpact}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-500">Requiere Acción</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-amber-500">{metrics.requiresAction}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Normativas</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{metrics.normative}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4">
        {updates?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Sin actualizaciones</h3>
            <p className="text-muted-foreground">No hay novedades fiscales recientes.</p>
          </div>
        ) : (
          updates?.map(update => (
            <Card key={update.id}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">{update.jurisdiction}</Badge>
                      <Badge variant="secondary">{update.organism}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(update.date).toLocaleDateString()}</span>
                    </div>
                    <CardTitle className="text-lg">{update.title}</CardTitle>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant={update.impact === 'high' ? 'destructive' : update.impact === 'medium' ? 'default' : 'secondary'}>
                      Impacto {update.impact}
                    </Badge>
                    {update.requiresAction && (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Acción requerida
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-4 rounded-md text-sm">
                  {update.summary}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
