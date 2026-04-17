import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  Zap, RotateCcw, FolderOpen, CalendarCheck, Info, ShieldAlert, Sparkles,
} from "lucide-react";

import { BASE } from "@/lib/base-url";

interface AnnualCalendar {
  id: number;
  name: string;
  year: number;
  calendarType: string;
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

function calendarTypeBadge(type: string) {
  if (type === "iibb_nqn") {
    return (
      <Badge className="bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400 text-xs">
        IIBB NQN
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400 text-xs">
      AFIP General
    </Badge>
  );
}

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
  const [isSeeding, setIsSeeding] = useState(false);
  const [uploadType, setUploadType] = useState<"general" | "iibb_nqn">("general");
  const [detailCalendar, setDetailCalendar] = useState<AnnualCalendar | null>(null);

  const { data: calendars = [], isLoading } = useQuery<AnnualCalendar[]>({
    queryKey: ["annual-calendars"],
    queryFn: () => fetch(`${BASE}/api/annual-calendars`).then(r => r.json()),
  });

  const hasGeneralActive = calendars.some(c => c.status === "active" && (c.calendarType === "general" || !c.calendarType));
  const hasIibbNqnActive = calendars.some(c => c.status === "active" && c.calendarType === "iibb_nqn");
  const hasAnyActive = hasGeneralActive || hasIibbNqnActive;

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
      formData.append("calendarType", uploadType);
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
  }, [qc, toast, uploadType]);

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

  const handleSeedIibbNqn = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(`${BASE}/api/annual-calendars/seed/iibb-nqn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: 2026 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear");
      qc.invalidateQueries({ queryKey: ["annual-calendars"] });
      toast({
        title: "Calendario IIBB NQN 2026 creado",
        description: `${data.rulesInserted} reglas cargadas desde la tabla oficial. Revisá y activá el calendario.`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsSeeding(false);
    }
  };

  const alreadyHasIibbNqn2026 = calendars.some(c => c.calendarType === "iibb_nqn" && c.year === 2026);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Calendarios impositivos</h1>
        <p className="text-muted-foreground text-sm">
          Cargá los calendarios de vencimientos fiscales anuales. El sistema soporta un calendario general (AFIP) y uno específico para IIBB Neuquén, activos en paralelo.
        </p>
      </div>

      {!hasGeneralActive && !isLoading && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <span className="font-semibold text-amber-600 dark:text-amber-400">Sin calendario AFIP activo</span>
            <span className="text-muted-foreground ml-1.5">
              Subí y activá el calendario general de AFIP para calcular vencimientos automáticamente.
            </span>
          </div>
        </div>
      )}

      {hasGeneralActive && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CalendarCheck className="h-4 w-4 shrink-0" />
          <span className="font-medium">Calendario AFIP activo.</span>
          <span className="text-muted-foreground">El motor calcula vencimientos por CUIT e impuesto.</span>
        </div>
      )}

      {hasIibbNqnActive && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-700 dark:text-violet-400">
          <CalendarCheck className="h-4 w-4 shrink-0" />
          <span className="font-medium">Calendario IIBB NQN activo.</span>
          <span className="text-muted-foreground">Se usa para clientes con Ingresos Brutos Neuquén asignado.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Subir calendario
            </CardTitle>
            <CardDescription>
              PDF · Excel · CSV — máx. 50 MB
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Tipo:</span>
              <Select value={uploadType} onValueChange={(v) => setUploadType(v as "general" | "iibb_nqn")}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">AFIP General</SelectItem>
                  <SelectItem value="iibb_nqn">IIBB NQN (Ingresos Brutos Neuquén)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => !isUploading && fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all cursor-pointer
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
                  <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm font-medium text-muted-foreground">Subiendo archivo…</p>
                </>
              ) : (
                <>
                  <div className={`rounded-full p-3 ${isDragging ? "bg-primary/15" : "bg-muted"}`}>
                    <FolderOpen className={`h-6 w-6 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold">
                      {isDragging ? "Soltá el archivo" : "Arrastrá o hacé clic"}
                    </p>
                    <p className="text-xs text-muted-foreground">para seleccionar desde tu computadora</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={`border-violet-500/30 ${alreadyHasIibbNqn2026 ? "opacity-60" : ""}`}>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              IIBB NQN 2026 — Carga rápida
            </CardTitle>
            <CardDescription>
              Crea el calendario de Ingresos Brutos Neuquén 2026 con todos los vencimientos pre-cargados desde la tabla oficial.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg bg-muted/40 border p-3 text-xs text-muted-foreground space-y-1">
              <p><span className="font-medium text-foreground">55 reglas</span> — períodos Enero a Noviembre 2026</p>
              <p>Grupos CUIT: 0-1 · 2-3 · 4-5 · 6-7 · 8-9</p>
              <p>Solo aplica a clientes con <span className="font-medium text-foreground">IIBB Neuquén</span> asignado.</p>
            </div>
            {alreadyHasIibbNqn2026 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Calendario IIBB NQN 2026 ya existe
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeedIibbNqn}
                disabled={isSeeding}
                className="border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/60"
              >
                {isSeeding ? (
                  <>
                    <div className="h-3.5 w-3.5 rounded-full border border-violet-500 border-t-transparent animate-spin mr-1.5" />
                    Creando…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Crear calendario IIBB NQN 2026
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

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
              <p className="text-xs text-muted-foreground/70 mt-0.5">Subí el primer archivo o usá la carga rápida de IIBB NQN.</p>
            </div>
          </div>
        )}

        {!isLoading && calendars.map(cal => (
          <Card key={cal.id} className={`transition-all ${cal.status === "active" ? (cal.calendarType === "iibb_nqn" ? "ring-1 ring-violet-500/40" : "ring-1 ring-emerald-500/40") : ""}`}>
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-sm truncate">{cal.name}</span>
                    {calendarTypeBadge(cal.calendarType)}
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
                      className={`h-8 text-xs text-white ${cal.calendarType === "iibb_nqn"
                        ? "bg-violet-600 hover:bg-violet-700"
                        : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      Activar
                    </Button>
                  )}

                  {cal.status === "active" && (
                    <Button size="sm" variant="ghost" disabled className={`h-8 text-xs cursor-default ${cal.calendarType === "iibb_nqn" ? "text-violet-600" : "text-emerald-600"}`}>
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
          <p>1. El sistema soporta dos calendarios activos en paralelo: uno <strong>AFIP General</strong> y uno <strong>IIBB NQN</strong>.</p>
          <p>2. Al generar vencimientos para un cliente, el motor usa el calendario correcto según el impuesto: IIBB Neuquén usa el calendario NQN; los demás usan el general.</p>
          <p>3. Activar un calendario solo archiva otros del <strong>mismo tipo</strong>: activar un IIBB NQN no afecta al calendario AFIP activo.</p>
          <p>4. Para IIBB NQN, usá la "Carga rápida" para pre-cargar los 55 vencimientos del 2026 de la tabla oficial, o subí tu propio archivo.</p>
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
                  <div className="text-xs text-muted-foreground mb-1">Tipo</div>
                  <div>{calendarTypeBadge(detailCalendar.calendarType)}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Estado</div>
                  <div>{calendarStatusBadge(detailCalendar.status)}</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
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
