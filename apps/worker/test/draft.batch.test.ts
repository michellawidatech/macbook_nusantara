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
import {
  PARALLEL_CAPABILITIES,
  type AgentClient,
  type CreateArgs,
} from "@nusantara/agent";
import {
  MAX_SUPERSEDES,
  draftPass,
  type SupersedeLedger,
} from "../src/draft.js";

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

/** These tests provoke warnings on purpose; the warnings are the expected result. */
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

const SENDER = "628111000777";
const OTHER = "628111000888";

/** 20 August 2026, 10:00 in Jakarta. The shop has just opened. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: PrismaClient;
/** Drafts dropped per thread — fresh per test, so no test inherits a count. */
let ledger: SupersedeLedger;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "chatbot.pipeline" } });
  await db.$disconnect();
});

beforeEach(async () => {
  ledger = new Map();
  await pinPipelineV1(db);
  await db.outbox.deleteMany({});
  // WaThreadMemory.coveredThroughId is an FK to WaMessage with onDelete:
  // Restrict, so the memory rows have to go first.
  await db.waThreadMemory.deleteMany({});
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
    superseded: ledger,
    ...over,
  });

/** The customer's turn the model was handed: the last user message's words. */
const customerTurn = (args: CreateArgs): string => {
  const last = args.messages[args.messages.length - 1]!;
  return (last.content as Array<{ text: string }>)[0]!.text;
};

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

