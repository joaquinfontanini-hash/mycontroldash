import { Router, type IRouter } from "express";
import { getBcraIndicators, refreshBcraIndicators } from "../services/bcra.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// GET /bcra/indicators — returns cached indicators with metadata
router.get("/bcra/indicators", async (_req, res): Promise<void> => {
  try {
    const data = await getBcraIndicators();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "bcra indicators route error");
    res.status(500).json({ error: "Error al cargar indicadores BCRA" });
  }
});

// POST /bcra/refresh — manual refresh (admin use)
router.post("/bcra/refresh", async (_req, res): Promise<void> => {
  try {
    const fetched = await refreshBcraIndicators();
    const data    = await getBcraIndicators();
    res.json({ ok: true, fetched, ...data });
  } catch (err) {
    logger.error({ err }, "bcra refresh route error");
    res.status(500).json({ error: "Error al refrescar indicadores BCRA" });
  }
});

export default router;
