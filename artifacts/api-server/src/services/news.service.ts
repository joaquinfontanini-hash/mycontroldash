import { db, newsItemsTable, appSettingsTable, syncLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { fetchRssSource } from "../adapters/rss.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const RSS_SOURCES = [
  { url: "https://www.ambito.com/rss/pages/home.xml",       name: "Ámbito",            category: "economia",    enabled: true },
  { url: "https://www.cronista.com/rss/",                   name: "El Cronista",       category: "negocios",    enabled: false },
  { url: "https://www.infobae.com/feeds/rss/economia/",     name: "Infobae",           category: "economia",    enabled: false },
  { url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/", name: "La Nación",      category: "nacionales",  enabled: true },
  { url: "https://www.rionegro.com.ar/feed/",               name: "Diario Río Negro",  category: "provinciales",enabled: true },
  { url: "https://www.lmneuquen.com/servicios/rss.php",     name: "LM Neuquén",        category: "provinciales",enabled: false },
  { url: "https://www.afip.gob.ar/afip/rss/novedades.rss", name: "AFIP",              category: "impuestos",   enabled: false },
  { url: "https://www.iprofesional.com/rss/",               name: "iProfesional",      category: "negocios",    enabled: false },
  { url: "https://www.clarin.com/rss/economia/",            name: "Clarín",            category: "economia",    enabled: true },
  { url: "https://www.pagina12.com.ar/rss/secciones/economia/notas", name: "Página 12",category: "economia",   enabled: false },
  { url: "https://tributum.news/feed/",                     name: "Tributum",          category: "impuestos",   enabled: true, filterNormasNacionales: true },
  { url: "https://contadoresenred.com/feed/",               name: "Contadores en Red", category: "impuestos",   enabled: true },
];

const FISCAL_KEYWORDS = [
  "afip", "arca", "impuesto", "iva", "ganancias", "bienes personales",
  "monotributo", "autónomos", "retención", "percepción", "rg ", "resolución",
  "decreto", "ingresos brutos", "rentas", "boletín oficial", "facturación",
];

const REQUIRES_ACTION_KEYWORDS = [
  "vence", "vencimiento", "obligación", "presentar", "prórroga",
  "implementación", "nuevo régimen", "desde el", "a partir del", "plazo",
];

// Tributum: these patterns identify "resumen de medios" entries to exclude
const TRIBUTUM_MEDIA_SUMMARY_PATTERNS = [
  /resumen de medios/i,
  /resumen de prensa/i,
  /tapa(s)? de diarios/i,
  /lo que dicen los medios/i,
  /minuto a minuto/i,
  /breaking news/i,
];

// Known media brand names that appear in Tributum "resumen de medios" titles
const MEDIA_BRAND_NAMES = [
  "clarín", "clarin", "la nación", "la nacion", "infobae", "cronista",
  "iprofesional", "ámbito", "ambito", "página 12", "pagina 12",
  "perfil", "télam", "telam",
];

/**
 * Regex: detects "(MediaSource)" attribution at end of Tributum titles.
 * Tributum aggregates articles from other outlets and appends the source
 * in parentheses: "Título del artículo (Iprofesional)", "(Abogados.com.ar)", etc.
 * These are NOT original Tributum normative content.
 */
const TRIBUTUM_EXTERNAL_ATTRIBUTION_RE = /\s*\([A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ0-9 .,\-]{2,}\)\s*$/;

/**
 * Normative/institutional keywords that identify genuine regulatory content.
 * Used when filterNormasNacionales: true to double-check ambiguous cases.
 */
const NORMATIVE_MARKERS = [
  /\bRG\s+\d+/i,
  /\bR\.G\.\s+\d+/i,
  /\bDecreto\s+\d+/i,
  /\bLey\s+\d+/i,
  /\bDisposici[oó]n\s+\d+/i,
  /\bResoluci[oó]n\s+\d+/i,
  /\bBolet[ií]n\s+Oficial/i,
  /\bConvenio\b.{0,40}(fiscal|imposici[oó]n)/i,
  /\bhomoLog[oó]\b/i,
  /\bacuerdo\s+salarial/i,
  /\bconvenio\s+colectivo/i,
  /\bIGJ\b/i,
  /\bBCRA\b/i,
  /\bUIF\b/i,
  /\bARCA\b/i,
  /\bAFIP\b/i,
  /\bFallo\b.{0,30}(Corte|C[aá]mara|Tribunal)/i,
  /\bSentencia/i,
];

function isTributumMediaSummary(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  // 1. Explicit "resumen de medios" patterns
  if (TRIBUTUM_MEDIA_SUMMARY_PATTERNS.some(p => p.test(text))) return true;
  // 2. Title contains 3+ media brand names → media roundup
  const brandCount = MEDIA_BRAND_NAMES.filter(b => text.includes(b)).length;
  if (brandCount >= 3) return true;
  // 3. External media attribution "(SourceName)" at end of title → aggregated article
  if (TRIBUTUM_EXTERNAL_ATTRIBUTION_RE.test(title.trim())) return true;
  return false;
}

/**
 * When filterNormasNacionales: true, only allow items that contain at least one
 * normative/institutional marker OR that look like original Tributum reporting.
 * This rejects generic consumer-advice articles without normative anchors.
 */
function isTributumNormativeContent(title: string, summary: string): boolean {
  const text = `${title} ${summary}`;
  return NORMATIVE_MARKERS.some(p => p.test(text));
}

function scoreImportance(item: { title: string; summary: string; sourceName: string }): number {
  let score = 50;
  const text = `${item.title} ${item.summary}`.toLowerCase();
  FISCAL_KEYWORDS.forEach(kw => { if (text.includes(kw)) score += 10; });
  REQUIRES_ACTION_KEYWORDS.forEach(kw => { if (text.includes(kw)) score += 5; });
  if (["AFIP", "La Nación", "Ámbito"].includes(item.sourceName)) score += 10;
  return Math.min(score, 100);
}

function isFiscalRelated(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return FISCAL_KEYWORDS.some(kw => text.includes(kw));
}

function normalizeCategory(category: string, title: string, summary: string): string {
  const text = `${title} ${summary}`.toLowerCase();
  if (text.includes("afip") || text.includes("arca") || text.includes("impuesto") || text.includes("iva")) return "impuestos";
  if (text.includes("neuquén") || text.includes("patagoni") || text.includes("río negro")) return "provinciales";
  return category;
}

/**
 * Normalize a title for deduplication comparison.
 * Strips punctuation, lowercases, removes common stop words.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(el|la|los|las|un|una|de|del|al|y|e|o|u|que|en|con|por|para|se|su|sus|es|son|fue|sera|sera|como|mas|pero|si|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple word-overlap similarity between two normalized titles.
 * Returns 0..1 where 1 = identical.
 */
function titleSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(w => w.length > 3));
  const setB = new Set(b.split(" ").filter(w => w.length > 3));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach(w => { if (setB.has(w)) intersection++; });
  return intersection / Math.max(setA.size, setB.size);
}

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(50);
  const last = logs.find(l => l.module === "news" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

export async function refreshNews(): Promise<number> {
  return withSyncLog("news", async () => {
    let totalNew = 0;
    let skippedDup = 0;
    let skippedMediaSummary = 0;

    // Build source config lookup by name for flag access during processing
    const sourceConfigByName = new Map(RSS_SOURCES.map(s => [s.name, s]));

    const results = await Promise.allSettled(
      RSS_SOURCES.filter(s => s.enabled).map(source =>
        fetchRssSource(source.url, source.name, source.category, 15)
      )
    );

    const allItems = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // Load existing items for dedup (URL + normalized title)
    const existingRows = await db
      .select({ url: newsItemsTable.url, title: newsItemsTable.title })
      .from(newsItemsTable);

    const existingUrls = new Set(existingRows.map(r => r.url));
    // existingNormalizedTitles tracks ALL seen titles (DB + current batch) for cross-batch dedup
    const existingNormalizedTitles = new Map<string, string>(
      existingRows.map(r => [normalizeTitle(r.title), r.url])
    );

    for (const item of allItems) {
      const srcConfig = sourceConfigByName.get(item.sourceName);

      // ── 1. Tributum: skip "resumen de medios" and media attribution entries ──
      if (item.sourceName === "Tributum" && isTributumMediaSummary(item.title, item.summary)) {
        skippedMediaSummary++;
        continue;
      }

      // ── 1b. filterNormasNacionales: skip non-normative content from flagged sources ──
      if (srcConfig?.filterNormasNacionales && !isTributumNormativeContent(item.title, item.summary)) {
        skippedMediaSummary++;
        continue;
      }

      // ── 2. URL dedup ────────────────────────────────────────────────
      if (existingUrls.has(item.link)) continue;

      // ── 3. Title similarity dedup ≥ 0.75 (covers DB rows AND current batch) ─
      const normTitle = normalizeTitle(item.title);
      let isDuplicate = false;
      for (const [existNorm] of existingNormalizedTitles) {
        if (titleSimilarity(normTitle, existNorm) >= 0.75) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) {
        skippedDup++;
        continue;
      }

      const category = normalizeCategory(item.category, item.title, item.summary);
      const score = scoreImportance({ title: item.title, summary: item.summary, sourceName: item.sourceName });
      const fiscal = isFiscalRelated(item.title, item.summary);

      try {
        await db.insert(newsItemsTable).values({
          title: item.title,
          source: item.sourceName,
          category,
          region: category === "provinciales" ? "patagonia" : "nacional",
          url: item.link,
          summary: item.summary,
          imageUrl: item.imageUrl,
          publishedAt: item.pubDate,
          importanceScore: score,
          isFiscalRelated: fiscal,
        });
        totalNew++;
        existingUrls.add(item.link);
        existingNormalizedTitles.set(normTitle, item.link);
      } catch {
        // skip on conflict (unique URL constraint)
      }
    }

    logger.info({ totalNew, skippedDup, skippedMediaSummary }, "News refresh completed");
    return { count: totalNew, result: totalNew };
  });
}

export async function getNews(options: {
  category?: string;
  source?: string;
  limit?: number;
  search?: string;
} = {}) {
  const { category, source, limit = 20, search } = options;
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  const maxCount = settings?.newsCount ?? limit;

  let items = await db
    .select()
    .from(newsItemsTable)
    .orderBy(desc(newsItemsTable.importanceScore))
    .limit(300);

  if (category) items = items.filter(n => n.category === category);
  if (source) items = items.filter(n => n.source.toLowerCase() === source.toLowerCase());
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(n => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q));
  }

  return items.slice(0, limit > 20 ? limit : Math.min(limit, maxCount));
}

export async function ensureNewsUpToDate() {
  const lastFetch = await getLastFetchTime();
  const age = lastFetch ? Date.now() - lastFetch.getTime() : Infinity;
  const shouldRefresh = age > CACHE_TTL_MS;
  const count = await db.select().from(newsItemsTable).then(r => r.length);

  if (shouldRefresh || count === 0) {
    logger.info("News cache stale or empty, refreshing...");
    await refreshNews().catch(err => logger.error({ err }, "Background news refresh failed"));
  }
}
