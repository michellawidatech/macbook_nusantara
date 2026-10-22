/**
 * The rolling summary — what the agent remembers once the transcript scrolls
 * away.
 *
 * Only the last few answered turns are sent verbatim. Everything older survives
 * here instead: one cheap call, every few turns, rewriting a short note of what
 * this customer wants. It rides in every later system prompt, which is why it
 * is capped, and why it is fenced as facts rather than instructions.
 *
 * ## The two claims that matter most
 *
 * **A failed refresh must not move the cursor.** The cursor records the newest
 * turn already folded in. If a failure advanced it, the turns in between would
 * be skipped permanently — a conversation with a silent hole in it. So a
 * failure writes the attempt timestamp and nothing else, the uncovered count
 * keeps growing, and the next tick retries. Self-healing, no retry queue.
 *
 * **The summariser must never write a staff directive.** `WaThreadMemory` is
 * shared by two writers with disjoint columns, and 04 Inc-7's definition of
 * done requires this asserted by test. `packages/db/test/invariants.test.ts`
 * proves the database refuses the UPDATE; this file proves our own code never
 * attempts it — including on the create branch, where the table-wide INSERT
 * grant means the database would happily allow it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_NOTHING,
  SUMMARY_SYSTEM,
  loadThreadMemory,
  markSummaryAttempt,
  renderTranscript,
  saveSummary,
  summarize,
} from "../src/index.js";
import { ANCHOR, says, scriptedClient } from "./fixtures.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const FROM = "628111000999";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  // Memory rows first: `coveredThroughId` is an FK to WaMessage with
  // onDelete: Restrict, so deleting messages while a cursor points at one
  // fails rather than cascading.
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

/** An answered turn, as the summariser reads it. */
async function answered(opts: {
  id: string;
  text: string;
  reply: string;
  answeredAt: Date;
}) {
  return db.waMessage.create({
    data: {
      waMessageId: opts.id,
      from: FROM,
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

describe("the summariser's own prompt", () => {
  it("asks for the request, what is answered, what is pending, the key data and the mood", () => {
    // These five are what a staff member picking the thread up actually needs,
    // and the model will not produce them unless asked by name.
    expect(SUMMARY_SYSTEM).toMatch(/what the customer wants/i);
    expect(SUMMARY_SYSTEM).toMatch(/already been answered|already answered/i);
    expect(SUMMARY_SYSTEM).toMatch(/still open|still pending/i);
    expect(SUMMARY_SYSTEM).toMatch(/budget/i);
    expect(SUMMARY_SYSTEM).toMatch(/reservation code/i);
    expect(SUMMARY_SYSTEM).toMatch(/in a hurry|mood|how they seem/i);
  });

  it("forbids inventing anything, because a summary becomes a fact next turn", () => {
    expect(SUMMARY_SYSTEM).toMatch(/facts only/i);
    expect(SUMMARY_SYSTEM).toMatch(/never invent/i);
  });

  it("records a customer's instruction as something they asked for, never as an order", () => {
    // The summary is the ONE place customer-derived text is promoted into a
    // later system prompt, so the injection guard belongs at both ends.
    expect(SUMMARY_SYSTEM).toMatch(/the customer asked/i);
    expect(SUMMARY_SYSTEM).toMatch(
      /not an instruction|never restate it as a command/i,
    );
  });

  it("asks for plain text, so a bulleted note cannot teach the bot to write bullets", () => {
    expect(SUMMARY_SYSTEM).toMatch(/no bullets/i);
    expect(SUMMARY_SYSTEM).not.toMatch(/[—–]/);
  });
});

describe("renderTranscript", () => {
  it("labels who said what, oldest first", () => {
    const out = renderTranscript([
      { text: "ada m2?", replyText: "ada kak" },
      { text: "berapa?", replyText: "15.500.000" },
    ]);
    expect(out).toBe(
      "customer: ada m2?\nshop: ada kak\ncustomer: berapa?\nshop: 15.500.000",
    );
  });

  it("skips a turn with nothing readable rather than emitting a blank line", () => {
    expect(renderTranscript([{ text: null, replyText: null }])).toBe("");
  });
});

describe("summarize", () => {
  it("rewrites the note from the previous one plus the new turns", async () => {
    const model = scriptedClient([
      says(
        "Mau MacBook Air M2 256GB, budget 15jt, buat kuliah. Harga sudah dikasih.",
      ),
    ]);
    const out = await summarize({
      client: model.client,
      previous: "Mau MacBook Air M2.",
      turns: [{ text: "budget 15jt", replyText: "ada kak, 15.500.000" }],
    });

    expect(out).toContain("budget 15jt");
    // Both halves reach the model: it is rewriting, not appending.
    const sent = JSON.stringify(model.calls[0]!.messages);
    expect(sent).toContain("Mau MacBook Air M2.");
    expect(sent).toContain("budget 15jt");
  });

  it("returns an empty string when the model says there is nothing worth keeping", async () => {
    const model = scriptedClient([says(SUMMARY_NOTHING)]);
    const out = await summarize({
      client: model.client,
      previous: null,
      turns: [{ text: "halo", replyText: "halo kak" }],
    });
    // Distinct from null: nothing to store, but the cursor should still move.
    expect(out).toBe("");
  });

  it("returns null on a model failure rather than throwing", async () => {
    const model = scriptedClient([]);
    let seen: unknown;
    const out = await summarize({
      client: model.client,
      previous: null,
      turns: [{ text: "halo", replyText: "halo kak" }],
      onError: (e) => {
        seen = e;
      },
    });
    expect(out).toBeNull();
    expect(seen).toBeDefined();
  });

  it("returns null for a transcript with nothing in it, without calling the model", async () => {
    const model = scriptedClient([says("never reached")]);
    const out = await summarize({
      client: model.client,
      previous: null,
      turns: [{ text: null, replyText: null }],
    });
    expect(out).toBeNull();
    expect(model.calls).toHaveLength(0);
  });

  it("caps the note at a word boundary, because it rides in every later prompt", async () => {
    const long = "MacBook ".repeat(300);
    const model = scriptedClient([says(long)]);
    const out = await summarize({
      client: model.client,
      previous: null,
      turns: [{ text: "halo", replyText: "halo kak" }],
    });
    expect(out!.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(out!.endsWith("MacBook")).toBe(true);
  });

  it("strips formatting, so a bulleted note cannot teach the bot to write bullets", async () => {
    const model = scriptedClient([
      says("- mau Air M2\n- budget 15jt — sudah deal"),
    ]);
    const out = await summarize({
      client: model.client,
      previous: null,
      turns: [{ text: "halo", replyText: "halo kak" }],
    });
    expect(out).not.toMatch(/[—–]/);
    expect(out).not.toMatch(/^\s*-\s/m);
  });
});

describe("thread memory", () => {
  it("reads an empty memory for a thread that has none, rather than failing the reply", async () => {
    const memo = await loadThreadMemory(db, FROM);
    expect(memo).toMatchObject({
      from: FROM,
      summary: null,
      directive: null,
      coveredThroughAt: null,
    });
  });

  it("creates the row on the first summary, supplying the columns that have no defaults", async () => {
    const turn = await answered({
      id: "s.1",
      text: "ada m2?",
      reply: "ada kak",
      answeredAt: ANCHOR,
    });

    const ok = await saveSummary(
      db,
      FROM,
      {
        summary: "Mau Air M2, budget 15jt.",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );
    expect(ok).toBe(true);

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBe("Mau Air M2, budget 15jt.");
    expect(memo.summaryTurns).toBe(1);
    expect(memo.clarifyCount).toBe(0);
    expect(memo.coveredThroughId).toBe(turn.id);
  });

  it("leaves a staff directive untouched when it creates the row", async () => {
    // The create branch is the hole the UPDATE grants do not close: INSERT is
    // granted table-wide, so the database would allow a directive here. The
    // guarantee has to come from the payload never naming the column.
    const turn = await answered({
      id: "s.2",
      text: "halo",
      reply: "halo kak",
      answeredAt: ANCHOR,
    });
    await saveSummary(
      db,
      FROM,
      {
        summary: "Baru menyapa.",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.directive).toBeNull();
    expect(memo.directiveAt).toBeNull();
    expect(memo.directiveById).toBeNull();
  });

  it("leaves a staff directive untouched when it updates an existing row", async () => {
    await db.waThreadMemory.create({
      data: {
        from: FROM,
        directive: "kasih diskon 200rb kalau nawar",
        directiveAt: ANCHOR,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: ANCHOR,
      },
    });
    const turn = await answered({
      id: "s.3",
      text: "boleh nego?",
      reply: "boleh kak",
      answeredAt: ANCHOR,
    });

    await saveSummary(
      db,
      FROM,
      {
        summary: "Sedang menawar.",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summary).toBe("Sedang menawar.");
    // The whole point of invariant 13, asserted on our side of it.
    expect(memo.directive).toBe("kasih diskon 200rb kalau nawar");
    expect(memo.directiveAt).toEqual(ANCHOR);
  });

  it("advances the cursor to the turn it covered", async () => {
    const turn = await answered({
      id: "s.4",
      text: "ada m2?",
      reply: "ada kak",
      answeredAt: ANCHOR,
    });
    await saveSummary(
      db,
      FROM,
      {
        summary: "Tanya stok.",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );

    const memo = await loadThreadMemory(db, FROM);
    expect(memo.coveredThroughAt).toEqual(ANCHOR);
    expect(memo.coveredThroughId).toBe(turn.id);
  });

  it("stores an empty summary as null but still advances the cursor", async () => {
    // Otherwise every later turn re-summarises the same empty conversation
    // forever, at one model call each.
    const turn = await answered({
      id: "s.5",
      text: "halo",
      reply: "halo kak",
      answeredAt: ANCHOR,
    });
    await saveSummary(
      db,
      FROM,
      {
        summary: null,
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );

    const memo = await loadThreadMemory(db, FROM);
    expect(memo.summary).toBeNull();
    expect(memo.coveredThroughId).toBe(turn.id);
  });

  it("records a failed attempt without moving the cursor, so the next tick retries", async () => {
    const turn = await answered({
      id: "s.6",
      text: "ada m2?",
      reply: "ada kak",
      answeredAt: ANCHOR,
    });
    await saveSummary(
      db,
      FROM,
      {
        summary: "Tanya stok.",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: turn.id,
      },
      ANCHOR,
    );

    const later = new Date(ANCHOR.getTime() + 60_000);
    await markSummaryAttempt(db, FROM, later);

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    // The attempt clock moved; nothing else did.
    expect(memo.summaryAt).toEqual(later);
    expect(memo.summary).toBe("Tanya stok.");
    expect(memo.coveredThroughId).toBe(turn.id);
  });

  it("records an attempt on a thread with no memory row yet, rather than failing", async () => {
    const ok = await markSummaryAttempt(db, FROM, ANCHOR);
    expect(ok).toBe(true);
    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memo.summaryAt).toEqual(ANCHOR);
    expect(memo.summary).toBeNull();
  });

  it("never throws, so a failed summary cannot turn a delivered reply into a retry", async () => {
    // A cursor pointing at a message that does not exist violates the FK.
    const ok = await saveSummary(
      db,
      FROM,
      {
        summary: "x",
        turns: 1,
        coveredThroughAt: ANCHOR,
        coveredThroughId: "does-not-exist",
      },
      ANCHOR,
    );
    expect(ok).toBe(false);
  });
});
