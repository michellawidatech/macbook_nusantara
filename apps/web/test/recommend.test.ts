/**
 * The recommender's ranking.
 *
 * These check the SIGNALS, not the sentences: the point of the 2026-09-01
 * rewrite is that the order comes out of a weighted score rather than a fixed
 * chain of tie-breaks, and the only way to hold that honest is to build two
 * candidates that differ on exactly one signal and assert which wins.
 *
 * The store is hand-built rather than seeded. `buildSeed` has four receipts and
 * a shelf that changes whenever somebody adds a fixture to it, and a test that
 * asserts on a ranking needs to be the only thing deciding what is in the
 * comparison.
 */
import { describe, expect, it } from "vitest";
import { recommendFor } from "../src/lib/recommend.js";
import type { MockDb, Order, Po, Unit, UnitEvent } from "../src/mock/seed.js";

/** A fixed clock, so the age signal is a fact about the fixture. */
const NOW = new Date("2026-09-01T00:00:00.000Z").getTime();
const daysAgo = (n: number) =>
  new Date(NOW - n * 86_400_000).toISOString();

const unit = (over: Partial<Unit> & Pick<Unit, "serial" | "skuId">): Unit => ({
  status: "TERSEDIA",
  locationId: "wh-1",
  buy: 5_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

const intake = (serial: string, at: string): UnitEvent => ({
  id: `ev-${serial}`,
  serial,
  seq: 1,
  type: "DITERIMA",
  at,
  fromStatus: "",
  toStatus: "QC",
  locationId: "wh-1",
  staff: "seed",
});

const order = (id: string, serials: string[]): Order => ({
  id,
  code: `SI-${id}`,
  ts: daysAgo(30),
  customerId: null,
  serials,
  prices: {},
  discount: 0,
  source: "OFFLINE",
  payMethod: "Cash",
  settled: true,
  total: 0,
});

/**
 * A catalogue with two laptop variants and two accessory kinds.
 *
 * The laptops carry two axes and the accessories one, which is what
 * `sameKind` reads to tell a substitute from an add-on — see its docblock.
 */
function db(over: {
  units: Unit[];
  events?: UnitEvent[];
  orders?: Order[];
  pos?: Po[];
}): MockDb {
  return {
    units: over.units,
    events: over.events ?? [],
    orders: over.orders ?? [],
    // What a machine COST is read off these since 2026-09-15: its invoice's
    // shipping and tax, and its repairs. Empty unless a test says otherwise.
    pos: over.pos ?? [],
    services: [],
    discounts: [],
    skus: [
      {
        id: "sku-air",
        modelId: "m-air",
        code: "AIR",
        name: "MacBook Air M2",
        variantLabel: "8/256",
        price: 10_000_000,
      },
      {
        id: "sku-air-plus",
        modelId: "m-air",
        code: "AIR+",
        name: "MacBook Air M2",
        variantLabel: "16/512",
        price: 12_000_000,
      },
      {
        id: "sku-pro",
        modelId: "m-pro",
        code: "PRO",
        name: "MacBook Pro 14",
        variantLabel: "16/512",
        price: 25_000_000,
      },
      {
        id: "sku-air-old",
        modelId: "m-air-old",
        code: "AIROLD",
        name: "MacBook Air 2015",
        variantLabel: "i5 8/256",
        price: 6_000_000,
      },
      {
        id: "sku-tablet",
        modelId: "m-tablet",
        code: "IPAD",
        name: "iPad",
        variantLabel: "64GB Wi-Fi",
        price: 5_000_000,
      },
      {
        id: "sku-sleeve",
        modelId: "m-sleeve",
        code: "SLV",
        name: "Sleeve",
        variantLabel: "Grey",
        price: 400_000,
      },
      {
        id: "sku-mouse",
        modelId: "m-mouse",
        code: "MSE",
        name: "Magic Mouse",
        variantLabel: "White",
        price: 1_200_000,
      },
    ],
    models: [
      {
        id: "m-air",
        name: "MacBook Air M2",
        category: "MacBook",
        releaseYear: 2022,
        axes: [
          { name: "RAM", values: ["8GB", "16GB"] },
          { name: "SSD", values: ["256GB", "512GB"] },
        ],
      },
      {
        id: "m-pro",
        name: "MacBook Pro 14",
        category: "MacBook",
        releaseYear: 2023,
        axes: [
          { name: "RAM", values: ["16GB"] },
          { name: "SSD", values: ["512GB"] },
        ],
      },
      {
        // A previous generation of the same idea: one more axis than the Air,
        // and filed under a different category. `sameKind` has to see through
        // both differences — see its docblock.
        id: "m-air-old",
        name: "MacBook Air 2015",
        category: "MacBook Air Legacy",
        releaseYear: 2015,
        axes: [
          { name: "Chip", values: ["i5"] },
          { name: "RAM", values: ["8GB"] },
          { name: "SSD", values: ["256GB"] },
        ],
      },
      {
        id: "m-tablet",
        name: "iPad",
        category: "iPad",
        releaseYear: 2022,
        axes: [
          { name: "Storage", values: ["64GB"] },
          { name: "Connectivity", values: ["Wi-Fi"] },
        ],
      },
      {
        id: "m-sleeve",
        name: "Sleeve",
        category: "Accessory",
        releaseYear: 2022,
        axes: [{ name: "Colour", values: ["Grey"] }],
      },
      {
        id: "m-mouse",
        name: "Magic Mouse",
        category: "Accessory",
        releaseYear: 2022,
        axes: [{ name: "Colour", values: ["White"] }],
      },
    ],
  } as unknown as MockDb;
}

const basketOf = (serial: string, price: number) => [{ serial, price }];

describe("recommendFor", () => {
  it("says nothing about an empty basket", () => {
    expect(recommendFor(db({ units: [] }), [], NOW)).toEqual([]);
  });

  it("offers a dearer machine of the same kind as an upgrade", () => {
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "A2", skuId: "sku-air-plus" }),
      ],
    });
    const out = recommendFor(store, basketOf("A1", 10_000_000), NOW);
    const up = out.filter((r) => r.kind === "UPGRADE");
    expect(up.map((r) => r.serial)).toEqual(["A2"]);
  });

  it("prefers a 20% step to a 150% one", () => {
    // The whole point of `fitScore`: a Pro at 2.5× is a different customer,
    // and a count-or-price ranking would have put it first for being dearer.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "A2", skuId: "sku-air-plus" }),
        unit({ serial: "P1", skuId: "sku-pro" }),
      ],
    });
    const out = recommendFor(store, basketOf("A1", 10_000_000), NOW);
    const up = out.filter((r) => r.kind === "UPGRADE");
    expect(up[0]?.serial).toBe("A2");
    expect(up[0]!.score).toBeGreaterThan(
      up.find((r) => r.serial === "P1")!.score,
    );
  });

  it("never proposes an accessory as an upgrade over another accessory", () => {
    // One axis is a choice, not a ladder — see `sameKind`. A mouse is dearer
    // than a sleeve and is still not an upgrade to it.
    const store = db({
      units: [
        unit({ serial: "S1", skuId: "sku-sleeve" }),
        unit({ serial: "M1", skuId: "sku-mouse" }),
      ],
    });
    const out = recommendFor(store, basketOf("S1", 400_000), NOW);
    expect(out.filter((r) => r.kind === "UPGRADE")).toEqual([]);
    expect(out.filter((r) => r.kind === "ADDON").map((r) => r.serial)).toEqual([
      "M1",
    ]);
  });

  it("ranks the accessory the history actually pairs with first", () => {
    // Three receipts. Every one of them carried an Air; every one also carried
    // a mouse, and none carried a sleeve. Confidence and lift both favour the
    // mouse, and no other signal is allowed to differ — same cost, same age.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "S1", skuId: "sku-sleeve", buy: 200_000 }),
        unit({ serial: "M1", skuId: "sku-mouse", buy: 600_000 }),
        // The machines the past receipts refer to. Sold, so they are not on
        // the shelf and cannot be recommended themselves.
        unit({ serial: "A-OLD", skuId: "sku-air", status: "TERJUAL" }),
        unit({ serial: "M-OLD", skuId: "sku-mouse", status: "TERJUAL" }),
      ],
      orders: [
        order("1", ["A-OLD", "M-OLD"]),
        order("2", ["A-OLD", "M-OLD"]),
        order("3", ["A-OLD", "M-OLD"]),
      ],
    });
    const out = recommendFor(store, basketOf("A1", 10_000_000), NOW);
    const addons = out.filter((r) => r.kind === "ADDON");
    expect(addons[0]?.serial).toBe("M1");
    const mouse = addons[0]!;
    expect(
      mouse.signals.find((s) => s.key === "confidence")!.value,
    ).toBeGreaterThan(0);
    expect(mouse.why.kind).toBe("MODEL_RULE");
  });

  it("says so plainly when there is no history to go on", () => {
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        // A cost the shop could plausibly have paid. The default fixture cost
        // is a laptop's, and on a Rp 400.000 sleeve it is a loss — which
        // scores zero on margin and would make this assert nothing.
        unit({ serial: "S1", skuId: "sku-sleeve", buy: 200_000 }),
      ],
    });
    const [addon] = recommendFor(store, basketOf("A1", 10_000_000), NOW).filter(
      (r) => r.kind === "ADDON",
    );
    expect(addon?.why.kind).toBe("NO_HISTORY");
    // Still recommended: margin and age can carry a row on their own.
    expect(addon?.score).toBeGreaterThan(0);
  });

  it("breaks a tie towards the machine that has sat longer", () => {
    // Identical in every respect the recommender can see, except that one came
    // in six months ago. That is money on a shelf, and it goes first.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "M-NEW", skuId: "sku-mouse", buy: 600_000 }),
        unit({ serial: "M-OLD", skuId: "sku-mouse", buy: 600_000 }),
      ],
      events: [
        intake("M-NEW", daysAgo(2)),
        intake("M-OLD", daysAgo(180)),
      ],
    });
    const addons = recommendFor(store, basketOf("A1", 10_000_000), NOW).filter(
      (r) => r.kind === "ADDON",
    );
    expect(addons[0]?.serial).toBe("M-OLD");
  });

  it("breaks a tie towards the machine the shop makes more on", () => {
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "M-THIN", skuId: "sku-mouse", buy: 1_100_000 }),
        unit({ serial: "M-FAT", skuId: "sku-mouse", buy: 300_000 }),
      ],
    });
    const addons = recommendFor(store, basketOf("A1", 10_000_000), NOW).filter(
      (r) => r.kind === "ADDON",
    );
    expect(addons[0]?.serial).toBe("M-FAT");
  });

  it("publishes a breakdown that adds up to the score", () => {
    // The explain panel renders these contributions, so a reader is being told
    // what actually decided the ranking — which is only true if they sum.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "M1", skuId: "sku-mouse", buy: 600_000 }),
      ],
      events: [intake("M1", daysAgo(45))],
    });
    for (const r of recommendFor(store, basketOf("A1", 10_000_000), NOW)) {
      const summed = r.signals.reduce((t, s) => t + s.contribution, 0);
      expect(summed).toBeCloseTo(r.score, 10);
      // Strongest first, so the first line of the panel is the real reason.
      const contributions = r.signals.map((s) => s.contribution);
      expect([...contributions].sort((a, b) => b - a)).toEqual(contributions);
    }
  });

  it("never recommends what is already in the basket, or what is not for sale", () => {
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "M1", skuId: "sku-mouse", status: "QC" }),
        unit({ serial: "M2", skuId: "sku-mouse", status: "DIRESERVASI" }),
      ],
    });
    const out = recommendFor(store, basketOf("A1", 10_000_000), NOW);
    expect(out.map((r) => r.serial)).toEqual([]);
  });
});

