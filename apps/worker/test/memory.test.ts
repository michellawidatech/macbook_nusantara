/**
 * Chat memory (2026-10-22), every pass logged in as nusantara_agent — the
 * role production gives the worker — against fixtures the owner wrote:
 *
 *  - a burst's every line reaches the history and the summariser;
 *  - the memory pass chunks answered turns and embeds them through a FAKE
 *    Voyage fetch (never the real API), and holds no grant beyond what it
 *    uses;
 *  - recall puts an older turn in the prompt's volatile half, dated, by
 *    vector with a key and by keywords without one or when Voyage is down,
 *    and never a turn from before a `/new`;
 *  - the profile reaches the single agent's prompt.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import {
  RESET_INTENT,
  VOYAGE_DIMENSIONS,
  type AgentClient,
  type CreateArgs,
  type VoyageOptions,
} from "@nusantara/agent";
import { draftPass } from "../src/draft.js";
import { summaryPass } from "../src/summarise.js";
import { memoryPass } from "../src/memoryPass.js";

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
const NOW = new Date("2026-08-20T03:00:00.000Z");
const FROM = "628111000777";
const AGENT_STAFF = "staff_agent";

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
      id: AGENT_STAFF,
      username: "agent",
      name: "Agen WhatsApp",
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
});

let seq = 0;
/** An inbound row. `answeredAt` and `replyText` make it an answered one. */
async function msg(
  text: string | null,
  ts: Date,
  answer?: { at: Date; reply?: string; intent?: string },
  msgType = "text",
) {
  seq += 1;
  return owner.waMessage.create({
    data: {
      waMessageId: `mem.${seq}`,
      from: FROM,
      name: "Budi",
      text,
      msgType,
      ts,
      direction: "IN",
      status: answer ? "DIJAWAB_AGEN" : "BARU",
      entities: {},
      answeredByAgent: Boolean(answer?.reply),
      ...(answer
        ? {
            answeredAt: answer.at,
            ...(answer.reply ? { replyText: answer.reply } : {}),
            ...(answer.intent ? { intent: answer.intent } : {}),
          }
        : {}),
    },
  });
}

const min = (n: number) => new Date(NOW.getTime() - n * 60_000);

/** One answered burst: lines, then the reply on the last. */
async function turn(lines: string[], reply: string, minutesAgo: number) {
  const at = min(minutesAgo - 0.5);
  for (const [i, l] of lines.entries()) {
    await msg(l, new Date(min(minutesAgo).getTime() + i * 1_000), {
      at,
      ...(i === lines.length - 1 ? { reply } : {}),
    });
  }
}

/** A model that replies "ok kak", recording what it was sent. */
function recordingModel(): { client: AgentClient; made: CreateArgs[] } {
  const made: CreateArgs[] = [];
  const create = async (args: CreateArgs) => {
    made.push(args);
    if (!args.tools || args.tools.length === 0) {
      return {
        content: [{ type: "text" as const, text: "Catatan.", citations: [] }],
        stop_reason: "end_turn" as const,
      };
    }
    return {
      content: [
        {
          type: "tool_use" as const,
          id: "t1",
          name: "reply",
          input: { message: "ok kak", sources: "greeting" },
        },
      ],
      stop_reason: "tool_use" as const,
    };
  };
  return { made, client: { messages: { create } } as unknown as AgentClient };
}

/**
 * A fake Voyage: a word-presence vector, so "air m2" turns point the same
 * way and nothing else does. Counts calls; can be made to fail or hang.
 */
function fakeVoyage(mode: "ok" | "down" | "hang" = "ok"): {
  voyage: VoyageOptions;
  calls: Array<{ input: string[]; input_type: string }>;
} {
  const calls: Array<{ input: string[]; input_type: string }> = [];
  const WORDS = ["air", "m2", "garansi", "cod", "ipad", "pro"];
  const vec = (t: string) =>
    Array.from({ length: VOYAGE_DIMENSIONS }, (_, i) =>
      i < WORDS.length && t.toLowerCase().includes(WORDS[i]!)
        ? 100
        : i === 511
          ? 1
          : 0,
    );
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      input: string[];
      input_type: string;
    };
    calls.push(body);
    if (mode === "down") return new Response("down", { status: 503 });
    if (mode === "hang")
      return new Promise((_res, rej) =>
        init.signal!.addEventListener("abort", () =>
          rej(Object.assign(new Error("t"), { name: "TimeoutError" })),
        ),
      );
    return new Response(
      JSON.stringify({
        data: body.input.map((t, index) => ({ embedding: vec(t), index })),
      }),
    );
  }) as unknown as typeof fetch;
  return {
    calls,
    voyage: { apiKey: "test-key", model: "voyage-4-lite", fetchImpl },
  };
}

