import { db, annualDueCalendarsTable, annualDueCalendarRulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────
type Rule = { month: number; cuitTermination: string; dueDay: number };

// ─── Helpers ────────────────────────────────────────────────────────────────
function monthly(
  groups: Array<{ cuit: string; days: number[] }>
): Rule[] {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return groups.flatMap(({ cuit, days }) =>
    months.map((month, i) => ({ month, cuitTermination: cuit, dueDay: days[i] }))
  );
}

// ─── AUTÓNOMOS ──────────────────────────────────────────────────────────────
// Grupos: 0-3, 4-6, 7-9, y "any" (vencimiento general sin descuento 0a9)
//         ene feb mar abr may jun jul ago sep oct nov dic
const AUTONOMOS_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [3,  5,  5,  6,  5,  9,  6,  6,  6,  7,  5,  9] },
  { cuit: "4-6", days: [4,  6,  7,  7,  6, 10,  7,  7,  7,  8,  9, 10] },
  { cuit: "7-9", days: [9,  9,  9,  8,  8, 11,  8,  8,  8,  9, 10, 11] },
  { cuit: "any", days: [20, 20, 20, 20, 22, 22, 20, 21, 21, 21, 20, 21] },
]);

// ─── MONOTRIBUTO ────────────────────────────────────────────────────────────
// Un solo vencimiento para todos los CUIT
//                        ene feb mar abr may jun jul ago sep oct nov dic
const MONOTRIBUTO_RULES: Rule[] = monthly([
  { cuit: "any", days: [20, 20, 20, 20, 22, 22, 20, 21, 21, 21, 20, 21] },
]);

// ─── EMPLEADORES SICOSS ─────────────────────────────────────────────────────
// Grupos: 0-3, 4-6, 7-9
// Enero tiene vencimiento anticipado (7-9); resto del año: 9-11
//         ene feb mar abr may jun jul ago sep oct nov dic
const CARGAS_SOCIALES_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [7,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9] },
  { cuit: "4-6", days: [8, 10, 10, 10, 10, 10, 10, 10, 11, 10, 10, 10] },
  { cuit: "7-9", days: [9, 11, 11, 11, 11, 11, 11, 11, 12, 11, 11, 11] },
]);

// ─── GANANCIAS SOCIEDADES DDJJ ──────────────────────────────────────────────
// Grupos: 0-3, 4-6, 7-9
// Junio corrido por feriado, Septiembre y Noviembre/Diciembre con variación
//         ene feb mar abr may jun jul ago sep oct nov dic
const GANANCIAS_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [13, 13, 13, 13, 13, 17, 13, 13, 14, 13, 13, 14] },
  { cuit: "4-6", days: [14, 14, 14, 14, 14, 18, 14, 14, 15, 14, 16, 15] },
  { cuit: "7-9", days: [15, 15, 15, 15, 15, 19, 15, 15, 16, 15, 17, 16] },
]);

// ─── ANTICIPOS (Gcias. Sociedades, Pers. Humanas, Bienes Personales, FC) ────
// Mismo patrón que ganancias
//         ene feb mar abr may jun jul ago sep oct nov dic
const ANTICIPO_GANANCIAS_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [13, 13, 13, 13, 13, 17, 13, 13, 14, 13, 13, 14] },
  { cuit: "4-6", days: [14, 14, 14, 14, 14, 18, 14, 14, 15, 14, 16, 15] },
  { cuit: "7-9", days: [15, 15, 15, 15, 15, 19, 15, 15, 16, 15, 17, 16] },
]);

// ─── CONVENIO MULTILATERAL ─────────────────────────────────────────────────
// Grupos: 0-2, 3-5, 6-7, 8-9
// Junio y Septiembre/Diciembre con corrimiento
//         ene feb mar abr may jun jul ago sep oct nov dic
const CONVENIO_MULTILATERAL_RULES: Rule[] = monthly([
  { cuit: "0-2", days: [13, 13, 13, 13, 13, 17, 13, 13, 14, 13, 13, 14] },
  { cuit: "3-5", days: [15, 15, 15, 15, 15, 19, 15, 15, 16, 15, 15, 16] },
  { cuit: "6-7", days: [16, 16, 16, 16, 16, 20, 16, 16, 17, 16, 16, 17] },
  { cuit: "8-9", days: [17, 17, 17, 17, 17, 21, 17, 17, 18, 17, 17, 18] },
]);

