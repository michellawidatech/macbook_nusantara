/**
 * The price list story (owner ask 2026-11-17) — which units count, one row
 * per variant, what staff set on a row, the default words, and how the rows
 * are cut into pages. `lib/priceStory.ts` is the rule; the layout is pinned
 * in `priceStoryLayout.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  beforeIsLow,
  defaultStoryTexts,
  nowText,
  paginate,
  promoPeriod,
  specOf,
  storyFileName,
  storyLines,
  storyStock,
  type StoryGroup,
} from "../src/lib/priceStory.js";
import { EVERYTHING } from "../src/lib/stockExport.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const copy = (): MockDb => structuredClone(getDb());

describe("storyStock", () => {
  it("lists every variant on sale with its own-price range, grouped by product", () => {
    const db = copy();
    const sku = db.skus.find((s) => db.units.some((u) => u.skuId === s.id))!;
    const units = db.units.filter((u) => u.skuId === sku.id);
    db.units = db.units.filter((u) => u.skuId !== sku.id);
    const base = units[0]!;
    db.units.push(
      { ...base, serial: "STORY01", status: "TERSEDIA", price: 9_000_000 },
      { ...base, serial: "STORY02", status: "DIRESERVASI", price: 9_500_000 },
      { ...base, serial: "STORY03", status: "TERSEDIA", price: 8_750_000 },
      // Not on sale: in QC, sold.
      { ...base, serial: "STORY04", status: "QC", price: 1 },
      { ...base, serial: "STORY05", status: "TERJUAL", price: 1 },
      // On sale, no sell price of its own: counted, not shown.
      { ...base, serial: "STORY06", status: "TERSEDIA", price: undefined },
    );
    const { products, unpriced } = storyStock(db, EVERYTHING);
    const product = products.find((p) => p.name === sku.name.trim())!;
    const row = product.rows.find((r) => r.skuId === sku.id)!;
    expect(row).toMatchObject({ lo: 8_750_000, hi: 9_500_000, qty: 3 });
    expect(row.spec).toBe(specOf(sku.variantLabel));
    expect(unpriced).toBeGreaterThanOrEqual(1);
    // Cheapest variant first inside a product; products by name.
    for (const p of products) {
      const los = p.rows.map((r) => r.lo);
      expect(los).toEqual([...los].sort((a, b) => a - b));
    }
    const names = products.map((p) => p.name);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
      ),
    );
  });

  it("follows the dialog's filters", () => {
    const db = copy();
    const wh = db.warehouses[0]!.id;
    const { products } = storyStock(db, { ...EVERYTHING, warehouseIds: [wh] });
    const skus = new Set(products.flatMap((p) => p.rows.map((r) => r.skuId)));
    for (const id of skus) {
      expect(
        db.units.some(
          (u) => u.skuId === id && u.locationId === wh && u.price !== undefined,
        ),
      ).toBe(true);
    }
  });

  it("tags NEW only when every unit counted is sealed", () => {
    const db = copy();
    const base = db.units.find((u) => u.status === "TERSEDIA")!;
    db.units = db.units.filter((u) => u.skuId !== base.skuId);
    db.units.push(
      { ...base, serial: "N1", grade: "NEW", price: 10 },
      { ...base, serial: "N2", grade: "NEW", price: 12 },
    );
    const row = () =>
      storyStock(db, EVERYTHING)
        .products.flatMap((p) => p.rows)
        .find((r) => r.skuId === base.skuId)!;
    expect(row().allNew).toBe(true);
    db.units.push({ ...base, serial: "N3", grade: "A", price: 11 });
    expect(row().allNew).toBe(false);
  });
});

describe("storyLines", () => {
  const products = [
    {
      name: "Air",
      rows: [
        { skuId: "a1", spec: "8GB", lo: 10, hi: 12, qty: 2, allNew: false },
        { skuId: "a2", spec: "16GB", lo: 20, hi: 20, qty: 1, allNew: true },
      ],
    },
    {
      name: "Pro",
      rows: [{ skuId: "p1", spec: "", lo: 30, hi: 30, qty: 1, allNew: false }],
    },
  ];

  it("lays the before price, NEW and leaving-off on top", () => {
    const g = storyLines(products, {
      a1: { before: 15, isNew: true },
      a2: { isNew: false },
      p1: { hidden: true },
    });
    expect(g).toEqual([
      {
        name: "Air",
        rows: [
          { ...products[0]!.rows[0]!, before: 15, isNew: true },
          { ...products[0]!.rows[1]!, isNew: false },
        ],
      },
    ]);
  });

  it("keeps NEW at its default when nobody switched it", () => {
    const g = storyLines(products, {});
    expect(g[0]!.rows.map((r) => r.isNew)).toEqual([false, true]);
    expect(g[0]!.rows[0]!.before).toBeUndefined();
  });

  it("warns about a before price that is not above the price now", () => {
    expect(beforeIsLow({ lo: 10 }, 10)).toBe(true);
    expect(beforeIsLow({ lo: 10 }, 9)).toBe(true);
    expect(beforeIsLow({ lo: 10 }, 11)).toBe(false);
    expect(beforeIsLow({ lo: 10 }, undefined)).toBe(false);
  });
});

describe("paginate", () => {
  const g = (name: string, n: number): StoryGroup => ({
    name,
    rows: Array.from({ length: n }, (_, i) => ({
      skuId: `${name}${i}`,
      spec: "",
      lo: 1,
      hi: 1,
      qty: 1,
      allNew: false,
      isNew: false,
    })),
  });
  // A card is 10 + 10 per row; a page holds 100; cards 5 apart.
  const height = (rows: number) => 10 + rows * 10;

  it("keeps a product whole and starts a new page when it does not fit", () => {
    // 40 + 5 + 50 = 95 fits; another 5 + 30 would not.
    const pages = paginate([g("a", 3), g("b", 4), g("c", 2)], 100, 5, height);
    expect(pages.map((p) => p.map((x) => `${x.name}${x.rows.length}`))).toEqual(
      [["a3", "b4"], ["c2"]],
    );
  });

  it("cuts a product taller than a page into page-sized pieces", () => {
    const pages = paginate([g("big", 20)], 100, 5, height);
    expect(pages.map((p) => p.map((x) => x.rows.length))).toEqual([
      [9],
      [9],
      [2],
    ]);
    expect(pages.every((p) => p[0]!.name === "big")).toBe(true);
  });

  it("makes no page from nothing", () => {
    expect(paginate([], 100, 5, height)).toEqual([]);
  });
});

describe("the words", () => {
  it("defaults to this month, a two-week promo and the shop's contacts", () => {
    const t = defaultStoryTexts(new Date(2026, 10, 17), {
      whatsapp: "0858-8842-9991",
    });
    expect(t).toMatchObject({
      promo: "PROMO · 17–30 NOV 2026",
      titleTop: "Best",
      titleBottom: "Price.",
      subtitle: "November 2026 — lebih hemat dengan tukar tambah",
      whatsapp: "0858-8842-9991",
      location: "Serpong",
    });
  });

  it("names both months, and both years, when the promo crosses them", () => {
    expect(promoPeriod(new Date(2026, 10, 25))).toBe(
      "PROMO · 25 NOV – 8 DES 2026",
    );
    expect(promoPeriod(new Date(2026, 11, 25))).toBe(
      "PROMO · 25 DES 2026 – 7 JAN 2027",
    );
  });

  it("prints a single price or a range, and names files by date and page", () => {
    expect(nowText({ lo: 9_499_000, hi: 9_499_000 })).toBe("Rp 9.499.000");
    expect(nowText({ lo: 9_499_000, hi: 10_299_000 })).toBe(
      "Rp 9.499.000 – 10.299.000",
    );
    expect(specOf("i5 / 8GB / 256GB")).toBe("i5 | 8GB | 256GB");
    expect(specOf(undefined)).toBe("");
    expect(storyFileName(new Date(2026, 10, 7), 2)).toBe(
      "story-2026-11-07-2.png",
    );
  });
});
