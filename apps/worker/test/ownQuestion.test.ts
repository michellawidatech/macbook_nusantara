/**
 * The owner's chat of 2026-10-27, through the real draft pass: "Kuliah", in
 * answer to the bot's own "Rencananya buat apa kak?", was handed to a
 * colleague as "Not in the answers". It is saved and answered now; and a
 * hand-over the bot did make records the line it sent, so /chat labels it Bot.
 *
 * (Below: the scripted-model harness of draft.batch.test.ts.)
 *
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
import { type AgentClient, type CreateArgs } from "@nusantara/agent";
import { draftPass, type SupersedeLedger } from "../src/draft.js";

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

const SENDER = "628980092978";

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

/** The bot's previous turn: it asked what the unit is for. */
async function botAsked(question: string) {
  const row = await inbound({
    id: "q.0",
    from: SENDER,
    text: "halo kak",
    ts: ago(120_000),
  });
  await db.waMessage.update({
    where: { id: row.id },
    data: {
      status: "DIJAWAB_AGEN",
      answeredByAgent: true,
      answeredAt: ago(110_000),
      replyText: question,
      entities: { sources: ["greeting"] },
    },
  });
}

describe("an answer to the bot's own question is never a hand-over (2026-10-27)", () => {
  it.each(["Kuliah", "Buat nyatet aja sih"])(
    "%j: saved, and the bot carries on even when the model reaches for a person",
    async (text) => {
      await botAsked("Halo kak 😊 Rencananya buat apa kak? 😊");
      await inbound({ id: "q.1", from: SENDER, text, ts: ago(20_000) });
      const model = scripted([
        {
          tool: "handoff_to_staff",
          input: {
            topic: "other",
            summary: "Perlu dibalas",
            customer_message: "Bentar ya kak, aku cek dulu 🙏",
          },
        },
        {
          tool: "reply",
          input: {
            message: "Oke kak 😊 Budgetnya kira-kira berapa kak?",
            sources: "chat",
          },
        },
      ]);
      await pass(model.client);

      const row = await db.waMessage.findFirstOrThrow({
        where: { waMessageId: "q.1" },
      });
      expect(row.status).toBe("DIJAWAB_AGEN");
      expect(row.replyText).toBe("Oke kak 😊 Budgetnya kira-kira berapa kak?");
      expect(await db.chatAction.count()).toBe(0);
      const profile = await db.customerProfile.findUniqueOrThrow({
        where: { from: SENDER },
        include: { facts: true },
      });
      expect(profile.facts.some((f) => f.kind === "USAGE")).toBe(true);
      expect(profile.name).toBeNull();
    },
  );

  it("a hand-over records the line the bot sent with it", async () => {
    await inbound({
      id: "h.1",
      from: SENDER,
      text: "nego dong kak",
      ts: ago(20_000),
    });
    const model = scripted([
      {
        tool: "handoff_to_staff",
        input: {
          topic: "negotiation",
          summary: "Perlu jawab tawaran",
          customer_message:
            "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
        },
      },
    ]);
    await pass(model.client);
    const row = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "h.1" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.answeredByAgent).toBe(false);
    expect(
      (row.entities as { handoff?: { reply?: string } }).handoff?.reply,
    ).toBe(row.replyText);
  });
});
