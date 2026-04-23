/**
 * supplier-batches.tsx — Lotes semanales de pagos a proveedores
 *
 * MEJORAS vs. original:
 *  1. credentials:"include" en TODAS las queries y mutations (incluyendo BatchRow)
 *  2. Zod schema para formulario de creación de lote
 *  3. confirm() nativo reemplazado por Dialog de confirmación
 *  4. isError en query principal
 *  5. credentials en deleteMutation de BatchRow
 */

import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Truck, Plus, Trash2, ChevronDown, ChevronUp, CalendarClock,
  DollarSign, FileText, Package, X, AlertCircle, Upload, AlertTriangle, Loader2,
} from "lucide-react";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";
import { BASE } from "@/lib/base-url";

// ── Zod Schema ─────────────────────────────────────────────────────────────────

const BatchItemSchema = z.object({
  supplier:        z.string().min(1, "El nombre del proveedor es obligatorio"),
  amount:          z.coerce.number().min(0.01, "El importe debe ser mayor a 0"),
  document:        z.string().optional(),
  originalDueDate: z.string().optional(),
  notes:           z.string().optional(),
});

const BatchSchema = z.object({
  fileName:  z.string().min(1, "El nombre del lote es obligatorio"),
  weekStart: z.string().min(1, "La fecha de inicio de semana es obligatoria"),
  weekEnd:   z.string().min(1, "La fecha de fin de semana es obligatoria"),
  notes:     z.string().optional(),
  items:     z.array(BatchItemSchema)
    .min(1, "Debe haber al menos un comprobante con proveedor y monto"),
}).refine(d => d.weekEnd >= d.weekStart, {
  message: "La fecha de fin debe ser igual o posterior al inicio",
  path: ["weekEnd"],
});

type BatchFormData = z.infer<typeof BatchSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BatchItem {
  id?: number;
  supplier: string;
  originalDueDate: string;
  amount: number | string;
  document: string;
  notes: string;
}

interface SupplierBatch {
  id: number;
  fileName: string;
  weekStart: string;
  weekEnd: string;
  paymentDate: string;
  totalAmount: number;
  itemCount: number;
  status: string;
  notes?: string | null;
  dueDateId?: number | null;
  createdAt: string;
  items?: BatchItem[];
}

const EMPTY_ITEM: BatchItem = { supplier: "", originalDueDate: "", amount: "", document: "", notes: "" };

const STATUS_CFG: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pendiente",  className: "bg-amber-500/10 text-amber-600 border-amber-400/25" },
  processed: { label: "Procesado",  className: "bg-emerald-500/10 text-emerald-600 border-emerald-400/25" },
  cancelled: { label: "Cancelado",  className: "bg-red-500/10 text-red-600 border-red-400/25" },
};

// ── Format helpers ─────────────────────────────────────────────────────────────
// Usa Intl.NumberFormat con es-AR — separador de miles: punto, decimal: coma