// ─── IVA DDJJ ───────────────────────────────────────────────────────────────
// Grupos: 0-1, 2-3, 4-5, 6-7, 8-9
// Meses con feriados: Feb, Jun, Ago, Sep, Nov, Dic corridos
//         ene feb mar abr may jun jul ago sep oct nov dic
const IVA_RULES: Rule[] = monthly([
  { cuit: "0-1", days: [20, 18, 20, 20, 20, 22, 20, 19, 18, 20, 18, 21] },
  { cuit: "2-3", days: [21, 19, 21, 21, 21, 23, 21, 20, 19, 21, 19, 22] },
  { cuit: "4-5", days: [22, 20, 22, 22, 22, 24, 22, 21, 20, 22, 20, 23] },
  { cuit: "6-7", days: [23, 23, 23, 23, 23, 25, 23, 22, 21, 23, 21, 24] },
  { cuit: "8-9", days: [24, 24, 24, 24, 24, 26, 24, 23, 22, 24, 22, 25] },
]);

// ─── INTERNOS (excepto cigarrillos) DDJJ ───────────────────────────────────
// Grupos: 0-3, 4-6, 7-9
//         ene feb mar abr may jun jul ago sep oct nov dic
const INTERNOS_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [18, 18, 18, 18, 18, 20, 18, 17, 17, 18, 17, 18] },
  { cuit: "4-6", days: [19, 19, 19, 19, 19, 21, 19, 18, 18, 19, 18, 19] },
  { cuit: "7-9", days: [20, 20, 20, 20, 20, 22, 20, 19, 19, 20, 19, 20] },
]);

// ─── SICORE/SIRE 1° Quincena — Pago a cuenta ───────────────────────────────
// Grupos: 0-3, 4-6, 7-9
//         ene feb mar abr may jun jul ago sep oct nov dic
const SICORE_1Q_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [21, 21, 21, 21, 21, 23, 21, 21, 21, 21, 21, 21] },
  { cuit: "4-6", days: [22, 22, 22, 22, 22, 24, 22, 22, 22, 22, 22, 22] },
  { cuit: "7-9", days: [23, 23, 23, 23, 23, 25, 23, 23, 23, 23, 23, 23] },
]);

// ─── SICORE/SIRE 2° Quincena — DDJJ e ingreso de saldo ─────────────────────
// Grupos: 0-3, 4-6, 7-9
//         ene feb mar abr may jun jul ago sep oct nov dic
const SICORE_DDJJ_RULES: Rule[] = monthly([
  { cuit: "0-3", days: [21, 21, 21, 21, 21, 23, 21, 21, 21, 21, 21, 21] },
  { cuit: "4-6", days: [22, 22, 22, 22, 22, 24, 22, 22, 22, 22, 22, 22] },
  { cuit: "7-9", days: [23, 23, 23, 23, 23, 25, 23, 23, 23, 23, 23, 23] },
]);

// ─── PERSONAL DE CASAS PARTICULARES ────────────────────────────────────────
// Dos grupos: "obligatorio" y "voluntario" (sin discriminación por CUIT)
// Usamos cuit "obligatorio" y "voluntario" como pseudo-grupos
//         ene feb mar abr may jun jul ago sep oct nov dic
const EMPLEADA_DOMESTICA_RULES: Rule[] = monthly([
  { cuit: "any", days: [15, 10, 10, 13, 13, 15, 13, 13, 13, 13, 13, 13] },
]);