async function draft(
  client: AgentClient,
  voyage: VoyageOptions | null,
  timeoutMs?: number,
) {
  return draftPass({
    db: agent,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    now: () => NOW,
    recall: { voyage, ...(timeoutMs ? { timeoutMs } : {}) },
  });
}

const volatileOf = (args: CreateArgs) =>
  (args.system as Array<{ text: string; cache_control?: unknown }>)
    .filter((b) => !b.cache_control)
    .map((b) => b.text)
    .join("\n");
const stableOf = (args: CreateArgs) =>
  (args.system as Array<{ text: string; cache_control?: unknown }>)
    .filter((b) => b.cache_control)
    .map((b) => b.text)
    .join("\n");

describe("a burst is one turn", () => {
  it("reaches the history with every line, not only the row the reply is on", async () => {
    await turn(["halo", "mau tanya", "Air M2 16/512 ada?"], "Ada kak", 30);
    await msg("berapa?", min(1));
    const { client, made } = recordingModel();
    await draft(client, null);
    const msgs = made[0]!.messages;
    expect(msgs[0]).toEqual({
      role: "user",
      content: "halo\nmau tanya\nAir M2 16/512 ada?",
    });
    expect(msgs[1]).toEqual({ role: "assistant", content: "Ada kak" });
  });

  it("reaches the summariser with every line", async () => {
    await turn(["halo", "nama saya Budi", "budget 15jt"], "Siap kak Budi", 60);
    const { client, made } = recordingModel();
    await summaryPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client,
      model: "claude-haiku-5-5",
      everyTurns: 1,
      quietMs: 60_000,
      maxPerTick: 3,
      now: () => NOW,
    });
    const sent = made[0]!.messages[0]!.content as string;
    expect(sent).toMatch(/pelanggan: halo\nnama saya Budi\nbudget 15jt/);
    expect(made[0]!.model).toBe("claude-haiku-5-5");
  });
});

