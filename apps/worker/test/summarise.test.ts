/**
 * Scheduling the rolling summary.
 *
 * The summary itself is tested in `packages/agent`. What is proved here is
 * *when* it runs and *what moves* when it does, because every failure mode in
 * this pass is silent and permanent:
 *
 *   - a cursor that advances on a failure skips turns forever, leaving a hole
 *     in what the agent remembers;
 *   - a cursor that never advances re-summarises the same conversation on every
 *     tick, at one model call each;
 *   - reading newest-first jumps a backlog, so an outage costs you the middle
 *     of a conversation rather than a delay.
 *
 * The model is scripted, not mocked — `vi.mock` appears nowhere in this repo.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentClient, CreateArgs } from "@nusantara/agent";
import { summaryPass } from "../src/summarise.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

const FROM = "628111000555";
const OTHER = "628111000666";
const NOW = new Date("2026-08-20T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  // Memory first: coveredThroughId is an FK to WaMessage, onDelete Restrict.
  await db.waThreadMemory.deleteMany({});
  // ChatAction points at WaMessage, Unit and Customer (2026-09-29).
  await db.chatAction.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  await db.waMessage.deleteMany({});
});

/** One answered turn — a burst the agent already replied to. */
async function turn(opts: {
  id: string;
  from?: string;
  text: string;
  reply: string;
  answeredAt: Date;
}) {
  return db.waMessage.create({
    data: {
      waMessageId: opts.id,
      from: opts.from ?? FROM,
      text: opts.text,
      msgType: "text",
      ts: opts.answeredAt,
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      replyText: opts.reply,
      answeredByAgent: true,
      answeredAt: opts.answeredAt,
    },
  });
}

interface Scripted {
  readonly client: AgentClient;
  readonly calls: CreateArgs[];
}

function scripted(notes: (string | Error)[]): Scripted {
  const calls: CreateArgs[] = [];
  let n = 0;
  const create = async (args: CreateArgs) => {
    calls.push(args);
    const next = notes[n] ?? notes[notes.length - 1] ?? "catatan";
    n += 1;
    if (next instanceof Error) throw next;
    return {
      content: [{ type: "text" as const, text: next, citations: [] }],
      stop_reason: "end_turn" as const,
    };
  };
  return { client: { messages: { create } } as unknown as AgentClient, calls };
}

const pass = (client: AgentClient, over: Record<string, unknown> = {}) =>
  summaryPass({
    db,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    everyTurns: 3,
    quietMs: 900_000,
    maxPerTick: 3,
    now: () => NOW,
    ...over,
  });

/** Three answered turns, recent enough not to trip the quiet trigger. */
async function threeTurns() {
  await turn({
    id: "t.1",
    text: "ada m2?",
    reply: "ada kak",
    answeredAt: ago(60_000),
  });
  await turn({
    id: "t.2",
    text: "berapa?",
    reply: "15.500.000",
    answeredAt: ago(40_000),
  });
  return turn({
    id: "t.3",
    text: "grade A?",
    reply: "iya kak",
    answeredAt: ago(20_000),
  });
}

describe("when a summary is due", () => {
  it("does nothing before enough turns have piled up", async () => {
    await turn({
      id: "u.1",
      text: "ada m2?",
      reply: "ada kak",
      answeredAt: ago(60_000),
    });
    await turn({
      id: "u.2",
      text: "berapa?",
      reply: "15.500.000",
      answeredAt: ago(40_000),
    });

    const model = scripted(["catatan"]);
    const result = await pass(model.client);

    expect(result.refreshed).toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(await db.waThreadMemory.count()).toBe(0);
  });

  it("refreshes once the third answered turn lands", async () => {
    await threeTurns();

    const result = await pass(scripted(["Mau Air M2, budget 15jt."]).client);

    expect(result.refreshed).toBe(1);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    // The stored note loses its final full stop for the same reason a reply
    // does: `summarize` runs it through `stripFormatting`, and a note that
    // ends in one teaches the model to end its next message in one.
    expect(memo.summary).toBe("Mau Air M2, budget 15jt");
    expect(memo.summaryTurns).toBe(3);
  });

  it("refreshes a conversation that went quiet even though it never reached three turns", async () => {
    // Two turns and then silence is the shape of most real threads. Without
    // this trigger they would never be summarised at all.
    await turn({
      id: "q.1",
      text: "ada m2?",
      reply: "ada kak",
      answeredAt: ago(3_600_000),
    });
    await turn({
      id: "q.2",
      text: "oke",
      reply: "siap kak",
      answeredAt: ago(3_500_000),
    });

    const result = await pass(scripted(["Tanya Air M2, belum lanjut."]).client);
    expect(result.refreshed).toBe(1);
  });

  it("counts only the turns past the cursor, so an old conversation is not summarised twice", async () => {
    const third = await threeTurns();
    await pass(scripted(["catatan pertama"]).client);

    // Nothing new since. The thread is current, so nothing should happen.
    const model = scripted(["catatan kedua"]);
    const result = await pass(model.client);

    expect(result.refreshed).toBe(0);
    expect(model.calls).toHaveLength(0);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.coveredThroughId).toBe(third.id);
  });

  it("feeds the model the previous note and the new turns", async () => {
    await threeTurns();
    await pass(scripted(["Mau Air M2."]).client);

    await turn({
      id: "t.4",
      text: "bisa besok?",
      reply: "bisa kak",
      answeredAt: ago(10_000),
    });
    await turn({
      id: "t.5",
      text: "jam 3",
      reply: "oke",
      answeredAt: ago(9_000),
    });
    await turn({
      id: "t.6",
      text: "makasih",
      reply: "sama sama",
      answeredAt: ago(8_000),
    });

    const model = scripted(["Mau Air M2, mau datang besok jam 3."]);
    await pass(model.client);

    const sent = JSON.stringify(model.calls[0]!.messages);
    expect(sent).toContain("Mau Air M2");
    expect(sent).toContain("bisa besok?");
    // And not the turns already folded in.
    expect(sent).not.toContain("ada m2?");
  });
});

