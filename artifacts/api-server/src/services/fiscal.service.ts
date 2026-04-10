import { db, fiscalUpdatesTable, syncLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { fetchRssSource } from "../adapters/rss.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export const FISCAL_RSS_SOURCES = [
  {
    url: "https://www.afip.gob.ar/afip/rss/novedades.rss",
    name: "AFIP",
    jurisdiction: "Nacional",
    organism: "AFIP / ARCA",
    category: "impuestos",
    enabled: true,
  },
  {
    url: "https://www.boletinoficial.gob.ar/rss/noticias",
    name: "Boletín Oficial",
    jurisdiction: "Nacional",
    organism: "Boletín Oficial",
    category: "normativa",
    enabled: true,
  },
  {
    url: "https://www.ambito.com/rss/pages/home.xml",
    name: "Ámbito Financiero",
    jurisdiction: "Nacional",
    organism: "Prensa Especializada",
    category: "economia",
    enabled: true,
  },
  {
    url: "https://www.cronista.com/files/feed.xml",
    name: "El Cronista",
    jurisdiction: "Nacional",
    organism: "Prensa Especializada",
    category: "negocios",
    enabled: true,
  },
];

const IMPACT_HIGH_KEYWORDS = ["vence", "obligación", "decreto", "ley", "resolución general", "implementación obligatoria"];
const IMPACT_MEDIUM_KEYWORDS = ["disposición", "resolución", "nota", "circular", "instrucción"];
const REQUIRES_ACTION_KEYWORDS = ["vence", "presentar", "obligación", "nuevo régimen", "desde el", "a partir del", "plazo", "prórroga"];
const NORMATIVE_KEYWORDS = ["resolución", "decreto", "disposición", "ley", "instrucción general", "nota externa"];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  impuestos: ["iva", "ganancias", "bienes personales", "impuesto", "afip", "arca"],
  laboral: ["trabajo", "empleo", "sueldos", "salarios", "convenio", "sindicato"],
  "seguridad social": ["anses", "jubilación", "pensión", "aportes", "contribuciones"],
  facturación: ["factura", "facturación", "cfe", "comprobante", "e-factura"],
  percepciones: ["retención", "percepción", "agente de percepción", "agente de retención"],
  provincial: ["neuquén", "rentas neuquén", "provincia", "ingresos brutos"],
};

function detectCategory(title: string, summary: string, defaultCategory: string): string {
  const text = `${title} ${summary}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return defaultCategory;
}

function detectImpact(title: string, summary: string): "high" | "medium" | "low" {
  const text = `${title} ${summary}`.toLowerCase();
  if (IMPACT_HIGH_KEYWORDS.some(kw => text.includes(kw))) return "high";
  if (IMPACT_MEDIUM_KEYWORDS.some(kw => text.includes(kw))) return "medium";
  return "low";
}

function detectRequiresAction(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return REQUIRES_ACTION_KEYWORDS.some(kw => text.includes(kw));
}

function detectIsNormative(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return NORMATIVE_KEYWORDS.some(kw => text.includes(kw));
}

function makeFingerprint(title: string, url: string): string {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  return Buffer.from(`${normalized}|${url}`).toString("base64").slice(0, 64);
}

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(50);
  const last = logs.find(l => l.module === "fiscal" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

export async function refreshFiscalSources(): Promise<number> {
  return withSyncLog("fiscal", async () => {
    let totalNew = 0;

    const existing = await db.select({ fingerprint: fiscalUpdatesTable.fingerprint }).from(fiscalUpdatesTable);
    const existingFingerprints = new Set(existing.map(r => r.fingerprint).filter(Boolean));
    const existingTitles = new Set(
      (await db.select({ title: fiscalUpdatesTable.title }).from(fiscalUpdatesTable)).map(r => r.title.slice(0, 80))
    );

    for (const source of FISCAL_RSS_SOURCES.filter(s => s.enabled)) {
      try {
        const items = await fetchRssSource(source.url, source.name, source.category, 15);

        for (const item of items) {
          const fp = makeFingerprint(item.title, item.link);
          const titleKey = item.title.slice(0, 80);
          if (existingFingerprints.has(fp) || existingTitles.has(titleKey)) continue;

          const category = detectCategory(item.title, item.summary, source.category);
          const impact = detectImpact(item.title, item.summary);
          const requiresAction = detectRequiresAction(item.title, item.summary);
          const isNormative = detectIsNormative(item.title, item.summary);

          await db.insert(fiscalUpdatesTable).values({
            title: item.title.slice(0, 500),
            jurisdiction: source.jurisdiction,
            category,
            organism: source.organism,
            date: new Date(item.pubDate).toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
            impact,
            summary: item.summary.slice(0, 1000) || item.title,
            requiresAction,
            isNormative,
            sourceUrl: item.link,
            fingerprint: fp,
            isSaved: false,
          });

          existingFingerprints.add(fp);
          existingTitles.add(titleKey);
          totalNew++;
        }
      } catch (err) {
        logger.error({ err, source: source.name }, "Fiscal source fetch failed");
      }
    }

    logger.info({ totalNew }, "Fiscal refresh completed");
    return { count: totalNew, result: totalNew };
  });
}

export async function ensureFiscalUpToDate() {
  const lastFetch = await getLastFetchTime();
  const age = lastFetch ? Date.now() - lastFetch.getTime() : Infinity;
  const count = await db.select().from(fiscalUpdatesTable).then(r => r.length);

  if (age > CACHE_TTL_MS || count < 5) {
    logger.info("Fiscal cache stale, refreshing...");
    await refreshFiscalSources().catch(err => logger.error({ err }, "Background fiscal refresh failed"));
  }
}
