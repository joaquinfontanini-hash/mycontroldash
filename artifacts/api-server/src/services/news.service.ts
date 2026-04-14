import {
  db, newsItemsTable, savedNewsTable, userAlertsTable, syncLogsTable,
} from "@workspace/db";
import { desc, eq, and, inArray, ne } from "drizzle-orm";
import { fetchRssSource } from "../adapters/rss.adapter.js";
import { withSyncLog } from "./sync.service.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// ── RSS Sources ───────────────────────────────────────────────────────────────

export const RSS_SOURCES = [
  { url: "https://www.infobae.com/feeds/rss/",                name: "Infobae",          category: "economia",   enabled: true },
  { url: "https://www.lmneuquen.com/servicios/rss.php",        name: "LM Neuquén",       category: "regional",   enabled: true },
  { url: "https://www.ambito.com/rss/pages/home.xml",          name: "Ámbito",           category: "economia",   enabled: true },
  { url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/", name: "La Nación",        category: "nacionales", enabled: true },
  { url: "https://www.rionegro.com.ar/feed/",                  name: "Diario Río Negro", category: "regional",   enabled: true },
  { url: "https://www.clarin.com/rss/economia/",               name: "Clarín",           category: "economia",   enabled: true },
  { url: "https://www.cronista.com/rss/",                      name: "El Cronista",      category: "economia",   enabled: false },
  { url: "https://www.pagina12.com.ar/rss/secciones/economia/notas", name: "Página 12", category: "economia",   enabled: false },
  { url: "https://www.tributum.news/feed/",                    name: "Tributum",         category: "impuestos",  enabled: false },
  { url: "https://contadoresenred.com/feed/",                  name: "Contadores en Red",category: "impuestos",  enabled: false },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 1: EVALUACIÓN DE PERTINENCIA (domain_fit_score)
// ───────────────────────────────────────────────────────────────────────────────
// El sistema NO clasifica todo lo que entra.
// PRIMERO evalúa si la noticia pertenece al dominio del módulo.
// Solo si domain_fit_score >= DOMAIN_FIT_THRESHOLD se clasifica y muestra.
// ═══════════════════════════════════════════════════════════════════════════════

const DOMAIN_FIT_THRESHOLD = 30;

// Términos positivos: presencia indica relevancia al dominio
// Cada término único presente suma +10 al rawScore
const DOMAIN_POSITIVE_TERMS: string[] = [
  // Fiscal / Tributario
  "afip", "arca", "impuesto", "impuestos", "iva", "ganancias", "monotributo",
  "autónomos", "retención", "percepción", "ingresos brutos", "rentas",
  "boletín oficial", "boletin oficial", "resolución general", "rg ",
  "facturación electrónica", "facturacion electronica", "e-facturas",
  "blanqueo", "moratoria",

  // Economía / Finanzas
  "inflación", "inflacion", "dólar", "dolar", "tipo de cambio",
  "economía", "economia", "mercado", "finanzas", "financiero", "financiera",
  "inversión", "inversion", "exportaciones", "importaciones",
  "reservas del bcra", "reservas internacionales", "deuda externa", "deuda pública",
  "fmi", "banco central", "bcra",
  "bonos", "acciones", "bolsa de comercio", "merval", "cedears",
  "presupuesto nacional", "presupuesto provincial",
  "déficit fiscal", "deficit fiscal", "superávit", "superavit",
  "recaudación", "recaudacion", "política monetaria", "politica monetaria",
  "tasa de interés", "tasa de interes", "cepo cambiario", "cepo",
  "tarifas de servicios", "tarifazo",
  "soja", "trigo", "maíz", "maiz", "commodities", "agroindustria", "campo",
  "actividad económica", "actividad economica", "pbi", "pib",
  "consumo interno", "demanda agregada",
  "empresas", "compañías", "multinacional",
  "inversión extranjera", "inversion extranjera",
  "quiebra", "concurso de acreedores",

  // Energía / Regional estratégico
  "petróleo", "petroleo", "vaca muerta", "energía", "energia",
  "gas natural", "hidrocarburos", "fractura hidráulica", "fracking",
  "yacimiento", "ypf", "pan american energy", "wintershall",
  "minería", "mineria",
  "neuquén", "neuquen", "río negro", "rio negro", "patagonia",
  "zapala", "cutral co", "plaza huincul", "añelo",

  // Laboral / Social
  "salarios", "salario", "sueldo", "sueldos", "empleo", "desempleo",
  "paritarias", "paritaria", "convenio colectivo", "negociación salarial",
  "sindicato", "sindicatos", "gremio", "gremios", "cgt", "ugl",
  "huelga", "paro general", "paro de", "medida de fuerza",
  "indemnización", "indemnizacion", "jubilación", "jubilacion",
  "anses", "pensión", "pension", "asignación", "asignacion",
  "sector privado", "sector público", "sector publico",

  // Político / Regulatorio
  "gobierno nacional", "gobierno provincial", "gobierno de neuquén",
  "decreto presidencial", "decreto ejecutivo",
  "legislación", "legislacion", "reforma laboral", "reforma tributaria",
  "senado", "diputados", "asamblea legislativa",
  "elecciones", "campaña electoral", "candidatos",
  "ministro de economía", "secretaría de hacienda",
  "política fiscal", "politica fiscal", "gasto público",
  "licitación", "licitacion", "obra pública", "obra publica",
  "concesión", "concesion", "contrato público",

  // Justicia / Regulatorio
  "fallo judicial", "sentencia", "tribunal oral",
  "cámara federal", "camara federal", "suprema corte",
  "causa por", "investigación judicial", "investigacion judicial",
  "corrupción", "corrupcion", "fraude", "estafa", "lavado de dinero",
  "evasión fiscal", "evasion fiscal",
  "detenido por", "imputado por", "procesado por",
];

// Términos negativos fuertes: presencia indica contenido de farándula/entretenimiento
// Cada término suma -35 al rawScore
const DOMAIN_STRONG_NEGATIVES: string[] = [
  "farándula", "farandula",
  "chimentos",
  "influencer", "youtuber", "tiktoker", "streamers",
  "hollywood",
  "reality show",
  "gran hermano",
  "horóscopo",
  "tiktok viral",
  "viral en redes",
  "se volvió viral",
  "boda de celebridades",
];

// Términos negativos moderados: presencia sugiere contenido de entretenimiento
// Cada término suma -20 al rawScore
const DOMAIN_MODERATE_NEGATIVES: string[] = [
  "actriz argentina",
  "actor argentino",
  "cantante argentina",
  "cantante argentino",
  "modelo argentina",
  "modelo argentino",
  "boda de",
  "casamiento de",
  "embarazo de",
  "romance de",
  "novio de",
  "novia de",
  "separación de",
  "separacion de",
  "look de",
  "foto de su",
  "fotos de su",
  "vacaciones de",
  "viaje de placer",
  "show de",
  "gira de",
  "alfombra roja",
];

/**
 * PASO 1 — Calcula domain_fit_score (0-100).
 * Si score < DOMAIN_FIT_THRESHOLD → descartar noticia.
 */
export function scoreDomainFit(title: string, summary: string): {
  score: number;
  positiveHits: string[];
  negativeFlags: string[];
} {
  const text = `${title} ${summary}`.toLowerCase();

  const positiveHits = DOMAIN_POSITIVE_TERMS.filter(t => text.includes(t));
  const strongNegHits = DOMAIN_STRONG_NEGATIVES.filter(t => text.includes(t));
  const moderateNegHits = DOMAIN_MODERATE_NEGATIVES.filter(t => text.includes(t));

  const rawScore =
    positiveHits.length * 10
    - strongNegHits.length * 35
    - moderateNegHits.length * 20;

  const score = Math.max(0, Math.min(100, rawScore));
  const negativeFlags = [...strongNegHits, ...moderateNegHits];

  return { score, positiveHits, negativeFlags };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 2: CLASIFICACIÓN DE REGIÓN
// ═══════════════════════════════════════════════════════════════════════════════

const REGIONAL_KEYWORDS = [
  "neuquén", "neuquen", "neuquino", "neuquina",
  "río negro", "rio negro", "rionegrino", "rionegrina",
  "patagonia", "patagónica", "patagónico",
  "bariloche", "cipolletti", "viedma", "general roca",
  "centenario", "plottier", "cutral co", "zapala", "añelo",
  "vaca muerta", "yacimiento loma campana",
  "provincia de neuquén", "provincia de río negro",
  "legislature neuquina",
];

const NATIONAL_KEYWORDS = [
  "argentina", "argentino", "argentinos", "argentina's",
  "gobierno nacional", "congreso nacional", "senado de la nación",
  "diputados de la nación", "presidente de argentina",
  "milei", "casa rosada",
  "afip", "arca", "bcra", "banco central",
  "buenos aires", "caba", "capital federal",
  "anses", "ministerio de economía", "secretaría de hacienda",
];

/**
 * PASO 2 — Clasifica región (solo se llama si domain_fit_score pasa el umbral).
 */
export function classifyRegion(title: string, summary: string, sourceName: string): string {
  const text = `${title} ${summary}`.toLowerCase();

  if (sourceName === "LM Neuquén" || sourceName === "Diario Río Negro") return "regional";
  if (REGIONAL_KEYWORDS.some(kw => text.includes(kw))) return "regional";
  if (NATIONAL_KEYWORDS.some(kw => text.includes(kw))) return "nacional";
  return "internacional";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 3: CLASIFICACIÓN DE CATEGORÍA CON CONFIDENCE
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  economia: [
    "dólar", "dolar", "tipo de cambio", "inflación", "inflacion", "ipc",
    "mercado", "finanzas", "economía", "economia", "pbi", "pib",
    "exportaciones", "importaciones", "reservas", "deuda", "fmi",
    "bcra", "banco central", "bonos", "acciones", "bolsa", "merval",
    "cereal", "soja", "commodities", "precio", "tarifas",
    "afip", "arca", "impuesto", "iva", "ganancias", "monotributo",
    "presupuesto", "déficit", "deficit", "superávit", "recaudación",
    "fiscal", "petróleo", "petroleo", "vaca muerta", "energía",
    "empresa", "inversión", "inversion", "consumo", "actividad económica",
    "quiebra", "concurso", "producción", "produccion", "industria",
  ],
  politica: [
    "gobierno", "elecciones", "ley ", "congreso", "senado", "diputados",
    "política", "politica", "presidente", "ministro", "decreto",
    "legislación", "legislacion", "partido", "oposición", "oposicion",
    "coalición", "coalicion", "milei", "kirchner", "peronismo",
    "macri", "ucr", "frente de todos", "reforma", "veto",
    "campaña electoral", "candidatos", "gestión pública", "gestion publica",
    "licitación", "obra pública", "obra publica", "concesión",
  ],
  laboral: [
    "salarios", "salario", "sueldo", "empleo", "desempleo", "trabajo",
    "paritarias", "paritaria", "sindicatos", "sindicato", "gremio",
    "convenio colectivo", "huelga", "paro ", "indemnización",
    "jubilación", "jubilacion", "previsión", "anses",
    "sector privado", "sector público", "despidos", "despido",
    "trabajadores", "empleados", "cgt",
  ],
  juicios: [
    "justicia", "fallo", "tribunal", "causa", "juicio", "sentencia",
    "corte", "cámara federal", "camara federal", "juzgado",
    "imputado", "condena", "absolución", "absolucion", "procesado",
    "corrupción", "corrupcion", "estafa", "fraude", "denuncia",
    "suprema corte", "casación", "lavado de dinero",
    "evasión fiscal", "detenido",
  ],
};

/**
 * PASO 3 — Clasifica categoría y calcula confidence (0-100).
 * No fuerza categoría si la confianza es baja.
 */
export function classifyCategoryWithConfidence(
  title: string,
  summary: string,
): { category: string; confidence: number } {
  const text = `${title} ${summary}`.toLowerCase();

  const scores: Record<string, number> = {
    economia: 0, politica: 0, laboral: 0, juicios: 0,
  };

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) scores[cat]++;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  if (total === 0) {
    // Sin señal clara → economía por defecto (dominio más común)
    return { category: "economia", confidence: 0 };
  }

  const [bestCat, bestScore] = Object.entries(scores).reduce((a, b) =>
    a[1] >= b[1] ? a : b
  );

  const confidence = Math.round((bestScore / total) * 100);
  return { category: bestCat, confidence };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 4: IMPACT SCORING
// ═══════════════════════════════════════════════════════════════════════════════

const CRISIS_KEYWORDS = [
  "crisis", "colapso", "default", "emergencia económica",
  "quiebra masiva", "catástrofe", "corrida bancaria", "bank run",
  "devaluación brusca", "cepo al dólar",
];

const ACTION_KEYWORDS = [
  "vence", "vencimiento", "plazo fatal", "obligatorio desde",
  "urgente", "prórroga", "proroga", "a partir del", "desde el",
  "implementación obligatoria", "nueva obligación",
];

const SENSITIVITY_KEYWORDS = [
  "afip", "arca", "dólar oficial", "brecha cambiaria",
  "inflación mensual", "inflacion mensual",
  "paritarias nacionales", "huelga general", "paro general",
  "fallo judicial", "condena judicial",
  "suba de impuestos", "baja de impuestos",
  "reforma tributaria", "reforma previsional",
];

const ECONOMIC_SHOCK_KEYWORDS = [
  "récord histórico", "record historico",
  "caída del", "caida del",
  "disparó", "disparo del",
  "se desplomó", "derrumbe del",
  "sube un", "subió un",
  "devaluación del", "devaluacion del",
];

/**
 * PASO 4 — Calcula impact_score (0-100) y mapea a bajo/medio/alto.
 * Solo se llama después de pasar el domain_fit gate.
 */
export function scoreImpact(
  title: string,
  summary: string,
  regionLevel: string,
): { level: "bajo" | "medio" | "alto"; score: number } {
  const text = `${title} ${summary}`.toLowerCase();

  const crisisHits = CRISIS_KEYWORDS.filter(kw => text.includes(kw)).length;
  const actionHits = ACTION_KEYWORDS.filter(kw => text.includes(kw)).length;
  const sensitiveHits = SENSITIVITY_KEYWORDS.filter(kw => text.includes(kw)).length;
  const shockHits = ECONOMIC_SHOCK_KEYWORDS.filter(kw => text.includes(kw)).length;

  let rawScore =
    crisisHits * 30
    + actionHits * 20
    + sensitiveHits * 15
    + shockHits * 10;

  // Bonus geográfico: contenido regional impacta directamente al usuario
  if (regionLevel === "regional") rawScore += 20;
  else if (regionLevel === "nacional") rawScore += 10;

  const score = Math.min(100, rawScore);
  const level: "bajo" | "medio" | "alto" =
    score >= 60 ? "alto" : score >= 30 ? "medio" : "bajo";

  return { level, score };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 5: PRIORITY SCORING FINAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PASO 5 — Combina todos los scores en un priority_score final (0-100).
 *
 * Pesos:
 *  - domain_fit_score    30% — si la noticia no es del dominio, no puede rankear
 *  - impact_score        30% — noticias de alto impacto suben naturalmente
 *  - recency             20% — noticias recientes prevalecen (decae en 20h)
 *  - regional_bonus      10% — cercanía geográfica al usuario
 *  - category_confidence 10% — clasificación más segura = más confiable
 */
export function calcPriorityScore(
  domainFitScore: number,
  categoryConfidence: number,
  impactScore: number,
  regionLevel: string,
  publishedAt: string,
): number {
  // Recencia: 100 al publicar, decae linealmente a 0 a las 20 horas
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 100 - ageHours * 5);

  // Bonus de cercanía geográfica
  const regionalScore = regionLevel === "regional" ? 100
    : regionLevel === "nacional" ? 50
    : 0;

  const priority =
    domainFitScore * 0.30
    + impactScore * 0.30
    + recencyScore * 0.20
    + regionalScore * 0.10
    + categoryConfidence * 0.10;

  return Math.round(Math.min(100, priority));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASO 6: TRAZABILIDAD — classification_reason
// ═══════════════════════════════════════════════════════════════════════════════

function buildClassificationReason(opts: {
  discarded: boolean;
  domainFitScore: number;
  positiveHits: string[];
  negativeFlags: string[];
  regionLevel?: string;
  category?: string;
  confidence?: number;
  impactLevel?: string;
  impactScore?: number;
}): string {
  if (opts.discarded) {
    const flags = opts.negativeFlags.length > 0
      ? `flags=[${opts.negativeFlags.slice(0, 4).join(", ")}]`
      : "sin keywords positivas suficientes";
    const positivos = opts.positiveHits.length > 0
      ? ` | positivos=[${opts.positiveHits.slice(0, 3).join(", ")}]`
      : "";
    return `DESCARTADO: domain_fit=${opts.domainFitScore} | ${flags}${positivos}`;
  }

  const posStr = opts.positiveHits.slice(0, 5).join(", ");
  return [
    `domain_fit=${opts.domainFitScore} (+[${posStr}])`,
    `region=${opts.regionLevel}`,
    `categoria=${opts.category} (conf=${opts.confidence}%)`,
    `impacto=${opts.impactLevel} (score=${opts.impactScore})`,
  ].join(" | ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE COMPLETO — classifyArticle()
// ═══════════════════════════════════════════════════════════════════════════════

export function classifyArticle(item: {
  title: string;
  summary: string;
  sourceName: string;
  pubDate: string;
}): {
  regionLevel: string;
  newsCategory: string;
  tags: string[];
  impactLevel: string;
  priorityScore: number;
  domainFitScore: number;
  categoryConfidence: number;
  classificationReason: string;
  exclusionFlags: string[];
  discarded: boolean;
  importanceScore: number;
  isFiscalRelated: boolean;
} {
  const { title, summary, sourceName, pubDate } = item;

  // PASO 1: Domain fit gate
  const { score: domainFitScore, positiveHits, negativeFlags } = scoreDomainFit(title, summary);

  if (domainFitScore < DOMAIN_FIT_THRESHOLD) {
    return {
      regionLevel: "internacional",
      newsCategory: "economia",
      tags: [],
      impactLevel: "bajo",
      priorityScore: 0,
      domainFitScore,
      categoryConfidence: 0,
      classificationReason: buildClassificationReason({
        discarded: true, domainFitScore, positiveHits, negativeFlags,
      }),
      exclusionFlags: negativeFlags,
      discarded: true,
      importanceScore: 0,
      isFiscalRelated: false,
    };
  }

  // PASO 2: Región
  const regionLevel = classifyRegion(title, summary, sourceName);

  // PASO 3: Categoría + confidence
  const { category: newsCategory, confidence: categoryConfidence } =
    classifyCategoryWithConfidence(title, summary);

  // PASO 4: Impacto
  const { level: impactLevel, score: impactScore } = scoreImpact(title, summary, regionLevel);

  // PASO 5: Priority
  const priorityScore = calcPriorityScore(
    domainFitScore, categoryConfidence, impactScore, regionLevel, pubDate,
  );

  // PASO 6: Tags
  const tags = buildTags(title, summary, regionLevel, newsCategory, positiveHits);

  // Razón de clasificación (trazabilidad)
  const classificationReason = buildClassificationReason({
    discarded: false,
    domainFitScore,
    positiveHits,
    negativeFlags,
    regionLevel,
    category: newsCategory,
    confidence: categoryConfidence,
    impactLevel,
    impactScore,
  });

  // Importancia legacy (backward compat)
  const importanceScore = Math.round((domainFitScore * 0.5) + (impactScore * 0.5));
  const isFiscalRelated = positiveHits.some(h =>
    ["afip", "arca", "impuesto", "iva", "ganancias", "monotributo", "boletín oficial"].includes(h)
  );

  return {
    regionLevel,
    newsCategory,
    tags,
    impactLevel,
    priorityScore,
    domainFitScore,
    categoryConfidence,
    classificationReason,
    exclusionFlags: [],
    discarded: false,
    importanceScore,
    isFiscalRelated,
  };
}

// ── Tag builder ────────────────────────────────────────────────────────────────

function buildTags(
  title: string,
  summary: string,
  regionLevel: string,
  newsCategory: string,
  positiveHits: string[],
): string[] {
  const tags: string[] = [regionLevel, newsCategory];
  const text = `${title} ${summary}`.toLowerCase();

  // Tags específicos de alto interés para el usuario
  if (positiveHits.includes("dólar") || positiveHits.includes("dolar") || text.includes("tipo de cambio")) tags.push("dólar");
  if (positiveHits.includes("inflación") || positiveHits.includes("inflacion")) tags.push("inflación");
  if (positiveHits.includes("afip") || positiveHits.includes("arca")) tags.push("AFIP/ARCA");
  if (positiveHits.some(h => h.includes("impuesto") || h.includes("iva") || h.includes("ganancias"))) tags.push("impuestos");
  if (positiveHits.includes("vaca muerta")) tags.push("Vaca Muerta");
  if (positiveHits.includes("neuquén") || positiveHits.includes("neuquen")) tags.push("Neuquén");
  if (positiveHits.includes("río negro") || positiveHits.includes("rio negro")) tags.push("Río Negro");
  if (positiveHits.includes("paritarias") || positiveHits.includes("paritaria")) tags.push("paritarias");
  if (positiveHits.includes("fallo judicial") || positiveHits.includes("sentencia")) tags.push("fallo judicial");
  if (positiveHits.some(h => h.includes("reforma"))) tags.push("reforma");

  return [...new Set(tags)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Deduplicación
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(el|la|los|las|un|una|de|del|al|y|e|o|u|que|en|con|por|para|se|su|sus|es|son|fue|sera|como|mas|pero|si|no)\b/g, " ")
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

// ═══════════════════════════════════════════════════════════════════════════════
// refreshNews — ingesta + pipeline completo
// ═══════════════════════════════════════════════════════════════════════════════

export async function refreshNews(): Promise<number> {
  return withSyncLog("news", async () => {
    let totalNew = 0;
    let skippedDup = 0;
    let skippedDomain = 0;

    const results = await Promise.allSettled(
      RSS_SOURCES.filter(s => s.enabled).map(source =>
        fetchRssSource(source.url, source.name, source.category, 25)
      )
    );

    const allItems = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

    const existingRows = await db
      .select({ url: newsItemsTable.url, title: newsItemsTable.title })
      .from(newsItemsTable);

    const existingUrls = new Set(existingRows.map(r => r.url));
    const existingNormalizedTitles = new Map<string, string>(
      existingRows.map(r => [normalizeTitle(r.title), r.url])
    );

    for (const item of allItems) {
      if (existingUrls.has(item.link)) continue;

      const normTitle = normalizeTitle(item.title);
      let isDuplicate = false;
      for (const [existNorm] of existingNormalizedTitles) {
        if (titleSimilarity(normTitle, existNorm) >= 0.75) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) { skippedDup++; continue; }

      // ── Pipeline completo de clasificación ──────────────────────────────────
      const classification = classifyArticle({
        title: item.title,
        summary: item.summary,
        sourceName: item.sourceName,
        pubDate: item.pubDate,
      });

      if (classification.discarded) {
        skippedDomain++;
        logger.debug({
          title: item.title.slice(0, 60),
          reason: classification.classificationReason,
        }, "News article discarded by domain filter");
        // Aún así guardamos para auditoría — marcada como discarded
        // Esto permite ver en el futuro qué fue descartado y por qué
      }

      const legacyCategory = classification.regionLevel === "regional" ? "provinciales"
        : classification.newsCategory === "economia" ? "economia"
        : classification.newsCategory === "politica" ? "politica"
        : classification.newsCategory === "laboral" ? "laboral"
        : "nacionales";

      try {
        await db.insert(newsItemsTable).values({
          title: item.title,
          source: item.sourceName,
          category: legacyCategory,
          regionLevel: classification.regionLevel,
          newsCategory: classification.newsCategory,
          tags: classification.tags,
          impactLevel: classification.impactLevel,
          priorityScore: classification.priorityScore,
          domainFitScore: classification.domainFitScore,
          categoryConfidence: classification.categoryConfidence,
          classificationReason: classification.classificationReason,
          exclusionFlags: classification.exclusionFlags,
          discarded: classification.discarded,
          region: classification.regionLevel,
          url: item.link,
          summary: item.summary,
          imageUrl: item.imageUrl,
          publishedAt: item.pubDate,
          importanceScore: classification.importanceScore,
          isFiscalRelated: classification.isFiscalRelated,
        });
        totalNew++;
        existingUrls.add(item.link);
        existingNormalizedTitles.set(normTitle, item.link);
      } catch {
        // ignore duplicate URL constraint
      }
    }

    logger.info(
      { totalNew, skippedDup, skippedDomain },
      "News refresh completed"
    );
    return { count: totalNew, result: totalNew };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// reclassifyAllNews — reclasifica artículos existentes con el nuevo motor
// Se ejecuta una vez al inicio del servidor para corregir clasificaciones antiguas
// ═══════════════════════════════════════════════════════════════════════════════

export async function reclassifyAllNews(force = false): Promise<void> {
  // Por defecto: solo reclasificar artículos sin classificationReason (campo vacío).
  // Con force=true: reclasifica todos los artículos (útil tras cambios de umbral).
  const articles = await db
    .select({
      id: newsItemsTable.id,
      title: newsItemsTable.title,
      summary: newsItemsTable.summary,
      source: newsItemsTable.source,
      publishedAt: newsItemsTable.publishedAt,
      classificationReason: newsItemsTable.classificationReason,
    })
    .from(newsItemsTable)
    .where(force ? undefined : eq(newsItemsTable.classificationReason, ""))
    .limit(5000);

  if (articles.length === 0) {
    logger.info("News reclassification: all articles already classified");
    return;
  }

  logger.info({ count: articles.length }, "News reclassification: starting...");
  let updated = 0;

  for (const article of articles) {
    const classification = classifyArticle({
      title: article.title,
      summary: article.summary,
      sourceName: article.source,
      pubDate: article.publishedAt,
    });

    const legacyCategory = classification.regionLevel === "regional" ? "provinciales"
      : classification.newsCategory === "economia" ? "economia"
      : classification.newsCategory === "politica" ? "politica"
      : classification.newsCategory === "laboral" ? "laboral"
      : "nacionales";

    await db.update(newsItemsTable)
      .set({
        regionLevel: classification.regionLevel,
        newsCategory: classification.newsCategory,
        tags: classification.tags,
        impactLevel: classification.impactLevel,
        priorityScore: classification.priorityScore,
        domainFitScore: classification.domainFitScore,
        categoryConfidence: classification.categoryConfidence,
        classificationReason: classification.classificationReason,
        exclusionFlags: classification.exclusionFlags,
        discarded: classification.discarded,
        region: classification.regionLevel,
        category: legacyCategory,
        importanceScore: classification.importanceScore,
        isFiscalRelated: classification.isFiscalRelated,
      })
      .where(eq(newsItemsTable.id, article.id));

    updated++;
  }

  logger.info({ updated }, "News reclassification: completed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// getNews — solo devuelve artículos NO descartados
// ═══════════════════════════════════════════════════════════════════════════════

export async function getNews(options: {
  regionLevel?: string;
  newsCategory?: string;
  source?: string;
  limit?: number;
  search?: string;
  userId?: number;
} = {}) {
  const { regionLevel, newsCategory, source, limit = 50, search, userId } = options;

  let items = await db
    .select()
    .from(newsItemsTable)
    .where(eq(newsItemsTable.discarded, false))   // ← NUNCA mostrar descartadas
    .orderBy(desc(newsItemsTable.priorityScore), desc(newsItemsTable.domainFitScore))
    .limit(500);

  if (regionLevel) items = items.filter(n => n.regionLevel === regionLevel);
  if (newsCategory) items = items.filter(n => n.newsCategory === newsCategory);
  if (source) items = items.filter(n => n.source.toLowerCase() === source.toLowerCase());
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(n =>
      n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)
    );
  }

  const sliced = items.slice(0, limit);

  let savedIds = new Set<number>();
  if (userId) {
    const saved = await db
      .select({ newsId: savedNewsTable.newsId })
      .from(savedNewsTable)
      .where(eq(savedNewsTable.userId, userId));
    savedIds = new Set(saved.map(s => s.newsId));
  }

  return sliced.map(n => ({ ...n, savedByUser: userId ? savedIds.has(n.id) : false }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Saved news
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveNews(userId: number, newsId: number): Promise<void> {
  try {
    await db.insert(savedNewsTable).values({ userId, newsId });
  } catch {
    // already saved
  }
}

export async function unsaveNews(userId: number, newsId: number): Promise<void> {
  await db.delete(savedNewsTable)
    .where(and(eq(savedNewsTable.userId, userId), eq(savedNewsTable.newsId, newsId)));
}

export async function getSavedNews(userId: number) {
  const saved = await db
    .select({ newsId: savedNewsTable.newsId, savedAt: savedNewsTable.createdAt })
    .from(savedNewsTable)
    .where(eq(savedNewsTable.userId, userId))
    .orderBy(desc(savedNewsTable.createdAt));

  if (saved.length === 0) return [];

  const newsIds = saved.map(s => s.newsId);
  const articles = await db
    .select()
    .from(newsItemsTable)
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

// ═══════════════════════════════════════════════════════════════════════════════
// User alerts
// ═══════════════════════════════════════════════════════════════════════════════

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
    .set({
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.label !== undefined ? { label: data.label } : {}),
    })
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, userId)))
    .returning();
  return alert;
}

export async function deleteUserAlert(userId: number, alertId: number): Promise<void> {
  await db.delete(userAlertsTable)
    .where(and(eq(userAlertsTable.id, alertId), eq(userAlertsTable.userId, userId)));
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// Cache helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function getLastFetchTime(): Promise<Date | null> {
  const logs = await db
    .select()
    .from(syncLogsTable)
    .orderBy(desc(syncLogsTable.startedAt))
    .limit(50);
  const last = logs.find(l => l.module === "news" && l.status === "success");
  return last ? new Date(last.startedAt) : null;
}

export async function ensureNewsUpToDate() {
  const lastFetch = await getLastFetchTime();
  const age = lastFetch ? Date.now() - lastFetch.getTime() : Infinity;
  const count = await db.select().from(newsItemsTable).then(r => r.length);

  if (age > CACHE_TTL_MS || count === 0) {
    logger.info("News cache stale or empty, refreshing...");
    await refreshNews().catch(err => logger.error({ err }, "Background news refresh failed"));
  }
}
