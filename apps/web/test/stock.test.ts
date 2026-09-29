/**
 * Counted products as quantities (owner decision 2026-09-19) — `lib/stock.ts`.
 */
import { describe, expect, it } from "vitest";
import type { Po, StockMove } from "../src/mock/seed.js";
import {
  arrivedQty,
  averageCost,
  lineCost,
  onHand,
  stockLevels,
  takeFrom,
} from "../src/lib/stock.js";
import { buildSeed } from "../src/mock/seed.js";

let seq = 0;
const move = (m: Partial<StockMove> & Pick<StockMove, "qty">): StockMove => ({
  id: `m-${String(++seq).padStart(3, "0")}`,
  skuId: "mouse",
  locationId: "wh-1",
  cost: 0,
  type: "KOREKSI",
  at: `2026-09-${String(10 + seq).padStart(2, "0")}T10:00:00.000Z`,
  staff: "Michella",
  ...m,
});

const po = (over: Partial<Po> = {}): Po => ({
  id: "po-x",
  code: "PI-2026/09-000001",
  supplierId: "sup-1",
  invoice: "INV",
  date: "2026-09-10",
  locationId: "wh-1",
  items: [
    { id: "li-1", skuId: "mouse", serial: null, qty: 4, unitCost: 100_000 },
  ],
  payments: [],
  fees: [],
  discount: 0,
  status: "RECEIVED",
  ...over,
});

describe("on hand", () => {
  it("is the sum of the ledger, per variant and location", () => {
    const moves = [
      move({ qty: 5 }),
      move({ qty: -2 }),
      move({ qty: 3, locationId: "wh-2" }),
      move({ qty: 1, skuId: "hub" }),
    ];
    expect(onHand(moves, "mouse")).toBe(6);
    expect(onHand(moves, "mouse", "wh-1")).toBe(3);
    expect(onHand(moves, "hub")).toBe(1);
    expect(stockLevels(moves).get("mouse")).toEqual(
      new Map([
        ["wh-1", 3],
        ["wh-2", 3],
      ]),
    );
  });

  it("leaves empty shelves out of the levels", () => {
    const levels = stockLevels([move({ qty: 2 }), move({ qty: -2 })]);
    expect(levels.has("mouse")).toBe(false);
  });

  it("counts what arrived on an invoice line, net of take-backs", () => {
    const moves = [
      move({ qty: 4, type: "MASUK", poItemId: "li-1" }),
      move({ qty: -1, type: "MASUK_BATAL", poItemId: "li-1" }),
      move({ qty: -1, type: "TERJUAL" }),
    ];
    expect(arrivedQty(moves, "li-1")).toBe(3);
  });
});

describe("taking stock for a sale", () => {
  const moves = [
    move({ qty: 1, locationId: "wh-1" }),
    move({ qty: 4, locationId: "wh-2" }),
    move({ qty: 2, locationId: "wh-3" }),
  ];

  it("takes from the preferred location first, then the fullest", () => {
    expect(takeFrom(moves, "mouse", 3, "wh-1")).toEqual([
      { locationId: "wh-1", qty: 1 },
      { locationId: "wh-2", qty: 2 },
    ]);
  });

  it("refuses to sell what the shop does not hold", () => {
    expect(takeFrom(moves, "mouse", 8)).toBeNull();
  });
});

describe("moving average cost", () => {
  it("costs an arrival at its price plus its share of the invoice's expenses", () => {
    const invoice = po({
      fees: [
        {
          id: "f-1",
          kind: "SHIPPING",
          label: "Ongkir",
          amount: 40_000,
          inCogs: true,
        },
      ],
    });
    const store = {
      pos: [invoice],
      units: [],
      stockMoves: [
        move({
          qty: 4,
          type: "MASUK",
          cost: 100_000,
          poId: "po-x",
          poItemId: "li-1",
        }),
      ],
    };
    // Four boxes in the parcel: 10k of ongkir each.
    expect(averageCost(store, "mouse")).toBe(110_000);
  });

  it("averages over what is on the shelf, and a sale takes the average", () => {
    const store = {
      pos: [],
      units: [],
      stockMoves: [
        move({ qty: 2, cost: 100_000 }),
        move({ qty: -1 }),
        move({ qty: 1, cost: 130_000 }),
      ],
    };
    // One left at 100k, one in at 130k.
    expect(averageCost(store, "mouse")).toBe(115_000);
  });

  it("starts again once the shelf empties", () => {
    const store = {
      pos: [],
      units: [],
      stockMoves: [
        move({ qty: 1, cost: 100_000 }),
        move({ qty: -1 }),
        move({ qty: 1, cost: 90_000 }),
      ],
    };
    expect(averageCost(store, "mouse")).toBe(90_000);
  });

  it("reads a sale's cost off its TERJUAL moves", () => {
    const moves = [
      move({ qty: -2, type: "TERJUAL", cost: 110_000, orderLineId: "ol-1" }),
      move({
        qty: -1,
        type: "TERJUAL",
        cost: 110_000,
        orderLineId: "ol-1",
        locationId: "wh-2",
      }),
    ];
    expect(lineCost(moves, "ol-1")).toBe(330_000);
  });
});

describe("the demo shop", () => {
  const db = buildSeed();

  it("holds accessories as quantities, not units", () => {
    const counted = new Set(
      db.categories.filter((c) => !c.tracksSerial).map((c) => c.name),
    );
    const accessory = (skuId: string) => {
      const sku = db.skus.find((s) => s.id === skuId)!;
      return counted.has(db.models.find((m) => m.id === sku.modelId)!.category);
    };
    expect(db.units.some((u) => accessory(u.skuId))).toBe(false);
    expect(db.stockMoves.length).toBeGreaterThan(0);
    for (const m of db.stockMoves) expect(accessory(m.skuId), m.id).toBe(true);
  });

  it("never holds a negative shelf", () => {
    for (const at of stockLevels(db.stockMoves).values()) {
      for (const n of at.values()) expect(n).toBeGreaterThan(0);
    }
  });
});
