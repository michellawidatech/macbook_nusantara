import { describe, expect, it } from "vitest";
import {
  priceListLines,
  priceListText,
  priceRangeText,
} from "../src/priceList.js";

const NBSP = " ";
const rp = (s: string) => s.replace(/Rp /g, `Rp${NBSP}`);

describe("priceListLines", () => {
  it("groups units by product and variant, lowest and highest, unpriced left out", () => {
    const lines = priceListLines([
      { product: 'MacBook Air 15" M2', variant: "8/256", price: 14_000_000 },
      { product: 'MacBook Air 13" M1', variant: "8/256", price: 10_120_000n },
      { product: 'MacBook Air 13" M1', variant: "8/256", price: 9_200_000 },
      { product: 'MacBook Air 13" M1', variant: "16/512", price: 12_500_000 },
      { product: 'MacBook Air 13" M1', variant: "8/512", price: 12_500_000 },
      { product: 'MacBook Air 13" M1', variant: "8/128", price: null },
      { product: 'MacBook Air 13" M1', variant: "8/128", price: 0 },
    ]);
    expect(lines).toEqual([
      {
        product: 'MacBook Air 13" M1',
        variant: "8/256",
        min: 9_200_000n,
        max: 10_120_000n,
      },
      {
        product: 'MacBook Air 13" M1',
        variant: "8/512",
        min: 12_500_000n,
        max: 12_500_000n,
      },
      {
        product: 'MacBook Air 13" M1',
        variant: "16/512",
        min: 12_500_000n,
        max: 12_500_000n,
      },
      {
        product: 'MacBook Air 15" M2',
        variant: "8/256",
        min: 14_000_000n,
        max: 14_000_000n,
      },
    ]);
  });
});

describe("priceListLines order", () => {
  it("puts a product's cheaper variant first whichever way it arrives", () => {
    const a = { product: "iPad Air", variant: "64", price: 5_000_000 };
    const b = { product: "iPad Air", variant: "256", price: 7_000_000 };
    expect(priceListLines([a, b]).map((l) => l.variant)).toEqual(["64", "256"]);
    expect(priceListLines([b, a]).map((l) => l.variant)).toEqual(["64", "256"]);
  });
});

describe("priceRangeText", () => {
  it("prints one price when the units agree, a range when they differ", () => {
    expect(priceRangeText(9_200_000n, 9_200_000n)).toBe(rp("Rp 9.200.000"));
    expect(priceRangeText(9_200_000n, 10_120_000n)).toBe(
      rp("Rp 9.200.000 – Rp 10.120.000"),
    );
  });
});

describe("priceListText", () => {
  const lines = priceListLines([
    { product: 'MacBook Air 13" M1', variant: "8/256", price: 9_200_000 },
    { product: 'MacBook Air 13" M1', variant: "8/256", price: 10_000_000 },
    { product: "Magic Mouse", variant: "", price: 900_000 },
  ]);
  it("writes a block per product, with an optional title and bold headings", () => {
    expect(priceListText(lines, { title: "Pricelist", bold: true })).toBe(
      rp(
        'Pricelist\n\n*MacBook Air 13" M1*\n• 8/256: Rp 9.200.000 – Rp 10.000.000\n\n*Magic Mouse*\n• Rp 900.000',
      ),
    );
    expect(priceListText(lines)).toBe(
      rp(
        'MacBook Air 13" M1\n• 8/256: Rp 9.200.000 – Rp 10.000.000\n\nMagic Mouse\n• Rp 900.000',
      ),
    );
    expect(priceListText([])).toBe("");
  });
});
