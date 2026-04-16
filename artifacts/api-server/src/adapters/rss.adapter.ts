import Parser from "rss-parser";
import { logger } from "../lib/logger.js";
import { recordSuccess, recordFailure, isCircuitOpen } from "../services/cache.service.js";

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
  summary: string;
  imageUrl?: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
}

const parser = new Parser({
  timeout: 12000,
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:content", "mediaContent", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
    ],
  },
});

function extractImageUrl(item: any): string | undefined {
  const thumb = item.mediaThumbnail?.$.url || item.mediaThumbnail;
  if (thumb && typeof thumb === "string") return thumb;
  const content = item.mediaContent?.$.url || item.mediaContent;
  if (content && typeof content === "string") return content;
  const encl = item.enclosure?.url || item.enclosure?.$.url;
  if (encl && typeof encl === "string" && /\.(jpg|jpeg|png|webp)/i.test(encl)) return encl;
  const imgMatch = (item.content ?? item["content:encoded"] ?? "").match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch?.[1]) return imgMatch[1];
  return undefined;
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Derive a stable circuit-breaker key from the feed hostname */
function cbKey(feedUrl: string): string {
  try {
    return `rss:${new URL(feedUrl).hostname}`;
  } catch {
    return `rss:${feedUrl.slice(0, 40)}`;
  }
}

export async function fetchRssSource(
  feedUrl: string,
  sourceName: string,
  category: string,
  limit = 10
): Promise<RssItem[]> {
  const key = cbKey(feedUrl);

  // Skip if circuit is open for this host
  if (await isCircuitOpen(key)) {
    logger.warn({ feedUrl, sourceName }, "rss.adapter: circuit open, skipping fetch");
    return [];
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    const items: RssItem[] = [];

    for (const item of feed.items.slice(0, limit)) {
      if (!item.title || !item.link) continue;
      if (!isValidUrl(item.link)) continue;

      const rawSummary = item.contentSnippet ?? item.summary ?? item.content ?? "";
      const summary = cleanText(rawSummary).slice(0, 400);

      items.push({
        title: cleanText(item.title),
        link: item.link,
        pubDate: item.pubDate ?? new Date().toISOString(),
        content: cleanText((item as any)["content:encoded"] ?? item.content ?? ""),
        summary: summary || cleanText(item.title),
        imageUrl: extractImageUrl(item),
        sourceName,
        sourceUrl: feedUrl,
        category,
      });
    }

    await recordSuccess(key);
    return items;
  } catch (err) {
    await recordFailure(key);
    logger.warn({ feedUrl, sourceName, err }, "RSS fetch failed");
    return [];
  }
}
