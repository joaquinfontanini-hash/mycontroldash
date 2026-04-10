import { db, currencyRatesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface DolarRate {
  type: string;
  label: string;
  buy: number | null;
  sell: number | null;
  avg: number | null;
  source: string;
  sourceUrl: string;
  status: "ok" | "error" | "stale";
  fetchedAt: string;
}

const DOLAR_TYPES = [
  { type: "oficial", label: "Dólar Oficial", sourceLabel: "DolarAPI / BNA" },
  { type: "blue",    label: "Dólar Blue",    sourceLabel: "DolarAPI / Ámbito" },
  { type: "bolsa",   label: "Dólar MEP",     sourceLabel: "DolarAPI / Bolsa" },
  { type: "cripto",  label: "Dólar Cripto",  sourceLabel: "DolarAPI" },
];

async function fetchDolarApi(tipo: string): Promise<{ compra: number; venta: number; fechaActualizacion: string } | null> {
  try {
    const url = `https://dolarapi.com/v1/dolares/${tipo}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "ExecutiveDashboard/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json() as unknown;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (typeof d.compra !== "number" || typeof d.venta !== "number") return null;
    return { compra: d.compra as number, venta: d.venta as number, fechaActualizacion: String(d.fechaActualizacion ?? "") };
  } catch (err) {
    logger.warn({ err, tipo }, "DolarAPI fetch failed");
    return null;
  }
}

export async function refreshCurrencyRates(): Promise<number> {
  let updated = 0;

  for (const dt of DOLAR_TYPES) {
    const raw = await fetchDolarApi(dt.type);

    const buy = raw?.compra ?? null;
    const sell = raw?.venta ?? null;
    const avg = (buy !== null && sell !== null) ? Math.round((buy + sell) / 2 * 100) / 100 : null;
    const status = raw ? "ok" : "error";

    try {
      const existing = await db
        .select()
        .from(currencyRatesTable)
        .where(eq(currencyRatesTable.type, dt.type))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(currencyRatesTable)
          .set({
            label: dt.label,
            buy: buy?.toString() ?? null,
            sell: sell?.toString() ?? null,
            avg: avg?.toString() ?? null,
            source: dt.sourceLabel,
            sourceUrl: `https://dolarapi.com/v1/dolares/${dt.type}`,
            status,
            fetchedAt: new Date(),
          })
          .where(eq(currencyRatesTable.type, dt.type));
      } else {
        await db.insert(currencyRatesTable).values({
          type: dt.type,
          label: dt.label,
          buy: buy?.toString() ?? null,
          sell: sell?.toString() ?? null,
          avg: avg?.toString() ?? null,
          source: dt.sourceLabel,
          sourceUrl: `https://dolarapi.com/v1/dolares/${dt.type}`,
          status,
        });
      }
      updated++;
    } catch (err) {
      logger.error({ err, type: dt.type }, "Failed to upsert currency rate");
    }
  }

  logger.info({ updated }, "Currency rates refresh completed");
  return updated;
}

export async function getCurrencyRates(): Promise<DolarRate[]> {
  const rows = await db
    .select()
    .from(currencyRatesTable)
    .orderBy(currencyRatesTable.type);

  return rows.map(r => ({
    type: r.type,
    label: r.label,
    buy: r.buy !== null ? Number(r.buy) : null,
    sell: r.sell !== null ? Number(r.sell) : null,
    avg: r.avg !== null ? Number(r.avg) : null,
    source: r.source,
    sourceUrl: r.sourceUrl ?? "",
    status: (r.status ?? "unknown") as "ok" | "error" | "stale",
    fetchedAt: r.fetchedAt.toISOString(),
  }));
}

export async function ensureCurrencyUpToDate(): Promise<void> {
  const rows = await db
    .select()
    .from(currencyRatesTable)
    .orderBy(desc(currencyRatesTable.fetchedAt))
    .limit(1);

  const stale = rows.length === 0 ||
    Date.now() - new Date(rows[0].fetchedAt).getTime() > 30 * 60 * 1000; // 30 min

  if (stale) {
    refreshCurrencyRates().catch(err => logger.error({ err }, "Background currency refresh failed"));
  }
}
