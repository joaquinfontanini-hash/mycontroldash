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
// Tabla oficial ARCA 2026 — fuente: calendariofiscal.com.ar/impuestos/autonomos
// Los 3 grupos pagan días hábiles CONSECUTIVOS (no bases independientes).
// Cada fila = [mes, dia_0-3, dia_4-6, dia_7-9]
// Nota Nov: AFIP saltea Vie 6-nov (asueto largo), arranca el 9 (lun).
// Nota Dic: Dec 5=Sáb + Dec 7=puente + Dec 8=Inmaculada → arranca el 9 (mié).
const AUTONOMOS_TABLE: [number, number, number, number][] = [
  [1,  5,  6,  7],
  [2,  5,  6,  9],
  [3,  5,  6,  9],
  [4,  6,  7,  8],
  [5,  5,  6,  7],
  [6,  5,  8,  9],
  [7,  6,  7,  8],
  [8,  5,  6,  7],
  [9,  7,  8,  9],
  [10, 5,  6,  7],
  [11, 5,  9,  10],
  [12, 9,  10, 11],
];
const AUTONOMOS_RULES: Rule[] = AUTONOMOS_TABLE.flatMap(([month, d03, d46, d79]) => [
  { month, cuitTermination: "0-3", dueDay: d03 },
  { month, cuitTermination: "4-6", dueDay: d46 },
  { month, cuitTermination: "7-9", dueDay: d79 },
]);

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
// Tabla oficial ARCA 2026 hardcodeada (fuente: calendariofiscal.com.ar / ARCA).
// La fórmula wd() es insuficiente porque no modela feriados ni puentes argentinos.
// Ejemplo de desvíos: Mar 8-9: fórmula=23, ARCA=26 (puente 23, feriado Memoria 24, puente 25).
//
//                     Ene  Feb  Mar  Abr  May  Jun  Jul  Ago  Sep  Oct  Nov  Dic
const IVA_TABLE: Record<string, number[]> = {
  "0-1": [19, 18, 18, 20, 18, 18, 20, 18, 18, 19, 18, 18],
  "2-3": [20, 19, 19, 21, 19, 19, 21, 19, 21, 20, 19, 21],
  "4-5": [21, 20, 20, 22, 20, 22, 22, 20, 22, 21, 20, 22],
  "6-7": [22, 23, 25, 23, 21, 23, 23, 21, 23, 22, 24, 23],
  "8-9": [23, 24, 26, 24, 22, 24, 24, 24, 24, 23, 25, 28], // Dic: 24=Nochebuena+Navidad+finde → 28
};

const IVA_RULES: Rule[] = Object.entries(IVA_TABLE).flatMap(
  ([cuitTermination, days]) =>
    days.map((dueDay, i) => ({ month: i + 1, cuitTermination, dueDay }))
);

// ─── INTERNOS (excepto cigarrillos) DDJJ ────────────────────────────────────
// Grupos: 0-3 (base 18), 4-6 (base 19), 7-9 (base 20)
const INTERNOS_RULES: Rule[] = [
  ...monthlyGroup("0-3", 18),
  ...monthlyGroup("4-6", 19),
  ...monthlyGroup("7-9", 20),
];

// ─── SICORE/SIRE 1° Quincena — Pago a cuenta ───────────────────────────────
// Tabla oficial SIRE 2026 — fuente: calendariofiscal.com.ar/impuestos/sire
// Fila = [mes, dia_0-3, dia_4-6, dia_7-9]
// La fórmula wd() falla en Feb (Carnaval), Ago (finde comprimido), Nov (Soberanía+puente).
const SICORE_1Q_TABLE: [number, number, number, number][] = [
  [1,  21, 22, 23],  // ene
  [2,  20, 23, 24],  // feb: 21-22=Carnaval → 20(vie), luego 23(lun), 24(mar)
  [3,  25, 26, 27],  // mar: 21-22=finde → pero feriados Memoria+V.Santo corrren al 25
  [4,  21, 22, 23],  // abr
  [5,  21, 22, 26],  // may: 7-9 corre al 26 (25-may=feriado)
  [6,  22, 23, 24],  // jun: 21=dom → 22, 23, 24
  [7,  21, 22, 23],  // jul
  [8,  21, 24, 25],  // ago: 22=sáb, 23=dom → 24(lun), 25(mar)
  [9,  21, 22, 23],  // sep
  [10, 21, 22, 23],  // oct
  [11, 24, 25, 26],  // nov: Soberanía 20(vie)+finde+puente23(lun) → arranca 24(mar)
  [12, 21, 22, 23],  // dic: antes de Nochebuena
];
const SICORE_1Q_RULES: Rule[] = SICORE_1Q_TABLE.flatMap(([month, d03, d46, d79]) => [
  { month, cuitTermination: "0-3", dueDay: d03 },
  { month, cuitTermination: "4-6", dueDay: d46 },
  { month, cuitTermination: "7-9", dueDay: d79 },
]);

