import { db, modulesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Módulos del sistema ───────────────────────────────────────────────────────
// Fuente de verdad de los módulos disponibles.
// seedModules() es idempotente: inserta módulos nuevos y actualiza metadata
// (name, description, allowedRoles, orderIndex) de los existentes.
// Los módulos eliminados de esta lista NO se borran de la DB — se archivan
// manualmente desde el panel de admin.

type ModuleDefinition = {
  key:          string;
  name:         string;
  description:  string;
  allowedRoles: string[];
  orderIndex:   number;
};

const DEFAULT_MODULES: ModuleDefinition[] = [
  { key: "dashboard",        name: "Dashboard",                  description: "Panel principal",                                                orderIndex: 0,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "overview",         name: "Vista de Módulos",           description: "Vista general de acceso rápido a todos los módulos",             orderIndex: 1,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "tasks",            name: "Tareas",                     description: "Gestión de tareas",                                              orderIndex: 2,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "shortcuts",        name: "Accesos Directos",           description: "Links y accesos rápidos",                                        orderIndex: 3,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "news",             name: "Noticias",                   description: "Monitor de noticias",                                            orderIndex: 4,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "emails",           name: "Emails",                     description: "Bandeja de email",                                               orderIndex: 5,  allowedRoles: ["super_admin","admin","editor"] },
  { key: "weather",          name: "Clima",                      description: "Clima de Neuquén",                                               orderIndex: 6,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "fiscal",           name: "Monitor Fiscal",             description: "Monitor fiscal AFIP y fuentes",                                  orderIndex: 7,  allowedRoles: ["super_admin","admin","editor"] },
  { key: "travel",           name: "Viajes",                     description: "Gestión de viajes",                                              orderIndex: 8,  allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "due-dates",        name: "Vencimientos",               description: "Vencimientos impositivos",                                       orderIndex: 9,  allowedRoles: ["super_admin","admin","editor"] },
  { key: "clients",          name: "Clientes",                   description: "Cartera de clientes",                                            orderIndex: 10, allowedRoles: ["super_admin","admin","editor"] },
  { key: "supplier-batches", name: "Proveedores",                description: "Lotes de pago a proveedores",                                   orderIndex: 11, allowedRoles: ["super_admin","admin","editor"] },
  { key: "tax-calendars",    name: "Calendarios",                description: "Calendarios impositivos anuales",                                orderIndex: 12, allowedRoles: ["super_admin","admin"] },
  { key: "admin",            name: "Administración",             description: "Panel de administración del sistema",                            orderIndex: 13, allowedRoles: ["super_admin","admin"] },
  { key: "finance",          name: "Finanzas",                   description: "Resumen financiero personal",                                    orderIndex: 14, allowedRoles: ["super_admin","admin","editor"] },
  { key: "goals",            name: "Objetivos del día",          description: "Checklist diario de objetivos",                                  orderIndex: 15, allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "strategy",         name: "Estrategia",                 description: "Objetivos estratégicos y Gantt",                                 orderIndex: 16, allowedRoles: ["super_admin","admin","editor"] },
  { key: "decisions",        name: "Decisiones",                 description: "Motor de decisiones y scoring",                                  orderIndex: 17, allowedRoles: ["super_admin","admin","editor"] },
  { key: "settings",         name: "Ajustes",                    description: "Configuración personal",                                         orderIndex: 18, allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "contacts",         name: "Contactos",                  description: "Tarjetas de contacto de usuarios",                               orderIndex: 19, allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "chat",             name: "Chat",                       description: "Mensajería interna entre usuarios",                              orderIndex: 20, allowedRoles: ["super_admin","admin","editor","viewer"] },
  { key: "dashboard_studio", name: "Dashboard Studio",           description: "Constructor de dashboards dinámicos y personalizados",           orderIndex: 21, allowedRoles: ["super_admin","admin","editor"] },
  { key: "quotes",           name: "Presupuestos y Cobranzas",   description: "Gestión de presupuestos, versiones y cobranzas por cliente",     orderIndex: 22, allowedRoles: ["super_admin","admin","editor"] },
  { key: "fitness",          name: "Actividad Física",           description: "Plan de entrenamiento, nutrición y diario de comidas personal",  orderIndex: 23, allowedRoles: ["super_admin","admin","editor","viewer"] },
];

// ── seedModules ───────────────────────────────────────────────────────────────
// Idempotente:
//   - Módulos nuevos: se insertan
//   - Módulos existentes: se actualiza name/description/allowedRoles/orderIndex
//     (onConflictDoUpdate) — útil para sincronizar cambios entre deploys
//   - Módulos eliminados de esta lista: no se tocan en la DB
export async function seedModules(): Promise<void> {
  try {
    // Upsert en bulk — un solo INSERT con ON CONFLICT para todos los módulos
    await db
      .insert(modulesTable)
      .values(DEFAULT_MODULES.map((m) => ({ ...m, isActive: true })))
      .onConflictDoUpdate({
        target: modulesTable.key,
        set: {
          name:         modulesTable.name,
          description:  modulesTable.description,
          allowedRoles: modulesTable.allowedRoles,
          orderIndex:   modulesTable.orderIndex,
          // Nota: isActive no se actualiza — permite desactivar módulos desde admin
          // sin que el seed los reactive en cada deploy
        },
      });

    logger.info({ count: DEFAULT_MODULES.length }, "seedModules: completado");
  } catch (err) {
    logger.error({ err }, "seedModules error");
  }
}

// ── bootstrapSuperAdmin ───────────────────────────────────────────────────────
// Crea o actualiza el super admin al inicio del servidor.
// Solo opera cuando SUPER_ADMIN_EMAIL está configurado en el entorno.
// Sin email configurado, no hace nada — no hay fallback hardcodeado.
//
// Corrección crítica del original: el email "joaquin.fontanini@gmail.com"
// era un dato personal hardcodeado en el código fuente. Eliminado.
export async function bootstrapSuperAdmin(): Promise<void> {
  // Sin email configurado, no crear super admin automáticamente
  const superAdminEmail = process.env["SUPER_ADMIN_EMAIL"];
  if (!superAdminEmail) {
    logger.debug("bootstrapSuperAdmin: SUPER_ADMIN_EMAIL no configurado, saltando");
    return;
  }

  const superAdminPassword = process.env["SUPER_ADMIN_PASSWORD"];

  try {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, superAdminEmail));

    if (!existing) {
      // Crear super admin solo si hay password configurado
      if (!superAdminPassword) {
        logger.warn(
          { email: superAdminEmail },
          "bootstrapSuperAdmin: usuario no existe y SUPER_ADMIN_PASSWORD no está configurado — saltando creación",
        );
        return;
      }

      const { default: bcrypt } = await import("bcrypt");
      const hash = await bcrypt.hash(superAdminPassword, 12);

      await db.insert(usersTable).values({
        email:        superAdminEmail,
        name:         "Super Admin",  // Nombre genérico — actualizable desde el perfil
        role:         "super_admin",
        passwordHash: hash,
        isActive:     true,
        isBlocked:    false,
      });

      logger.info({ email: superAdminEmail }, "bootstrapSuperAdmin: super admin creado");
      return;
    }

    // Actualizar solo los campos que necesiten cambio — tipado explícito
    const updates: {
      role?: string;
      passwordHash?: string;
    } = {};

    if (existing.role !== "super_admin") {
      updates.role = "super_admin";
    }

    if (!existing.passwordHash && superAdminPassword) {
      const { default: bcrypt } = await import("bcrypt");
      updates.passwordHash = await bcrypt.hash(superAdminPassword, 12);
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.email, superAdminEmail));
      logger.info(
        { email: superAdminEmail, fields: Object.keys(updates) },
        "bootstrapSuperAdmin: super admin actualizado",
      );
    }
  } catch (err) {
    logger.error({ err }, "bootstrapSuperAdmin error");
  }
}
