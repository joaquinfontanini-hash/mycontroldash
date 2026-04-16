import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Plus, Search, Edit2, Trash2, RefreshCw, CheckCircle2,
  AlertCircle, X, CalendarClock, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";

import { BASE } from "@/lib/base-url";

const TAX_TYPES = [
  { key: "iva", label: "IVA", category: "impuestos" },
  { key: "ganancias", label: "Ganancias", category: "impuestos" },
  { key: "monotributo", label: "Monotributo", category: "impuestos" },
  { key: "autonomos", label: "Autónomos", category: "impuestos" },
  { key: "iibb_neuquen", label: "IIBB Neuquén", category: "impuestos" },
  { key: "iibb_rio_negro", label: "IIBB Río Negro", category: "impuestos" },
  { key: "cargas_sociales", label: "Cargas Sociales", category: "cargas" },
  { key: "empleada_domestica", label: "Empleada Doméstica", category: "cargas" },
  { key: "sindicato", label: "Sindicato", category: "cargas" },
  { key: "facturacion", label: "Facturación", category: "otros" },
];

function formatCuit(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function validateCuit(cuit: string): string | null {
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return "El CUIT debe tener 11 dígitos";
  const validPrefixes = ["20", "23", "24", "25", "26", "27", "30", "33", "34"];
  if (!validPrefixes.includes(clean.slice(0, 2))) return "Prefijo de CUIT inválido";
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i]!) * weights[i]!;
  const remainder = sum % 11;
  if (remainder === 1) return "CUIT inválido (dígito verificador incorrecto)";
  const expectedCheck = remainder === 0 ? 0 : 11 - remainder;
  if (parseInt(clean[10]!) !== expectedCheck) return "Dígito verificador de CUIT inválido";
  return null;
}

function cuitLastDigit(cuit: string): string {
  const c = cuit.replace(/\D/g, "");
  return c[c.length - 1] ?? "–";
}

interface TaxAssignment { id: number; clientId: number; taxType: string; enabled: boolean; }
interface Client {
  id: number; name: string; cuit: string; email?: string | null;
  phone?: string | null; status: string; notes?: string | null;
  createdAt: string; taxAssignments: TaxAssignment[];
}

interface ClientForm {
  name: string; cuit: string; email: string; phone: string;
  status: string; notes: string; taxTypes: string[];
}

const EMPTY_FORM: ClientForm = {
  name: "", cuit: "", email: "", phone: "", status: "active", notes: "", taxTypes: [],
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-muted text-muted-foreground",
};

