/**
 * Studio Generation Engine v1
 * Heuristic prompt parser — no LLM required.
 * Produces a valid dashboard config from free-text, template key, or wizard input.
 */

export interface ParsedIntent {
  domain: string;
  secondaryDomains: string[];
  entities: string[];
  intention: string;
  confidence: number;
}

export interface SuggestedWidget {
  type: string;
  title: string;
  dataSourceKey: string | null;
  configJson: Record<string, unknown>;
  orderIndex: number;
}

export interface SuggestedFilter {
  key: string;
  label: string;
  type: string;
  defaultValueJson?: unknown;
}

export interface GeneratedDashboard {
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  widgets: SuggestedWidget[];
  filters: SuggestedFilter[];
  parsedIntent: ParsedIntent;
}

// ── Domain / keyword maps ─────────────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  clientes: ["cliente", "clientes", "cartera", "contribuyente"],
  fiscal: ["vencimiento", "vencimientos", "impuesto", "afip", "fiscal", "iva", "ganancias", "monotributo", "declaracion"],
  finanzas: ["finanza", "finanzas", "gasto", "gastos", "ingreso", "ingresos", "presupuesto", "ahorro", "dinero", "costo", "deuda"],
  noticias: ["noticia", "noticias", "economia", "economía", "política", "politica", "mercado", "inflacion", "inflación", "dolar"],
  tareas: ["tarea", "tareas", "pendiente", "pendientes", "equipo", "proyecto", "productividad"],
  ejecutivo: ["ejecutivo", "direccion", "dirección", "gerencia", "resumen ejecutivo", "kpi", "general"],
  familiar: ["familiar", "familia", "hogar", "casa"],
  obras: ["obra", "obras", "proveedor", "proveedores", "construccion", "construcción"],
  comercial: ["comercial", "venta", "ventas", "cliente potencial", "seguimiento"],
};

const DOMAIN_ICONS: Record<string, string> = {
  clientes: "👥",
  fiscal: "📋",
  finanzas: "💰",
  noticias: "📰",
  tareas: "✅",
  ejecutivo: "🎯",
  familiar: "🏠",
  obras: "🔨",
  comercial: "📈",
  default: "📊",
};

const DOMAIN_COLORS: Record<string, string> = {
  clientes: "#3b82f6",
  fiscal: "#f59e0b",
  finanzas: "#10b981",
  noticias: "#6366f1",
  tareas: "#ec4899",
  ejecutivo: "#8b5cf6",
  familiar: "#f97316",
  obras: "#64748b",
  comercial: "#06b6d4",
  default: "#6b7280",
};

// ── Widget presets by domain ──────────────────────────────────────────────────

