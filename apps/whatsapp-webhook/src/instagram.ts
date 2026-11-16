/**
 * Instagram deliveries — DMs and comments (2026-11-16,
 * docs/superpowers/specs/2026-11-16-instagram-design.md).
 *
 * The same four properties as the WhatsApp path (app.ts): the raw envelope is
 * written first (`IgRawEvent`), then each DM becomes a `WaMessage` under the
 * thread key `ig:<IGSID>` and each comment an `IgComment`; dedup is the
 * database's (unique ids, Meta retries for 36 hours); and nothing here talks
 * to the network — fetching a post's caption or a sender's @username is the
 * worker's sync pass.
 *
 * ## What is NOT a customer's message
 *
 * - An echo (`message.is_echo`) — what the shop itself sent, from the POS or
 *   from the Instagram app. Answering it would be the bot answering itself.
 * - Anything whose sender is the account (`entry.id`), for the same reason.
 * - A deleted message, a read receipt, a reaction. They stay in the raw row.
 *
 * ## Comments arrive in two documented shapes
 *
 * Meta's Instagram Login pages show a comment both inside `entry[].changes[]`
 * (`value.comment_id`, with `parent_id`) and directly on the entry
 * (`entry[].field` / `entry[].value`, with `value.id`). Both are read.
 */

import type { PrismaClient, Tx } from "@nusantara/db";
import { enqueueOutbox } from "@nusantara/db";
import { igThreadKey } from "@nusantara/domain";

/** One `entry[].messaging[]` item, as much as is read. */
interface IgMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { mid?: string; title?: string; payload?: string };
}

interface IgCommentValue {
  id?: string;
  comment_id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}

export interface IgEntry {
  id?: string;
  time?: number;
  messaging?: IgMessagingEvent[];
  changes?: Array<{ field?: string; value?: unknown }>;
  field?: string;
  value?: unknown;
}

export interface IgPayload {
  object?: string;
  entry?: IgEntry[];
}

/** A DM, ready to become a `WaMessage`. */
export interface InboundIgMessage {
  readonly waMessageId: string;
  readonly from: string;
  readonly text: string | null;
  readonly msgType: string;
  readonly ts: Date;
}

/** A comment, ready to become an `IgComment`. */
export interface InboundIgComment {
  readonly igCommentId: string;
  readonly igMediaId: string;
  readonly fromId: string;
  readonly fromUsername: string | null;
  readonly text: string | null;
  readonly parentId: string | null;
  readonly ts: Date;
}

const IGSID = /^\d{5,32}$/;

/** Meta sends DM timestamps in milliseconds and entry times in seconds. */
function tsOf(raw: number | undefined, fallback: Date): Date {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
    return fallback;
  return new Date(raw > 1e12 ? raw : raw * 1000);
}

/** Every customer DM in a delivery. Pure. */
export function extractIgMessages(
  payload: IgPayload,
  now: Date = new Date(),
): InboundIgMessage[] {
  if (payload.object !== "instagram") return [];
  const out: InboundIgMessage[] = [];
  for (const entry of payload.entry ?? []) {
    const own = entry.id;
    for (const ev of entry.messaging ?? []) {
      const sender = ev.sender?.id;
      if (!sender || !IGSID.test(sender) || sender === own) continue;
      const ts = tsOf(ev.timestamp, now);
      if (ev.message) {
        const m = ev.message;
        if (!m.mid || m.is_echo || m.is_deleted) continue;
        const text = m.text?.trim() ? m.text : null;
        const attachment = m.attachments?.[0]?.type;
        out.push({
          waMessageId: `ig:${m.mid}`,
          from: igThreadKey(sender),
          text,
          msgType: m.is_unsupported
            ? "unsupported"
            : text !== null
              ? "text"
              : (attachment ?? "unknown"),
          ts,
        });
        continue;
      }
      // A button the customer tapped reads as what the button said.
      if (ev.postback?.mid && ev.postback.title) {
        out.push({
          waMessageId: `ig:${ev.postback.mid}`,
          from: igThreadKey(sender),
          text: ev.postback.title,
          msgType: "text",
          ts,
        });
      }
    }
  }
  return out;
}

