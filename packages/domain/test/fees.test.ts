import { describe, expect, it } from "vitest";
import { allocateFees, landedCost } from "../src/fees.js";

const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("08 §3 — PO fee allocation", () => {
  it("splits exactly when the split is exact", () => {
    expect(allocateFees([100n, 200n, 700n], 10n)).toEqual([1n, 2n, 7n]);
  });

  it("loses nothing when the naive split leaves a remainder", () => {
    // 10 rupiah across three equal lines. Naive rounding gives 3+3+3 = 9 and
    // quietly drops a rupiah; largest-remainder gives it to the first line.
    const out = allocateFees([1n, 1n, 1n], 10n);
    expect(out).toEqual([4n, 3n, 3n]);
    expect(sum(out)).toBe(10n);
  });

  it("gives the leftover to the largest remainder, not the first line", () => {
    // exact shares are 33.3, 33.3, 33.4 — the third line is owed the rupiah.
    const out = allocateFees([333n, 333n, 334n], 100n);
    expect(out).toEqual([33n, 33n, 34n]);
    expect(sum(out)).toBe(100n);
  });

  it("stays exact across an awkward, realistic PO", () => {
    const lines = [4_500_000n, 3_250_000n, 1_099_000n, 875_500n];
    const fee = 1_234_567n;
    const out = allocateFees(lines, fee);
    expect(sum(out)).toBe(fee);
    // Proportional: the lines are already in descending value order, so the
    // allocation must come back in descending order too.
    expect(out).toEqual([...out].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)));
    expect(new Set(out).size).toBe(4);
  });

  it("is exact for every fee from 0 to 200 over uneven lines", () => {
    const lines = [7n, 11n, 13n, 1n];
    for (let fee = 0n; fee <= 200n; fee += 1n) {
      const out = allocateFees(lines, fee);
      expect(sum(out)).toBe(fee);
      expect(out.every((x) => x >= 0n)).toBe(true);
    }
  });

  it("splits as evenly as possible when every line is worth nothing", () => {
    // A fee on a zero-value PO must still land somewhere.
    expect(allocateFees([0n, 0n, 0n], 7n)).toEqual([3n, 2n, 2n]);
    expect(sum(allocateFees([0n, 0n], 5n))).toBe(5n);
  });

  it("handles a single line and a zero fee", () => {
    expect(allocateFees([500n], 9n)).toEqual([9n]);
    expect(allocateFees([1n, 2n], 0n)).toEqual([0n, 0n]);
  });

  it("is deterministic", () => {
    const a = allocateFees([5n, 5n, 5n, 5n], 6n);
    const b = allocateFees([5n, 5n, 5n, 5n], 6n);
    expect(a).toEqual(b);
    expect(sum(a)).toBe(6n);
  });

  it("refuses input it cannot allocate", () => {
    expect(() => allocateFees([], 10n)).toThrow(RangeError);
    expect(() => allocateFees([1n], -1n)).toThrow(RangeError);
    expect(() => allocateFees([1n, -1n], 10n)).toThrow(RangeError);
  });
});

describe("02 §9 — landed cost keeps its parts", () => {
  it("shows the buy price and each allocated fee", () => {
    const lc = landedCost(9_000_000n, [250_000n, 75_000n]);
    expect(lc.buy).toBe(9_000_000n);
    expect(lc.fees).toEqual([250_000n, 75_000n]);
    expect(lc.total).toBe(9_325_000n);
  });

  it("is just the buy price when no fee was allocated", () => {
    expect(landedCost(9_000_000n, []).total).toBe(9_000_000n);
  });
});
