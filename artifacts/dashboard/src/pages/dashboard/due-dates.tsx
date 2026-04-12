import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, CalendarClock, Plus, Pencil, Trash2,
  CheckCircle2, Circle, X, Tag, ChevronDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface DueDate {
  id: number;
  title: string;
  category: string;
  dueDate: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "done" | "cancelled";
  alertEnabled: boolean;
  recurrenceType?: string;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  isRecurrenceParent?: boolean;
  parentId?: number | null;
  source?: string;
  clientId?: number | null;
  createdAt: string;
}

interface DueDateCategory {
  id: number;
  name: string;
  color: string;
}

const PRIORITY_CONFIG = {
  low:      { label: "Baja",     color: "text-slate-500",  bg: "bg-slate-100 dark:bg-slate-800",   ring: "ring-slate-300" },
  medium:   { label: "Media",    color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-900/40", ring: "ring-amber-300" },
  high:     { label: "Alta",     color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/40",ring: "ring-orange-400" },
  critical: { label: "Crítica",  color: "text-red-600",    bg: "bg-red-100 dark:bg-red-900/40",    ring: "ring-red-400" },
};

const CATEGORY_COLORS: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  green:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  purple: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  teal:   "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  gray:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function getUrgency(dueDate: string, status: string): "overdue" | "today" | "soon" | "week" | "future" | "done" {
  if (status === "done" || status === "cancelled") return "done";
  const due = new Date(dueDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  if (diff <= 7) return "week";
  return "future";
}

const URGENCY_LABELS = {
  overdue: { label: "Vencidos",           className: "text-red-600 dark:text-red-400",    dot: "bg-red-500" },
  today:   { label: "Vence hoy",          className: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  soon:    { label: "Próximos 3 días",    className: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  week:    { label: "Esta semana",        className: "text-blue-600 dark:text-blue-400",   dot: "bg-blue-500" },
  future:  { label: "Más adelante",       className: "text-muted-foreground",              dot: "bg-muted-foreground/40" },
  done:    { label: "Completados",        className: "text-muted-foreground",              dot: "bg-muted-foreground/40" },
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function DueDateCard({
  item,
  categories,
  onEdit,
  onDelete,
  onToggleStatus,
}: {
  item: DueDate;
  categories: DueDateCategory[];
  onEdit: (item: DueDate) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (id: number, status: string) => void;
}) {
  const urgency = getUrgency(item.dueDate, item.status);
  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const cat = categories.find(c => c.name === item.category);
  const catColor = cat ? (CATEGORY_COLORS[cat.color] ?? CATEGORY_COLORS["gray"]) : CATEGORY_COLORS["gray"];

  return (
    <Card className={`transition-all border-l-4 ${
      urgency === "overdue" ? "border-l-red-500" :
      urgency === "today"   ? "border-l-orange-500" :
      urgency === "soon"    ? "border-l-amber-500" :
      urgency === "week"    ? "border-l-blue-500" :
      urgency === "done"    ? "border-l-muted-foreground/30 opacity-60" :
      "border-l-border/50"
    }`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => onToggleStatus(item.id, item.status === "done" ? "pending" : "done")}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
          >
            {item.status === "done"
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              : <Circle className="h-5 w-5" />
            }
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className={`font-medium text-sm leading-snug ${item.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                {item.title}
              </p>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onEdit(item)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${catColor}`}>
                {item.category}
              </span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityCfg.bg} ${priorityCfg.color}`}>
                {priorityCfg.label}
              </span>
              <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(item.dueDate)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface DueDateForm {
  title: string;
  category: string;
  dueDate: string;
  description: string;
  priority: DueDate["priority"];
  status: DueDate["status"];
  alertEnabled: boolean;
  recurrenceType: string;
  recurrenceRule: string;
  recurrenceEndDate: string;
}

const EMPTY_FORM: DueDateForm = {
  title: "",
  category: "",
  dueDate: "",
  description: "",
  priority: "medium",
  status: "pending",
  alertEnabled: true,
  recurrenceType: "none",
  recurrenceRule: "",
  recurrenceEndDate: "",
};

const RECURRENCE_TYPES = [
  { key: "none", label: "Sin periodicidad" },
  { key: "weekly", label: "Semanal" },
  { key: "monthly", label: "Mensual" },
  { key: "yearly", label: "Anual" },
  { key: "custom", label: "Personalizado" },
];

export default function DueDatesPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DueDate | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("blue");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "done">("all");
  const [filterCategory, setFilterCategory] = useState("");
  const [showDone, setShowDone] = useState(false);

  const { data: dueDates = [], isLoading } = useQuery<DueDate[]>({
    queryKey: ["due-dates"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-dates`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const { data: categories = [] } = useQuery<DueDateCategory[]>({
    queryKey: ["due-date-categories"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/due-date-categories`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_FORM) => {
      const res = await fetch(`${BASE}/api/due-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["due-dates"] }); setDialogOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof EMPTY_FORM> }) => {
      const res = await fetch(`/api/due-dates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["due-dates"] }); setDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/due-dates/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["due-dates"] }),
  });

  const createCatMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const res = await fetch(`${BASE}/api/due-date-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["due-date-categories"] }); setNewCatName(""); setCatDialogOpen(false); },
  });

  const deleteCatMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/due-date-categories/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["due-date-categories"] }),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: categories[0]?.name ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (item: DueDate) => {
    setEditing(item);
    setForm({
      title: item.title,
      category: item.category,
      dueDate: item.dueDate,
      description: item.description ?? "",
      priority: item.priority,
      status: item.status,
      alertEnabled: item.alertEnabled,
      recurrenceType: item.recurrenceType ?? "none",
      recurrenceRule: item.recurrenceRule ?? "",
      recurrenceEndDate: item.recurrenceEndDate ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.dueDate) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleToggleStatus = (id: number, status: string) => {
    updateMutation.mutate({ id, data: { status: status as DueDateForm["status"] } });
  };

  const filtered = useMemo(() => {
    let items = dueDates;
    if (filterCategory) items = items.filter(d => d.category === filterCategory);
    return items;
  }, [dueDates, filterCategory]);

  const grouped = useMemo(() => {
    const groups: Record<string, DueDate[]> = {
      overdue: [],
      today: [],
      soon: [],
      week: [],
      future: [],
      done: [],
    };
    filtered.forEach(item => {
      const u = getUrgency(item.dueDate, item.status);
      groups[u].push(item);
    });
    return groups;
  }, [filtered]);

  const criticalCount = grouped.overdue.length + grouped.today.length;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Skeleton className="h-9 w-56" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const urgencyOrder: Array<keyof typeof URGENCY_LABELS> = ["overdue", "today", "soon", "week", "future"];

  return (
    <div className="max-w-3xl space-y-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight flex items-center gap-2">
            Vencimientos
            {criticalCount > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                {criticalCount}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {filtered.filter(d => d.status === "pending").length} pendientes · {filtered.filter(d => d.status === "done").length} completados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setCatDialogOpen(true)}>
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Categorías
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nuevo vencimiento
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 pb-5">
        <button
          onClick={() => setFilterCategory("")}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
            !filterCategory
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
          }`}
        >
          Todas
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilterCategory(cat.name === filterCategory ? "" : cat.name)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              filterCategory === cat.name
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Urgency groups */}
      {dueDates.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
          <CalendarClock className="h-10 w-10 text-muted-foreground/25 mb-4" />
          <h3 className="text-base font-semibold mb-1">Sin vencimientos</h3>
          <p className="text-muted-foreground text-sm mb-5">Agregá fechas importantes para no olvidar nada.</p>
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Agregar vencimiento
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {urgencyOrder.map(u => {
            const items = grouped[u];
            if (items.length === 0) return null;
            const cfg = URGENCY_LABELS[u];
            return (
              <div key={u}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${cfg.className}`}>
                    {cfg.label} ({items.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {items.map(item => (
                    <DueDateCard
                      key={item.id}
                      item={item}
                      categories={categories}
                      onEdit={openEdit}
                      onDelete={id => deleteMutation.mutate(id)}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Completed section */}
          {grouped.done.length > 0 && (
            <div>
              <button
                onClick={() => setShowDone(!showDone)}
                className="flex items-center gap-2 mb-3 group"
              >
                <div className={`h-2 w-2 rounded-full ${URGENCY_LABELS.done.dot}`} />
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${URGENCY_LABELS.done.className}`}>
                  Completados ({grouped.done.length})
                </h3>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showDone ? "rotate-180" : ""}`} />
              </button>
              {showDone && (
                <div className="space-y-2">
                  {grouped.done.map(item => (
                    <DueDateCard
                      key={item.id}
                      item={item}
                      categories={categories}
                      onEdit={openEdit}
                      onDelete={id => deleteMutation.mutate(id)}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* New/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar vencimiento" : "Nuevo vencimiento"}</DialogTitle>
            <DialogDescription>Completá los datos del vencimiento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                placeholder="Ej: Declaración IVA diciembre"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de vencimiento *</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as DueDate["priority"] }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as DueDate["status"] }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="pending">Pendiente</option>
                  <option value="done">Completado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción <span className="text-muted-foreground text-xs font-normal">(opcional)</span></Label>
              <Input
                placeholder="Notas adicionales..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Recurrence section */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Periodicidad</Label>
                {form.recurrenceType !== "none" && (
                  <span className="text-[9px] text-muted-foreground/70 italic">Guarda el tipo; las instancias futuras se pueden generar desde la vista de vencimientos.</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RECURRENCE_TYPES.map(rt => (
                  <button
                    key={rt.key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, recurrenceType: rt.key }))}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150
                      ${form.recurrenceType === rt.key
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted/60 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                      }`}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>
              {form.recurrenceType !== "none" && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {form.recurrenceType === "custom" && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-[10px] text-muted-foreground">Descripción de la regla (ej: "los días 5 y 20 de cada mes")</p>
                      <Input
                        placeholder="Ej: días 5 y 20 de cada mes"
                        value={form.recurrenceRule}
                        onChange={e => setForm(f => ({ ...f, recurrenceRule: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                  {form.recurrenceType !== "custom" && (
                    <div className="col-span-2 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                      {form.recurrenceType === "weekly" && "Se repetirá cada semana el mismo día."}
                      {form.recurrenceType === "monthly" && "Se repetirá todos los meses el mismo día."}
                      {form.recurrenceType === "yearly" && "Se repetirá una vez al año en la misma fecha."}
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Fecha fin (opcional)</p>
                    <Input
                      type="date"
                      value={form.recurrenceEndDate}
                      onChange={e => setForm(f => ({ ...f, recurrenceEndDate: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title.trim() || !form.dueDate || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Categories Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Categorías de vencimientos</DialogTitle>
            <DialogDescription>Gestioná las categorías disponibles.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Input
                placeholder="Nueva categoría..."
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                className="flex-1"
              />
              <select
                value={newCatColor}
                onChange={e => setNewCatColor(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {Object.keys(CATEGORY_COLORS).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => {
                  if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim(), color: newCatColor });
                }}
                disabled={!newCatName.trim() || createCatMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {categories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/60">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${CATEGORY_COLORS[cat.color] ?? CATEGORY_COLORS["gray"]}`}>
                    {cat.name}
                  </span>
                  <button
                    onClick={() => deleteCatMutation.mutate(cat.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