/**
 * The substitute rule, which is what decides whether a candidate can be an
 * add-on at all.
 *
 * These are here rather than in `pricing.test.ts` because they are about
 * `sameKind` specifically, and because the bug they guard against shipped
 * invisible: the old exact-grid rule let a laptop onto the add-on list for a
 * laptop, and the old cheapest-first sort hid it behind three accessories
 * every time. A scored ranking surfaced it on the first run.
 */
describe("a laptop is never an add-on to a laptop", () => {
  it("sees through an extra spec axis on an older generation", () => {
    // {RAM, SSD} sits inside {Chip, RAM, SSD}. Two answers to one question,
    // even though the grids are not equal and the categories differ.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "OLD1", skuId: "sku-air-old", buy: 3_000_000 }),
      ],
    });
    const addons = recommendFor(store, basketOf("A1", 10_000_000), NOW).filter(
      (r) => r.kind === "ADDON",
    );
    expect(addons).toEqual([]);
  });

  it("still calls a tablet an add-on, because it shares no axis", () => {
    // Storage x Connectivity against RAM x SSD: neither grid contains the
    // other, and an iPad alongside a Mac is a real second purchase.
    const store = db({
      units: [
        unit({ serial: "A1", skuId: "sku-air" }),
        unit({ serial: "IP1", skuId: "sku-tablet", buy: 3_000_000 }),
      ],
    });
    const addons = recommendFor(store, basketOf("A1", 10_000_000), NOW).filter(
      (r) => r.kind === "ADDON",
    );
    expect(addons.map((r) => r.serial)).toEqual(["IP1"]);
  });
});
