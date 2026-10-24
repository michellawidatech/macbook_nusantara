/**
 * The thread lease — one worker per customer, many customers at once.
 *
 * Chatbot v2 (docs/chatbot-v2-design.md §3): the draft pass answers several
 * threads in parallel, and more than one worker process may be running (a
 * deploy overlaps the old and the new for a moment). Two answers to one
 * customer is the failure this exists to prevent; mixing two customers'
 * context is prevented by everything being read per `from`, and the lease is
 * what makes "per `from`" mean one holder at a time.
 *
 * The claim is ONE statement: insert the thread's memory row holding the
 * lease, or take the lease on the existing row only if nobody holds an
 * unexpired one. `RETURNING` says whether this caller won. No transaction is
 * held across the model call — the lease is a row with an expiry, so a worker
 * that dies mid-turn frees its threads by the clock rather than by anybody
 * noticing.
 *
 * The compare-and-swap at commit (draft.ts `BatchRaceError`) stays. The lease
 * stops the second model call from being made at all; the CAS still guarantees
 * that a staff reply beats a stale draft.
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma, type PrismaClient } from "@nusantara/db";

/**
 * Long enough for a turn — a quiet window has already passed, then up to four
 * model round trips and a transaction — and short enough that a crashed
 * worker's customers wait two minutes, not an afternoon.
 */
export const LEASE_MS = 120_000;

/** This process's name on a lease: readable in a query, unique per start. */
export function leaseHolder(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/**
 * Take the thread, or learn that somebody else has it.
 *
 * Every column the INSERT names is one the agent role may insert (migration
 * 20260820002832 and 20261014120000); `summaryTurns` and `clarifyCount` are
 * NOT NULL with no default, which is why they are spelled out as 0, exactly as
 * `saveSummary` does. The `::timestamptz AT TIME ZONE 'UTC'` casts are the
 * CLAUDE.md rule for binding a JS Date against a `timestamp` column.
 */
export async function claimThread(
  db: PrismaClient,
  from: string,
  holder: string,
  now: Date,
  leaseMs: number = LEASE_MS,
): Promise<boolean> {
  const until = new Date(now.getTime() + leaseMs);
  const rows = await db.$queryRaw<{ from: string }[]>(Prisma.sql`
    INSERT INTO "WaThreadMemory"
      ("id", "from", "summaryTurns", "clarifyCount", "updatedAt",
       "leaseUntil", "leasedBy")
    VALUES
      (${randomUUID()}, ${from}, 0, 0,
       (${now}::timestamptz AT TIME ZONE 'UTC'),
       (${until}::timestamptz AT TIME ZONE 'UTC'), ${holder})
    ON CONFLICT ("from") DO UPDATE
       SET "leaseUntil" = EXCLUDED."leaseUntil",
           "leasedBy"   = EXCLUDED."leasedBy"
     WHERE "WaThreadMemory"."leaseUntil" IS NULL
        OR "WaThreadMemory"."leaseUntil" <= (${now}::timestamptz AT TIME ZONE 'UTC')
        OR "WaThreadMemory"."leasedBy" = ${holder}
    RETURNING "from"
  `);
  return rows.length === 1;
}

/**
 * Give the thread back. Scoped to the holder, so a worker whose lease had
 * already expired and been taken over cannot release the new holder's claim.
 * Best effort: a failed release costs one lease period, never correctness.
 */
export async function releaseThread(
  db: PrismaClient,
  from: string,
  holder: string,
): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    UPDATE "WaThreadMemory"
       SET "leaseUntil" = NULL, "leasedBy" = NULL
     WHERE "from" = ${from} AND "leasedBy" = ${holder}
  `);
}

/**
 * Run `work` over `items` with at most `limit` in flight. Order of completion
 * is not order of input; the caller counts results, it does not index them.
 */
export async function inPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const item = items[next]!;
        next += 1;
        await work(item);
      }
    },
  );
  await Promise.all(lanes);
}
