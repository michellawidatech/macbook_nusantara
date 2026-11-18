/**
 * The chatbot audit's nightly pass (2026-11-18), run AS nusantara_agent —
 * the role the worker logs in as — with a scripted reviewer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentClient } from "@nusantara/agent";
import { reviewPass } from "../src/reviewPass.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
/** Wednesday 18 November 2026, 02:00 Jakarta — inside the window. */
const NIGHT = new Date("2026-11-17T19:00:00.000Z");
/** The same day, 11:00 Jakarta. */
const DAY = new Date("2026-11-18T04:00:00.000Z");
const A = "628111000501";
const B = "628111000502";

let owner: PrismaClient;
let agent: PrismaClient;

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: URL } } });
  agent = new PrismaClient({
    datasources: { db: { url: asRole("nusantara_agent") } },
  });
});
afterAll(async () => {
  // Leave no flag pointing at a message another suite will delete.
  await owner.chatReviewFlag.deleteMany({});
  await owner.chatReviewThread.deleteMany({});
  await owner.chatReviewRun.deleteMany({});
  await owner.$disconnect();
  await agent.$disconnect();
});

let seq = 0;
async function line(
  from: string,
  text: string,
  reply: string | null,
  hoursAgo: number,
  by: "bot" | "staff" = "bot",
  status: "DIJAWAB_AGEN" | "BARU" = "DIJAWAB_AGEN",
) {
  seq += 1;
  const at = new Date(NIGHT.getTime() - hoursAgo * 3_600_000);
  return owner.waMessage.create({
    data: {
      waMessageId: `rv-${seq}`,
      from,
      text,
      msgType: "text",
      ts: at,
      direction: "IN",
      status,
      entities: {},
      replyText: reply,
      answeredByAgent: status === "BARU" ? false : by === "bot",
      answeredAt: status === "BARU" ? null : at,
    },
  });
}

type Script = (args: unknown) => unknown;
function scripted(...answers: Script[]) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      async create(args: Record<string, unknown>) {
        calls.push(args);
        const next = answers[Math.min(calls.length - 1, answers.length - 1)]!;
        return next(args);
      },
    },
  } as unknown as AgentClient;
  return { client, calls };
}
const answer =
  (flags: unknown[]): Script =>
  (_args?: unknown) => ({
    content: [{ type: "text", text: JSON.stringify({ flags }) }],
    usage: { input_tokens: 1000, output_tokens: 100 },
    stop_reason: "end_turn",
  });
const refuse =
  (status: number): Script =>
  () => {
    throw Object.assign(new Error(`HTTP ${status}`), { status });
  };

const run = (client: AgentClient | null, over: object = {}) =>
  reviewPass({
    db: agent,
    logger,
    anthropic: {},
    client,
    now: () => NIGHT,
    maxChats: 10,
    ...over,
  });

beforeEach(async () => {
  await truncateAll(owner);
  seq = 0;
});

