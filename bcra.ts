import { Router, type IRouter } from "express";
import {
  getBcraIndicators,
  refreshBcraIndicators,
} from "../services/bcra.service.js";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// GET /bcra/indicators — indicadores BCRA: IPC, ICL, tasas de referencia, reservas
// Sirve datos cacheados en la DB; el scheduler los actualiza cada N horas.
router.get("/bcra/indicators", async (_req, res): Promise<void> => {
  try {
    const data = await getBcraIndicators();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "BCRA indicators route error");
    res.status(500).json({ error: "Error al cargar indicadores BCRA" });
  }
});

// POST /bcra/refresh — fuerza actualización manual de indicadores
// Requiere auth: evita que scrapers externos disparen fetches a la API del BCRA.
router.post("/bcra/refresh", requireAuth, async (_req, res): Promise<void> => {
  try {
    const fetched  = await refreshBcraIndicators();
    const data     = await getBcraIndicators();
    // Respuesta estructurada explícita — no hacemos spread de `data`
    // para evitar exponer campos internos si el servicio agrega campos en el futuro
    res.json({
      ok:         true,
      fetched,
      indicators: data,
    });
  } catch (err) {
    logger.error({ err }, "BCRA refresh route error");
    res.status(500).json({ error: "Error al refrescar indicadores BCRA" });
  }
});

export default router;
