/**
 * The gateway end to end, with a fake socket where Baileys would be and the
 * REAL Graph client (`@nusantara/whatsapp`) as the caller, through the same
 * `gatewayFetch` the worker uses in Baileys mode. No WhatsApp account is
 * touched: the fake socket is the phone.
 */

import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@nusantara/logging";
import {
  gatewayFetch,
  sendImage,
  sendText,
  uploadMedia,
} from "@nusantara/whatsapp";
import { loadGatewayConfig } from "../src/config.js";
import type { InboundMessage } from "../src/delivery.js";
import { createGatewayServer } from "../src/server.js";
import {
  CLOSE,
  WhatsAppSession,
  type ConnectionUpdate,
  type GatewaySocket,
} from "../src/session.js";

const SECRET = "gateway-secret-for-tests";
const APP_SECRET = "meta-app-secret";
const SHOP = "628111222333";

class FakeSocket implements GatewaySocket {
  conn: (u: ConnectionUpdate) => void = () => {};
  msgs: (m: InboundMessage[]) => void = () => {};
  readonly sent: Array<{
    jid: string;
    text?: string;
    image?: Buffer;
    caption?: string;
  }> = [];
  readonly presences: string[] = [];
  readonly lids = new Map<string, string>();
  loggedOut = false;
  ended = false;
  onConnection(l: (u: ConnectionUpdate) => void) {
    this.conn = l;
  }
  onMessages(l: (m: InboundMessage[]) => void) {
    this.msgs = l;
  }
  ownNumber() {
    return SHOP;
  }
  async pnForLid(lid: string) {
    return this.lids.get(lid) ?? null;
  }
  async presence(jid: string, kind: "composing" | "paused") {
    this.presences.push(`${kind}:${jid}`);
  }
  async sendText(jid: string, text: string) {
    this.sent.push({ jid, text });
    return `OUT${this.sent.length}`;
  }
  async sendImage(jid: string, image: Buffer, _mime: string, caption?: string) {
    this.sent.push({ jid, image, ...(caption ? { caption } : {}) });
    return `OUT${this.sent.length}`;
  }
  async logout() {
    this.loggedOut = true;
    this.conn({ connection: "close", statusCode: CLOSE.loggedOut });
  }
  end() {
    this.ended = true;
  }
}

let dir: string;
let sockets: FakeSocket[];
let webhook: ReturnType<typeof vi.fn>;
let session: WhatsAppSession;
let base: string;
let close: () => Promise<void>;
let clock: number;

const flush = () => new Promise((r) => setTimeout(r, 0));
const latest = () => sockets[sockets.length - 1]!;
const auth = () => join(dir, "auth");

/** What a scan does: Baileys writes who we are, then asks for a restart. */
async function scan() {
  mkdirSync(auth(), { recursive: true });
  writeFileSync(
    join(auth(), "creds.json"),
    JSON.stringify({ me: { id: `${SHOP}:7@s.whatsapp.net` } }),
  );
  latest().conn({ connection: "close", statusCode: CLOSE.restartRequired });
  await flush();
  latest().conn({ connection: "open" });
  await flush();
}

function gw(path: string, init: RequestInit = {}, secret = SECRET) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "x-wa-gateway-secret": secret, ...(init.headers ?? {}) },
  });
}

/** The gateway's answers, as loosely as a test reads them. */
interface Answer {
  readonly state: string;
  readonly qr?: string;
  readonly number?: string;
  readonly since?: string;
  readonly lastError?: string;
  readonly limit: { max: number; windowMinutes: number; remaining: number };
  readonly error: { code: string };
}
const read = async (res: Response) => (await res.json()) as Answer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "wa-gateway-test-"));
  sockets = [];
  clock = 1_800_000_000_000;
  webhook = vi.fn(async () => new Response("ok", { status: 200 }));
  const config = loadGatewayConfig({
    APP_ENV: "prod",
    WA_GATEWAY_SECRET: SECRET,
    APP_SECRET,
    WA_GATEWAY_STATE_DIR: dir,
  });
  const logger = createLogger({
    app: "wa-gateway",
    env: "test",
    destination: new Writable({ write: (_c, _e, cb) => cb() }),
  });
  session = new WhatsAppSession({
    config,
    logger,
    makeSocket: async () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    fetchImpl: webhook as unknown as typeof fetch,
    now: () => clock,
    sleep: async () => {},
    qrToDataUrl: async (qr) => `data:image/png;base64,${qr}`,
    forwardRetryMs: [0, 0],
  });
  const server = createGatewayServer({ secret: SECRET, session, logger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
});

