import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  DollarSign, FileText, Package, X, AlertCircle, Upload,
} from "lucide-react";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";

import { BASE } from "@/lib/base-url";

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

const EMPTY_ITEM: BatchItem = {
  supplier: "",
  originalDueDate: "",
  amount: "",
  document: "",
  notes: "",
};

const STATUS_CFG: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pendiente",   className: "bg-amber-500/10 text-amber-600 border-amber-400/25" },
  processed: { label: "Procesado",   className: "bg-emerald-500/10 text-emerald-600 border-emerald-400/25" },
  cancelled: { label: "Cancelado",   className: "bg-red-500/10 text-red-600 border-red-400/25" },
};

function formatARS(amount: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function BatchRow({ batch }: { batch: SupplierBatch }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const detailQuery = useQuery<SupplierBatch>({
    queryKey: ["supplier-batch-detail", batch.id],
    queryFn: () => fetch(`/api/supplier-batches/${batch.id}`).then(r => r.json()),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/supplier-batches/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-batches"] }),
  });

  const statusCfg = STATUS_CFG[batch.status] ?? STATUS_CFG.pending;

  return (
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
          <Badge className={`text-[10px] font-medium border ${statusCfg.className}`}>
            {statusCfg.label}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground/50 hover:text-red-500"
            onClick={e => { e.stopPropagation(); if (confirm("¿Eliminar este lote?")) deleteMutation.mutate(batch.id); }}
          >
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
  );
}

interface BatchForm {
  fileName: string;
  weekStart: string;
  weekEnd: string;
  notes: string;
  items: BatchItem[];
}

function parseCSVItems(text: string): BatchItem[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const result: BatchItem[] = [];
  const skipHeader = lines[0]?.toLowerCase().includes("proveedor") || lines[0]?.toLowerCase().includes("supplier");
  const start = skipHeader ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(/[,;\t]/).map(p => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    result.push({
      supplier: parts[0] ?? "",
      amount: parts[1] ?? "",
      document: parts[2] ?? "",
      originalDueDate: parts[3] ?? "",
      notes: parts[4] ?? "",
    });
  }
  return result;
}

export default function SupplierBatchesPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<BatchForm>({
    fileName: "",
    weekStart: "",
    weekEnd: "",
    notes: "",
    items: [{ ...EMPTY_ITEM }],
  });
  const [search, setSearch] = useState("");

  const { data: batches = [], isLoading } = useQuery<SupplierBatch[]>({
    queryKey: ["supplier-batches"],
    queryFn: () => fetch(`${BASE}/api/supplier-batches`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: BatchForm) =>
      fetch(`${BASE}/api/supplier-batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          items: data.items.map(it => ({
            ...it,
            amount: Number(it.amount) || 0,
          })).filter(it => it.supplier.trim()),
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-batches"] });
      qc.invalidateQueries({ queryKey: ["due-dates"] });
      setDialogOpen(false);
      setForm({ fileName: "", weekStart: "", weekEnd: "", notes: "", items: [{ ...EMPTY_ITEM }] });
    },
  });

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
    batches.filter(b => b.status === "pending").reduce((s, b) => s + b.totalAmount, 0),
    [batches]
  );

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const setItem = (i: number, key: keyof BatchItem, value: string) =>
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it) }));

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCSVItems(text);
      if (parsed.length > 0) {
        setForm(f => ({
          ...f,
          fileName: f.fileName || file.name.replace(/\.[^.]+$/, ""),
          items: parsed,
        }));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const totalForm = form.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const canSubmit = form.fileName.trim() && form.weekStart && form.weekEnd && form.items.some(it => it.supplier.trim());

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
          <Plus className="h-4 w-4 mr-2" />
          Nuevo lote
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Lotes totales", value: batches.length.toString(), icon: FileText, color: "text-primary" },
          { label: "Pendientes", value: batches.filter(b => b.status === "pending").length.toString(), icon: AlertCircle, color: "text-amber-500" },
          { label: "Total pendiente", value: formatARS(totalPending), icon: DollarSign, color: "text-emerald-500" },
          { label: "Procesados", value: batches.filter(b => b.status === "processed").length.toString(), icon: Package, color: "text-blue-500" },
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
              <Input
                placeholder="Buscar por nombre, semana..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-3 pr-8 h-9"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Empty>
              <EmptyMedia><EmptyHeader><Truck className="h-8 w-8 text-muted-foreground/30" /></EmptyHeader></EmptyMedia>
              <EmptyContent>
                <EmptyTitle>{search ? "Sin resultados" : "Sin lotes registrados"}</EmptyTitle>
                <EmptyDescription>
                  {search ? "Probá con otro término." : "Creá el primer lote de pagos de la semana."}
                </EmptyDescription>
                {!search && (
                  <Button size="sm" className="mt-2" onClick={() => setDialogOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Nuevo lote
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <div className="space-y-2">
              {filtered.map(batch => (
                <BatchRow key={batch.id} batch={batch} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo lote de proveedores</DialogTitle>
            <DialogDescription>
              Ingresá los comprobantes de la semana. El vencimiento se fijará automáticamente al lunes siguiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Nombre del lote *</Label>
              <Input
                placeholder="Ej: Facturas semana 14 — abril 2026"
                value={form.fileName}
                onChange={e => setForm(f => ({ ...f, fileName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Semana desde *</Label>
                <Input
                  type="date"
                  value={form.weekStart}
                  onChange={e => setForm(f => ({ ...f, weekStart: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Semana hasta *</Label>
                <Input
                  type="date"
                  value={form.weekEnd}
                  onChange={e => setForm(f => ({ ...f, weekEnd: e.target.value }))}
                />
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
            <div className="space-y-1.5">
              <Label>Notas <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input
                placeholder="Observaciones del lote..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {/* Items section */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt,.tsv"
                className="hidden"
                onChange={handleCSVImport}
              />
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Comprobantes
                </Label>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => csvInputRef.current?.click()}
                    className="h-7 text-xs px-2 border-dashed text-muted-foreground hover:text-foreground"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Importar CSV
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 text-xs text-primary px-2">
                    <Plus className="h-3 w-3 mr-1" />
                    Fila
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                CSV: <code className="font-mono bg-muted px-0.5 rounded text-[9px]">proveedor, importe, N°doc, venc_original, notas</code>
              </p>
              <div className="space-y-2">
                {form.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 p-2 rounded-lg border border-border/40 bg-muted/20">
                    <div className="col-span-5 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Proveedor *</p>
                      <Input
                        placeholder="Nombre / razón social"
                        value={item.supplier}
                        onChange={e => setItem(i, "supplier", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Importe *</p>
                      <Input
                        type="number"
                        placeholder="0"
                        value={item.amount}
                        onChange={e => setItem(i, "amount", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">N° doc.</p>
                      <Input
                        placeholder="Factura/Rem."
                        value={item.document}
                        onChange={e => setItem(i, "document", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-1 flex items-end justify-center pb-0.5">
                      {form.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="col-span-11 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Vencimiento original</p>
                      <Input
                        type="date"
                        value={item.originalDueDate}
                        onChange={e => setItem(i, "originalDueDate", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
              {form.items.some(it => it.supplier.trim()) && (
                <div className="flex justify-between items-center pt-1 px-1">
                  <span className="text-[11px] text-muted-foreground">{form.items.filter(it => it.supplier.trim()).length} comprobante/s</span>
                  <span className="text-sm font-bold">{formatARS(totalForm)}</span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!canSubmit || createMutation.isPending}
            >
              {createMutation.isPending ? "Guardando…" : "Crear lote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
