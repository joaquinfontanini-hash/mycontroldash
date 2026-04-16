/**
 * Dashboard template catalog — seeded once at startup.
 */
import { db, dashboardTemplatesTable } from "@workspace/db";
import { logger } from "./logger.js";

const TEMPLATES = [
  {
    key: "control_fiscal_clientes",
    name: "Control Fiscal de Clientes",
    description: "Monitoreo de vencimientos, semáforo fiscal y estado por cliente",
    category: "fiscal",
    icon: "📋",
    color: "#f59e0b",
    configJson: {
      widgets: [
        { type: "traffic_light", title: "Semáforo de Vencimientos", dataSourceKey: "dueDates.trafficLight", configJson: {}, orderIndex: 0 },
        { type: "upcoming_due_dates", title: "Próximos Vencimientos", dataSourceKey: "dueDates.upcoming", configJson: { limit: 10 }, orderIndex: 1 },
        { type: "kpi_cards", title: "Resumen de Clientes", dataSourceKey: "clients.summary", configJson: {}, orderIndex: 2 },
        { type: "dynamic_table", title: "Listado de Clientes", dataSourceKey: "clients.list", configJson: { columns: ["name", "cuit", "isActive"] }, orderIndex: 3 },
        { type: "alerts_list", title: "Alertas Fiscales", dataSourceKey: "dueDates.upcoming", configJson: { daysAhead: 7 }, orderIndex: 4 },
      ],
      filters: [
        { key: "date_range", label: "Período", type: "date_range" },
        { key: "client_status", label: "Estado del cliente", type: "select", defaultValueJson: "active" },
      ],
    },
  },
  {
    key: "finanzas_personales",
    name: "Finanzas Personales",
    description: "Resumen de ingresos, gastos, presupuestos y objetivos",
    category: "finanzas",
    icon: "💰",
    color: "#10b981",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "Resumen Financiero", dataSourceKey: "finance.summary", configJson: {}, orderIndex: 0 },
        { type: "expense_categories", title: "Gastos por Categoría", dataSourceKey: "finance.transactions.recent", configJson: { groupBy: "category" }, orderIndex: 1 },
        { type: "recent_transactions", title: "Movimientos Recientes", dataSourceKey: "finance.transactions.recent", configJson: { limit: 8 }, orderIndex: 2 },
        { type: "goals_progress", title: "Objetivos Financieros", dataSourceKey: "finance.goals.progress", configJson: {}, orderIndex: 3 },
        { type: "bar_chart", title: "Ingresos vs Gastos", dataSourceKey: "finance.transactions.recent", configJson: { groupBy: "month" }, orderIndex: 4 },
      ],
      filters: [
        { key: "date_range", label: "Período", type: "date_range" },
      ],
    },
  },
  {
    key: "noticias_economia",
    name: "Noticias Económicas y Políticas",
    description: "Monitor de noticias de alto impacto, ranking y análisis",
    category: "noticias",
    icon: "📰",
    color: "#6366f1",
    configJson: {
      widgets: [
        { type: "news_feed", title: "Últimas Noticias", dataSourceKey: "news.feed", configJson: { limit: 10 }, orderIndex: 0 },
        { type: "ranking", title: "Noticias Más Relevantes", dataSourceKey: "news.priority", configJson: { limit: 5 }, orderIndex: 1 },
        { type: "smart_summary", title: "Resumen de Impacto", dataSourceKey: "news.priority", configJson: {}, orderIndex: 2 },
        { type: "alerts_list", title: "Alertas Económicas", dataSourceKey: "system.notifications", configJson: {}, orderIndex: 3 },
      ],
      filters: [
        { key: "news_category", label: "Categoría", type: "select" },
      ],
    },
  },
  {
    key: "direccion_ejecutiva",
    name: "Dirección Ejecutiva",
    description: "KPIs principales, alertas, actividad y resumen inteligente",
    category: "ejecutivo",
    icon: "🎯",
    color: "#8b5cf6",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "KPIs Principales", dataSourceKey: "clients.summary", configJson: { mode: "executive" }, orderIndex: 0 },
        { type: "traffic_light", title: "Semáforo Fiscal", dataSourceKey: "dueDates.trafficLight", configJson: {}, orderIndex: 1 },
        { type: "smart_summary", title: "Resumen Inteligente", dataSourceKey: "news.priority", configJson: {}, orderIndex: 2 },
        { type: "alerts_list", title: "Alertas del Sistema", dataSourceKey: "system.notifications", configJson: {}, orderIndex: 3 },
        { type: "recent_activity", title: "Actividad Reciente", dataSourceKey: "audit.activity", configJson: {}, orderIndex: 4 },
      ],
      filters: [],
    },
  },
  {
    key: "gestion_familiar",
    name: "Gestión Familiar",
    description: "Panel del hogar: finanzas, tareas y objetivos familiares",
    category: "personal",
    icon: "🏠",
    color: "#f97316",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "Finanzas del Hogar", dataSourceKey: "finance.summary", configJson: {}, orderIndex: 0 },
        { type: "recent_transactions", title: "Gastos del Mes", dataSourceKey: "finance.transactions.recent", configJson: { limit: 6 }, orderIndex: 1 },
        { type: "pending_tasks", title: "Tareas del Hogar", dataSourceKey: "tasks.myOpen", configJson: { limit: 8 }, orderIndex: 2 },
        { type: "goals_progress", title: "Objetivos Familiares", dataSourceKey: "finance.goals.progress", configJson: {}, orderIndex: 3 },
        { type: "quick_links", title: "Links Rápidos", dataSourceKey: "static.links", configJson: { links: [] }, orderIndex: 4 },
      ],
      filters: [
        { key: "date_range", label: "Período", type: "date_range" },
      ],
    },
  },
  {
    key: "tareas_productividad",
    name: "Tareas y Productividad",
    description: "Panel de productividad personal y del equipo",
    category: "productividad",
    icon: "✅",
    color: "#ec4899",
    configJson: {
      widgets: [
        { type: "pending_tasks", title: "Mis Tareas Pendientes", dataSourceKey: "tasks.myOpen", configJson: { limit: 10 }, orderIndex: 0 },
        { type: "checklist", title: "Checklist del Día", dataSourceKey: "static.text", configJson: { items: [] }, orderIndex: 1 },
        { type: "ranking", title: "Productividad del Equipo", dataSourceKey: "tasks.teamBoard", configJson: {}, orderIndex: 2 },
        { type: "recent_activity", title: "Actividad Reciente", dataSourceKey: "audit.activity", configJson: {}, orderIndex: 3 },
      ],
      filters: [],
    },
  },
  {
    key: "obras_proveedores",
    name: "Obras y Proveedores",
    description: "Panel de seguimiento de obras, pagos y proveedores",
    category: "operaciones",
    icon: "🔨",
    color: "#64748b",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "Resumen de Proveedores", dataSourceKey: "clients.summary", configJson: {}, orderIndex: 0 },
        { type: "dynamic_table", title: "Proveedores Activos", dataSourceKey: "clients.list", configJson: {}, orderIndex: 1 },
        { type: "alerts_list", title: "Vencimientos de Pago", dataSourceKey: "dueDates.upcoming", configJson: { daysAhead: 14 }, orderIndex: 2 },
        { type: "recent_transactions", title: "Pagos Recientes", dataSourceKey: "finance.transactions.recent", configJson: { limit: 8 }, orderIndex: 3 },
      ],
      filters: [
        { key: "date_range", label: "Período", type: "date_range" },
      ],
    },
  },
  {
    key: "seguimiento_comercial",
    name: "Seguimiento Comercial",
    description: "Panel de ventas, clientes potenciales y métricas comerciales",
    category: "comercial",
    icon: "📈",
    color: "#06b6d4",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "KPIs Comerciales", dataSourceKey: "clients.summary", configJson: {}, orderIndex: 0 },
        { type: "dynamic_table", title: "Clientes Activos", dataSourceKey: "clients.list", configJson: {}, orderIndex: 1 },
        { type: "bar_chart", title: "Evolución de Cartera", dataSourceKey: "clients.summary", configJson: { groupBy: "month" }, orderIndex: 2 },
        { type: "news_feed", title: "Novedades del Sector", dataSourceKey: "news.feed", configJson: { limit: 5 }, orderIndex: 3 },
      ],
      filters: [
        { key: "date_range", label: "Período", type: "date_range" },
      ],
    },
  },
  {
    key: "viajes_oportunidades",
    name: "Viajes y Oportunidades",
    description: "Seguimiento de viajes, contactos y oportunidades",
    category: "viajes",
    icon: "✈️",
    color: "#0ea5e9",
    configJson: {
      widgets: [
        { type: "pending_tasks", title: "Preparativos Pendientes", dataSourceKey: "tasks.myOpen", configJson: { limit: 8 }, orderIndex: 0 },
        { type: "quick_links", title: "Links de Viaje", dataSourceKey: "static.links", configJson: { links: [] }, orderIndex: 1 },
        { type: "news_feed", title: "Noticias del Destino", dataSourceKey: "news.feed", configJson: { limit: 5 }, orderIndex: 2 },
        { type: "quotes", title: "Cotizaciones", dataSourceKey: "dollar.quotes", configJson: {}, orderIndex: 3 },
      ],
      filters: [],
    },
  },
  {
    key: "panel_general_personal",
    name: "Panel General Personal",
    description: "Vista de todo: tareas, finanzas, noticias, vencimientos y clima",
    category: "general",
    icon: "📊",
    color: "#6b7280",
    configJson: {
      widgets: [
        { type: "kpi_cards", title: "KPIs del Día", dataSourceKey: "clients.summary", configJson: {}, orderIndex: 0 },
        { type: "upcoming_due_dates", title: "Próximos Vencimientos", dataSourceKey: "dueDates.upcoming", configJson: { limit: 5 }, orderIndex: 1 },
        { type: "pending_tasks", title: "Tareas Pendientes", dataSourceKey: "tasks.myOpen", configJson: { limit: 5 }, orderIndex: 2 },
        { type: "news_feed", title: "Noticias", dataSourceKey: "news.feed", configJson: { limit: 5 }, orderIndex: 3 },
        { type: "quotes", title: "Cotizaciones", dataSourceKey: "dollar.quotes", configJson: {}, orderIndex: 4 },
        { type: "recent_transactions", title: "Últimos Movimientos", dataSourceKey: "finance.transactions.recent", configJson: { limit: 5 }, orderIndex: 5 },
      ],
      filters: [],
    },
  },
];

export async function seedDashboardTemplates(): Promise<void> {
  try {
    const existing = await db.select({ key: dashboardTemplatesTable.key }).from(dashboardTemplatesTable);
    const existingKeys = new Set(existing.map(t => t.key));
    const toInsert = TEMPLATES.filter(t => !existingKeys.has(t.key));
    if (toInsert.length > 0) {
      await db.insert(dashboardTemplatesTable).values(toInsert);
      logger.info({ count: toInsert.length }, "Studio: dashboard templates seeded");
    }
  } catch (err) {
    logger.error({ err }, "Studio: dashboard templates seed error");
  }
}