afterEach(async () => {
  session.stop();
  await close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the door", () => {
  it("answers /health to anybody and everything else only with the secret", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await gw("/status", {}, "wrong")).status).toBe(401);
    expect((await fetch(`${base}/status`)).status).toBe(401);
    const status = await read(await gw("/status"));
    expect(status.state).toBe("DISCONNECTED");
    expect(status.limit).toMatchObject({
      max: 3,
      windowMinutes: 60,
      remaining: 3,
    });
  });

  it("does not link by itself when nothing was linked before", async () => {
    await session.start();
    expect(sockets).toHaveLength(0);
  });
});

describe("linking — one session", () => {
  it("shows a QR, connects on a scan, then refuses a second link", async () => {
    const res = await gw("/link", { method: "POST" });
    expect(res.status).toBe(200);
    latest().conn({ qr: "QR-REF-1" });
    await flush();
    const waiting = await read(await gw("/status"));
    expect(waiting.state).toBe("WAITING_FOR_SCAN");
    expect(waiting.qr).toBe("data:image/png;base64,QR-REF-1");

    // Pressing Link again while the QR is up is the same attempt.
    expect((await gw("/link", { method: "POST" })).status).toBe(200);
    expect(sockets).toHaveLength(1);

    await scan();
    const linked = await read(await gw("/status"));
    expect(linked).toMatchObject({
      state: "CONNECTED",
      number: `+${SHOP}`,
      since: new Date(clock).toISOString(),
    });
    expect(linked.qr).toBeUndefined();

    const again = await gw("/link", { method: "POST" });
    expect(again.status).toBe(409);
    expect((await read(again)).error.code).toBe("CONNECTED");
  });

  it("allows three attempts an hour, then 429 with a Retry-After", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await gw("/link", { method: "POST" })).status).toBe(200);
      latest().conn({ qr: `QR-${i}` });
      await flush();
      // The QR runs out unscanned: WhatsApp closes the socket.
      latest().conn({ connection: "close", statusCode: 408 });
      await flush();
      const s = await read(await gw("/status"));
      expect(s.state).toBe("DISCONNECTED");
      expect(s.lastError).toBe("QR_EXPIRED");
    }
    const res = await gw("/link", { method: "POST" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await read(res)).error.code).toBe("RATE_LIMITED");
    clock += 3_600_000;
    expect((await gw("/link", { method: "POST" })).status).toBe(200);
  });

  it("resumes a session linked before, without a QR, on start", async () => {
    mkdirSync(auth(), { recursive: true });
    writeFileSync(
      join(auth(), "creds.json"),
      JSON.stringify({ me: { id: `${SHOP}@s.whatsapp.net` } }),
    );
    await session.start();
    latest().conn({ connection: "open" });
    await flush();
    expect(session.status().state).toBe("CONNECTED");
  });

  it("keeps a dropped session and reconnects it", async () => {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    latest().conn({ connection: "close", statusCode: 428 });
    await flush();
    expect(session.status().state).toBe("CONNECTING");
    expect(existsSync(join(auth(), "creds.json"))).toBe(true);
  });

  it("does not fight a session opened somewhere else", async () => {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    latest().conn({
      connection: "close",
      statusCode: CLOSE.connectionReplaced,
    });
    await flush();
    const s = session.status();
    expect(s.state).toBe("DISCONNECTED");
    expect(s.lastError).toBe("REPLACED");
    // The files stay: Link resumes them, no new QR.
    expect(existsSync(join(auth(), "creds.json"))).toBe(true);
  });

  it("goes DISCONNECTED and deletes the files when the phone unlinks it", async () => {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    latest().conn({ connection: "close", statusCode: CLOSE.loggedOut });
    await flush();
    const s = session.status();
    expect(s.state).toBe("DISCONNECTED");
    expect(s.lastError).toBe("LOGGED_OUT");
    expect(existsSync(auth())).toBe(false);
  });

  it("logs out on request: unlinks the device and deletes the session", async () => {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    const sock = latest();
    const res = await gw("/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await read(res)).state).toBe("DISCONNECTED");
    expect(sock.loggedOut).toBe(true);
    expect(existsSync(auth())).toBe(false);
    // The close the logout caused was not mistaken for a drop.
    await flush();
    expect(session.status().state).toBe("DISCONNECTED");
    expect(sockets).toHaveLength(2);
  });
});

