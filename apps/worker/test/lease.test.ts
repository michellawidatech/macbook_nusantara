/**
 * Many customers at once, each answered once, none mixed up (chatbot v2).
 *
 * The owner's numbers (2026-10-14): about fifty customers a day, ten to
 * twenty-five writing at the same time. The draft pass answers threads in
 * parallel now, so this file is about the two things that can go wrong when it
 * does — a customer answered twice, and a customer answered with somebody
 * else's conversation — and about the lease that prevents the first.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentClient, CreateArgs } from "@nusantara/agent";
import { draftPass } from "../src/draft.js";
import { claimThread, inPool, releaseThread } from "../src/lease.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

/** The same database as another role — what the Mac mini's worker logs in as. */
/** Parsed, not string-replaced: CI's URL carries a password (agentRole.test.ts). */
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

/** 20 August 2026, 10:00 in Jakarta. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

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
  await db.waThreadMemory.deleteMany({});
  await db.chatAction.deleteMany({});
  await db.customerProfileFact.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  await db.waMessage.deleteMany({});
});

async function inbound(id: string, from: string, text: string, ts: Date) {
  await db.waMessage.create({
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
    },
  });
}

/**
 * A model that answers each customer with the token it finds in THAT
 * customer's message, and records how many calls were in flight at once.
 * `gate` holds every call open until released, so two passes can be made to
 * overlap for real.
 */
