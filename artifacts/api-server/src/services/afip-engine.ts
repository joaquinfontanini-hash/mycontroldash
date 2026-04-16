/**
 * afip-engine.ts
 *
 * Motor de cálculo de vencimientos impositivos.
 *
 * Pipeline por cliente:
 *  1. Obtener terminación CUIT
 *  2. Obtener impuestos asignados
 *  3. Para cada impuesto → buscar en calendario activo
 *  4. Encontrar grupo CUIT correcto
 *  5. Obtener día de vencimiento por mes
 *  6. Calcular semáforo según días restantes
 *  7. Construir JSON de trazabilidad completa
 *  8. Insertar en due_dates
 */
import {
  db,
  annualDueCalendarsTable,
  annualDueCalendarRulesTable,
  clientsTable,
  clientTaxAssignmentsTable,
  dueDatesTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  normalizeTaxCode,
  taxCodesMatch,
  taxLabel as normalizerTaxLabel,
} from "../lib/tax-normalizer.js";

// ── CUIT helpers ──────────────────────────────────────────────────────────────

export function getCuitLastDigit(cuit: string): number {
  const clean = cuit.replace(/[-\s]/g, "");
  const last = clean[clean.length - 1];
  return last ? parseInt(last, 10) : -1;
}

/**
 * Verifica si la terminación CUIT del cliente coincide con el grupo del regla.
 * Soporta formatos: "any", "2-3", "0 a 3", "0-1,2-3", "7 a 9", "0", "4", etc.
 */
export function cuitTerminationMatches(ruleTermination: string, cuitLastDigit: number): boolean {
  if (!ruleTermination || ruleTermination === "any") return true;
  // Normalize "a" → "-"
  const normalized = ruleTermination
    .replace(/\s+a\s+/gi, "-")
    .replace(/\s/g, "");
  const parts = normalized.split(",").map(p => p.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (
        start !== undefined && end !== undefined &&
        !isNaN(start) && !isNaN(end) &&
        cuitLastDigit >= start && cuitLastDigit <= end
      ) return true;
    } else {
      if (!isNaN(parseInt(part)) && parseInt(part) === cuitLastDigit) return true;
    }
  }
  return false;
}

// ── Semáforo calculation ──────────────────────────────────────────────────────

export type TrafficLight = "verde" | "amarillo" | "rojo" | "gris";

/**
 * Calcula el semáforo de un vencimiento basado en los días restantes.
 *
 * Reglas configurables (hardcoded como defaults, alineadas con spec):
 *  - ROJO:     vencido o ≤ 2 días
 *  - AMARILLO: 3 a 7 días
 *  - VERDE:    > 7 días
 *  - GRIS:     estado "done" | "cancelled", o fecha inválida
 */
export function calculateTrafficLight(dueDateStr: string, status: string): TrafficLight {
  if (status === "done" || status === "cancelled") return "gris";
  if (!dueDateStr) return "gris";

  try {
    const due = new Date(dueDateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffMs = due.getTime() - now.getTime();
    const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) return "rojo";    // vencido
    if (daysRemaining <= 2) return "rojo";   // vence hoy, mañana, pasado
    if (daysRemaining <= 7) return "amarillo"; // próximo
    return "verde";                           // cómodo
  } catch {
    return "gris";
  }
}

/**
 * Calcula el semáforo global de un cliente basado en sus vencimientos activos.
 * Regla: el peor semáforo de sus vencimientos activos.
 */
export function clientTrafficLight(lights: TrafficLight[]): TrafficLight {
  if (lights.includes("rojo")) return "rojo";
  if (lights.includes("amarillo")) return "amarillo";
  if (lights.includes("verde")) return "verde";
  return "gris";
}

/**
 * Mapea el semáforo a prioridad de alerta.
 */
export function trafficLightToPriority(light: TrafficLight): string {
  switch (light) {
    case "rojo": return "critical";
    case "amarillo": return "high";
    case "verde": return "medium";
    default: return "low";
  }
}

// ── Active calendar ───────────────────────────────────────────────────────────

export async function getActiveCalendar() {
  const [cal] = await db
    .select()
    .from(annualDueCalendarsTable)
    .where(eq(annualDueCalendarsTable.status, "active"));
  return cal ?? null;
}

// ── Month labels ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `Mes ${month}`;
}

// ── Tax labels (delegate to normalizer) ───────────────────────────────────────

export function taxLabel(taxType: string): string {
  return normalizerTaxLabel(taxType);
}