function widgetsForDomain(
  domain: string,
  secondary: string[]
): SuggestedWidget[] {
  const all = [domain, ...secondary];
  const widgets: SuggestedWidget[] = [];
  let idx = 0;

  const add = (w: Omit<SuggestedWidget, "orderIndex">) =>
    widgets.push({ ...w, orderIndex: idx++ });

  // ── clientes ──
  if (all.includes("clientes")) {
    add({ type: "kpi_cards", title: "Resumen de Clientes", dataSourceKey: "clients.summary", configJson: { metric: "total" } });
    add({ type: "dynamic_table", title: "Listado de Clientes", dataSourceKey: "clients.list", configJson: { columns: ["name", "cuit", "isActive"] } });
  }

  // ── fiscal ──
  if (all.includes("fiscal") || all.includes("clientes")) {
    add({ type: "traffic_light", title: "Semáforo de Vencimientos", dataSourceKey: "dueDates.trafficLight", configJson: {} });
    add({ type: "upcoming_due_dates", title: "Próximos Vencimientos", dataSourceKey: "dueDates.upcoming", configJson: { limit: 10 } });
    add({ type: "alerts_list", title: "Alertas Fiscales", dataSourceKey: "dueDates.upcoming", configJson: { daysAhead: 7 } });
  }

  // ── finanzas ──
  if (all.includes("finanzas") || all.includes("familiar")) {
    add({ type: "kpi_cards", title: "Resumen Financiero", dataSourceKey: "finance.summary", configJson: {} });
    add({ type: "expense_categories", title: "Gastos por Categoría", dataSourceKey: "finance.transactions.recent", configJson: { groupBy: "category" } });
    add({ type: "recent_transactions", title: "Movimientos Recientes", dataSourceKey: "finance.transactions.recent", configJson: { limit: 8 } });
    add({ type: "goals_progress", title: "Objetivos Financieros", dataSourceKey: "finance.goals.progress", configJson: {} });
    if (all.includes("finanzas")) {
      add({ type: "bar_chart", title: "Ingresos vs Gastos", dataSourceKey: "finance.transactions.recent", configJson: { chartType: "bar", groupBy: "month" } });
    }
  }

  // ── noticias ──
  if (all.includes("noticias")) {
    add({ type: "news_feed", title: "Últimas Noticias", dataSourceKey: "news.feed", configJson: { limit: 8 } });
    add({ type: "smart_summary", title: "Resumen de Impacto", dataSourceKey: "news.priority", configJson: {} });
    add({ type: "ranking", title: "Noticias Más Relevantes", dataSourceKey: "news.priority", configJson: { limit: 5 } });
  }

  // ── tareas ──
  if (all.includes("tareas")) {
    add({ type: "pending_tasks", title: "Mis Tareas Pendientes", dataSourceKey: "tasks.myOpen", configJson: { limit: 8 } });
    add({ type: "ranking", title: "Productividad del Equipo", dataSourceKey: "tasks.teamBoard", configJson: {} });
    add({ type: "recent_activity", title: "Actividad Reciente", dataSourceKey: "audit.activity", configJson: {} });
  }

  // ── ejecutivo ──
  if (all.includes("ejecutivo")) {
    add({ type: "kpi_cards", title: "KPIs Principales", dataSourceKey: "clients.summary", configJson: { mode: "executive" } });
    add({ type: "alerts_list", title: "Alertas del Sistema", dataSourceKey: "system.notifications", configJson: {} });
    add({ type: "smart_summary", title: "Resumen Inteligente", dataSourceKey: "news.priority", configJson: {} });
    add({ type: "recent_activity", title: "Actividad Reciente", dataSourceKey: "audit.activity", configJson: {} });
    add({ type: "traffic_light", title: "Semáforo Fiscal", dataSourceKey: "dueDates.trafficLight", configJson: {} });
  }

  // ── fallback ──
  if (widgets.length === 0) {
    add({ type: "kpi_cards", title: "Indicadores", dataSourceKey: "clients.summary", configJson: {} });
    add({ type: "recent_activity", title: "Actividad Reciente", dataSourceKey: "audit.activity", configJson: {} });
    add({ type: "quick_links", title: "Accesos Rápidos", dataSourceKey: "static.links", configJson: { links: [] } });
  }

  return widgets;
}

// ── Filter suggestions ────────────────────────────────────────────────────────

function filtersForDomain(domain: string): SuggestedFilter[] {
  const filters: SuggestedFilter[] = [];
  if (["fiscal", "clientes", "finanzas"].includes(domain)) {
    filters.push({ key: "date_range", label: "Período", type: "date_range" });
  }
  if (domain === "clientes") {
    filters.push({ key: "client_status", label: "Estado del cliente", type: "select", defaultValueJson: "active" });
  }
  if (domain === "noticias") {
    filters.push({ key: "news_category", label: "Categoría", type: "select" });
  }
  return filters;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export function parseIntent(prompt: string): ParsedIntent {
  const normalized = prompt.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^\w\s]/g, " ");

  const scores: Record<string, number> = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[domain] = keywords.reduce((acc, kw) => {
      const re = new RegExp(kw, "g");
      return acc + (normalized.match(re)?.length ?? 0);
    }, 0);
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topDomain, topScore] = sorted[0] ?? ["ejecutivo", 0];
  const secondary = sorted.slice(1, 3).filter(([, s]) => s > 0).map(([d]) => d);

  // Extract entities (words after common prepositions)
  const entityMatch = normalized.match(/(?:de|para|sobre|con)\s+(\w+)/g) ?? [];
  const entities = entityMatch.map(m => m.split(/\s+/).pop()!).filter(Boolean);

  // Determine intention
  let intention = "overview";
  if (/monitoreo|monitor|seguimiento/.test(normalized)) intention = "monitoring";
  else if (/ejecutivo|gerencia|kpi/.test(normalized)) intention = "executive";
  else if (/personal|familia|hogar/.test(normalized)) intention = "personal";
  else if (/equipo|colaboraci/.test(normalized)) intention = "team";

  return {
    domain: topDomain,
    secondaryDomains: secondary,
    entities,
    intention,
    confidence: Math.min(topScore / 3, 1),
  };
}

