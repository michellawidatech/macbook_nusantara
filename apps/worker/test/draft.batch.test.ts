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
  // ChatAction points at WaMessage, Unit and Customer (2026-09-29).
  await db.chatAction.deleteMany({});
  await db.customerProfile.deleteMany({});
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

/** A step of the script: a greeting-grade reply, or any tool call. */
type Step =
  string | { readonly tool: string; readonly input: Record<string, unknown> };

/**
 * A model that answers from a script, recording what it was asked.
 *
 * A plain string is a `reply` citing `greeting` — a turn that states no fact,
 * which is what the batching tests need: they are about which rows move, and
 * a reply the policy would refuse (a price, a stock claim) would turn them
 * into tests of the policy instead (2026-09-18, converse.ts).
 *
 * `before` is the whole reason this exists rather than a one-line stub: the
 * mid-draft race can only be tested by inserting a row *while* the call is in
 * flight, and doing that for real is far better evidence than asserting on a
 * predicate.
 */
function scripted(steps: Step[]): Scripted {
  const calls: CreateArgs[] = [];
  const hooks = new Map<number, () => Promise<void>>();
  let n = 0;

  const create = async (args: CreateArgs) => {
    calls.push(args);
    const i = n;
    n += 1;
    const hook = hooks.get(i);
    if (hook) await hook();
    const step = steps[i] ?? steps[steps.length - 1] ?? "siap kak";
    const use =
      typeof step === "string"
        ? { tool: "reply", input: { message: step, sources: "greeting" } }
        : step;
    return {
      content: [
        {
          type: "tool_use" as const,
          id: `toolu_${i}`,
          name: use.tool,
          input: use.input,
        },
      ],
      stop_reason: "tool_use" as const,
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
    await inbound({
      id: "b.2",
      from: SENDER,
      text: "mau tanya",
      ts: ago(28_000),
    });
    await inbound({
      id: "b.3",
      from: SENDER,
      text: "ada macbook air m2",
      ts: ago(26_000),
    });
    await inbound({
      id: "b.4",
      from: SENDER,
      text: "yang 256gb",
      ts: ago(24_000),
    });

    const model = scripted(["siap kak"]);
    const result = await pass(model.client);

    expect(result.drafted).toBe(1);
    expect(model.calls).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("joins the burst into one customer turn, in the order it was typed", async () => {
    await inbound({ id: "j.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({
      id: "j.2",
      from: SENDER,
      text: "ada m2 ga",
      ts: ago(28_000),
    });

    const model = scripted(["siap kak"]);
    await pass(model.client);

    const sent = model.calls[0]!;
    const last = sent.messages[sent.messages.length - 1]!;
    expect(last.role).toBe("user");
    // The customer's words first; the shop's note rides in its own block.
    expect((last.content as Array<{ text: string }>)[0]!.text).toBe(
      "halo\nada m2 ga",
    );
  });

  it("moves every message the reply covered off BARU, and only those", async () => {
    await inbound({ id: "c.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({
      id: "c.2",
      from: SENDER,
      text: "mau tanya dong",
      ts: ago(28_000),
    });
    await inbound({
      id: "c.3",
      from: OTHER,
      text: "halo juga",
      ts: ago(1_000),
    });

    await pass(scripted(["siap kak"]).client);

    const mine = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(mine.every((m) => m.status === "DIJAWAB_AGEN")).toBe(true);
    expect(mine.every((m) => m.answeredByAgent)).toBe(true);

    // The other sender arrived a second ago and is still typing.
    const theirs = await db.waMessage.findFirstOrThrow({
      where: { from: OTHER },
    });
    expect(theirs.status).toBe("BARU");
  });

  it("records the reply on exactly one row, so the thread reads as one answered turn", async () => {
    await inbound({ id: "r.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({
      id: "r.2",
      from: SENDER,
      text: "mau tanya dong",
      ts: ago(28_000),
    });

    await pass(scripted(["siap kak"]).client);

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
    await inbound({
      id: "m.1",
      from: SENDER,
      text: "mau tanya dong",
      ts: ago(30_000),
    });

    const model = scripted(["siap kak"]);
    model.before(0, async () => {
      await inbound({
        id: "m.late",
        from: SENDER,
        text: "eh satu lagi",
        ts: NOW,
      });
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
    await inbound({
      id: "n.1",
      from: SENDER,
      text: "mau tanya dong",
      ts: ago(30_000),
    });

    const first = scripted(["siap kak"]);
    first.before(0, async () => {
      await inbound({
        id: "n.late",
        from: SENDER,
        text: "eh satu lagi",
        ts: ago(20_000),
      });
    });
    await pass(first.client);

    const second = await pass(scripted(["boleh kak, silakan"]).client);
    expect(second.drafted).toBe(1);

    const late = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "n.late" },
    });
    expect(late.status).toBe("DIJAWAB_AGEN");
    expect(late.replyText).toBe("boleh kak, silakan");
  });

  it("discards its draft when a staff member answers the thread first", async () => {
    // The compare-and-swap earns its keep here: without it the agent's stale
    // reply would be queued on top of the human's, and the customer would get
    // two answers to one question.
    await inbound({
      id: "s.1",
      from: SENDER,
      text: "boleh nego?",
      ts: ago(30_000),
    });

    const model = scripted(["harganya pas kak"]);
    model.before(0, async () => {
      await db.waMessage.updateMany({
        where: { from: SENDER },
        data: {
          status: "DIJAWAB_STAF",
          replyText: "boleh kak, sini saya bantu",
        },
      });
    });

    const result = await pass(model.client);

    expect(result.drafted).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
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

    expect(
      await db.waMessage.count({ where: { from: SENDER, status: "BARU" } }),
    ).toBe(2);
  });
});