describe("a line that arrives while the reply is being written (2026-10-27)", () => {
  // The owner's report: "Hmmm kemahalan", then "ada yg 15 jutaan gak ya" a
  // few seconds later — and two replies, one per line.
  it("drops the draft, queues nothing and leaves both lines waiting", async () => {
    await inbound({
      id: "k.1",
      from: SENDER,
      text: "Hmmm kemahalan",
      ts: ago(30_000),
    });
    const first = scripted(["siap kak"]);
    first.before(0, async () => {
      await inbound({
        id: "k.2",
        from: SENDER,
        text: "ada yg 15 jutaan gak ya",
        ts: ago(20_000),
      });
    });

    const result = await pass(first.client);

    expect(first.calls).toHaveLength(1);
    expect(result.drafted).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.agentRun.count()).toBe(0);
    const rows = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(rows.map((r) => r.status)).toEqual(["BARU", "BARU"]);
    expect(rows.every((r) => r.replyText === null)).toBe(true);
    expect(ledger.get(SENDER)?.count).toBe(1);
  });

  it("then answers the whole burst with ONE reply that read both lines", async () => {
    await inbound({
      id: "k.1",
      from: SENDER,
      text: "Hmmm kemahalan",
      ts: ago(30_000),
    });
    const first = scripted(["siap kak"]);
    first.before(0, async () => {
      await inbound({
        id: "k.2",
        from: SENDER,
        text: "ada yg 15 jutaan gak ya",
        ts: ago(20_000),
      });
    });
    await pass(first.client);

    const second = scripted(["ada kak, mau saya carikan?"]);
    const result = await pass(second.client);

    expect(result.drafted).toBe(1);
    expect(second.calls).toHaveLength(1);
    expect(customerTurn(second.calls[0]!)).toBe(
      "Hmmm kemahalan\nada yg 15 jutaan gak ya",
    );
    const sent = await db.outbox.findMany();
    expect(sent).toHaveLength(1);
    expect((sent[0]!.payload as { body: string }).body).toBe(
      "ada kak, mau saya carikan?",
    );
    const rows = await db.waMessage.findMany({ where: { from: SENDER } });
    expect(rows.every((r) => r.status === "DIJAWAB_AGEN")).toBe(true);
    expect(rows.filter((r) => r.replyText !== null)).toHaveLength(1);
    // A committed reply ends the run of drops.
    expect(ledger.has(SENDER)).toBe(false);
  });

  it("drops it the same way when the rules bot answers (no model at all)", async () => {
    await inbound({ id: "rb.1", from: SENDER, text: "halo", ts: ago(30_000) });
    // Rules mode is no client: the line is raced in by the profile lookup
    // instead, which every rules turn makes before its template.
    let raced = false;
    const spy = db.$extends({
      query: {
        customerProfile: {
          async findUnique({ args, query }) {
            if (!raced) {
              raced = true;
              await db.waMessage.create({
                data: {
                  waMessageId: "rb.2",
                  from: SENDER,
                  name: "Test",
                  text: "ada air m2?",
                  msgType: "text",
                  ts: ago(20_000),
                  direction: "IN",
                  status: "BARU",
                  entities: {},
                  answeredByAgent: false,
                },
              });
            }
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

    const result = await draftPass({
      db: spy,
      logger,
      anthropic: {},
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
      superseded: ledger,
    });

    expect(raced).toBe(true);
    expect(result.drafted).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(
      await db.waMessage.count({ where: { from: SENDER, status: "BARU" } }),
    ).toBe(2);

    const again = await draftPass({
      db,
      logger,
      anthropic: {},
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
      superseded: ledger,
    });
    expect(again.drafted).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(
      await db.waMessage.count({ where: { from: SENDER, status: "BARU" } }),
    ).toBe(0);
  });

  it(`commits anyway after ${MAX_SUPERSEDES} drops in a row, so a customer who keeps typing is answered`, async () => {
    await inbound({ id: "st.0", from: SENDER, text: "halo", ts: ago(40_000) });
    let line = 0;
    const typing = () => {
      const model = scripted(["siap kak"]);
      model.before(0, async () => {
        line += 1;
        await inbound({
          id: `st.${line}`,
          from: SENDER,
          text: `baris ${line}`,
          ts: ago(30_000 - line * 1_000),
        });
      });
      return model;
    };

    expect((await pass(typing().client)).drafted).toBe(0);
    expect((await pass(typing().client)).drafted).toBe(0);
    expect(ledger.get(SENDER)?.count).toBe(MAX_SUPERSEDES);
    const third = typing();
    expect((await pass(third.client)).drafted).toBe(1);

    // The third reply covered everything but the line that arrived during it.
    expect(customerTurn(third.calls[0]!)).toBe("halo\nbaris 1\nbaris 2");
    expect(await db.outbox.count()).toBe(1);
    const waiting = await db.waMessage.findMany({
      where: { from: SENDER, status: "BARU" },
    });
    expect(waiting.map((m) => m.waMessageId)).toEqual(["st.3"]);
    expect(ledger.has(SENDER)).toBe(false);
  });

  it("commits anyway once the burst's first line has waited a minute", async () => {
    await inbound({
      id: "old.1",
      from: SENDER,
      text: "mau tanya",
      ts: ago(70_000),
    });
    const model = scripted(["silakan kak"]);
    model.before(0, async () => {
      await inbound({
        id: "old.2",
        from: SENDER,
        text: "eh satu lagi",
        ts: NOW,
      });
    });

    expect((await pass(model.client)).drafted).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { waMessageId: "old.2" } }))
        .status,
    ).toBe("BARU");
  });

  it("changes nothing when no line arrived", async () => {
    await inbound({ id: "q.1", from: SENDER, text: "halo", ts: ago(30_000) });
    await inbound({
      id: "q.2",
      from: SENDER,
      text: "ada m2 ga",
      ts: ago(28_000),
    });

    const model = scripted(["siap kak"]);
    expect((await pass(model.client)).drafted).toBe(1);
    expect(model.calls).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);
    expect(ledger.size).toBe(0);
  });

  it("does not read a backlog's second half as the customer still typing", async () => {
    // Six lines, a batch ceiling of four: the two left over were there at the
    // freeze, so the first reply is sent and they wait for the second.
    for (let i = 0; i < 6; i += 1) {
      await inbound({
        id: `bl.${i}`,
        from: SENDER,
        text: `baris ${i}`,
        ts: ago(30_000 - i * 100),
      });
    }
    const first = await pass(scripted(["oke kak"]).client, { maxBatch: 4 });
    expect(first.drafted).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(ledger.size).toBe(0);
  });
});