function taxCategory(taxType: string): string {
  if (["iva", "ganancias", "monotributo", "autonomos", "iibb_neuquen", "iibb_rio_negro"].includes(taxType))
    return "impuestos";
  if (["cargas_sociales", "empleada_domestica", "sindicato"].includes(taxType))
    return "cargas_sociales";
  return "general";
}

// ── Audit logging ─────────────────────────────────────────────────────────────

async function auditLog(
  action: string,
  detail: string,
  entityId?: string,
  extra?: object,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      module: "due_dates",
      entity: "due_dates",
      entityId: entityId ?? null,
      action,
      detail,
      after: extra ? JSON.stringify(extra) : null,
      userId: "system",
    });
  } catch (err) {
    logger.warn({ err }, "AFIP engine: audit log failed (non-critical)");
  }
}

// ── Traceability JSON builder ─────────────────────────────────────────────────

function buildTraceability(opts: {
  clientName: string;
  cuit: string;
  cuitLastDigit: number;
  taxType: string;
  taxLabel: string;
  month: number;
  year: number;
  cuitGroup: string;
  dueDay: number;
  dueDateStr: string;
  calendarName: string;
  calendarId: number;
  ruleId: number;
  trafficLight: TrafficLight;
  status: string;
}): string {
  return JSON.stringify({
    origen: "Motor AFIP automático",
    cliente: opts.clientName,
    cuit: opts.cuit,
    terminacion_cuit: opts.cuitLastDigit,
    impuesto: opts.taxLabel,
    impuesto_codigo: opts.taxType,
    mes: monthName(opts.month),
    anio: opts.year,
    grupo_cuit_aplicado: opts.cuitGroup,
    dia_vencimiento: opts.dueDay,
    fecha_vencimiento: opts.dueDateStr,
    calendario_nombre: opts.calendarName,
    calendario_id: opts.calendarId,
    regla_id: opts.ruleId,
    semaforo: opts.trafficLight,
    estado_calculo: "VALIDADO",
    calculado_en: new Date().toISOString(),
  });
}

// ── Core engine: generate due dates for a single client ───────────────────────

export interface GenerationResult {
  generated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    tax: string;
    month: number;
    date: string;
    trafficLight: TrafficLight;
    cuitGroup: string;
    status: "generated" | "skipped" | "error";
    reason?: string;
  }>;
}