describe("the adaptive wait", () => {
  it("answers a customer who asked a question before one who is still muttering", async () => {
    // Both last spoke 6 seconds ago: past the 4s question wait, short of the
    // 8s base window.
    await inbound({
      id: "a.q",
      from: SENDER,
      text: "bisa cod?",
      ts: ago(6_000),
    });
    await inbound({ id: "a.f", from: OTHER, text: "hmm", ts: ago(6_000) });

    const model = scripted(["siap kak"]);
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
    await inbound({
      id: "f.2",
      from: OTHER,
      text: "bisa cod?",
      ts: ago(10_000),
    });

    const result = await pass(scripted(["siap kak"]).client);

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
      data: {
        status: "DIJAWAB_AGEN",
        answeredByAgent: true,
        answeredAt: ago(500),
      },
    });
    await inbound({
      id: "g.new",
      from: SENDER,
      text: "ada m2?",
      ts: ago(20_000),
    });

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
  it("never queues markdown, whatever the model wrote", async () => {
    // The last line of defence, asserted where the message actually leaves.
    // Dashes and brackets stay (2026-09-18): the owner's answers use them —
    // "1–3 hari kerja", "PO (pre-order)".
    await inbound({ id: "d.1", from: SENDER, text: "halo", ts: ago(20_000) });

    await pass(scripted(["**siap** kak — 1–3 hari (kerja)"]).client);

    const row = await db.outbox.findFirstOrThrow();
    const body = (row.payload as { body: string }).body;
    expect(body).toBe("siap kak — 1–3 hari (kerja)");
  });

  it("records what the turn was about, so the inbox can be filtered", async () => {
    await inbound({ id: "i.1", from: SENDER, text: "halo", ts: ago(20_000) });

    await pass(scripted(["halo kak, ada yang bisa dibantu?"]).client);

    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    // A reply resting on no fact is a greeting.
    expect(row.intent).toBe("sapaan");
  });

  it("carries the thread's rolling summary into the prompt", async () => {
    await inbound({
      id: "sum.1",
      from: SENDER,
      text: "jadi gimana?",
      ts: ago(20_000),
    });
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

    // The per-thread half of the prompt, after the cache breakpoint.
    const volatile = JSON.stringify((model.calls[0]!.system as unknown[])[1]);
    expect(volatile).toContain("budget 15jt");
    expect(volatile).toContain("FACTS TO REMEMBER");
  });

  it("carries a staff directive into the prompt and never writes one back", async () => {
    await inbound({
      id: "dir.1",
      from: SENDER,
      text: "boleh nego?",
      ts: ago(20_000),
    });
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

    expect(JSON.stringify(model.calls[0]!.system)).toContain(
      "kasih diskon 200rb kalau nawar",
    );

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
    await inbound({
      id: "sw.1",
      from: SENDER,
      text: "mau nego",
      ts: ago(30_000),
    });
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
    await inbound({
      id: "sw.3",
      from: SENDER,
      text: "ada m2?",
      ts: ago(28_000),
    });
    await setAutoReply(SENDER, false);

    await pass(scripted(["ada kak"]).client);

    const mine = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(mine.every((m) => m.status === "BARU")).toBe(true);
    expect(mine.every((m) => m.replyText === null)).toBe(true);
  });

  it("answers the backlog once the bot is switched back on", async () => {
    await inbound({
      id: "sw.4",
      from: SENDER,
      text: "mau tanya kak",
      ts: ago(30_000),
    });
    await setAutoReply(SENDER, false);
    expect((await pass(scripted(["siap kak"]).client)).drafted).toBe(0);

    await db.waThreadMemory.update({
      where: { from: SENDER },
      data: { autoReply: true },
    });

    const result = await pass(
      scripted(["halo kak, ada yang bisa dibantu?"]).client,
    );

    expect(result.drafted).toBe(1);
    const answered = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(answered.status).toBe("DIJAWAB_AGEN");
    expect(answered.replyText).toBe("halo kak, ada yang bisa dibantu?");
  });

  it("switches off one customer and nobody else", async () => {
    await inbound({
      id: "sw.5",
      from: SENDER,
      text: "mau nego",
      ts: ago(30_000),
    });
    await inbound({
      id: "sw.6",
      from: OTHER,
      text: "halo kak",
      ts: ago(30_000),
    });
    await setAutoReply(SENDER, false);

    const result = await pass(scripted(["siap kak"]).client);

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
    await inbound({
      id: "sw.7",
      from: SENDER,
      text: "ada m2?",
      ts: ago(30_000),
    });
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

/**
 * The owner's rule, from the worker's side (2026-09-18): stock, price and
 * anything the approved answers do not cover goes to a person — and once it
 * has, the bot stays out of that conversation until the person has answered.
 */
describe("handing a customer to a person", () => {
  const handsOver = (
    topic: string,
    summary: string,
    customer: string,
  ): Step => ({
    tool: "handoff_to_staff",
    input: { topic, summary, customer_message: customer },
  });

  it("gives a named machine to a colleague, tells the customer, and says why", async () => {
    await inbound({
      id: "h.1",
      from: SENDER,
      text: "air m1 ready kak?",
      ts: ago(20_000),
    });

    const model = scripted([
      handsOver(
        "stock",
        "Tanya stok MacBook Air M1",
        "Siap kak 😊 untuk Air M1 kami cekkan dulu ya, admin kami segera balas 🙏",
      ),
    ]);
    const result = await pass(model.client);

    expect(result).toMatchObject({ drafted: 1, escalated: 1 });
    // The routed turn was offered no way to answer.
    expect(model.calls[0]!.tools!.map((t) => t.name)).not.toContain("reply");
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.answeredByAgent).toBe(false);
    expect(row.intent).toBe("staf:stock");
    expect(row.entities).toMatchObject({
      handoff: { topic: "stock", summary: "Tanya stok MacBook Air M1" },
    });
    const sent = await db.outbox.findFirstOrThrow();
    expect((sent.payload as { body: string }).body).toMatch(
      /Air M1 kami cekkan/,
    );
  });

  it("says nothing more to that customer until a person has answered", async () => {
    await inbound({
      id: "hold.1",
      from: SENDER,
      text: "air m1 ready kak?",
      ts: ago(60_000),
    });
    await pass(
      scripted([
        handsOver("stock", "Stok Air M1", "Admin kami cek dulu ya kak 🙏"),
      ]).client,
    );

    // The customer gets impatient.
    await inbound({
      id: "hold.2",
      from: SENDER,
      text: "kak?",
      ts: ago(20_000),
    });
    const held = scripted(["halo kak"]);
    expect((await pass(held.client)).drafted).toBe(0);
    expect(held.calls).toHaveLength(0);
    expect(
      (
        await db.waMessage.findFirstOrThrow({
          where: { waMessageId: "hold.2" },
        })
      ).status,
    ).toBe("BARU");

    // A colleague answers through the inbox, which closes every waiting row.
    await db.waMessage.updateMany({
      where: { from: SENDER, status: { in: ["BARU", "PERLU_STAF"] } },
      data: { status: "DIJAWAB_STAF", answeredAt: NOW },
    });
    await inbound({
      id: "hold.3",
      from: SENDER,
      text: "makasih kak",
      ts: ago(20_000),
    });
    expect((await pass(scripted(["sama-sama kak 😊"]).client)).drafted).toBe(1);
  });

  it("holds only that customer", async () => {
    await inbound({
      id: "o.1",
      from: SENDER,
      text: "air m1 ready kak?",
      ts: ago(60_000),
    });
    await pass(
      scripted([handsOver("stock", "Stok", "Admin kami cek dulu ya kak 🙏")])
        .client,
    );
    await inbound({
      id: "o.2",
      from: OTHER,
      text: "halo kak",
      ts: ago(20_000),
    });

    expect((await pass(scripted(["halo kak 😊"]).client)).drafted).toBe(1);
  });

  it("leaves one action item per kind, with the bot's note for the colleague", async () => {
    await inbound({
      id: "a.1",
      from: SENDER,
      text: "air m1 bisa 7jt ga kak?",
      ts: ago(60_000),
    });
    await pass(
      scripted([
        handsOver(
          "negotiation",
          "Nego Air M1 ke 7jt",
          "Admin kami cek dulu ya kak 🙏",
        ),
      ]).client,
    );
    const action = await db.chatAction.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(action).toMatchObject({
      kind: "NEGOTIATION",
      status: "OPEN",
      summary: "Nego Air M1 ke 7jt",
      askPrice: 7_000_000n,
    });
  });

  it("moves the offer on the open negotiation when the customer changes it before anybody answers", async () => {
    await inbound({
      id: "n.1",
      from: SENDER,
      text: "air m1 bisa 7jt ga kak?",
      ts: ago(60_000),
    });
    await pass(
      scripted([
        handsOver(
          "negotiation",
          "Nego Air M1",
          "Admin kami cek dulu ya kak 🙏",
        ),
      ]).client,
    );
    // Held: the bot says nothing more, but the new figure is still read.
    await inbound({
      id: "n.2",
      from: SENDER,
      text: "kalau 7,2jt deh kak",
      ts: ago(20_000),
    });
    const quiet = scripted([]);
    await pass(quiet.client);
    expect(quiet.calls).toHaveLength(0);

    const actions = await db.chatAction.findMany({ where: { from: SENDER } });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      askPrice: 7_200_000n,
      customerText: "kalau 7,2jt deh kak",
    });
  });

  it("replaces a reply the policy refuses with the shop's holding line", async () => {
    await inbound({ id: "p.1", from: SENDER, text: "halo", ts: ago(20_000) });

    await pass(scripted(["halo kak, yang m1 7.500.000 aja"]).client);

    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("PERLU_STAF");
    // A figure nothing vouched for is a price question (2026-09-29).
    expect(row.entities).toMatchObject({
      handoff: { topic: "price", forcedBy: "AMOUNT_NOT_IN_SOURCE" },
    });
    const body = (
      (await db.outbox.findFirstOrThrow()).payload as { body: string }
    ).body;
    expect(body).not.toMatch(/7\.500\.000/);
    expect(body).toMatch(/admin kami/i);
  });

  it("says why when the model itself fails", async () => {
    await inbound({ id: "x.1", from: SENDER, text: "halo", ts: ago(20_000) });
    const broken = {
      messages: {
        create: async () => {
          throw new Error("529 overloaded");
        },
      },
    } as unknown as AgentClient;

    const result = await pass(broken);
    expect(result).toMatchObject({ drafted: 0, escalated: 1 });
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.entities).toMatchObject({ handoff: { forcedBy: "no_reply" } });
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("the prompt", () => {
  it("carries the owner's answers in the cached half, and the clock in the other", async () => {
    await db.staff.upsert({
      where: { id: "staff_kb_worker" },
      update: {},
      create: {
        id: "staff_kb_worker",
        username: "kb_worker",
        name: "KB",
        role: "STAFF",
        canApprove: false,
        active: false,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    await db.agentKnowledge.deleteMany({});
    await db.agentKnowledge.create({
      data: {
        question: "Garansi berapa lama kak?",
        answer: "Garansi dari kami 1 bulan ya kak 😊",
        createdById: "staff_kb_worker",
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await inbound({
      id: "pr.1",
      from: SENDER,
      text: "garansinya brp lama?",
      ts: ago(20_000),
    });

    const model = scripted([
      {
        tool: "reply",
        input: {
          message: "Garansi dari kami 1 bulan ya kak 😊",
          sources: "K1",
        },
      },
    ]);
    await pass(model.client);

    const [stable, volatile] = model.calls[0]!.system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(stable!.cache_control).toEqual({ type: "ephemeral" });
    expect(stable!.text).toContain("[K1] Q: Garansi berapa lama kak?");
    expect(stable!.text).not.toContain("It is now");
    expect(volatile!.text).toContain("It is now");
    // The likeliest answer rides beside the message.
    expect(JSON.stringify(model.calls[0]!.messages.at(-1))).toContain("K1");

    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("DIJAWAB_AGEN");
    expect(row.intent).toBe("jawab:faq");
    await db.agentKnowledge.deleteMany({});
  });
});
