import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";

const { db } = mockDb();

// Stub the agent loop, credential check, and the WhatsApp sender so the pipeline
// is tested in isolation from the network.
const converse = vi.fn();
const hasAnthropicCredential = vi.fn(() => true);
const sendText = vi.fn(async () => {});
vi.doMock("./converse.js", () => ({ converse }));
vi.doMock("./anthropic.js", () => ({ hasAnthropicCredential }));
vi.doMock("../send.js", () => ({ sendText }));

// The summarizer reads waMessage too, and would eat the mockResolvedValueOnce
// queue mockConvo sets up. Stub it out; summarize.test.ts covers it directly.
const refreshSummaryIfDue = vi.fn(async () => false);
vi.doMock("./summarize.js", () => ({ refreshSummaryIfDue }));

const { buildHistory, runConversation, HISTORY_LIMIT, HISTORY_LIMIT_COLD } =
  await import("./pipeline.js");
const { handoffAck, handoffLine, ambiguousHandoff } = await import("./handoff.js");

const row = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  waMessageId: "wamid.1",
  from: "628111",
  name: "Budi",
  text: "halo",
  msgType: "text",
  status: "BARU",
  ts: new Date(),
  ...over,
});

/** Mock the two findMany reads runConversation makes: the BARU burst, then history. */
const mockConvo = (batch: unknown[], history: unknown[] = []) => {
  db.waMessage.findMany.mockResolvedValueOnce(batch).mockResolvedValueOnce(history);
};

