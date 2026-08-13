/**
 * DB-backed cache for the agent's categorization *decision* (never live data).
 *
 * Keyed by `sha256(kind + normalizedQuestion)` so trivial phrasing/whitespace
 * variants collapse onto one row. We cache only the routing decision — stock and
 * price are always re-queried live by the tools — so a cache hit can never serve
 * stale inventory. Expired rows are treated as a miss and pruned opportunistically.
 */

import { prisma } from "@nusantara/db";
import { cacheKeyFor } from "@nusantara/domain/agent";

/**
 * Read a cached value for `(kind, normalizedQ)`, or `null` on miss/expiry.
 * A live hit increments the row's `hits` counter (best-effort).
 */
export async function cacheGet(kind: string, normalizedQ: string): Promise<unknown | null> {
  const key = cacheKeyFor(kind, normalizedQ);
  const row = await prisma.agentCache.findUnique({ where: { key } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    try {
      await prisma.agentCache.delete({ where: { key } });
    } catch {
      // lost a race with another expiry-prune; the miss stands.
    }
    return null;
  }
  try {
    await prisma.agentCache.update({ where: { key }, data: { hits: { increment: 1 } } });
  } catch {
    // hit-counter bump is best-effort; never fail a cache read over it.
  }
  return row.value;
}

/**
 * Upsert a cached value with a TTL (seconds). Re-caching the same question
 * refreshes the value and expiry rather than creating a duplicate.
 */
export async function cacheSet(
  kind: string,
  normalizedQ: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const key = cacheKeyFor(kind, normalizedQ);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const data = { value: value as object, expiresAt };
  await prisma.agentCache.upsert({
    where: { key },
    create: { key, kind, ...data },
    update: data,
  });
}
