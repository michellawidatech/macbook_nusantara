import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";

const { db } = mockDb();

const create = vi.fn();
const hasAnthropicCredential = vi.fn(() => true);
vi.doMock("./anthropic.js", () => ({
  hasAnthropicCredential,
  anthropicClient: () => ({ messages: { create } }),
}));

const { refreshSummaryIfDue, summarize, SUMMARY_EVERY_TURNS, SUMMARY_MAX_CHARS } =
  await import("./summarize.js");

/** A finished Anthropic text response. */
const textResp = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

const COVERED = new Date("2026-08-11T09:00:00.000Z");
const NEWEST = new Date("2026-08-11T10:00:00.000Z");

const turn = (id: string, text: string, replyText: string, answeredAt = NEWEST) => ({
  id,
  text,
  replyText,
  answeredAt,
});

const memo = (over: Record<string, unknown> = {}) => ({
  summary: null,
  directive: null,
  clarifyCount: 0,
  coveredThroughAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  hasAnthropicCredential.mockReturnValue(true);
  db.waThreadMemory.upsert.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refreshSummaryIfDue", () => {
  it("does nothing below the turn threshold", async () => {
    db.waMessage.count.mockResolvedValue(SUMMARY_EVERY_TURNS - 1);

    await expect(refreshSummaryIfDue("628111", memo())).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(db.waThreadMemory.upsert).not.toHaveBeenCalled();
  });

  it("counts only answered inbound turns, and only past the cursor", async () => {
    db.waMessage.count.mockResolvedValue(0);
    await refreshSummaryIfDue("628111", memo({ coveredThroughAt: COVERED }));

    expect(db.waMessage.count.mock.calls[0]![0].where).toMatchObject({
      from: "628111",
      direction: "IN",
      replyText: { not: null },
      answeredAt: { gt: COVERED },
    });
  });

  it("omits the cursor filter on the very first summary", async () => {
    db.waMessage.count.mockResolvedValue(0);
    await refreshSummaryIfDue("628111", memo());
    expect(db.waMessage.count.mock.calls[0]![0].where).not.toHaveProperty("answeredAt");
  });

  it("fires at the threshold and stores the summary plus the cursor", async () => {
    db.waMessage.count.mockResolvedValue(SUMMARY_EVERY_TURNS);
    db.waMessage.findMany.mockResolvedValue([
      turn("m9", "jadi yang mana kak", "Air M2 ya kak", NEWEST),
      turn("m8", "budget 15jt", "Pas kak", COVERED),
    ]);
    create.mockResolvedValue(textResp("Cari MacBook Air M2, budget 15jt, belum booking"));

    await expect(refreshSummaryIfDue("628111", memo())).resolves.toBe(true);

    const arg = db.waThreadMemory.upsert.mock.calls[0]![0];
    expect(arg.update).toMatchObject({
      summary: "Cari MacBook Air M2, budget 15jt, belum booking",
      summaryTurns: 2,
      // rows come back newest-first, so the cursor is the FIRST row
      coveredThroughAt: NEWEST,
      coveredThroughId: "m9",
    });
  });

  it("feeds the model the previous summary and the new turns in chronological order", async () => {
    db.waMessage.count.mockResolvedValue(SUMMARY_EVERY_TURNS);
    db.waMessage.findMany.mockResolvedValue([
      turn("m9", "oke deal", "Siap kak", NEWEST),
      turn("m8", "ada diskon", "Ada promo kak", COVERED),
    ]);
    create.mockResolvedValue(textResp("Deal Air M2"));

    await refreshSummaryIfDue("628111", memo({ summary: "Mau MacBook Air" }));

    const prompt = create.mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain("Mau MacBook Air");
    // reversed to oldest-first
    expect(prompt.indexOf("ada diskon")).toBeLessThan(prompt.indexOf("oke deal"));
    expect(prompt).toContain("pelanggan: oke deal");
    expect(prompt).toContain("admin: Siap kak");
  });

  it("writes nothing at all when the model call fails, so the next turn retries", async () => {
    db.waMessage.count.mockResolvedValue(SUMMARY_EVERY_TURNS);
    db.waMessage.findMany.mockResolvedValue([turn("m9", "halo", "halo kak")]);
    create.mockRejectedValue(new Error("429"));

    await expect(refreshSummaryIfDue("628111", memo())).resolves.toBe(false);
    // the cursor must NOT move, or those turns are lost forever
    expect(db.waThreadMemory.upsert).not.toHaveBeenCalled();
  });

  it("advances the cursor but stores null when there is nothing worth remembering", async () => {
    db.waMessage.count.mockResolvedValue(SUMMARY_EVERY_TURNS);
    db.waMessage.findMany.mockResolvedValue([turn("m9", "ok", "sama sama kak")]);
    create.mockResolvedValue(textResp("BELUM ADA"));

    await expect(refreshSummaryIfDue("628111", memo())).resolves.toBe(true);

    const arg = db.waThreadMemory.upsert.mock.calls[0]![0];
    expect(arg.update.summary).toBeNull();
    // still advances, otherwise every later turn re-summarizes the same chat
    expect(arg.update.coveredThroughId).toBe("m9");
  });

  it("stays dormant without an Anthropic credential", async () => {
    hasAnthropicCredential.mockReturnValue(false);
    await expect(refreshSummaryIfDue("628111", memo())).resolves.toBe(false);
    expect(db.waMessage.count).not.toHaveBeenCalled();
  });
});

describe("summarize", () => {
  it("strips formatting and caps the stored length", async () => {
    const long = `**${"panjang ".repeat(300)}**`;
    create.mockResolvedValue(textResp(long));

    const out = await summarize(null, [{ text: "halo", replyText: "halo kak" }]);

    expect(out!.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(out).not.toContain("**");
  });

  it("returns null on error rather than throwing", async () => {
    create.mockRejectedValue(new Error("boom"));
    await expect(summarize(null, [{ text: "a", replyText: "b" }])).resolves.toBeNull();
  });

  it("returns null when there is no transcript to summarize", async () => {
    await expect(summarize(null, [{ text: null, replyText: null }])).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
