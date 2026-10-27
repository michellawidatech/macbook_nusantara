/**
 * Inbound: a WhatsApp Web message, re-shaped into the delivery Meta's Cloud
 * API would have POSTed, and signed the way the webhook verifies it.
 *
 * Pure — no Baileys, no I/O — so the shape is testable on its own. The socket
 * adapter (`baileysSocket.ts`) hands this a plain object; this decides what
 * the webhook sees.
 *
 * ## What reaches the webhook
 *
 * Only a 1:1 chat with a person: `@s.whatsapp.net`, or a LID that resolves to
 * a phone number. Groups (`@g.us`), status updates (`status@broadcast`),
 * channels (`@newsletter`) and the account's own messages are never read —
 * the bot answers customers, not the shop's family group.
 *
 * ## Media
 *
 * The webhook persists `type` and `text.body` and nothing else (persist.ts),
 * and no code anywhere fetches a Cloud media id — a photo a customer sends is
 * a hand-over to a person either way (`routeMessage`). So an image is
 * forwarded as Meta forwards one, `type: "image"` with its caption and MIME
 * type, and its bytes are NOT downloaded: there is no table for them and
 * inventing one is not this change's to make (CLAUDE.md). Staff see the photo
 * on the shop's phone, which holds every message the linked device sees.
 */

import { createHmac } from "node:crypto";

/** The parts of a Baileys `proto.IMessage` this reads, after normalising. */
export interface MessageContent {
  readonly conversation?: string | null;
  readonly extendedTextMessage?: { readonly text?: string | null } | null;
  readonly imageMessage?: {
    readonly caption?: string | null;
    readonly mimetype?: string | null;
  } | null;
  readonly videoMessage?: unknown;
  readonly audioMessage?: unknown;
  readonly documentMessage?: unknown;
  readonly stickerMessage?: unknown;
  readonly locationMessage?: unknown;
  readonly liveLocationMessage?: unknown;
  readonly contactMessage?: unknown;
  readonly contactsArrayMessage?: unknown;
  readonly reactionMessage?: unknown;
}

/** One arriving message, as the socket adapter hands it over. */
export interface InboundMessage {
  readonly id: string;
  readonly jid: string;
  /** Baileys' `remoteJidAlt`: the phone-number JID beside a LID, when known. */
  readonly jidAlt?: string | null;
  readonly fromMe: boolean;
  readonly pushName?: string | null;
  /** Unix seconds. */
  readonly seconds: number;
  readonly content: MessageContent | null;
}

/** Digits only, the way a wa_id is written: `0812…` / `+62 812…` → `62812…`. */
export function digits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
}

/** The user part of a JID, without a device suffix: `62812:3@s…` → `62812`. */
export function userOf(jid: string): string {
  return (jid.split("@")[0] ?? "").split(":")[0] ?? "";
}

export type ChatKind = "person" | "lid" | "ignore";

/** Which chats are a customer. Everything not named here is ignored. */
export function chatKind(jid: string): ChatKind {
  if (jid.endsWith("@s.whatsapp.net")) return "person";
  if (jid.endsWith("@lid")) return "lid";
  // @g.us (groups), status@broadcast and other broadcasts, @newsletter
  // (channels), @call, and anything WhatsApp invents next.
  return "ignore";
}

export interface Shape {
  /** The Cloud API's message type. */
  readonly type: string;
  readonly text: string | null;
  readonly image?: { readonly caption?: string; readonly mimeType?: string };
}

/**
 * The Cloud API's type for this content, or null for something that is not a
 * message a person sent (a protocol message, a key distribution, an edit) and
 * which Meta would not have delivered either.
 */
export function shapeOf(m: MessageContent | null): Shape | null {
  if (!m) return null;
  if (typeof m.conversation === "string" && m.conversation !== "")
    return { type: "text", text: m.conversation };
  if (m.extendedTextMessage?.text)
    return { type: "text", text: m.extendedTextMessage.text };
  if (m.imageMessage) {
    const caption = m.imageMessage.caption?.trim();
    const mimeType = m.imageMessage.mimetype?.trim();
    return {
      type: "image",
      text: null,
      image: {
        ...(caption ? { caption } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
    };
  }
  if (m.videoMessage) return { type: "video", text: null };
  if (m.audioMessage) return { type: "audio", text: null };
  if (m.documentMessage) return { type: "document", text: null };
  if (m.stickerMessage) return { type: "sticker", text: null };
  if (m.locationMessage || m.liveLocationMessage)
    return { type: "location", text: null };
  if (m.contactMessage || m.contactsArrayMessage)
    return { type: "contacts", text: null };
  if (m.reactionMessage) return { type: "reaction", text: null };
  return null;
}

/** The id the webhook stores. Prefixed so nobody mistakes it for Meta's. */
export const inboundId = (id: string): string => `wamid.baileys.${id}`;

/** The delivery Meta would have made for this message (persist.ts reads it). */
export function deliveryFor(input: {
  readonly waId: string;
  readonly name: string | null;
  readonly id: string;
  readonly seconds: number;
  readonly shape: Shape;
  /** The shop's own number, digits only; empty while unknown. */
  readonly displayNumber: string;
}): string {
  const { shape } = input;
  const media =
    shape.type === "text"
      ? { text: { body: shape.text ?? "" } }
      : shape.type === "image"
        ? {
            image: {
              id: `baileys-${input.id}`,
              ...(shape.image?.mimeType
                ? { mime_type: shape.image.mimeType }
                : {}),
              ...(shape.image?.caption ? { caption: shape.image.caption } : {}),
            },
          }
        : {};
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "baileys",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: input.displayNumber,
                phone_number_id: "baileys",
              },
              contacts: [
                {
                  ...(input.name ? { profile: { name: input.name } } : {}),
                  wa_id: input.waId,
                },
              ],
              messages: [
                {
                  from: input.waId,
                  id: inboundId(input.id),
                  timestamp: String(input.seconds),
                  type: shape.type,
                  ...media,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

/** `X-Hub-Signature-256` for these exact bytes — what the webhook recomputes. */
export function signatureOf(body: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}