function formatARS(amount: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── BatchRow ───────────────────────────────────────────────────────────────────

function BatchRow({ batch }: { batch: SupplierBatch }) {
  const [expanded,       setExpanded]       = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const qc = useQueryClient();

  const detailQuery = useQuery<SupplierBatch>({
    queryKey: ["supplier-batch-detail", batch.id],
    queryFn: () =>
      fetch(`${BASE}/api/supplier-batches/${batch.id}`, { credentials: "include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar detalle"); return r.json(); }),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/supplier-batches/${id}`, {
        method: "DELETE",
        credentials: "include",
      }).then(r => { if (!r.ok) throw new Error("Error al eliminar"); return r.json(); }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplier-batches"] });
      setConfirmDelete(false);
    },
  });

  const statusCfg = STATUS_CFG[batch.status] ?? STATUS_CFG["pending"]!;

  return (
    <>
      <div className="border border-border/50 rounded-xl overflow-hidden">
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="shrink-0 h-9 w-9 rounded-lg bg-primary/8 flex items-center justify-center">
            <FileText className="h-4 w-4 text-primary/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{batch.fileName}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">
                Semana {formatDate(batch.weekStart)} — {formatDate(batch.weekEnd)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold">{formatARS(batch.totalAmount)}</p>
              <p className="text-[10px] text-muted-foreground">{batch.itemCount} {batch.itemCount === 1 ? "item" : "items"}</p>
            </div>
            <div className="text-right hidden md:block">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Pago</p>
              <p className="text-xs font-medium text-primary">{formatDate(batch.paymentDate)}</p>
            </div>
            <Badge className={`text-[10px] font-medium border ${statusCfg.className}`}>{statusCfg.label}</Badge>
            {/* Dialog de confirmación en lugar de confirm() nativo */}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/50 hover:text-red-500"
              onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/40 bg-muted/20 px-4 py-3 space-y-2">
            {batch.notes && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-primary/20 pl-2">{batch.notes}</p>
            )}
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Comprobantes</span>
            </div>
            {detailQuery.isLoading ? (
              <div className="space-y-1.5">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
            ) : detailQuery.isError ? (
              <p className="text-xs text-destructive py-2">Error al cargar comprobantes</p>
            ) : detailQuery.data?.items?.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">Sin comprobantes cargados</p>
            ) : (
              <div className="space-y-1">
                {(detailQuery.data?.items ?? []).map((item, i) => (
                  <div key={item.id ?? i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-background/60 border border-border/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.supplier}</p>
                      {item.document && <p className="text-[10px] text-muted-foreground">{item.document}</p>}
                    </div>
                    {item.originalDueDate && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(item.originalDueDate)}</span>
                    )}
                    <span className="text-xs font-semibold shrink-0">{formatARS(Number(item.amount))}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total lote</span>
                <p className="text-sm font-bold">{formatARS(batch.totalAmount)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm delete dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar lote</DialogTitle>
            <DialogDescription>
              Se eliminará el lote "{batch.fileName}" y todos sus comprobantes. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(batch.id)}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSVItems(text: string): BatchItem[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const result: BatchItem[] = [];
  const skipHeader = lines[0]?.toLowerCase().includes("proveedor") || lines[0]?.toLowerCase().includes("supplier");
  const start = skipHeader ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(/[,;\t]/).map(p => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    result.push({ supplier: parts[0] ?? "", amount: parts[1] ?? "", document: parts[2] ?? "", originalDueDate: parts[3] ?? "", notes: parts[4] ?? "" });
  }
  return result;
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SupplierBatchesPage() {
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [search,     setSearch]     = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<{ fileName:string; weekStart:string; weekEnd:string; notes:string; items:BatchItem[] }>({
    fileName: "", weekStart: "", weekEnd: "", notes: "", items: [{ ...EMPTY_ITEM }],
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // ── Query con credentials ─────────────────────────────────────────────────

  const { data: batches = [], isLoading, isError } = useQuery<SupplierBatch[]>({
    queryKey: ["supplier-batches"],
    queryFn: () =>
      fetch(`${BASE}/api/supplier-batches`, { credentials: "include" })
        .then(r => { if (!r.ok) throw new Error("Error al cargar lotes"); return r.json(); }),
  });

  // ── Mutation con Zod + credentials ────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (payload: BatchFormData) => {
      const res = await fetch(`${BASE}/api/supplier-batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          items: payload.items.map(it => ({ ...it, amount: Number(it.amount) || 0 })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Error al crear el lote");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplier-batches"] });
      void qc.invalidateQueries({ queryKey: ["due-dates"] });
      setDialogOpen(false);
      setForm({ fileName: "", weekStart: "", weekEnd: "", notes: "", items: [{ ...EMPTY_ITEM }] });
      setFormErrors({});
    },
  });

  // Validar con Zod antes de enviar
  const handleSubmit = () => {
    // Filtrar items vacíos antes de validar
    const itemsToValidate = form.items.filter(it => it.supplier.trim());
    const payload = { ...form, items: itemsToValidate.map(it => ({ ...it, amount: Number(it.amount) || 0 })) };
    const parsed = BatchSchema.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const e of parsed.error.errors) {
        const path = e.path.join(".");
        errs[path] = e.message;
      }
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    createMutation.mutate(parsed.data);
  };

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return batches;
    const q = search.toLowerCase();
    return batches.filter(b =>
      b.fileName.toLowerCase().includes(q) ||
      b.weekStart.includes(q) ||
      b.paymentDate.includes(q)
    );
  }, [batches, search]);

  const totalPending = useMemo(() =>
    batches.filter(b => b.status === "pending").reduce((s, b) => s + b.totalAmount, 0)
  , [batches]);

  // ── Item helpers ──────────────────────────────────────────────────────────

  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const setItem    = (i: number, key: keyof BatchItem, value: string) =>
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it) }));

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCSVItems(text);
      if (parsed.length > 0) {
        setForm(f => ({ ...f, fileName: f.fileName || file.name.replace(/\.[^.]+$/, ""), items: parsed }));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const totalForm = form.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-9 w-48" />
      <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
    </div>
  );

  if (isError) return (
    <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5 m-6">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      Error al cargar los lotes de proveedores. Intentá actualizar la página.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Truck className="h-6 w-6 text-primary" />
            Lotes de Proveedores
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agrupación semanal de pagos a proveedores con vencimiento automático al lunes siguiente.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />Nuevo lote
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Lotes totales",   value:batches.length.toString(),                                              icon:FileText,  color:"text-primary" },
          { label:"Pendientes",      value:batches.filter(b=>b.status==="pending").length.toString(),              icon:AlertCircle,color:"text-amber-500" },
          { label:"Total pendiente", value:formatARS(totalPending),                                                icon:DollarSign,color:"text-emerald-500" },
          { label:"Procesados",      value:batches.filter(b=>b.status==="processed").length.toString(),            icon:Package,   color:"text-blue-500" },
        ].map(card => (
          <Card key={card.label} className="border-border/60">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-[11px] text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-lg font-bold mt-1">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + list */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input placeholder="Buscar por nombre, semana..." value={search}
                onChange={e => setSearch(e.target.value)} className="pl-3 pr-8 h-9" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {filtered.length === 0 ? (
            <Empty>
              <EmptyMedia><EmptyHeader><Truck className="h-8 w-8 text-muted-foreground/30" /></EmptyHeader></EmptyMedia>
              <EmptyContent>
                <EmptyTitle>{search ? "Sin resultados" : "Sin lotes registrados"}</EmptyTitle>
                <EmptyDescription>
                  {search ? "Probá con otro término." : "Creá el primer lote de pagos de la semana."}
                </EmptyDescription>
                {!search && <Button size="sm" className="mt-2" onClick={() => setDialogOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5"/>Nuevo lote</Button>}
              </EmptyContent>
            </Empty>
          ) : (
            <div className="space-y-2">
              {filtered.map(batch => <BatchRow key={batch.id} batch={batch} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setFormErrors({}); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo lote de proveedores</DialogTitle>
            <DialogDescription>
              Ingresá los comprobantes de la semana. El vencimiento se fijará automáticamente al lunes siguiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Nombre */}
            <div className="space-y-1.5">
              <Label>Nombre del lote *</Label>
              <Input placeholder="Ej: Facturas semana 14 — abril 2026" value={form.fileName}
                onChange={e => setForm(f => ({ ...f, fileName: e.target.value }))} />
              {formErrors["fileName"] && <p className="text-xs text-destructive">{formErrors["fileName"]}</p>}
            </div>
            {/* Semana */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Semana desde *</Label>
                <Input type="date" value={form.weekStart} onChange={e => setForm(f => ({ ...f, weekStart: e.target.value }))} />
                {formErrors["weekStart"] && <p className="text-xs text-destructive">{formErrors["weekStart"]}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Semana hasta *</Label>
                <Input type="date" value={form.weekEnd} onChange={e => setForm(f => ({ ...f, weekEnd: e.target.value }))} />
                {formErrors["weekEnd"] && <p className="text-xs text-destructive">{formErrors["weekEnd"]}</p>}
              </div>
            </div>
            {form.weekEnd && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
                <CalendarClock className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                <p className="text-[11px] text-primary/80">
                  Vencimiento de pago: lunes siguiente al cierre de semana. Se creará automáticamente en Vencimientos.
                </p>
              </div>
            )}
            {/* Notas */}
            <div className="space-y-1.5">
              <Label>Notas <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input placeholder="Observaciones del lote..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Items */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <input ref={csvInputRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleCSVImport} />
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comprobantes</Label>
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => csvInputRef.current?.click()}
                    className="h-7 text-xs px-2 border-dashed text-muted-foreground hover:text-foreground">
                    <Upload className="h-3 w-3 mr-1"/>Importar CSV
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 text-xs text-primary px-2">
                    <Plus className="h-3 w-3 mr-1"/>Fila
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                CSV: <code className="font-mono bg-muted px-0.5 rounded text-[9px]">proveedor, importe, N°doc, venc_original, notas</code>
              </p>
              {formErrors["items"] && <p className="text-xs text-destructive">{formErrors["items"]}</p>}
              <div className="space-y-2">
                {form.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 p-2 rounded-lg border border-border/40 bg-muted/20">
                    <div className="col-span-5 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Proveedor *</p>
                      <Input placeholder="Nombre / razón social" value={item.supplier}
                        onChange={e => setItem(i, "supplier", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Importe *</p>
                      <Input type="number" placeholder="0" value={String(item.amount)}
                        onChange={e => setItem(i, "amount", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">N° doc.</p>
                      <Input placeholder="Factura/Rem." value={item.document}
                        onChange={e => setItem(i, "document", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="col-span-1 flex items-end pb-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground/50 hover:text-destructive"
                        onClick={() => removeItem(i)} disabled={form.items.length <= 1}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {totalForm > 0 && (
                <div className="flex justify-end pt-1">
                  <span className="text-xs font-semibold">Total: {formatARS(totalForm)}</span>
                </div>
              )}
            </div>

            {/* Mutation error */}
            {createMutation.error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {(createMutation.error as Error).message}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setFormErrors({}); }}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Crear lote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
