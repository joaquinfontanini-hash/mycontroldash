import { db, annualDueCalendarsTable, annualDueCalendarRulesTable, dueDatesTable } from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────
type Rule = { month: number; cuitTermination: string; dueDay: number };

// ─── 2026 day-of-week for 1st of each month ────────────────────────────────
// 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Jan 1, 2026 = Thursday (4). 2026 is NOT a leap year (Feb = 28 days).
const FOM_DOW_2026 = [4, 0, 0, 3, 5, 1, 3, 6, 2, 4, 0, 2]; // Jan→Dec

/**
 * Returns the actual AFIP due day for a given base day and month in 2026,
 * shifting Saturdays (+2 days → Mon) and Sundays (+1 day → Mon).
 *
 * Argentine national holidays are NOT modeled here.
 * Add exceptions as needed if a specific month+day deviates.
 */
function wd(month: number, baseDay: number): number {
  const fom = FOM_DOW_2026[month - 1]!;
  const dow = (fom + baseDay - 1) % 7;
  if (dow === 6) return baseDay + 2; // Sat → Mon
  if (dow === 0) return baseDay + 1; // Sun → Mon
  return baseDay;
}

/** Builds 12 monthly rules for a CUIT group with a given base due day */
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
      notes: "Seed 2026 v3",
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
          notes: `Seed 2026 v3 - ${taxType}`,
        });
        totalRules++;
      }
    }

    logger.info({ calendarId: cal.id, totalRules }, "Calendar 2026 seeded (v3)");
  } catch (err) {
    logger.error({ err }, "Failed to seed calendar 2026");
  }
}

// ─── Patch: reemplaza reglas Y regenera vencimientos de todos los clientes ──
//
// Detección: busca "patch-v3-done" en el campo notes del calendario.
// Si ya está, no hace nada. Si no, aplica el patch completo:
//   1. Borra vencimientos 2026 generados por el engine (source = afip-engine)
//   2. Reemplaza todas las reglas del calendario con los datos correctos
//   3. Regenera vencimientos de todos los clientes activos
//   4. Marca el calendario como patched ("patch-v3-done")
//
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

    // Already fully patched?
    if (cal.notes?.includes("patch-v3-done")) {
      logger.info("Calendar 2026 patch v3 already applied — skipping");
      return;
    }

    logger.info({ calendarId: cal.id }, "Applying Calendar 2026 patch v3…");

    // ── Step 1: delete all 2026 afip-engine due dates (stale from old rules) ─
    const deleted = await db.delete(dueDatesTable).where(and(
      eq(dueDatesTable.source, "afip-engine"),
      like(dueDatesTable.dueDate, "2026-%"),
    )).returning({ id: dueDatesTable.id });
    logger.info({ deletedCount: deleted.length }, "Deleted stale 2026 AFIP-engine due dates");

    // ── Step 2: replace all calendar rules ──────────────────────────────────
    await db.delete(annualDueCalendarRulesTable)
      .where(eq(annualDueCalendarRulesTable.calendarId, cal.id));

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
    logger.info({ totalRules }, "Calendar 2026 rules replaced (v3)");

    // ── Step 3: regenerate due dates for all active clients ──────────────────
    // Dynamic import to avoid circular dependency at module load time
    const { generateDueDatesForAllClients } = await import("../services/afip-engine.js");
    const genResult = await generateDueDatesForAllClients();
    logger.info(genResult, "Regenerated due dates for all clients after calendar patch v3");

    // ── Step 4: mark calendar as patched ─────────────────────────────────────
    await db.update(annualDueCalendarsTable)
      .set({ notes: (cal.notes ?? "") + " | patch-v3-done" })
      .where(eq(annualDueCalendarsTable.id, cal.id));

    logger.info({ calendarId: cal.id, totalRules, ...genResult }, "Calendar 2026 patch v3 completed");
  } catch (err) {
    logger.error({ err }, "Failed to apply Calendar 2026 patch v3");
  }
}

/** @deprecated Kept for backwards compat — full patch now handles ganancias */
export async function patchGanancias2026() {
  // No-op: patchCalendar2026FullRules() handles all tax types
}