export async function generateDueDatesForClient(
  clientId: number,
  opts: { forceRegenerate?: boolean } = {},
): Promise<GenerationResult> {
  const result: GenerationResult = { generated: 0, skipped: 0, errors: [], details: [] };

  // Load client
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) {
    result.errors.push("Cliente no encontrado");
    return result;
  }
  if (client.status !== "active") {
    result.errors.push("Cliente inactivo — no se generan vencimientos");
    return result;
  }

  // Load active calendar
  const calendar = await getActiveCalendar();
  if (!calendar) {
    result.errors.push("No hay calendario activo. Active un calendario en Configuración → Calendarios Fiscales");
    await auditLog("generate_failed", `Sin calendario activo para cliente ${client.name} (ID ${clientId})`);
    return result;
  }

  // Validate calendar year
  if (!calendar.year || calendar.year < 2000 || calendar.year > 2100) {
    const msg = `Calendario "${calendar.name}" tiene año inválido (${calendar.year}). Corregí el año antes de calcular vencimientos.`;
    result.errors.push(msg);
    logger.error({ calendarId: calendar.id, year: calendar.year }, "AFIP engine: calendar has invalid year");
    await auditLog("generate_failed", msg, String(clientId));
    return result;
  }

  // Load tax assignments
  const taxAssignments = await db
    .select()
    .from(clientTaxAssignmentsTable)
    .where(and(
      eq(clientTaxAssignmentsTable.clientId, clientId),
      eq(clientTaxAssignmentsTable.enabled, true),
    ));

  if (taxAssignments.length === 0) {
    result.errors.push("El cliente no tiene impuestos asignados");
    return result;
  }

  // Load calendar rules
  const rules = await db
    .select()
    .from(annualDueCalendarRulesTable)
    .where(eq(annualDueCalendarRulesTable.calendarId, calendar.id));

  const cuitLastDigit = getCuitLastDigit(client.cuit);

  // Load existing generated due dates (for dedup)
  const existingDueDates = await db
    .select()
    .from(dueDatesTable)
    .where(and(
      eq(dueDatesTable.clientId, clientId),
      eq(dueDatesTable.source, "afip-engine"),
    ));

  const existingKeys = new Set(
    existingDueDates.map(d => `${d.calendarRuleId}-${d.dueDate}`)
  );

  // Pre-compute unique taxTypes in calendar for diagnostics
  const calendarTaxTypes = [...new Set(rules.map(r => r.taxType))];

  for (const assignment of taxAssignments) {
    // ── Matching robusto: normaliza ambos lados ────────────────────────────
    const matchingRules = rules.filter(r =>
      taxCodesMatch(r.taxType, assignment.taxType) &&
      cuitTerminationMatches(r.cuitTermination, cuitLastDigit)
    );

    if (matchingRules.length === 0) {
      // Build diagnostic: show what the calendar has vs what we're looking for
      const clientTaxNorm = normalizeTaxCode(assignment.taxType);
      const calendarTaxNorms = calendarTaxTypes.map(t => `"${t}" → ${normalizeTaxCode(t)}`).join(", ");

      const reason = [
        `Impuesto "${assignment.taxType}" (normalizado: "${clientTaxNorm}") no encontrado en calendario "${calendar.name}" (año ${calendar.year})`,
        `Terminación CUIT: ${cuitLastDigit}`,
        `Impuestos disponibles en calendario: [${calendarTaxNorms || "ninguno"}]`,
      ].join(" | ");

      result.errors.push(reason);
      result.details.push({
        tax: assignment.taxType,
        month: 0,
        date: "",
        trafficLight: "rojo",
        cuitGroup: `terminacion-${cuitLastDigit}`,
        status: "error",
        reason,
      });

      logger.warn({
        clientId,
        clientName: client.name,
        taxType: assignment.taxType,
        taxTypeNormalized: clientTaxNorm,
        calendarId: calendar.id,
        calendarName: calendar.name,
        calendarYear: calendar.year,
        cuitLastDigit,
        availableTaxTypes: calendarTaxTypes,
      }, "AFIP engine: no matching rules found for tax");

      continue;
    }

    for (const rule of matchingRules) {
      const year = calendar.year;
      const paddedMonth = rule.month.toString().padStart(2, "0");
      const paddedDay = rule.dueDay.toString().padStart(2, "0");
      const dateStr = `${year}-${paddedMonth}-${paddedDay}`;
      const key = `${rule.id}-${dateStr}`;

      if (!opts.forceRegenerate && existingKeys.has(key)) {
        result.skipped++;
        result.details.push({
          tax: assignment.taxType,
          month: rule.month,
          date: dateStr,
          trafficLight: "gris",
          cuitGroup: rule.cuitTermination,
          status: "skipped",
          reason: "Ya existe",
        });
        continue;
      }

      const tl = calculateTrafficLight(dateStr, "pending");
      const priority = trafficLightToPriority(tl);

      const traceability = buildTraceability({
        clientName: client.name,
        cuit: client.cuit,
        cuitLastDigit,
        taxType: assignment.taxType,
        taxLabel: taxLabel(assignment.taxType),
        month: rule.month,
        year,
        cuitGroup: rule.cuitTermination,
        dueDay: rule.dueDay,
        dueDateStr: dateStr,
        calendarName: calendar.name,
        calendarId: calendar.id,
        ruleId: rule.id,
        trafficLight: tl,
        status: "pending",
      });

      try {
        await db.insert(dueDatesTable).values({
          title: `${taxLabel(assignment.taxType)} — ${client.name} — ${monthName(rule.month)} ${year}`,
          category: taxCategory(assignment.taxType),
          dueDate: dateStr,
          description: null,
          priority,
          status: "pending",
          alertEnabled: client.alertsActive ?? true,
          source: "afip-engine",
          clientId: client.id,
          calendarRuleId: rule.id,
          userId: client.userId,
          // New v2 fields
          trafficLight: tl,
          cuitGroup: rule.cuitTermination,
          cuitTermination: cuitLastDigit,
          taxCode: assignment.taxType,
          classificationReason: traceability,
          alertGenerated: false,
        });
        result.generated++;
        result.details.push({
          tax: assignment.taxType,
          month: rule.month,
          date: dateStr,
          trafficLight: tl,
          cuitGroup: rule.cuitTermination,
          status: "generated",
        });
      } catch (err) {
        const errMsg = `Error insertando ${assignment.taxType} mes ${rule.month}: ${String(err)}`;
        result.errors.push(errMsg);
        result.details.push({
          tax: assignment.taxType,
          month: rule.month,
          date: dateStr,
          trafficLight: "rojo",
          cuitGroup: rule.cuitTermination,
          status: "error",
          reason: errMsg,
        });
        logger.error({ err, clientId, tax: assignment.taxType }, "AFIP engine: insert error");
      }
    }
  }

  await auditLog(
    "generate",
    `Generados ${result.generated} vencimientos para ${client.name} | ${result.skipped} omitidos | ${result.errors.length} errores`,
    String(clientId),
    { clientId, generated: result.generated, errors: result.errors },
  );

  logger.info({ clientId, ...result, errors: result.errors.length }, "AFIP engine: generateDueDatesForClient");
  return result;
}

