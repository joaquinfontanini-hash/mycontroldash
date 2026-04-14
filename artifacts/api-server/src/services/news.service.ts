import {
  db, newsItemsTable, savedNewsTable, userAlertsTable,
  appSettingsTable, syncLogsTable,
} from "@workspace/db";
import { desc, eq, and, inArray } from "drizzle-orm";
import { fetchRssSource } from "../adapters/rss.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── RSS Sources ───────────────────────────────────────────────────────────────
// Infobae + LM Neuquén are the primary enabled sources per requirements.
// Ámbito, La Nación, Diario Río Negro, Clarín remain as supplementary.
// Tributum and Contadores en Red are DISABLED per requirements.

export const RSS_SOURCES = [
  { url: "https://www.infobae.com/feeds/rss/",               name: "Infobae",           category: "economia",    enabled: true },
  { url: "https://www.lmneuquen.com/servicios/rss.php",       name: "LM Neuquén",        category: "regional",    enabled: true },
  { url: "https://www.ambito.com/rss/pages/home.xml",         name: "Ámbito",            category: "economia",    enabled: true },
  { url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/",name: "La Nación",         category: "nacionales",  enabled: true },
  { url: "https://www.rionegro.com.ar/feed/",                 name: "Diario Río Negro",  category: "regional",    enabled: true },
  { url: "https://www.clarin.com/rss/economia/",              name: "Clarín",            category: "economia",    enabled: true },
  { url: "https://www.cronista.com/rss/",                     name: "El Cronista",       category: "economia",    enabled: false },
  { url: "https://www.pagina12.com.ar/rss/secciones/economia/notas", name: "Página 12", category: "economia",    enabled: false },
  { url: "https://www.tributum.news/feed/",                   name: "Tributum",          category: "impuestos",   enabled: false },
  { url: "https://contadoresenred.com/feed/",                 name: "Contadores en Red", category: "impuestos",   enabled: false },
];

// ── Classification data ────────────────────────────────────────────────────────

// Keywords that strongly indicate REGIONAL (Neuquén + Río Negro) content
const REGIONAL_KEYWORDS = [
  "neuquén", "neuquen", "neuquino", "neuquina",
  "río negro", "rio negro", "rionegrino", "rionegrina",
  "patagonia", "patagónica", "patagónico",
  "bariloche", "cipolletti", "viedma", "general roca",
  "roca", "centenario", "plottier", "cutral co",
  "vaca muerta", "añelo", "zapala",
];

// Keywords that suggest NATIONAL Argentine content
const NATIONAL_KEYWORDS = [
  "argentina", "argentino", "argentina's",
  "gobierno nacional", "congreso", "senado", "diputados",
  "milei", "presidente", "casa rosada",
  "afip", "arca", "bcra", "banco central",
  "buenos aires", "caba", "capital federal",
];

// Category keyword maps
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  economia: [
    "dólar", "dolar", "inflación", "inflacion", "ipc", "mercado", "finanzas",
    "economía", "economia", "pbi", "pib", "exportaciones", "importaciones",
    "reservas", "deuda", "fmi", "bcra", "banco central", "bonos", "acciones",
    "bolsa", "merval", "cereal", "commodities", "precio", "tarifas",
    "afip", "arca", "impuesto", "iva", "ganancias", "monotributo", "renta",
    "presupuesto", "déficit", "superávit", "recaudación", "fiscal",
  ],
  politica: [
    "gobierno", "elecciones", "ley", "congreso", "senado", "diputados",
    "política", "politica", "presidente", "ministro", "decreto", "legislación",
    "partido", "oposición", "oposicion", "coalición", "coalicion",
    "milei", "kirchner", "peronismo", "macri", "ucr", "frente",
    "reforma", "veto", "promulgar",
  ],
  laboral: [
    "salarios", "salario", "sueldo", "empleo", "desempleo", "trabajo",
    "paritarias", "paritaria", "sindicatos", "sindicato", "gremio",
    "convenio colectivo", "huelga", "paro", "indemnización", "indemnizacion",
    "jubilación", "jubilacion", "previsión", "anses", "trabaja",
    "sector privado", "sector público", "sector publico",
  ],
  juicios: [
    "justicia", "fallo", "tribunal", "causa", "juicio", "sentencia",
    "corte", "cámara", "camara", "juzgado", "fiscal", "imputado",
    "condena", "absolución", "absolucion", "procesado", "detenido",
    "corrupción", "corrupcion", "estafa", "fraude", "denuncia",
    "suprema corte", "casación", "casacion",
  ],
};

