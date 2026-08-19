/**
 * The tick — one draft pass, then one send pass, forever.
 *
 * Draft before send, deliberately: a reply drafted this tick is sent in the
 * same tick rather than waiting for the next one, which is the difference
 * between a customer waiting two seconds and four.
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
}

/** One pass of each. Exported so a test — or the CLI — can run exactly one. */
export async function tick(deps: TickDeps): Promise<TickResult> {
  const { db, logger, config } = deps;

  const draft = await draftPass({
    db,
    logger,
    anthropic: config.anthropic,
    debounceMs: config.debounceMs,
    maxDraftsPerTick: config.maxDraftsPerTick,
  });

  const send = await sendPass({
    db,
    logger,
    credentials: config.whatsapp,
    maxSendsPerTick: config.maxSendsPerTick,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  return {
    drafted: draft.drafted,
    escalated: draft.escalated,
    sent: send.sent,
    failed: send.failed,
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
      busy = result.drafted > 0 || result.sent > 0;
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
