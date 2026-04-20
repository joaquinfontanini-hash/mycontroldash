/**
 * BCRA Indicators Service — v4.0
 * Fetches IPC Mensual, IPC Interanual, Tasa TAMAR, Tasa Badlar
 * from the Banco Central de la República Argentina public API.
 *
 * Endpoint: GET /estadisticas/v4.0/monetarias/{idVariable}?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Strategy:
 *   1. Serve from external_cache when fresh (TTL = 4 hours)
 *   2. If expired/missing → fetch from BCRA, update cache
 *   3. If BCRA fails → return last valid stale cache entry
 *   4. If no cache at all → return indicators with status "error"
 */

import { db, externalCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";

const SOURCE_NAME = "BCRA";
const CACHE_KEY   = "bcra:indicadores";
const BASE_URL    = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
const TTL_HOURS   = 4;

// ── Indicator definitions ─────────────────────────────────────────────────────

export interface BcraIndicator {
  key:     string;
  label:   string;
  tooltip: string;
  value:   number | null;
  date:    string | null;   // "YYYY-MM-DD"
  unit:    string;
  status:  "ok" | "stale" | "error";
}

export interface BcraResponse {
  indicators: BcraIndicator[];
  fetchedAt:  string | null;
  isStale:    boolean;
  source:     string;
}

const INDICATOR_DEFS = [
  {
    idVariable: 27,
    key:        "ipc_mensual",
    label:      "IPC Mensual",
    tooltip:    "Inflación mensual (variación en %)",
    unit:       "%",
    freq:       "M" as const,   // monthly — last 3 months window
  },
  {
    idVariable: 28,
    key:        "ipc_interanual",
    label:      "IPC Interanual",
    tooltip:    "Inflación interanual (variación en % i.a.)",
    unit:       "% i.a.",
    freq:       "M" as const,
  },
  {
    idVariable: 44,
    key:        "tamar",
    label:      "Tasa Tamar",
    tooltip:    "TAMAR en pesos de bancos privados (en % n.a.)",
    unit:       "% n.a.",
    freq:       "D" as const,   // daily — last 7 days window
  },
  {
    idVariable: 7,
    key:        "badlar",
    label:      "Tasa Badlar",
    tooltip:    "BADLAR en pesos de bancos privados (en % n.a.)",
    unit:       "% n.a.",
    freq:       "D" as const,
  },
] as const;

// ── Stored cache shape ────────────────────────────────────────────────────────

interface CachedIndicator {
  idVariable: number;
  valor:      number;
  fecha:      string;   // "YYYY-MM-DD"
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchVariable(idVariable: number, freq: "D" | "M"): Promise<{ valor: number; fecha: string } | null> {
  const today  = new Date();
  const desde  = new Date(today);
  if (freq === "D") {
    desde.setDate(desde.getDate() - 15);
  } else {
    desde.setMonth(desde.getMonth() - 4);
  }

  const url = `${BASE_URL}/${idVariable}?desde=${dateStr(desde)}&hasta=${dateStr(today)}&limit=5`;
  const res = await fetch(url, {
    signal:  AbortSignal.timeout(12_000),
    headers: { "User-Agent": "ExecutiveDashboard/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BCRA HTTP ${res.status} for variable ${idVariable}`);

  interface V4Response {
    status:  number;
    results: Array<{ idVariable: number; detalle: Array<{ fecha: string; valor: number }> }>;
  }
  const data = (await res.json()) as V4Response;
  const detalle = data?.results?.[0]?.detalle;
  if (!Array.isArray(detalle) || detalle.length === 0) return null;

  // The API returns most-recent first for daily, last-of-period for monthly
  const last = detalle[0];
  return { valor: last.valor, fecha: last.fecha };
}

async function fetchAllFromBcra(): Promise<CachedIndicator[]> {
  const results = await Promise.allSettled(
    INDICATOR_DEFS.map(async def => {
      const r = await fetchVariable(def.idVariable, def.freq);
      if (!r) return null;
      return { idVariable: def.idVariable, valor: r.valor, fecha: r.fecha } as CachedIndicator;
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<CachedIndicator | null> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value as CachedIndicator);
}

function buildIndicators(cached: CachedIndicator[], statusOverride: "ok" | "stale" | "error"): BcraIndicator[] {
  return INDICATOR_DEFS.map(def => {
    const c = cached.find(x => x.idVariable === def.idVariable);
    return {
      key:     def.key,
      label:   def.label,
      tooltip: def.tooltip,
      unit:    def.unit,
      value:   c ? c.valor : null,
      date:    c ? c.fecha : null,
      status:  c ? statusOverride : "error",
    };
  });
}

async function getCachedEntry() {
  const [row] = await db
    .select()
    .from(externalCacheTable)
    .where(eq(externalCacheTable.cacheKey, CACHE_KEY));
  return row ?? null;
}

async function upsertCache(indicators: CachedIndicator[]): Promise<void> {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + TTL_HOURS * 3_600_000);
  const dataJson  = JSON.stringify(indicators);

  const existing = await getCachedEntry();
  if (existing) {
    await db.update(externalCacheTable)
      .set({ dataJson, fetchedAt: now, expiresAt, isValid: true })
      .where(eq(externalCacheTable.cacheKey, CACHE_KEY));
  } else {
    await db.insert(externalCacheTable).values({
      cacheKey:   CACHE_KEY,
      sourceName: SOURCE_NAME,
      dataJson,
      fetchedAt:  now,
      expiresAt,
      isValid:    true,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Refresh indicators unconditionally (called by scheduler).
 * Returns number of indicators successfully fetched.
 */
export async function refreshBcraIndicators(): Promise<number> {
  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn("bcra.service: circuit open, skipping refresh");
    return 0;
  }

  try {
    const indicators = await fetchAllFromBcra();
    await upsertCache(indicators);
    await recordSuccess(SOURCE_NAME);
    logger.info({ fetched: indicators.length }, "BCRA indicators refreshed");
    return indicators.length;
  } catch (err) {
    logger.warn({ err }, "bcra.service: refresh failed");
    await recordFailure(SOURCE_NAME);
    return 0;
  }
}

/**
 * Get BCRA indicators. Uses cache when fresh; falls back to stale cache on error.
 */
export async function getBcraIndicators(): Promise<BcraResponse> {
  const cached = await getCachedEntry();
  const now    = new Date();

  // Fresh cache → return immediately
  if (cached && cached.isValid && new Date(cached.expiresAt) > now) {
    const indicators = JSON.parse(cached.dataJson) as CachedIndicator[];
    return {
      indicators: buildIndicators(indicators, "ok"),
      fetchedAt:  cached.fetchedAt.toISOString(),
      isStale:    false,
      source:     SOURCE_NAME,
    };
  }

  // Expired or missing → try to fetch live
  if (!await isCircuitOpen(SOURCE_NAME)) {
    try {
      const indicators = await fetchAllFromBcra();
      await upsertCache(indicators);
      await recordSuccess(SOURCE_NAME);
      return {
        indicators: buildIndicators(indicators, "ok"),
        fetchedAt:  now.toISOString(),
        isStale:    false,
        source:     SOURCE_NAME,
      };
    } catch (err) {
      logger.warn({ err }, "bcra.service: live fetch failed, falling back to stale cache");
      await recordFailure(SOURCE_NAME);
    }
  }

  // Fallback: stale cache
  if (cached) {
    const indicators = JSON.parse(cached.dataJson) as CachedIndicator[];
    return {
      indicators: buildIndicators(indicators, "stale"),
      fetchedAt:  cached.fetchedAt.toISOString(),
      isStale:    true,
      source:     SOURCE_NAME,
    };
  }

  // No data at all
  return {
    indicators: buildIndicators([], "error"),
    fetchedAt:  null,
    isStale:    false,
    source:     SOURCE_NAME,
  };
}