// Impact keywords — trigger "alto" when present
const HIGH_IMPACT_KEYWORDS = [
  "afip", "arca", "impuesto", "dólar", "dolar", "inflación", "inflacion",
  "crisis", "emergencia", "urgente", "histórico", "historico",
  "récord", "record", "vence", "vencimiento", "plazo", "obligatorio",
];

// ── Classification functions ──────────────────────────────────────────────────

export function classifyRegion(title: string, summary: string, sourceName: string): string {
  const text = `${title} ${summary}`.toLowerCase();

  // LM Neuquén is always regional
  if (sourceName === "LM Neuquén" || sourceName === "Diario Río Negro") return "regional";

  // Check regional keywords
  if (REGIONAL_KEYWORDS.some(kw => text.includes(kw))) return "regional";

  // Check national keywords
  if (NATIONAL_KEYWORDS.some(kw => text.includes(kw))) return "nacional";

  return "internacional";
}

export function classifyCategory(title: string, summary: string): string {
  const text = `${title} ${summary}`.toLowerCase();

  // Score each category by keyword count
  const scores: Record<string, number> = {
    economia: 0, politica: 0, laboral: 0, juicios: 0,
  };

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) scores[cat]++;
    }
  }

  // Pick the highest-scoring category (minimum score 1 to win)
  const best = Object.entries(scores).reduce((a, b) => a[1] >= b[1] ? a : b);
  if (best[1] > 0) return best[0];

  // Default: economia (most news in our context is economic)
  return "economia";
}

export function classifyImpact(
  title: string,
  summary: string,
  regionLevel: string,
): string {
  const text = `${title} ${summary}`.toLowerCase();
  const highHits = HIGH_IMPACT_KEYWORDS.filter(kw => text.includes(kw)).length;

  // Regional content is always at least "medio" — it directly affects the user
  if (regionLevel === "regional" && highHits >= 1) return "alto";
  if (highHits >= 3) return "alto";
  if (highHits >= 1 || regionLevel === "regional" || regionLevel === "nacional") return "medio";
  return "bajo";
}

export function buildTags(
  title: string,
  summary: string,
  regionLevel: string,
  newsCategory: string,
): string[] {
  const tags: string[] = [regionLevel, newsCategory];
  const text = `${title} ${summary}`.toLowerCase();

  // Add specific high-interest tags
  if (text.includes("dólar") || text.includes("dolar")) tags.push("dólar");
  if (text.includes("inflación") || text.includes("inflacion")) tags.push("inflación");
  if (text.includes("afip") || text.includes("arca")) tags.push("AFIP/ARCA");
  if (text.includes("impuesto")) tags.push("impuestos");
  if (text.includes("vaca muerta")) tags.push("Vaca Muerta");
  if (text.includes("neuquén") || text.includes("neuquen")) tags.push("Neuquén");
  if (text.includes("río negro") || text.includes("rio negro")) tags.push("Río Negro");

  return [...new Set(tags)]; // deduplicate
}

export function calcPriorityScore(
  importanceScore: number,
  regionLevel: string,
  impactLevel: string,
  publishedAt: string,
): number {
  let score = importanceScore;

  // Regional content is more relevant to the user
  if (regionLevel === "regional") score += 20;
  else if (regionLevel === "nacional") score += 10;

  // Impact multiplier
  if (impactLevel === "alto") score += 15;
  else if (impactLevel === "medio") score += 7;

  // Recency boost — decay over time (last 6 hours = full, then linear decay)
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, 20 - ageHours * 1.5);
  score += recencyBoost;

  return Math.min(Math.round(score), 100);
}