describe("the chatbot audit's nightly pass", () => {
  it("does nothing outside 01:00–05:00 WIB", async () => {
    await line(A, "ada air m2?", "Ada kak, 12,9jt", 3);
    const { client, calls } = scripted(answer([]));
    expect((await run(client, { now: () => DAY })).status).toBe("outside");
    expect(calls).toHaveLength(0);
    expect(await owner.chatReviewRun.count()).toBe(0);
  });

  it("reads each chat with bot replies once, writes its flags, and finishes", async () => {
    const m1 = await line(A, "mau cari macbook", "Air 2014, 2,3jt", 5);
    await line(A, "buat kuliah", "Siap kak", 4);
    await line(B, "garansi?", "Garansi 1 bulan kak", 3);
    const { client, calls } = scripted((): unknown => {
      const handle = "m1";
      return answer([
        {
          category: "MISSED_SALE",
          severity: "BAD",
          message: handle,
          quote: "Air 2014, 2,3jt",
          suggestion: "Ask what it is for before recommending.",
        },
        // A handle outside the window is dropped.
        {
          category: "TONE",
          severity: "IMPROVE",
          message: "m99",
          quote: "x",
          suggestion: "y",
        },
      ])(undefined);
    });
    const first = await run(client);
    expect(first).toMatchObject({ status: "working", reviewed: 2, flags: 2 });
    expect(calls).toHaveLength(2);
    const prompt = String(
      (calls[0]!["messages"] as Array<{ content: string }>)[0]!.content,
    );
    expect(prompt).toMatch(/\[m1 customer .*\] mau cari macbook/);
    expect(prompt).toMatch(/\[m1 bot .*\] Air 2014, 2,3jt/);
    const system = JSON.stringify(calls[0]!["system"]);
    expect(system).toContain("MISSED_SALE");
    expect(calls[0]!["model"]).toBe("claude-sonnet-5-5");

    const flags = await owner.chatReviewFlag.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.messageId)).toContain(m1.id);

    // Read again: nothing new, so the night is done and no call is made.
    const second = await run(client);
    expect(second.status).toBe("done");
    expect(calls).toHaveLength(2);
    const r = await owner.chatReviewRun.findFirstOrThrow();
    expect(r).toMatchObject({
      status: "DONE",
      chats: 2,
      flags: 2,
      inputTokens: 2000,
    });
    expect(r.costMicros).toBeGreaterThan(0n);

    // A finished night stays finished.
    await line(A, "ok kak", "Siap kak", 0.5);
    expect((await run(client)).status).toBe("ended");
  });

  it("reads only what came after the cursor the next night", async () => {
    await line(A, "halo", "Halo kak", 30);
    const { client, calls } = scripted(answer([]));
    await run(client, {
      now: () => new Date(NIGHT.getTime() - 24 * 3_600_000),
    });
    await run(client, {
      now: () => new Date(NIGHT.getTime() - 24 * 3_600_000 + 60_000),
    });
    await line(A, "ada air m1?", "Ada kak, 9,8jt", 2);
    await run(client);
    expect(calls).toHaveLength(2);
    const last = String(
      (calls[1]!["messages"] as Array<{ content: string }>)[0]!.content,
    );
    expect(last).toContain("ada air m1?");
    expect(last).not.toContain("halo");
  });

  it("never reads a chat staff alone answered", async () => {
    await line(A, "halo", "Halo kak (staff)", 3, "staff");
    const { client, calls } = scripted(answer([]));
    expect((await run(client)).status).toBe("done");
    expect(calls).toHaveLength(0);
  });

  it("steps aside while a customer is waiting, and gives up after ten minutes", async () => {
    await line(A, "halo", "Halo kak", 3);
    await line(B, "kak?", null, 0.01, "bot", "BARU");
    const { client, calls } = scripted(answer([]));
    expect((await run(client)).status).toBe("busy");
    expect(
      (
        await run(client, {
          now: () => new Date(NIGHT.getTime() + 11 * 60_000),
        })
      ).status,
    ).toBe("stopped");
    expect(calls).toHaveLength(0);
    expect((await owner.chatReviewRun.findFirstOrThrow()).status).toBe(
      "STOPPED",
    );
  });

  it("fails the night, with no other model, when the token is refused on the first call", async () => {
    await line(A, "halo", "Halo kak", 3);
    const { client, calls } = scripted(refuse(429));
    expect((await run(client)).status).toBe("failed");
    expect(calls).toHaveLength(1);
    const r = await owner.chatReviewRun.findFirstOrThrow();
    expect(r.status).toBe("FAILED");
    expect(r.reason).toMatch(/claude-sonnet-5-5/);
  });

  it("stops (not fails) on a rate limit after it has read something", async () => {
    await line(A, "halo", "Halo kak", 3);
    await line(B, "halo", "Halo kak", 2);
    const { client } = scripted(answer([]), refuse(429));
    expect((await run(client)).status).toBe("stopped");
    expect(await owner.chatReviewThread.count()).toBe(1);
    expect((await owner.chatReviewRun.findFirstOrThrow()).status).toBe(
      "STOPPED",
    );
  });

  it("records a failed night when there is no credential", async () => {
    await line(A, "halo", "Halo kak", 3);
    expect((await run(null)).status).toBe("failed");
    expect((await owner.chatReviewRun.findFirstOrThrow()).reason).toMatch(
      /no Anthropic credential/,
    );
  });

  it("is allowed nothing it does not need: no DELETE for the agent", async () => {
    const rows = await agent.$queryRaw<Array<{ can: boolean }>>`
      SELECT has_table_privilege('"ChatReviewFlag"', 'DELETE') AS can`;
    expect(rows[0]?.can).toBe(false);
  });
});
