import { db, modulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const DEFAULT_MODULES = [
  { key: "dashboard", name: "Dashboard", description: "Panel principal", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 0 },
  { key: "tasks", name: "Tareas", description: "Gestión de tareas", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 1 },
  { key: "shortcuts", name: "Accesos Directos", description: "Links y accesos rápidos", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 2 },
  { key: "news", name: "Noticias", description: "Monitor de noticias", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 3 },
  { key: "emails", name: "Emails", description: "Bandeja de email", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 4 },
  { key: "weather", name: "Clima", description: "Clima de Neuquén", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 5 },
  { key: "fiscal", name: "Monitor Fiscal", description: "Monitor fiscal AFIP y fuentes", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 6 },
  { key: "travel", name: "Viajes", description: "Gestión de viajes", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 7 },
  { key: "due-dates", name: "Vencimientos", description: "Vencimientos impositivos", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 8 },
  { key: "clients", name: "Clientes", description: "Cartera de clientes", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 9 },
  { key: "supplier-batches", name: "Proveedores", description: "Lotes de pago a proveedores", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 10 },
  { key: "tax-calendars", name: "Calendarios", description: "Calendarios impositivos anuales", allowedRoles: ["super_admin", "admin"], orderIndex: 11 },
  { key: "admin", name: "Administración", description: "Panel de administración del sistema", allowedRoles: ["super_admin", "admin"], orderIndex: 12 },
  { key: "finance", name: "Finanzas", description: "Resumen financiero personal", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 13 },
  { key: "goals", name: "Objetivos del día", description: "Checklist diario de objetivos", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 14 },
  { key: "strategy", name: "Estrategia", description: "Objetivos estratégicos y Gantt", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 15 },
  { key: "decisions", name: "Decisiones", description: "Motor de decisiones y scoring", allowedRoles: ["super_admin", "admin", "editor"], orderIndex: 16 },
  { key: "settings", name: "Ajustes", description: "Configuración personal", allowedRoles: ["super_admin", "admin", "editor", "viewer"], orderIndex: 17 },
];

export async function seedModules(): Promise<void> {
  try {
    const existing = await db.select({ key: modulesTable.key }).from(modulesTable);
    const existingKeys = new Set(existing.map(m => m.key));
    const toInsert = DEFAULT_MODULES.filter(m => !existingKeys.has(m.key));
    if (toInsert.length > 0) {
      await db.insert(modulesTable).values(toInsert);
      logger.info({ inserted: toInsert.length }, "Modules seeded");
    }
  } catch (err) {
    logger.error({ err }, "seedModules error");
  }
}

export async function bootstrapSuperAdmin(): Promise<void> {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) return;
  try {
    const { usersTable } = await import("@workspace/db");
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, superAdminEmail));
    if (existing && existing.role !== "super_admin") {
      await db.update(usersTable).set({ role: "super_admin" }).where(eq(usersTable.email, superAdminEmail));
      logger.info({ email: superAdminEmail }, "Super admin promoted from env var");
    }
  } catch (err) {
    logger.error({ err }, "bootstrapSuperAdmin error");
  }
}
