import { describe, expect, it } from "vitest";
import { askingPrice } from "../src/tools.js";

/**
 * Owner, 2026-11-05: the bot quoted a unit's UNIT PRICE (what the variant's
 * price box held) instead of its SELL PRICE. A tracked unit's price is its
 * own `Unit.price` and nothing else — no fallback to `Sku.price`.
 */
describe("askingPrice reads the unit's own sell price only", () => {
  it("quotes the unit's sell price", () => {
    expect(askingPrice({ price: 9_500_000n, sku: { price: 7_000_000n } })).toBe(
      9_500_000n,
    );
  });
  it("never falls back to the variant's price", () => {
    expect(askingPrice({ price: null, sku: { price: 7_000_000n } })).toBeNull();
  });
  it("treats 0 as not priced", () => {
    expect(askingPrice({ price: 0n, sku: { price: 7_000_000n } })).toBeNull();
  });
});