describe("the adaptive wait", () => {
  it("answers a customer who asked a question before one who is still muttering", async () => {
    // Both last spoke 6 seconds ago: past the 3s question wait, short of the
    // 8s base window this file passes.
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
    // 15 seconds: past the base window (8s here) and the filler stretch,
    // short of the 20s hold (MAX_WAIT_MS since 2026-10-14).
    await inbound({
      id: "w.later",
      from: SENDER,
      text: "nanti saya kabarin ya",
      ts: ago(15_000),
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
    // The 2026-09-18 design, where a named unit's stock is a person's: since
    // 2026-10-27 the POS is the source of truth unless the owner says not.
    const result = await pass(model.client, {
      capabilities: PARALLEL_CAPABILITIES,
    });

    expect(result).toMatchObject({ drafted: 1, escalated: 1 });
    // The routed turn was offered no way to answer.
    expect(model.calls[0]!.tools!.map((t) => t.name)).not.toContain("reply");
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.answeredByAgent).toBe(false);
    expect(row.intent).toBe("staf:stock");
    // The job first, the model's note under it (2026-10-27).
    expect(row.entities).toMatchObject({
      handoff: {
        topic: "stock",
        summary: "Perlu cek stok — Air M1\nTanya stok MacBook Air M1",
      },
    });
    const sent = await db.outbox.findFirstOrThrow();
    expect((sent.payload as { body: string }).body).toMatch(
      /Air M1 kami cekkan/,
    );
  });

  it("answers the customer's newer message, naming what is still with a colleague (2026-10-27)", async () => {
    await inbound({
      id: "hold.1",
      from: SENDER,
      text: "air m1 bisa nego ga kak?",
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

    // The customer asks something else. It used to wait, unanswered, until a
    // person had dealt with the negotiation.
    await inbound({
      id: "hold.2",
      from: SENDER,
      text: "oh iya, garansinya berapa lama?",
      ts: ago(20_000),
    });
    const next = scripted(["Garansi toko 1 bulan ya kak 😊"]);
    expect((await pass(next.client)).drafted).toBe(1);
    expect(next.calls).toHaveLength(1);
    // Told what is waiting, so it neither answers nor contradicts it.
    const system = JSON.stringify(next.calls[0]!.system);
    expect(system).toContain("WAITING FOR A COLLEAGUE");
    expect(system).toContain("air m1 bisa nego ga kak?");

    // The negotiation is still the colleague's: outlined and open.
    expect(
      (
        await db.waMessage.findFirstOrThrow({
          where: { waMessageId: "hold.1" },
        })
      ).status,
    ).toBe("PERLU_STAF");
    expect(
      (
        await db.waMessage.findFirstOrThrow({
          where: { waMessageId: "hold.2" },
        })
      ).status,
    ).toBe("DIJAWAB_AGEN");
    expect(
      await db.chatAction.count({ where: { from: SENDER, status: "OPEN" } }),
    ).toBe(1);
  });

  it("stays out while a colleague is chatting, and comes back once they stop", async () => {
    await db.staff.upsert({
      where: { id: "staff_chat_i" },
      update: {},
      create: {
        id: "staff_chat_i",
        username: "chat_i_kasir",
        name: "Kasir",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    // A colleague answered by hand two minutes ago (routes/inbox.ts).
    const answered = await inbound({
      id: "s.1",
      from: SENDER,
      text: "air m1 bisa nego?",
      ts: ago(300_000),
    });
    await db.waMessage.update({
      where: { id: answered.id },
      data: {
        status: "DIJAWAB_STAF",
        replyText: "Bisa kak, 7,8jt ya",
        answeredById: "staff_chat_i",
        answeredAt: ago(120_000),
      },
    });
    await inbound({
      id: "s.2",
      from: SENDER,
      text: "oke kak, garansinya berapa lama?",
      ts: ago(30_000),
    });

    const quiet = scripted(["siap kak"]);
    expect((await pass(quiet.client)).drafted).toBe(0);
    expect(quiet.calls).toHaveLength(0);
    expect(
      (await db.waMessage.findFirstOrThrow({ where: { waMessageId: "s.2" } }))
        .status,
    ).toBe("BARU");

    // Mark handled writes no reply, so it is not somebody typing.
    await db.waMessage.update({
      where: { id: answered.id },
      data: { replyText: null },
    });
    expect((await pass(scripted(["siap kak"]).client)).drafted).toBe(1);
  });

  it("answers once the colleague has been quiet for the window", async () => {
    await db.staff.upsert({
      where: { id: "staff_chat_i" },
      update: {},
      create: {
        id: "staff_chat_i",
        username: "chat_i_kasir",
        name: "Kasir",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    const answered = await inbound({
      id: "w.1",
      from: SENDER,
      text: "halo",
      ts: ago(1_500_000),
    });
    await db.waMessage.update({
      where: { id: answered.id },
      data: {
        status: "DIJAWAB_STAF",
        replyText: "Halo kak",
        answeredById: "staff_chat_i",
        answeredAt: ago(1_200_000),
      },
    });
    await inbound({ id: "w.2", from: SENDER, text: "kak?", ts: ago(30_000) });
    // Twenty minutes is past the default quarter of an hour.
    expect((await pass(scripted(["siap kak"]).client)).drafted).toBe(1);
    await inbound({ id: "w.3", from: SENDER, text: "kak??", ts: ago(30_000) });
    // …and inside a longer window it would still be the colleague's.
    expect(
      (
        await pass(scripted(["siap kak"]).client, {
          staffActiveMs: 30 * 60_000,
        })
      ).drafted,
    ).toBe(0);
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
      summary: "Perlu jawab tawaran — Air M1\nNego Air M1 ke 7jt",
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
    // A new offer is a hand-over of its own, onto the same task.
    await inbound({
      id: "n.2",
      from: SENDER,
      text: "kalau 7,2jt deh kak",
      ts: ago(20_000),
    });
    await pass(
      scripted([
        handsOver("negotiation", "Nego Air M1", "Siap kak, kami teruskan 🙏"),
      ]).client,
    );

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
    // The admin's own short line for a price (2026-10-27), not "admin kami".
    expect(body).toMatch(/^Untuk harganya aku tanyain dulu ya kak 🙏/);
  });

  it("answers by the rules when the model itself fails — never silent (2026-10-27)", async () => {
    await inbound({ id: "x.1", from: SENDER, text: "halo", ts: ago(20_000) });
    const broken = {
      messages: {
        create: async () => {
          throw new Error("529 overloaded");
        },
      },
    } as unknown as AgentClient;

    // Before 2026-10-27 this handed the thread over and sent NOTHING: the
    // customer heard silence until a colleague happened to look.
    const result = await pass(broken);
    expect(result).toMatchObject({ drafted: 1, escalated: 0 });
    const row = await db.waMessage.findFirstOrThrow({
      where: { from: SENDER },
    });
    expect(row.status).toBe("DIJAWAB_AGEN");
    expect(await db.outbox.count()).toBe(1);
    expect(
      (await db.agentRun.findFirstOrThrow({ select: { pipeline: true } }))
        .pipeline,
    ).toBe("rules");
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

describe("the lead, decided by the bot (owner, 2026-10-21)", () => {
  it("scores a single-agent turn and marks a likely buyer", async () => {
    await inbound({
      id: "l.1",
      from: SENDER,
      text: "mau booking macbook air m2 besok jam 2 ya kak",
      ts: ago(30_000),
    });
    await pass(scripted(["siap kak"]).client);

    const mem = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: SENDER },
    });
    // Scored by code, the way the rules score a turn: product, a booking and
    // a time — no model call spent on it.
    expect(mem.leadScore).toBe(85);
    expect(mem.leadAt).not.toBeNull();
    const run = await db.agentRun.findFirstOrThrow({ where: { from: SENDER } });
    expect(run).toMatchObject({ pipeline: "v1", leadScore: 85 });
  });

  it("does not mark a greeting", async () => {
    await inbound({ id: "l.2", from: OTHER, text: "halo", ts: ago(30_000) });
    await pass(scripted(["siap kak"]).client);
    const mem = await db.waThreadMemory.findUnique({ where: { from: OTHER } });
    expect(mem?.leadAt ?? null).toBeNull();
  });
});
