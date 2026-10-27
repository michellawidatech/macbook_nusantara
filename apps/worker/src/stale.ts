/**
 * The watchdog — no customer message the bot could answer waits for ever
 * (owner ask 2026-10-27: *"improve the chatbot to not get stuck"*).
 *
 * The draft pass recovers from what it can see: a model call that hangs or
 * fails (the rules answer instead), a turn past its deadline and a thread
 * that keeps throwing (the holding line). This pass is for everything it
 * cannot see — a failure count a restart forgot, a thread the candidate query
 * kept skipping, a bug nobody has found yet. It asks the database one plain
 * question: which customer messages are still BARU after `staleMs`?
 *
 * Each such thread is logged as `worker.draft.stale` WITH the reason, and:
 *
 *  - the bot is OFF for the chat, or a colleague typed a reply in it within
 *    `STAFF_ACTIVE_MS` — left alone, by design: a person has it (and /chat
 *    says so under the message). Logged once per waiting message.
 *  - the thread is leased right now — left alone: a turn is running, and its
 *    own deadline (90 s) is shorter than the lease.
 *  - anything else — the holding line and a task (`holdTheLine`), under the
 *    thread's lease so no turn can answer it at the same moment.
 *
 * Age is counted from the later of the message and this PROCESS's start: a
 * worker that comes back to a backlog gives its draft pass the same three
 * minutes to answer before anything is called stuck.
 */

import { Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { BOT_STALE_MS, STAFF_ACTIVE_MS } from "@nusantara/agent";
import {
  failuresSoFar,
  holdTheLine,
  processFailureLedger,
  staffActiveThreads,
  type FailureLedger,
} from "./draft.js";
import { claimThread, leaseHolder, releaseThread } from "./lease.js";

const PROCESS_STARTED = Date.now();

/** A thread whose newest line is younger than this is still being typed. */
const STILL_TYPING_MS = 30_000;

export interface StaleDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** How long a message may wait. Defaults to `BOT_STALE_MS` (3 min). */
  readonly staleMs?: number;
  readonly staffActiveMs?: number;
  /** Threads looked at per tick. */
  readonly maxPerTick?: number;
  /** The draft pass's failure counts, for the reason. */
  readonly failures?: FailureLedger;
  /** When this worker started; injectable so a test is not three minutes. */
  readonly startedAt?: Date;
  readonly leaseHolder?: string;
  readonly maxBatch?: number;
  readonly now?: () => Date;
}

export interface StalePassResult {
  /** Threads that got the holding line. */
  readonly rescued: number;
  /** Threads left alone because a person has them. */
  readonly withStaff: number;
}

/** Why a waiting thread was not answered — what the log line says. */
export type StaleReason =
  | "auto_reply_off"
  | "staff_active"
  | "drafting"
  | "drafting_failed"
  | "not_drafted";

/** Waiting messages already logged as "a person has it", not logged again. */
const logged = new Set<string>();

export async function stalePass(deps: StaleDeps): Promise<StalePassResult> {
  const { db, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const staleMs = deps.staleMs ?? BOT_STALE_MS;
  const started = (deps.startedAt ?? new Date(PROCESS_STARTED)).getTime();
  // Not yet up long enough for anything to be "stuck" rather than "queued".
  if (now.getTime() - started < staleMs) return { rescued: 0, withStaff: 0 };

  const cutoff = new Date(now.getTime() - staleMs);
  const threads = await db.$queryRaw<
    Array<{
      from: string;
      oldestId: string;
      oldestAt: Date;
      newestAt: Date;
      pending: number;
    }>
  >(Prisma.sql`
    SELECT "from",
           (array_agg("id" ORDER BY "ts" ASC, "id" ASC))[1] AS "oldestId",
           MIN("ts")                                       AS "oldestAt",
           MAX("ts")                                       AS "newestAt",
           COUNT(*)::int                                   AS "pending"
      FROM "WaMessage"
     WHERE "direction" = 'IN'
       AND "status" = 'BARU'
     GROUP BY "from"
    HAVING MIN("ts") <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
     ORDER BY MIN("ts") ASC
     LIMIT ${deps.maxPerTick ?? 20}
  `);
  if (threads.length === 0) return { rescued: 0, withStaff: 0 };

  const froms = threads.map((t) => t.from);
  const [memories, staff] = await Promise.all([
    db.waThreadMemory.findMany({
      where: { from: { in: froms } },
      select: { from: true, autoReply: true, leaseUntil: true },
    }),
    staffActiveThreads(
      db,
      new Date(now.getTime() - (deps.staffActiveMs ?? STAFF_ACTIVE_MS)),
      froms,
    ),
  ]);
  const memoryOf = new Map(memories.map((m) => [m.from, m]));
  const failures = deps.failures ?? processFailureLedger();
  const holder = deps.leaseHolder ?? leaseHolder();

  let rescued = 0;
  let withStaff = 0;
  for (const t of threads) {
    const memory = memoryOf.get(t.from);
    const ageMs = now.getTime() - t.oldestAt.getTime();
    const failed = failuresSoFar(failures, t.from, now);
    const reason: StaleReason =
      memory?.autoReply === false
        ? "auto_reply_off"
        : staff.has(t.from)
          ? "staff_active"
          : memory?.leaseUntil && memory.leaseUntil > now
            ? "drafting"
            : failed > 0
              ? "drafting_failed"
              : "not_drafted";
    const ctx = {
      from: t.from,
      reason,
      ageMs,
      pending: t.pending,
      ...(failed > 0 ? { failures: failed } : {}),
    };

    if (reason === "auto_reply_off" || reason === "staff_active") {
      withStaff += 1;
      if (!logged.has(t.oldestId)) {
        if (logged.size > 5_000) logged.clear();
        logged.add(t.oldestId);
        logger.info(
          { evt: "worker.draft.stale", ctx: { ...ctx, action: "left" } },
          "a customer message is waiting on a person — the bot stays out by design",
        );
      }
      continue;
    }
    if (reason === "drafting") continue;
    // Still typing: the draft pass answers the burst once it settles, and a
    // holding line in the middle of it would answer half a thought.
    if (now.getTime() - t.newestAt.getTime() < STILL_TYPING_MS) continue;

    logger.warn(
      { evt: "worker.draft.stale", ctx: { ...ctx, action: "holding_line" } },
      reason === "drafting_failed"
        ? `drafting failed ${failed} time(s) — the customer gets the holding line`
        : "a customer message was never drafted — the customer gets the holding line",
    );
    try {
      if (!(await claimThread(db, t.from, holder, now))) continue;
      try {
        const outcome = await holdTheLine(db, t.from, "stale", {
          now,
          ...(deps.maxBatch ? { maxBatch: deps.maxBatch } : {}),
        });
        if (outcome === "sent") rescued += 1;
        failures.delete(t.from);
      } finally {
        await releaseThread(db, t.from, holder).catch(() => {});
      }
    } catch (err) {
      logger.error(
        {
          evt: "worker.draft.stale_failed",
          ctx: { from: t.from },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "could not send the holding line to a waiting customer",
      );
    }
  }
  return { rescued, withStaff };
}
