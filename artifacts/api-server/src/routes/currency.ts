import { Router, type IRouter } from "express";
import { getCurrencyRates, refreshCurrencyRates, ensureCurrencyUpToDate } from "../services/currency.service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/currency", async (_req, res): Promise<void> => {
  try {
    await ensureCurrencyUpToDate();
    const rates = await getCurrencyRates();
    res.json(rates);
  } catch (err) {
    logger.error({ err }, "Currency route error");
    res.status(500).json({ error: "Error al cargar cotizaciones" });
  }
});

router.post("/currency/refresh", async (_req, res): Promise<void> => {
  try {
    const count = await refreshCurrencyRates();
    const rates = await getCurrencyRates();
    res.json({ ok: true, updated: count, rates });
  } catch (err) {
    logger.error({ err }, "Currency refresh error");
    res.status(500).json({ error: "Error al actualizar cotizaciones" });
  }
});

export default router;
