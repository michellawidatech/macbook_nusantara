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
  sendImage,
  sendText,
  uploadMedia,
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

/**
 * A WA_IMAGE intent: one photograph of one unit (owner ask 2026-09-21), or a
 * picture staff sent from their own device (owner ask 2026-10-27).
 *
 * It names a `UnitNotePhoto` (`photoId`) or a `ChatMedia` (`chatMediaId`) —
 * exactly one — and carries no bytes. Reading them at SEND time rather than at
 * draft time is what keeps the transaction that decided to send a picture from
 * carrying a megabyte of it, and it is what makes the queue readable: an
 * outbox row is an intent, and an intent with an image inlined into a JSON
 * column is a blob store nobody meant to build.
 */
const waImagePayload = z
  .object({
    to: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/),
    photoId: z.string().trim().min(1).optional(),
    chatMediaId: z.string().trim().min(1).optional(),
    caption: z.string().trim().optional(),
    inReplyTo: z.string().trim().optional(),
  })
  .refine((p) => (p.photoId === undefined) !== (p.chatMediaId === undefined), {
    message: "a WA_IMAGE names exactly one of photoId and chatMediaId",
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
      if (row.kind === "WA_IMAGE") {
        const done = await sendPhoto(deps, row, now);
        if (done) sent += 1;
        else failed += 1;
        continue;
      }
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

      // The id is what an edit or an unsend from the inbox names later.
      await markOutboxSent(db, row.id, now(), result.waMessageId);
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

/**
 * Send one photograph of a unit: read the bytes, upload them, send the id.
 *
 * Returns true when it went, false when the row was failed — the caller only
 * needs to count. Every failure path is `markOutboxFailed`, so a photo is in
 * the same backoff as a reply and ends the same way; a throw reaches the
 * caller's catch, which is what drives the retry.
 *
 * ## Why it is two calls and not one
 *
 * Graph's image message takes `{ link }` or `{ id }`. A link would need a
 * public origin, and this deployment is a Mac mini behind Tailscale that has
 * none — so the bytes go up first and the message names the upload. The cost
 * is one extra round trip per picture, on a path that runs at most three times
 * per conversation.
 */
async function sendPhoto(
  deps: SendDeps,
  row: {
    id: string;
    kind: string;
    payload: unknown;
    createdAt: Date;
    attempts: number;
  },
  now: () => Date,
): Promise<boolean> {
  const { db, logger, credentials } = deps;
  const parsed = waImagePayload.safeParse(row.payload);
  if (!parsed.success) {
    await markOutboxFailed(db, row, "malformed WA_IMAGE payload", {
      maxAttempts: 0,
      now: now(),
    });
    logger.error(
      { evt: "worker.send.malformed", ctx: { outboxId: row.id } },
      "an outbox row carried a payload this version cannot send",
    );
    return false;
  }

  // The same 24-hour rule a reply is held to, and for the same reason: Graph
  // answers 200 and delivers nothing.
  if (now().getTime() - row.createdAt.getTime() > WINDOW_MS) {
    await markOutboxFailed(
      db,
      row,
      "the 24-hour window closed before this photo could be sent",
      { maxAttempts: 0, now: now() },
    );
    logger.warn(
      { evt: "worker.send.expired", ctx: { outboxId: row.id } },
      "a queued photo outlived the 24-hour window and was not sent",
    );
    return false;
  }

  const photo = await imageOf(db, parsed.data);
  /*
   * A photo row with no bytes is one that was LINKED rather than uploaded
   * (`UnitNotePhoto.url` with a null `data`), or one purged since it was
   * queued. There is nothing to push to Graph and nothing this side can do
   * about it, so it is exhausted at once rather than retried six times
   * against the same absent column.
   */
  if (!photo || !photo.data || photo.data.length === 0) {
    await markOutboxFailed(db, row, "the photo has no stored image", {
      maxAttempts: 0,
      now: now(),
    });
    logger.warn(
      {
        evt: "worker.send.photo_missing",
        ctx: {
          outboxId: row.id,
          ...(parsed.data.photoId ? { photoId: parsed.data.photoId } : {}),
          ...(parsed.data.chatMediaId
            ? { chatMediaId: parsed.data.chatMediaId }
            : {}),
        },
      },
      "a queued photo had no bytes to send",
    );
    return false;
  }

  const upload = await uploadMedia({
    credentials,
    data: new Uint8Array(photo.data),
    contentType: photo.contentType ?? "image/jpeg",
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  if (!upload.mediaId) {
    // Simulation mode: no credential. `sendPass` does not claim at all without
    // one, so this is unreachable in practice and is here so the branch has an
    // answer rather than a non-null assertion.
    await markOutboxFailed(db, row, "no credential to upload the photo", {
      now: now(),
    });
    return false;
  }

  const result = await sendImage({
    credentials,
    to: parsed.data.to,
    mediaId: upload.mediaId,
    ...(parsed.data.caption ? { caption: parsed.data.caption } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  await markOutboxSent(db, row.id, now(), result.waMessageId);
  logger.info(
    {
      evt: "worker.send.photo_sent",
      ctx: { outboxId: row.id, waMessageId: result.waMessageId },
    },
    parsed.data.chatMediaId ? "sent a staff picture" : "sent a unit photo",
  );
  return true;
}

/**
 * The bytes a WA_IMAGE names: a unit's QC photo, or a picture staff uploaded.
 *
 * A `ChatMedia` row is read only when it belongs to the number the row is
 * addressed to. The API writes both from one request, so they always agree;
 * a payload that names another thread's picture is a bug, and sending one
 * customer's picture to another is the one outcome worse than not sending.
 */
async function imageOf(
  db: PrismaClient,
  p: { to: string; photoId?: string; chatMediaId?: string },
): Promise<{ data: Uint8Array | null; contentType: string | null } | null> {
  if (p.photoId) {
    return db.unitNotePhoto.findUnique({
      where: { id: p.photoId },
      select: { data: true, contentType: true },
    });
  }
  if (!p.chatMediaId) return null;
  const media = await db.chatMedia.findUnique({
    where: { id: p.chatMediaId },
    select: { from: true, data: true, contentType: true },
  });
  if (!media || media.from !== p.to) return null;
  return { data: media.data, contentType: media.contentType };
}