describe("the memory pass, as nusantara_agent", () => {
  it("chunks answered turns once and embeds them through Voyage", async () => {
    await turn(["halo", "Air M2 ada?"], "Ada kak", 90);
    await turn(["garansi?"], "1 bulan kak", 80);
    await msg("/new", min(70), {
      at: min(70),
      reply: "Oke, mulai baru",
      intent: RESET_INTENT,
    });
    const { voyage, calls } = fakeVoyage();
    const first = await memoryPass({
      db: agent,
      logger,
      voyage,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    expect(first).toEqual({ chunked: 2, embedded: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input_type).toBe("document");
    const chunks = await owner.chatMemoryChunk.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(chunks.map((c) => c.text)).toEqual([
      "customer: halo\nAir M2 ada?\nshop: Ada kak",
      "customer: garansi?\nshop: 1 bulan kak",
    ]);
    expect(chunks.every((c) => c.from === FROM)).toBe(true);
    expect(chunks[0]!.dims).toBe(512);
    expect(chunks[0]!.embedding!.length).toBe(512);
    expect(chunks[0]!.model).toBe("voyage-4-lite");

    // Nothing new: nothing written, nothing sent.
    const again = await memoryPass({
      db: agent,
      logger,
      voyage,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    expect(again).toEqual({ chunked: 0, embedded: 0 });
    expect(calls).toHaveLength(1);
  });

  it("keeps chunks as text when there is no key or Voyage is down", async () => {
    await turn(["Air M2 ada?"], "Ada kak", 90);
    expect(
      await memoryPass({
        db: agent,
        logger,
        voyage: null,
        maxTurns: 40,
        maxEmbeds: 32,
      }),
    ).toEqual({ chunked: 1, embedded: 0 });
    const { voyage } = fakeVoyage("down");
    expect(
      await memoryPass({
        db: agent,
        logger,
        voyage,
        maxTurns: 40,
        maxEmbeds: 32,
      }),
    ).toEqual({ chunked: 0, embedded: 0 });
    const c = await owner.chatMemoryChunk.findFirstOrThrow();
    expect(c.embedding).toBeNull();
  });

  it("cannot rewrite a chunk's words or delete one", async () => {
    await turn(["Air M2 ada?"], "Ada kak", 90);
    await memoryPass({
      db: agent,
      logger,
      voyage: null,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    const c = await owner.chatMemoryChunk.findFirstOrThrow();
    await expect(
      agent.$executeRawUnsafe(
        `UPDATE "ChatMemoryChunk" SET "text" = 'x' WHERE id = '${c.id}'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      agent.$executeRawUnsafe(`DELETE FROM "ChatMemoryChunk"`),
    ).rejects.toThrow(/permission denied/);
  });
});

/** Ten earlier turns: one about an Air M2 price, then nine of small talk. */
async function longThread() {
  await turn(
    ["Air M2 8/256 berapa kak?"],
    "Air M2 8/256 grade A Rp12.500.000 kak",
    600,
  );
  for (let i = 0; i < 9; i += 1)
    await turn([`oke ${i}`], `siap kak ${i}`, 500 - i * 10);
}

describe("recall at draft time", () => {
  it("puts the related older turn in the volatile prompt, dated, by vector", async () => {
    await longThread();
    const { voyage, calls } = fakeVoyage();
    await memoryPass({
      db: agent,
      logger,
      voyage,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    await owner.customerProfile.create({
      data: {
        from: FROM,
        name: "Budi",
        budgetMax: 15_000_000n,
        updatedAt: NOW,
      },
    });
    await msg("yang air m2 kemarin masih?", min(1));
    const { client, made } = recordingModel();
    const r = await draft(client, voyage);
    expect(r.drafted).toBe(1);
    const volatile = volatileOf(made[0]!);
    expect(volatile).toMatch(/Earlier with this customer \(may be outdated\)/);
    expect(volatile).toMatch(/\(20 Aug 2026\).*Rp12\.500\.000/);
    expect(volatile).toMatch(/name Budi; budget Rp\s?15\.000\.000/);
    // The cached half carries nothing about this customer.
    expect(stableOf(made[0]!)).not.toMatch(/Budi|12\.500\.000/);
    // The older turn is NOT in the eight the history shows.
    expect(JSON.stringify(made[0]!.messages)).not.toMatch(/12\.500\.000/);
    expect(calls.at(-1)!.input_type).toBe("query");
  });

  it("falls back to keywords when Voyage hangs, within the deadline", async () => {
    await longThread();
    const ok = fakeVoyage();
    await memoryPass({
      db: agent,
      logger,
      voyage: ok.voyage,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    await msg("air m2 8/256 berapa?", min(1));
    const hang = fakeVoyage("hang");
    const { client, made } = recordingModel();
    const started = Date.now();
    const r = await draft(client, hang.voyage, 200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.drafted).toBe(1);
    expect(hang.calls).toHaveLength(1);
    expect(volatileOf(made[0]!)).toMatch(/Rp12\.500\.000/);
  });

  it("recalls by keywords with no key at all", async () => {
    await longThread();
    await memoryPass({
      db: agent,
      logger,
      voyage: null,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    await msg("air m2 8/256 berapa?", min(1));
    const { client, made } = recordingModel();
    await draft(client, null);
    expect(volatileOf(made[0]!)).toMatch(/Rp12\.500\.000/);
  });

  it("never recalls a turn from before the thread's /new", async () => {
    await turn(
      ["Air M2 8/256 berapa kak?"],
      "Air M2 8/256 grade A Rp12.500.000 kak",
      700,
    );
    await msg("/new", min(650), {
      at: min(650),
      reply: "Oke, mulai baru",
      intent: RESET_INTENT,
    });
    for (let i = 0; i < 9; i += 1)
      await turn([`oke ${i}`], `siap kak ${i}`, 500 - i * 10);
    await memoryPass({
      db: agent,
      logger,
      voyage: null,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    await msg("air m2 8/256 berapa?", min(1));
    const { client, made } = recordingModel();
    await draft(client, null);
    expect(volatileOf(made[0]!)).not.toMatch(/12\.500\.000/);
    expect(volatileOf(made[0]!)).not.toMatch(/Earlier with this customer/);
  });
});
