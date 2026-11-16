/**
 * The Instagram send pass (2026-11-16) — the outbox's `IG_*` rows onto the
 * Instagram Graph API, the way `send.ts` drains WhatsApp's.
 *
 * Same two rules as send.ts: a throw reaches `markOutboxFailed` (the capped
 * backoff), and nothing is marked SENT that was not sent. It claims ONLY the
 * Instagram kinds (`claimOutbox(…, { only })`), and the WhatsApp pass claims
 * everything else, so a shop with one channel configured never burns the
 * other's attempts. Without `IG_ACCESS_TOKEN` + `IG_USER_ID` it claims nothing.
 *
 * - `IG_DM` — text, cut at natural breaks into messages of ≤ 1000 bytes;
 *   which parts went is written onto the row as they go, so a retry after a
 *   failure halfway sends only the rest.
 * - `IG_IMAGE` — Instagram fetches a picture from a URL. The worker writes a
 *   fresh random token onto the row, then hands Graph
 *   `IG_MEDIA_PUBLIC_URL/<row>/<token>`, which the webhook serves (media.ts).
 * - `IG_REPLY` / `IG_PRIVATE_REPLY` / `IG_HIDE` — a comment's public reply,
 *   its one private DM, hide/show.
 *
 * Instagram's window: a reply older than 24 h is failed at once — unless it
 * carries the HUMAN_AGENT tag a staff reply gets between 24 h and 7 days.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  claimOutbox,
  INSTAGRAM_OUTBOX_KINDS,
  markOutboxFailed,
  markOutboxSent,
  type OutboxRow,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  IG_HUMAN_AGENT_MS,
  IG_WINDOW_MS,
  igsidOf,
  splitForInstagram,
} from "@nusantara/domain";
import {
  canSendInstagram,
  privateReply,
  replyToComment,
  sendImageUrl,
  sendText,
  setCommentHidden,
} from "@nusantara/instagram";
import type { InstagramConfig } from "./config.js";
import { currentCredentials, type IgTokenState } from "./igSync.js";

const igTo = z
  .string()
  .trim()
  .regex(/^ig:\d{5,32}$/);
const tag = z.literal("HUMAN_AGENT").optional();

const dmPayload = z.object({
  to: igTo,
  body: z.string().trim().min(1),
  tag,
  sentParts: z.number().int().min(0).optional(),
  firstMessageId: z.string().optional(),
});

const imagePayload = z
  .object({
    to: igTo,
    photoId: z.string().trim().min(1).optional(),
    chatMediaId: z.string().trim().min(1).optional(),
    caption: z.string().trim().optional(),
    tag,
    mediaToken: z.string().optional(),
  })
  .refine((p) => (p.photoId === undefined) !== (p.chatMediaId === undefined), {
    message: "an IG_IMAGE names exactly one of photoId and chatMediaId",
  });

const commentPayload = z.object({
  commentId: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const hidePayload = z.object({
  commentId: z.string().trim().min(1),
  hidden: z.boolean(),
});

export interface IgSendDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly instagram: InstagramConfig;
  readonly maxSendsPerTick: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** The token in use now — shared with the sync pass, which refreshes it. */
  readonly tokenState?: IgTokenState;
  /** The picture token. Injectable so a test can know the URL. */
  readonly pictureToken?: () => string;
}

export interface IgSendResult {
  readonly sent: number;
  readonly failed: number;
  readonly dormant: boolean;
}

/** A permanent failure: the same row would fail the same way six times. */
class Unsendable extends Error {}

export async function igSendPass(deps: IgSendDeps): Promise<IgSendResult> {
  const { db, logger, instagram } = deps;
  const now = deps.now ?? (() => new Date());
  if (!canSendInstagram(currentCredentials(instagram, deps.tokenState)))
    return { sent: 0, failed: 0, dormant: true };

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < deps.maxSendsPerTick; i += 1) {
    const row = await claimOutbox(db, now(), { only: INSTAGRAM_OUTBOX_KINDS });
    if (!row) break;
    try {
      const messageId = await sendOne(deps, row, now());
      await markOutboxSent(db, row.id, now(), messageId);
      sent += 1;
      logger.info(
        { evt: "worker.ig.sent", ctx: { outboxId: row.id, kind: row.kind } },
        "sent to Instagram",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof Unsendable;
      const status = await markOutboxFailed(db, row, message, {
        now: now(),
        ...(permanent ? { maxAttempts: 0 } : {}),
      });
      failed += 1;
      logger[status === "FAILED" ? "error" : "warn"](
        {
          evt: status === "FAILED" ? "worker.ig.exhausted" : "worker.ig.retry",
          ctx: { outboxId: row.id, kind: row.kind, attempts: row.attempts },
          err: { message },
        },
        status === "FAILED"
          ? "an Instagram send will not be retried"
          : "an Instagram send failed and will be retried",
      );
    }
  }
  return { sent, failed, dormant: false };
}

