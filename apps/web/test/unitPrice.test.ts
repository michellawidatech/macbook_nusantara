/**
 * The per-serial price, and the marketplace rule on top of it.
 *
 * The owner's revision of 2026-09-08, which reverses 2026-08-27. See
 * `lib/unitPrice.ts` for why the pendulum lands here.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKETPLACE_MARKUP_PCT,
  derivedMarketPrice,
  isMarketPriceOverridden,
  isPriceInRange,
  marketPriceOf,
  markupOf,
  priceOf,
  priceRange,
} from "../src/lib/unitPrice.js";

const unit = (over: Partial<{ price: number; marketPrice: number }> = {}) => ({
  serial: "SC02AA111AA",
  skuId: "sku-1",
  ...over,
});

describe("derivedMarketPrice", () => {
  it("adds the shop's markup and rounds up to the nearest thousand", () => {
    expect(derivedMarketPrice(10_000_000)).toBe(11_000_000);
    // 8.415.000 × 1.1 = 9.256.500, which is not a price anybody prints.
    expect(derivedMarketPrice(8_415_000)).toBe(9_257_000);
  });

  it("rounds UP, never down", () => {
    // The direction of a rounding error must never be the direction that
    // shaves the fee the markup exists to cover.
    for (const p of [1_000_001, 7_777_777, 12_345_678]) {
      expect(derivedMarketPrice(p, 10)).toBeGreaterThanOrEqual(p * 1.1);
    }
  });

  it("leaves a free machine free", () => {
    // Rp1.000 on a giveaway is a pricing bug that would reach a customer.
    expect(derivedMarketPrice(0)).toBe(0);
    expect(derivedMarketPrice(-5)).toBe(0);
  });

  it("takes a markup other than the default", () => {
    expect(derivedMarketPrice(10_000_000, 0)).toBe(10_000_000);
    expect(derivedMarketPrice(10_000_000, 25)).toBe(12_500_000);
    // A negative markup would list below the counter price; floored at zero.
    expect(derivedMarketPrice(10_000_000, -30)).toBe(10_000_000);
  });
});

describe("priceOf", () => {
  it("quotes the machine's own price", () => {
    expect(priceOf(unit({ price: 9_500_000 }), 11_000_000)).toBe(9_500_000);
  });

  it("falls back to the variant for a machine nobody has priced", () => {
    // A unit still in QC, or one taken in before this revision existed.
    expect(priceOf(unit(), 11_000_000)).toBe(11_000_000);
  });

  it("keeps a deliberate zero", () => {
    // Zero is a giveaway somebody chose, not a missing price.
    expect(priceOf(unit({ price: 0 }), 11_000_000)).toBe(0);
  });
});

describe("marketPriceOf", () => {
  it("derives from the machine's own store price", () => {
    expect(marketPriceOf(unit({ price: 10_000_000 }), 11_000_000)).toBe(
      11_000_000,
    );
  });

  it("prefers an override, and says so", () => {
    const u = unit({ price: 10_000_000, marketPrice: 12_500_000 });
    expect(marketPriceOf(u, 11_000_000)).toBe(12_500_000);
    expect(isMarketPriceOverridden(u)).toBe(true);
    expect(isMarketPriceOverridden(unit({ price: 10_000_000 }))).toBe(false);
  });

  it("moves with a repricing when it is derived, and not when it is not", () => {
    // The whole point of storing the override as the number rather than as a
    // flag beside one.
    const derived = unit({ price: 10_000_000 });
    const fixed = unit({ price: 10_000_000, marketPrice: 12_000_000 });
    const repriced = { ...derived, price: 9_000_000 };
    const repricedFixed = { ...fixed, price: 9_000_000 };
    expect(marketPriceOf(repriced, 0)).toBe(9_900_000);
    expect(marketPriceOf(repricedFixed, 0)).toBe(12_000_000);
  });
});

describe("priceRange", () => {
  it("collapses one price into a single", () => {
    const r = priceRange([9_000_000, 9_000_000]);
    expect(r).toMatchObject({ min: 9_000_000, max: 9_000_000, single: true });
    expect(r.count).toBe(2);
  });

  it("spans a real range", () => {
    const r = priceRange([9_000_000, 7_500_000, 11_000_000]);
    expect(r).toMatchObject({
      min: 7_500_000,
      max: 11_000_000,
      single: false,
      count: 3,
    });
  });

  it("answers nothing for an empty shelf", () => {
    expect(priceRange([])).toMatchObject({ min: 0, max: 0, count: 0 });
  });
});

describe("markupOf", () => {
  it("says how far above the counter a listing sits", () => {
    expect(markupOf(10_000_000, 11_000_000)).toBeCloseTo(10);
    expect(markupOf(10_000_000, 9_000_000)).toBeCloseTo(-10);
  });

  it("refuses to divide by a free machine", () => {
    expect(markupOf(0, 500_000)).toBeNull();
  });
});

describe("isPriceInRange", () => {
  it("lets a giveaway through and a slipped keyboard repeat not", () => {
    expect(isPriceInRange(0)).toBe(true);
    expect(isPriceInRange(undefined)).toBe(true);
    expect(isPriceInRange(-1)).toBe(false);
    expect(isPriceInRange(1e15)).toBe(false);
  });
});

describe("the shop's default markup", () => {
  it("is the owner's ten per cent", () => {
    expect(DEFAULT_MARKETPLACE_MARKUP_PCT).toBe(10);
  });
});
