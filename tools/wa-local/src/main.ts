/**
 * wa-local — the chatbot on a WhatsApp account linked from this laptop.
 *
 * LOCAL TESTING ONLY. Baileys speaks WhatsApp Web's protocol, which Meta does
 * not offer as an API: an account driven this way can be restricted. Production
 * uses the Cloud API (docs/chatbot-runbook.md) and none of this ships — the
 * folder is outside the pnpm workspace, so it is in no lockfile CI installs
 * and in no release build-release.mjs bundles.
 *
 * ## What it replaces, and what it does not
 *
 *     phone ─▶ Baileys ─▶ POST /webhook (signed) ─▶ WaMessage ─▶ worker draft
 *                                                                    │
 *     phone ◀─ Baileys ◀─ fetchImpl (instead of graph.facebook.com) ◀─ Outbox
 *
 * Only the two ends. An inbound message is re-shaped into the delivery Meta
 * would have made and POSTed, signed, to the REAL webhook process; the reply
 * is drafted and queued by the REAL worker loop, run in this process so its
 * Graph calls can be answered here through `TickDeps.fetchImpl` — the seam the
 * worker's own tests use. Routing, retrieval, the reply check, the hand-over
 * and the four switches are the code production runs.
 *
 * ## The allow-list is the safety rule
 *
 * A linked account receives every chat that account receives. Without a list
 * the bot would answer the owner's family from the owner's own number. So a
 * message is forwarded, and a reply is sent, ONLY for a number on the list
 * (`.state/allow.txt`, edited from the status page); everything else is shown
 * as ignored and touched by nothing. Groups, status updates, channels and the
 * account's own messages are never read at all.
 */

import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { loadWorkerConfig } from "../../../apps/worker/src/config.js";
import { run } from "../../../apps/worker/src/loop.js";
import {
  databaseNameOf,
  db as prisma,
  disconnect,
} from "../../../packages/db/src/index.js";
import { createLogger } from "../../../packages/logging/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATE = join(here, "..", ".state");
const AUTH = join(STATE, "auth");
const ALLOW = join(STATE, "allow.txt");
const JIDS = join(STATE, "jids.json");
mkdirSync(STATE, { recursive: true });

const PAGE_PORT = Number(process.env["WA_LOCAL_PORT"] ?? 3099);
const WEBHOOK_URL =
  process.env["WA_LOCAL_WEBHOOK_URL"] ?? "http://127.0.0.1:3001/webhook";
const APP_SECRET = process.env["APP_SECRET"]?.trim() ?? "";

/** The databases a linked personal account must never drive. */
const REFUSED_DATABASES = ["nusantara_pos_prod", "nusantara_pos_stage"];

// Logged as the worker, which is the loop this process runs.
const logger = createLogger({ app: "worker", env: "development" });

// --- the allow-list ----------------------------------------------------------

/** Digits only, the way a wa_id is written: `0812…` and `+62 812…` → `62812…`. */
function digits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
}

/** Read on every message, so a number added on the page needs no restart. */
function allowed(): string[] {
  if (!existsSync(ALLOW)) return [];
  return readFileSync(ALLOW, "utf8")
    .split(/\r?\n/)
    .map((l) => digits(l))
    .filter((l) => l.length >= 8);
}

function setAllowed(list: string[]): void {
  writeFileSync(ALLOW, [...new Set(list)].join("\n") + "\n");
}

// --- wa_id ↔ jid -------------------------------------------------------------

/**
 * WhatsApp addresses many chats by a LID now, not a phone number, and a reply
 * must go back to the address the message came from. The bot only ever knows
 * the wa_id, so the pairing is remembered here.
 */
const jids: Record<string, string> = existsSync(JIDS)
  ? (JSON.parse(readFileSync(JIDS, "utf8")) as Record<string, string>)
  : {};

function rememberJid(waId: string, jid: string): void {
  if (jids[waId] === jid) return;
  jids[waId] = jid;
  writeFileSync(JIDS, JSON.stringify(jids, null, 2));
}

// --- what the status page shows ----------------------------------------------

interface Activity {
  readonly at: string;
  readonly dir: "in" | "out" | "ignored";
  readonly who: string;
  readonly text: string;
}

const status = {
  link: "starting" as "starting" | "scan" | "connected" | "logged-out",
  me: null as string | null,
  qr: null as string | null,
  activity: [] as Activity[],
  ignored: new Map<string, string>(),
};

function note(a: Omit<Activity, "at">): void {
  status.activity.unshift({ ...a, at: new Date().toISOString() });
  status.activity.length = Math.min(status.activity.length, 40);
}

// --- Baileys -----------------------------------------------------------------

type Socket = ReturnType<typeof makeWASocket>;
let sock: Socket | null = null;
let stopping = false;