// ─── All rule sets ──────────────────────────────────────────────────────────
const ALL_RULE_SETS: Array<{ taxType: string; rules: Rule[] }> = [
  { taxType: "autonomos",             rules: AUTONOMOS_RULES },
  { taxType: "monotributo",           rules: MONOTRIBUTO_RULES },
  { taxType: "cargas_sociales",       rules: CARGAS_SOCIALES_RULES },
  { taxType: "ganancias",             rules: GANANCIAS_RULES },
  { taxType: "anticipo_ganancias",    rules: ANTICIPO_GANANCIAS_RULES },
  { taxType: "convenio_multilateral", rules: CONVENIO_MULTILATERAL_RULES },
  { taxType: "iva",                   rules: IVA_RULES },
  { taxType: "internos",              rules: INTERNOS_RULES },
  { taxType: "sicore_1q",             rules: SICORE_1Q_RULES },
  { taxType: "sicore_ddjj",           rules: SICORE_DDJJ_RULES },
  { taxType: "empleada_domestica",    rules: EMPLEADA_DOMESTICA_RULES },
];

// ─── Seed initial calendar (only if it doesn't exist yet) ──────────────────
export async function seedCalendar2026() {
  try {
    const existing = await db.select().from(annualDueCalendarsTable)
      .where(and(
        eq(annualDueCalendarsTable.year, 2026),
        eq(annualDueCalendarsTable.calendarType, "general"),
      ));

    if (existing.length > 0) {
      logger.info("Calendar 2026 already seeded, skipping initial seed");
      return;
    }

    const [cal] = await db.insert(annualDueCalendarsTable).values({
      name: "Calendario AFIP 2026",
      year: 2026,
      status: "active",
      parseStatus: "done",
      calendarType: "general",
      notes: "Seeded automáticamente. Verificar días exactos con tabla oficial AFIP cuando haya variaciones por feriados.",
    }).returning();

    let totalRules = 0;
    for (const { taxType, rules } of ALL_RULE_SETS) {
      for (const rule of rules) {
        await db.insert(annualDueCalendarRulesTable).values({
          calendarId: cal.id,
          taxType,
          month: rule.month,
          cuitTermination: rule.cuitTermination,
          dueDay: rule.dueDay,
          notes: `Seed 2026 - ${taxType}`,
        });
        totalRules++;
      }
    }

    logger.info({ calendarId: cal.id, totalRules }, "Calendar 2026 seeded successfully");
  } catch (err) {
    logger.error({ err }, "Failed to seed calendar 2026");
  }
}

// ─── Patch: reemplaza TODAS las reglas con los datos correctos ──────────────
// Detecta si ya fue aplicado verificando que existan reglas de convenio_multilateral
// con el grupo correcto "0-2" (vs el viejo "0,1").
export async function patchCalendar2026FullRules() {
  try {
    const [cal] = await db.select().from(annualDueCalendarsTable)
      .where(and(
        eq(annualDueCalendarsTable.year, 2026),
        eq(annualDueCalendarsTable.calendarType, "general"),
      ));

    if (!cal) {
      logger.info("No 2026 general calendar found — skipping patch");
      return;
    }

    // Check if already patched: convenio_multilateral rules exist with new CUIT groups
    const existingConvenio = await db.select().from(annualDueCalendarRulesTable)
      .where(and(
        eq(annualDueCalendarRulesTable.calendarId, cal.id),
        eq(annualDueCalendarRulesTable.taxType, "convenio_multilateral"),
      ));

    if (existingConvenio.length > 0) {
      logger.info("Calendar 2026 full rules already patched — skipping");
      return;
    }

    // Delete all existing rules for this calendar
    await db.delete(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, cal.id));

    // Insert all new corrected rules
    let totalRules = 0;
    for (const { taxType, rules } of ALL_RULE_SETS) {
      for (const rule of rules) {
        await db.insert(annualDueCalendarRulesTable).values({
          calendarId: cal.id,
          taxType,
          month: rule.month,
          cuitTermination: rule.cuitTermination,
          dueDay: rule.dueDay,
          notes: `Patch 2026 v2 — grupos CUIT y días por mes corregidos`,
        });
        totalRules++;
      }
    }

    logger.info(
      { calendarId: cal.id, totalRules },
      "Calendar 2026 full rules patched successfully (corrected CUIT groups and per-month days)"
    );
  } catch (err) {
    logger.error({ err }, "Failed to patch Calendar 2026 full rules");
  }
}

/** @deprecated Kept for backwards compat — full patch now handles ganancias */
export async function patchGanancias2026() {
  // No-op: patchCalendar2026FullRules() now handles all tax types
}
