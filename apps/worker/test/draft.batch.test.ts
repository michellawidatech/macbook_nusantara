/**
 * One burst, one answer — and the message that must not be lost.
 *
 * Every claim in this file is about a row that must or must not move, because
 * that is where the previous version of this pass went wrong. It stamped the
 * batch with `where: { from, status: 'BARU' }` evaluated at commit time, seconds
 * after the model call it was meant to cover. A customer who sent another line
 * while the model was thinking had it swept into that update and marked
 * DIJAWAB_AGEN with no `replyText` — answered by nobody.
 *
 * The consequences compounded, which is why it deserves its own file. The thread
 * then had zero BARU rows, so the draft pass never selected it again; and the
 * inbox counts pending as BARU + PERLU_STAF, so no human saw it either. The
 * message was simply gone, with no error anywhere.
 *
 * The model is scripted rather than mocked. `vi.mock` appears nowhere in this
 * repository, and `converse` takes its client as a parameter, so a fake is a
 * bare object literal — the same idiom as `stubFetch`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentClient, CreateArgs } from "@nusantara/agent";
import { draftPass } from "../src/draft.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

/** These tests provoke warnings on purpose; the warnings are the expected result. */
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

const SENDER = "628111000777";
const OTHER = "628111000888";

/** 20 August 2026, 10:00 in Jakarta. The shop has just opened. */
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
  await db.outbox.deleteMany({});
  // WaThreadMemory.coveredThroughId is an FK to WaMessage with onDelete:
  // Restrict, so the memory rows have to go first.
  await db.waThreadMemory.deleteMany({});
  await db.waMessage.deleteMany({});
});