describe("the worker's sends, through the real Graph client", () => {
  const creds = {
    whatsappToken: "unused",
    phoneNumberId: "baileys",
    graphVersion: "v25.0",
  };
  const fetchImpl = () => gatewayFetch({ url: base, secret: SECRET });

  async function linked() {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    return latest();
  }

  it("refuses with a Graph error while nothing is linked — the outbox retries", async () => {
    await expect(
      sendText({
        credentials: creds,
        to: "6281234567890",
        body: "Halo",
        fetchImpl: fetchImpl(),
      }),
    ).rejects.toThrow(/not linked/);
  });

  it("sends a text with typing first, and answers Graph's message id", async () => {
    const sock = await linked();
    const r = await sendText({
      credentials: creds,
      to: "6281234567890",
      body: "Halo kak",
      fetchImpl: fetchImpl(),
    });
    expect(r.waMessageId).toBe("OUT1");
    expect(sock.sent[0]).toEqual({
      jid: "6281234567890@s.whatsapp.net",
      text: "Halo kak",
    });
    expect(sock.presences).toEqual([
      "composing:6281234567890@s.whatsapp.net",
      "paused:6281234567890@s.whatsapp.net",
    ]);
  });

  it("uploads, then sends the photo by the id it was given", async () => {
    const sock = await linked();
    const up = await uploadMedia({
      credentials: creds,
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
      fetchImpl: fetchImpl(),
    });
    expect(up.mediaId).toMatch(/^wa-gateway-media-/);
    const r = await sendImage({
      credentials: creds,
      to: "6281234567890",
      mediaId: up.mediaId!,
      caption: "Air M2 · A",
      fetchImpl: fetchImpl(),
    });
    expect(r.waMessageId).toBe("OUT1");
    expect(sock.sent[0]?.caption).toBe("Air M2 · A");
    expect([...sock.sent[0]!.image!]).toEqual([0xff, 0xd8, 0xff]);
    // An upload is handed over once.
    await expect(
      sendImage({
        credentials: creds,
        to: "6281234567890",
        mediaId: up.mediaId!,
        fetchImpl: fetchImpl(),
      }),
    ).rejects.toThrow(/media id/);
  });
});

describe("inbound, to the webhook", () => {
  async function linked() {
    await gw("/link", { method: "POST" });
    latest().conn({ qr: "Q" });
    await flush();
    await scan();
    return latest();
  }

  const msg = (over: Partial<InboundMessage>): InboundMessage => ({
    id: "M1",
    jid: "6281234567890@s.whatsapp.net",
    fromMe: false,
    pushName: "Ayu",
    seconds: 1_760_000_000,
    content: { conversation: "ada air m2?" },
    ...over,
  });

  it("forwards a customer's message, signed with the webhook's APP_SECRET", async () => {
    const sock = await linked();
    sock.msgs([msg({})]);
    await vi.waitFor(() => expect(webhook).toHaveBeenCalledTimes(1));
    const [url, init] = webhook.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3001/webhook");
    const body = String(init.body);
    const { createHmac } = await import("node:crypto");
    expect(
      (init.headers as Record<string, string>)["x-hub-signature-256"],
    ).toBe(
      `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
    );
    expect(JSON.parse(body).entry[0].changes[0].value.messages[0].from).toBe(
      "6281234567890",
    );
  });

  it("ignores groups, status, channels and the shop's own messages", async () => {
    const sock = await linked();
    sock.msgs([
      msg({ id: "G", jid: "1203630@g.us" }),
      msg({ id: "S", jid: "status@broadcast" }),
      msg({ id: "N", jid: "1203630@newsletter" }),
      msg({ id: "F", fromMe: true }),
    ]);
    await flush();
    await flush();
    expect(webhook).not.toHaveBeenCalled();
  });

  it("resolves a LID to its number, and replies to the LID", async () => {
    const sock = await linked();
    sock.lids.set("99887766@lid", "6289876543210@s.whatsapp.net");
    sock.msgs([msg({ jid: "99887766@lid" })]);
    await vi.waitFor(() => expect(webhook).toHaveBeenCalledTimes(1));
    const delivered = JSON.parse(
      String((webhook.mock.calls[0]![1] as RequestInit).body),
    );
    expect(delivered.entry[0].changes[0].value.messages[0].from).toBe(
      "6289876543210",
    );
    await sendText({
      credentials: {
        whatsappToken: "x",
        phoneNumberId: "baileys",
        graphVersion: "v25.0",
      },
      to: "6289876543210",
      body: "Halo",
      fetchImpl: gatewayFetch({ url: base, secret: SECRET }),
    });
    expect(sock.sent[0]?.jid).toBe("99887766@lid");
  });

  it("does not retry a delivery the webhook refused (a wrong APP_SECRET)", async () => {
    webhook.mockImplementation(async () => new Response("no", { status: 401 }));
    const sock = await linked();
    sock.msgs([msg({})]);
    await vi.waitFor(() => expect(webhook).toHaveBeenCalledTimes(1));
    await flush();
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("retries a webhook that is down", async () => {
    webhook
      .mockImplementationOnce(async () => {
        throw new Error("ECONNREFUSED");
      })
      .mockImplementationOnce(async () => new Response("ok", { status: 200 }));
    const sock = await linked();
    sock.msgs([msg({})]);
    await vi.waitFor(() => expect(webhook).toHaveBeenCalledTimes(2));
  });
});
