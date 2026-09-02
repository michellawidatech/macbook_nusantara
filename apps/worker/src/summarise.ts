/**
 * The summary pass — keeping each thread's note current.
 *
 * Runs third in the tick, after drafting and after sending, so a customer never
 * waits on it. It is a separate pass rather than a tail call on `draftPass` for
 * three reasons: a thread answered by a *human* through the inbox is a turn too
 * and must be summarised; "the conversation went quiet" is a time trigger that
 * no reply event can fire; and an independent pass fails independently, so a
 * summariser fault can never turn a delivered reply into a failed run.
 *
 * ## Scheduling is cursor-based, not counter-based
 *
 * `WaThreadMemory.coveredThroughAt` records the `answeredAt` of the newest turn
 * already folded in, so "turns since the last refresh" is a COUNT the database
 * answers. There is no counter to drift, and a refresh that fails simply leaves
 * the cursor where it was and gets retried.
 *
 * The cursor is `answeredAt` and never `ts`: `answeredAt` is our own clock in
 * milliseconds, while `ts` is Meta's unix SECONDS and ties across a fast burst.
 * A cursor on a tying column skips rows.
 *
 * ## Oldest first, and why that is not the obvious choice
 *
 * Turns are read oldest-first and the cursor lands on the LAST row consumed.
 * Reading newest-first — which is what the previous build did — means that after
 * an outage leaves thirty uncovered turns, the newest twelve are summarised and
 * the cursor jumps past the other eighteen, which are then never folded in at
 * all. Oldest-first drains the backlog over three ticks instead of losing more
 * than half of it.
 */

import {
  SUMMARY_INPUT_LIMIT,
  hasCredential,
  anthropicClient,
  markSummaryAttempt,
  saveSummary,
  summarize,
  type AgentClient,
  type AnthropicEnv,
} from "@nusantara/agent";
import { Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

export interface SummaryDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly anthropic: AnthropicEnv;
  /** Injectable so a test can script the model without mocking a module. */
  readonly client?: AgentClient;
  /** Refresh once this many answered turns have piled up. */
  readonly everyTurns: number;
  /** Or once the thread has been quiet this long with turns still uncovered. */
  readonly quietMs: number;
  readonly maxPerTick: number;
  readonly inputLimit?: number;
  readonly now?: () => Date;
}

export interface SummaryPassResult {
  readonly refreshed: number;
  readonly failed: number;
  readonly dormant: boolean;
}

interface SummaryCandidate {
  readonly from: string;
  readonly uncovered: number;
}

/**
 * Threads whose note is out of date.
 *
 * Both triggers in one statement: enough turns have piled up, OR the
 * conversation has gone quiet with turns still uncovered. The second is what
 * catches a thread that ends after two exchanges and would otherwise never be
 * summarised at all.
 *
 * The ordering is the fairness mechanism. A thread whose refresh keeps failing
 * keeps its cursor, so its uncovered count only grows — ordered by that, it
 * would head the queue forever and starve every other thread, burning the tick
 * budget every two seconds. `summaryAt` is written on every attempt, success or
 * failure, so ordering by it sends a failing thread to the back and lets the
 * queue cycle. No in-memory cooldown, nothing to lose on a restart.
 *
 * `COUNT(*)::int` because a bare `COUNT(*)` comes back from Postgres as a
 * BigInt, and Prisma hands it straight through.
 */
async function summaryCandidates(
  db: PrismaClient,
  everyTurns: number,
  quietCutoff: Date,
  limit: number,
): Promise<SummaryCandidate[]> {
  return db.$queryRaw<SummaryCandidate[]>(Prisma.sql`
    SELECT m."from",
           COUNT(*)::int AS "uncovered"
      FROM "WaMessage" m
      LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
     WHERE m."direction"  = 'IN'
       AND m."replyText"  IS NOT NULL
       AND m."answeredAt" IS NOT NULL
       AND (t."coveredThroughAt" IS NULL
            OR m."answeredAt" > t."coveredThroughAt")
     GROUP BY m."from", t."summaryAt"
    HAVING COUNT(*) >= ${everyTurns}
        OR MAX(m."answeredAt")
             <= (${quietCutoff}::timestamptz AT TIME ZONE 'UTC')
     ORDER BY COALESCE(t."summaryAt", '-infinity'::timestamp) ASC,
              MAX(m."answeredAt") ASC
     LIMIT ${limit}
  `);
}

export async function summaryPass(
  deps: SummaryDeps,
): Promise<SummaryPassResult> {
  const { db, logger, anthropic } = deps;
  const now = deps.now ?? (() => new Date());
  const inputLimit = deps.inputLimit ?? SUMMARY_INPUT_LIMIT;

  const client =
    deps.client ?? (hasCredential(anthropic) ? anthropicClient(anthropic) : null);
  if (!client) return { refreshed: 0, failed: 0, dormant: true };

  const at = now();
  const candidates = await summaryCandidates(
    db,
    deps.everyTurns,
    new Date(at.getTime() - deps.quietMs),
    deps.maxPerTick,
  );
  if (candidates.length === 0)
    return { refreshed: 0, failed: 0, dormant: false };

  let refreshed = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const from = candidate.from;
    try {
      const memo = await db.waThreadMemory.findUnique({
        where: { from },
        select: { summary: true, coveredThroughAt: true },
      });

      const rows = await db.waMessage.findMany({
        where: {
          from,
          direction: "IN",
          replyText: { not: null },
          answeredAt: memo?.coveredThroughAt
            ? { gt: memo.coveredThroughAt }
            : { not: null },
        },
        // Oldest first, so the cursor lands on the last row we actually read
        // and no turn is ever jumped over. `id` breaks the tie.
        orderBy: [{ answeredAt: "asc" }, { id: "asc" }],
        take: inputLimit,
        select: { id: true, text: true, replyText: true, answeredAt: true },
      });
      if (rows.length === 0) continue;

      const newest = rows[rows.length - 1]!;
      if (!newest.answeredAt) continue;

      let failure: unknown;
      const summary = await summarize({
        client,
        previous: memo?.summary ?? null,
        turns: rows,
        onError: (err) => {
          failure = err;
        },
      });

      if (summary === null) {
        // Failed. Record the attempt and nothing else: the cursor stays, the
        // uncovered count keeps growing, and the next tick tries again.
        await markSummaryAttempt(db, from, at);
        failed += 1;
        logger.warn(
          {
            evt: "worker.summary.failed",
            ctx: { from, uncovered: candidate.uncovered },
            ...(failure instanceof Error
              ? { err: { name: failure.name, message: failure.message } }
              : {}),
          },
          "could not refresh a thread summary — leaving the cursor for the next tick",
        );
        continue;
      }

      // `""` means the model found nothing worth keeping. Store null, but still
      // advance the cursor, or every later turn re-summarises the same empty
      // conversation forever at one model call each.
      const ok = await saveSummary(
        db,
        from,
        {
          summary: summary || null,
          turns: rows.length,
          coveredThroughAt: newest.answeredAt,
          coveredThroughId: newest.id,
        },
        at,
      );
      if (!ok) {
        failed += 1;
        continue;
      }

      refreshed += 1;
      logger.info(
        {
          evt: "worker.summary.refreshed",
          ctx: { from, turns: rows.length, kept: Boolean(summary) },
        },
        "refreshed a thread summary",
      );
    } catch (err) {
      // One bad thread must not stop the pass, and must not stop a reply.
      failed += 1;
      logger.error(
        {
          evt: "worker.summary.error",
          ctx: { from },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "failed to summarise a thread",
      );
    }
  }

  return { refreshed, failed, dormant: false };
}