/** An inbound message as the webhook writes it. */
async function inbound(opts: {
  id: string;
  from: string;
  text: string | null;
  ts: Date;
  msgType?: string;
}) {
  return db.waMessage.create({
    data: {
      waMessageId: opts.id,
      from: opts.from,
      name: "Test",
      text: opts.text,
      msgType: opts.msgType ?? "text",
      ts: opts.ts,
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

interface Scripted {
  readonly client: AgentClient;
  readonly calls: CreateArgs[];
  /** Runs before the Nth (0-based) response resolves. Races a real row in. */
  before(n: number, fn: () => Promise<void>): void;
}

/**
 * A model that answers with fixed text, recording what it was asked.
 *
 * `before` is the whole reason this exists rather than a one-line stub: the
 * mid-draft race can only be tested by inserting a row *while* the call is in
 * flight, and doing that for real is far better evidence than asserting on a
 * predicate.
 */
function scripted(replies: string[]): Scripted {
  const calls: CreateArgs[] = [];
  const hooks = new Map<number, () => Promise<void>>();
  let n = 0;

  const create = async (args: CreateArgs) => {
    calls.push(args);
    const i = n;
    n += 1;
    const hook = hooks.get(i);
    if (hook) await hook();
    const text = replies[i] ?? replies[replies.length - 1] ?? "siap kak";
    return {
      content: [{ type: "text" as const, text, citations: [] }],
      stop_reason: "end_turn" as const,
    };
  };

  return {
    client: { messages: { create } } as unknown as AgentClient,
    calls,
    before(i, fn) {
      hooks.set(i, fn);
    },
  };
}

const pass = (client: AgentClient, over: Record<string, unknown> = {}) =>
  draftPass({
    db,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    now: () => NOW,
    ...over,
  });

describe("batching a burst", () => {
  it("answers a burst of four messages with one reply and one outbox row", async () => {
    // A customer typing the way people actually type.
    await inbound({ id: "b.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({ id: "b.2", from: SENDER, text: "mau tanya", ts: ago(28_000) });
    await inbound({ id: "b.3", from: SENDER, text: "ada macbook air m2", ts: ago(26_000) });
    await inbound({ id: "b.4", from: SENDER, text: "yang 256gb", ts: ago(24_000) });

    const model = scripted(["ada kak, harganya 15.500.000"]);
    const result = await pass(model.client);

    expect(result.drafted).toBe(1);
    expect(model.calls).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("joins the burst into one customer turn, in the order it was typed", async () => {
    await inbound({ id: "j.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({ id: "j.2", from: SENDER, text: "ada m2 ga", ts: ago(28_000) });

    const model = scripted(["ada kak"]);
    await pass(model.client);

    const sent = model.calls[0]!;
    const last = sent.messages[sent.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toBe("halo\nada m2 ga");
  });

  it("moves every message the reply covered off BARU, and only those", async () => {
    await inbound({ id: "c.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({ id: "c.2", from: SENDER, text: "ada m2?", ts: ago(28_000) });
    await inbound({ id: "c.3", from: OTHER, text: "halo juga", ts: ago(1_000) });

    await pass(scripted(["ada kak"]).client);

    const mine = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(mine.every((m) => m.status === "DIJAWAB_AGEN")).toBe(true);
    expect(mine.every((m) => m.answeredByAgent)).toBe(true);

    // The other sender arrived a second ago and is still typing.
    const theirs = await db.waMessage.findFirstOrThrow({ where: { from: OTHER } });
    expect(theirs.status).toBe("BARU");
  });

  it("records the reply on exactly one row, so the thread reads as one answered turn", async () => {
    await inbound({ id: "r.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({ id: "r.2", from: SENDER, text: "ada m2?", ts: ago(28_000) });

    await pass(scripted(["ada kak"]).client);

    const withReply = await db.waMessage.findMany({
      where: { from: SENDER, replyText: { not: null } },
    });
    // Four rows each carrying the reply would count as four turns, and the
    // summary scheduler counts turns.
    expect(withReply).toHaveLength(1);
    expect(withReply[0]!.waMessageId).toBe("r.2");
  });

  it("leaves a message that arrived during drafting at BARU rather than marking it answered", async () => {
    // The bug this guards is silent message loss: the row was stamped
    // DIJAWAB_AGEN with no replyText, which removed it from the agent's queue
    // AND from the inbox's pending count, so nobody ever saw it.
    await inbound({ id: "m.1", from: SENDER, text: "ada m2?", ts: ago(30_000) });

    const model = scripted(["ada kak"]);
    model.before(0, async () => {
      await inbound({ id: "m.late", from: SENDER, text: "eh yang 512 aja", ts: NOW });
    });

    await pass(model.client);

    const late = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "m.late" },
    });
    expect(late.status).toBe("BARU");
    expect(late.replyText).toBeNull();
    expect(late.answeredByAgent).toBe(false);
  });

  it("answers the message that arrived during drafting on the very next pass", async () => {
    await inbound({ id: "n.1", from: SENDER, text: "ada m2?", ts: ago(30_000) });

    const first = scripted(["ada kak"]);
    first.before(0, async () => {
      await inbound({ id: "n.late", from: SENDER, text: "yang 512 aja", ts: ago(20_000) });
    });
    await pass(first.client);

    const second = await pass(scripted(["yang 512 ready juga"]).client);
    expect(second.drafted).toBe(1);

    const late = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "n.late" },
    });
    expect(late.status).toBe("DIJAWAB_AGEN");
    expect(late.replyText).toBe("yang 512 ready juga");
  });

  it("discards its draft when a staff member answers the thread first", async () => {
    // The compare-and-swap earns its keep here: without it the agent's stale
    // reply would be queued on top of the human's, and the customer would get
    // two answers to one question.
    await inbound({ id: "s.1", from: SENDER, text: "boleh nego?", ts: ago(30_000) });

    const model = scripted(["harganya pas kak"]);
    model.before(0, async () => {
      await db.waMessage.updateMany({
        where: { from: SENDER },
        data: { status: "DIJAWAB_STAF", replyText: "boleh kak, sini saya bantu" },
      });
    });

    const result = await pass(model.client);

    expect(result.drafted).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    const row = await db.waMessage.findFirstOrThrow({ where: { from: SENDER } });
    expect(row.status).toBe("DIJAWAB_STAF");
    expect(row.replyText).toBe("boleh kak, sini saya bantu");
  });

  it("caps one reply at the batch ceiling rather than sending one giant answer", async () => {
    for (let i = 0; i < 6; i += 1) {
      await inbound({
        id: `cap.${i}`,
        from: SENDER,
        text: `baris ${i}`,
        ts: ago(30_000 - i * 100),
      });
    }

    await pass(scripted(["oke kak"]).client, { maxBatch: 4 });

    expect(await db.waMessage.count({ where: { from: SENDER, status: "BARU" } })).toBe(2);
  });
});

describe("the adaptive wait", () => {
  it("answers a customer who asked a question before one who is still muttering", async () => {
    // Both last spoke 6 seconds ago: past the 4s question wait, short of the
    // 8s base window.
    await inbound({ id: "a.q", from: SENDER, text: "ada m2?", ts: ago(6_000) });
    await inbound({ id: "a.f", from: OTHER, text: "hmm", ts: ago(6_000) });

    const model = scripted(["ada kak"]);
    const result = await pass(model.client);

    expect(result.drafted).toBe(1);
    expect(model.calls).toHaveLength(1);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: SENDER } })).status,
    ).toBe("DIJAWAB_AGEN");
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: OTHER } })).status,
    ).toBe("BARU");
  });

  it("keeps waiting on nanti saya kabarin long after an ordinary message would have been answered", async () => {
    // 20 seconds: well past the base window, well short of the 45s hold.
    await inbound({
      id: "w.later",
      from: SENDER,
      text: "nanti saya kabarin ya",
      ts: ago(20_000),
    });

    const result = await pass(scripted(["siap kak"]).client);
    expect(result.drafted).toBe(0);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: SENDER } })).status,
    ).toBe("BARU");
  });

  it("does not let a sender who is still typing hold up anybody else", async () => {
    await inbound({ id: "f.1", from: SENDER, text: "bentar", ts: ago(1_000) });
    await inbound({ id: "f.2", from: OTHER, text: "ada m2?", ts: ago(10_000) });

    const result = await pass(scripted(["ada kak"]).client);

    expect(result.drafted).toBe(1);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: OTHER } })).status,
    ).toBe("DIJAWAB_AGEN");
  });

  it("answers a sender whose phone clock runs ahead, instead of waiting on them forever", async () => {
    // `ts` comes from the sender's device. A clock ten minutes fast makes the
    // elapsed time negative, and no wait ever elapses — the thread starves,
    // silently, which is strictly worse than answering slightly early.
    await inbound({
      id: "skew.1",
      from: SENDER,
      text: "ada m2",
      ts: new Date(NOW.getTime() + 600_000),
    });

    const result = await pass(scripted(["ada kak"]).client);
    expect(result.drafted).toBe(1);
  });

  it("is not held back by a newer message that was already answered", async () => {
    // The gate reads MAX(ts) FILTER (status = 'BARU'). Without the filter this
    // thread would be blocked by a row that was dealt with already.
    const answered = await inbound({
      id: "g.old",
      from: SENDER,
      text: "makasih",
      ts: ago(1_000),
    });
    await db.waMessage.update({
      where: { id: answered.id },
      data: { status: "DIJAWAB_AGEN", answeredByAgent: true, answeredAt: ago(500) },
    });
    await inbound({ id: "g.new", from: SENDER, text: "ada m2?", ts: ago(20_000) });

    const result = await pass(scripted(["ada kak"]).client);
    expect(result.drafted).toBe(1);
  });

  it("answers at most the configured number of threads in one tick", async () => {
    for (let i = 0; i < 4; i += 1) {
      await inbound({
        id: `many.${i}`,
        from: `62811100${i}000`,
        text: "ada m2?",
        ts: ago(20_000),
      });
    }

    const model = scripted(["ada kak"]);
    const result = await pass(model.client, { maxDraftsPerTick: 2 });

    expect(result.drafted).toBe(2);
    expect(model.calls).toHaveLength(2);
    expect(await db.waMessage.count({ where: { status: "BARU" } })).toBe(2);
  });
});

