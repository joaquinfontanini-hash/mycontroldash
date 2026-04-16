import { db, externalCacheTable, circuitBreakerTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// ── Circuit Breaker ───────────────────────────────────────────────────────────

export async function isCircuitOpen(sourceName: string): Promise<boolean> {
  try {
    const [cb] = await db
      .select()
      .from(circuitBreakerTable)
      .where(eq(circuitBreakerTable.sourceName, sourceName));

    if (!cb) return false;
    if (cb.state === "closed") return false;
    if (cb.state === "open" && cb.openUntil) {
      if (new Date() < cb.openUntil) return true;
      // auto-transition to half_open
      await db
        .update(circuitBreakerTable)
        .set({ state: "half_open" })
        .where(eq(circuitBreakerTable.sourceName, sourceName));
      return false;
    }
    return false;
  } catch {
    return false; // fail open if DB error
  }
}

export async function recordSuccess(sourceName: string): Promise<void> {
  try {
    await db
      .insert(circuitBreakerTable)
      .values({
        sourceName,
        state: "closed",
        failureCount: 0,
        lastSuccessAt: new Date(),
        openUntil: null,
      })
      .onConflictDoUpdate({
        target: circuitBreakerTable.sourceName,
        set: {
          state: "closed",
          failureCount: 0,
          lastSuccessAt: new Date(),
          openUntil: null,
        },
      });
  } catch (err) {
    logger.warn({ err, sourceName }, "cache.service: failed to record circuit success");
  }
}

export async function recordFailure(sourceName: string): Promise<void> {
  try {
    const [cb] = await db
      .select()
      .from(circuitBreakerTable)
      .where(eq(circuitBreakerTable.sourceName, sourceName));

    const newCount = (cb?.failureCount ?? 0) + 1;
    const shouldOpen = newCount >= FAILURE_THRESHOLD;
    const openUntil = shouldOpen ? new Date(Date.now() + OPEN_DURATION_MS) : null;

    if (shouldOpen) {
      logger.warn({ sourceName, newCount }, "cache.service: circuit OPENED after repeated failures");
    }

    await db
      .insert(circuitBreakerTable)
      .values({
        sourceName,
        state: shouldOpen ? "open" : "closed",
        failureCount: newCount,
        lastFailureAt: new Date(),
        openUntil,
      })
      .onConflictDoUpdate({
        target: circuitBreakerTable.sourceName,
        set: {
          state: shouldOpen ? "open" : (cb?.state ?? "closed"),
          failureCount: newCount,
          lastFailureAt: new Date(),
          openUntil,
        },
      });
  } catch (err) {
    logger.warn({ err, sourceName }, "cache.service: failed to record circuit failure");
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export async function getCache<T>(cacheKey: string): Promise<T | null> {
  try {
    const [entry] = await db
      .select()
      .from(externalCacheTable)
      .where(
        and(
          eq(externalCacheTable.cacheKey, cacheKey),
          eq(externalCacheTable.isValid, true),
          gte(externalCacheTable.expiresAt, new Date()),
        ),
      );

    if (!entry) return null;
    return JSON.parse(entry.dataJson) as T;
  } catch (err) {
    logger.warn({ err, cacheKey }, "cache.service: getCache failed");
    return null;
  }
}

export async function getLastCache<T>(cacheKey: string): Promise<T | null> {
  try {
    const [entry] = await db
      .select()
      .from(externalCacheTable)
      .where(
        and(
          eq(externalCacheTable.cacheKey, cacheKey),
          eq(externalCacheTable.isValid, true),
        ),
      );
    if (!entry) return null;
    return JSON.parse(entry.dataJson) as T;
  } catch {
    return null;
  }
}

export async function setCache(
  cacheKey: string,
  sourceName: string,
  data: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db
      .insert(externalCacheTable)
      .values({
        cacheKey,
        sourceName,
        dataJson: JSON.stringify(data),
        fetchedAt: new Date(),
        expiresAt,
        isValid: true,
      })
      .onConflictDoUpdate({
        target: externalCacheTable.cacheKey,
        set: {
          dataJson: JSON.stringify(data),
          fetchedAt: new Date(),
          expiresAt,
          isValid: true,
        },
      });
  } catch (err) {
    logger.warn({ err, cacheKey }, "cache.service: setCache failed");
  }
}

export async function invalidateCache(cacheKey: string): Promise<void> {
  try {
    await db
      .update(externalCacheTable)
      .set({ isValid: false })
      .where(eq(externalCacheTable.cacheKey, cacheKey));
  } catch (err) {
    logger.warn({ err, cacheKey }, "cache.service: invalidateCache failed");
  }
}

// ── withCache: main helper ────────────────────────────────────────────────────
// Usage: const data = await withCache("currency:blue", "DolarAPI", 1800, fetchFn);

export async function withCache<T>(
  cacheKey: string,
  sourceName: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<{ data: T; source: "live" | "cache" }> {
  // 1. Check if circuit is open → use cache immediately
  const open = await isCircuitOpen(sourceName);
  if (open) {
    logger.warn({ sourceName, cacheKey }, "cache.service: circuit open, using stale cache");
    const stale = await getLastCache<T>(cacheKey);
    if (stale !== null) return { data: stale, source: "cache" };
    throw new Error(`Circuit open for ${sourceName} and no cache available`);
  }

  // 2. Try fresh cache
  const cached = await getCache<T>(cacheKey);
  if (cached !== null) return { data: cached, source: "cache" };

  // 3. Fetch fresh data
  try {
    const data = await fetchFn();
    await setCache(cacheKey, sourceName, data, ttlSeconds);
    await recordSuccess(sourceName);
    return { data, source: "live" };
  } catch (err) {
    await recordFailure(sourceName);
    // Fallback to last valid cache (even if expired)
    const stale = await getLastCache<T>(cacheKey);
    if (stale !== null) {
      logger.warn({ sourceName, cacheKey }, "cache.service: fetch failed, using stale cache as fallback");
      return { data: stale, source: "cache" };
    }
    throw err;
  }
}
