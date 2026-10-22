/**
 * The real socket: Baileys, behind the narrow `GatewaySocket` the session
 * talks to. The only file that imports Baileys — every rule about WHAT to do
 * is in session.ts and delivery.ts, where a test reaches it without a phone.
 *
 * Settings, and why:
 *
 * - `markOnlineOnConnect: false` — the phone keeps its notifications, so staff
 *   still see a customer's message arrive on the shop's phone.
 * - No history sync: the gateway reads what arrives from now on. Meta never
 *   delivered history either, and replaying a month of chats into the webhook
 *   would have the bot answer every one of them.
 * - `getMessage` answers from the last few hundred SENT messages, which is
 *   what WhatsApp asks for when a recipient's phone failed to decrypt one and
 *   requests it again. Without it such a reply stays "waiting for this
 *   message" on the customer's screen.
 * - Baileys' own logger is ours at `error`: its debug output carries
 *   protocol frames, and the QR is never logged anywhere.
 */

import makeWASocket, {
  Browsers,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type proto,
} from "baileys";
import type { Logger } from "@nusantara/logging";
import type { InboundMessage, MessageContent } from "./delivery.js";
import { digits, userOf } from "./delivery.js";
import type { GatewaySocket, SocketFactory } from "./session.js";

/** Sent messages kept for a recipient's retry request. */
const SENT_CACHE = 500;

function secondsOf(ts: WAMessage["messageTimestamp"]): number {
  const n = typeof ts === "number" ? ts : Number(ts ?? 0);
  return Number.isFinite(n) && n > 0 ? n : Math.floor(Date.now() / 1000);
}

function inboundOf(m: WAMessage): InboundMessage | null {
  if (!m.key.id || !m.key.remoteJid) return null;
  return {
    id: m.key.id,
    jid: m.key.remoteJid,
    jidAlt: m.key.remoteJidAlt ?? null,
    fromMe: Boolean(m.key.fromMe),
    pushName: m.pushName ?? null,
    seconds: secondsOf(m.messageTimestamp),
    content: (normalizeMessageContent(m.message) ??
      null) as MessageContent | null,
  };
}

export function baileysSocketFactory(logger: Logger): SocketFactory {
  const sent = new Map<string, proto.IMessage>();
  const remember = (msg: WAMessage | undefined) => {
    if (!msg?.key.id || !msg.message) return;
    sent.set(msg.key.id, msg.message);
    while (sent.size > SENT_CACHE) {
      const first = sent.keys().next().value;
      if (first === undefined) break;
      sent.delete(first);
    }
  };

  return async (authDir) => {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
      auth: state,
      // Baileys calls into pino's interface; ours is pino, typed by our own
      // copy of it, so the cast bridges two versions of the same type.
      logger: logger.child(
        { mod: "baileys" },
        { level: "error" },
      ) as unknown as Parameters<typeof makeWASocket>[0]["logger"],
      browser: Browsers.macOS("Desktop"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async (key) => (key.id ? sent.get(key.id) : undefined),
    });
    sock.ev.on("creds.update", () => void saveCreds());

    const socket: GatewaySocket = {
      onConnection(listener) {
        sock.ev.on("connection.update", (u) => {
          const code = (
            u.lastDisconnect?.error as
              { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;
          listener({
            ...(u.qr ? { qr: u.qr } : {}),
            ...(u.connection ? { connection: u.connection } : {}),
            ...(code !== undefined ? { statusCode: code } : {}),
          });
        });
      },
      onMessages(listener) {
        sock.ev.on("messages.upsert", ({ messages, type }) => {
          // "notify" is a message arriving now; "append" is history.
          if (type !== "notify") return;
          const out = messages
            .map(inboundOf)
            .filter((m): m is InboundMessage => m !== null);
          if (out.length > 0) listener(out);
        });
      },
      ownNumber() {
        const id = sock.user?.id;
        return id ? digits(userOf(id)) : null;
      },
      async pnForLid(lid) {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
        return pn ?? null;
      },
      async presence(jid, kind) {
        await sock.sendPresenceUpdate(kind, jid);
      },
      async sendText(jid, text) {
        const msg = await sock.sendMessage(jid, { text });
        remember(msg);
        return msg?.key.id ?? null;
      },
      async sendImage(jid, bytes, mimeType, caption) {
        const msg = await sock.sendMessage(jid, {
          image: bytes,
          mimetype: mimeType,
          ...(caption ? { caption } : {}),
        });
        remember(msg);
        return msg?.key.id ?? null;
      },
      async logout() {
        await sock.logout();
      },
      end() {
        void sock.end(undefined);
      },
    };
    return socket;
  };
}
