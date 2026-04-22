import { db, currencyRatesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";

const SOURCE_NAME = "DolarAPI";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface DolarRate {
  type:      string;
  label:     string;
  buy:       number | null;
  sell:      number | null;
  avg:       number | null;
  source:    string;
  sourceUrl: string;
  status:    "ok" | "error" | "stale";
  fetchedAt: string;
}

interface DolarApiResponse {
  compra:             number;
  venta:              number;
  fechaActualizacion: string;
}

const DOLAR_TYPES = [
  { type: "oficial", label: "Dólar Oficial", sourceLabel: "DolarAPI / BNA" },
  { type: "blue",    label: "Dólar Blue",    sourceLabel: "DolarAPI / Ámbito" },
  { type: "bolsa",   label: "Dólar MEP",     sourceLabel: "DolarAPI / Bolsa" },
  { type: "cripto",  label: "Dólar Cripto",  sourceLabel: "DolarAPI" },
] as const;

// ── Fetch tipado ───────────────────────────────────────────────────────────────
// SEGURIDAD: DolarAPI es una API pública sin autenticación.
// No hay API key que pueda filtrarse en logs.
// El error solo registra el status HTTP y el tipo — nunca la URL completa.
async function fetchDolarApi(tipo: string): Promise<DolarApiResponse> {
  const url = `https://dolarapi.com/v1/dolares/${tipo}`;
  const res  = await fetch(url, {
    signal:  AbortSignal.timeout(8_000),
    headers: { "User-Agent": "ExecutiveDashboard/1.0" },
  });

  if (!res.ok) {
    // Loguear solo status HTTP — no la URL ni ningún parámetro de auth
    throw new Error(`DolarAPI HTTP ${res.status} para tipo="${tipo}"`);
  }

  const raw = (await res.json()) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>)["compra"] !== "number" ||
    typeof (raw as Record<string, unknown>)["venta"] !== "number"
  ) {
    throw new Error(`DolarAPI respuesta inválida para tipo="${tipo}"`);
  }

  const d = raw as Record<string, unknown>;
  return {
    compra:             d["compra"] as number,
    venta:              d["venta"] as number,
    fechaActualizacion: String(d["fechaActualizacion"] ?? ""),
  };
}

// ── refreshCurrencyRates ───────────────────────────────────────────────────────
// Paraleliza los 4 fetches con Promise.allSettled — en lugar de secuencial.
// El original hacía for...of con await: 4 fetches × ~1s = ~4s en serie.
// Con allSettled: ~1s total (el más lento determina el tiempo).
// Si alguno falla, los otros siguen procesándose.
export async function refreshCurrencyRates(): Promise<number> {
  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn({ source: SOURCE_NAME }, "currency.service: circuit abierto, saltando refresh");
    return 0;
  }

  // Disparar todos los fetches en paralelo
  const results = await Promise.allSettled(
    DOLAR_TYPES.map(async (dt) => {
      const raw = await fetchDolarApi(dt.type);
      return { dt, raw };
    }),
  );

  let updated      = 0;
  let anySuccess   = false;
  let anyFailure   = false;

  for (const result of results) {
    const dt  = DOLAR_TYPES[results.indexOf(result)]!;

    let buy:  number | null = null;
    let sell: number | null = null;
    let avg:  number | null = null;
    let status: "ok" | "error" = "error";

    if (result.status === "fulfilled") {
      buy    = result.value.raw.compra;
      sell   = result.value.raw.venta;
      avg    = buy !== null && sell !== null
        ? Math.round(((buy + sell) / 2) * 100) / 100
        : null;
      status = "ok";
      anySuccess = true;
    } else {
      // Loguear solo el tipo, no la URL completa ni detalles internos
      logger.warn({ tipo: dt.type, reason: result.reason?.message ?? "fetch failed" },
        "currency.service: fetch fallido");
      anyFailure = true;
    }

    try {
      // Upsert: un solo INSERT ... ON CONFLICT en lugar de SELECT + INSERT/UPDATE
      await db
        .insert(currencyRatesTable)
        .values({
          type:      dt.type,
          label:     dt.label,
          buy:       buy?.toString() ?? null,
          sell:      sell?.toString() ?? null,
          avg:       avg?.toString() ?? null,
          source:    dt.sourceLabel,
          sourceUrl: `https://dolarapi.com/v1/dolares/${dt.type}`,
          status,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: currencyRatesTable.type,
          set: {
            label:     dt.label,
            buy:       buy?.toString() ?? null,
            sell:      sell?.toString() ?? null,
            avg:       avg?.toString() ?? null,
            source:    dt.sourceLabel,
            sourceUrl: `https://dolarapi.com/v1/dolares/${dt.type}`,
            status,
            fetchedAt: new Date(),
          },
        });
      updated++;
    } catch (err) {
      logger.error({ err, tipo: dt.type }, "currency.service: fallo al persistir cotización");
    }
  }

  // Circuit breaker: registrar resultado global del refresh
  if (anySuccess)      await recordSuccess(SOURCE_NAME);
  else if (anyFailure) await recordFailure(SOURCE_NAME);

  logger.info({ updated }, "currency.service: refresh completado");
  return updated;
}

// ── getCurrencyRates ───────────────────────────────────────────────────────────
export async function getCurrencyRates(): Promise<DolarRate[]> {
  const rows = await db
    .select()
    .from(currencyRatesTable)
    .orderBy(currencyRatesTable.type);

  return rows.map((r) => ({
    type:      r.type,
    label:     r.label,
    buy:       r.buy  !== null ? Number(r.buy)  : null,
    sell:      r.sell !== null ? Number(r.sell) : null,
    avg:       r.avg  !== null ? Number(r.avg)  : null,
    source:    r.source,
    sourceUrl: r.sourceUrl ?? "",
    status:    (r.status ?? "unknown") as "ok" | "error" | "stale",
    fetchedAt: r.fetchedAt.toISOString(),
  }));
}

// ── ensureCurrencyUpToDate ────────────────────────────────────────────────────
// Actualización lazy: solo refresca si los datos tienen más de 30 minutos.
// El refresh se dispara en background sin bloquear el request.
export async function ensureCurrencyUpToDate(): Promise<void> {
  const [latest] = await db
    .select({ fetchedAt: currencyRatesTable.fetchedAt })
    .from(currencyRatesTable)
    .orderBy(desc(currencyRatesTable.fetchedAt))
    .limit(1);

  const stale =
    !latest || Date.now() - new Date(latest.fetchedAt).getTime() > 30 * 60 * 1000;

  if (stale) {
    refreshCurrencyRates().catch((err: unknown) => {
      logger.error({ err }, "currency.service: background refresh falló");
    });
  }
}
