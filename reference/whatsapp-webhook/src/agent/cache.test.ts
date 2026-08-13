import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";
import { cacheKeyFor } from "@nusantara/domain/agent";

const { db } = mockDb();
const { cacheGet, cacheSet } = await import("./cache.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cacheGet", () => {
  it("returns null on a miss", async () => {
    db.agentCache.findUnique.mockResolvedValue(null);
    expect(await cacheGet("categorize", "stok m2")).toBeNull();
  });

  it("hashes (kind, question) into the lookup key", async () => {
    db.agentCache.findUnique.mockResolvedValue(null);
    await cacheGet("categorize", "stok m2");
    expect(db.agentCache.findUnique).toHaveBeenCalledWith({
      where: { key: cacheKeyFor("categorize", "stok m2") },
    });
  });

  it("returns the value and bumps hits on a live entry", async () => {
    db.agentCache.findUnique.mockResolvedValue({
      key: "k",
      value: { category: "agent_faq" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const v = await cacheGet("categorize", "jam buka");
    expect(v).toEqual({ category: "agent_faq" });
    expect(db.agentCache.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hits: { increment: 1 } } }),
    );
  });

  it("treats an expired entry as a miss and prunes it", async () => {
    db.agentCache.findUnique.mockResolvedValue({
      key: "k",
      value: { category: "agent_faq" },
      expiresAt: new Date(Date.now() - 1),
    });
    db.agentCache.delete.mockResolvedValue({});
    expect(await cacheGet("categorize", "jam buka")).toBeNull();
    expect(db.agentCache.delete).toHaveBeenCalledWith({
      where: { key: cacheKeyFor("categorize", "jam buka") },
    });
    expect(db.agentCache.update).not.toHaveBeenCalled();
  });
});

describe("cacheSet", () => {
  it("upserts with a future expiry derived from the TTL", async () => {
    db.agentCache.upsert.mockResolvedValue({});
    const before = Date.now();
    await cacheSet("categorize", "jam buka", { category: "agent_faq" }, 3600);

    const arg = db.agentCache.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ key: cacheKeyFor("categorize", "jam buka") });
    expect(arg.create).toMatchObject({ kind: "categorize", value: { category: "agent_faq" } });
    const expMs = arg.update.expiresAt.getTime();
    expect(expMs).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expMs).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });
});
