import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, AlertTriangle, Plus, Pencil, Trash2,
  Check, X, Wallet, Building2, Bitcoin, BarChart3, CreditCard, RefreshCw,
  ShieldAlert, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer, Legend,
} from "recharts";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface FinanceAccount {
  id: number;
  type: string;
  label: string;
  amount: string;
  currency: string;
  notes: string | null;
  updatedAt: string;
}

interface FinanceSummary {
  patrimonio: number;
  liquidez: number;
  inversiones: number;
  deudas: number;
  accounts: FinanceAccount[];
  alerts: { type: string; level: string; message: string }[];
  config: Record<string, string>;
}

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string; pieColor: string }> = {
  caja:        { label: "Caja",        icon: Wallet,    color: "text-emerald-600 dark:text-emerald-400", pieColor: "#10b981" },
  banco:       { label: "Banco",       icon: Building2, color: "text-blue-600 dark:text-blue-400",    pieColor: "#3b82f6" },
  cripto:      { label: "Cripto",      icon: Bitcoin,   color: "text-amber-600 dark:text-amber-400",  pieColor: "#f59e0b" },
  inversiones: { label: "Inversiones", icon: BarChart3, color: "text-violet-600 dark:text-violet-400",pieColor: "#8b5cf6" },
  deuda:       { label: "Deuda",       icon: CreditCard,color: "text-red-600 dark:text-red-400",     pieColor: "#ef4444" },
};

const ALERT_STYLES: Record<string, { bg: string; icon: React.ElementType }> = {
  critical: { bg: "border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800",     icon: ShieldAlert },
  high:     { bg: "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800", icon: AlertTriangle },
  medium:   { bg: "border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800",   icon: Info },
};

function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface AccountFormData {
  type: string;
  label: string;
  amount: string;
  currency: string;
  notes: string;
}

const EMPTY_FORM: AccountFormData = { type: "caja", label: "", amount: "0", currency: "ARS", notes: "" };