/** Seed this thread's stored memory (the findUnique between the two findManys). */
const mockMemory = (over: Record<string, unknown> = {}) => {
  db.waThreadMemory.findUnique.mockResolvedValue({
    summary: null,
    directive: null,
    clarifyCount: 0,
    clarifyAt: null,
    coveredThroughAt: null,
    ...over,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the once-queue too: clearAllMocks keeps queued mockResolvedValueOnce
  // values, and early-return tests consume only the first — reset avoids leaks.
  db.waMessage.findMany.mockReset();
  hasAnthropicCredential.mockReturnValue(true);
  mockMemory();
  db.waThreadMemory.upsert.mockResolvedValue({});
});

describe("buildHistory", () => {
  it("appends the current message as the final user turn", () => {
    expect(buildHistory([], "halo kak")).toEqual([{ role: "user", content: "halo kak" }]);
  });

  it("emits an alternating user/assistant transcript from answered rows", () => {
    const out = buildHistory(
      [{ text: "stok m2?", replyText: "ada 2 unit kak" }],
      "kalau M3?",
    );
    expect(out).toEqual([
      { role: "user", content: "stok m2?" },
      { role: "assistant", content: "ada 2 unit kak" },
      { role: "user", content: "kalau M3?" },
    ]);
  });

  it("skips unanswered / empty prior rows so turns stay alternating", () => {
    const out = buildHistory(
      [
        { text: "halo", replyText: null }, // unanswered → skipped
        { text: "harga air m2?", replyText: "Rp 15 jt kak" },
        { text: null, replyText: "orphan" }, // no question → skipped
      ],
      "ada promo?",
    );
    expect(out).toEqual([
      { role: "user", content: "harga air m2?" },
      { role: "assistant", content: "Rp 15 jt kak" },
      { role: "user", content: "ada promo?" },
    ]);
  });
});

describe("runConversation", () => {
  it("hands a non-text-only burst to staff without running the agent", async () => {
    mockConvo([row({ msgType: "image", text: null })]);
    await runConversation("628111");
    expect(converse).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith("628111", handoffAck());
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("does nothing when there is no pending burst", async () => {
    mockConvo([]);
    await runConversation("628111");
    expect(converse).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("hands off when no Anthropic credential is configured", async () => {
    hasAnthropicCredential.mockReturnValue(false);
    mockConvo([row()]);
    await runConversation("628111");
    expect(converse).not.toHaveBeenCalled();
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("builds history from prior answered turns and passes it + identity to the agent", async () => {
    mockConvo(
      [row({ text: "yang murah dong" })],
      [{ text: "harga air m2?", replyText: "Rp 15 jt kak" }],
    );
    converse.mockResolvedValue({ reply: "Ada beberapa pilihan kak 😊" });
    await runConversation("628111");

    // burst load is BARU rows; history load is only answered inbound rows
    expect(db.waMessage.findMany.mock.calls[0]![0].where).toMatchObject({ from: "628111", status: "BARU" });
    expect(db.waMessage.findMany.mock.calls[1]![0].where).toMatchObject({
      from: "628111",
      direction: "IN",
      replyText: { not: null },
    });
    expect(converse).toHaveBeenCalledWith(
      [
        { role: "user", content: "harga air m2?" },
        { role: "assistant", content: "Rp 15 jt kak" },
        { role: "user", content: "yang murah dong" },
      ],
      { from: "628111", name: "Budi" },
      expect.objectContaining({ summary: null, directive: null }),
    );
  });

  it("keeps the full cold window until a summary exists to replace it", async () => {
    mockConvo([row({ text: "halo" })]);
    converse.mockResolvedValue({ reply: "Halo kak" });
    await runConversation("628111");
    expect(db.waMessage.findMany.mock.calls[1]![0].take).toBe(HISTORY_LIMIT_COLD);
  });

  it("shrinks the verbatim window once the summary carries the older context", async () => {
    mockMemory({ summary: "Mau MacBook Air M2, budget 15jt" });
    mockConvo([row({ text: "halo" })]);
    converse.mockResolvedValue({ reply: "Halo kak" });
    await runConversation("628111");
    expect(db.waMessage.findMany.mock.calls[1]![0].take).toBe(HISTORY_LIMIT);
  });

  it("passes the stored summary and staff directive to the agent", async () => {
    mockMemory({ summary: "Budget 15jt", directive: "kasih diskon 200rb" });
    mockConvo([row({ text: "jadi berapa kak" })]);
    converse.mockResolvedValue({ reply: "13.8jt kak" });
    await runConversation("628111");

    expect(converse.mock.calls[0]![2]).toMatchObject({
      summary: "Budget 15jt",
      directive: "kasih diskon 200rb",
    });
  });

  it("refreshes the summary after the reply is already sent", async () => {
    mockConvo([row({ text: "halo" })]);
    converse.mockResolvedValue({ reply: "Halo kak" });
    await runConversation("628111");

    expect(sendText).toHaveBeenCalled();
    expect(refreshSummaryIfDue).toHaveBeenCalledWith("628111", expect.objectContaining({ summary: null }));
  });

  it("still delivers the reply when the summary refresh throws", async () => {
    refreshSummaryIfDue.mockRejectedValueOnce(new Error("anthropic down"));
    mockConvo([row({ id: "m1", text: "halo" })]);
    converse.mockResolvedValue({ reply: "Halo kak" });

    await runConversation("628111");

    expect(sendText).toHaveBeenCalledWith("628111", "Halo kak");
    // the burst must not be left BARU for the sweeper to replay
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DIJAWAB_AGEN" }) }),
    );
  });

  it("coalesces a burst into one user turn and stamps every row DIJAWAB_AGEN", async () => {
    mockConvo([
      row({ id: "m1", text: "mau tanya" }),
      row({ id: "m2", text: "stok air m2?" }),
    ]);
    converse.mockResolvedValue({ reply: "Stok Air M2 ada 2 unit kak 😊" });
    await runConversation("628111");

    // the two lines are joined into a single final user turn
    const history = converse.mock.calls[0]![0];
    expect(history.at(-1)).toEqual({ role: "user", content: "mau tanya\nstok air m2?" });

    expect(sendText).toHaveBeenCalledOnce();
    // all burst rows marked answered, reply text on the last row
    expect(db.waMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: expect.objectContaining({ status: "DIJAWAB_AGEN", answeredBy: "agent" }),
    });
    expect(db.waMessage.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { replyText: "Stok Air M2 ada 2 unit kak 😊" },
    });
  });

  it("sanitizes the reply to plain text before sending (no bold, capped emoji)", async () => {
    mockConvo([row({ text: "stok air m2?" })]);
    converse.mockResolvedValue({ reply: "**Stok** Air M2 ada 2 *unit* kak 😊😊😊" });
    await runConversation("628111");
    expect(sendText).toHaveBeenCalledWith("628111", "Stok Air M2 ada 2 unit kak 😊");
  });

  it("sends chat punctuation, not print punctuation", async () => {
    mockConvo([row({ text: "stok air m2?" })]);
    converse.mockResolvedValue({
      reply: "Ada kak!\n• Air M2 · 256GB (Grade A) — 15 juta\n• Pro M1 20 juta",
    });
    await runConversation("628111");
    expect(sendText).toHaveBeenCalledWith(
      "628111",
      "Ada kak.\nAir M2, 256GB, Grade A, 15 juta\nPro M1 20 juta",
    );
  });

  it("marks PERLU_STAF but still sends the agent reply when it escalates", async () => {
    mockConvo([row({ text: "unit saya rusak!" })]);
    converse.mockResolvedValue({ reply: "Baik kak, aku sambungkan ke tim ya 🙏", escalate: "komplain" });
    await runConversation("628111");

    expect(sendText).toHaveBeenCalledWith("628111", "Baik kak, aku sambungkan ke tim ya 🙏");
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF", answeredBy: "agent" }) }),
    );
  });

  it("escalates on a handoff PROMISED in the reply, even without the tool call", async () => {
    mockConvo([row({ id: "m1", text: "bisa nego harganya?" })]);
    // No `escalate` — the model said it, then forgot to call escalate_to_staff.
    converse.mockResolvedValue({ reply: "Soal nego, aku tanyakan ke tim dulu ya kak 🙏" });
    await runConversation("628111");

    // Reply untouched (it already tells the customer), but the row waits for staff.
    expect(sendText).toHaveBeenCalledWith("628111", "Soal nego, aku tanyakan ke tim dulu ya kak 🙏");
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("tells the customer when the agent escalated silently", async () => {
    mockConvo([row({ id: "m1", text: "unit saya rusak!" })]);
    converse.mockResolvedValue({ reply: "Waduh, maaf banget ya kak 🙏", escalate: "komplain" });
    await runConversation("628111");

    const sent = `Waduh, maaf banget ya kak 🙏\n\n${handoffLine()}`;
    expect(sendText).toHaveBeenCalledWith("628111", sent);
    // The stored replyText matches what the customer actually received.
    expect(db.waMessage.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { replyText: sent },
    });
  });

  it("hands off when the agent returns null (no key / error)", async () => {
    mockConvo([row()]);
    converse.mockResolvedValue(null);
    await runConversation("628111");
    expect(sendText).toHaveBeenCalledWith("628111", handoffAck());
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("hands off when the agent returns an empty reply", async () => {
    mockConvo([row()]);
    converse.mockResolvedValue({ reply: "   " });
    await runConversation("628111");
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("acks a handoff on the LAST burst row only, so it counts as one turn", async () => {
    // replyText is the turn marker the summary refresh is scheduled on — fanning
    // it across the burst would replay one handoff as three answered turns.
    mockConvo([row({ id: "m1", msgType: "image", text: null }), row({ id: "m2", msgType: "image", text: null })]);
    await runConversation("628111");

    expect(db.waMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: expect.objectContaining({ status: "PERLU_STAF" }),
    });
    expect(db.waMessage.updateMany.mock.calls[0]![0].data).not.toHaveProperty("replyText");
    expect(db.waMessage.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { replyText: handoffAck() },
    });
  });
});

describe("runConversation — ambiguity", () => {
  it("asks once and stays in auto mode", async () => {
    mockConvo([row({ id: "m1", text: "yg itu brp" })]);
    converse.mockResolvedValue({ reply: "Maksudnya yang mana ya kak", clarify: "unit tidak jelas" });

    await runConversation("628111");

    expect(sendText).toHaveBeenCalledWith("628111", "Maksudnya yang mana ya kak");
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DIJAWAB_AGEN" }) }),
    );
    expect(db.waThreadMemory.upsert.mock.calls[0]![0].update).toMatchObject({ clarifyCount: 1 });
  });

  it("hands over on the second consecutive ask, dropping the third question", async () => {
    mockMemory({ clarifyCount: 1, clarifyAt: new Date() });
    mockConvo([row({ id: "m1", text: "yg itu gimana" })]);
    converse.mockResolvedValue({ reply: "Masih belum jelas kak, yang mana", clarify: "masih ambigu" });

    await runConversation("628111");

    // the model's question is replaced, not appended to
    expect(sendText).toHaveBeenCalledWith("628111", ambiguousHandoff());
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
    // a human owns the thread now, so the streak restarts
    expect(db.waThreadMemory.upsert.mock.calls[0]![0].update).toMatchObject({ clarifyCount: 0 });
  });

  it("resets the streak the moment the agent answers normally", async () => {
    mockMemory({ clarifyCount: 1, clarifyAt: new Date() });
    mockConvo([row({ text: "maksudku macbook air m2" })]);
    converse.mockResolvedValue({ reply: "Air M2 ada 2 unit kak" });

    await runConversation("628111");

    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DIJAWAB_AGEN" }) }),
    );
    expect(db.waThreadMemory.upsert.mock.calls[0]![0].update).toMatchObject({ clarifyCount: 0 });
  });

  it("ignores an expired streak so an old confusion cannot escalate a new question", async () => {
    // Last strike two days ago — freshClarifyCount zeroes it, so this ask is the first.
    mockMemory({ clarifyCount: 1, clarifyAt: new Date(Date.now() - 48 * 60 * 60 * 1000) });
    mockConvo([row({ text: "yg itu brp" })]);
    converse.mockResolvedValue({ reply: "Yang mana ya kak", clarify: "tidak jelas" });

    await runConversation("628111");

    expect(sendText).toHaveBeenCalledWith("628111", "Yang mana ya kak");
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DIJAWAB_AGEN" }) }),
    );
  });

  it("honours a model-issued ambiguous escalation on the first turn too", async () => {
    mockConvo([row({ id: "m1", text: "?????" })]);
    converse.mockResolvedValue({ reply: "Aku teruskan ke tim ya kak", escalate: "ambiguous" });

    await runConversation("628111");

    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });
});

describe("runConversation — clarification asked in prose", () => {
  it("counts a clarifying question even when the model skipped the tool", async () => {
    // The live-traffic failure: without this the streak resets on the very turn
    // that should trip it, and the agent asks forever without reaching a human.
    mockConvo([row({ text: "yg itu brp" })]);
    converse.mockResolvedValue({ reply: "Kak, maksudnya unit apa yang kamu tanya?" });

    await runConversation("628111");

    expect(db.waThreadMemory.upsert.mock.calls[0]![0].update).toMatchObject({ clarifyCount: 1 });
  });

  it("hands over when the second prose ask lands on an existing streak", async () => {
    mockMemory({ clarifyCount: 1, clarifyAt: new Date() });
    mockConvo([row({ text: "bukan yg itu" })]);
    converse.mockResolvedValue({ reply: "Kak maaf, aku kurang paham yang satunya itu apa ya?" });

    await runConversation("628111");

    expect(sendText).toHaveBeenCalledWith("628111", ambiguousHandoff());
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("does not count a normal sales question as a clarification", async () => {
    mockMemory({ clarifyCount: 1, clarifyAt: new Date() });
    mockConvo([row({ text: "mau yang murah" })]);
    converse.mockResolvedValue({ reply: "Ada beberapa pilihan kak, kakak lebih sreg yang mana?" });

    await runConversation("628111");

    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DIJAWAB_AGEN" }) }),
    );
    expect(db.waThreadMemory.upsert.mock.calls[0]![0].update).toMatchObject({ clarifyCount: 0 });
  });
});
