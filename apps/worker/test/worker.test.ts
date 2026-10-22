/**
 * The worker's two passes, against a real PostgreSQL.
 *
 * The claims worth proving are the ones that decide whether a customer gets an
 * answer, and every one of them is about a *failure* path:
 *
 *   - an unconfigured worker leaves the queue alone rather than burning
 *     attempts against a machine that cannot send;
 *   - a send that Graph rejects goes back to PENDING with a backoff, not to
 *     SENT;
 *   - a reply that outlived the 24-hour window fails once, loudly, instead of
 *     retrying into a wall;
 *   - the debounce actually holds a reply back while a customer is still typing.
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
import { draftPass } from "../src/draft.js";
import { sendPass } from "../src/send.js";
import { loadWorkerConfig } from "../src/config.js";

/**
 * These tests are about the single AI agent (pipeline v1). The default is the
 * rules-first bot since 2026-10-15, so the setting is pinned here.
 */
async function pinPipelineV1(client: {
  appSetting: PrismaClient["appSetting"];
}) {
  await client.appSetting.upsert({
    where: { key: "chatbot.pipeline" },
    update: { value: "v1" },
    create: { key: "chatbot.pipeline", value: "v1", updatedAt: new Date() },
  });
}

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const CREDS = {
  whatsappToken: "test-token",
  phoneNumberId: "1200651716467039",
  graphVersion: "v25.0",
};

/**
 * Quiet: these tests exercise failure paths on purpose, and the warnings and
 * errors they provoke are the expected result rather than noise worth printing.
 */
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "chatbot.pipeline" } });
  await db.$disconnect();
});

beforeEach(async () => {
  await pinPipelineV1(db);
  await db.outbox.deleteMany({});
  // ChatAction points at WaMessage, Unit and Customer (2026-09-29).
  await db.chatAction.deleteMany({});
  await db.customerProfileFact.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  // Chunks first: their message links are RESTRICT (20261022120000).
  await db.chatMemoryChunk.deleteMany({});
  await db.waMessage.deleteMany({});
});

/** An inbound message as the webhook writes it. */
async function inbound(opts: {
  id: string;
  from: string;
  text: string;
  ts: Date;
}) {
  return db.waMessage.create({
    data: {
      waMessageId: opts.id,
      from: opts.from,
      name: "Test",
      text: opts.text,
      msgType: "text",
      ts: opts.ts,
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("loadWorkerConfig", () => {
  it("pins the Graph version rather than falling back twice", () => {
    const config = loadWorkerConfig({});
    expect(config.whatsapp.graphVersion).toBe("v25.0");
  });

  it("ignores a non-numeric interval instead of producing NaN", () => {
    // A NaN poll interval turns setTimeout into a busy loop.
    expect(loadWorkerConfig({ WORKER_POLL_MS: "soon" }).idlePollMs).toBe(2_000);
  });
});

describe("draftPass", () => {
  it("answers by the rules with no Anthropic credential, whatever was stored", async () => {
    // One agent, and nobody chooses (owner, 2026-10-21): the stored "v1" is
    // ignored, and with no key the rules answer rather than nobody.
    await inbound({
      id: "wamid.D1",
      from: "628111000111",
      text: "halo",
      ts: new Date(Date.now() - 60_000),
    });

    const result = await draftPass({
      db,
      logger,
      anthropic: {},
      debounceMs: 1_000,
      maxDraftsPerTick: 5,
    });

    expect(result).toMatchObject({ drafted: 1, dormant: false });
    const run = await db.agentRun.findFirstOrThrow({
      where: { from: "628111000111" },
    });
    expect(run.pipeline).toBe("rules");
  });

  it("hands a thread to a person once the 24-hour window has closed", async () => {
    // Two days old: no free-form reply can reach this customer.
    await inbound({
      id: "wamid.D2",
      from: "628111000222",
      text: "masih ada?",
      ts: new Date(Date.now() - 48 * 60 * 60_000),
    });

    const result = await draftPass({
      db,
      logger,
      // A credential the SDK will never be asked to use: the window check
      // happens before the model call.
      anthropic: { apiKey: "sk-ant-test" },
      debounceMs: 1_000,
      maxDraftsPerTick: 5,
    });

    expect(result.escalated).toBe(1);
    expect(result.drafted).toBe(0);
    const rows = await db.waMessage.findMany({
      where: { from: "628111000222" },
    });
    expect(rows.every((r) => r.status === "PERLU_STAF")).toBe(true);
  });

  it("holds back a reply while the customer is still typing", async () => {
    // Arrived a moment ago, debounce is ten seconds: not yet eligible.
    await inbound({
      id: "wamid.D3",
      from: "628111000333",
      text: "halo",
      ts: new Date(),
    });

    const result = await draftPass({
      db,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      debounceMs: 10_000,
      maxDraftsPerTick: 5,
    });

    expect(result).toEqual({ drafted: 0, escalated: 0, dormant: false });
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: "628111000333" },
    });
    expect(row.status).toBe("BARU");
  });
});

describe("sendPass", () => {
  it("does not claim anything when no WhatsApp token is configured", async () => {
    await db.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: "628111000444", body: "halo" },
      });
    });

    const result = await sendPass({
      db,
      logger,
      credentials: { ...CREDS, whatsappToken: "" },
      maxSendsPerTick: 10,
    });

    expect(result.dormant).toBe(true);
    // Untouched, so it flushes the moment a token is configured — rather than
    // having burned six attempts against a machine that could never send.
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
  });

  it("sends a queued reply and marks it SENT", async () => {
    await db.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: "628111000555", body: "ready kak" },
      });
    });

    const fetchImpl = stubFetch(200, { messages: [{ id: "wamid.OUT" }] });
    const result = await sendPass({
      db,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 10,
      fetchImpl,
    });

    expect(result.sent).toBe(1);
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("SENT");
    expect(row.sentAt).not.toBeNull();
  });

  it("retries a Graph error carried by a 200 instead of marking it sent", async () => {
    await db.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: "628111000666", body: "halo" },
      });
    });

    const fetchImpl = stubFetch(200, {
      error: { message: "rate limited", code: 131056 },
    });
    const result = await sendPass({
      db,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 10,
      fetchImpl,
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    const row = await db.outbox.findFirstOrThrow({});
    // Back in the queue with a backoff, not silently marked as delivered.
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("131056");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("fails a malformed payload once rather than retrying it six times", async () => {
    await db.$transaction(async (tx) => {
      // `Outbox.payload` is a sanctioned JSON column, so Postgres does not
      // enforce its shape and an older writer could have produced this.
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { body: "no recipient" },
      });
    });

    const fetchImpl = stubFetch(200, { messages: [{ id: "wamid.NOPE" }] });
    const result = await sendPass({
      db,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 10,
      fetchImpl,
    });

    expect(result.failed).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("FAILED");
  });

  it("fails a reply that outlived the 24-hour window without calling Graph", async () => {
    await db.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: "628111000777", body: "maaf telat" },
      });
    });
    // Backdate the intent past the window.
    await db.outbox.updateMany({
      data: { createdAt: new Date(Date.now() - 30 * 60 * 60_000) },
    });

    const fetchImpl = stubFetch(200, { messages: [{ id: "wamid.LATE" }] });
    const result = await sendPass({
      db,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 10,
      fetchImpl,
    });

    expect(result.failed).toBe(1);
    // Graph would have answered 200 and delivered nothing (06 §11).
    expect(fetchImpl).not.toHaveBeenCalled();
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("24-hour window");
  });
});
