/**
 * The send pass — draining the outbox onto the Graph API.
 *
 * 08 §5's second half:
 *
 *     txn: write the row + write an Outbox row  --commit-->  worker: claim → send → mark
 *
 * `claimOutbox` is the whole concurrency story (`FOR UPDATE SKIP LOCKED`), so
 * this file is only responsible for what happens between the claim and the
 * mark. Two rules govern that stretch.
 *
 * **A throw must reach `markOutboxFailed`.** That is what drives the capped
 * exponential backoff and, eventually, FAILED. A swallowed error here marks a
 * row SENT and loses a customer's reply silently, which is the exact failure the
 * outbox exists to prevent.
 *
 * **Nothing is marked SENT that was not sent.** With no credential the pass
 * does not claim at all: rows stay PENDING and flush when a token is configured
 * (06 §11's simulation mode, without the lie). The one exception is a reply
 * that has aged out of the 24-hour window while it waited — that can never
 * deliver as free-form text, so it is failed deliberately rather than retried
 * against a wall.
 */

import { z } from "zod";
import {
  claimOutbox,
  markOutboxFailed,
  markOutboxSent,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  canSend,
  sendText,
  WINDOW_MS,
  type WhatsAppCredentials,
} from "@nusantara/whatsapp";

/**
 * A WA_REPLY intent, as `draft.ts` and the inbox route write it.
 *
 * Validated rather than cast: `Outbox.payload` is one of the few sanctioned
 * JSON columns (CLAUDE.md), which means its shape is not enforced by Postgres
 * and a row written by an older version of the code can still be sitting in the
 * queue. A malformed payload is a permanent failure, not something to retry.
 */
const waReplyPayload = z.object({
  to: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/),
  body: z.string().trim().min(1),
  inReplyTo: z.string().trim().optional(),
});

export interface SendDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly credentials: WhatsAppCredentials;
  readonly maxSendsPerTick: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface SendPassResult {
  readonly sent: number;
  /** Rows that did not send this tick — both the retryable and the exhausted. */
  readonly failed: number;
  /** True when no credential is configured and nothing was claimed. */
  readonly dormant: boolean;
}

export async function sendPass(deps: SendDeps): Promise<SendPassResult> {
  const { db, logger, credentials } = deps;
  const now = deps.now ?? (() => new Date());

  // Claiming a row we cannot send would burn an attempt and start the backoff
  // against a machine that is simply not configured yet. Leave the queue alone.
  if (!canSend(credentials)) {
    return { sent: 0, failed: 0, dormant: true };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < deps.maxSendsPerTick; i += 1) {
    const row = await claimOutbox(db, now());
    if (!row) break;

    try {
      if (row.kind !== "WA_REPLY") {
        // IG_REPLY, IG_DM and ALERT have no sender yet. This retries with the
        // normal backoff and ends in FAILED, which is the right outcome: the
        // row surfaces in the queue as unsendable rather than being quietly
        // dropped or spinning forever. Implementing those senders is what
        // clears it, not a code change here.
        await markOutboxFailed(
          db,
          row,
          `no sender is implemented for ${row.kind}`,
          {
            now: now(),
          },
        );
        failed += 1;
        continue;
      }

      const parsed = waReplyPayload.safeParse(row.payload);
      if (!parsed.success) {
        // Unretryable: the same malformed payload will fail identically six
        // times. Exhaust it immediately so it lands in FAILED where somebody
        // will see it, rather than after fifteen minutes of backoff.
        // `maxAttempts: 0` exhausts it on this attempt.
        await markOutboxFailed(db, row, "malformed WA_REPLY payload", {
          maxAttempts: 0,
          now: now(),
        });
        failed += 1;
        logger.error(
          { evt: "worker.send.malformed", ctx: { outboxId: row.id } },
          "an outbox row carried a payload this version cannot send",
        );
        continue;
      }

      // Aged out while queued. Graph would answer 200 and deliver nothing
      // (06 §11), so retrying is worse than failing: it hides the problem.
      const ageMs = now().getTime() - row.createdAt.getTime();
      if (ageMs > WINDOW_MS) {
        await markOutboxFailed(
          db,
          row,
          "the 24-hour window closed before this reply could be sent",
          { maxAttempts: 0, now: now() },
        );
        failed += 1;
        logger.warn(
          { evt: "worker.send.expired", ctx: { outboxId: row.id, ageMs } },
          "a queued reply outlived the 24-hour window and was not sent",
        );
        continue;
      }

      const result = await sendText({
        credentials,
        to: parsed.data.to,
        body: parsed.data.body,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });

      await markOutboxSent(db, row.id, now());
      sent += 1;
      logger.info(
        {
          evt: "worker.send.sent",
          ctx: { outboxId: row.id, waMessageId: result.waMessageId },
        },
        "sent a WhatsApp reply",
      );
    } catch (err) {
      // Back into the backoff. `markOutboxFailed` decides retry vs FAILED from
      // the attempt count claimOutbox already incremented.
      const message = err instanceof Error ? err.message : String(err);
      const status = await markOutboxFailed(db, row, message, { now: now() });
      failed += 1;
      logger[status === "FAILED" ? "error" : "warn"](
        {
          evt:
            status === "FAILED" ? "worker.send.exhausted" : "worker.send.retry",
          ctx: { outboxId: row.id, attempts: row.attempts },
          err: { message },
        },
        status === "FAILED"
          ? "a reply exhausted its retries and will not be sent"
          : "a send failed and will be retried",
      );
    }
  }

  return { sent, failed, dormant: false };
}
