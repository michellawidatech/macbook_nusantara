import { describe, expect, it } from "vitest";
import { needsRestock, type RestockSources } from "../src/lib/restock.js";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const skus = [
  { id: "air", name: 'MacBook Air 13" M2', variantLabel: "8/256" },
  { id: "pro", name: 'MacBook Pro 14" M3', variantLabel: "16/512" },
  { id: "mag", name: "MagSafe 3", variantLabel: "70W" },
  { id: "old", name: 'MacBook Air 13" 2017', variantLabel: "8/128" },
  {
    id: "merged",
    name: "AIR 13 M2",
    variantLabel: "8/256",
    mergedIntoId: "air",
  },
];

function shop(over: Partial<RestockSources> = {}): RestockSources {
  return {
    skus,
    units: [
      { serial: "A1", skuId: "air", status: "TERJUAL" },
      { serial: "A2", skuId: "air", status: "TERJUAL" },
      { serial: "A3", skuId: "air", status: "TERSEDIA" },
      { serial: "A4", skuId: "air", status: "QC" },
      { serial: "A5", skuId: "air", status: "DIRESERVASI" },
      { serial: "P1", skuId: "pro", status: "TERJUAL" },
      { serial: "P2", skuId: "pro", status: "TERSEDIA" },
      { serial: "P3", skuId: "pro", status: "TERSEDIA" },
      { serial: "O1", skuId: "old", status: "TERJUAL" },
      { serial: "M1", skuId: "merged", status: "TERJUAL" },
    ],
    stockMoves: [
      { skuId: "mag", qty: 10 },
      { skuId: "mag", qty: -9 },
    ],
    orders: [
      { ts: daysAgo(2), serials: ["A1", "P1"] },
      { ts: daysAgo(20), serials: ["A2"], lines: [{ skuId: "mag", qty: 3 }] },
      // Outside the window: neither counts.
      { ts: daysAgo(45), serials: ["O1"] },
      { ts: daysAgo(3), serials: ["M1"] },
    ],
    ...over,
  };
}

describe("needs restock", () => {
  it("lists variants whose shelf is below what they sold in 30 days, worst first", () => {
    const rows = needsRestock(shop(), NOW);
    expect(rows.map((r) => [r.skuId, r.onHand, r.sold, r.short])).toEqual([
      // 3 MagSafes sold, 1 piece left.
      ["mag", 1, 3, 2],
      // 2 Airs sold; only the one on the shelf counts — QC and a DP hold do not.
      ["air", 1, 2, 1],
    ]);
  });

  it("leaves out a variant with enough on the shelf, one sold only long ago, and a merged one", () => {
    const ids = needsRestock(shop(), NOW).map((r) => r.skuId);
    expect(ids).not.toContain("pro");
    expect(ids).not.toContain("old");
    expect(ids).not.toContain("merged");
  });

  it("takes returned pieces off what was sold", () => {
    const rows = needsRestock(
      shop({
        orders: [
          {
            ts: daysAgo(1),
            serials: [],
            lines: [{ skuId: "mag", qty: 3, returnedQty: 2 }],
          },
        ],
      }),
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("asks nothing of a variant that never sold", () => {
    expect(needsRestock(shop({ orders: [] }), NOW)).toEqual([]);
  });

  it("names the variant", () => {
    const air = needsRestock(shop(), NOW).find((r) => r.skuId === "air")!;
    expect(air).toMatchObject({
      name: 'MacBook Air 13" M2',
      variantLabel: "8/256",
    });
  });
});
