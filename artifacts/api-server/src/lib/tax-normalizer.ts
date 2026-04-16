/**
 * tax-normalizer.ts
 *
 * Normalización y homologación de nombres de impuestos.
 * Permite cruzar nombres del calendario (ej. "GANANCIAS SOCIEDADES DDJJ")
 * con los códigos normalizados usados en el sistema (ej. "ganancias").
 *
 * Reglas de normalización:
 *  1. Minúsculas
 *  2. Sin acentos (NFD decompose + strip combining marks)
 *  3. Sin puntos
 *  4. Espacios colapsados
 */

/** Lista de alias por código normalizado. El orden importa: más específico primero. */
const TAX_ALIASES: Array<{ code: string; patterns: string[] }> = [
  {
    code: "iva",
    patterns: [
      "iva ddjj", "iva mensual", "iva bimestral",
      "impuesto al valor agregado",
      "iva",
    ],
  },
  {
    code: "ganancias",
    patterns: [
      "ganancias sociedades ddjj", "ganancias sociedades",
      "ganancias personas humanas", "ganancias ph",
      "gcias sociedades", "gcias. sociedades", "gcias.",
      "impuesto a las ganancias", "impuesto ganancias",
      "ganancias ddjj", "ganancias",
    ],
  },
  {
    code: "monotributo",
    patterns: [
      "monotributo categoria",
      "monotributo",
      "mono",
    ],
  },
  {
    code: "autonomos",
    patterns: [
      "trabajadores autonomos", "trabajador autonomo",
      "autonomos", "autónomos",
    ],
  },
  {
    code: "iibb_neuquen",
    patterns: [
      "ingresos brutos neuquen", "ingresos brutos neuquen mensual",
      "iibb neuquen", "iibb nqn", "rentas neuquen", "iibb neuquén",
      "ingresos brutos nqn",
    ],
  },
  {
    code: "iibb_rio_negro",
    patterns: [
      "ingresos brutos rio negro", "iibb rio negro", "iibb rn",
      "rentas rio negro",
    ],
  },
  {
    code: "cargas_sociales",
    patterns: [
      "cargas sociales empleadores", "cargas sociales",
      "cs empleadores", "seguridad social", "aportes y contribuciones",
    ],
  },
  {
    code: "empleada_domestica",
    patterns: [
      "personal de casas particulares", "empleada domestica",
      "empleada doméstica", "personal domestico", "casas particulares",
    ],
  },
  {
    code: "sindicato",
    patterns: [
      "cuota sindical", "aporte sindical", "sindicato",
    ],
  },
  {
    code: "facturacion",
    patterns: [
      "facturacion electronica", "factura electronica", "facturacion",
    ],
  },
];

/** Strip de acentos + puntos + espacios extra + lowercase */
export function normalizeString(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // remove combining accents
    .replace(/\./g, "")                 // remove dots
    .replace(/[^a-z0-9\s_]/g, " ")     // non-alphanumeric/underscore → space
    .replace(/\s+/g, " ")              // collapse spaces
    .trim();
}

/**
 * Intenta mapear un nombre de impuesto (libre o normalizado) a un código canónico.
 * Si ya es un código canónico, lo devuelve directamente.
 * Si no encuentra alias, devuelve el string normalizado (fallback).
 */
export function normalizeTaxCode(raw: string): string {
  const normalized = normalizeString(raw);

  // Check if it's already a known canonical code
  const canonicalCodes = TAX_ALIASES.map(a => a.code);
  if (canonicalCodes.includes(normalized)) return normalized;

  // Try alias matching (longest/most specific pattern wins first)
  for (const { code, patterns } of TAX_ALIASES) {
    for (const pattern of patterns) {
      const normPattern = normalizeString(pattern);
      // Full match
      if (normalized === normPattern) return code;
      // Contains match (for longer text with extra context)
      if (normalized.includes(normPattern) && normPattern.length >= 4) return code;
    }
  }

  // Fallback: return the normalized string as-is
  return normalized;
}

/**
 * Returns true if two tax identifiers refer to the same tax,
 * even if one is a raw calendar string and the other a canonical code.
 */
export function taxCodesMatch(a: string, b: string): boolean {
  const ca = normalizeTaxCode(a);
  const cb = normalizeTaxCode(b);
  return ca === cb;
}

/** Human-readable label for a tax code (for error messages) */
const TAX_LABELS: Record<string, string> = {
  iva: "IVA DDJJ",
  ganancias: "Ganancias",
  monotributo: "Monotributo",
  autonomos: "Autónomos",
  iibb_neuquen: "IIBB Neuquén",
  iibb_rio_negro: "IIBB Río Negro",
  cargas_sociales: "Cargas Sociales",
  empleada_domestica: "Empleada Doméstica",
  sindicato: "Sindicato",
  facturacion: "Facturación",
};

export function taxLabel(code: string): string {
  return TAX_LABELS[code] ?? TAX_LABELS[normalizeTaxCode(code)] ?? code;
}
