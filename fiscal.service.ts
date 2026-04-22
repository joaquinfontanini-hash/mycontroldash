import { db, fiscalUpdatesTable, syncLogsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { fetchRssSource }                        from "../adapters/rss.adapter.js";
import { withSyncLog }                           from "./sync.service.js";
import { scoreFiscalItem, logDiscard }           from "./data-quality.service.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";
import { logger }                                from "../lib/logger.js";

const CACHE_TTL_MS  = 3 * 60 * 60 * 1000; // 3 horas
const SOURCE_NAME   = "FiscalRSS"; // nombre canónico para circuit breaker

// ── Fuentes RSS fiscales ──────────────────────────────────────────────────────
// SEGURIDAD: estas URLs son públicas (RSS de organismos oficiales y prensa).
// No contienen API keys ni tokens — pueden loguarse sin riesgo.
export const FISCAL_RSS_SOURCES = [
  {
    url:          "https://www.afip.gob.ar/afip/rss/novedades.rss",
    name:         "AFIP",
    jurisdiction: "Nacional",
    organism:     "AFIP / ARCA",
    category:     "impuestos",
    enabled:      false,
  },
  {
    url:          "https://www.boletinoficial.gob.ar/rss/noticias",
    name:         "Boletín Oficial",
    jurisdiction: "Nacional",
    organism:     "Boletín Oficial",
    category:     "normativa",
    enabled:      false,
  },
  {
    url:          "https://www.ambito.com/rss/pages/home.xml",
    name:         "Ámbito Financiero",
    jurisdiction: "Nacional",
    organism:     "Prensa Especializada",
    category:     "economia",
    enabled:      true,
  },
  {
    url:          "https://www.cronista.com/rss/",
    name:         "El Cronista",
    jurisdiction: "Nacional",
    organism:     "Prensa Especializada",
    category:     "negocios",
    enabled:      false,
  },
  {
    url:          "https://tributum.news/feed/",
    name:         "Tributum",
    jurisdiction: "Nacional",
    organism:     "Prensa Especializada",
    category:     "impuestos",
    enabled:      true,
  },
  {
    url:          "https://contadoresenred.com/feed/",
    name:         "Contadores en Red",
    jurisdiction: "Nacional",
    organism:     "Prensa Especializada",
    category:     "facturación",
    enabled:      true,
  },
] as const;

// ── Clasificación semántica ───────────────────────────────────────────────────

const IMPACT_HIGH_KEYWORDS     = ["vence", "obligación", "decreto", "ley", "resolución general", "implementación obligatoria"];
const IMPACT_MEDIUM_KEYWORDS   = ["disposición", "resolución", "nota", "circular", "instrucción"];
const REQUIRES_ACTION_KEYWORDS = ["vence", "presentar", "obligación", "nuevo régimen", "desde el", "a partir del", "plazo", "prórroga"];
const NORMATIVE_KEYWORDS       = ["resolución", "decreto", "disposición", "ley", "instrucción general", "nota externa"];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  impuestos:           ["iva", "ganancias", "bienes personales", "impuesto", "afip", "arca"],
  laboral:             ["trabajo", "empleo", "sueldos", "salarios", "convenio", "sindicato"],
  "seguridad social":  ["anses", "jubilación", "pensión", "aportes", "contribuciones"],
  facturación:         ["factura", "facturación", "cfe", "comprobante", "e-factura"],
  percepciones:        ["retención", "percepción", "agente de percepción", "agente de retención"],
  provincial:          ["neuquén", "rentas neuquén", "provincia", "ingresos brutos"],
};

