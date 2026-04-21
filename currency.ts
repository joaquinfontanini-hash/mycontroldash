import { Router, type IRouter } from "express";
import {
  getCurrencyRates,
  refreshCurrencyRates,
  ensureCurrencyUpToDate,
} from "../services/currency.service.js";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// GET /currency — cotizaciones del dólar (blue, MEP, oficial, CCL, cripto)
// La actualización en background se dispara pero no bloquea la respuesta.
router.get("/currency", async (_req, res): Promise<void> => {
  try {
    ensureCurrencyUpToDate().catch((err: unknown) => {
      logger.warn({ err }, "ensureCurrencyUpToDate background update failed");
    });
    const rates = await getCurrencyRates();
    res.json(rates);
  } catch (err) {
    logger.error({ err }, "Currency route error");
    res.status(500).json({ error: "Error al cargar cotizaciones" });
  }
});

// POST /currency/refresh — fuerza actualización manual
// Requiere auth: evita que scrapers externos disparen fetches costosos a dolarapi.com
router.post("/currency/refresh", requireAuth, async (_req, res): Promise<void> => {
  try {
    const updated = await refreshCurrencyRates();
    const rates   = await getCurrencyRates();
    res.json({ ok: true, updated, rates });
  } catch (err) {
    logger.error({ err }, "Currency refresh error");
    res.status(500).json({ error: "Error al actualizar cotizaciones" });
  }
});

export default router;
