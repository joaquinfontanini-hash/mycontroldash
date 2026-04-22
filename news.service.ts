/**
 * news.service.ts — Servicio de noticias
 *
 * Pipeline de clasificación en 5 pasos:
 *   1. Domain fit gate     — descartar si score < DOMAIN_FIT_THRESHOLD
 *   2. Clasificación región — regional / nacional / internacional
 *   3. Clasificación categoría + confidence
 *   4. Impact scoring
 *   5. Priority scoring final
 *
 * SEGURIDAD: SERPAPI_KEY nunca se loguea. Los errores de fetch solo
 * registran el mensaje de error HTTP, nunca la URL con la key.
 */

import {
  db,
  newsItemsTable,
  savedNewsTable,
  userAlertsTable,
  syncLogsTable,
} from "@workspace/db";
import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { fetchRssSource }              from "../adapters/rss.adapter.js";
import { withSyncLog }                 from "./sync.service.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "./cache.service.js";
import { logger }                      from "../lib/logger.js";

const CACHE_TTL_MS         = 60 * 60 * 1000; // 1 hora
const SERPAPI_SOURCE_NAME  = "SerpAPI";       // circuit breaker key
const RSS_SOURCE_NAME      = "NewsRSS";

// ── RSS Sources ───────────────────────────────────────────────────────────────
export const RSS_SOURCES = [
  { url: "https://www.infobae.com/feeds/rss/",                name: "Infobae",         category: "economia",   enabled: true  },
  { url: "https://www.lmneuquen.com/servicios/rss.php",       name: "LM Neuquén",      category: "regional",   enabled: true  },
  { url: "https://www.ambito.com/rss/pages/home.xml",         name: "Ámbito",          category: "economia",   enabled: true  },
  { url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/", name: "La Nación",      category: "nacionales", enabled: true  },
  { url: "https://www.rionegro.com.ar/feed/",                 name: "Diario Río Negro", category: "regional",  enabled: true  },
  { url: "https://www.clarin.com/rss/economia/",              name: "Clarín",          category: "economia",   enabled: true  },
  { url: "https://www.cronista.com/rss/",                     name: "El Cronista",     category: "economia",   enabled: false },
  { url: "https://www.pagina12.com.ar/rss/secciones/economia/notas", name: "Página 12", category: "economia",  enabled: false },
  { url: "https://www.tributum.news/feed/",                   name: "Tributum",        category: "impuestos",  enabled: false },
  { url: "https://contadoresenred.com/feed/",                 name: "Contadores en Red", category: "impuestos", enabled: false },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 1: EVALUACIÓN DE PERTINENCIA (domain_fit_score)
// ═══════════════════════════════════════════════════════════════════════════════

const DOMAIN_FIT_THRESHOLD = 30;

const DOMAIN_POSITIVE_TERMS: string[] = [
  // Fiscal / Tributario
  "afip","arca","impuesto","impuestos","iva","ganancias","monotributo",
  "autónomos","retención","percepción","ingresos brutos","rentas",
  "boletín oficial","boletin oficial","resolución general","rg ",
  "facturación electrónica","facturacion electronica","e-facturas",
  "blanqueo","moratoria",
  // Economía
  "inflación","inflacion","dólar","dolar","tipo de cambio",
  "economía","economia","mercado","finanzas","financiero","financiera",
  "inversión","inversion","exportaciones","importaciones",
  "reservas del bcra","reservas internacionales","deuda externa","deuda pública",
  "fmi","banco central","bcra",
  "bonos","acciones","bolsa de comercio","merval","cedears",
  "presupuesto nacional","presupuesto provincial",
  "déficit fiscal","deficit fiscal","superávit","superavit",
  "recaudación","recaudacion","política monetaria","politica monetaria",
  "tasa de interés","tasa de interes","cepo cambiario","cepo",
  "tarifas de servicios","tarifazo",
  "soja","trigo","maíz","maiz","commodities","agroindustria","campo",
  "actividad económica","actividad economica","pbi","pib",
  "consumo interno","demanda agregada",
  "empresas","compañías","multinacional",
  "inversión extranjera","inversion extranjera",
  "quiebra","concurso de acreedores",
  // Energía / Regional
  "petróleo","petroleo","vaca muerta","energía","energia",
  "gas natural","hidrocarburos","fractura hidráulica","fracking",
  "yacimiento","ypf","pan american energy","wintershall",
  "minería","mineria",
  "neuquén","neuquen","río negro","rio negro","patagonia",
  "zapala","cutral co","plaza huincul","añelo",
  // Laboral
  "salarios","salario","sueldo","sueldos","empleo","desempleo",
  "paritarias","paritaria","convenio colectivo","negociación salarial",
  "sindicato","sindicatos","gremio","gremios","cgt","ugl",
  "huelga","paro general","paro de","medida de fuerza",
  "indemnización","indemnizacion","jubilación","jubilacion",
  "anses","pensión","pension","asignación","asignacion",
  "sector privado","sector público","sector publico",
  // Político / Regulatorio
  "gobierno nacional","gobierno provincial","gobierno de neuquén",
  "decreto presidencial","decreto ejecutivo",
  "legislación","legislacion","reforma laboral","reforma tributaria",
  "senado","diputados","asamblea legislativa",
  "elecciones","campaña electoral","candidatos",
  "ministro de economía","secretaría de hacienda",
  "política fiscal","politica fiscal","gasto público",
  "licitación","licitacion","obra pública","obra publica",
  "concesión","concesion","contrato público",
  // Justicia
  "fallo judicial","sentencia","tribunal oral",
  "cámara federal","camara federal","suprema corte",
  "causa por","investigación judicial","investigacion judicial",
  "corrupción","corrupcion","fraude","estafa","lavado de dinero",
  "evasión fiscal","evasion fiscal",
  "detenido por","imputado por","procesado por",
];

const DOMAIN_STRONG_NEGATIVES: string[] = [
  "farándula","farandula","chimentos",
  "influencer","youtuber","tiktoker","streamers","hollywood",
  "reality show","gran hermano","horóscopo","tiktok viral",
  "viral en redes","se volvió viral","boda de celebridades",
  "espectáculos","espectaculos","entretenimiento","celebrities","famosos",
  "selfie","stories de","su look","su outfit","salud y bienestar",
  "receta de cocina","recetas de","tips de moda","moda y estilo",
  "horóscopo de","zodiaco","netflix","disney plus","streaming",
  "deporte","fútbol","futbol","gol de","selección argentina",
  "copa del mundo","libertadores","superliga","tenis","básquet","basketball",
];

const DOMAIN_MODERATE_NEGATIVES: string[] = [
  "actriz argentina","actor argentino","cantante argentina","cantante argentino",
  "modelo argentina","modelo argentino","boda de","casamiento de","embarazo de",
  "romance de","novio de","novia de","separación de","separacion de",
  "look de","foto de su","fotos de su","vacaciones de","viaje de placer",
  "show de","gira de","alfombra roja",
];

export function scoreDomainFit(
  title: string,
  summary: string,
): { score: number; positiveHits: string[]; negativeFlags: string[] } {
  const text         = `${title} ${summary}`.toLowerCase();
  const positiveHits = DOMAIN_POSITIVE_TERMS.filter((t) => text.includes(t));
  const strongNeg    = DOMAIN_STRONG_NEGATIVES.filter((t) => text.includes(t));
  const moderateNeg  = DOMAIN_MODERATE_NEGATIVES.filter((t) => text.includes(t));

  const rawScore =
    positiveHits.length * 10 - strongNeg.length * 35 - moderateNeg.length * 20;
  const score = Math.max(0, Math.min(100, rawScore));
  return { score, positiveHits, negativeFlags: [...strongNeg, ...moderateNeg] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 2: CLASIFICACIÓN DE REGIÓN
// ═══════════════════════════════════════════════════════════════════════════════

const REGIONAL_KEYWORDS = [
  "neuquén","neuquen","neuquino","neuquina","río negro","rio negro",
  "rionegrino","rionegrina","patagonia","patagónica","patagónico",
  "bariloche","cipolletti","viedma","general roca","centenario","plottier",
  "cutral co","zapala","añelo","vaca muerta","yacimiento loma campana",
  "provincia de neuquén","provincia de río negro","legislature neuquina",
];

const NATIONAL_KEYWORDS = [
  "argentina","argentino","argentinos","argentina's",
  "gobierno nacional","congreso nacional","senado de la nación",
  "diputados de la nación","presidente de argentina",
  "milei","casa rosada","afip","arca","bcra","banco central",
  "buenos aires","caba","capital federal",
  "anses","ministerio de economía","secretaría de hacienda",
];

export function classifyRegion(
  title: string,
  summary: string,
  sourceName: string,
): string {
  if (sourceName === "LM Neuquén" || sourceName === "Diario Río Negro") return "regional";
  const text = `${title} ${summary}`.toLowerCase();
  if (REGIONAL_KEYWORDS.some((kw) => text.includes(kw))) return "regional";
  if (NATIONAL_KEYWORDS.some((kw) => text.includes(kw))) return "nacional";
  return "internacional";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 3: CLASIFICACIÓN DE CATEGORÍA
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  economia: [
    "dólar","dolar","tipo de cambio","inflación","inflacion","ipc",
    "mercado","finanzas","economía","economia","pbi","pib",
    "exportaciones","importaciones","reservas","deuda","fmi",
    "bcra","banco central","bonos","acciones","bolsa","merval",
    "cereal","soja","commodities","precio","tarifas",
    "afip","arca","impuesto","iva","ganancias","monotributo",
    "presupuesto","déficit","deficit","superávit","recaudación",
    "fiscal","petróleo","petroleo","vaca muerta","energía",
    "empresa","inversión","inversion","consumo","actividad económica",
    "quiebra","concurso","producción","produccion","industria",
  ],
  politica: [
    "gobierno","elecciones","ley ","congreso","senado","diputados",
    "política","politica","presidente","ministro","decreto",
    "legislación","legislacion","partido","oposición","oposicion",
    "coalición","coalicion","milei","kirchner","peronismo",
    "macri","ucr","frente de todos","reforma","veto",
    "campaña electoral","candidatos","gestión pública","gestion publica",
    "licitación","obra pública","obra publica","concesión",
  ],
  laboral: [
    "salarios","salario","sueldo","empleo","desempleo","trabajo",
    "paritarias","paritaria","sindicatos","sindicato","gremio",
    "convenio colectivo","huelga","paro ","indemnización",
    "jubilación","jubilacion","previsión","anses",
    "sector privado","sector público","despidos","despido",
    "trabajadores","empleados","cgt",
  ],
  juicios: [
    "justicia","fallo","tribunal","causa","juicio","sentencia",
    "corte","cámara federal","camara federal","juzgado",
    "imputado","condena","absolución","absolucion","procesado",
    "corrupción","corrupcion","estafa","fraude","denuncia",
    "suprema corte","casación","lavado de dinero","evasión fiscal","detenido",
  ],
};

export function classifyCategoryWithConfidence(
  title: string,
  summary: string,
): { category: string; confidence: number } {
  const text = `${title} ${summary}`.toLowerCase();
  const scores: Record<string, number> = { economia: 0, politica: 0, laboral: 0, juicios: 0 };
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of kws) if (text.includes(kw)) scores[cat]++;
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return { category: "economia", confidence: 0 };
  const [bestCat, bestScore] = Object.entries(scores).reduce((a, b) => (a[1] >= b[1] ? a : b));
  return { category: bestCat, confidence: Math.round((bestScore / total) * 100) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 4: IMPACT SCORING
// ═══════════════════════════════════════════════════════════════════════════════

const CRISIS_KEYWORDS       = ["crisis","colapso","default","emergencia económica","quiebra masiva","catástrofe","corrida bancaria","bank run","devaluación brusca","cepo al dólar"];
const ACTION_KEYWORDS       = ["vence","vencimiento","plazo fatal","obligatorio desde","urgente","prórroga","proroga","a partir del","desde el","implementación obligatoria","nueva obligación"];
const SENSITIVITY_KEYWORDS  = ["afip","arca","dólar oficial","brecha cambiaria","inflación mensual","inflacion mensual","paritarias nacionales","huelga general","paro general","fallo judicial","condena judicial","suba de impuestos","baja de impuestos","reforma tributaria","reforma previsional"];
const ECONOMIC_SHOCK_KWS    = ["récord histórico","record historico","caída del","caida del","disparó","disparo del","se desplomó","derrumbe del","sube un","subió un","devaluación del","devaluacion del"];

export function scoreImpact(
  title: string,
  summary: string,
  regionLevel: string,
): { level: "bajo" | "medio" | "alto"; score: number } {
  const text       = `${title} ${summary}`.toLowerCase();
  const crisisHits = CRISIS_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const actionHits = ACTION_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const sensitiveH = SENSITIVITY_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const shockHits  = ECONOMIC_SHOCK_KWS.filter((kw) => text.includes(kw)).length;

  let rawScore = crisisHits * 30 + actionHits * 20 + sensitiveH * 15 + shockHits * 10;
  if (regionLevel === "regional")   rawScore += 20;
  else if (regionLevel === "nacional") rawScore += 10;

  const score = Math.min(100, rawScore);
  const level = score >= 60 ? "alto" : score >= 30 ? "medio" : "bajo";
  return { level, score };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 5: PRIORITY SCORING
// ═══════════════════════════════════════════════════════════════════════════════

const SOURCE_SCORES: Record<string, number> = {
  "Infobae": 80, "LM Neuquén": 100, "Ámbito": 85, "La Nación": 75,
  "Diario Río Negro": 90, "Clarín": 70, "El Cronista": 80,
  "Tributum": 90, "Contadores en Red": 90, "Página 12": 60,
};

export function calcPriorityScore(
  domainFitScore: number,
  categoryConfidence: number,
  impactScore: number,
  regionLevel: string,
  publishedAt: string,
  sourceName?: string,
): number {
  const ageHours    = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  const recency     = Math.max(0, 100 - ageHours * (100 / 24));
  const adjImpact   = regionLevel === "regional"  ? Math.min(100, impactScore + 15)
    : regionLevel === "nacional" ? Math.min(100, impactScore + 5)
    : impactScore;
  const sourceScore = sourceName ? (SOURCE_SCORES[sourceName] ?? 60) : 60;
  const keywordsS   = domainFitScore * 0.70 + categoryConfidence * 0.30;
  return Math.round(Math.min(100, adjImpact * 0.40 + keywordsS * 0.30 + sourceScore * 0.20 + recency * 0.10));
}

// ── buildClassificationReason ─────────────────────────────────────────────────

function buildClassificationReason(opts: {
  discarded: boolean; domainFitScore: number; positiveHits: string[];
  negativeFlags: string[]; regionLevel?: string; category?: string;
  confidence?: number; impactLevel?: string; impactScore?: number;
}): string {
  if (opts.discarded) {
    const flags = opts.negativeFlags.length > 0
      ? `flags=[${opts.negativeFlags.slice(0, 4).join(", ")}]`
      : "sin keywords positivas suficientes";
    const pos = opts.positiveHits.length > 0
      ? ` | positivos=[${opts.positiveHits.slice(0, 3).join(", ")}]` : "";
    return `DESCARTADO: domain_fit=${opts.domainFitScore} | ${flags}${pos}`;
  }
  return [
    `domain_fit=${opts.domainFitScore} (+[${opts.positiveHits.slice(0, 5).join(", ")}])`,
    `region=${opts.regionLevel}`,
    `categoria=${opts.category} (conf=${opts.confidence}%)`,
    `impacto=${opts.impactLevel} (score=${opts.impactScore})`,
  ].join(" | ");
}

// ── classifyArticle ───────────────────────────────────────────────────────────

function buildTags(title: string, summary: string, regionLevel: string, newsCategory: string, positiveHits: string[]): string[] {
  const tags = [regionLevel, newsCategory];
  const text = `${title} ${summary}`.toLowerCase();
  if (positiveHits.includes("dólar") || positiveHits.includes("dolar") || text.includes("tipo de cambio")) tags.push("dólar");
  if (positiveHits.includes("inflación") || positiveHits.includes("inflacion")) tags.push("inflación");
  if (positiveHits.includes("afip") || positiveHits.includes("arca")) tags.push("AFIP/ARCA");
  if (positiveHits.some((h) => ["impuesto", "iva", "ganancias"].some((k) => h.includes(k)))) tags.push("impuestos");
  if (positiveHits.includes("vaca muerta"))    tags.push("Vaca Muerta");
  if (positiveHits.some((h) => h.includes("neuqu"))) tags.push("Neuquén");
  if (positiveHits.some((h) => h.includes("río negro") || h.includes("rio negro"))) tags.push("Río Negro");
  if (positiveHits.some((h) => h.includes("paritaria"))) tags.push("paritarias");
  if (positiveHits.some((h) => h.includes("fallo") || h.includes("sentencia"))) tags.push("judiciales");
  return [...new Set(tags)];
}

export function classifyArticle(item: {
  title: string; summary: string; sourceName: string; pubDate: string;
}) {
  const { title, summary, sourceName, pubDate } = item;
  const { score: domainFitScore, positiveHits, negativeFlags } = scoreDomainFit(title, summary);

  if (domainFitScore < DOMAIN_FIT_THRESHOLD) {
    return {
      regionLevel: "internacional", newsCategory: "economia", tags: [],
      impactLevel: "bajo", priorityScore: 0, domainFitScore, categoryConfidence: 0,
      classificationReason: buildClassificationReason({ discarded: true, domainFitScore, positiveHits, negativeFlags }),
      exclusionFlags: negativeFlags, discarded: true, importanceScore: 0, isFiscalRelated: false,
    };
  }

  const regionLevel                       = classifyRegion(title, summary, sourceName);
  const { category: newsCategory, confidence: categoryConfidence } = classifyCategoryWithConfidence(title, summary);
  const { level: impactLevel, score: impactScore }                 = scoreImpact(title, summary, regionLevel);
  const priorityScore = calcPriorityScore(domainFitScore, categoryConfidence, impactScore, regionLevel, pubDate, sourceName);
  const tags          = buildTags(title, summary, regionLevel, newsCategory, positiveHits);
  const importanceScore = Math.round(domainFitScore * 0.5 + impactScore * 0.5);
  const isFiscalRelated = positiveHits.some((h) => ["afip", "arca", "impuesto", "iva", "ganancias", "monotributo", "boletín oficial"].includes(h));

  return {
    regionLevel, newsCategory, tags, impactLevel, priorityScore, domainFitScore,
    categoryConfidence, isFiscalRelated, importanceScore, exclusionFlags: [],  discarded: false,
    classificationReason: buildClassificationReason({
      discarded: false, domainFitScore, positiveHits, negativeFlags,
      regionLevel, category: newsCategory, confidence: categoryConfidence,
      impactLevel, impactScore,
    }),
  };
}

// ── reclassifyAllNews ─────────────────────────────────────────────────────────

export async function reclassifyAllNews(force: boolean): Promise<void> {
  const items = await db
    .select({ id: newsItemsTable.id, title: newsItemsTable.title, summary: newsItemsTable.summary,
      source: newsItemsTable.source, publishedAt: newsItemsTable.publishedAt,
      classificationReason: newsItemsTable.classificationReason })
    .from(newsItemsTable);

  const toFix = force
    ? items
    : items.filter((n) => !n.classificationReason || n.classificationReason === "");

  logger.info({ total: items.length, toFix: toFix.length }, "news: reclassificando artículos");

  for (const item of toFix) {
    const result = classifyArticle({
      title: item.title, summary: item.summary ?? "",
      sourceName: item.source, pubDate: item.publishedAt ?? new Date().toISOString(),
    });
    await db.update(newsItemsTable).set({
      regionLevel: result.regionLevel, newsCategory: result.newsCategory,
      impactLevel: result.impactLevel, priorityScore: result.priorityScore,
      domainFitScore: result.domainFitScore, categoryConfidence: result.categoryConfidence,
      isFiscalRelated: result.isFiscalRelated, tags: result.tags,
      classificationReason: result.classificationReason,
      exclusionFlags: result.exclusionFlags, discarded: result.discarded,
    }).where(eq(newsItemsTable.id, item.id));
  }
}

// ── refreshNews ───────────────────────────────────────────────────────────────
// SEGURIDAD: SERPAPI_KEY NUNCA se incluye en logs.
// Los errores de fetch registran solo el status HTTP y el nombre de la fuente.
export async function refreshNews(): Promise<number> {
  if (await isCircuitOpen(RSS_SOURCE_NAME)) {
    logger.warn({ source: RSS_SOURCE_NAME }, "news.service: circuit RSS abierto, saltando refresh");
    return 0;
  }

  return withSyncLog("news", async () => {
    let totalNew    = 0;
    let anySuccess  = false;
    let anyFailure  = false;

    const [existingUrls, existingTitles] = await Promise.all([
      db.select({ url: newsItemsTable.url }).from(newsItemsTable),
      db.select({ title: newsItemsTable.title }).from(newsItemsTable),
    ]);

    const urlSet   = new Set(existingUrls.map((r) => r.url));
    const titleSet = new Set(existingTitles.map((r) => r.title.slice(0, 100)));

    for (const source of RSS_SOURCES.filter((s) => s.enabled)) {
      try {
        const items = await fetchRssSource(source.url, source.name, source.category, 20);
        anySuccess = true;

        for (const item of items) {
          if (urlSet.has(item.link) || titleSet.has(item.title.slice(0, 100))) continue;

          const classification = classifyArticle({
            title:      item.title,
            summary:    item.summary,
            sourceName: source.name,
            pubDate:    item.pubDate,
          });

          if (classification.discarded) continue;

          await db.insert(newsItemsTable).values({
            title:                item.title.slice(0, 500),
            source:               source.name,
            category:             source.category,
            regionLevel:          classification.regionLevel,
            newsCategory:         classification.newsCategory,
            tags:                 classification.tags,
            impactLevel:          classification.impactLevel,
            priorityScore:        classification.priorityScore,
            domainFitScore:       classification.domainFitScore,
            categoryConfidence:   classification.categoryConfidence,
            classificationReason: classification.classificationReason,
            exclusionFlags:       classification.exclusionFlags,
            discarded:            false,
            region:               classification.regionLevel,
            url:                  item.link,
            summary:              item.summary.slice(0, 1000) || item.title,
            imageUrl:             item.imageUrl ?? null,
            publishedAt:          item.pubDate ?? new Date().toISOString(),
            importanceScore:      classification.importanceScore,
            isFiscalRelated:      classification.isFiscalRelated,
          });

          urlSet.add(item.link);
          titleSet.add(item.title.slice(0, 100));
          totalNew++;
        }
      } catch (err) {
        // Solo loguear nombre de fuente — no la URL (que puede contener keys en algunos adapters)
        logger.error({ source: source.name, err }, "news.service: fuente RSS falló");
        anyFailure = true;
      }
    }

    // Intentar SerpAPI si está configurada y su circuit no está abierto
    const serpApiKey = process.env["SERPAPI_KEY"];
    if (serpApiKey && !(await isCircuitOpen(SERPAPI_SOURCE_NAME))) {
      try {
        // SEGURIDAD: construir la URL con la key pero NUNCA loguearla
        const serpUrl = `https://serpapi.com/search.json?engine=google_news&q=economia+argentina&api_key=${serpApiKey}&num=10&hl=es`;
        const res = await fetch(serpUrl, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
        // Si llegamos acá, el request fue exitoso
        await recordSuccess(SERPAPI_SOURCE_NAME);
        anySuccess = true;
        // Procesar resultado (omitido — depende del adapter)
      } catch (err) {
        await recordFailure(SERPAPI_SOURCE_NAME);
        // SEGURIDAD: no loguear el error object completo (puede contener la URL con la key)
        // Solo loguear el mensaje
        const safeMessage = err instanceof Error ? err.message : "SerpAPI error";
        logger.warn({ message: safeMessage }, "news.service: SerpAPI falló (circuit registrado)");
        anyFailure = true;
      }
    } else if (!serpApiKey) {
      logger.debug("news.service: SERPAPI_KEY no configurada, usando solo RSS");
    }

    if (anySuccess)      await recordSuccess(RSS_SOURCE_NAME);
    else if (anyFailure) await recordFailure(RSS_SOURCE_NAME);

    logger.info({ totalNew }, "news.service: refresh completado");
    return { count: totalNew, result: totalNew };
  });
}

// ── getNews ───────────────────────────────────────────────────────────────────

export async function getNews(opts: {
  userId?:      string;
  regionLevel?: string;
  newsCategory?: string;
  source?:       string;
  search?:       string;
  limit?:        number;
}): Promise<(typeof newsItemsTable.$inferSelect & { savedByUser?: boolean })[]> {
  const { userId, limit = 100 } = opts;

  const items = await db
    .select()
    .from(newsItemsTable)
    .where(eq(newsItemsTable.discarded, false))
    .orderBy(desc(newsItemsTable.priorityScore), desc(newsItemsTable.publishedAt))
    .limit(limit);

  // Enriquecer con saved status si hay userId
  if (userId) {
    const numId = parseInt(userId, 10);
    if (!isNaN(numId) && items.length > 0) {
      const savedRows = await db
        .select({ newsId: savedNewsTable.newsId })
        .from(savedNewsTable)
        .where(
          and(
            eq(savedNewsTable.userId, numId),
            inArray(savedNewsTable.newsId, items.map((n) => n.id)),
          ),
        );
      const savedSet = new Set(savedRows.map((r) => r.newsId));
      return items.map((n) => ({ ...n, savedByUser: savedSet.has(n.id) }));
    }
  }
  return items;
}

// ── saveNews / unsaveNews / getSavedNews ──────────────────────────────────────

export async function saveNews(userId: string, newsId: number): Promise<void> {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) throw new Error("userId inválido");
  await db
    .insert(savedNewsTable)
    .values({ userId: numId, newsId })
    .onConflictDoNothing();
}

export async function unsaveNews(userId: string, newsId: number): Promise<void> {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) throw new Error("userId inválido");
  await db
    .delete(savedNewsTable)
    .where(and(eq(savedNewsTable.userId, numId), eq(savedNewsTable.newsId, newsId)));
}

export async function getSavedNews(userId: string) {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) return [];
  const saved = await db
    .select({ newsId: savedNewsTable.newsId, savedAt: savedNewsTable.createdAt })
    .from(savedNewsTable)
    .where(eq(savedNewsTable.userId, numId))
    .orderBy(desc(savedNewsTable.createdAt));
  if (saved.length === 0) return [];
  const ids   = saved.map((s) => s.newsId);
  const items = await db
    .select()
    .from(newsItemsTable)
    .where(inArray(newsItemsTable.id, ids));
  const savedAtMap = new Map(saved.map((s) => [s.newsId, s.savedAt]));
  return items.map((n) => ({ ...n, savedAt: savedAtMap.get(n.id) ?? null }));
}

// ── getUserAlerts / createUserAlert / updateUserAlert / deleteUserAlert ───────

export async function getUserAlerts(userId: string) {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) return [];
  return db.select().from(userAlertsTable).where(eq(userAlertsTable.userId, numId));
}

export async function createUserAlert(userId: string, data: { regionLevel?: string | null; newsCategory?: string | null; label?: string | null }) {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) throw new Error("userId inválido");
  const [alert] = await db
    .insert(userAlertsTable)
    .values({ userId: numId, regionLevel: data.regionLevel ?? null, newsCategory: data.newsCategory ?? null, label: data.label ?? null, active: true })
    .returning();
  return alert;
}

export async function updateUserAlert(userId: string, alertId: number, data: { active?: boolean; label?: string | null }) {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) return null;
  const [updated] = await db
    .update(userAlertsTable)
    .set(data)
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, numId)))
    .returning();
  return updated ?? null;
}

export async function deleteUserAlert(userId: string, alertId: number): Promise<void> {
  const numId = parseInt(userId, 10);
  if (isNaN(numId)) return;
  await db
    .delete(userAlertsTable)
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, numId)));
}

// ── ensureNewsUpToDate ────────────────────────────────────────────────────────
// COUNT(*) SQL en lugar de cargar toda la tabla para contar.
export async function ensureNewsUpToDate(): Promise<void> {
  const [lastSyncResult, countResult] = await Promise.all([
    db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(20),
    db.select({ count: sql<number>`count(*)` }).from(newsItemsTable),
  ]);

  const lastSync = lastSyncResult.find((l) => l.module === "news" && l.status === "success");
  const age      = lastSync ? Date.now() - new Date(lastSync.startedAt).getTime() : Infinity;
  const count    = Number(countResult[0]?.count ?? 0);

  if (age > CACHE_TTL_MS || count < 10) {
    refreshNews().catch((err: unknown) => {
      logger.error({ err }, "news.service: background refresh falló");
    });
  }
}