describe("what reaches the customer", () => {
  it("never queues a reply containing an em-dash, whatever the model wrote", async () => {
    // The last line of defence, asserted where the message actually leaves.
    await inbound({ id: "d.1", from: SENDER, text: "ada m2?", ts: ago(20_000) });

    await pass(scripted(["siap kak — ready ya"]).client);

    const row = await db.outbox.findFirstOrThrow();
    const body = (row.payload as { body: string }).body;
    expect(body).not.toMatch(/[—–]/);
    expect(body).toBe("siap kak, ready ya");
  });

  it("records what the turn was about, so the inbox can be filtered", async () => {
    await inbound({ id: "i.1", from: SENDER, text: "ada m2?", ts: ago(20_000) });

    await pass(scripted(["ada kak"]).client);

    const row = await db.waMessage.findFirstOrThrow({ where: { from: SENDER } });
    // No tool ran in this scripted turn, so the honest answer is "lain".
    expect(row.intent).toBe("lain");
  });

  it("carries the thread's rolling summary into the prompt", async () => {
    await inbound({ id: "sum.1", from: SENDER, text: "jadi gimana?", ts: ago(20_000) });
    await db.waThreadMemory.create({
      data: {
        from: SENDER,
        summary: "Mau MacBook Air M2 256GB, budget 15jt, buat kuliah.",
        summaryTurns: 3,
        clarifyCount: 0,
        updatedAt: NOW,
      },
    });

    const model = scripted(["oke kak"]);
    await pass(model.client);

    expect(model.calls[0]!.system).toContain("budget 15jt");
    expect(model.calls[0]!.system).toContain("FACTS TO REMEMBER");
  });

  it("carries a staff directive into the prompt and never writes one back", async () => {
    await inbound({ id: "dir.1", from: SENDER, text: "boleh nego?", ts: ago(20_000) });
    await db.waThreadMemory.create({
      data: {
        from: SENDER,
        directive: "kasih diskon 200rb kalau nawar",
        directiveAt: NOW,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: NOW,
      },
    });

    const model = scripted(["boleh kak"]);
    await pass(model.client);

    expect(model.calls[0]!.system).toContain("kasih diskon 200rb kalau nawar");

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: SENDER },
    });
    expect(memo.directive).toBe("kasih diskon 200rb kalau nawar");
  });
});

