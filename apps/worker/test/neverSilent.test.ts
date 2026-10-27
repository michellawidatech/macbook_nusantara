/**
 * The bot never goes silent (owner ask 2026-10-27: *"improve the chatbot to
 * not get stuck"* — that morning the bot simply stopped replying in the shop).
 *
 * Every way a customer message could sit unanswered, each recovering by
 * itself: a model call that hangs or is rate limited, a turn that throws or
 * hangs, a message no pass ever drafted, an outbox row a crashed worker left
 * claimed, and a hold on the thread that nobody was actually holding. Run as
 * nusantara_agent — the role the worker logs in as — so a grant one of the
 * recoveries needs fails here and not on the Mac mini.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentClient, CreateArgs } from "@nusantara/agent";
import { draftPass, MAX_DRAFT_FAILURES, type DraftDeps } from "../src/draft.js";
import { stalePass, type StaleDeps } from "../src/stale.js";
import { sendPass } from "../src/send.js";
import { claimThread } from "../src/lease.js";
import { tick } from "../src/loop.js";
import { loadWorkerConfig } from "../src/config.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
/** Parsed, not string-replaced (agentRole.test.ts explains why). */
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
/** 20 August 2026, 10:00 in Jakarta — the shop is open. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const STAFF = "staff_ns";

let owner: PrismaClient;
let agent: PrismaClient;

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: URL } } });
  agent = new PrismaClient({
    datasources: { db: { url: asRole("nusantara_agent") } },
  });
  await owner.$connect();
  await agent.$connect();
});

afterAll(async () => {
  await owner.$disconnect();
  await agent.$disconnect();
});

beforeEach(async () => {
  await truncateAll(owner);
  await owner.staff.create({
    data: {
      id: STAFF,
      username: "dina_ns",
      name: "Dina",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
});

async function inbound(
  id: string,
  from: string,
  text: string,
  ts: Date,
  extra: Record<string, unknown> = {},
) {
  await owner.waMessage.create({
    data: {
      waMessageId: id,
      from,
      name: "Test",
      text,
      msgType: "text",
      ts,
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
      ...extra,
    },
  });
}

const replyTool = (message: string) => ({
  content: [
    {
      type: "tool_use" as const,
      id: "t1",
      name: "reply",
      input: { message, sources: "greeting" },
    },
  ],
  stop_reason: "tool_use" as const,
});

/** A model that greets. */
const greeter = {
  messages: { create: async () => replyTool("Halo kak 😊") },
} as unknown as AgentClient;

/**
 * The agent's client with one model's calls intercepted: `fault` decides,
 * per call, whether it throws, hangs for ever, or goes through.
 */
