import { db, dueDateCategoriesTable } from "@workspace/db";
import { logger } from "./logger.js";

// ── Categorías default de vencimientos ───────────────────────────────────────
// Estas categorías son la configuración base del estudio contable.
// El seed es idempotente: usa onConflictDoNothing para que múltiples
// ejecuciones (cada deploy de Railway) no fallen ni dupliquen registros.
//
// La idempotencia por nombre (no COUNT global) garantiza que si se agrega
// una categoría nueva a esta lista, se insertará en el próximo deploy
// sin afectar las categorías existentes ni las que el usuario haya creado.

const DEFAULT_CATEGORIES = [
  { name: "Impuestos",         color: "red"    },
  { name: "Cargas Sociales",   color: "orange" },
  { name: "Proveedores",       color: "blue"   },
  { name: "Honorarios",        color: "purple" },
  { name: "Alquileres",        color: "teal"   },
  { name: "Vencimientos AFIP", color: "red"    },
  { name: "Otros",             color: "gray"   },
] as const;

export async function seedDefaultCategories(): Promise<void> {
  try {
    // Insertar cada categoría con onConflictDoNothing basado en nombre.
    // Si ya existe una categoría con ese nombre, la operación se omite
    // silenciosamente — sin error, sin duplicado.
    //
    // Esto es verdaderamente idempotente:
    //   - Primer deploy: inserta todas
    //   - Deploys siguientes: no duplica ni falla
    //   - Si se agrega una categoría nueva a la lista: la inserta en el próximo deploy
    //   - Categorías creadas por el usuario: no se tocan
    const result = await db
      .insert(dueDateCategoriesTable)
      .values(DEFAULT_CATEGORIES.map((c) => ({ ...c })))
      .onConflictDoNothing({ target: dueDateCategoriesTable.name });

    // onConflictDoNothing no devuelve cuántas se insertaron — loguear intentado
    logger.info(
      { attempted: DEFAULT_CATEGORIES.length },
      "seedDefaultCategories: completado (onConflictDoNothing)",
    );
  } catch (err) {
    // No relanzar — un fallo en el seed no debe impedir que el servidor arranque
    logger.error({ err }, "seedDefaultCategories: falló");
  }
}