export default function FinancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<AccountFormData>(EMPTY_FORM);
  const [configEditing, setConfigEditing] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const { data: summary, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["finance-summary"],
    queryFn: () => fetch(`${BASE}/api/finance/summary`).then(r => r.ok ? r.json() : Promise.reject("Error")),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: AccountFormData) =>
      fetch(`${BASE}/api/finance/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, amount: parseFloat(data.amount) || 0 }),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-summary"] }); setDialogOpen(false); toast({ title: "Cuenta creada" }); },
    onError: () => toast({ title: "Error al crear cuenta", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountFormData }) =>
      fetch(`${BASE}/api/finance/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, amount: parseFloat(data.amount) || 0 }),
      }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-summary"] }); setDialogOpen(false); toast({ title: "Cuenta actualizada" }); },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/finance/accounts/${id}`, { method: "DELETE" }).then(r => r.ok ? r.json() : Promise.reject("Error")),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-summary"] }); toast({ title: "Cuenta eliminada" }); },
    onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
  });

  const configMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      for (const [key, value] of Object.entries(values)) {
        await fetch(`${BASE}/api/finance/config/${key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-summary"] }); setConfigEditing(false); toast({ title: "Configuración guardada" }); },
    onError: () => toast({ title: "Error al guardar configuración", variant: "destructive" }),
  });

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(a: FinanceAccount) {
    setForm({ type: a.type, label: a.label, amount: a.amount, currency: a.currency, notes: a.notes ?? "" });
    setEditId(a.id);
    setDialogOpen(true);
  }

  function submitForm() {
    if (editId !== null) updateMutation.mutate({ id: editId, data: form });
    else createMutation.mutate(form);
  }

  function startConfigEdit() {
    setConfigValues(summary?.config ?? {});
    setConfigEditing(true);
  }

  const accounts = summary?.accounts ?? [];
  const totalByType = Object.entries(TYPE_META).map(([type, meta]) => {
    const sum = accounts.filter(a => a.type === type).reduce((acc, a) => acc + parseFloat(a.amount), 0);
    return { name: meta.label, value: Math.abs(sum), color: meta.pieColor, type };
  }).filter(d => d.value > 0);

  const CONFIG_LABELS: Record<string, string> = {
    gasto_mensual_umbral: "Umbral de gasto mensual (ARS)",
    liquidez_minima: "Liquidez mínima (ARS)",
    alerta_deuda_umbral: "Umbral de deuda (ARS)",
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
        </div>
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finanzas</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Resumen patrimonial personal</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["finance-summary"] })}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Actualizar
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nueva cuenta
          </Button>
        </div>
      </div>

      {summary?.alerts && summary.alerts.length > 0 && (
        <div className="space-y-2">
          {summary.alerts.map((alert, i) => {
            const styles = ALERT_STYLES[alert.level] ?? ALERT_STYLES.medium;
            const Icon = styles.icon;
            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${styles.bg}`}>
                <Icon className="h-4 w-4 shrink-0 text-current" />
                <p className="text-sm font-medium">{alert.message}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Patrimonio neto"
          value={fmt(summary?.patrimonio ?? 0)}
          sub={summary?.patrimonio !== undefined && summary.patrimonio >= 0 ? "Posición positiva" : "Posición negativa"}
          accent={(summary?.patrimonio ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
        />
        <SummaryCard
          label="Liquidez"
          value={fmt(summary?.liquidez ?? 0)}
          sub="Caja + Bancos"
          accent={(summary?.liquidez ?? 0) >= parseFloat(summary?.config?.liquidez_minima ?? "0")
            ? "text-blue-600 dark:text-blue-400"
            : "text-red-600 dark:text-red-400"}
        />
        <SummaryCard
          label="Inversiones"
          value={fmt(summary?.inversiones ?? 0)}
          sub="Cripto + mercados"
          accent="text-violet-600 dark:text-violet-400"
        />
        <SummaryCard
          label="Deudas"
          value={fmt(summary?.deudas ?? 0)}
          sub="Total pasivo"
          accent={(summary?.deudas ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Cuentas y posiciones</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Sin cuentas registradas</p>
                <p className="text-xs text-muted-foreground">Agregá caja, banco, cripto o inversiones para ver tu patrimonio</p>
                <Button size="sm" variant="outline" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Agregar cuenta
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(TYPE_META).map(([type, meta]) => {
                  const items = accounts.filter(a => a.type === type);
                  if (items.length === 0) return null;
                  const Icon = meta.icon;
                  return (
                    <div key={type}>
                      <div className="flex items-center gap-2 mb-1.5 mt-3 first:mt-0">
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                      </div>
                      {items.map(account => (
                        <div key={account.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/60 group transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{account.label}</p>
                            {account.notes && <p className="text-xs text-muted-foreground truncate">{account.notes}</p>}
                          </div>
                          <div className="flex items-center gap-3 ml-3">
                            <span className={`text-sm font-semibold tabular-nums ${meta.color}`}>
                              {account.currency} {fmt(parseFloat(account.amount))}
                            </span>
                            <div className="hidden group-hover:flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(account)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={() => deleteMutation.mutate(account.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <Separator className="mt-2" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {totalByType.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Distribución</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={totalByType} cx="50%" cy="50%" innerRadius={40} outerRadius={72} paddingAngle={3} dataKey="value">
                      {totalByType.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartTooltip
                      formatter={(v: number) => [fmt(v), ""]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Alertas y umbrales</CardTitle>
              {!configEditing && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={startConfigEdit}>
                  <Pencil className="h-3 w-3 mr-1" />
                  Editar
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {configEditing ? (
                <div className="space-y-3">
                  {Object.entries(CONFIG_LABELS).map(([key, label]) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <Input
                        type="number"
                        value={configValues[key] ?? ""}
                        onChange={e => setConfigValues(prev => ({ ...prev, [key]: e.target.value }))}
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => configMutation.mutate(configValues)}>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfigEditing(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(CONFIG_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-semibold tabular-nums">
                        {summary?.config?.[key] ? fmt(parseFloat(summary.config[key])) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Editar cuenta" : "Nueva cuenta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre / descripción</Label>
              <Input
                className="mt-1"
                placeholder="Ej: Caja chica oficina"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monto</Label>
                <Input
                  type="number"
                  className="mt-1"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <Label>Moneda</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS — Pesos</SelectItem>
                    <SelectItem value="USD">USD — Dólares</SelectItem>
                    <SelectItem value="USDT">USDT — Tether</SelectItem>
                    <SelectItem value="BTC">BTC — Bitcoin</SelectItem>
                    <SelectItem value="EUR">EUR — Euros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notas (opcional)</Label>
              <Input
                className="mt-1"
                placeholder="Observaciones..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={submitForm} disabled={!form.label || createMutation.isPending || updateMutation.isPending}>
              {editId !== null ? "Guardar cambios" : "Crear cuenta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