function faulty(
  base: PrismaClient,
  fault: (
    model: string,
    method: string,
    args: unknown,
  ) => "throw" | "hang" | null,
): PrismaClient {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (
        typeof prop === "string" &&
        value &&
        typeof value === "object" &&
        "findMany" in value
      ) {
        return new Proxy(value, {
          get(delegate, method) {
            const fn = Reflect.get(delegate, method) as unknown;
            if (typeof fn !== "function") return fn;
            return (args: unknown) => {
              const what = fault(prop, String(method), args);
              if (what === "throw")
                return Promise.reject(new Error("connection reset"));
              if (what === "hang") return new Promise(() => {});
              return (fn as (a: unknown) => unknown).call(delegate, args);
            };
          },
        });
      }
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

const run = (over: Partial<DraftDeps> = {}) =>
  draftPass({
    db: agent,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client: greeter,
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    concurrency: 2,
    now: () => NOW,
    superseded: new Map(),
    failures: new Map(),
    ...over,
  });

const outboxBodies = async (to?: string) =>
  (await owner.outbox.findMany({ orderBy: { createdAt: "asc" } }))
    .map((r) => r.payload as { to: string; body?: string })
    .filter((p) => !to || p.to === to)
    .map((p) => p.body ?? "");

describe("a model call that hangs or fails", () => {
  it("times out, and the rules answer the turn instead — the abandoned request is aborted", async () => {
    await inbound("h.1", "628111000701", "halo", ago(20_000));
    let signal: AbortSignal | undefined;
    const hanging = {
      messages: {
        create: (_a: CreateArgs, opts?: { signal?: AbortSignal }) => {
          signal = opts?.signal;
          return new Promise(() => {});
        },
      },
    } as unknown as AgentClient;

    const started = Date.now();
    const result = await run({
      client: hanging,
      callTimeoutMs: 50,
      callRetries: 0,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.drafted).toBe(1);
    expect(signal?.aborted).toBe(true);
    const row = await owner.waMessage.findFirstOrThrow();
    expect(row.status).toBe("DIJAWAB_AGEN");
    expect(await outboxBodies()).toHaveLength(1);
  });

  it("retries a 429 twice and then uses the model's answer", async () => {
    await inbound("r.1", "628111000702", "halo", ago(20_000));
    let calls = 0;
    const limited = {
      messages: {
        create: async () => {
          calls += 1;
          if (calls <= 2)
            throw Object.assign(new Error("rate limited"), { status: 429 });
          return replyTool("Halo kak, dari AI 😊");
        },
      },
    } as unknown as AgentClient;
    const waits: number[] = [];
    const result = await run({
      client: limited,
      callGuard: { sleep: async (ms) => void waits.push(ms) },
    });
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
    expect(result.drafted).toBe(1);
    expect((await outboxBodies())[0]).toContain("dari AI");
  });

  it("a question no rule answers still hears back: the holding line and a task", async () => {
    await inbound(
      "q.1",
      "628111000703",
      "kalau garansi internasional apple masih bisa diklaim di sini nggak?",
      ago(20_000),
    );
    const down = {
      messages: {
        create: async () => {
          throw Object.assign(new Error("unauthorized"), { status: 401 });
        },
      },
    } as unknown as AgentClient;
    const result = await run({ client: down });
    expect(result.drafted + result.escalated).toBeGreaterThan(0);
    const row = await owner.waMessage.findFirstOrThrow();
    expect(row.status).toBe("PERLU_STAF");
    const [body] = await outboxBodies();
    expect(body).toMatch(/kak/);
    expect(await owner.chatAction.count({ where: { status: "OPEN" } })).toBe(1);
  });
});

describe("one thread cannot stop the others", () => {
  it("a thread that keeps throwing is answered next to the rest, then gets the holding line", async () => {
    const BROKEN = "628111000711";
    const FINE = "628111000712";
    await inbound("b.1", BROKEN, "halo", ago(20_000));
    await inbound("f.1", FINE, "halo", ago(20_000));
    // The batch freeze (the read that selects `msgType`) fails for BROKEN
    // alone, the way a bad row or a dropped connection would.
    const db = faulty(agent, (model, method, args) => {
      const a = args as {
        where?: { from?: string };
        select?: Record<string, unknown>;
      };
      return model === "waMessage" &&
        method === "findMany" &&
        a?.where?.from === BROKEN &&
        a.select?.["msgType"]
        ? "throw"
        : null;
    });
    const failures = new Map();

    const first = await run({ db, failures });
    expect(first.drafted).toBe(1);
    expect(await outboxBodies(FINE)).toHaveLength(1);
    expect(await outboxBodies(BROKEN)).toHaveLength(0);

    for (let i = 1; i < MAX_DRAFT_FAILURES; i += 1) await run({ db, failures });
    expect(await outboxBodies(BROKEN)).toHaveLength(0);

    // The next pass stops trying: the customer hears back, a colleague is told.
    await run({ db, failures });
    const [line] = await outboxBodies(BROKEN);
    expect(line).toMatch(/^Bentar ya kak/);
    const row = await owner.waMessage.findFirstOrThrow({
      where: { from: BROKEN },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.entities).toMatchObject({
      handoff: { forcedBy: "failed", reply: line },
    });
    expect(
      await owner.chatAction.count({ where: { from: BROKEN, status: "OPEN" } }),
    ).toBe(1);
  });

  it("a turn that hangs is cut off at its deadline, and the pass returns", async () => {
    const STUCK = "628111000721";
    const FINE = "628111000722";
    await inbound("s.1", STUCK, "halo", ago(20_000));
    await inbound("s.2", FINE, "halo", ago(20_000));
    const db = faulty(agent, (model, method, args) =>
      model === "chatAction" &&
      method === "findMany" &&
      (args as { where?: { from?: string } })?.where?.from === STUCK
        ? "hang"
        : null,
    );
    const result = await run({ db, turnDeadlineMs: 300 });
    expect(result.drafted).toBe(1);
    expect(await outboxBodies(FINE)).toHaveLength(1);
    const [line] = await outboxBodies(STUCK);
    expect(line).toMatch(/^Bentar ya kak/);
    const row = await owner.waMessage.findFirstOrThrow({
      where: { from: STUCK },
    });
    expect(row.entities).toMatchObject({ handoff: { forcedBy: "deadline" } });
    // The lease went back with it.
    const memory = await owner.waThreadMemory.findUnique({
      where: { from: STUCK },
    });
    expect(memory?.leasedBy ?? null).toBeNull();
  });
});

describe("who holds the thread", () => {
  const FROM = "628111000731";

  it("Mark handled on a hand-over does not silence the bot for fifteen minutes", async () => {
    // The bot's own holding line, on a row a colleague then closed: a staff
    // id and a fresh answeredAt, but nobody typed anything.
    await inbound("m.1", FROM, "bisa nego?", ago(10 * 60_000), {
      status: "DIJAWAB_STAF",
      replyText: "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
      answeredById: STAFF,
      answeredAt: ago(60_000),
      intent: "staf:negotiation",
      entities: {
        handoff: {
          topic: "negotiation",
          reply: "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
        },
      },
    });
    await inbound("m.2", FROM, "halo", ago(20_000));
    expect((await run()).drafted).toBe(1);
  });

  it("a reply a colleague TYPED still keeps the bot out", async () => {
    await inbound("t.1", FROM, "bisa nego?", ago(10 * 60_000), {
      status: "DIJAWAB_STAF",
      replyText: "Bisa kak, 14jt ya",
      answeredById: STAFF,
      answeredAt: ago(60_000),
    });
    await inbound("t.2", FROM, "oke kak", ago(20_000));
    expect((await run()).drafted).toBe(0);
  });

  it("a Clear chat after that reply ends the hold", async () => {
    await inbound("c.1", FROM, "bisa nego?", ago(10 * 60_000), {
      status: "DIJAWAB_STAF",
      replyText: "Bisa kak, 14jt ya",
      answeredById: STAFF,
      answeredAt: ago(5 * 60_000),
    });
    await owner.waThreadMemory.create({
      data: {
        from: FROM,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: NOW,
        clearedAt: ago(4 * 60_000),
        clearedById: STAFF,
      },
    });
    await inbound("c.2", FROM, "halo", ago(20_000));
    expect((await run()).drafted).toBe(1);
  });
});

describe("the watchdog", () => {
  const stale = (over: Partial<StaleDeps> = {}) =>
    stalePass({
      db: agent,
      logger,
      now: () => NOW,
      startedAt: ago(3_600_000),
      failures: new Map(),
      ...over,
    });

  it("answers a message nothing drafted with the holding line and a task", async () => {
    await inbound("w.1", "628111000741", "masih ada?", ago(5 * 60_000));
    expect(await stale()).toMatchObject({ rescued: 1 });
    const [line] = await outboxBodies();
    expect(line).toMatch(/^Bentar ya kak/);
    const row = await owner.waMessage.findFirstOrThrow();
    expect(row.status).toBe("PERLU_STAF");
    expect(row.entities).toMatchObject({ handoff: { forcedBy: "stale" } });
    expect(await owner.chatAction.count({ where: { status: "OPEN" } })).toBe(1);
    // Once: the thread is no longer waiting on the bot.
    expect(await stale()).toMatchObject({ rescued: 0 });
    expect(await outboxBodies()).toHaveLength(1);
  });

  it("leaves a person's threads alone: bot off, a colleague typing, a turn running", async () => {
    await inbound("o.1", "628111000751", "halo", ago(5 * 60_000));
    await owner.waThreadMemory.create({
      data: {
        from: "628111000751",
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: NOW,
        autoReply: false,
      },
    });
    await inbound("p.0", "628111000752", "nego?", ago(10 * 60_000), {
      status: "DIJAWAB_STAF",
      replyText: "Bisa kak",
      answeredById: STAFF,
      answeredAt: ago(6 * 60_000),
    });
    await inbound("p.1", "628111000752", "ok", ago(5 * 60_000));
    await inbound("l.1", "628111000753", "halo", ago(5 * 60_000));
    expect(await claimThread(agent, "628111000753", "other-worker", NOW)).toBe(
      true,
    );

    expect(await stale()).toMatchObject({ rescued: 0, withStaff: 2 });
    expect(await owner.outbox.count()).toBe(0);
  });

  it("gives a worker that just started its three minutes first", async () => {
    await inbound("n.1", "628111000761", "halo", ago(10 * 60_000));
    expect(await stale({ startedAt: ago(60_000) })).toMatchObject({
      rescued: 0,
    });
  });

  it("waits while the customer is still typing", async () => {
    await inbound("y.1", "628111000771", "halo", ago(5 * 60_000));
    await inbound("y.2", "628111000771", "mau tanya", ago(5_000));
    expect(await stale()).toMatchObject({ rescued: 0 });
  });
});

describe("the supersede count cannot starve a thread", () => {
  it("a restart forgets the drops, and the minute-old line is answered anyway", async () => {
    const FROM = "628111000781";
    await inbound("d.1", FROM, "Hmmm kemahalan", ago(70_000));
    let n = 0;
    const racing = {
      messages: {
        create: async () => {
          n += 1;
          await inbound(`d.${n + 1}`, FROM, "ada yg 15jt?", ago(10_000));
          return replyTool("Ada kak 😊");
        },
      },
    } as unknown as AgentClient;
    // A fresh ledger, as after a restart: nothing remembers earlier drops.
    expect((await run({ client: racing, superseded: new Map() })).drafted).toBe(
      1,
    );
  });
});

describe("an outbox row a crashed worker left claimed", () => {
  const credentials = {
    whatsappToken: "t",
    phoneNumberId: "1",
    graphVersion: "v25.0",
  };
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.r" }] }), {
      status: 200,
    })) as unknown as typeof fetch;

  async function claimed(attempts: number) {
    const ten = new Date(Date.now() - 10 * 60_000);
    return owner.outbox.create({
      data: {
        kind: "WA_REPLY",
        payload: { to: "628111000791", body: "Halo kak" },
        status: "SENDING",
        attempts,
        nextAttemptAt: ten,
        createdAt: ten,
      },
    });
  }

  it("is requeued and sent", async () => {
    const row = await claimed(1);
    const result = await sendPass({
      db: agent,
      logger,
      credentials,
      maxSendsPerTick: 5,
      fetchImpl,
    });
    expect(result.sent).toBe(1);
    const after = await owner.outbox.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe("SENT");
  });

  it("fails visibly when that was its last attempt", async () => {
    const row = await claimed(6);
    await sendPass({
      db: agent,
      logger,
      credentials,
      maxSendsPerTick: 5,
      fetchImpl,
    });
    const after = await owner.outbox.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/never finished/);
  });

  it("leaves a send in flight alone", async () => {
    const row = await owner.outbox.create({
      data: {
        kind: "WA_REPLY",
        payload: { to: "628111000791", body: "Halo kak" },
        status: "SENDING",
        attempts: 1,
        nextAttemptAt: new Date(Date.now() - 10_000),
        createdAt: new Date(Date.now() - 10_000),
      },
    });
    await sendPass({
      db: agent,
      logger,
      credentials,
      maxSendsPerTick: 5,
      fetchImpl,
    });
    expect(
      (await owner.outbox.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("SENDING");
  });
});

describe("the tick", () => {
  it("carries on past a pass that throws — the queue still drains", async () => {
    await inbound("k.1", "628111000801", "halo", ago(20_000));
    await owner.outbox.create({
      data: {
        kind: "WA_REPLY",
        payload: { to: "628111000801", body: "Halo kak" },
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1_000),
        createdAt: new Date(Date.now() - 1_000),
      },
    });
    // Every read of the inbox fails: the draft pass and the watchdog throw.
    const db = faulty(agent, (model, method) =>
      model === "waMessage" && method === "findMany" ? "throw" : null,
    );
    const config = loadWorkerConfig({
      WHATSAPP_TOKEN: "t",
      PHONE_NUMBER_ID: "1",
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.k" }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await tick({
      db,
      logger,
      config: { ...config, anthropic: {} },
      fetchImpl,
    });
    expect(result.sent).toBe(1);
    expect(result.drafted).toBe(0);
  });
});
