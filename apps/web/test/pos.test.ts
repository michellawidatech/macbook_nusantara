/**
 * The till's catalogue and its arithmetic.
 *
 * Both exist outside the page for the same reason `lib/pricing.ts` does: these
 * are the parts with the interesting cases — a variant with three machines and
 * two of them already in the basket, a trade-in worth more than the bill — and
 * a component has to be rendered to check those while a function can be read.
 */
import { describe, expect, it } from "vitest";
import {
  marginPct,
  orderBill,
  saleTotals,
  totalAfterTradeIn,
  tradeInPurchase,
  shelfCategories,
  shelfRows,
} from "../src/lib/pos.js";
import { costOfUnit } from "../src/lib/service.js";
import type { MockDb, Po, Unit } from "../src/mock/seed.js";

const unit = (over: Partial<Unit> & Pick<Unit, "serial">): Unit => ({
  skuId: "sku-air",
  status: "TERSEDIA",
  locationId: "wh-1",
  buy: 8_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

/** Just enough store for the catalogue to be built from. */
const db = (units: Unit[], stockMoves: MockDb["stockMoves"] = []): MockDb =>
  ({
    units,
    stockMoves,
    skus: [
      {
        id: "sku-air",
        modelId: "m-air",
        code: "AIR-8-256",
        name: "MacBook Air M2",
        variantLabel: "8GB / 256GB",
        price: 11_500_000,
      },
      {
        id: "sku-pro",
        modelId: "m-pro",
        code: "PRO-16-512",
        name: "MacBook Pro 14 M3",
        variantLabel: "16GB / 512GB",
        price: 26_900_000,
      },
      {
        id: "sku-mouse",
        modelId: "m-mouse",
        code: "MOUSE-BLK",
        name: "Magic Mouse",
        variantLabel: "Black",
        price: 950_000,
      },
    ],
    models: [
      { id: "m-air", category: "MacBook Air" },
      { id: "m-pro", category: "MacBook Pro" },
      { id: "m-mouse", category: "Accessory" },
    ],
  }) as unknown as MockDb;

describe("shelfRows", () => {
  it("lists a counted product off the stock ledger, one row with a quantity", () => {
    // Accessories are quantities, not units (2026-09-19).
    const move = (qty: number, locationId: string) => ({
      id: `sm-${locationId}-${qty}`,
      skuId: "sku-mouse",
      locationId,
      qty,
      cost: 500_000,
      type: "MASUK" as const,
      at: "2026-09-01T10:00:00.000Z",
      staff: "Michella",
    });
    const rows = shelfRows(db([], [move(3, "wh-1"), move(2, "wh-2")]), {
      takenQty: { "sku-mouse": 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      counted: true,
      remaining: 4,
      units: [],
      category: "Accessory",
    });
    expect(rows[0]!.price.min).toBe(950_000);
  });

  it("is one row per variant, with the machines behind it counted", () => {
    // The whole point of the 2026-08-27 rebuild. Listing serials was honest
    // and useless: a customer points at a machine and says "the Air", and
    // forty rows of C02XY… is not an answer.
    const rows = shelfRows(
      db([
        unit({ serial: "S1" }),
        unit({ serial: "S2" }),
        unit({ serial: "S3", skuId: "sku-pro" }),
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sku.id).toBe("sku-air");
    expect(rows[0]!.remaining).toBe(2);
    expect(rows[1]!.remaining).toBe(1);
  });

  it("counts the basket off the row without removing it", () => {
    // A row that vanishes as it is clicked moves the next one under the
    // cursor, and a cashier adding two of one model would hit the wrong thing
    // every time. A row at zero also answers "did we have one of those?".
    const rows = shelfRows(
      db([unit({ serial: "S1" }), unit({ serial: "S2" })]),
      {
        taken: ["S1"],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.remaining).toBe(1);

    const empty = shelfRows(db([unit({ serial: "S1" })]), { taken: ["S1"] });
    expect(empty).toHaveLength(1);
    expect(empty[0]!.remaining).toBe(0);
  });

  it("finds a row by its serial as well as by its name", () => {
    // A scanned serial has to find its row, and staff who know a machine by
    // its serial should not have to translate.
    const store = db([unit({ serial: "C02XY1234567" })]);
    expect(shelfRows(store, { query: "c02xy1234" })).toHaveLength(1);
    expect(shelfRows(store, { query: "macbook air" })).toHaveLength(1);
    expect(shelfRows(store, { query: "AIR-8" })).toHaveLength(1);
    expect(shelfRows(store, { query: "iphone" })).toHaveLength(0);
  });

  it("filters by category, and lists the categories stock actually spans", () => {
    const store = db([
      unit({ serial: "S1" }),
      unit({ serial: "S2", skuId: "sku-mouse" }),
    ]);
    expect(shelfCategories(shelfRows(store))).toEqual([
      "Accessory",
      "MacBook Air",
    ]);
    const only = shelfRows(store, { category: "Accessory" });
    expect(only).toHaveLength(1);
    expect(only[0]!.sku.id).toBe("sku-mouse");
  });

  it("is one row per variant AND grade, best grade first (owner ask 2026-10-08)", () => {
    // "Per row is per unit with same grade and same spec." A row holding an A
    // and a B quoted both shelves' prices at once.
    const rows = shelfRows(
      db([
        unit({ serial: "S1", grade: "B" }),
        unit({ serial: "S2", grade: "A" }),
        unit({ serial: "S3", grade: "A" }),
        unit({ serial: "S4", grade: "NEW" }),
      ]),
    );
    expect(rows.map((r) => [r.grade, r.remaining])).toEqual([
      ["NEW", 1],
      ["A", 2],
      ["B", 1],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(rows[1]!.units.map((u) => u.serial)).toEqual(["S2", "S3"]);
  });

  it("counts a unit in the basket off its own grade's row only", () => {
    const rows = shelfRows(
      db([
        unit({ serial: "S1", grade: "B" }),
        unit({ serial: "S2", grade: "A" }),
      ]),
      { taken: ["S1"] },
    );
    expect(rows.map((r) => [r.grade, r.remaining])).toEqual([
      ["A", 1],
      ["B", 0],
    ]);
  });

  it("finds by serial only the grade's row that holds it", () => {
    const rows = shelfRows(
      db([
        unit({ serial: "C02AAA111111", grade: "A" }),
        unit({ serial: "C02BBB222222", grade: "B" }),
      ]),
      { query: "c02bbb" },
    );
    expect(rows.map((r) => r.grade)).toEqual(["B"]);
  });

  it("keeps a held machine sellable, and says it is held", () => {
    // A hold is a promise, not a removal: the shop sells the machine it
    // promised to the person it promised it to, and the chooser says which.
    const rows = shelfRows(db([unit({ serial: "S1", status: "DIRESERVASI" })]));
    expect(rows[0]!.remaining).toBe(1);
    expect(rows[0]!.anyReserved).toBe(true);
  });

  it("leaves out everything that is not for sale", () => {
    const rows = shelfRows(
      db([
        unit({ serial: "S1", status: "QC" }),
        unit({ serial: "S2", status: "TERJUAL" }),
        unit({ serial: "S3", status: "HILANG" }),
      ]),
    );
    expect(rows).toEqual([]);
  });
});

describe("marginPct", () => {
  it("is of revenue, not of cost", () => {
    // 100 bought and 125 sold is 20% here, not 25%. That is the convention a
    // P&L uses, and reading one while the accounts use the other is how a
    // floor price gets set wrong.
    expect(marginPct(125, 100)).toBeCloseTo(20);
  });

  it("has no answer when there is nothing to be a percentage of", () => {
    // A basket adding up to zero has a mistake, not a margin, and 0% would
    // look like an answer.
    expect(marginPct(0, 0)).toBeNull();
    expect(marginPct(-1, 0)).toBeNull();
  });

  it("goes negative on a machine sold under what it cost", () => {
    expect(marginPct(80, 100)).toBeCloseTo(-25);
  });
});

describe("what a machine costs the till", () => {
  /**
   * The margin the basket shows is `costOfUnit`, not `Unit.buy` — so the
   * invoice's ongkir and tax reach it (owner ask 2026-09-15). The split
   * itself is `test/landedCost.test.ts`; what is pinned here is that the
   * till's own arithmetic is fed the whole cost.
   */
  const po = (over: Partial<Po> = {}): Po =>
    ({
      id: "po-1",
      fees: [
        {
          id: "f1",
          kind: "SHIPPING",
          label: "",
          amount: 300_000,
          inCogs: true,
        },
        { id: "f2", kind: "TAX", label: "", amount: 100_000, inCogs: true },
      ],
      items: [
        {
          id: "it-1",
          skuId: "sku-air",
          serial: null,
          qty: 2,
          unitCost: 8_000_000,
        },
      ],
      ...over,
    }) as unknown as Po;

  const store = (pos: Po[], units: Unit[]) =>
    ({ pos, units, events: [], services: [] }) as unknown as MockDb;

  it("carries the invoice's shipping and tax, split over its machines", () => {
    const units = [unit({ serial: "S1" }), unit({ serial: "S2" })];
    const db = store([po()], units);
    // Rp400.000 of charges over two machines is Rp200.000 each.
    expect(costOfUnit(units[0]!, db)).toBe(8_200_000);
    expect(costOfUnit(units[1]!, db)).toBe(8_200_000);
  });

  it("lands in the margin the basket prints", () => {
    const units = [unit({ serial: "S1" }), unit({ serial: "S2" })];
    const db = store([po()], units);
    // Sold at the asking price, the ongkir is the difference between the
    // margin the shop thinks it made and the one it made.
    const sold = 11_500_000;
    expect(marginPct(sold, units[0]!.buy)).toBeCloseTo(30.43, 2);
    expect(marginPct(sold, costOfUnit(units[0]!, db))).toBeCloseTo(28.7, 2);
  });

  it("charges nothing to a machine that came off no invoice", () => {
    // A trade-in or a stock-take find has no forwarder behind it.
    const found = unit({ serial: "S9", poId: null });
    expect(costOfUnit(found, store([po()], [found]))).toBe(found.buy);
  });
});

describe("saleTotals", () => {
  const base = {
    prices: [10_000_000],
    costs: [8_000_000],
    discount: 0,
    extra: 0,
    tradeIns: [],
  };

  it("takes the discount off, then adds the charge, then the trade-in", () => {
    // The order is the shop's, not the arithmetic's: the discount is off the
    // goods, the extra is a charge on top of them, and the trade-in is the
    // customer handing over value rather than money.
    const t = saleTotals({
      ...base,
      discount: 1_000_000,
      extra: 250_000,
      tradeIns: [{ id: "t1", label: "Air 2017", value: 2_000_000 }],
    });
    expect(t.subtotal).toBe(10_000_000);
    expect(t.discount).toBe(1_000_000);
    expect(t.extra).toBe(250_000);
    expect(t.tradeCredit).toBe(2_000_000);
    expect(t.total).toBe(7_250_000);
  });

  it("never asks the customer for less than nothing", () => {
    // A trade-in worth more than the bill leaves zero to collect, and what
    // the shop owes the customer is the payout (owner ask 2026-10-31).
    const t = saleTotals({
      ...base,
      tradeIns: [{ id: "t1", label: "Pro 16", value: 30_000_000 }],
    });
    expect(t.total).toBe(0);
    expect(t.payout).toBe(20_000_000);
    expect(saleTotals(base).payout).toBe(0);
  });

  it("never lets a discount exceed the goods it is against", () => {
    expect(saleTotals({ ...base, discount: 99_000_000 }).discount).toBe(
      10_000_000,
    );
    expect(saleTotals({ ...base, discount: 99_000_000 }).total).toBe(0);
  });

  it("keeps delivery and trade-ins out of the margin", () => {
    // Delivery is a pass-through the shop does not mark up, and a traded
    // machine is stock coming IN at a cost — its margin is earned when it is
    // sold again. Folding either in would make the till disagree with the P&L
    // about the same sale.
    const plain = saleTotals({ ...base });
    const dressed = saleTotals({
      ...base,
      extra: 5_000_000,
      tradeIns: [{ id: "t1", label: "Air", value: 3_000_000 }],
    });
    expect(dressed.margin).toBe(plain.margin);
    expect(plain.margin).toBeCloseTo(20);
  });

  it("moves the margin when the discount does", () => {
    // The one thing that IS about the goods.
    const t = saleTotals({ ...base, discount: 2_000_000 });
    expect(t.margin).toBeCloseTo(0);
    expect(t.cogs).toBe(8_000_000);
  });
});

/**
 * The figures an `Order` row can actually hold.
 *
 * `Order_total_arithmetic_check` (migration 20260815060658) is
 * `CHECK (total = subtotal - discount + extra)`, and the till's own numbers
 * break it three ways: `subtotal` is the LIST price so a bargain or an upsell
 * sits between it and what is charged, and `total` has the trade-in already
 * taken off while the schema keeps `tradeCredit` in its own column, out of the
 * CHECK, because it is credit against what is COLLECTED and not a smaller bill.
 *
 * Nothing writes an order yet. These exist so that the code which eventually
 * does cannot reintroduce a 23514 by reaching for the obvious field names.
 */
describe("saleTotals — the order row", () => {
  const base = {
    prices: [10_000_000],
    costs: [8_000_000],
    discount: 0,
    extra: 0,
    tradeIns: [],
  };

  /** The CHECK itself, as the database states it. */
  const satisfiesCheck = (o: {
    subtotal: number;
    discount: number;
    extra: number;
    total: number;
  }) => o.total === o.subtotal - o.discount + o.extra;

  it("holds the CHECK on a plain sale", () => {
    const { order } = saleTotals({ ...base });
    expect(satisfiesCheck(order)).toBe(true);
    expect(order.subtotal).toBe(10_000_000);
    expect(order.total).toBe(10_000_000);
  });

  it("holds the CHECK when a trade-in is taken — the case that would 23514", () => {
    const t = saleTotals({
      ...base,
      discount: 1_000_000,
      extra: 250_000,
      tradeIns: [{ id: "t1", label: "Air 2017", value: 2_000_000 }],
    });
    expect(satisfiesCheck(t.order)).toBe(true);
    // The bill stands at its own size; the credit is beside it, not inside it.
    expect(t.order.total).toBe(9_250_000);
    expect(t.order.tradeCredit).toBe(2_000_000);
    // And what the customer actually hands over is still the till's figure.
    expect(t.total).toBe(7_250_000);
  });

  it("holds the CHECK when a machine was haggled below its list price", () => {
    const t = saleTotals({
      ...base,
      prices: [8_500_000],
      listPrices: [10_000_000],
    });
    expect(satisfiesCheck(t.order)).toBe(true);
    // The till shows the list price and names the bargain; the row stores what
    // was charged, because the schema has no column for a list price.
    expect(t.subtotal).toBe(10_000_000);
    expect(t.bargain).toBe(1_500_000);
    expect(t.order.subtotal).toBe(8_500_000);
    expect(t.order.total).toBe(8_500_000);
  });

  it("holds the CHECK when a machine went out above list", () => {
    const t = saleTotals({
      ...base,
      prices: [11_000_000],
      listPrices: [10_000_000],
      extra: 300_000,
    });
    expect(satisfiesCheck(t.order)).toBe(true);
    expect(t.upsell).toBe(1_000_000);
    expect(t.order.subtotal).toBe(11_000_000);
    expect(t.order.total).toBe(11_300_000);
  });

  it("holds the CHECK on a basket that is a bargain AND an upsell at once", () => {
    const t = saleTotals({
      prices: [8_000_000, 12_000_000],
      listPrices: [10_000_000, 10_000_000],
      costs: [6_000_000, 6_000_000],
      discount: 500_000,
      extra: 100_000,
      tradeIns: [{ id: "t1", label: "Air", value: 1_000_000 }],
    });
    expect(satisfiesCheck(t.order)).toBe(true);
    expect(t.bargain).toBe(2_000_000);
    expect(t.upsell).toBe(2_000_000);
    expect(t.order.subtotal).toBe(20_000_000);
    expect(t.order.total).toBe(19_600_000);
    expect(t.total).toBe(18_600_000);
  });

  it("keeps every money column non-negative, which is its own CHECK", () => {
    // Order_money_nonneg_check covers subtotal, discount, total and
    // tradeCredit. A discount larger than the goods is the way in.
    const t = saleTotals({ ...base, discount: 99_000_000 });
    expect(satisfiesCheck(t.order)).toBe(true);
    for (const v of Object.values(t.order)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("does not cap a trade-in worth more than the bill", () => {
    // The customer hands over nothing (t.total is 0), but the shop now owes
    // them cash. Capping the credit would erase that debt from the books
    // instead of leaving it to surface as the refund it is.
    const t = saleTotals({
      ...base,
      tradeIns: [{ id: "t1", label: "Pro 16", value: 30_000_000 }],
    });
    expect(satisfiesCheck(t.order)).toBe(true);
    expect(t.total).toBe(0);
    expect(t.order.total).toBe(10_000_000);
    expect(t.order.tradeCredit).toBe(30_000_000);
  });
});

describe("a trade-in worth more than the bill (owner ask 2026-10-31)", () => {
  // "1 person buying 1 unit 12,5, but trade in 27 … record the 12,5 as income
  // and 27 as expense."
  const sale = {
    serials: ["S1"],
    prices: { S1: 12_500_000 },
    discount: 0,
  };

  it("is recorded at the full bill, and the trade-in as a purchase", () => {
    expect(totalAfterTradeIn(12_500_000, 27_000_000)).toBe(12_500_000);
    expect(
      tradeInPurchase({
        ...sale,
        tradeIns: [{ value: 27_000_000 }],
      }),
    ).toBe(27_000_000);
  });

  it("still comes off the bill when it is worth less", () => {
    expect(totalAfterTradeIn(12_500_000, 2_000_000)).toBe(10_500_000);
    expect(totalAfterTradeIn(12_500_000, 12_500_000)).toBe(0);
    expect(tradeInPurchase({ ...sale, tradeIns: [{ value: 2_000_000 }] })).toBe(
      0,
    );
    expect(tradeInPurchase(sale)).toBe(0);
  });

  it("reads the bill off the lines, the discount and the extra", () => {
    expect(
      orderBill({
        ...sale,
        lines: [{ qty: 2, price: 250_000 }],
        discount: 100_000,
        extra: 50_000,
      }),
    ).toBe(12_950_000);
  });
});
