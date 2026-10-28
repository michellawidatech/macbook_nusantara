/**
 * Is the chatbot working? (owner, 2026-10-28) — the checks, and the staff
 * alert that goes out on a CHANGE, straight through the gateway.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { checkChatHealth, healthTick } from "../src/chatHealth.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const logger = createLogger({ app: "test", env: "test", level: "silent" });
const gateway = { url: "http://gateway.test", secret: "s" };
let db: PrismaClient;

/** The gateway, faked: connected or not, and every send it was asked for. */
function fakeGateway(state = "CONNECTED") {
  const sent: Array<{ to: string; body: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/status"))
      return new Response(JSON.stringify({ state }), { status: 200 });
    const b = JSON.parse(String(init?.body)) as {
      to: string;
      text: { body: string };
    };
    sent.push({ to: b.to, body: b.text.body });
    return new Response(JSON.stringify({ messages: [{ id: "x" }] }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const waiting = (from: string, agoMs: number) =>
  db.waMessage.create({
    data: {
      waMessageId: `wamid.H.${from}.${agoMs}`,
      from,
      text: "halo",
      msgType: "text",
      ts: new Date(Date.now() - agoMs),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
});
afterAll(async () => {
  await truncateAll(db);
  await db.$disconnect();
});
beforeEach(async () => {
  await truncateAll(db);
  await db.appSetting.create({
    data: {
      key: "chatbot.notifyNumbers",
      value: "628123456789:Dina",
      updatedAt: new Date(),
    },
  });
});

describe("the chatbot health check", () => {
  it("is fine when nothing waits, and names a message the bot left 5+ minutes", async () => {
    const g = fakeGateway();
    expect(
      (await checkChatHealth(db, { gateway, logger, fetchImpl: g.fetchImpl }))
        .ok,
    ).toBe(true);
    await waiting("628111000001", 2 * 60_000);
    expect(
      (await checkChatHealth(db, { gateway, logger, fetchImpl: g.fetchImpl }))
        .ok,
    ).toBe(true);
    await waiting("628111000002", 7 * 60_000);
    const h = await checkChatHealth(db, {
      gateway,
      logger,
      fetchImpl: g.fetchImpl,
    });
    expect(h.problems).toEqual([{ code: "BOT_STALE", minutes: 7 }]);
  });

  it("ignores an alert number's own messages, and reports WhatsApp disconnected", async () => {
    await waiting("628123456789", 30 * 60_000);
    const g = fakeGateway("DISCONNECTED");
    const h = await checkChatHealth(db, {
      gateway,
      logger,
      fetchImpl: g.fetchImpl,
    });
    expect(h.problems).toEqual([{ code: "WA_DISCONNECTED" }]);
  });

  it("alerts staff once when it breaks and once when it recovers — and says nothing on the first check", async () => {
    const g = fakeGateway();
    await healthTick(db, { gateway, logger, fetchImpl: g.fetchImpl });
    expect(g.sent).toHaveLength(0);
    const m = await waiting("628111000003", 8 * 60_000);
    await healthTick(db, { gateway, logger, fetchImpl: g.fetchImpl });
    await healthTick(db, { gateway, logger, fetchImpl: g.fetchImpl });
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.to).toBe("628123456789");
    expect(g.sent[0]!.body).toMatch(
      /^⚠️ Chatbot bermasalah: pesan pelanggan belum dibalas bot \(8 menit\)/,
    );
    await db.waMessage.update({
      where: { id: m.id },
      data: { status: "DIJAWAB_AGEN" },
    });
    await healthTick(db, { gateway, logger, fetchImpl: g.fetchImpl });
    expect(g.sent.map((s) => s.body)).toEqual([
      expect.stringMatching(/^⚠️/),
      "✅ Chatbot sudah normal lagi.",
    ]);
  });
});
