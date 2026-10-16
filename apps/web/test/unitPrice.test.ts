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
  LISTABLE_STATUSES,
  marketPriceOf,
  markupOf,
  priceOf,
  priceRange,
  startingPrice,
  variantMarketPrice,
  variantMarketPrices,
  type ListedUnit,
} from "../src/lib/unitPrice.js";
import { buildSeed } from "../src/mock/seed.js";

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

  it("does not invent a thousand out of floating-point error", () => {
    // 30.000.000 × 1.1 is 33000000.000000004 in a double; a ceiling taken on
    // that listed the unit at Rp33.001.000 (fixed 2026-09-19).
    expect(derivedMarketPrice(30_000_000)).toBe(33_000_000);
    expect(derivedMarketPrice(6_000_000)).toBe(6_600_000);
    // Every whole million: the exact answer is a whole thousand, so the
    // rounding must leave it alone. (p / 10) * 11 is integer arithmetic.
    for (let p = 1_000_000; p <= 60_000_000; p += 1_000_000) {
      expect(derivedMarketPrice(p, 10), String(p)).toBe((p / 10) * 11);
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

/**
 * One marketplace price per VARIANT (owner ask 2026-09-19): *"Marketplace
 * price is taken from the highest price for all unit, so it will not be
 * displayed per unit."*
 */
describe("variantMarketPrice", () => {
  let n = 0;
  const listed = (over: Partial<ListedUnit> = {}): ListedUnit => ({
    serial: `SC02VAR${String(++n).padStart(4, "0")}`,
    skuId: "sku-1",
    status: "TERSEDIA",
    ...over,
  });

  it("is the dearest sellable unit's figure, not the cheapest or an average", () => {
    const units = [
      listed({ price: 9_000_000 }),
      listed({ price: 10_000_000 }),
      listed({ price: 8_000_000 }),
    ];
    // 10.000.000 + 10%, and nothing lower.
    expect(variantMarketPrice(units, "sku-1", 11_000_000)).toBe(11_000_000);
  });

  it("counts a reserved unit, and nothing in QC, at a repairer or gone", () => {
    // A hold is a promise to one customer; the variant is still listed for
    // everybody else. A unit in QC is unpriced and one at the bench is not
    // for sale, so neither may set the listing.
    expect(LISTABLE_STATUSES).toEqual(["TERSEDIA", "DIRESERVASI"]);
    const units = [
      listed({ price: 9_000_000 }),
      listed({ price: 9_500_000, status: "DIRESERVASI" }),
      listed({ price: 20_000_000, status: "QC" }),
      listed({ price: 21_000_000, status: "SERVIS" }),
      listed({ price: 22_000_000, status: "TERJUAL" }),
      listed({ price: 23_000_000, status: "HILANG" }),
    ];
    expect(variantMarketPrice(units, "sku-1", 0)).toBe(10_450_000);
  });

  it("answers nothing when no unit of the variant can be sold", () => {
    // A number here would be a listing price no unit on the shelf asks.
    expect(variantMarketPrice([], "sku-1", 11_000_000)).toBeUndefined();
    expect(
      variantMarketPrice(
        [listed({ price: 9_000_000, status: "QC" })],
        "sku-1",
        11_000_000,
      ),
    ).toBeUndefined();
  });

  it("ignores every other variant's units", () => {
    const units = [
      listed({ price: 9_000_000 }),
      listed({ skuId: "sku-2", price: 30_000_000 }),
    ];
    expect(variantMarketPrice(units, "sku-1", 0)).toBe(9_900_000);
    expect(variantMarketPrice(units, "sku-2", 0)).toBe(33_000_000);
  });

  it("quotes a unit nobody has priced at the variant's asking price", () => {
    const units = [listed(), listed({ price: 5_000_000 })];
    expect(variantMarketPrice(units, "sku-1", 6_000_000)).toBe(6_600_000);
  });

  it("lets a legacy per-unit override feed the maximum", () => {
    // Typed between 2026-09-08 and 2026-09-19. Not thrown away: it is still
    // what that unit was listed at, until its store price is next saved.
    const units = [
      listed({ price: 9_000_000 }),
      listed({ price: 9_000_000, marketPrice: 12_500_000 }),
    ];
    expect(variantMarketPrice(units, "sku-1", 0)).toBe(12_500_000);
  });

  it("takes the shop's markup rather than the default when given one", () => {
    const units = [listed({ price: 10_000_000 })];
    expect(variantMarketPrice(units, "sku-1", 0, 25)).toBe(12_500_000);
    expect(variantMarketPrice(units, "sku-1", 0, 0)).toBe(10_000_000);
  });

  it("gives the same answers in one pass as one variant at a time", () => {
    // The batch form is what the Inventory table calls; it must never quote
    // a listing the single form would not.
    const db = buildSeed();
    const skuPrice = (id: string) =>
      db.skus.find((s) => s.id === id)?.price ?? 0;
    const all = variantMarketPrices(db.units, skuPrice, 10);
    for (const sku of db.skus) {
      expect(all.get(sku.id), sku.id).toBe(
        variantMarketPrice(db.units, sku.id, sku.price, 10),
      );
    }
    // The demo shelf has to list something, or this proves nothing.
    expect(all.size).toBeGreaterThan(0);
  });
});

describe("startingPrice", () => {
  it("hands on a variant's asking price, and not a Rp 0 nobody chose", () => {
    expect(startingPrice(9_500_000)).toBe(9_500_000);
    expect(startingPrice(0)).toBeUndefined();
    expect(startingPrice(null)).toBeUndefined();
    expect(startingPrice(undefined)).toBeUndefined();
  });
});
