import { db, dueDateCategoriesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const DEFAULT_CATEGORIES = [
  { name: "Impuestos",       color: "red"    },
  { name: "Cargas Sociales", color: "orange" },
  { name: "Proveedores",     color: "blue"   },
  { name: "Honorarios",      color: "purple" },
  { name: "Alquileres",      color: "teal"   },
  { name: "Vencimientos AFIP", color: "red"  },
  { name: "Otros",           color: "gray"   },
];

export async function seedDefaultCategories(): Promise<void> {
  try {
    const existing = await db.select({ count: sql<number>`count(*)` }).from(dueDateCategoriesTable);
    const count = Number(existing[0]?.count ?? 0);
    if (count > 0) return;

    await db.insert(dueDateCategoriesTable).values(DEFAULT_CATEGORIES);
    logger.info({ count: DEFAULT_CATEGORIES.length }, "Seeded default due-date categories");
  } catch (err) {
    logger.error({ err }, "Failed to seed default categories");
  }
}