// ── Regenerate (wipe + re-generate) ──────────────────────────────────────────

export async function regenerateAllDueDatesForClient(clientId: number): Promise<GenerationResult> {
  await db.delete(dueDatesTable).where(and(
    eq(dueDatesTable.clientId, clientId),
    eq(dueDatesTable.source, "afip-engine"),
  ));
  return generateDueDatesForClient(clientId);
}

// ── Batch: generate for all active clients ────────────────────────────────────

export async function generateDueDatesForAllClients(): Promise<{
  clientsProcessed: number;
  totalGenerated: number;
  totalErrors: number;
}> {
  const clients = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.status, "active"));

  let totalGenerated = 0;
  let totalErrors = 0;

  for (const client of clients) {
    const r = await generateDueDatesForClient(client.id);
    totalGenerated += r.generated;
    totalErrors += r.errors.length;
  }

  await auditLog(
    "generate_all",
    `Generación masiva: ${clients.length} clientes, ${totalGenerated} vencimientos, ${totalErrors} errores`,
  );

  return { clientsProcessed: clients.length, totalGenerated, totalErrors };
}

// ── Update traffic lights (daily recalculation) ───────────────────────────────
// Must be called daily to keep semáforos up to date.

export async function updateAllTrafficLights(): Promise<{ updated: number }> {
  const pending = await db
    .select()
    .from(dueDatesTable)
    .where(eq(dueDatesTable.status, "pending"));

  let updated = 0;
  for (const dd of pending) {
    const newLight = calculateTrafficLight(dd.dueDate, dd.status);
    if (newLight !== dd.trafficLight) {
      const newPriority = trafficLightToPriority(newLight);
      await db.update(dueDatesTable)
        .set({ trafficLight: newLight, priority: newPriority })
        .where(eq(dueDatesTable.id, dd.id));
      updated++;
    }
  }

  if (updated > 0) {
    await auditLog(
      "recalculate_semaforos",
      `Semáforos actualizados: ${updated} vencimientos cambiaron estado`,
    );
  }

  logger.info({ updated }, "AFIP engine: updateAllTrafficLights");
  return { updated };
}

// ── KPI calculation ───────────────────────────────────────────────────────────

export async function getDueDatesKPIs(userId?: string) {
  let all = await db.select().from(dueDatesTable);
  if (userId) all = all.filter(d => d.userId === userId);

  const pending = all.filter(d => d.status === "pending");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getDay = (dd: typeof pending[0]) => {
    try {
      const due = new Date(dd.dueDate + "T00:00:00");
      return Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    } catch { return 999; }
  };

  const thisMonthYear = { m: today.getMonth() + 1, y: today.getFullYear() };
  const thisMonth = pending.filter(dd => {
    const [y, m] = dd.dueDate.split("-").map(Number);
    return y === thisMonthYear.y && m === thisMonthYear.m;
  });

  const overdue = pending.filter(dd => getDay(dd) < 0);
  const dueToday = pending.filter(dd => getDay(dd) === 0);
  const due3d = pending.filter(dd => { const d = getDay(dd); return d > 0 && d <= 3; });
  const errors = pending.filter(dd => dd.trafficLight === "gris" && dd.source === "afip-engine");
  const rojos = pending.filter(dd => dd.trafficLight === "rojo");
  const amarillos = pending.filter(dd => dd.trafficLight === "amarillo");
  const verdes = pending.filter(dd => dd.trafficLight === "verde");

  // Unique clients in rojo/amarillo
  const clientsRojo = new Set(rojos.map(d => d.clientId).filter(Boolean));
  const clientsAmarillo = new Set(amarillos.map(d => d.clientId).filter(Boolean));

  return {
    totalThisMonth: thisMonth.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    due3days: due3d.length,
    errors: errors.length,
    clientsRojo: clientsRojo.size,
    clientsAmarillo: clientsAmarillo.size,
    byTrafficLight: {
      rojo: rojos.length,
      amarillo: amarillos.length,
      verde: verdes.length,
      gris: pending.filter(dd => dd.trafficLight === "gris").length,
    },
  };
}
