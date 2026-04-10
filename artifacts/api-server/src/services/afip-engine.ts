import { db, annualDueCalendarsTable, annualDueCalendarRulesTable, clientsTable, clientTaxAssignmentsTable, dueDatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export function getCuitLastDigit(cuit: string): number {
  const clean = cuit.replace(/[-\s]/g, "");
  const last = clean[clean.length - 1];
  return last ? parseInt(last, 10) : -1;
}

export function cuitTerminationMatches(ruleTermination: string, cuitLastDigit: number): boolean {
  if (ruleTermination === "any") return true;
  const parts = ruleTermination.split(",").map(p => p.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (start !== undefined && end !== undefined && cuitLastDigit >= start && cuitLastDigit <= end) return true;
    } else {
      if (parseInt(part) === cuitLastDigit) return true;
    }
  }
  return false;
}

export async function getActiveCalendar() {
  const [cal] = await db.select().from(annualDueCalendarsTable)
    .where(eq(annualDueCalendarsTable.status, "active"));
  return cal ?? null;
}

export async function generateDueDatesForClient(clientId: number): Promise<{ generated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let generated = 0;
  let skipped = 0;

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { errors.push("Cliente no encontrado"); return { generated, skipped, errors }; }

  const calendar = await getActiveCalendar();
  if (!calendar) { errors.push("No hay calendario activo"); return { generated, skipped, errors }; }

  const taxAssignments = await db.select().from(clientTaxAssignmentsTable)
    .where(and(eq(clientTaxAssignmentsTable.clientId, clientId), eq(clientTaxAssignmentsTable.enabled, true)));

  const cuitLastDigit = getCuitLastDigit(client.cuit);
  const rules = await db.select().from(annualDueCalendarRulesTable)
    .where(eq(annualDueCalendarRulesTable.calendarId, calendar.id));

  const existingDueDates = await db.select().from(dueDatesTable)
    .where(and(eq(dueDatesTable.clientId, clientId), eq(dueDatesTable.source, "afip-engine")));

  const existingKeys = new Set(existingDueDates.map(d => `${d.calendarRuleId}-${d.dueDate}`));

  for (const assignment of taxAssignments) {
    const matchingRules = rules.filter(r =>
      r.taxType === assignment.taxType &&
      cuitTerminationMatches(r.cuitTermination, cuitLastDigit)
    );

    for (const rule of matchingRules) {
      const year = calendar.year;
      const paddedMonth = rule.month.toString().padStart(2, "0");
      const paddedDay = rule.dueDay.toString().padStart(2, "0");
      const dateStr = `${year}-${paddedMonth}-${paddedDay}`;
      const key = `${rule.id}-${dateStr}`;

      if (existingKeys.has(key)) { skipped++; continue; }

      try {
        await db.insert(dueDatesTable).values({
          title: `${taxLabel(assignment.taxType)} — ${client.name} — ${monthName(rule.month)} ${year}`,
          category: taxCategory(assignment.taxType),
          dueDate: dateStr,
          description: `Generado automáticamente | CUIT: ${client.cuit} | Terminación ${cuitLastDigit} | Calendario: ${calendar.name} | Regla: ${rule.id}`,
          priority: "high",
          status: "pending",
          alertEnabled: true,
          source: "afip-engine",
          clientId: client.id,
          calendarRuleId: rule.id,
          userId: client.userId,
        });
        generated++;
      } catch (err) {
        logger.error({ err }, `AFIP engine: error generating due date for client ${clientId} tax ${assignment.taxType}`);
        errors.push(`Error en ${assignment.taxType} mes ${rule.month}: ${String(err)}`);
      }
    }
  }

  logger.info({ clientId, generated, skipped, errors: errors.length }, "AFIP engine: generateDueDatesForClient");
  return { generated, skipped, errors };
}

export async function regenerateAllDueDatesForClient(clientId: number) {
  await db.delete(dueDatesTable).where(and(
    eq(dueDatesTable.clientId, clientId),
    eq(dueDatesTable.source, "afip-engine"),
  ));
  return generateDueDatesForClient(clientId);
}

function taxLabel(taxType: string): string {
  const labels: Record<string, string> = {
    iva: "IVA DDJJ", ganancias: "Ganancias", monotributo: "Monotributo",
    autonomos: "Autónomos", iibb_neuquen: "IIBB Neuquén", iibb_rio_negro: "IIBB Río Negro",
    cargas_sociales: "Cargas Sociales", empleada_domestica: "Empleada Doméstica",
    facturacion: "Facturación", sindicato: "Sindicato",
  };
  return labels[taxType] ?? taxType;
}

function taxCategory(taxType: string): string {
  if (["iva", "ganancias", "monotributo", "autonomos", "iibb_neuquen", "iibb_rio_negro"].includes(taxType))
    return "impuestos";
  if (["cargas_sociales", "empleada_domestica", "sindicato"].includes(taxType))
    return "cargas_sociales";
  return "general";
}

function monthName(month: number): string {
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return months[month - 1] ?? `Mes ${month}`;
}
