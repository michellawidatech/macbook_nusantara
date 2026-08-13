import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";

const { db } = mockDb();

const { loadMemory, saveClarify, saveSummary, freshClarifyCount, CLARIFY_TTL_MS } =
  await import("./memory.js");

const NOW = new Date("2026-08-11T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("freshClarifyCount", () => {
  it("keeps a streak inside the TTL", () => {
    const at = new Date(NOW.getTime() - CLARIFY_TTL_MS + 1000);
    expect(freshClarifyCount(1, at, NOW)).toBe(1);
  });

  it("expires a streak older than the TTL", () => {
    const at = new Date(NOW.getTime() - CLARIFY_TTL_MS - 1000);
    expect(freshClarifyCount(1, at, NOW)).toBe(0);
  });

  it("reads zero when there is no timestamp or no streak", () => {
    expect(freshClarifyCount(2, null, NOW)).toBe(0);
    expect(freshClarifyCount(0, NOW, NOW)).toBe(0);
  });
});

describe("loadMemory", () => {
  it("returns empty memory when the thread has no row", async () => {
    db.waThreadMemory.findUnique.mockResolvedValue(null);
    await expect(loadMemory("628111")).resolves.toEqual({
      summary: null,
      directive: null,
      clarifyCount: 0,
      coveredThroughAt: null,
    });
    expect(db.waThreadMemory.findUnique).toHaveBeenCalledWith({ where: { from: "628111" } });
  });

  it("maps a stored row and expires a stale clarify streak", async () => {
    const covered = new Date("2026-08-10T09:00:00.000Z");
    db.waThreadMemory.findUnique.mockResolvedValue({
      summary: "Mau MacBook Air M2, budget 15jt",
      directive: "kasih diskon 200rb",
      clarifyCount: 1,
      clarifyAt: new Date(NOW.getTime() - CLARIFY_TTL_MS - 1),
      coveredThroughAt: covered,
    });
    await expect(loadMemory("628111", NOW)).resolves.toEqual({
      summary: "Mau MacBook Air M2, budget 15jt",
      directive: "kasih diskon 200rb",
      clarifyCount: 0, // expired
      coveredThroughAt: covered,
    });
  });

  it("degrades to empty memory when the read throws, so the agent still replies", async () => {
    // The failure mode that matters: webhook deployed before the migration ran.
    db.waThreadMemory.findUnique.mockRejectedValue(new Error("relation does not exist"));
    await expect(loadMemory("628111")).resolves.toEqual({
      summary: null,
      directive: null,
      clarifyCount: 0,
      coveredThroughAt: null,
    });
  });
});

describe("saveClarify", () => {
  it("upserts only the clarify columns", async () => {
    db.waThreadMemory.upsert.mockResolvedValue({});
    await saveClarify("628111", 2);

    const arg = db.waThreadMemory.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ from: "628111" });
    expect(arg.update.clarifyCount).toBe(2);
    expect(arg.update.clarifyAt).toBeInstanceOf(Date);
    expect(arg.update).not.toHaveProperty("summary");
    expect(arg.update).not.toHaveProperty("directive");
    expect(arg.create).not.toHaveProperty("directive");
  });

  it("swallows a write failure rather than failing the reply", async () => {
    db.waThreadMemory.upsert.mockRejectedValue(new Error("down"));
    await expect(saveClarify("628111", 1)).resolves.toBeUndefined();
  });
});

describe("saveSummary", () => {
  const update = {
    summary: "Cari iPhone 15, budget 12jt",
    turns: 3,
    coveredThroughAt: new Date("2026-08-11T09:59:00.000Z"),
    coveredThroughId: "m9",
  };

  it("writes the summary columns and the cursor", async () => {
    db.waThreadMemory.upsert.mockResolvedValue({});
    await saveSummary("628111", update);

    const arg = db.waThreadMemory.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ from: "628111" });
    expect(arg.update).toMatchObject({
      summary: "Cari iPhone 15, budget 12jt",
      summaryTurns: 3,
      coveredThroughAt: update.coveredThroughAt,
      coveredThroughId: "m9",
    });
    expect(arg.update.summaryAt).toBeInstanceOf(Date);
    expect(arg.create.from).toBe("628111");
  });

  it("never names a directive column, so a refresh cannot clobber a staff note", async () => {
    db.waThreadMemory.upsert.mockResolvedValue({});
    await saveSummary("628111", update);

    const arg = db.waThreadMemory.upsert.mock.calls[0]![0];
    for (const payload of [arg.update, arg.create]) {
      expect(payload).not.toHaveProperty("directive");
      expect(payload).not.toHaveProperty("directiveAt");
      expect(payload).not.toHaveProperty("directiveBy");
    }
  });

  it("retries as an update when it loses the create race", async () => {
    const conflict = Object.assign(new Error("unique"), { code: "P2002" });
    db.waThreadMemory.upsert.mockRejectedValue(conflict);
    db.waThreadMemory.update.mockResolvedValue({});

    await saveSummary("628111", update);

    expect(db.waThreadMemory.update).toHaveBeenCalledWith({
      where: { from: "628111" },
      data: expect.objectContaining({ summary: "Cari iPhone 15, budget 12jt" }),
    });
  });

  it("swallows a non-conflict write failure", async () => {
    db.waThreadMemory.upsert.mockRejectedValue(new Error("down"));
    await expect(saveSummary("628111", update)).resolves.toBeUndefined();
    expect(db.waThreadMemory.update).not.toHaveBeenCalled();
  });
});
