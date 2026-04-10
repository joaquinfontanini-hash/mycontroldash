import { db, annualDueCalendarsTable, annualDueCalendarRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const IVA_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  ...[1,2,3,4,5,6,7,8,9,10,11,12].flatMap(month => [
    { month, cuitTermination: "0,1", dueDay: 20 },
    { month, cuitTermination: "2,3", dueDay: 21 },
    { month, cuitTermination: "4,5", dueDay: 22 },
    { month, cuitTermination: "6,7", dueDay: 23 },
    { month, cuitTermination: "8,9", dueDay: 24 },
  ]),
];

const MONOTRIBUTO_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  ...[1,2,3,4,5,6,7,8,9,10,11,12].flatMap(month => [
    { month, cuitTermination: "0,1", dueDay: 20 },
    { month, cuitTermination: "2,3", dueDay: 21 },
    { month, cuitTermination: "4,5", dueDay: 22 },
    { month, cuitTermination: "6,7", dueDay: 23 },
    { month, cuitTermination: "8,9", dueDay: 24 },
  ]),
];

const AUTONOMOS_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  ...[1,2,3,4,5,6,7,8,9,10,11,12].flatMap(month => [
    { month, cuitTermination: "0,1", dueDay: 3 },
    { month, cuitTermination: "2,3", dueDay: 4 },
    { month, cuitTermination: "4,5", dueDay: 5 },
    { month, cuitTermination: "6,7", dueDay: 6 },
    { month, cuitTermination: "8,9", dueDay: 10 },
  ]),
];

const CARGAS_SOCIALES_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  ...[1,2,3,4,5,6,7,8,9,10,11,12].flatMap(month => [
    { month, cuitTermination: "0,1", dueDay: 7 },
    { month, cuitTermination: "2,3", dueDay: 8 },
    { month, cuitTermination: "4,5", dueDay: 9 },
    { month, cuitTermination: "6,7", dueDay: 10 },
    { month, cuitTermination: "8,9", dueDay: 11 },
  ]),
];

const GANANCIAS_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  { month: 6, cuitTermination: "any", dueDay: 26 },
  { month: 7, cuitTermination: "any", dueDay: 3 },
];

const IIBB_NQN_RULES: Array<{ month: number; cuitTermination: string; dueDay: number }> = [
  ...[1,2,3,4,5,6,7,8,9,10,11,12].map(month => ({
    month, cuitTermination: "any", dueDay: 15,
  })),
];

export async function seedCalendar2026() {
  try {
    const existing = await db.select().from(annualDueCalendarsTable)
      .where(eq(annualDueCalendarsTable.year, 2026));

    if (existing.length > 0) {
      logger.info("Calendar 2026 already seeded, skipping");
      return;
    }

    const [cal] = await db.insert(annualDueCalendarsTable).values({
      name: "Calendario AFIP 2026",
      year: 2026,
      status: "active",
      parseStatus: "done",
      notes: "Seeded automáticamente. IVA, Monotributo, Autónomos, Cargas Sociales, Ganancias (estimado), IIBB Neuquén. Verificar con tabla oficial AFIP.",
    }).returning();

    const rulesSets = [
      { taxType: "iva", rules: IVA_RULES },
      { taxType: "monotributo", rules: MONOTRIBUTO_RULES },
      { taxType: "autonomos", rules: AUTONOMOS_RULES },
      { taxType: "cargas_sociales", rules: CARGAS_SOCIALES_RULES },
      { taxType: "ganancias", rules: GANANCIAS_RULES },
      { taxType: "iibb_neuquen", rules: IIBB_NQN_RULES },
    ];

    let totalRules = 0;
    for (const { taxType, rules } of rulesSets) {
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