function echoModel(gate?: Promise<void>) {
  const calls: CreateArgs[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const create = async (args: CreateArgs) => {
    calls.push(args);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield, so lanes really interleave even without a gate.
    await new Promise((r) => setTimeout(r, 20));
    if (gate) await gate;
    inFlight -= 1;
    const asked = JSON.stringify(args.messages);
    const tokens = asked.match(/TOKEN-[a-z]+/g) ?? [];
    return {
      content: [
        {
          type: "tool_use" as const,
          id: `toolu_${calls.length}`,
          name: "reply",
          input: {
            message: `halo kak, ${tokens.join(" ")}`,
            sources: "greeting",
          },
        },
      ],
      stop_reason: "tool_use" as const,
    };
  };
  return {
    client: { messages: { create } } as unknown as AgentClient,
    calls,
    maxInFlight: () => maxInFlight,
  };
}

const pass = (client: AgentClient, over: Record<string, unknown> = {}) =>
  draftPass({
    db,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    debounceMs: 8_000,
    maxDraftsPerTick: 16,
    now: () => NOW,
    ...over,
  });

describe("the thread lease", () => {
  const FROM = "628111000101";

  it("lets one holder in and keeps the second out", async () => {
    expect(await claimThread(db, FROM, "worker-a", NOW)).toBe(true);
    expect(await claimThread(db, FROM, "worker-b", NOW)).toBe(false);
    // The holder itself may claim again — a retry inside one pass.
    expect(await claimThread(db, FROM, "worker-a", NOW)).toBe(true);
  });

  it("frees the thread on release, and only for the holder", async () => {
    await claimThread(db, FROM, "worker-a", NOW);
    await releaseThread(db, FROM, "worker-b");
    expect(await claimThread(db, FROM, "worker-b", NOW)).toBe(false);
    await releaseThread(db, FROM, "worker-a");
    expect(await claimThread(db, FROM, "worker-b", NOW)).toBe(true);
  });

  it("lets a crashed worker's thread go when its lease runs out", async () => {
    await claimThread(db, FROM, "crashed", NOW, 60_000);
    expect(await claimThread(db, FROM, "worker-b", later(59_000))).toBe(false);
    expect(await claimThread(db, FROM, "worker-b", later(60_000))).toBe(true);
  });

  it("leaves the rest of the thread's memory alone", async () => {
    await db.waThreadMemory.create({
      data: {
        from: FROM,
        summary: "Mahasiswa, cari Air M2.",
        summaryTurns: 4,
        clarifyCount: 1,
        autoReply: false,
        updatedAt: ago(60_000),
      },
    });
    await claimThread(db, FROM, "worker-a", NOW);
    const row = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(row).toMatchObject({
      summary: "Mahasiswa, cari Air M2.",
      summaryTurns: 4,
      clarifyCount: 1,
      autoReply: false,
      leasedBy: "worker-a",
    });
  });

  // The role production gives the worker (docs/worker-agent-role.md). That
  // nusantara_app is refused is agentRole.test.ts's claim.
  for (const role of ["nusantara_agent"]) {
    it(`claims and releases as ${role}`, async () => {
      const client = new PrismaClient({
        datasources: { db: { url: asRole(role) } },
      });
      try {
        expect(await claimThread(client, FROM, "w", NOW)).toBe(true);
        await releaseThread(client, FROM, "w");
        expect(await claimThread(client, FROM, "w2", NOW)).toBe(true);
      } finally {
        await client.$disconnect();
      }
    });
  }
});

describe("answering many customers at once", () => {
  const customers = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  const phone = (i: number) => `62811100020${i}`;

  beforeEach(async () => {
    for (const [i, name] of customers.entries()) {
      await inbound(
        `m.${name}`,
        phone(i),
        `TOKEN-${name} halo kak`,
        ago(20_000),
      );
    }
  });

  it("answers every waiting customer in one pass, several at a time", async () => {
    const model = echoModel();
    const result = await pass(model.client, { concurrency: 3 });

    expect(result.drafted).toBe(customers.length);
    expect(model.maxInFlight()).toBeGreaterThan(1);
    expect(model.maxInFlight()).toBeLessThanOrEqual(3);
    expect(await db.waMessage.count({ where: { status: "BARU" } })).toBe(0);
  });

  it("sends each customer the answer to their own message and nobody else's", async () => {
    await pass(echoModel().client, { concurrency: 6 });

    const sent = await db.outbox.findMany({ where: { kind: "WA_REPLY" } });
    expect(sent).toHaveLength(customers.length);
    for (const row of sent) {
      const { to, body } = row.payload as { to: string; body: string };
      const i = Number(to.slice(-1));
      expect(body).toContain(`TOKEN-${customers[i]}`);
      // Exactly one token: no other customer's words reached this prompt.
      expect(body.match(/TOKEN-/g)).toHaveLength(1);
    }
  });

  it("releases every lease when the pass is done", async () => {
    await pass(echoModel().client, { concurrency: 3 });
    expect(
      await db.waThreadMemory.count({ where: { leasedBy: { not: null } } }),
    ).toBe(0);
  });
});

describe("two workers, one customer", () => {
  const FROM = "628111000301";

  it("makes one model call and sends one reply when two passes overlap", async () => {
    await inbound("race.1", FROM, "TOKEN-race bisa cod?", ago(20_000));

    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const model = echoModel(gate);

    const first = pass(model.client, { leaseHolder: "worker-a" });
    // Let the first pass claim the thread and reach the model.
    await new Promise((r) => setTimeout(r, 100));
    const second = pass(model.client, { leaseHolder: "worker-b" });
    await new Promise((r) => setTimeout(r, 100));
    open();
    const [a, b] = await Promise.all([first, second]);

    expect(a.drafted + b.drafted).toBe(1);
    expect(model.calls).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("skips a thread another worker holds, and answers it once the lease is gone", async () => {
    await inbound("held.1", FROM, "TOKEN-held halo", ago(20_000));
    await claimThread(db, FROM, "elsewhere", NOW, 60_000);

    const model = echoModel();
    expect((await pass(model.client)).drafted).toBe(0);
    expect(model.calls).toHaveLength(0);

    const result = await pass(model.client, { now: () => later(61_000) });
    expect(result.drafted).toBe(1);
  });
});

describe("the pool", () => {
  it("never runs more than the limit, and runs everything", async () => {
    let inFlight = 0;
    let max = 0;
    const done: number[] = [];
    await inPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      inFlight -= 1;
      done.push(n);
    });
    expect(max).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("does nothing with nothing", async () => {
    await inPool([], 4, async () => {
      throw new Error("never");
    });
  });
});