function parse<T>(schema: z.ZodType<T>, row: OutboxRow): T {
  const p = schema.safeParse(row.payload);
  if (!p.success) throw new Unsendable(`malformed ${row.kind} payload`);
  return p.data;
}

/** Inside Instagram's window: 24 h, or 7 days for a tagged staff reply. */
function checkWindow(row: OutboxRow, tagged: boolean, now: Date): void {
  const age = now.getTime() - row.createdAt.getTime();
  if (age > (tagged ? IG_HUMAN_AGENT_MS : IG_WINDOW_MS))
    throw new Unsendable(
      tagged
        ? "Instagram's 7-day window closed before this reply could be sent"
        : "Instagram's 24-hour window closed before this could be sent",
    );
}

async function sendOne(
  deps: IgSendDeps,
  row: OutboxRow,
  now: Date,
): Promise<string | null> {
  const { db, instagram } = deps;
  const credentials = currentCredentials(instagram, deps.tokenState);
  const io = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};

  switch (row.kind) {
    case "IG_DM": {
      const p = parse(dmPayload, row);
      checkWindow(row, p.tag !== undefined, now);
      const igsid = igsidOf(p.to)!;
      const parts = splitForInstagram(p.body);
      let first = p.firstMessageId ?? null;
      for (let n = p.sentParts ?? 0; n < parts.length; n += 1) {
        const r = await sendText({
          credentials,
          igsid,
          text: parts[n]!,
          ...(p.tag ? { tag: p.tag } : {}),
          ...io,
        });
        first = first ?? r.messageId;
        // Progress on the row, so a retry sends only what is left.
        await db.outbox.update({
          where: { id: row.id },
          data: {
            payload: {
              ...(row.payload as object),
              sentParts: n + 1,
              ...(first ? { firstMessageId: first } : {}),
            },
          },
        });
      }
      return first;
    }
    case "IG_IMAGE": {
      const p = parse(imagePayload, row);
      checkWindow(row, p.tag !== undefined, now);
      if (!instagram.mediaPublicUrl)
        throw new Unsendable(
          "IG_MEDIA_PUBLIC_URL is not set — Instagram can only fetch a picture from a public URL",
        );
      const token =
        p.mediaToken ??
        (deps.pictureToken ?? (() => randomBytes(32).toString("base64url")))();
      if (!p.mediaToken)
        await db.outbox.update({
          where: { id: row.id },
          data: {
            payload: { ...(row.payload as object), mediaToken: token },
          },
        });
      const igsid = igsidOf(p.to)!;
      const r = await sendImageUrl({
        credentials,
        igsid,
        url: `${instagram.mediaPublicUrl}/${row.id}/${token}`,
        ...(p.tag ? { tag: p.tag } : {}),
        ...io,
      });
      // Instagram's picture message has no caption: the line goes after it.
      if (p.caption)
        await sendText({
          credentials,
          igsid,
          text: splitForInstagram(p.caption)[0]!,
          ...(p.tag ? { tag: p.tag } : {}),
          ...io,
        });
      return r.messageId;
    }
    case "IG_REPLY": {
      const p = parse(commentPayload, row);
      const r = await replyToComment({
        credentials,
        commentId: p.commentId,
        text: p.body,
        ...io,
      });
      if (r.commentId)
        await db.igComment.updateMany({
          where: { igCommentId: p.commentId },
          data: { replyCommentId: r.commentId },
        });
      return r.commentId;
    }
    case "IG_PRIVATE_REPLY": {
      const p = parse(commentPayload, row);
      const r = await privateReply({
        credentials,
        commentId: p.commentId,
        text: splitForInstagram(p.body)[0]!,
        ...io,
      });
      return r.messageId;
    }
    case "IG_HIDE": {
      const p = parse(hidePayload, row);
      await setCommentHidden({
        credentials,
        commentId: p.commentId,
        hidden: p.hidden,
        ...io,
      });
      return null;
    }
    default:
      throw new Unsendable(`the Instagram pass cannot send ${row.kind}`);
  }
}