/**
 * The per-thread bot switch, from the worker's side.
 *
 * Staff can hand one customer to a person — `WaThreadMemory.autoReply = false`
 * — and the claim this pass has to keep is narrow and total: that thread is
 * never drafted for, and every other thread is answered exactly as before.
 *
 * The BARU assertion is the one that matters most. A muted thread's messages
 * must stay BARU rather than being escalated, so switching the bot back on
 * answers the backlog instead of finding it stamped as somebody else's
 * problem — the same choice the dormancy branch makes, for the same reason.
 */
describe("the per-thread bot switch", () => {
  /** The switch as the API writes it, without going through the API. */
  const setAutoReply = (from: string, autoReply: boolean) =>
    db.waThreadMemory.create({
      data: {
        from,
        autoReply,
        autoReplyAt: NOW,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: NOW,
      },
    });

  it("never drafts for a thread a person has taken on", async () => {
    await inbound({ id: "sw.1", from: SENDER, text: "mau nego", ts: ago(30_000) });
    await setAutoReply(SENDER, false);

    const model = scripted(["ada kak"]);
    const result = await pass(model.client);

    expect(result.drafted).toBe(0);
    // Not even asked. A skipped thread must not cost a model call.
    expect(model.calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("leaves the muted thread's messages BARU, so switching back on answers the backlog", async () => {
    await inbound({ id: "sw.2", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({ id: "sw.3", from: SENDER, text: "ada m2?", ts: ago(28_000) });
    await setAutoReply(SENDER, false);

    await pass(scripted(["ada kak"]).client);

    const mine = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(mine.every((m) => m.status === "BARU")).toBe(true);
    expect(mine.every((m) => m.replyText === null)).toBe(true);
  });

  it("answers the backlog once the bot is switched back on", async () => {
    await inbound({ id: "sw.4", from: SENDER, text: "ada m2?", ts: ago(30_000) });
    await setAutoReply(SENDER, false);
    expect((await pass(scripted(["ada kak"]).client)).drafted).toBe(0);

    await db.waThreadMemory.update({
      where: { from: SENDER },
      data: { autoReply: true },
    });

    const result = await pass(scripted(["ada kak, 15.500.000"]).client);

    expect(result.drafted).toBe(1);
    const answered = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(answered.status).toBe("DIJAWAB_AGEN");
    expect(answered.replyText).toBe("ada kak, 15.500.000");
  });

  it("switches off one customer and nobody else", async () => {
    await inbound({ id: "sw.5", from: SENDER, text: "mau nego", ts: ago(30_000) });
    await inbound({ id: "sw.6", from: OTHER, text: "ada m2?", ts: ago(30_000) });
    await setAutoReply(SENDER, false);

    const result = await pass(scripted(["ada kak"]).client);

    expect(result.drafted).toBe(1);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: SENDER } })).status,
    ).toBe("BARU");
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { from: OTHER } })).status,
    ).toBe("DIJAWAB_AGEN");
  });

  it("drafts for a thread whose memory row exists but was never switched off", async () => {
    // The summariser creates memory rows on its own. A row's mere existence
    // must not read as "switched off" — the column defaults to true.
    await inbound({ id: "sw.7", from: SENDER, text: "ada m2?", ts: ago(30_000) });
    await db.waThreadMemory.create({
      data: {
        from: SENDER,
        summary: "Cari MacBook.",
        summaryAt: NOW,
        summaryTurns: 2,
        clarifyCount: 0,
        updatedAt: NOW,
      },
    });

    expect((await pass(scripted(["ada kak"]).client)).drafted).toBe(1);
  });
});
