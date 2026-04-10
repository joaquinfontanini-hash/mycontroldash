import { db, discardLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const DEFAULT_QUALITY_THRESHOLD = 40;

export interface QualityResult {
  score: number;
  issues: string[];
  needsReview: boolean;
  discard: boolean;
  discardReason?: string;
}

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2010 && year <= new Date().getFullYear() + 1;
}

export function scoreFiscalItem(item: {
  title: string;
  summary: string;
  date: string;
  sourceUrl?: string | null;
  organism: string;
}): QualityResult {
  let score = 100;
  const issues: string[] = [];

  if (!item.title || item.title.trim().length < 5) {
    return { score: 0, issues: ["Título ausente o demasiado corto"], needsReview: false, discard: true, discardReason: "Título ausente o demasiado corto" };
  }

  if (item.title.trim().length < 15) {
    score -= 20;
    issues.push("Título muy breve");
  }

  if (!item.summary || item.summary.trim().length < 20 || item.summary.trim() === item.title.trim()) {
    score -= 15;
    issues.push("Resumen ausente o idéntico al título");
  }

  if (!isValidDate(item.date)) {
    score -= 30;
    issues.push("Fecha inválida o fuera de rango");
  } else {
    const daysOld = (Date.now() - new Date(item.date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > 730) {
      score -= 10;
      issues.push("Publicación con más de 2 años de antigüedad");
    }
  }

  if (!item.sourceUrl) {
    score -= 20;
    issues.push("Sin URL de fuente");
  } else if (!isValidUrl(item.sourceUrl)) {
    score -= 20;
    issues.push("URL de fuente con formato inválido");
  }

  if (!item.organism || item.organism.trim().length < 2) {
    score -= 10;
    issues.push("Organismo no identificado");
  }

  const hasGarbage = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item.title);
  if (hasGarbage) {
    score -= 15;
    issues.push("Título con caracteres inválidos o codificación rota");
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const needsReview = finalScore < 60 && finalScore >= DEFAULT_QUALITY_THRESHOLD;

  if (finalScore < DEFAULT_QUALITY_THRESHOLD) {
    return { score: finalScore, issues, needsReview: false, discard: true, discardReason: issues.join("; ") };
  }

  return { score: finalScore, issues, needsReview, discard: false };
}

export function scoreTravelOffer(offer: {
  destination: string;
  price: string | number | null;
  link: string;
  duration: number;
  validUntil?: string | null;
  provider: string;
}): QualityResult {
  let score = 100;
  const issues: string[] = [];

  if (!offer.destination || offer.destination.trim().length < 2) {
    return { score: 0, issues: ["Destino ausente"], needsReview: false, discard: true, discardReason: "Destino ausente" };
  }

  const price = offer.price === null || offer.price === undefined ? null : Number(offer.price);
  if (price === null || isNaN(price) || price <= 0) {
    score -= 40;
    issues.push("Precio nulo, cero o negativo");
  } else if (price < 100) {
    score -= 20;
    issues.push("Precio sospechosamente bajo (< 100)");
  } else if (price > 50000000) {
    score -= 25;
    issues.push("Precio sospechosamente alto");
  }

  if (!isValidUrl(offer.link)) {
    score -= 30;
    issues.push("URL de oferta inválida o ausente");
  }

  if (offer.duration <= 0) {
    score -= 20;
    issues.push("Duración inválida (≤ 0 días)");
  }

  if (offer.validUntil) {
    const expiry = new Date(offer.validUntil);
    if (!isNaN(expiry.getTime()) && expiry < new Date()) {
      score -= 20;
      issues.push("Oferta vencida");
    }
  }

  if (!offer.provider || offer.provider.trim().length < 2) {
    score -= 10;
    issues.push("Proveedor no identificado");
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const needsReview = finalScore < 70 && finalScore >= DEFAULT_QUALITY_THRESHOLD;

  if (finalScore < DEFAULT_QUALITY_THRESHOLD) {
    return { score: finalScore, issues, needsReview: false, discard: true, discardReason: issues.join("; ") };
  }

  return { score: finalScore, issues, needsReview, discard: false };
}

export async function logDiscard(params: {
  module: string;
  source: string;
  title: string;
  sourceUrl?: string | null;
  reason: string;
}): Promise<void> {
  try {
    await db.insert(discardLogsTable).values({
      module: params.module,
      source: params.source,
      title: params.title.slice(0, 500),
      sourceUrl: params.sourceUrl,
      reason: params.reason,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write discard log");
  }
}
