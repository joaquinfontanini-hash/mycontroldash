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
  FolderOpen, Settings2, Loader2, FileText, CreditCard, ExternalLink,
  TrendingDown, Receipt,
} from "lucide-react";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";

import { BASE } from "@/lib/base-url";

const TAX_TYPES = [
  { key: "iva", label: "IVA", category: "impuestos" },
  { key: "ganancias", label: "Ganancias", category: "impuestos" },
  { key: "anticipo_ganancias", label: "Anticipo de IG", category: "impuestos" },
  { key: "monotributo", label: "Monotributo", category: "impuestos" },
  { key: "autonomos", label: "Autónomos", category: "impuestos" },
  { key: "convenio_multilateral", label: "Convenio Multilateral", category: "impuestos" },
  { key: "sicore_1q", label: "SICORE 1° Quincena", category: "impuestos" },
  { key: "sicore_ddjj", label: "SICORE DDJJ", category: "impuestos" },
  { key: "iibb_neuquen", label: "IIBB Neuquén", category: "impuestos" },
  { key: "iibb_rio_negro", label: "IIBB Río Negro", category: "impuestos" },
  { key: "cargas_sociales", label: "Cargas Sociales (SICOSS)", category: "cargas" },
  { key: "empleada_domestica", label: "Personal de Casas Particulares", category: "cargas" },
  { key: "sindicato", label: "Sindicato", category: "cargas" },
  { key: "facturacion", label: "Facturación", category: "otros" },
];

