import { Router, type IRouter, Request, Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, financeAccountsTable, financeConfigTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VALID_TYPES = ["caja", "banco", "cripto", "inversiones", "deuda"] as const;

const DEFAULT_CONFIG: Record<string, string> = {
  gasto_mensual_umbral: "500000",
  liquidez_minima: "100000",
  alerta_deuda_umbral: "1000000",
};

async function ensureDefaultConfig() {
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    const [existing] = await db.select().from(financeConfigTable).where(eq(financeConfigTable.key, key));
    if (!existing) {
      await db.insert(financeConfigTable).values({ key, value });
    }
  }
}

router.get("/finance/accounts", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const accounts = await db.select().from(financeAccountsTable).orderBy(financeAccountsTable.createdAt);
    res.json(accounts);
  } catch (err) {
    logger.error({ err }, "finance accounts fetch error");
    res.status(500).json({ error: "Error al cargar cuentas" });
  }
});

router.post("/finance/accounts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { type, label, amount, currency, notes } = req.body ?? {};
  if (!type || !VALID_TYPES.includes(type) || !label) {
    res.status(400).json({ error: "type y label son requeridos" });
    return;
  }
  try {
    const [account] = await db.insert(financeAccountsTable).values({
      type,
      label,
      amount: String(amount ?? 0),
      currency: currency ?? "ARS",
      notes: notes ?? null,
    }).returning();
    res.status(201).json(account);
  } catch (err) {
    logger.error({ err }, "finance account create error");
    res.status(500).json({ error: "Error al crear cuenta" });
  }
});

router.put("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { type, label, amount, currency, notes } = req.body ?? {};
  try {
    const updates: Record<string, unknown> = {};
    if (type && VALID_TYPES.includes(type)) updates.type = type;
    if (label) updates.label = label;
    if (amount !== undefined) updates.amount = String(amount);
    if (currency) updates.currency = currency;
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(financeAccountsTable)
      .set(updates as any)
      .where(eq(financeAccountsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "finance account update error");
    res.status(500).json({ error: "Error al actualizar cuenta" });
  }
});

router.delete("/finance/accounts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const [deleted] = await db.delete(financeAccountsTable).where(eq(financeAccountsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Cuenta no encontrada" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "finance account delete error");
    res.status(500).json({ error: "Error al eliminar cuenta" });
  }
});

router.get("/finance/summary", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureDefaultConfig();
    const accounts = await db.select().from(financeAccountsTable).orderBy(financeAccountsTable.createdAt);
    const config = await db.select().from(financeConfigTable);
    const configMap: Record<string, string> = {};
    for (const c of config) configMap[c.key] = c.value;

    let liquidez = 0;
    let inversiones = 0;
    let deudas = 0;

    for (const a of accounts) {
      const amt = parseFloat(a.amount);
      if (a.type === "caja" || a.type === "banco") liquidez += amt;
      else if (a.type === "cripto" || a.type === "inversiones") inversiones += amt;
      else if (a.type === "deuda") deudas += Math.abs(amt);
    }

    const patrimonio = liquidez + inversiones - deudas;

    const gastoUmbral = parseFloat(configMap["gasto_mensual_umbral"] ?? "500000");
    const liquidezMin = parseFloat(configMap["liquidez_minima"] ?? "100000");
    const deudaUmbral = parseFloat(configMap["alerta_deuda_umbral"] ?? "1000000");

    const alerts: { type: string; level: string; message: string }[] = [];
    if (liquidez < liquidezMin) {
      alerts.push({ type: "liquidez", level: "critical", message: `Liquidez baja: $${liquidez.toLocaleString("es-AR")}` });
    }
    if (deudas > deudaUmbral) {
      alerts.push({ type: "deuda", level: "high", message: `Deuda elevada: $${deudas.toLocaleString("es-AR")}` });
    }

    res.json({
      patrimonio,
      liquidez,
      inversiones,
      deudas,
      accounts,
      alerts,
      config: configMap,
    });
  } catch (err) {
    logger.error({ err }, "finance summary error");
    res.status(500).json({ error: "Error al calcular resumen financiero" });
  }
});

router.get("/finance/config", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureDefaultConfig();
    const config = await db.select().from(financeConfigTable);
    const configMap: Record<string, string> = {};
    for (const c of config) configMap[c.key] = c.value;
    res.json(configMap);
  } catch (err) {
    logger.error({ err }, "finance config fetch error");
    res.status(500).json({ error: "Error al cargar configuración" });
  }
});

router.put("/finance/config/:key", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key as string;
  const { value } = req.body ?? {};
  if (!value) { res.status(400).json({ error: "value es requerido" }); return; }
  try {
    const [existing] = await db.select().from(financeConfigTable).where(eq(financeConfigTable.key, key));
    if (existing) {
      await db.update(financeConfigTable).set({ value: String(value) }).where(eq(financeConfigTable.key, key));
    } else {
      await db.insert(financeConfigTable).values({ key, value: String(value) });
    }
    res.json({ key, value });
  } catch (err) {
    logger.error({ err }, "finance config update error");
    res.status(500).json({ error: "Error al guardar configuración" });
  }
});

export default router;
