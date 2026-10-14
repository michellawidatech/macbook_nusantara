/**
 * `/new` — a tester starts their conversation over (owner ask 2026-10-14).
 *
 * Three claims, each about a row: the command is honoured from a tester and
 * from nobody else; it works on the thread the draft pass cannot see, the one
 * held for a person; and what it leaves behind is no longer READ, while every
 * message is still there.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import {
  RESET_INTENT,
  RESET_REPLY,
  TESTERS_SETTING_KEY,
  type AgentClient,
  type CreateArgs,
} from "@nusantara/agent";
import { draftPass } from "../src/draft.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

const TESTER = "628980092978";
const CUSTOMER = "628111000888";

const NOW = new Date("2026-10-14T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: TESTERS_SETTING_KEY } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.outbox.deleteMany({});
  await db.waThreadMemory.deleteMany({});
  await db.chatAction.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  await db.waMessage.deleteMany({});
  await db.appSetting.upsert({
    where: { key: TESTERS_SETTING_KEY },
    // As somebody types it; read back as a wa_id.
    update: { value: "0898-0092-978", updatedAt: NOW },
    create: {
      key: TESTERS_SETTING_KEY,
      value: "0898-0092-978",
      updatedAt: NOW,
    },
  });
});

async function inbound(opts: {
  id: string;
  from: string;
  text: string;
  ts: Date;
  status?: "BARU" | "DIJAWAB_AGEN" | "PERLU_STAF";
  replyText?: string;
  answeredAt?: Date;
  intent?: string;
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
      status: opts.status ?? "BARU",
      entities: {},
      answeredByAgent: opts.status === "DIJAWAB_AGEN",
      replyText: opts.replyText ?? null,
      answeredAt: opts.answeredAt ?? null,
      intent: opts.intent ?? null,
    },
  });
}

/** A model that greets, recording what it was shown. */
function greeter(): { client: AgentClient; calls: CreateArgs[] } {
  const calls: CreateArgs[] = [];
  const create = async (args: CreateArgs) => {
    calls.push(args);
    return {
      content: [
        {
          type: "tool_use" as const,
          id: `toolu_${calls.length}`,
          name: "reply",
          input: { message: "halo kak", sources: "greeting" },
        },
      ],
      stop_reason: "tool_use" as const,
    };
  };
  return { client: { messages: { create } } as unknown as AgentClient, calls };
}

const pass = (client: AgentClient, now: Date = NOW) =>
  draftPass({
    db,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    now: () => now,
  });

const row = (id: string) =>
  db.waMessage.findUniqueOrThrow({ where: { waMessageId: id } });

/** A thread the bot answered once and then handed to a person. */
async function heldThread(from: string) {
  await inbound({
    id: `${from}.old`,
    from,
    text: "garansinya berapa lama",
    ts: ago(3_600_000),
    status: "DIJAWAB_AGEN",
    replyText: "Garansi SATU-BULAN ya kak",
    answeredAt: ago(3_590_000),
    intent: "jawab:faq",
  });
  const held = await inbound({
    id: `${from}.held`,
    from,
    text: "air m1 masih ada?",
    ts: ago(1_800_000),
    status: "PERLU_STAF",
    replyText: "Kami cekkan dulu ya kak",
    answeredAt: ago(1_790_000),
    intent: "staf:stock",
  });
  await db.chatAction.create({
    data: {
      from,
      kind: "STOCK",
      topic: "stock",
      summary: "Tanya stok Air M1",
      messageId: held.id,
      createdAt: ago(1_790_000),
      updatedAt: ago(1_790_000),
    },
  });
  await db.waThreadMemory.create({
    data: {
      from,
      summary: "Pelanggan mencari Air M1.",
      summaryAt: ago(1_700_000),
      summaryTurns: 2,
      clarifyCount: 0,
      updatedAt: ago(1_700_000),
    },
  });
}