/** The Cloud API's message types, for the kinds a customer actually sends. */
function shapeOf(msg: WAMessage): { type: string; text: string | null } {
  const m = normalizeMessageContent(msg.message);
  if (!m) return { type: "unknown", text: null };
  if (m.conversation) return { type: "text", text: m.conversation };
  if (m.extendedTextMessage?.text)
    return { type: "text", text: m.extendedTextMessage.text };
  if (m.imageMessage) return { type: "image", text: null };
  if (m.videoMessage) return { type: "video", text: null };
  if (m.audioMessage) return { type: "audio", text: null };
  if (m.documentMessage) return { type: "document", text: null };
  if (m.stickerMessage) return { type: "sticker", text: null };
  if (m.locationMessage) return { type: "location", text: null };
  if (m.contactMessage) return { type: "contacts", text: null };
  return { type: "unknown", text: null };
}

/** The sender's phone number, or null for a chat that is not one person. */
async function waIdOf(s: Socket, msg: WAMessage): Promise<string | null> {
  const jid = msg.key.remoteJid ?? "";
  if (jid.endsWith("@s.whatsapp.net")) return digits(jid.split("@")[0] ?? "");
  if (!jid.endsWith("@lid")) return null; // a group, a status, a channel
  const alt = msg.key.remoteJidAlt;
  if (alt?.endsWith("@s.whatsapp.net")) return digits(alt.split("@")[0] ?? "");
  const pn = await s.signalRepository.lidMapping
    .getPNForLID(jid)
    .catch(() => null);
  return pn ? digits(pn.split("@")[0]?.split(":")[0] ?? "") : null;
}

/** The delivery Meta would have made for this message (persist.ts reads it). */
function deliveryFor(input: {
  waId: string;
  name: string | null;
  id: string;
  seconds: number;
  type: string;
  text: string | null;
}): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "wa-local",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: status.me ?? "",
                phone_number_id: "wa-local",
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
                  id: `wamid.local.${input.id}`,
                  timestamp: String(input.seconds),
                  type: input.type,
                  ...(input.text !== null
                    ? { text: { body: input.text } }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function onMessage(s: Socket, msg: WAMessage): Promise<void> {
  if (msg.key.fromMe || !msg.message || !msg.key.id) return;
  const waId = await waIdOf(s, msg);
  if (!waId) return;
  const { type, text } = shapeOf(msg);
  const preview = (text ?? `[${type}]`).slice(0, 120);

  if (!allowed().includes(waId)) {
    status.ignored.set(waId, msg.pushName ?? "");
    note({ dir: "ignored", who: waId, text: "not on the allow-list" });
    return;
  }

  rememberJid(waId, msg.key.remoteJid ?? `${waId}@s.whatsapp.net`);
  const body = deliveryFor({
    waId,
    name: msg.pushName ?? null,
    id: msg.key.id,
    seconds: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    type,
    text,
  });
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body,
    });
    note({
      dir: "in",
      who: waId,
      text: res.ok ? preview : `webhook answered ${res.status}: ${preview}`,
    });
  } catch {
    note({ dir: "in", who: waId, text: `webhook unreachable: ${preview}` });
  }
}

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const s = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
    // The phone keeps its own notifications, and no old chats are pulled in:
    // this reads what arrives from now on and nothing before it.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });
  sock = s;
  s.ev.on("creds.update", () => void saveCreds());

  s.ev.on("connection.update", (u) => {
    if (u.qr) {
      status.link = "scan";
      void QRCode.toDataURL(u.qr, { margin: 1, width: 300 }).then((url) => {
        status.qr = url;
      });
    }
    if (u.connection === "open") {
      status.link = "connected";
      status.qr = null;
      status.me = digits(s.user?.id.split(":")[0]?.split("@")[0] ?? "");
      logger.info({ evt: "wa-local.connected" }, "WhatsApp account linked");
    }
    if (u.connection === "close") {
      sock = null;
      const code = (
        u.lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone. The stored session is dead; a fresh QR
        // needs a fresh folder.
        rmSync(AUTH, { recursive: true, force: true });
        status.link = "logged-out";
        status.me = null;
      }
      if (!stopping) setTimeout(() => void connect(), 2_000);
    }
  });

  s.ev.on("messages.upsert", ({ messages, type }) => {
    // "notify" is a message arriving now; "append" is history being filled in.
    if (type !== "notify") return;
    for (const m of messages) void onMessage(s, m);
  });
}

// --- the worker's Graph calls, answered here ---------------------------------

const GRAPH =
  /^https:\/\/graph\.facebook\.com\/[^/]+\/[^/]+\/(messages|media)$/;
/** Bytes the worker "uploaded", waiting for the image send that names them. */
const media = new Map<string, Buffer>();
let mediaSeq = 0;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
/** Shaped like a Graph error, which is the only failure the client can read. */
const graphError = (status: number, message: string): Response =>
  json(status, { error: { message, type: "wa-local", code: status } });

const graphFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.toString();
  const kind = GRAPH.exec(url)?.[1];
  // This function is handed to the WhatsApp client and to nothing else, so a
  // URL it does not recognise is a bug — and must not reach the network.
  if (!kind) throw new Error(`wa-local: refusing to fetch ${url}`);

  if (kind === "media") {
    const file = (init?.body as FormData).get("file");
    if (!(file instanceof Blob))
      return graphError(400, "no file in the upload");
    const id = `wa-local-media-${++mediaSeq}`;
    media.set(id, Buffer.from(await file.arrayBuffer()));
    return json(200, { id });
  }

  const req = JSON.parse(String(init?.body)) as {
    to: string;
    type: "text" | "image";
    text?: { body: string };
    image?: { id: string; caption?: string };
  };
  const to = digits(req.to);
  if (!allowed().includes(to)) {
    return graphError(400, `recipient ${to} is not on the wa-local allow-list`);
  }
  if (!sock || status.link !== "connected") {
    return graphError(503, "the WhatsApp account is not linked");
  }
  const jid = jids[to] ?? `${to}@s.whatsapp.net`;

  if (req.type === "image") {
    const bytes = req.image ? media.get(req.image.id) : undefined;
    if (!bytes) return graphError(400, "unknown media id");
    media.delete(req.image!.id);
    const sent = await sock.sendMessage(jid, {
      image: bytes,
      ...(req.image?.caption ? { caption: req.image.caption } : {}),
    });
    note({ dir: "out", who: to, text: "[photo]" });
    return json(200, {
      messages: [{ id: sent?.key.id ?? `local-${Date.now()}` }],
    });
  }

  const sent = await sock.sendMessage(jid, { text: req.text?.body ?? "" });
  note({ dir: "out", who: to, text: (req.text?.body ?? "").slice(0, 120) });
  return json(200, {
    messages: [{ id: sent?.key.id ?? `local-${Date.now()}` }],
  });
};

// --- the status page ---------------------------------------------------------

const PAGE = readFileSync(join(here, "page.html"), "utf8");

function snapshot() {
  const allow = allowed();
  return {
    link: status.link,
    me: status.me,
    qr: status.qr,
    allow,
    ignored: [...status.ignored]
      .filter(([n]) => !allow.includes(n))
      .map(([number, name]) => ({ number, name })),
    activity: status.activity,
    database: databaseNameOf(process.env["DATABASE_URL"] ?? "") ?? "",
  };
}

const page = createServer((req, res) => {
  const send = (code: number, type: string, body: string) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  if (req.method === "GET" && req.url === "/") {
    return send(200, "text/html; charset=utf-8", PAGE);
  }
  if (req.method === "GET" && req.url === "/state") {
    return send(200, "application/json", JSON.stringify(snapshot()));
  }
  if (req.method === "POST") {
    // A page on another site can make this browser POST here. It cannot send
    // JSON without a preflight this server never answers, and its Origin is
    // not ours — either check alone would do.
    const own = [
      `http://127.0.0.1:${PAGE_PORT}`,
      `http://localhost:${PAGE_PORT}`,
    ];
    if (
      !own.includes(req.headers.origin ?? "") ||
      !(req.headers["content-type"] ?? "").startsWith("application/json")
    ) {
      return send(403, "text/plain", "forbidden");
    }
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const number = digits(
        String((JSON.parse(raw || "{}") as { number?: unknown }).number ?? ""),
      );
      if (req.url === "/allow" && number.length >= 8) {
        setAllowed([...allowed(), number]);
      } else if (req.url === "/disallow") {
        setAllowed(allowed().filter((n) => n !== number));
      } else if (req.url === "/unlink") {
        void sock?.logout().catch(() => {});
      } else {
        return send(400, "text/plain", "bad request");
      }
      send(200, "application/json", JSON.stringify(snapshot()));
    });
    return;
  }
  send(404, "text/plain", "not found");
});

// --- start -------------------------------------------------------------------

async function main(): Promise<void> {
  const database = databaseNameOf(process.env["DATABASE_URL"] ?? "");
  if (!database || REFUSED_DATABASES.includes(database)) {
    throw new Error(
      `wa-local runs against a local test database, never ${database ?? "an unset DATABASE_URL"}.`,
    );
  }
  if (!APP_SECRET) {
    throw new Error(
      "APP_SECRET is not set — start this with tools/wa-local/up.",
    );
  }

  // The Graph credential is a placeholder on purpose: every send is answered
  // by `graphFetch` above, and the shop's real token is never loaded here.
  const config = loadWorkerConfig({
    ...process.env,
    WHATSAPP_TOKEN: "wa-local",
    PHONE_NUMBER_ID: "wa-local",
  });

  page.listen(PAGE_PORT, "127.0.0.1", () =>
    logger.info(
      { evt: "wa-local.page", ctx: { url: `http://127.0.0.1:${PAGE_PORT}` } },
      "status page ready",
    ),
  );
  await connect();

  let requestStop: () => void = () => {};
  const stop = new Promise<void>((resolve) => (requestStop = resolve));
  const shutdown = () => {
    stopping = true;
    requestStop();
    page.close();
    void sock?.end(undefined);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await run({ db: prisma(), logger, config, stop, fetchImpl: graphFetch });
  await disconnect();
  process.exit(0);
}

main().catch((err: unknown) => {
  logger.error(
    {
      evt: "wa-local.failed",
      ...(err instanceof Error
        ? { err: { name: err.name, message: err.message } }
        : {}),
    },
    "wa-local stopped",
  );
  process.exit(1);
});
