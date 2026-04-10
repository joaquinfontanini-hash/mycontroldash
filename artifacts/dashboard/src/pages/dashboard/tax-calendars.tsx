import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, CheckCircle2, Clock, AlertTriangle, Trash2,
  Zap, RotateCcw, FolderOpen, CalendarCheck, Info, ShieldAlert,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface AnnualCalendar {
  id: number;
  name: string;
  year: number;
  status: "draft" | "active" | "archived";
  parseStatus: "pending" | "done" | "error";
  parseErrors: string | null;
  notes: string | null;
  uploadedFile: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UploadedFile {
  id: number;
  fileName: string;
  fileType: string;
  filePath: string | null;
  fileSize: number | null;
  year: number | null;
  status: string;
  parseStatus: string;
  parseErrors: string | null;
  calendarId: number | null;
  userId: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  archived: "Archivado",
};

const PARSE_LABEL: Record<string, string> = {
  pending: "Pendiente de revisión",
  done: "Procesado correctamente",
  error: "Error de procesamiento",
};

function calendarStatusBadge(status: string) {
  if (status === "active") return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400">Activo</Badge>;
  if (status === "archived") return <Badge variant="secondary" className="text-muted-foreground">Archivado</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Borrador</Badge>;
}

function parseStatusBadge(status: string) {
  if (status === "done") return (
    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm">
      <CheckCircle2 className="h-3.5 w-3.5" /> Procesado correctamente
    </span>
  );
  if (status === "error") return (
    <span className="flex items-center gap-1.5 text-red-500 text-sm">
      <AlertTriangle className="h-3.5 w-3.5" /> Error de procesamiento
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-amber-500 text-sm">
      <Clock className="h-3.5 w-3.5" /> Pendiente de revisión manual
    </span>
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function TaxCalendarsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [detailCalendar, setDetailCalendar] = useState<AnnualCalendar | null>(null);

  const { data: calendars = [], isLoading } = useQuery<AnnualCalendar[]>({
    queryKey: ["annual-calendars"],
    queryFn: () => fetch(`${BASE}/api/annual-calendars`).then(r => r.json()),
  });

  const hasActive = calendars.some(c => c.status === "active");

  const activateMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/annual-calendars/${id}/activate`, { method: "PUT" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annual-calendars"] });
      toast({ title: "Calendario activado", description: "Este calendario está activo y se usará para calcular vencimientos." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo activar el calendario.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/annual-calendars/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annual-calendars"] });
      toast({ title: "Calendario eliminado" });
    },
    onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/annual-calendars/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parseStatus: "pending", parseErrors: null }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annual-calendars"] });
      toast({ title: "Reprocesamiento solicitado", description: "El calendario quedó en estado pendiente de revisión." });
    },
  });

  const handleUpload = useCallback(async (file: File) => {
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel", "text/csv"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!allowed.includes(file.type) && !["pdf", "xlsx", "xls", "csv"].includes(ext ?? "")) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan archivos PDF, Excel o CSV.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/tax-calendars/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error al subir");
      }
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ["annual-calendars"] });
      toast({
        title: "Archivo subido correctamente",
        description: `"${data.calendar?.name}" registrado. Queda pendiente de revisión manual.`,
      });
    } catch (err: any) {
      toast({ title: "Error al subir el archivo", description: err.message ?? "Intente de nuevo.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [qc, toast]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Calendarios impositivos</h1>
        <p className="text-muted-foreground text-sm">
          Cargá el archivo de vencimientos fiscales anuales (AFIP / Rentas). El sistema lo usa para calcular vencimientos por CUIT e impuesto.
        </p>
      </div>

      {!hasActive && !isLoading && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <span className="font-semibold text-amber-600 dark:text-amber-400">Sin calendario activo</span>
            <span className="text-muted-foreground ml-1.5">
              No hay un calendario de vencimientos activo. Subí y activá uno para que el motor de AFIP calcule vencimientos automáticamente.
            </span>
          </div>
        </div>
      )}

      {hasActive && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CalendarCheck className="h-4 w-4 shrink-0" />
          <span className="font-medium">Calendario activo registrado.</span>
          <span className="text-muted-foreground">El motor de vencimientos lo usa para calcular fechas por CUIT e impuesto.</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Subir calendario anual
          </CardTitle>
          <CardDescription>
            Formatos aceptados: PDF (calendario impreso/escaneado) · Excel · CSV — máx. 50 MB
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all cursor-pointer
              ${isDragging ? "border-primary bg-primary/8 scale-[1.01]" : "border-border hover:border-primary/60 hover:bg-muted/40"}
              ${isUploading ? "pointer-events-none opacity-60" : ""}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileInput}
            />
            {isUploading ? (
              <>
                <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-sm font-medium text-muted-foreground">Subiendo archivo…</p>
              </>
            ) : (
              <>
                <div className={`rounded-full p-4 ${isDragging ? "bg-primary/15" : "bg-muted"}`}>
                  <FolderOpen className={`h-8 w-8 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold">
                    {isDragging ? "Soltá el archivo aquí" : "Arrastrá el archivo aquí"}
                  </p>
                  <p className="text-xs text-muted-foreground">o hacé clic para seleccionar desde tu computadora</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-1 pointer-events-none">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Seleccionar archivo
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Calendarios cargados</h2>
          <span className="text-xs text-muted-foreground">{calendars.length} {calendars.length === 1 ? "registro" : "registros"}</span>
        </div>

        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2].map(i => (
              <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && calendars.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No hay calendarios cargados</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">Subí el primer archivo usando el panel de arriba.</p>
            </div>
          </div>
        )}

        {!isLoading && calendars.map(cal => (
          <Card key={cal.id} className={`transition-all ${cal.status === "active" ? "ring-1 ring-emerald-500/40" : ""}`}>
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-sm truncate">{cal.name}</span>
                    {calendarStatusBadge(cal.status)}
                    <Badge variant="outline" className="text-xs font-mono">{cal.year}</Badge>
                  </div>
                  <div className="flex flex-col gap-1 mt-2">
                    {parseStatusBadge(cal.parseStatus)}
                    {cal.parseErrors && (
                      <p className="text-xs text-red-500 mt-1 pl-5">{cal.parseErrors}</p>
                    )}
                    {cal.uploadedFile && (
                      <span className="text-xs text-muted-foreground mt-0.5 pl-5 flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {cal.uploadedFile.split("/").pop()}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground pl-5 mt-0.5">
                      Cargado: {formatDate(cal.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setDetailCalendar(cal)}
                    className="h-8 text-xs"
                  >
                    <Info className="h-3.5 w-3.5 mr-1" />
                    Detalle
                  </Button>

                  <Button
                    size="sm" variant="outline"
                    onClick={() => reprocessMutation.mutate(cal.id)}
                    disabled={reprocessMutation.isPending}
                    className="h-8 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reprocesar
                  </Button>

                  {cal.status !== "active" && (
                    <Button
                      size="sm"
                      onClick={() => activateMutation.mutate(cal.id)}
                      disabled={activateMutation.isPending}
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      Activar
                    </Button>
                  )}

                  {cal.status === "active" && (
                    <Button size="sm" variant="ghost" disabled className="h-8 text-xs text-emerald-600 cursor-default">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Activo
                    </Button>
                  )}

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm" variant="outline"
                        className="h-8 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Eliminar
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar este calendario?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se eliminará el calendario <strong>"{cal.name}"</strong> y todas sus reglas. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(cal.id)}
                          className="bg-destructive hover:bg-destructive/90 text-white"
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-4 text-xs text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">¿Cómo funciona?</p>
          <p>1. Subí el PDF del calendario de vencimientos impositivos (AFIP o Rentas Neuquén).</p>
          <p>2. El sistema registra el archivo y lo deja en estado <strong>Pendiente de revisión</strong>.</p>
          <p>3. Revisá que los datos sean correctos y hacé clic en <strong>Activar</strong>.</p>
          <p>4. Al activar, el motor de vencimientos usará ese calendario para calcular fechas por CUIT e impuesto para todos tus clientes.</p>
          <p className="mt-1 text-muted-foreground/70">Solo puede haber un calendario activo a la vez. Activar uno archiva automáticamente el anterior.</p>
        </div>
      </div>

      <Dialog open={!!detailCalendar} onOpenChange={open => { if (!open) setDetailCalendar(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {detailCalendar?.name}
            </DialogTitle>
            <DialogDescription>Detalle del calendario impositivo</DialogDescription>
          </DialogHeader>
          {detailCalendar && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Año</div>
                  <div className="font-semibold font-mono">{detailCalendar.year}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Estado</div>
                  <div>{calendarStatusBadge(detailCalendar.status)}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Procesamiento</div>
                  <div>{parseStatusBadge(detailCalendar.parseStatus)}</div>
                </div>
                {detailCalendar.uploadedFile && (
                  <div className="rounded-lg border bg-muted/30 p-3 col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Archivo</div>
                    <div className="font-mono text-xs truncate">{detailCalendar.uploadedFile.split("/").pop()}</div>
                  </div>
                )}
                {detailCalendar.parseErrors && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 col-span-2">
                    <div className="text-xs text-red-500 mb-1 font-medium">Errores de procesamiento</div>
                    <div className="text-xs text-red-600 dark:text-red-400">{detailCalendar.parseErrors}</div>
                  </div>
                )}
                {detailCalendar.notes && (
                  <div className="rounded-lg border bg-muted/30 p-3 col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Notas</div>
                    <div className="text-xs">{detailCalendar.notes}</div>
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Cargado: {formatDate(detailCalendar.createdAt)} · Última actualización: {formatDate(detailCalendar.updatedAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
