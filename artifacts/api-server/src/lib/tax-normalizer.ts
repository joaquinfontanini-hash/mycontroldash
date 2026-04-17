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
      "gcias sociedades ddjj", "gcias sociedades",
      "gcias. sociedades", "gcias.",
      "impuesto a las ganancias", "impuesto ganancias",
      "ganancias ddjj", "ganancias",
    ],
  },
  {
    code: "anticipo_ganancias",
    patterns: [
      "anticipos gcias sociedades", "anticipos gcias. sociedades",
      "anticipos gcias pers humanas", "anticipos gcias. pers. humanas",
      "bienes personales fondo cooperativo",
      "anticipos gcias", "anticipo gcias",
      "anticipo de ig", "anticipos ig",
      "anticipo ig", "anticipo impuesto ganancias",
      "anticipos ganancias", "anticipo ganancias",
      "anticipos",
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
    code: "cargas_sociales",
    patterns: [
      "empleadores sicoss", "empleadores (sicoss)",
      "sicoss", "sistema integrado previsional argentino",
      "cargas sociales empleadores", "cargas sociales",
      "cs empleadores", "seguridad social", "aportes y contribuciones",
    ],
  },
  {
    code: "convenio_multilateral",
    patterns: [
      "convenio multilateral cm",
      "convenio multilateral",
      "multilateral",
      "cm convenio",
    ],
  },
  {
    code: "sicore_1q",
    patterns: [
      "1° quincena pago a cuenta",
      "1era quincena pago a cuenta",
      "1a quincena pago a cuenta",
      "sicore 1° quincena", "sicore 1era quincena",
      "sicore/sire 1° quincena",
      "sicore/sire impositivo 1q",
      "retenciones 1° quincena",
      "pago a cuenta sicore",
      "sicore 1q", "sire 1q",
      "1° quincena sicore",
    ],
  },
  {
    code: "sicore_ddjj",
    patterns: [
      "2° quincena ddjj e ingreso de saldo",
      "2° quincena ddjj e ingreso del saldo",
      "2° quincena ddjj",
      "sicore ddjj", "sicore 2° quincena",
      "sicore/sire 2° quincena",
      "sicore/sire impositivo ddjj",
      "ddjj e ingreso de saldo sicore",
      "2° quincena sicore",
      "sicore 2q", "sire 2q",
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
  anticipo_ganancias: "Anticipo de Ganancias",
  monotributo: "Monotributo",
  autonomos: "Autónomos",
  cargas_sociales: "Cargas Sociales (SICOSS)",
  convenio_multilateral: "Convenio Multilateral",
  sicore_1q: "SICORE 1° Quincena",
  sicore_ddjj: "SICORE 2° Quincena DDJJ",
  iibb_neuquen: "IIBB Neuquén",
  iibb_rio_negro: "IIBB Río Negro",
  empleada_domestica: "Personal de Casas Particulares",
  sindicato: "Sindicato",
  facturacion: "Facturación",
};

export function taxLabel(code: string): string {
  return TAX_LABELS[code] ?? TAX_LABELS[normalizeTaxCode(code)] ?? code;
}