// ── Importance scoring (legacy, still used for base score) ────────────────────

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
  if (["AFIP", "La Nación", "Ámbito", "Infobae"].includes(item.sourceName)) score += 10;
  return Math.min(score, 100);
}

function isFiscalRelated(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return FISCAL_KEYWORDS.some(kw => text.includes(kw));
}

// ── Deduplication helpers ─────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(el|la|los|las|un|una|de|del|al|y|e|o|u|que|en|con|por|para|se|su|sus|es|son|fue|sera|sera|como|mas|pero|si|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(w => w.length > 3));
  const setB = new Set(b.split(" ").filter(w => w.length > 3));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach(w => { if (setB.has(w)) intersection++; });
  return intersection / Math.max(setA.size, setB.size);
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(50);
  const last = logs.find(l => l.module === "news" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

// ── refreshNews ────────────────────────────────────────────────────────────────

export async function refreshNews(): Promise<number> {
  return withSyncLog("news", async () => {
    let totalNew = 0;
    let skippedDup = 0;

    const results = await Promise.allSettled(
      RSS_SOURCES.filter(s => s.enabled).map(source =>
        fetchRssSource(source.url, source.name, source.category, 20)
      )
    );

    const allItems = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // Load existing for dedup
    const existingRows = await db
      .select({ url: newsItemsTable.url, title: newsItemsTable.title })
      .from(newsItemsTable);

    const existingUrls = new Set(existingRows.map(r => r.url));
    const existingNormalizedTitles = new Map<string, string>(
      existingRows.map(r => [normalizeTitle(r.title), r.url])
    );

    for (const item of allItems) {
      // URL dedup
      if (existingUrls.has(item.link)) continue;

      // Title similarity dedup
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

      // Classify
      const regionLevel = classifyRegion(item.title, item.summary, item.sourceName);
      const newsCategory = classifyCategory(item.title, item.summary);
      const importanceScore = scoreImportance({ title: item.title, summary: item.summary, sourceName: item.sourceName });
      const impactLevel = classifyImpact(item.title, item.summary, regionLevel);
      const tags = buildTags(item.title, item.summary, regionLevel, newsCategory);
      const priorityScore = calcPriorityScore(importanceScore, regionLevel, impactLevel, item.pubDate);
      const fiscal = isFiscalRelated(item.title, item.summary);

      // Legacy category
      const legacyCategory = regionLevel === "regional" ? "provinciales"
        : newsCategory === "economia" ? "economia"
        : newsCategory === "politica" ? "politica"
        : newsCategory === "laboral" ? "laboral"
        : "nacionales";

      try {
        await db.insert(newsItemsTable).values({
          title: item.title,
          source: item.sourceName,
          category: legacyCategory,
          regionLevel,
          newsCategory,
          tags,
          impactLevel,
          priorityScore,
          region: regionLevel,
          url: item.link,
          summary: item.summary,
          imageUrl: item.imageUrl,
          publishedAt: item.pubDate,
          importanceScore,
          isFiscalRelated: fiscal,
        });
        totalNew++;
        existingUrls.add(item.link);
        existingNormalizedTitles.set(normTitle, item.link);
      } catch {
        // skip on unique URL conflict
      }
    }

    logger.info({ totalNew, skippedDup }, "News refresh completed");
    return { count: totalNew, result: totalNew };
  });
}

// ── getNews ────────────────────────────────────────────────────────────────────

export async function getNews(options: {
  regionLevel?: string;
  newsCategory?: string;
  source?: string;
  limit?: number;
  search?: string;
  userId?: number; // when provided, enrich with savedByUser flag
} = {}) {
  const { regionLevel, newsCategory, source, limit = 50, search, userId } = options;

  let items = await db
    .select()
    .from(newsItemsTable)
    .orderBy(desc(newsItemsTable.priorityScore), desc(newsItemsTable.importanceScore))
    .limit(400);

  if (regionLevel) items = items.filter(n => n.regionLevel === regionLevel);
  if (newsCategory) items = items.filter(n => n.newsCategory === newsCategory);
  if (source) items = items.filter(n => n.source.toLowerCase() === source.toLowerCase());
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(n => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q));
  }

  const sliced = items.slice(0, limit);

  // Enrich with saved status if userId provided
  let savedIds = new Set<number>();
  if (userId) {
    const saved = await db.select({ newsId: savedNewsTable.newsId })
      .from(savedNewsTable)
      .where(eq(savedNewsTable.userId, userId));
    savedIds = new Set(saved.map(s => s.newsId));
  }

  return sliced.map(n => ({ ...n, savedByUser: userId ? savedIds.has(n.id) : false }));
}