function detectCategory(title: string, summary: string, defaultCategory: string): string {
  const text = `${title} ${summary}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return cat;
  }
  return defaultCategory;
}

function detectImpact(title: string, summary: string): "high" | "medium" | "low" {
  const text = `${title} ${summary}`.toLowerCase();
  if (IMPACT_HIGH_KEYWORDS.some((kw) => text.includes(kw)))   return "high";
  if (IMPACT_MEDIUM_KEYWORDS.some((kw) => text.includes(kw))) return "medium";
  return "low";
}

function detectRequiresAction(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return REQUIRES_ACTION_KEYWORDS.some((kw) => text.includes(kw));
}

function detectIsNormative(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return NORMATIVE_KEYWORDS.some((kw) => text.includes(kw));
}

function makeFingerprint(title: string, url: string): string {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  return Buffer.from(`${normalized}|${url}`).toString("base64").slice(0, 64);
}

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db
    .select()
    .from(syncLogsTable)
    .orderBy(desc(syncLogsTable.startedAt))
    .limit(50);
  const last = logs.find((l) => l.module === "fiscal" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

// ── refreshFiscalSources ──────────────────────────────────────────────────────
// Circuit breaker añadido: si las fuentes RSS están fallando repetidamente
// (por ejemplo, AFIP tiene su RSS intermitente), el circuito se abre y
// evita hacer requests en vano.
//
// Cada fuente tiene su propio try/catch — si Ámbito falla, Tributum
// sigue procesándose.
export async function refreshFiscalSources(): Promise<number> {
  // Verificar circuit breaker antes de hacer cualquier request
  if (await isCircuitOpen(SOURCE_NAME)) {
    logger.warn({ source: SOURCE_NAME }, "fiscal.service: circuit abierto, saltando refresh");
    return 0;
  }

  return withSyncLog("fiscal", async () => {
    let totalNew       = 0;
    let totalDiscarded = 0;
    let anySuccess     = false;
    let anyFailure     = false;

    // Cargar fingerprints y títulos existentes en memoria para dedup eficiente
    const [fpRows, titleRows] = await Promise.all([
      db.select({ fingerprint: fiscalUpdatesTable.fingerprint }).from(fiscalUpdatesTable),
      db.select({ title: fiscalUpdatesTable.title }).from(fiscalUpdatesTable),
    ]);

    const existingFingerprints = new Set(fpRows.map((r) => r.fingerprint).filter(Boolean) as string[]);
    const existingTitles       = new Set(titleRows.map((r) => r.title.slice(0, 80)));

    for (const source of FISCAL_RSS_SOURCES.filter((s) => s.enabled)) {
      try {
        const items = await fetchRssSource(source.url, source.name, source.category, 15);
        anySuccess = true;

        for (const item of items) {
          const fp       = makeFingerprint(item.title, item.link);
          const titleKey = item.title.slice(0, 80);

          if (existingFingerprints.has(fp) || existingTitles.has(titleKey)) continue;

          const quality = scoreFiscalItem({
            title:     item.title,
            summary:   item.summary,
            date:      new Date(item.pubDate).toISOString().split("T")[0] ?? "",
            sourceUrl: item.link,
            organism:  source.organism,
          });

          if (quality.discard) {
            totalDiscarded++;
            await logDiscard({
              module:    "fiscal",
              source:    source.name,
              title:     item.title,
              sourceUrl: item.link,
              reason:    quality.discardReason ?? "Calidad insuficiente",
            });
            // debug — no loguear el título completo para evitar llenado de logs
            logger.debug(
              { titleSlice: item.title.slice(0, 60), reason: quality.discardReason },
              "fiscal: item descartado",
            );
            continue;
          }

          const category       = detectCategory(item.title, item.summary, source.category);
          const impact         = detectImpact(item.title, item.summary);
          const requiresAction = detectRequiresAction(item.title, item.summary);
          const isNormative    = detectIsNormative(item.title, item.summary);

          await db.insert(fiscalUpdatesTable).values({
            title:         item.title.slice(0, 500),
            jurisdiction:  source.jurisdiction,
            category,
            organism:      source.organism,
            source:        source.name,
            date:          new Date(item.pubDate).toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0]!,
            impact,
            summary:       item.summary.slice(0, 1000) || item.title,
            requiresAction,
            isNormative,
            sourceUrl:     item.link,
            fingerprint:   fp,
            isSaved:       false,
            qualityScore:  quality.score,
            qualityIssues: quality.issues.length > 0 ? JSON.stringify(quality.issues) : null,
            needsReview:   quality.needsReview,
            isHidden:      false,
          });

          existingFingerprints.add(fp);
          existingTitles.add(titleKey);
          totalNew++;
        }
      } catch (err) {
        // Cada fuente falla de forma aislada
        // Loguear solo el nombre de la fuente, no la URL (que puede ser larga)
        logger.error({ source: source.name, err }, "fiscal.service: fuente RSS falló");
        anyFailure = true;
      }
    }

    // Actualizar circuit breaker basado en resultado global
    if (anySuccess)      await recordSuccess(SOURCE_NAME);
    else if (anyFailure) await recordFailure(SOURCE_NAME);

    logger.info({ totalNew, totalDiscarded }, "fiscal.service: refresh completado");
    return { count: totalNew, result: totalNew };
  });
}

// ── ensureFiscalUpToDate ──────────────────────────────────────────────────────
// COUNT(*) SQL en lugar de cargar toda la tabla para contar registros.
// El original hacía db.select().from(fiscalUpdatesTable).then(r => r.length)
// que cargaba todas las filas en memoria solo para obtener un número.
export async function ensureFiscalUpToDate(): Promise<void> {
  const [lastFetchResult, countResult] = await Promise.all([
    getLastFetchTime(),
    db.select({ count: sql<number>`count(*)` }).from(fiscalUpdatesTable),
  ]);

  const age   = lastFetchResult ? Date.now() - lastFetchResult.getTime() : Infinity;
  const count = Number(countResult[0]?.count ?? 0);

  if (age > CACHE_TTL_MS || count < 5) {
    logger.info({ ageHours: Math.round(age / 3_600_000), count }, "fiscal.service: caché stale, refrescando");
    refreshFiscalSources().catch((err: unknown) => {
      logger.error({ err }, "fiscal.service: background refresh falló");
    });
  }
}
