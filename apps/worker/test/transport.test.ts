/**
 * `WHATSAPP_TRANSPORT` (owner decision 2026-10-22): the Cloud API unchanged by
 * default, or the same Graph requests sent to the Baileys gateway on loopback.
 * The send pass is the real one in both modes, against a real PostgreSQL —
 * only the fetch underneath it differs, which is the whole point.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient, enqueueOutbox } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { sendPass } from "../src/send.js";
import {
  BAILEYS_TOKEN_PLACEHOLDER,
  loadWorkerConfig,
  sendFetchFor,
} from "../src/config.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});
afterAll(async () => {
  await db.outbox.deleteMany({});
  await db.$disconnect();
});
beforeEach(async () => {
  await db.outbox.deleteMany({});
});

/** Graph's success answer, recording what it was asked. */
function recorder() {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

async function queueReply() {
  await db.$transaction(async (tx) => {
    await enqueueOutbox(tx, {
      kind: "WA_REPLY",
      payload: { to: "628111000777", body: "ready kak" },
    });
  });
}

describe("the transport setting", () => {
  it("is the Cloud API when nobody says otherwise", () => {
    const config = loadWorkerConfig({
      WHATSAPP_TOKEN: "meta-token",
      PHONE_NUMBER_ID: "1200651716467039",
    });
    expect(config.transport).toEqual({ kind: "cloud" });
    expect(config.whatsapp.whatsappToken).toBe("meta-token");
    expect(sendFetchFor(config.transport)).toBeUndefined();
  });

  it("needs no WHATSAPP_TOKEN in Baileys mode, and never uses one left behind", () => {
    const config = loadWorkerConfig({
      WHATSAPP_TRANSPORT: "baileys",
      WA_GATEWAY_URL: "http://127.0.0.1:3002",
      WA_GATEWAY_SECRET: "gateway-secret-123",
      WHATSAPP_TOKEN: "an-old-meta-token",
    });
    expect(config.transport).toEqual({
      kind: "baileys",
      url: "http://127.0.0.1:3002",
      secret: "gateway-secret-123",
    });
    expect(config.whatsapp.whatsappToken).toBe(BAILEYS_TOKEN_PLACEHOLDER);
    expect(config.whatsapp.phoneNumberId).toBe("baileys");
  });

  it("stays Baileys — and dormant — with the gateway half-configured", () => {
    const config = loadWorkerConfig({
      WHATSAPP_TRANSPORT: "baileys",
      WA_GATEWAY_URL: "http://127.0.0.1:3002",
      WHATSAPP_TOKEN: "meta-token",
    });
    expect(config.transport.kind).toBe("baileys");
    expect(config.whatsapp.whatsappToken).toBe("");
    expect(sendFetchFor(config.transport)).toBeUndefined();
  });
});

describe("sendPass, per transport", () => {
  it("cloud: Graph at graph.facebook.com with the bearer token", async () => {
    await queueReply();
    const config = loadWorkerConfig({
      WHATSAPP_TOKEN: "meta-token",
      PHONE_NUMBER_ID: "1200651716467039",
    });
    const graph = recorder();
    const result = await sendPass({
      db,
      logger,
      credentials: config.whatsapp,
      maxSendsPerTick: 5,
      fetchImpl: graph as unknown as typeof fetch,
    });
    expect(result.sent).toBe(1);
    const [url, init] = graph.mock.calls[0]!;
    expect(url).toBe(
      "https://graph.facebook.com/v25.0/1200651716467039/messages",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer meta-token",
    );
  });

  it("baileys: the same body to the gateway, with its secret and no token", async () => {
    await queueReply();
    const config = loadWorkerConfig({
      WHATSAPP_TRANSPORT: "baileys",
      WA_GATEWAY_URL: "http://127.0.0.1:3002",
      WA_GATEWAY_SECRET: "gateway-secret-123",
    });
    const gateway = recorder();
    const result = await sendPass({
      db,
      logger,
      credentials: config.whatsapp,
      maxSendsPerTick: 5,
      fetchImpl: sendFetchFor(
        config.transport,
        gateway as unknown as typeof fetch,
      )!,
    });
    expect(result).toMatchObject({ sent: 1, dormant: false });
    const [url, init] = gateway.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3002/graph/v25.0/baileys/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-wa-gateway-secret")).toBe("gateway-secret-123");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: "628111000777",
      type: "text",
      text: { body: "ready kak" },
    });
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("SENT");
  });

  it("baileys, half-configured: the queue is left alone", async () => {
    await queueReply();
    const config = loadWorkerConfig({
      WHATSAPP_TRANSPORT: "baileys",
      WA_GATEWAY_URL: "http://127.0.0.1:3002",
    });
    const result = await sendPass({
      db,
      logger,
      credentials: config.whatsapp,
      maxSendsPerTick: 5,
    });
    expect(result.dormant).toBe(true);
    expect((await db.outbox.findFirstOrThrow({})).attempts).toBe(0);
  });
});
