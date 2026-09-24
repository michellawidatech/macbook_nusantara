/**
 * The invoice as a person reads it — a product, how many, one price, a
 * discount (owner ask 2026-09-20: *"user will input: unit, qty, price … it
 * will not automatically expand the unit below it"*).
 */
import { describe, expect, it } from "vitest";
import {
  insertAfterGroup,
  linesToDrop,
  pieceCosts,
  purchaseLines,
  spreadDiscount,
} from "../src/lib/invoiceLines.js";
import type { Po, PoItem, Unit } from "../src/mock/seed.js";

const M1 = "sku-air-m1";
const M2 = "sku-air-m2";

const piece = (id: string, over: Partial<PoItem> = {}): PoItem => ({
  id,
  skuId: M1,
  serial: null,
  qty: 1,
  unitCost: 10_000_000,
  ...over,
});

const po = (items: PoItem[]): Pick<Po, "id" | "items"> => ({
  id: "po-1",
  items,
});

const unit = (serial: string, over: Partial<Unit> = {}): Unit => ({
  serial,
  skuId: M1,
  status: "QC",
  locationId: "wh-1",
  buy: 10_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

describe("purchaseLines", () => {
  it("reads five units of one product at one price back as one line of five", () => {
    const lines = purchaseLines(
      po(["a", "b", "c", "d", "e"].map((id) => piece(id))),
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      skuId: M1,
      qty: 5,
      unitCost: 10_000_000,
      discount: 0,
      received: 0,
      notArrived: 0,
      total: 50_000_000,
    });
    expect(lines[0]!.units).toHaveLength(5);
  });

  it("splits one product at two prices into two lines", () => {
    // The owner's own answer: *"if 2 same unit have different price, they
    // would manually input 2 times."*
    const lines = purchaseLines(
      po([piece("a"), piece("b", { unitCost: 9_800_000 }), piece("c")]),
      [],
    );
    expect(lines.map((l) => [l.unitCost, l.qty])).toEqual([
      [10_000_000, 2],
      [9_800_000, 1],
    ]);
  });

  it("keeps the products in the order they were first entered", () => {
    const lines = purchaseLines(
      po([piece("a", { skuId: M2 }), piece("b"), piece("c", { skuId: M2 })]),
      [],
    );
    expect(lines.map((l) => [l.skuId, l.qty])).toEqual([
      [M2, 2],
      [M1, 1],
    ]);
  });

  it("numbers a line's units from one", () => {
    const lines = purchaseLines(
      po([piece("a", { skuId: M2 }), piece("b"), piece("c", { skuId: M2 })]),
      [],
    );
    expect(lines[0]!.units.map((u) => [u.row.key, u.n])).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("takes the line's discount off its total and off nothing else", () => {
    const [l] = purchaseLines(
      po([
        piece("a", { discount: 250_000 }),
        piece("b", { discount: 250_000 }),
      ]),
      [],
    );
    expect(l).toMatchObject({
      qty: 2,
      discount: 500_000,
      subtotal: 20_000_000,
      total: 19_500_000,
      invoiced: 19_500_000,
    });
  });

  it("counts what arrived, and leaves a unit never sent out of the total", () => {
    const [l] = purchaseLines(
      po([
        piece("a", { serial: "SC02A" }),
        piece("b"),
        piece("c", { notReceived: true }),
      ]),
      [unit("SC02A")],
    );
    expect(l).toMatchObject({
      qty: 3,
      received: 1,
      notArrived: 1,
      total: 20_000_000,
      invoiced: 30_000_000,
    });
  });

  it("counts an older line's quantity as that many pieces", () => {
    const [l] = purchaseLines(po([piece("line", { qty: 3 })]), [unit("SC02A")]);
    expect(l).toMatchObject({ qty: 3, received: 1, total: 30_000_000 });
  });

  it("reads a counted product as its quantity, with no units under it", () => {
    const [l] = purchaseLines(
      po([piece("acc", { skuId: "sku-case", qty: 12, unitCost: 150_000 })]),
      [],
      (skuId) => skuId === "sku-case",
      () => 5,
    );
    expect(l).toMatchObject({
      counted: true,
      qty: 12,
      received: 5,
      total: 1_800_000,
    });
    expect(l!.units).toEqual([]);
  });
});

describe("spreadDiscount / pieceCosts", () => {
  it("splits a discount into whole rupiah that add back up", () => {
    const parts = spreadDiscount(500_000, 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(500_000);
    expect(parts).toEqual([166_667, 166_667, 166_666]);
  });

  it("gives each piece its price less its share", () => {
    const costs = pieceCosts(3, 10_000_000, 500_000);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(29_500_000);
  });

  it("never lets a discount take a piece below nil", () => {
    expect(pieceCosts(2, 1_000_000, 9_000_000)).toEqual([0, 0]);
  });

  it("is every piece at the line price when nothing was knocked off", () => {
    expect(pieceCosts(2, 10_000_000, 0)).toEqual([10_000_000, 10_000_000]);
  });
});

describe("linesToDrop", () => {
  const mine = (invoice: Pick<Po, "id" | "items">, skuId: string) =>
    invoice.items.filter((i) => i.skuId === skuId);

  it("takes units nobody has scanned, from the end", () => {
    const invoice = po([
      piece("a", { serial: "SC02A" }),
      piece("b"),
      piece("c"),
      piece("d", { skuId: M2 }),
    ]);
    expect(linesToDrop(invoice, [unit("SC02A")], mine(invoice, M1), 1)).toEqual(
      ["c"],
    );
    expect(linesToDrop(invoice, [unit("SC02A")], mine(invoice, M1), 2)).toEqual(
      ["b", "c"],
    );
  });

  it("refuses to take a unit that has been scanned", () => {
    const invoice = po([piece("a", { serial: "SC02A" }), piece("b")]);
    expect(
      linesToDrop(invoice, [unit("SC02A")], mine(invoice, M1), 2),
    ).toBeNull();
  });
});

describe("insertAfterGroup", () => {
  it("puts a line's new pieces straight after its last one", () => {
    const items = [piece("a"), piece("b", { skuId: M2 }), piece("c")];
    const added = [piece("x"), piece("y")];
    const m1 = items.filter((i) => i.skuId === M1);
    const m2 = items.filter((i) => i.skuId === M2);
    expect(insertAfterGroup(items, m1, added).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "x",
      "y",
    ]);
    expect(
      insertAfterGroup(items, m2, [piece("z", { skuId: M2 })]).map((i) => i.id),
    ).toEqual(["a", "b", "z", "c"]);
  });

  it("puts a line the invoice did not have at the end", () => {
    const items = [piece("a")];
    expect(
      insertAfterGroup(items, [], [piece("n", { skuId: "sku-new" })]).map(
        (i) => i.id,
      ),
    ).toEqual(["a", "n"]);
  });
});
