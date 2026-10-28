/**
 * A new hand-over sends each staff alert number one WhatsApp line (owner,
 * 2026-10-28) — queued in the hand-over's own transaction, as the worker's
 * own role, and only once per task.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { upsertChatAction } from "../src/actions.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

const CUSTOMER = "628111000555";
let owner: PrismaClient;
let agent: PrismaClient;

beforeAll(async () => {
  owner = new PrismaClient({ datasourceUrl: URL });
  agent = new PrismaClient({ datasourceUrl: asRole("nusantara_agent") });
});
afterAll(async () => {
  await truncateAll(owner);
  await owner.$disconnect();
  await agent.$disconnect();
});
beforeEach(async () => {
  await truncateAll(owner);
  await owner.waMessage.create({
    data: {
      waMessageId: "wamid.SA1",
      from: CUSTOMER,
      name: "Budi",
      text: "mau chat sama admin dong",
      msgType: "text",
      ts: new Date(),
      direction: "IN",
      status: "PERLU_STAF",
      entities: {},
      answeredByAgent: true,
    },
  });
});

const handOver = () =>
  agent.$transaction((tx) =>
    upsertChatAction(tx, {
      from: CUSTOMER,
      topic: "human",
      summary: "Perlu dibalas — minta bicara dengan admin",
      customerText: "mau chat sama admin dong",
      now: new Date(),
    }),
  );

describe("staff alerts on WhatsApp", () => {
  it("queue one line per alert number for a NEW hand-over, and nothing for a refresh", async () => {
    await owner.appSetting.create({
      data: {
        key: "chatbot.notifyNumbers",
        value: "628123456789,628987654321",
        updatedAt: new Date(),
      },
    });
    await handOver();
    await handOver();
    const rows = await owner.outbox.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    const bodies = rows.map((r) => r.payload as { to: string; body: string });
    expect(bodies.map((b) => b.to).sort()).toEqual([
      "628123456789",
      "628987654321",
    ]);
    expect(bodies[0]!.body).toContain("🔔 Perlu dibalas — Budi (628111000555)");
    expect(bodies[0]!.body).toContain('"mau chat sama admin dong"');
    expect(bodies[0]!.body).toContain("/chat?phone=628111000555");
  });

  it("sends nothing when no number is set", async () => {
    await handOver();
    expect(await owner.outbox.count()).toBe(0);
  });
});
