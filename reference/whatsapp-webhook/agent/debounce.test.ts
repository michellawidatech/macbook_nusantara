import { describe, it, expect } from "vitest";
import { computeWaitMs, MIN_WAIT_MS, BASE_WAIT_MS, MAX_WAIT_MS } from "./debounce.js";

const wait = (text: string) => computeWaitMs([{ text }]);

describe("computeWaitMs", () => {
  it("answers a direct question soonest", () => {
    expect(wait("stok air m2?")).toBe(MIN_WAIT_MS);
    expect(wait("harganya berapa ya?")).toBe(MIN_WAIT_MS);
  });

  it("waits longest when the customer says they'll get back later", () => {
    expect(wait("oh nanti saya kabarin ya")).toBe(MAX_WAIT_MS);
    expect(wait("mau pikir dulu deh")).toBe(MAX_WAIT_MS);
    expect(wait("cek dulu ya besok")).toBe(MAX_WAIT_MS);
  });

  it("waits longer for filler / thinking (they're still composing)", () => {
    expect(wait("hmmm")).toBeGreaterThan(BASE_WAIT_MS);
    expect(wait("bentar")).toBeGreaterThan(BASE_WAIT_MS);
    expect(wait("oke")).toBeGreaterThan(BASE_WAIT_MS);
    expect(wait("tunggu...")).toBeGreaterThan(BASE_WAIT_MS);
  });

  it("uses the base window for an ordinary statement", () => {
    expect(wait("mau beli macbook air m2")).toBe(BASE_WAIT_MS);
    expect(wait("")).toBe(BASE_WAIT_MS);
  });

  it("keys off the latest non-empty message in the burst", () => {
    expect(computeWaitMs([{ text: "hmm" }, { text: "stok air m2?" }])).toBe(MIN_WAIT_MS);
    expect(computeWaitMs([{ text: "stok air m2?" }, { text: null }, { text: "  " }])).toBe(
      MIN_WAIT_MS,
    );
  });

  it("stays within the clamp bounds", () => {
    for (const t of ["?", "nanti", "hmm", "halo kak", ""]) {
      const w = wait(t);
      expect(w).toBeGreaterThanOrEqual(MIN_WAIT_MS);
      expect(w).toBeLessThanOrEqual(MAX_WAIT_MS);
    }
  });
});
