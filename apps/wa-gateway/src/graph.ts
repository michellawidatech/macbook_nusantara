/**
 * Outbound: the Graph API's request and response shapes, for the two calls
 * `@nusantara/whatsapp` makes and nothing else.
 *
 *     POST /graph/{version}/{phone-number-id}/media      multipart, field `file`
 *     POST /graph/{version}/{phone-number-id}/messages   JSON, text or image-by-id
 *
 * The worker in Baileys mode sends EXACTLY what it would send to
 * graph.facebook.com — its fetch only rewrites the origin (apps/worker
 * transport.ts) — so the send code, the outbox's retries and the 24-hour rule
 * are the Cloud API's, unforked. This answers in Graph's shapes because those
 * are the only answers that client can read: `messages[0].id` on success,
 * `{ error: { message } }` on failure, which it turns into a throw and the
 * outbox turns into a retry.
 */

import { digits } from "./delivery.js";

export type GraphCall = "messages" | "media";

const PATH = /^\/graph\/[A-Za-z0-9.]+\/[A-Za-z0-9_-]+\/(messages|media)$/;

/** Which Graph call a path is, or null. The version and phone id are ignored. */
export function graphCallOf(path: string): GraphCall | null {
  const kind = PATH.exec(path)?.[1];
  return kind === "messages" || kind === "media" ? kind : null;
}

export type SendRequest =
  | { readonly kind: "text"; readonly to: string; readonly body: string }
  | {
      readonly kind: "image";
      readonly to: string;
      readonly mediaId: string;
      readonly caption?: string;
    };

/**
 * Read a `/messages` body. A string is the reason it was refused, worded for
 * the outbox's `lastError`.
 *
 * Only what `sendText` / `sendImage` send. An image by `link` is refused, not
 * fetched: the worker never sends one (send.ts uploads, because the Mac mini
 * has no public origin), and a gateway that fetched arbitrary URLs on request
 * would be a way to make this machine fetch arbitrary URLs.
 */
export function parseSendRequest(raw: unknown): SendRequest | string {
  if (typeof raw !== "object" || raw === null) return "the body is not JSON";
  const r = raw as Record<string, unknown>;
  const to = typeof r["to"] === "string" ? digits(r["to"]) : "";
  if (!/^\d{6,20}$/.test(to)) return "`to` is not a phone number";
  if (r["type"] === "text") {
    const text = r["text"] as { body?: unknown } | undefined;
    const body = typeof text?.body === "string" ? text.body : "";
    if (!body.trim()) return "a text message needs `text.body`";
    return { kind: "text", to, body };
  }
  if (r["type"] === "image") {
    const image = r["image"] as { id?: unknown; caption?: unknown } | undefined;
    if (typeof image?.id !== "string" || !image.id)
      return "an image is sent by the `id` an upload returned";
    const caption =
      typeof image.caption === "string" && image.caption.trim()
        ? image.caption.trim()
        : undefined;
    return {
      kind: "image",
      to,
      mediaId: image.id,
      ...(caption ? { caption } : {}),
    };
  }
  return `message type ${JSON.stringify(r["type"])} is not supported`;
}

/** Graph's success body for a send. */
export const sentBody = (id: string) => ({
  messaging_product: "whatsapp",
  contacts: [],
  messages: [{ id }],
});

/** Graph's error body — the only failure `@nusantara/whatsapp` can read. */
export const graphErrorBody = (code: number, message: string) => ({
  error: { message, type: "WaGatewayException", code },
});

/**
 * A `/messages/revoke` or `/messages/edit` body (2026-10-23): which chat, which
 * message, and for an edit the new text. A string is the reason it was refused.
 * Not Graph's shape — the Cloud API has no edit and no delete — so only the
 * API's inbox calls these, never the worker's Graph client.
 */
export interface RetractRequest {
  readonly to: string;
  readonly id: string;
}
export interface EditRequest extends RetractRequest {
  readonly text: string;
}

const MESSAGE_ID = /^[A-Za-z0-9._:=+/-]{1,128}$/;

export function parseRetractRequest(raw: unknown): RetractRequest | string {
  if (typeof raw !== "object" || raw === null) return "the body is not JSON";
  const r = raw as Record<string, unknown>;
  const to = typeof r["to"] === "string" ? digits(r["to"]) : "";
  if (!/^\d{6,20}$/.test(to)) return "`to` is not a phone number";
  const id = typeof r["id"] === "string" ? r["id"].trim() : "";
  if (!MESSAGE_ID.test(id)) return "`id` is not a message id";
  return { to, id };
}

export function parseEditRequest(raw: unknown): EditRequest | string {
  const base = parseRetractRequest(raw);
  if (typeof base === "string") return base;
  const text = (raw as Record<string, unknown>)["text"];
  if (typeof text !== "string" || !text.trim()) return "an edit needs `text`";
  if (text.length > 4_096) return "`text` is too long";
  return { ...base, text };
}
