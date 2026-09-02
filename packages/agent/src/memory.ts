/**
 * The per-thread note, and the column ownership that keeps it honest.
 *
 * `WaThreadMemory` has two writers with disjoint columns. The agent owns
 * `summary`, `summaryAt`, `summaryTurns`, `coveredThrough*`, `clarify*` and
 * `customerId`. Staff own `directive`, `directiveAt` and `directiveById` — the
 * standing instruction a colleague leaves about a customer ("kasih diskon 200rb
 * kalau nawar"). Postgres enforces the split with column-level grants, which is
 * what makes "the agent can never overwrite a staff note" structural rather
 * than conventional (08 §7).
 *
 * Two things that make the enforcement less complete than it looks, and are the
 * reason this module names its columns explicitly rather than spreading an
 * object:
 *
 *  1. **The grants only bite when a process actually connects as
 *     `nusantara_agent`.** Every DSN in this build is still the owner role,
 *     which bypasses them. So today the guarantee is this file.
 *  2. **`INSERT` is granted table-wide, not per column.** The `REVOKE UPDATE` /
 *     `GRANT UPDATE (…)` pair covers the update path only, so the database
 *     would happily accept a `directive` on the CREATE branch of an upsert.
 *     Neither branch below names one.
 *
 * Nothing here throws. A summary is a nicety; a reply is not. A failed note must
 * never turn a delivered message into a retried one, so every function returns
 * a boolean and the caller carries on.
 */

import type { PrismaClient } from "@nusantara/db";

export interface ThreadMemory {
  readonly from: string;
  /** Agent-owned. */
  readonly summary: string | null;
  /**
   * When the summariser last RAN for this thread, successfully or not.
   *
   * Deliberately an attempt clock rather than a success clock: the pass orders
   * candidates by it, so a thread whose refresh keeps failing sorts to the back
   * instead of heading the queue forever and starving every other thread. What
   * it actually managed to store is `summary` and `coveredThrough*`.
   */
  readonly summaryAt: Date | null;
  readonly summaryTurns: number;
  readonly coveredThroughAt: Date | null;
  readonly coveredThroughId: string | null;
  /** Staff-owned. Read here, never written here. */
  readonly directive: string | null;
}

export function emptyThreadMemory(from: string): ThreadMemory {
  return {
    from,
    summary: null,
    summaryAt: null,
    summaryTurns: 0,
    coveredThroughAt: null,
    coveredThroughId: null,
    directive: null,
  };
}

/** The thread's note, or an empty one. Never throws. */
export async function loadThreadMemory(
  db: PrismaClient,
  from: string,
): Promise<ThreadMemory> {
  try {
    const row = await db.waThreadMemory.findUnique({
      where: { from },
      select: {
        summary: true,
        summaryAt: true,
        summaryTurns: true,
        coveredThroughAt: true,
        coveredThroughId: true,
        directive: true,
      },
    });
    return row ? { from, ...row } : emptyThreadMemory(from);
  } catch {
    return emptyThreadMemory(from);
  }
}

export interface SummaryUpdate {
  /** `null` means the model found nothing worth keeping. */
  readonly summary: string | null;
  readonly turns: number;
  readonly coveredThroughAt: Date;
  readonly coveredThroughId: string;
}

/**
 * Store a refreshed note and advance the cursor.
 *
 * Every column named below is one the agent role is granted. `directive`,
 * `directiveAt` and `directiveById` appear in neither branch — on the update
 * side the database would refuse them, and on the create side it would not,
 * which is exactly why they are absent from both rather than from one.
 */
export async function saveSummary(
  db: PrismaClient,
  from: string,
  update: SummaryUpdate,
  now: Date,
): Promise<boolean> {
  try {
    await db.waThreadMemory.upsert({
      where: { from },
      update: {
        summary: update.summary,
        summaryAt: now,
        summaryTurns: update.turns,
        coveredThroughAt: update.coveredThroughAt,
        coveredThroughId: update.coveredThroughId,
        updatedAt: now,
      },
      create: {
        from,
        summary: update.summary,
        summaryAt: now,
        summaryTurns: update.turns,
        coveredThroughAt: update.coveredThroughAt,
        coveredThroughId: update.coveredThroughId,
        // Required, and not defaulted anywhere in this schema.
        clarifyCount: 0,
        updatedAt: now,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record that we tried and failed.
 *
 * The cursor deliberately does not move, so the uncovered turns stay uncovered
 * and the next tick picks them up again. Writing `summaryAt` is what stops the
 * failing thread from sorting to the front of the queue forever.
 */
export async function markSummaryAttempt(
  db: PrismaClient,
  from: string,
  now: Date,
): Promise<boolean> {
  try {
    await db.waThreadMemory.upsert({
      where: { from },
      update: { summaryAt: now, updatedAt: now },
      create: {
        from,
        summaryAt: now,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: now,
      },
    });
    return true;
  } catch {
    return false;
  }
}