describe("failure, and why the cursor matters", () => {
  it("writes nothing but the attempt when the model fails, so the next tick retries", async () => {
    await threeTurns();

    const result = await pass(scripted([new Error("429 rate limited")]).client);

    expect(result.failed).toBe(1);
    expect(result.refreshed).toBe(0);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBeNull();
    // The cursor did NOT move. Had it moved, those three turns would never be
    // folded into any later summary.
    expect(memo.coveredThroughAt).toBeNull();
    expect(memo.summaryAt).toEqual(NOW);
  });

  it("summarises the same turns on the next tick after a failure", async () => {
    await threeTurns();
    await pass(scripted([new Error("boom")]).client);

    const result = await pass(scripted(["Mau Air M2."]).client);
    expect(result.refreshed).toBe(1);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBe("Mau Air M2");
  });

  it("advances the cursor when there is nothing worth keeping, rather than retrying forever", async () => {
    await threeTurns();

    const result = await pass(scripted(["NOTHING YET"]).client);

    expect(result.refreshed).toBe(1);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBeNull();
    expect(memo.coveredThroughAt).not.toBeNull();
  });

  it("lets another thread be summarised while one keeps failing", async () => {
    // Ordering is by last attempt, so a failing thread sorts to the back
    // instead of heading the queue forever and starving everyone else.
    await threeTurns();
    await pass(scripted([new Error("boom")]).client);

    await turn({
      id: "o.1",
      from: OTHER,
      text: "halo",
      reply: "halo kak",
      answeredAt: ago(50_000),
    });
    await turn({
      id: "o.2",
      from: OTHER,
      text: "ada ipad?",
      reply: "ada kak",
      answeredAt: ago(40_000),
    });
    await turn({
      id: "o.3",
      from: OTHER,
      text: "berapa?",
      reply: "8jt",
      answeredAt: ago(30_000),
    });

    const result = await pass(scripted(["catatan"]).client, { maxPerTick: 1 });

    expect(result.refreshed).toBe(1);
    const other = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: OTHER },
    });
    expect(other.summary).toBe("catatan");
  });

  it("keeps a staff directive through a refresh", async () => {
    await db.waThreadMemory.create({
      data: {
        from: FROM,
        directive: "kasih diskon 200rb kalau nawar",
        directiveAt: ago(100_000),
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: ago(100_000),
      },
    });
    await threeTurns();

    await pass(scripted(["Mau Air M2."]).client);

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBe("Mau Air M2");
    expect(memo.directive).toBe("kasih diskon 200rb kalau nawar");
  });
});

describe("draining a backlog", () => {
  it("folds in the oldest turns first, so an outage costs a delay and not a hole", async () => {
    // Reading newest-first and jumping the cursor is what the previous build
    // did: after an outage the middle of the conversation was lost outright.
    for (let i = 0; i < 8; i += 1) {
      await turn({
        id: `bk.${i}`,
        text: `pesan ${i}`,
        reply: `balasan ${i}`,
        answeredAt: ago(100_000 - i * 1_000),
      });
    }

    const model = scripted(["catatan"]);
    await pass(model.client, { inputLimit: 4 });

    const sent = JSON.stringify(model.calls[0]!.messages);
    expect(sent).toContain("pesan 0");
    expect(sent).toContain("pesan 3");
    expect(sent).not.toContain("pesan 4");

    // The cursor sits on the last turn actually read, not on the newest row.
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    const fourth = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "bk.3" },
    });
    expect(memo.coveredThroughId).toBe(fourth.id);
  });

  it("picks the remaining turns up on the next tick", async () => {
    for (let i = 0; i < 8; i += 1) {
      await turn({
        id: `bk2.${i}`,
        text: `pesan ${i}`,
        reply: `balasan ${i}`,
        answeredAt: ago(100_000 - i * 1_000),
      });
    }
    await pass(scripted(["catatan"]).client, { inputLimit: 4 });

    const model = scripted(["catatan lanjutan"]);
    await pass(model.client, { inputLimit: 4 });

    const sent = JSON.stringify(model.calls[0]!.messages);
    expect(sent).toContain("pesan 4");
    expect(sent).toContain("pesan 7");
  });

  it("caps how many threads it refreshes in one tick", async () => {
    for (const who of [
      "6281110001",
      "6281110002",
      "6281110003",
      "6281110004",
    ]) {
      for (let i = 0; i < 3; i += 1) {
        await turn({
          id: `${who}.${i}`,
          from: who,
          text: "halo",
          reply: "halo kak",
          answeredAt: ago(60_000 - i * 1_000),
        });
      }
    }

    const model = scripted(["catatan"]);
    const result = await pass(model.client, { maxPerTick: 2 });

    expect(result.refreshed).toBe(2);
    expect(model.calls).toHaveLength(2);
  });
});

describe("dormancy", () => {
  it("does nothing at all without a credential, rather than storing an empty note", async () => {
    await threeTurns();

    const result = await summaryPass({
      db,
      logger,
      anthropic: {},
      everyTurns: 3,
      quietMs: 900_000,
      maxPerTick: 3,
      now: () => NOW,
    });

    expect(result).toEqual({ refreshed: 0, failed: 0, dormant: true });
    expect(await db.waThreadMemory.count()).toBe(0);
  });
});
