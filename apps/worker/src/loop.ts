/**
 * The tick — a send pass, a draft pass, then a send pass again, forever.
 *
 * Draft before the second send, deliberately: a reply drafted this tick is
 * sent in the same tick rather than waiting for the next one, which is the
 * difference between a customer waiting two seconds and four.
 *
 * And a send FIRST (2026-10-23): what is already queued — a staff reply, the
 * photos somebody attached — owes nothing to the bot and must never wait
 * behind its draft. On the Mac mini a model call that hung held the whole
 * tick, and fourteen outbox rows sat at zero attempts behind it.
 *
 * The loop is a `setTimeout` chain rather than a `setInterval`. An interval
 * fires on a wall clock and will happily start a second tick while the first is
 * still waiting on the Graph API; chaining the next delay off the end of the
 * previous tick makes overlap impossible without a lock.
 */

import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import type { WorkerConfig } from "./config.js";
import { draftPass } from "./draft.js";
import { sendPass } from "./send.js";
import { expirePass } from "./expire.js";
import { summaryPass } from "./summarise.js";
import { memoryPass } from "./memoryPass.js";

export interface TickDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly config: WorkerConfig;
  readonly fetchImpl?: typeof fetch;
}

export interface TickResult {
  readonly drafted: number;
  readonly escalated: number;
  readonly sent: number;
  readonly failed: number;
  readonly summarised: number;
  /** Answered turns written into chat memory, and chunks embedded. */
  readonly chunked: number;
  readonly embedded: number;
  /** Agent bookings nobody came for, released back into stock. */
  readonly expired: number;
}

/** One pass of each. Exported so a test — or the CLI — can run exactly one. */
export async function tick(deps: TickDeps): Promise<TickResult> {
  const { db, logger, config } = deps;

  const sendDeps = {
    db,
    logger,
    credentials: config.whatsapp,
    maxSendsPerTick: config.maxSendsPerTick,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  };
  const queued = await sendPass(sendDeps);

  const draft = await draftPass({
    db,
    logger,
    anthropic: config.anthropic,
    waits: config.waits,
    maxDraftsPerTick: config.maxDraftsPerTick,
    concurrency: config.draftConcurrency,
    // The real fetch, deliberately not `deps.fetchImpl`: that one answers for
    // the Graph API (tools/wa-local injects a fake there), and the agent API
    // is this machine's own POS.
    ...(config.agentApi ? { agentApi: config.agentApi } : {}),
    recall: { voyage: config.voyage },
    maxBatch: config.maxBatch,
    agentStaffId: config.agentStaffId,
    capabilities: config.capabilities,
    reservationGraceMs: config.reservationGraceMs,
  });

  const send = await sendPass(sendDeps);

  // Third, and last on purpose: the reply is already on the wire, so keeping
  // the thread's note current costs the customer nothing.
  const summary = await summaryPass({
    db,
    logger,
    anthropic: config.anthropic,
    everyTurns: config.summaryEveryTurns,
    quietMs: config.summaryQuietMs,
    maxPerTick: config.maxSummariesPerTick,
    ...(config.anthropic.summaryModel
      ? { model: config.anthropic.summaryModel }
      : {}),
  });

  // Recall's store, after the summary for the same reason: off the
  // customer's clock, and failing on its own (memoryPass.ts).
  const memory = await memoryPass({
    db,
    logger,
    voyage: config.voyage,
    maxTurns: config.memoryTurnsPerTick,
    maxEmbeds: config.memoryEmbedsPerTick,
  });

  // Last. A held unit that nobody came for is costing the shop a sale right
  // now, but not as urgently as an unanswered customer.
  const expiry = await expirePass({
    db,
    logger,
    agentStaffId: config.agentStaffId,
    graceMs: config.reservationGraceMs,
    ttlMs: config.reservationTtlMs,
    maxPerTick: config.maxExpiriesPerTick,
  });

  return {
    drafted: draft.drafted,
    escalated: draft.escalated,
    sent: queued.sent + send.sent,
    failed: queued.failed + send.failed,
    summarised: summary.refreshed,
    chunked: memory.chunked,
    embedded: memory.embedded,
    expired: expiry.expired,
  };
}

export interface RunOptions extends TickDeps {
  /** Resolves when the loop should stop. */
  readonly stop: Promise<void>;
}

/**
 * Run until `stop` resolves.
 *
 * A tick that throws is logged and the loop continues. The worker is the only
 * thing answering customers; a transient database blip must not take it down
 * and leave the queue unattended until somebody notices.
 */
export async function run(options: RunOptions): Promise<void> {
  const { logger, config } = options;
  let stopped = false;
  /** Resolved by the stop promise, so an idle sleep is cut short on SIGTERM. */
  let wake: () => void = () => {};
  void options.stop.then(() => {
    stopped = true;
    wake();
  });

  while (!stopped) {
    let busy = false;
    try {
      const result = await tick(options);
      // A summary backlog counts as busy, so it drains at API speed rather
      // than one thread every poll interval.
      busy = result.drafted > 0 || result.sent > 0 || result.summarised > 0;
      if (busy || result.escalated > 0 || result.failed > 0) {
        logger.info({ evt: "worker.tick", ctx: { ...result } }, "worker tick");
      }
    } catch (err) {
      logger.error(
        {
          evt: "worker.tick.failed",
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "a worker tick failed — continuing",
      );
    }

    if (stopped) break;
    // A busy tick loops straight back: a queue with work in it should drain at
    // the speed of the API, not of the poll interval.
    if (!busy) {
      // The timer is deliberately NOT unref'd. An idle worker holds nothing
      // else open, so an unref'd poll would let the process exit quietly the
      // first time the queue emptied — a worker that stops answering customers
      // whenever it catches up is worse than one that never started.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.idlePollMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = () => {};
    }
  }
}
