import { db, newsItemsTable, appSettingsTable, syncLogsTable } from "@workspace/db";
import { desc, eq, and, gte } from "drizzle-orm";
import { fetchRssSource } from "../adapters/rss.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const RSS_SOURCES = [
  {
    url: "https://www.ambito.com/rss/pages/home.xml",
    name: "Ámbito",
    category: "economia",
    enabled: true,
  },
  {
    url: "https://www.cronista.com/files/feed.xml",
    name: "El Cronista",
    category: "negocios",
    enabled: true,
  },
  {
    url: "https://www.infobae.com/feeds/rss/economia/",
    name: "Infobae",
    category: "economia",
    enabled: true,
  },
  {
    url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/",
    name: "La Nación",
    category: "nacionales",
    enabled: true,
  },
  {
    url: "https://www.rionegro.com.ar/feed/",
    name: "Diario Río Negro",
    category: "provinciales",
    enabled: true,
  },
  {
    url: "https://www.lmneuquen.com/servicios/rss.php",
    name: "LM Neuquén",
    category: "provinciales",
    enabled: true,
  },
  {
    url: "https://www.afip.gob.ar/afip/rss/novedades.rss",
    name: "AFIP",
    category: "impuestos",
    enabled: true,
  },
  {
    url: "https://www.iprofesional.com/rss/home.xml",
    name: "iProfesional",
    category: "negocios",
    enabled: true,
  },
  {
    url: "https://www.clarin.com/rss/economia/",
    name: "Clarín",
    category: "economia",
    enabled: true,
  },
  {
    url: "https://www.pagina12.com.ar/rss/secciones/economia/notas",
    name: "Página 12",
    category: "economia",
    enabled: true,
  },
  {
    url: "https://tributum.news/feed/",
    name: "Tributum",
    category: "impuestos",
    enabled: true,
  },
  {
    url: "https://contadoresenred.com/feed/",
    name: "Contadores en Red",
    category: "impuestos",
    enabled: true,
  },
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

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(50);
  const last = logs.find(l => l.module === "news" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

export async function refreshNews(): Promise<number> {
  return withSyncLog("news", async () => {
    let totalNew = 0;

    const results = await Promise.allSettled(
      RSS_SOURCES.filter(s => s.enabled).map(source =>
        fetchRssSource(source.url, source.name, source.category, 12)
      )
    );

    const allItems = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

    const existingUrls = new Set(
      (await db.select({ url: newsItemsTable.url }).from(newsItemsTable)).map(r => r.url)
    );

    for (const item of allItems) {
      if (existingUrls.has(item.link)) continue;

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
      } catch {
        // skip on conflict
      }
    }

    logger.info({ totalNew }, "News refresh completed");
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

  return items.slice(0, Math.min(limit, maxCount));
}

export async function ensureNewsUpToDate() {
  const lastFetch = await getLastFetchTime();
  const age = lastFetch ? Date.now() - lastFetch.getTime() : Infinity;
  const shouldRefresh = age > CACHE_TTL_MS;

  const [settings] = await db.select().from(appSettingsTable).limit(1);
  const count = await db.select().from(newsItemsTable).then(r => r.length);

  if (shouldRefresh || count === 0) {
    logger.info("News cache stale or empty, refreshing...");
    await refreshNews().catch(err => logger.error({ err }, "Background news refresh failed"));
  }
}