// ── Saved news ─────────────────────────────────────────────────────────────────

export async function saveNews(userId: number, newsId: number): Promise<void> {
  try {
    await db.insert(savedNewsTable).values({ userId, newsId });
  } catch {
    // already saved — ignore unique constraint error
  }
}

export async function unsaveNews(userId: number, newsId: number): Promise<void> {
  await db.delete(savedNewsTable)
    .where(and(eq(savedNewsTable.userId, userId), eq(savedNewsTable.newsId, newsId)));
}

export async function getSavedNews(userId: number) {
  const saved = await db.select({ newsId: savedNewsTable.newsId, savedAt: savedNewsTable.createdAt })
    .from(savedNewsTable)
    .where(eq(savedNewsTable.userId, userId))
    .orderBy(desc(savedNewsTable.createdAt));

  if (saved.length === 0) return [];

  const newsIds = saved.map(s => s.newsId);
  const articles = await db.select().from(newsItemsTable)
    .where(inArray(newsItemsTable.id, newsIds));

  const articleMap = new Map(articles.map(a => [a.id, a]));

  return saved
    .map(s => {
      const article = articleMap.get(s.newsId);
      if (!article) return null;
      return { ...article, savedByUser: true, savedAt: s.savedAt };
    })
    .filter(Boolean);
}

// ── User alerts ───────────────────────────────────────────────────────────────

export async function getUserAlerts(userId: number) {
  return db.select().from(userAlertsTable)
    .where(eq(userAlertsTable.userId, userId))
    .orderBy(desc(userAlertsTable.createdAt));
}

export async function createUserAlert(userId: number, data: {
  regionLevel?: string | null;
  newsCategory?: string | null;
  label?: string | null;
}) {
  const [alert] = await db.insert(userAlertsTable)
    .values({
      userId,
      regionLevel: data.regionLevel ?? null,
      newsCategory: data.newsCategory ?? null,
      label: data.label ?? null,
      active: true,
    })
    .returning();
  return alert;
}

export async function updateUserAlert(userId: number, alertId: number, data: {
  active?: boolean;
  label?: string | null;
}) {
  const [alert] = await db.update(userAlertsTable)
    .set({ ...(data.active !== undefined ? { active: data.active } : {}), ...(data.label !== undefined ? { label: data.label } : {}) })
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, userId)))
    .returning();
  return alert;
}

export async function deleteUserAlert(userId: number, alertId: number): Promise<void> {
  await db.delete(userAlertsTable)
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, userId)));
}

// ── Alert matching ────────────────────────────────────────────────────────────
// Check if a news article matches any of the user's active alerts

export function matchesAlert(
  article: { regionLevel: string; newsCategory: string },
  alerts: Array<{ regionLevel: string | null; newsCategory: string | null; active: boolean }>,
): boolean {
  return alerts.some(a => {
    if (!a.active) return false;
    const regionMatch = !a.regionLevel || a.regionLevel === article.regionLevel;
    const catMatch = !a.newsCategory || a.newsCategory === article.newsCategory;
    return regionMatch && catMatch;
  });
}

// ── ensureNewsUpToDate ─────────────────────────────────────────────────────────

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