// ─── SICORE/SIRE 2° Quincena — DDJJ e ingreso de saldo ─────────────────────
// Tabla oficial SIRE 2026 — fuente: calendariofiscal.com.ar/impuestos/sire
// IMPORTANTE: son fechas ~9-15 del mes, NO iguales a 1Q. La fórmula anterior
// usaba bases 21/22/23 (iguales a 1Q) lo que era incorrecto.
// Fila = [mes, dia_0-3, dia_4-6, dia_7-9]
const SICORE_DDJJ_TABLE: [number, number, number, number][] = [
  [1,   9, 12, 13],  // ene: 10=sáb, 11=dom → 12(lun), 13(mar)
  [2,   9, 10, 11],  // feb
  [3,   9, 10, 11],  // mar
  [4,   9, 10, 13],  // abr: 11=sáb, 12=dom → 13(lun)
  [5,  11, 12, 13],  // may: 9=sáb, 10=dom → 11(lun), 12(mar), 13(mié)
  [6,   9, 10, 11],  // jun
  [7,  13, 14, 15],  // jul: 9=jue → pero Belgrano 20 → quincena corre; 9=jue ✓, 10=vie, 13=lun... sic oficial
  [8,  10, 11, 12],  // ago: 9=dom → 10(lun), 11(mar), 12(mié)
  [9,   9, 10, 11],  // sep
  [10,  9, 13, 14],  // oct: 10=sáb, 11=dom, 12=Día Raza(lun) → 13(mar), 14(mié)
  [11,  9, 10, 11],  // nov
  [12,  9, 10, 11],  // dic
];
const SICORE_DDJJ_RULES: Rule[] = SICORE_DDJJ_TABLE.flatMap(([month, d03, d46, d79]) => [
  { month, cuitTermination: "0-3", dueDay: d03 },
  { month, cuitTermination: "4-6", dueDay: d46 },
  { month, cuitTermination: "7-9", dueDay: d79 },
]);

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
// Detección: busca "patch-v7-done" en el campo notes del calendario.
// Si ya está, no hace nada. Si no, aplica el patch completo:
//   1. Borra vencimientos 2026 generados por el engine (source = afip-engine)
//   2. Reemplaza todas las reglas del calendario con los datos correctos
//   3. Regenera vencimientos de todos los clientes activos
//   4. Marca el calendario como patched ("patch-v7-done")
//
// v6: Autónomos — tabla hardcodeada oficial ARCA (elimina grupo "any" + corrige
//     fechas 7-9 que eran incorrectas con fórmula independiente vs. días hábiles
//     consecutivos reales: ene=7, abr=8, may=7, jul=8, ago=7, oct=7, nov=10, dic=11)
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
    if (cal.notes?.includes("patch-v7-done")) {
      logger.info("Calendar 2026 patch v7 already applied — skipping");
      return;
    }

    logger.info({ calendarId: cal.id }, "Applying Calendar 2026 patch v7…");

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
          notes: `Patch 2026 v7 — SICORE tablas oficiales SIRE + Autónomos + IVA`,
        });
        totalRules++;
      }
    }
    logger.info({ totalRules }, "Calendar 2026 rules replaced (v7)");

    // ── Step 3: regenerate due dates for all active clients ──────────────────
    // Dynamic import to avoid circular dependency at module load time
    const { generateDueDatesForAllClients } = await import("../services/afip-engine.js");
    const genResult = await generateDueDatesForAllClients();
    logger.info(genResult, "Regenerated due dates for all clients after calendar patch v7");

    // ── Step 4: mark calendar as patched ─────────────────────────────────────
    await db.update(annualDueCalendarsTable)
      .set({ notes: (cal.notes ?? "") + " | patch-v7-done" })
      .where(eq(annualDueCalendarsTable.id, cal.id));

    logger.info({ calendarId: cal.id, totalRules, ...genResult }, "Calendar 2026 patch v7 completed");
  } catch (err) {
    logger.error({ err }, "Failed to apply Calendar 2026 patch v7");
  }
}

/** @deprecated Kept for backwards compat — full patch now handles ganancias */
export async function patchGanancias2026() {
  // No-op: patchCalendar2026FullRules() handles all tax types
}