const GROUP_COLORS = [
  { key: "blue",    label: "Azul",     bg: "bg-blue-100 dark:bg-blue-900/30",     text: "text-blue-700 dark:text-blue-300",     dot: "bg-blue-500" },
  { key: "emerald", label: "Verde",    bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  { key: "amber",   label: "Amarillo", bg: "bg-amber-100 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-300",   dot: "bg-amber-500" },
  { key: "rose",    label: "Rojo",     bg: "bg-rose-100 dark:bg-rose-900/30",     text: "text-rose-700 dark:text-rose-300",     dot: "bg-rose-500" },
  { key: "violet",  label: "Violeta",  bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  { key: "orange",  label: "Naranja",  bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  { key: "cyan",    label: "Cyan",     bg: "bg-cyan-100 dark:bg-cyan-900/30",     text: "text-cyan-700 dark:text-cyan-300",     dot: "bg-cyan-500" },
  { key: "pink",    label: "Rosa",     bg: "bg-pink-100 dark:bg-pink-900/30",     text: "text-pink-700 dark:text-pink-300",     dot: "bg-pink-500" },
];

function getGroupColor(color: string) {
  return GROUP_COLORS.find(c => c.key === color) ?? GROUP_COLORS[0]!;
}

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

interface ClientGroup {
  id: number;
  name: string;
  color: string;
  description?: string | null;
  userId?: string | null;
  createdAt: string;
}

interface Client {
  id: number; name: string; cuit: string; email?: string | null;
  phone?: string | null; status: string; notes?: string | null;
  groupId?: number | null;
  group?: ClientGroup | null;
  createdAt: string; taxAssignments: TaxAssignment[];
}

interface ClientForm {
  name: string; cuit: string; email: string; phone: string;
  status: string; notes: string; taxTypes: string[];
  groupId: string;
}

const EMPTY_FORM: ClientForm = {
  name: "", cuit: "", email: "", phone: "", status: "active", notes: "", taxTypes: [], groupId: "",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-muted text-muted-foreground",
};

// ── Group Badge ───────────────────────────────────────────────────────────────

function GroupBadge({ group }: { group: ClientGroup }) {
  const cfg = getGroupColor(group.color);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {group.name}
    </span>
  );
}

// ── Group Manager Dialog ──────────────────────────────────────────────────────

function GroupManagerDialog({
  open, onClose, groups, onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  groups: ClientGroup[];
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("blue");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const startEdit = (g: ClientGroup) => {
    setEditingId(g.id);
    setEditName(g.name);
    setEditColor(g.color);
    setEditDesc(g.description ?? "");
  };

  const cancelEdit = () => { setEditingId(null); setEditName(""); setEditColor("blue"); setEditDesc(""); };

  const handleSave = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/clients/groups/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor, description: editDesc }),
        credentials: "include",
      });
      onRefresh();
      cancelEdit();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/clients/groups/${id}`, { method: "DELETE", credentials: "include" });
      onRefresh();
    } finally { setDeletingId(null); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Gestionar grupos
          </DialogTitle>
          <DialogDescription>Editá el nombre, color o eliminá grupos existentes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No hay grupos creados aún.</p>
          )}
          {groups.map(g => {
            const cfg = getGroupColor(g.color);
            if (editingId === g.id) {
              return (
                <div key={g.id} className="space-y-2 p-3 border rounded-xl bg-muted/20">
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-sm" placeholder="Nombre del grupo" />
                  <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="h-8 text-sm" placeholder="Descripción (opcional)" />
                  <div className="flex flex-wrap gap-1.5">
                    {GROUP_COLORS.map(c => (
                      <button key={c.key} type="button" onClick={() => setEditColor(c.key)}
                        className={`h-6 w-6 rounded-full ${c.dot} transition-all ${editColor === c.key ? "ring-2 ring-offset-1 ring-foreground scale-110" : "opacity-60 hover:opacity-100"}`}
                        title={c.label} />
                    ))}
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>Cancelar</Button>
                    <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving || !editName.trim()}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2 border rounded-xl hover:bg-muted/30 transition-colors group">
                <span className={`h-3 w-3 rounded-full ${cfg.dot} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.name}</p>
                  {g.description && <p className="text-[10px] text-muted-foreground truncate">{g.description}</p>}
                </div>
                <button onClick={() => startEdit(g)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-primary">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(g.id)}
                  disabled={deletingId === g.id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive"
                >
                  {deletingId === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Group Selector (inline in client form) ────────────────────────────────────

function GroupSelector({
  groups, value, onChange, onGroupCreated,
}: {
  groups: ClientGroup[];
  value: string;
  onChange: (id: string) => void;
  onGroupCreated: (g: ClientGroup) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/clients/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
        credentials: "include",
      });
      if (res.ok) {
        const g: ClientGroup = await res.json();
        onGroupCreated(g);
        onChange(String(g.id));
        setNewName(""); setNewColor("blue"); setCreating(false);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Sin grupo</option>
        {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>

      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Crear nuevo grupo
        </button>
      ) : (
        <div className="space-y-2 p-3 border rounded-xl bg-muted/20">
          <Input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre del grupo..."
            className="h-7 text-xs"
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
          />
          <div className="flex flex-wrap gap-1.5">
            {GROUP_COLORS.map(c => (
              <button key={c.key} type="button" onClick={() => setNewColor(c.key)}
                className={`h-5 w-5 rounded-full ${c.dot} transition-all ${newColor === c.key ? "ring-2 ring-offset-1 ring-foreground scale-110" : "opacity-50 hover:opacity-100"}`}
                title={c.label} />
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Crear"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

// ── Client Quotes Summary (tab en la ficha del cliente) ───────────────────────

type QuoteStatus2 = "draft"|"sent"|"approved"|"rejected"|"expired"|"partially_paid"|"paid";
const STATUS_LABEL: Record<QuoteStatus2, string> = {
  draft: "Borrador", sent: "Enviado", approved: "Aprobado",
  rejected: "Rechazado", expired: "Vencido", partially_paid: "Parcial", paid: "Cobrado",
};
const STATUS_COLOR: Record<QuoteStatus2, string> = {
  draft: "bg-gray-100 dark:bg-gray-800 text-gray-600",
  sent: "bg-blue-100 dark:bg-blue-900/30 text-blue-700",
  approved: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-700",
  expired: "bg-orange-100 dark:bg-orange-900/30 text-orange-700",
  partially_paid: "bg-amber-100 dark:bg-amber-900/30 text-amber-700",
  paid: "bg-teal-100 dark:bg-teal-900/30 text-teal-700",
};

function fmtMoney(n: number | string, currency = "ARS") {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: 0 }).format(v);
}
function fmtDateShort(d: string | null | undefined) {
  if (!d) return "-";
  const [y, m, dd] = d.split("-");
  if (!y || !m || !dd) return d;
  return `${dd}/${m}/${y.slice(2)}`;
}

interface ClientQSummary {
  totalPresupuestos: number;
  totalPresupuestado: number;
  totalCobrado: number;
  saldoPendiente: number;
  cantidadVencidos: number;
  cantidadParciales: number;
  lastQuote: { id: number; quoteNumber: string; issueDate: string; title: string; totalAmount: string; status: string } | null;
  lastPayment: { id: number; paymentDate: string; amount: string; currency: string } | null;
}
interface ClientQRow {
  id: number; quoteNumber: string; title: string; issueDate: string; dueDate: string;
  totalAmount: string; status: string; currency: string; version: number; totalPaid: number; balance: number; lastPaymentDate: string | null;
}
interface ClientPaymentRow {
  id: number; quoteNumber: string; paymentDate: string; amount: string; currency: string; paymentMethod: string; reference: string | null;
}

function ClientQuotesSummary({ clientId, clientName }: { clientId: number; clientName: string }) {
  const { data, isLoading, isError } = useQuery<{ summary: ClientQSummary; quotes: ClientQRow[]; payments: ClientPaymentRow[] }>({
    queryKey: ["client-quotes", clientId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/quotes/client/${clientId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="space-y-2 py-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (isError || !data) return <p className="text-xs text-muted-foreground py-3">No se pudieron cargar los presupuestos</p>;

  const { summary, quotes, payments } = data;

  return (
    <div className="space-y-3 pt-2">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Presupuestado", value: fmtMoney(summary.totalPresupuestado), color: "text-foreground" },
          { label: "Cobrado", value: fmtMoney(summary.totalCobrado), color: "text-teal-600" },
          { label: "Saldo pendiente", value: fmtMoney(summary.saldoPendiente), color: summary.saldoPendiente > 0 ? "text-amber-600" : "text-foreground" },
          { label: "Vencidos", value: summary.cantidadVencidos.toString(), color: summary.cantidadVencidos > 0 ? "text-red-600" : "text-muted-foreground" },
        ].map(k => (
          <div key={k.label} className="bg-muted/40 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={`text-sm font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Link a presupuestos */}
      <div className="flex justify-end">
        <Link href="/dashboard/quotes" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
          <ExternalLink className="w-3 h-3" /> Ver en módulo completo
        </Link>
      </div>

      <Tabs defaultValue="presupuestos">
        <TabsList className="h-7 text-xs">
          <TabsTrigger value="presupuestos" className="text-xs h-6">
            Presupuestos ({summary.totalPresupuestos})
          </TabsTrigger>
          <TabsTrigger value="cobros" className="text-xs h-6">
            Cobros ({payments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="presupuestos" className="mt-2">
          {quotes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Sin presupuestos</p>
          ) : (
            <div className="space-y-1.5">
              {quotes.slice(0, 8).map(q => (
                <div key={q.id} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2 bg-card">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${q.status === "paid" ? "bg-teal-500" : q.status === "expired" ? "bg-red-500" : q.status === "partially_paid" ? "bg-amber-500" : q.balance > 0 && q.dueDate <= new Date().toISOString().slice(0,10) ? "bg-red-500" : "bg-emerald-500"}`} />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-muted-foreground">{q.quoteNumber}</span>
                    <span className="ml-1.5 truncate">{q.title}</span>
                  </div>
                  <span className="font-medium shrink-0">{fmtMoney(q.totalAmount, q.currency)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${STATUS_COLOR[q.status as QuoteStatus2] ?? "bg-gray-100 text-gray-600"}`}>
                    {STATUS_LABEL[q.status as QuoteStatus2] ?? q.status}
                  </span>
                </div>
              ))}
              {quotes.length > 8 && (
                <p className="text-[10px] text-muted-foreground text-center">+{quotes.length - 8} más</p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cobros" className="mt-2">
          {payments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Sin cobros registrados</p>
          ) : (
            <div className="space-y-1.5">
              {payments.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2 bg-card">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground">{p.quoteNumber}</span>
                    <span className="ml-1.5 text-muted-foreground">{fmtDateShort(p.paymentDate)}</span>
                    {p.reference && <span className="ml-1.5 italic text-[10px] text-muted-foreground">Ref: {p.reference}</span>}
                  </div>
                  <span className="font-semibold text-teal-600 shrink-0">{fmtMoney(p.amount, p.currency)}</span>
                </div>
              ))}
              {payments.length > 8 && (
                <p className="text-[10px] text-muted-foreground text-center">+{payments.length - 8} más</p>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateResult, setGenerateResult] = useState<{ generated: number; skipped: number; errors: string[] } | null>(null);
  const [generateResultClientId, setGenerateResultClientId] = useState<number | null>(null);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar clientes");
      return res.json();
    },
  });

  const { data: groups = [], refetch: refetchGroups } = useQuery<ClientGroup[]>({
    queryKey: ["client-groups"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/clients/groups`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ClientForm) => {
      const res = await fetch(`${BASE}/api/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          cuit: data.cuit.replace(/\D/g, ""),
          groupId: data.groupId || null,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Error al crear cliente"); }
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
        credentials: "include",
        body: JSON.stringify({
          ...data,
          cuit: data.cuit.replace(/\D/g, ""),
          groupId: data.groupId || null,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Error al actualizar cliente"); }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clients"] }); setDialogOpen(false); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/clients/${id}`, { method: "DELETE", credentials: "include" });
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
      groupId: c.groupId ? String(c.groupId) : "",
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
      const endpoint = regenerate
        ? `${BASE}/api/clients/${clientId}/regenerate-due-dates`
        : `${BASE}/api/clients/${clientId}/generate-due-dates`;
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
      items = items.filter(c => c.name.toLowerCase().includes(q) || c.cuit.includes(q));
    }
    if (filterStatus !== "all") items = items.filter(c => c.status === filterStatus);
    if (filterGroupId !== null) {
      if (filterGroupId === -1) {
        items = items.filter(c => !c.groupId);
      } else {
        items = items.filter(c => c.groupId === filterGroupId);
      }
    }
    return items;
  }, [clients, search, filterStatus, filterGroupId]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gestión de clientes, CUIT e impuestos asignados. Motor AFIP para generación automática de vencimientos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setGroupManagerOpen(true)}>
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Grupos
            </Button>
          )}
          <Button onClick={openCreate} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nuevo cliente
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
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

        {/* Group filter chips */}
        {groups.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Grupo:</span>
            <button
              onClick={() => setFilterGroupId(null)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                filterGroupId === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterGroupId(prev => prev === -1 ? null : -1)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                filterGroupId === -1
                  ? "bg-muted text-foreground border-foreground/30"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
            >
              Sin grupo
            </button>
            {groups.map(g => {
              const cfg = getGroupColor(g.color);
              const active = filterGroupId === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setFilterGroupId(prev => prev === g.id ? null : g.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                    active ? `${cfg.bg} ${cfg.text} border-current` : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                  {g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border-2 border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia>
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </EmptyMedia>
          </EmptyHeader>
          <EmptyContent>
            <EmptyTitle>{search || filterStatus !== "all" || filterGroupId !== null ? "Sin resultados" : "No hay clientes"}</EmptyTitle>
            <EmptyDescription>
              {search || filterStatus !== "all" || filterGroupId !== null
                ? "Probá cambiando los filtros."
                : "Creá tu primer cliente para empezar a gestionar vencimientos AFIP."}
            </EmptyDescription>
          </EmptyContent>
          {!search && filterStatus === "all" && filterGroupId === null && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Nuevo cliente
            </Button>
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map(client => {
            const isExpanded = expandedId === client.id;
            const assignedTaxes = client.taxAssignments.filter(t => t.enabled);
            const isGenerating = generatingId === client.id;
            const lastResult = generateResultClientId === client.id ? generateResult : null;

            return (
              <Card key={client.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardHeader className="p-4 pb-2 space-y-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm truncate">{client.name}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[client.status] ?? STATUS_BADGE.inactive}`}>
                          {client.status === "active" ? "Activo" : "Inactivo"}
                        </span>
                        {client.group && <GroupBadge group={client.group} />}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{formatCuit(client.cuit)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(client)}
                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Editar"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(client.id)}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  {(client.email || client.phone) && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {client.email && <span className="truncate">{client.email}</span>}
                      {client.phone && <span>{client.phone}</span>}
                    </div>
                  )}

                  {assignedTaxes.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                        Impuestos asignados ({assignedTaxes.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {assignedTaxes.slice(0, isExpanded ? undefined : 4).map(t => {
                          const taxInfo = TAX_TYPES.find(tt => tt.key === t.taxType);
                          return (
                            <span key={t.id} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
                              {taxInfo?.label ?? t.taxType}
                            </span>
                          );
                        })}
                        {!isExpanded && assignedTaxes.length > 4 && (
                          <button onClick={() => setExpandedId(client.id)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                            +{assignedTaxes.length - 4} más
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {lastResult && (
                    <div className={`text-xs rounded-lg px-3 py-2 ${lastResult.errors.length > 0 ? "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300" : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300"}`}>
                      <span className="font-semibold">{lastResult.generated}</span> generados ·{" "}
                      <span>{lastResult.skipped}</span> ya existían
                      {lastResult.errors.length > 0 && (
                        <span className="block mt-0.5 text-[10px] opacity-80">{lastResult.errors.slice(0, 2).join(", ")}</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : client.id)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isExpanded ? "Menos" : "Ver más"}
                    </button>
                    <button
                      onClick={() => handleGenerateDueDates(client.id)}
                      disabled={isGenerating}
                      className="ml-auto flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium disabled:opacity-50"
                    >
                      {isGenerating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      {isGenerating ? "Generando..." : "Generar AFIP"}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 border-t pt-3">
                      {client.notes && (
                        <p className="text-xs text-muted-foreground italic">{client.notes}</p>
                      )}
                      <div className="text-[10px] text-muted-foreground space-y-1">
                        <p>CUIT: <span className="font-mono">{formatCuit(client.cuit)}</span> · Terminación: <strong>{cuitLastDigit(client.cuit)}</strong></p>
                        <p>Creado: {new Date(client.createdAt).toLocaleDateString("es-AR")}</p>
                      </div>
                      {/* Presupuestos y Cobranzas del cliente */}
                      <div className="border-t pt-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Presupuestos y Cobranzas
                        </p>
                        <ClientQuotesSummary clientId={client.id} clientName={client.name} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center gap-1"><FolderOpen className="h-3 w-3" />Grupo de clientes</span>
                </label>
                <GroupSelector
                  groups={groups}
                  value={form.groupId}
                  onChange={id => setForm(f => ({ ...f, groupId: id }))}
                  onGroupCreated={() => { qc.invalidateQueries({ queryKey: ["client-groups"] }); refetchGroups(); }}
                />
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

      {/* Group Manager */}
      <GroupManagerDialog
        open={groupManagerOpen}
        onClose={() => setGroupManagerOpen(false)}
        groups={groups}
        onRefresh={() => { qc.invalidateQueries({ queryKey: ["client-groups"] }); qc.invalidateQueries({ queryKey: ["clients"] }); refetchGroups(); }}
      />

      {/* Info strip */}
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