// ── Generate ──────────────────────────────────────────────────────────────────

export function generateFromPrompt(prompt: string): GeneratedDashboard {
  const intent = parseIntent(prompt);
  const { domain, secondaryDomains } = intent;

  // Build name from prompt (take first sentence / first 50 chars)
  const rawName = prompt.split(/[.,!?]/)[0]?.trim() ?? prompt;
  const name = rawName.length > 60 ? rawName.slice(0, 57) + "..." : rawName;

  const widgets = widgetsForDomain(domain, secondaryDomains);
  const filters = filtersForDomain(domain);

  return {
    name,
    description: `Dashboard generado desde prompt. Dominio principal: ${domain}.`,
    icon: DOMAIN_ICONS[domain] ?? DOMAIN_ICONS.default,
    color: DOMAIN_COLORS[domain] ?? DOMAIN_COLORS.default,
    category: domain,
    widgets,
    filters,
    parsedIntent: intent,
  };
}

// ── Generate from template config ─────────────────────────────────────────────

export interface TemplateConfig {
  widgets: SuggestedWidget[];
  filters: SuggestedFilter[];
  metadata?: Record<string, unknown>;
}

export function generateFromTemplate(config: TemplateConfig): GeneratedDashboard {
  return {
    name: "Dashboard desde plantilla",
    description: "Dashboard creado a partir de una plantilla.",
    icon: "📋",
    color: "#6b7280",
    category: "general",
    widgets: config.widgets,
    filters: config.filters,
    parsedIntent: {
      domain: "general",
      secondaryDomains: [],
      entities: [],
      intention: "template",
      confidence: 1,
    },
  };
}

// ── Generate from wizard ──────────────────────────────────────────────────────

export interface WizardInput {
  name: string;
  category: string;
  icon?: string;
  color?: string;
  description?: string;
  selectedWidgets: Array<{ type: string; title: string; dataSourceKey?: string; configJson?: Record<string, unknown> }>;
  selectedFilters?: SuggestedFilter[];
}

export function generateFromWizard(input: WizardInput): GeneratedDashboard {
  return {
    name: input.name,
    description: input.description ?? "",
    icon: input.icon ?? DOMAIN_ICONS.default,
    color: input.color ?? DOMAIN_COLORS.default,
    category: input.category,
    widgets: input.selectedWidgets.map((w, i) => ({
      type: w.type,
      title: w.title,
      dataSourceKey: w.dataSourceKey ?? null,
      configJson: w.configJson ?? {},
      orderIndex: i,
    })),
    filters: input.selectedFilters ?? [],
    parsedIntent: {
      domain: input.category,
      secondaryDomains: [],
      entities: [],
      intention: "wizard",
      confidence: 1,
    },
  };
}

// ── Layout generator ──────────────────────────────────────────────────────────

export function buildDefaultLayouts(widgets: SuggestedWidget[]) {
  const desktop = widgets.map((w, i) => ({
    id: `widget-${i}`,
    widgetIndex: i,
    x: (i % 3) * 4,
    y: Math.floor(i / 3) * 4,
    w: 4,
    h: 4,
  }));

  // Mobile: stack all full-width
  const mobile = widgets.map((w, i) => ({
    id: `widget-${i}`,
    widgetIndex: i,
    x: 0,
    y: i * 5,
    w: 12,
    h: 5,
  }));

  return { desktop, mobile };
}