export default function ClientsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateResult, setGenerateResult] = useState<{ generated: number; skipped: number; errors: string[] } | null>(null);
  const [generateResultClientId, setGenerateResultClientId] = useState<number | null>(null);

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients`);
      if (!res.ok) throw new Error("Error al cargar clientes");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ClientForm) => {
      const res = await fetch(`${BASE}/api/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, cuit: data.cuit.replace(/\D/g, "") }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error al crear cliente");
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clients"] }); setDialogOpen(false); },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ClientForm }) => {
      const res = await fetch(`${BASE}/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, cuit: data.cuit.replace(/\D/g, "") }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error al actualizar cliente");
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clients"] }); setDialogOpen(false); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/clients/${id}`, { method: "DELETE" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clients"] }); setConfirmDeleteId(null); },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({
      name: c.name, cuit: formatCuit(c.cuit),
      email: c.email ?? "", phone: c.phone ?? "",
      status: c.status, notes: c.notes ?? "",
      taxTypes: c.taxAssignments.filter(t => t.enabled).map(t => t.taxType),
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const cuitError = validateCuit(form.cuit);
    if (cuitError) { setFormError(cuitError); return; }
    if (!form.name.trim()) { setFormError("El nombre es requerido"); return; }
    setFormError(null);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const toggleTaxType = (key: string) => {
    setForm(f => ({
      ...f,
      taxTypes: f.taxTypes.includes(key) ? f.taxTypes.filter(t => t !== key) : [...f.taxTypes, key],
    }));
  };

  const handleGenerateDueDates = async (clientId: number, regenerate = false) => {
    setGeneratingId(clientId);
    setGenerateResult(null);
    try {
      const endpoint = regenerate ? `${BASE}/api/clients/${clientId}/regenerate-due-dates` : `${BASE}/api/clients/${clientId}/generate-due-dates`;
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      setGenerateResult(data);
      setGenerateResultClientId(clientId);
      qc.invalidateQueries({ queryKey: ["due-dates"] });
    } catch {
      setGenerateResult({ generated: 0, skipped: 0, errors: ["Error de conexión"] });
    } finally {
      setGeneratingId(null);
    }
  };

  const filtered = useMemo(() => {
    let items = clients;
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(c =>
        c.name.toLowerCase().includes(q) || c.cuit.includes(q)
      );
    }
    if (filterStatus !== "all") items = items.filter(c => c.status === filterStatus);
    return items;
  }, [clients, search, filterStatus]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gestión de clientes, CUIT e impuestos asignados. Motor AFIP para generación automática de vencimientos.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Nuevo cliente
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o CUIT..."
            className="pl-9 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {["all", "active", "inactive"].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150
              ${filterStatus === s
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
          >
            {s === "all" ? "Todos" : s === "active" ? "Activos" : "Inactivos"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border-2 border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>Sin clientes</EmptyTitle>
            <EmptyDescription>
              {search || filterStatus !== "all"
                ? "No hay clientes que coincidan con los filtros."
                : "Agregá tu primer cliente para empezar a gestionar vencimientos AFIP automáticos."}
            </EmptyDescription>
          </EmptyHeader>
          {!search && filterStatus === "all" && (
            <EmptyContent>
              <Button onClick={openCreate} size="sm">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Nuevo cliente
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map(client => {
            const isExpanded = expandedId === client.id;
            const taxLabels = client.taxAssignments.filter(t => t.enabled).map(t =>
              TAX_TYPES.find(tt => tt.key === t.taxType)?.label ?? t.taxType
            );
            const isGenerating = generatingId === client.id;
            const result = generateResultClientId === client.id ? generateResult : null;

            return (
              <Card key={client.id} className="border-border/60 hover:border-border transition-colors">
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold leading-tight truncate">{client.name}</h3>
                        <Badge className={`text-[9px] px-1.5 py-0 border-0 ${STATUS_BADGE[client.status] ?? STATUS_BADGE.inactive}`}>
                          {client.status === "active" ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                          {formatCuit(client.cuit)}
                        </code>
                        <span className="text-[10px] text-muted-foreground">
                          Termina en <strong>{cuitLastDigit(client.cuit)}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(client)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDeleteId(client.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0 pb-3 space-y-2.5">
                  {/* Tax assignments */}
                  {taxLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {taxLabels.map(label => (
                        <span key={label} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/80 border border-primary/15">
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60 italic">Sin impuestos asignados</p>
                  )}

                  {/* Optional details */}
                  {(client.email || client.phone) && (
                    <p className="text-[11px] text-muted-foreground">
                      {[client.email, client.phone].filter(Boolean).join(" · ")}
                    </p>
                  )}

                  {/* AFIP Engine actions */}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-[11px] gap-1"
                      disabled={isGenerating || taxLabels.length === 0}
                      onClick={() => handleGenerateDueDates(client.id, false)}
                    >
                      <Zap className="h-3 w-3" />
                      {isGenerating ? "Generando..." : "Generar vencimientos AFIP"}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-[10px] gap-1 text-muted-foreground"
                      disabled={isGenerating}
                      onClick={() => handleGenerateDueDates(client.id, true)}
                    >
                      <RefreshCw className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
                      Regenerar
                    </Button>
                    {client.notes && (
                      <button
                        className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : client.id)}
                      >
                        Notas {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    )}
                  </div>

                  {/* Generate result */}
                  {result && (
                    <div className={`text-[11px] rounded-lg px-3 py-2 flex items-center gap-2 ${result.errors.length > 0 ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400" : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400"}`}>
                      {result.errors.length === 0
                        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                      <span>
                        {result.generated > 0 ? `${result.generated} vencimientos generados.` : ""}
                        {result.skipped > 0 ? ` ${result.skipped} ya existían.` : ""}
                        {result.errors.length > 0 ? ` ${result.errors[0]}` : ""}
                      </span>
                      <button onClick={() => setGenerateResult(null)} className="ml-auto">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Notes expanded */}
                  {isExpanded && client.notes && (
                    <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">{client.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
            <DialogDescription>
              {editing ? `Editando ${editing.name}` : "Completá los datos del cliente. El CUIT es obligatorio."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre / Razón Social *</label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Empresa SRL / Juan Pérez"
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CUIT *</label>
                <Input
                  value={form.cuit}
                  onChange={e => setForm(f => ({ ...f, cuit: formatCuit(e.target.value) }))}
                  placeholder="20-12345678-9"
                  className="h-9 font-mono"
                  maxLength={13}
                />
                {form.cuit.replace(/\D/g, "").length === 11 && !validateCuit(form.cuit) && (
                  <p className="text-[10px] text-muted-foreground">
                    Terminación: <strong>{cuitLastDigit(form.cuit)}</strong> (determina los vencimientos AFIP)
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@empresa.com" className="h-9" type="email" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Teléfono</label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+54 299 ..." className="h-9" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estado</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observaciones</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notas internas..."
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            {/* Tax types */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Impuestos y Obligaciones</label>
              <p className="text-[11px] text-muted-foreground">Seleccioná los impuestos del cliente. Se usarán para generar vencimientos AFIP automáticos según la terminación del CUIT.</p>
              {[
                { group: "Impuestos", types: TAX_TYPES.filter(t => t.category === "impuestos") },
                { group: "Cargas Sociales", types: TAX_TYPES.filter(t => t.category === "cargas") },
                { group: "Otros", types: TAX_TYPES.filter(t => t.category === "otros") },
              ].map(({ group, types }) => (
                <div key={group}>
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-1.5">{group}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {types.map(tt => {
                      const active = form.taxTypes.includes(tt.key);
                      return (
                        <button
                          key={tt.key}
                          type="button"
                          onClick={() => toggleTaxType(tt.key)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150
                            ${active
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-muted/60 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                            }`}
                        >
                          {tt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar cliente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro? Se eliminarán también todas las asignaciones de impuestos. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Empty info strip */}
      {clients.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-xl px-4 py-3 border border-border/40">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          Los vencimientos AFIP se generan usando el calendario activo (2026) y la terminación de CUIT.
          Usá el botón "Generar vencimientos AFIP" en cada cliente para calcularlos automáticamente.
        </div>
      )}
    </div>
  );
}
