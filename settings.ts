import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Helper: obtener o crear la fila única de configuración ────────────────────
async function ensureSettings(): Promise<typeof appSettingsTable.$inferSelect> {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

// ── GET /settings ─────────────────────────────────────────────────────────────
// Requiere auth: la configuración global (coordenadas de clima, toggles de jobs,
// presupuesto de viajes, etc.) no debe ser pública — cualquier actor externo
// podría scrapear datos de configuración del estudio.
router.get("/settings", requireAuth, async (_req, res): Promise<void> => {
  try {
    const settings = await ensureSettings();
    res.json(settings);
  } catch (err) {
    logger.error({ err }, "settings GET error");
    res.status(500).json({ error: "Error al cargar configuración" });
  }
});

// ── PATCH /settings ───────────────────────────────────────────────────────────
// Solo admins: modificar la configuración global (habilitar/deshabilitar jobs,
// cambiar ciudad de clima, límites de viaje) es una operación administrativa.
// El original era completamente público — cualquiera podía modificar la config.
router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = UpdateSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
      return;
    }

    const existing = await ensureSettings();
    const [updated] = await db
      .update(appSettingsTable)
      .set(parsed.data)
      .where(eq(appSettingsTable.id, existing.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "settings PATCH error");
    res.status(500).json({ error: "Error al actualizar configuración" });
  }
});

export default router;
