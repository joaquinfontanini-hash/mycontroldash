import { db, annualDueCalendarsTable, annualDueCalendarRulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────
type Rule = { month: number; cuitTermination: string; dueDay: number };

// ─── 2026 day-of-week for 1st of each month ────────────────────────────────
// 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Jan 1 = Thu (4). Verified against calendar.
const FOM_DOW_2026 = [4, 0, 0, 3, 5, 1, 3, 6, 2, 4, 0, 2]; // Jan→Dec

/**
 * Returns the actual AFIP due day for a given base day and month,
 * shifting Saturdays to Monday (+2) and Sundays to Monday (+1).
 * Argentine national holidays are NOT included here — add them as
 * known exceptions if specific months are flagged by the user.
 */
function wd(month: number, baseDay: number): number {
  const fom = FOM_DOW_2026[month - 1]!;
  const dow = (fom + baseDay - 1) % 7;
  if (dow === 6) return baseDay + 2; // Sat → Mon
  if (dow === 0) return baseDay + 1; // Sun → Mon
  return baseDay;
}

/** Builds 12 monthly rules for a cuit group with a given base due day */
function monthlyGroup(cuitTermination: string, baseDay: number): Rule[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    cuitTermination,
    dueDay: wd(i + 1, baseDay),
  }));
}

// ─── AUTÓNOMOS ──────────────────────────────────────────────────────────────
// Grupos: 0-3 (base 5), 4-6 (base 6), 7-9 (base 9), any = general (base 20)
// Verificado: CUIT 0 → Ene=5, Feb=5, Mar=5, Abr=6 ✓
const AUTONOMOS_RULES: Rule[] = [
  ...monthlyGroup("0-3", 5),
  ...monthlyGroup("4-6", 6),
  ...monthlyGroup("7-9", 9),
  ...monthlyGroup("any", 20),
];

// ─── MONOTRIBUTO ────────────────────────────────────────────────────────────
// Un solo vencimiento general para todos los CUIT (base 20)
const MONOTRIBUTO_RULES: Rule[] = [
  ...monthlyGroup("any", 20),
];

// ─── EMPLEADORES SICOSS ─────────────────────────────────────────────────────
// Grupos: 0-3 (base 9), 4-6 (base 10), 7-9 (base 11)
const CARGAS_SOCIALES_RULES: Rule[] = [
  ...monthlyGroup("0-3", 9),
  ...monthlyGroup("4-6", 10),
  ...monthlyGroup("7-9", 11),
];

// ─── GANANCIAS SOCIEDADES DDJJ ──────────────────────────────────────────────
// Grupos: 0-3 (base 13), 4-6 (base 14), 7-9 (base 15)
const GANANCIAS_RULES: Rule[] = [
  ...monthlyGroup("0-3", 13),
  ...monthlyGroup("4-6", 14),
  ...monthlyGroup("7-9", 15),
];

// ─── ANTICIPOS (Gcias. Sociedades, Pers. Humanas, Bienes Personales, FC) ────
// Mismo patrón que ganancias
const ANTICIPO_GANANCIAS_RULES: Rule[] = [
  ...monthlyGroup("0-3", 13),
  ...monthlyGroup("4-6", 14),
  ...monthlyGroup("7-9", 15),
];

// ─── CONVENIO MULTILATERAL ─────────────────────────────────────────────────
// Grupos: 0-2 (base 13), 3-5 (base 15), 6-7 (base 16), 8-9 (base 17)
const CONVENIO_MULTILATERAL_RULES: Rule[] = [
  ...monthlyGroup("0-2", 13),
  ...monthlyGroup("3-5", 15),
  ...monthlyGroup("6-7", 16),
  ...monthlyGroup("8-9", 17),
];

// ─── IVA DDJJ ───────────────────────────────────────────────────────────────
// Grupos: 0-1 (base 18), 2-3 (base 19), 4-5 (base 20), 6-7 (base 21), 8-9 (base 22)
// Verificado: CUIT 0 → Ene=19, Feb=18, Mar=18, Abr=20 ✓
const IVA_RULES: Rule[] = [
  ...monthlyGroup("0-1", 18),
  ...monthlyGroup("2-3", 19),
  ...monthlyGroup("4-5", 20),
  ...monthlyGroup("6-7", 21),
  ...monthlyGroup("8-9", 22),
];

// ─── INTERNOS (excepto cigarrillos) DDJJ ────────────────────────────────────
// Grupos: 0-3 (base 18), 4-6 (base 19), 7-9 (base 20)
const INTERNOS_RULES: Rule[] = [
  ...monthlyGroup("0-3", 18),
  ...monthlyGroup("4-6", 19),
  ...monthlyGroup("7-9", 20),
];

// ─── SICORE/SIRE 1° Quincena — Pago a cuenta ───────────────────────────────
// Grupos: 0-3 (base 21), 4-6 (base 22), 7-9 (base 23)
const SICORE_1Q_RULES: Rule[] = [
  ...monthlyGroup("0-3", 21),
  ...monthlyGroup("4-6", 22),
  ...monthlyGroup("7-9", 23),
];

// ─── SICORE/SIRE 2° Quincena — DDJJ e ingreso de saldo ─────────────────────
// Mismos días base que 1° quincena
const SICORE_DDJJ_RULES: Rule[] = [
  ...monthlyGroup("0-3", 21),
  ...monthlyGroup("4-6", 22),
  ...monthlyGroup("7-9", 23),
];

// ─── PERSONAL DE CASAS PARTICULARES ────────────────────────────────────────
// Un solo vencimiento para todos los CUIT (base 15)
const EMPLEADA_DOMESTICA_RULES: Rule[] = [
  ...monthlyGroup("any", 15),
];

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
      notes: "Seeded automáticamente. Ajuste automático de fines de semana aplicado. Verificar meses con feriados nacionales.",
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
// Detecta si necesita patch chequeando si las reglas de IVA 0-1 en enero
// tienen el día correcto (19). Si tiene 20, se aplica el patch v3.
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

    // Check if already patched: IVA Jan 0-1 should be 19 (base 18, Jan 18=Sun→19)
    const ivaJanRules = await db.select().from(annualDueCalendarRulesTable)
      .where(and(
        eq(annualDueCalendarRulesTable.calendarId, cal.id),
        eq(annualDueCalendarRulesTable.taxType, "iva"),
        eq(annualDueCalendarRulesTable.month, 1),
        eq(annualDueCalendarRulesTable.cuitTermination, "0-1"),
      ));

    const ivaJanDay = ivaJanRules[0]?.dueDay;
    if (ivaJanDay === wd(1, 18)) {
      logger.info({ ivaJanDay }, "Calendar 2026 rules already up-to-date — skipping patch");
      return;
    }

    logger.info({ ivaJanDay, expected: wd(1, 18) }, "Applying Calendar 2026 full patch v3 (corrected base days)");

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
          notes: `Patch 2026 v3 — días base corregidos + ajuste fin de semana`,
        });
        totalRules++;
      }
    }

    logger.info(
      { calendarId: cal.id, totalRules },
      "Calendar 2026 full rules patched (v3: correct base days, auto weekend adjustment)"
    );
  } catch (err) {
    logger.error({ err }, "Failed to patch Calendar 2026 full rules");
  }
}

/** @deprecated Kept for backwards compat — full patch now handles ganancias */
export async function patchGanancias2026() {
  // No-op: patchCalendar2026FullRules() handles all tax types
}