/** Every comment by somebody other than the shop. Pure. */
export function extractIgComments(
  payload: IgPayload,
  now: Date = new Date(),
): InboundIgComment[] {
  if (payload.object !== "instagram") return [];
  const out: InboundIgComment[] = [];
  for (const entry of payload.entry ?? []) {
    const values: unknown[] = [
      ...(entry.changes ?? [])
        .filter((c) => c.field === "comments")
        .map((c) => c.value),
      ...(entry.field === "comments" ? [entry.value] : []),
    ];
    for (const raw of values) {
      const v = (raw ?? {}) as IgCommentValue;
      const id = v.id ?? v.comment_id;
      const mediaId = v.media?.id;
      const fromId = v.from?.id;
      if (!id || !mediaId || !fromId) continue;
      if (fromId === entry.id) continue; // our own reply — never loop
      out.push({
        igCommentId: id,
        igMediaId: mediaId,
        fromId,
        fromUsername: v.from?.username ?? null,
        text: v.text ?? null,
        parentId: v.parent_id ?? null,
        ts: tsOf(entry.time, now),
      });
    }
  }
  return out;
}

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: string }).code === "P2002";

export interface IgPersistResult {
  readonly messages: Array<{ id: string; from: string; text: string | null }>;
  readonly comments: number;
}

/**
 * Persist a verified Instagram delivery: raw, then DMs, then comments.
 * Returns the rows this call created, so a redelivery returns nothing.
 */
export async function persistInboundIg(
  db: PrismaClient,
  payload: IgPayload,
  now: Date = new Date(),
): Promise<IgPersistResult> {
  const raw = await db.igRawEvent.create({
    data: {
      payload: payload as object,
      signatureOk: true,
      receivedAt: now,
    },
    select: { id: true },
  });

  const messages: IgPersistResult["messages"] = [];
  for (const m of extractIgMessages(payload, now)) {
    try {
      messages.push(
        await db.waMessage.create({
          data: {
            waMessageId: m.waMessageId,
            from: m.from,
            name: null,
            text: m.text,
            msgType: m.msgType,
            ts: m.ts,
            direction: "IN",
            status: "BARU",
            entities: {},
            answeredByAgent: false,
          },
          select: { id: true, from: true, text: true },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }

  let comments = 0;
  for (const c of extractIgComments(payload, now)) {
    try {
      const made = await db.$transaction((tx) => storeComment(tx, c, now));
      if (made) comments += 1;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }

  await db.igRawEvent.update({
    where: { id: raw.id },
    data: { processedAt: new Date() },
  });
  return { messages, comments };
}

/** The settings singleton's id (IgSettings is one row). */
export const IG_SETTINGS_ID = "singleton";

/**
 * One comment, its post's stub, and — when the owner has switched the
 * auto-reply on — the public reply and the private DM, in one transaction.
 *
 * The auto-reply answers a TOP-LEVEL comment, once per person per post: a
 * customer answering our reply with "ok kak", or commenting twice, is not
 * answered twice.
 */
async function storeComment(
  tx: Tx,
  c: InboundIgComment,
  now: Date,
): Promise<boolean> {
  const existing = await tx.igComment.findUnique({
    where: { igCommentId: c.igCommentId },
    select: { id: true },
  });
  if (existing) return false;
  const media = await tx.igMedia.upsert({
    where: { igMediaId: c.igMediaId },
    // A stub: the worker's sync pass fills caption, picture and link.
    // `fetchedAt` = the epoch means "never fetched".
    create: { igMediaId: c.igMediaId, fetchedAt: new Date(0) },
    update: {},
    select: { id: true },
  });

  const settings = await tx.igSettings.findUnique({
    where: { id: IG_SETTINGS_ID },
  });
  const answered =
    settings?.autoReply && c.parentId === null
      ? (await tx.igComment.count({
          where: {
            mediaId: media.id,
            fromId: c.fromId,
            repliedByAgent: true,
          },
        })) === 0
      : false;
  const reply = answered ? settings!.replyTemplate.trim() : "";
  const dm = answered ? settings!.dmTemplate.trim() : "";

  await tx.igComment.create({
    data: {
      igCommentId: c.igCommentId,
      mediaId: media.id,
      fromId: c.fromId,
      fromUsername: c.fromUsername,
      text: c.text,
      parentId: c.parentId,
      ts: c.ts,
      status: dm ? "DMED" : reply ? "REPLIED" : "NEW",
      repliedByAgent: Boolean(reply || dm),
      ...(reply ? { replyText: reply, repliedAt: now } : {}),
      ...(dm ? { dmText: dm, dmSentAt: now } : {}),
    },
  });
  if (reply)
    await enqueueOutbox(tx, {
      kind: "IG_REPLY",
      payload: { commentId: c.igCommentId, body: reply, byAgent: true },
    });
  if (dm)
    await enqueueOutbox(tx, {
      kind: "IG_PRIVATE_REPLY",
      payload: { commentId: c.igCommentId, body: dm, byAgent: true },
    });
  return true;
}