describe("/new from a tester", () => {
  it("starts a held thread over, without asking the model", async () => {
    await heldThread(TESTER);
    // Typed a second ago: no debounce is waited out for a command.
    await inbound({
      id: "t.new",
      from: TESTER,
      text: " /NEW ",
      ts: ago(1_000),
    });

    const { client, calls } = greeter();
    await pass(client);
    expect(calls).toHaveLength(0);

    const mark = await row("t.new");
    expect(mark).toMatchObject({
      status: "DIJAWAB_AGEN",
      intent: RESET_INTENT,
      replyText: RESET_REPLY,
    });
    // The hold is what a PERLU_STAF row is; none is left.
    expect(
      await db.waMessage.count({
        where: { from: TESTER, status: "PERLU_STAF" },
      }),
    ).toBe(0);
    expect(
      await db.chatAction.count({ where: { from: TESTER, status: "OPEN" } }),
    ).toBe(0);
    expect(
      await db.waThreadMemory.findUniqueOrThrow({ where: { from: TESTER } }),
    ).toMatchObject({ summary: null, coveredThroughId: mark.id });

    const sends = await db.outbox.findMany({});
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload).toMatchObject({ to: TESTER, body: RESET_REPLY });

    // Nothing was deleted, and no earlier answer was rewritten.
    expect(await db.waMessage.count({ where: { from: TESTER } })).toBe(3);
    expect((await row(`${TESTER}.old`)).replyText).toBe(
      "Garansi SATU-BULAN ya kak",
    );
  });

  it("answers the next message with none of the earlier conversation", async () => {
    await heldThread(TESTER);
    await inbound({ id: "t.new", from: TESTER, text: "/new", ts: ago(60_000) });
    await pass(greeter().client, ago(50_000));

    await inbound({
      id: "t.next",
      from: TESTER,
      text: "halo",
      ts: ago(30_000),
    });
    const { client, calls } = greeter();
    await pass(client);

    expect(calls).toHaveLength(1);
    const shown = JSON.stringify([calls[0]!.system, calls[0]!.messages]);
    expect(shown).toContain("halo");
    expect(shown).not.toContain("SATU-BULAN");
    expect(shown).not.toContain("Kami cekkan dulu");
    expect(shown).not.toContain("Pelanggan mencari Air M1");
    expect(shown).not.toContain(RESET_REPLY);
    expect(await row("t.next")).toMatchObject({ status: "DIJAWAB_AGEN" });
  });

  it("closes what was typed before the command and keeps what came after", async () => {
    await inbound({
      id: "t.before",
      from: TESTER,
      text: "eh",
      ts: ago(40_000),
    });
    await inbound({ id: "t.new", from: TESTER, text: "/new", ts: ago(35_000) });
    await inbound({
      id: "t.after",
      from: TESTER,
      text: "halo",
      ts: ago(30_000),
    });

    const { client, calls } = greeter();
    await pass(client);

    expect(await row("t.before")).toMatchObject({
      status: "DIJAWAB_AGEN",
      intent: RESET_INTENT,
      replyText: null,
    });
    // The first words of the new conversation, answered in the same pass.
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]!.messages)).not.toContain("eh");
    expect(await row("t.after")).toMatchObject({
      status: "DIJAWAB_AGEN",
      replyText: "halo kak",
    });
  });
});

describe("/new from anybody else", () => {
  it("is an ordinary message, and lifts nothing", async () => {
    await heldThread(CUSTOMER);
    await inbound({
      id: "c.new",
      from: CUSTOMER,
      text: "/new",
      ts: ago(30_000),
    });

    const { client, calls } = greeter();
    await pass(client);

    // Still held for the colleague: the bot says nothing and the task stays.
    expect(calls).toHaveLength(0);
    expect(await row("c.new")).toMatchObject({ status: "BARU", intent: null });
    expect(
      await db.chatAction.count({ where: { from: CUSTOMER, status: "OPEN" } }),
    ).toBe(1);
    expect(await db.outbox.count({})).toBe(0);
  });

  it("is read by the model as text when the thread is not held", async () => {
    await inbound({
      id: "c.new",
      from: CUSTOMER,
      text: "/new",
      ts: ago(30_000),
    });
    const { client, calls } = greeter();
    await pass(client);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]!.messages)).toContain("/new");
    expect((await row("c.new")).intent).not.toBe(RESET_INTENT);
  });
});
