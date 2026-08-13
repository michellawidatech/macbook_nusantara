/**
 * Instagram comment ingest + auto-reply for the webhook receiver.
 *
 * Parallels persist.ts/pipeline.ts (the WhatsApp path). Meta pushes a
 * `comments` change (object `instagram`) whenever someone comments on our post;
 * we store the raw event (IgRawEvent), upsert one IgComment per comment (deduped
 * on igCommentId — Meta redelivers), and — when the IgSettings auto-reply toggle
 * is on — post the "Cek DM ya kak" public reply immediately.
 *
 * Anti-loop: our own posted reply is itself a comment and fires another webhook.
 * We drop any comment whose author is our own IG business account, so auto-reply
 * never replies to itself.
 */

import { prisma, type IgComment } from "@nusantara/db";
import { igConfig, replyToComment } from "@nusantara/instagram";
import type { WebhookPayload } from "./persist.js";

/** The `value` of an Instagram `comments` change. */
interface IgCommentValue {
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}

/** A normalized inbound IG comment, ready to persist. */
export interface InboundComment {
  igCommentId: string;
  igMediaId: string;
  fromId: string;
  fromUsername: string | null;
  text: string | null;
  parentId: string | null;
}

/**
 * Flatten an Instagram webhook payload into the comments it carries. Pure — no
 * I/O. Ignores non-`comments` change fields and comments authored by our own
 * account (the reply-loop guard).
 */
export function extractComments(payload: WebhookPayload): InboundComment[] {
  if (payload.object !== "instagram") return [];
  const out: InboundComment[] = [];
  const ownId = igConfig.businessId;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const value = (change.value ?? {}) as IgCommentValue;
      const id = value.id;
      const mediaId = value.media?.id;
      const fromId = value.from?.id;
      if (!id || !mediaId || !fromId) continue;
      if (ownId && fromId === ownId) continue; // our own reply — don't loop
      out.push({
        igCommentId: id,
        igMediaId: mediaId,
        fromId,
        fromUsername: value.from?.username ?? null,
        text: value.text ?? null,
        parentId: value.parent_id ?? null,
      });
    }
  }
  return out;
}

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * Persist the raw event and every new comment. Returns only the rows we created
 * (status NEW), so a duplicate delivery re-runs nothing. Backfills the IgMedia
 * FK when we've already seen the media (via /sync); the scalar igMediaId is
 * always stored regardless.
 */
export async function persistInboundIg(payload: WebhookPayload): Promise<IgComment[]> {
  const raw = await prisma.igRawEvent.create({ data: { payload: payload as object } });

  const created: IgComment[] = [];
  for (const c of extractComments(payload)) {
    const existing = await prisma.igComment.findUnique({
      where: { igCommentId: c.igCommentId },
      select: { id: true },
    });
    if (existing) continue;
    const media = await prisma.igMedia.findUnique({
      where: { igMediaId: c.igMediaId },
      select: { id: true },
    });
    try {
      created.push(
        await prisma.igComment.create({
          data: {
            igCommentId: c.igCommentId,
            igMediaId: c.igMediaId,
            mediaId: media?.id ?? null,
            fromId: c.fromId,
            fromUsername: c.fromUsername,
            text: c.text,
            parentId: c.parentId,
            status: "NEW",
          },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) continue; // concurrent retry won the insert
      throw e;
    }
  }

  await prisma.igRawEvent.update({ where: { id: raw.id }, data: { processedAt: new Date() } });
  return created;
}

/**
 * Auto-reply to one new comment when the toggle is on. Never throws — a failure
 * is logged and leaves the row NEW so the sweeper retries it. When auto-reply is
 * off, the row simply waits in NEW for a staff member to act in the inbox.
 */
export async function processComment(comment: IgComment): Promise<void> {
  try {
    if (comment.status !== "NEW") return;
    const settings = await prisma.igSettings.findUnique({ where: { id: "singleton" } });
    if (!settings?.autoReply) return;

    const message = settings.replyTemplate;
    const res = await replyToComment(comment.igCommentId, message);
    // Persist intent even when the send is skipped (no token): the inbox then
    // shows the auto-reply was applied, matching the manual path's contract.
    await prisma.igComment.update({
      where: { id: comment.id },
      data: {
        status: "REPLIED",
        replyText: message,
        replyCommentId: res.id ?? null,
        repliedBy: "auto",
        repliedAt: new Date(),
      },
    });
    console.info(`[webhook] ig auto-reply → ${comment.igCommentId}`);
  } catch (err) {
    console.error(`[webhook] ig auto-reply failed for ${comment.igCommentId}:`, err);
  }
}

/** How long a comment may sit in NEW before the sweeper retries auto-reply. */
export const IG_STUCK_AFTER_MS = 2 * 60 * 1000;
/** Sweeper poll interval. */
export const IG_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Re-run auto-reply for any IgComment still NEW older than {@link
 * IG_STUCK_AFTER_MS} — comments whose processing never completed (a process
 * that died mid-flight). No-op in practice when auto-reply is off, since
 * processComment returns early. Failures are logged, not propagated.
 */
export async function sweepStuckIg(process: (c: IgComment) => Promise<void>): Promise<number> {
  const cutoff = new Date(Date.now() - IG_STUCK_AFTER_MS);
  const stuck = await prisma.igComment.findMany({
    where: { status: "NEW", ts: { lt: cutoff } },
  });
  for (const c of stuck) {
    await process(c).catch((err) =>
      console.error(`[webhook] ig sweeper failed for ${c.igCommentId}:`, err),
    );
  }
  return stuck.length;
}

/** Start the periodic IG sweeper; returns the interval handle (unref'd). */
export function startIgSweeper(process: (c: IgComment) => Promise<void>): NodeJS.Timeout {
  const handle = setInterval(() => {
    void sweepStuckIg(process).catch((err) => console.error("[webhook] ig sweep error:", err));
  }, IG_SWEEP_INTERVAL_MS);
  handle.unref?.();
  return handle;
}
