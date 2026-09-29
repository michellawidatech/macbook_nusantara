/**
 * Receiving: one row per machine, and what the invoice expected beside what
 * turned up.
 *
 * The cases are the owner's four stories of 2026-09-18 — a normal delivery,
 * one machine priced differently from its neighbours, a machine that turned
 * out to be a different product, and two that never came — plus the older
 * invoices whose lines still carry a quantity.
 */
import { describe, expect, it } from "vitest";
import {
  invoiceChanges,
  isDifferentProduct,
  normaliseLines,
  receivingRows,
  receivingState,
  receivingSummary,
} from "../src/lib/inboundRows.js";
import { poTotals } from "../src/lib/inbound.js";
import type { Po, PoItem, Unit } from "../src/mock/seed.js";

const M1 = "sku-air-m1";
const M2 = "sku-air-m2";

const unit = (over: Partial<Unit> & Pick<Unit, "serial">): Unit => ({
  skuId: M1,
  status: "QC",
  locationId: "wh-1",
  buy: 10_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

const po = (items: PoItem[]): Po => ({
  id: "po-1",
  code: "PI-2026/09-000001",
  supplierId: "sup-1",
  invoice: "INV-1",
  date: "2026-09-18",
  locationId: "wh-1",
  items,
  payments: [],
  fees: [],
  discount: 0,
  status: "RECEIVED",
});

/** One machine of the invoice — the shape every new row is written in. */
const piece = (id: string, over: Partial<PoItem> = {}): PoItem => ({
  id,
  skuId: M1,
  serial: null,
  qty: 1,
  unitCost: 10_000_000,
  ...over,
});

/** Five M1s at the invoice's default price, as the add bar writes them. */
const fiveM1 = () =>
  ["a", "b", "c", "d", "e"].map((id) => piece(id)) satisfies PoItem[];

describe("receivingRows", () => {
  it("shows one row per machine the invoice lists, all still waiting", () => {
    const rows = receivingRows(po(fiveM1()), []);
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rows.map(receivingState)).toEqual([
      "WAITING",
      "WAITING",
      "WAITING",
      "WAITING",
      "WAITING",
    ]);
    expect(rows.every((r) => r.unitCost === 10_000_000)).toBe(true);
  });

  it("stands a machine in the row whose line names its serial", () => {
    const rows = receivingRows(
      po([piece("a"), piece("b", { serial: "SC02B" })]),
      [unit({ serial: "SC02B" })],
    );
    expect(rows.map((r) => r.unit?.serial ?? null)).toEqual([null, "SC02B"]);
  });

  it("keeps each machine's own price once the rows exist", () => {
    // Scenario 2: the default seeded every row; the third was changed.
    const items = fiveM1();
    items[2] = { ...items[2]!, unitCost: 9_800_000 };
    const rows = receivingRows(po(items), []);
    expect(rows.map((r) => r.unitCost)).toEqual([
      10_000_000, 10_000_000, 9_800_000, 10_000_000, 10_000_000,
    ]);
    // And the invoice is the sum of its machines, not qty × one price.
    expect(poTotals(po(items)).subtotal).toBe(49_800_000);
  });

  it("says a machine is a different product without rewriting the invoice", () => {
    // Scenario 3: invoiced M1 × 2, the second turned out to be an M2.
    const invoice = po([
      piece("a", { serial: "SC02A" }),
      piece("b", { serial: "SC02B" }),
    ]);
    const rows = receivingRows(invoice, [
      unit({ serial: "SC02A" }),
      unit({ serial: "SC02B", skuId: M2 }),
    ]);
    expect(rows.map((r) => r.expectedSkuId)).toEqual([M1, M1]);
    expect(rows.map((r) => r.unit?.skuId)).toEqual([M1, M2]);
    expect(rows.map(isDifferentProduct)).toEqual([false, true]);
    expect(invoiceChanges(rows).changes).toEqual([
      { invoiced: M1, received: M2, count: 1 },
    ]);
  });

  it("marks the machines that never came, one by one", () => {
    // Scenario 4: five invoiced, three arrived.
    const items = fiveM1().map((it, i) =>
      i < 3 ? { ...it, serial: `SC0${i}` } : { ...it, notReceived: true },
    );
    const rows = receivingRows(po(items), [
      unit({ serial: "SC00" }),
      unit({ serial: "SC01" }),
      unit({ serial: "SC02" }),
    ]);
    expect(rows.map(receivingState)).toEqual([
      "IN_QC",
      "IN_QC",
      "IN_QC",
      "NOT_ARRIVED",
      "NOT_ARRIVED",
    ]);
    expect(receivingSummary(rows)).toMatchObject({
      expected: 5,
      received: 3,
      waiting: 0,
      notArrived: 2,
    });
    // Still invoiced, no longer owed.
    expect(poTotals(po(items)).subtotal).toBe(30_000_000);
  });

  it("does not let a dangling link borrow another machine", () => {
    const rows = receivingRows(po([piece("a", { serial: "GONE" })]), [
      unit({ serial: "SC02X" }),
    ]);
    expect(rows[0]!.unit).toBeNull();
    // The machine is still shown — as one no line accounts for.
    expect(rows[1]).toMatchObject({ orphan: true, key: "unit:SC02X" });
    expect(receivingSummary(rows)).toMatchObject({ expected: 1, extra: 1 });
  });

  it("ignores machines belonging to another order", () => {
    const rows = receivingRows(po([piece("a")]), [
      unit({ serial: "SC02X", poId: "po-2" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unit).toBeNull();
  });

  it("asks for a product on a line nobody has picked one for", () => {
    const rows = receivingRows(po([piece("a", { skuId: "" })]), []);
    expect(receivingState(rows[0]!)).toBe("NO_PRODUCT");
  });
});

describe("an invoice written with quantities", () => {
  it("still shows a row per machine, handing each the next of its product", () => {
    const invoice = po([piece("line", { qty: 3 })]);
    const rows = receivingRows(invoice, [unit({ serial: "SC02A" })]);
    expect(rows.map((r) => r.key)).toEqual(["line#0", "line#1", "line#2"]);
    expect(rows.map((r) => r.unit?.serial ?? null)).toEqual([
      "SC02A",
      null,
      null,
    ]);
  });

  it("splits into one line per machine on the first edit, keeping what is owed", () => {
    const invoice = po([
      piece("line", { qty: 3, unitCost: 4_100_000 }),
      piece("never", { qty: 2, notReceived: true }),
    ]);
    const before = poTotals(invoice).subtotal;
    let n = 0;
    const moved = normaliseLines(invoice, [unit({ serial: "SC02A" })], () => {
      n += 1;
      return `new-${n}`;
    });

    expect(invoice.items.map((i) => [i.id, i.qty, i.serial])).toEqual([
      ["line", 1, "SC02A"],
      ["new-1", 1, null],
      ["new-2", 1, null],
      ["never", 1, null],
      ["new-3", 1, null],
    ]);
    expect(invoice.items.slice(3).every((i) => i.notReceived)).toBe(true);
    expect(poTotals(invoice).subtotal).toBe(before);
    // Where each old row went, so drafts can follow them.
    expect(moved).toEqual({
      "line#0": "line",
      "line#1": "new-1",
      "line#2": "new-2",
      "never#0": "never",
      "never#1": "new-3",
    });
  });

  it("writes the link down for a one-machine line matched by product", () => {
    const invoice = po([piece("a")]);
    normaliseLines(invoice, [unit({ serial: "SC02A" })], () => "x");
    expect(invoice.items[0]!.serial).toBe("SC02A");
  });

  it("touches nothing when every line is already one machine", () => {
    const items = fiveM1();
    const invoice = po(items);
    expect(normaliseLines(invoice, [], () => "x")).toEqual({});
    // The same array: a copy-on-write draft must see no edit at all.
    expect(invoice.items).toBe(items);
  });
});

describe("receivingSummary", () => {
  it("counts QC separately from receiving", () => {
    const items = fiveM1().map((it, i) =>
      i < 3 ? { ...it, serial: `SC0${i}` } : it,
    );
    const rows = receivingRows(po(items), [
      unit({ serial: "SC00", description: "Mulus" }),
      unit({ serial: "SC01" }),
      unit({ serial: "SC02", status: "TERSEDIA", description: "Mulus" }),
    ]);
    expect(receivingSummary(rows)).toEqual({
      expected: 5,
      received: 3,
      waiting: 2,
      notArrived: 0,
      differentProduct: 0,
      extra: 0,
      inQc: 2,
      readyToAccept: 1,
      decided: 1,
    });
  });
});

describe("invoiceChanges", () => {
  const M3 = "sku-air-m3";

  it("says nothing when the delivery matches the invoice", () => {
    const rows = receivingRows(po(fiveM1()), []);
    expect(invoiceChanges(rows)).toEqual({ changes: [], flagged: new Set() });
  });

  it("does not flag two rows that swapped products", () => {
    // Owner, 2026-09-18: the prices were typed against the wrong products and
    // the names were swapped to put them right. "That is a price correction
    // and is not a change in unit, you should not flag it."
    const invoice = po([
      piece("a", { serial: "SC02A", unitCost: 10_000_000 }),
      piece("b", { skuId: M2, serial: "SC02B", unitCost: 12_000_000 }),
    ]);
    const rows = receivingRows(invoice, [
      unit({ serial: "SC02A", skuId: M2 }),
      unit({ serial: "SC02B", skuId: M1 }),
    ]);
    // Each row still knows it changed — the page says what it was.
    expect(rows.map(isDifferentProduct)).toEqual([true, true]);
    expect(invoiceChanges(rows)).toEqual({ changes: [], flagged: new Set() });
  });

  it("names the old product and the new one, once per machine", () => {
    const invoice = po([
      piece("a", { serial: "SC02A" }),
      piece("b", { serial: "SC02B" }),
      piece("c", { serial: "SC02C" }),
    ]);
    const rows = receivingRows(invoice, [
      unit({ serial: "SC02A" }),
      unit({ serial: "SC02B", skuId: M2 }),
      unit({ serial: "SC02C", skuId: M2 }),
    ]);
    const { changes, flagged } = invoiceChanges(rows);
    expect(changes).toEqual([{ invoiced: M1, received: M2, count: 2 }]);
    expect([...flagged]).toEqual(["b", "c"]);
  });

  it("nets a chain of changes to where it really ended", () => {
    // M1 became an M2 on one row and that row's M2 an M3 on another: one M1
    // short and one M3 over, and the M2 in the middle is balanced.
    const invoice = po([
      piece("a", { serial: "SC02A" }),
      piece("b", { skuId: M2, serial: "SC02B" }),
    ]);
    const rows = receivingRows(invoice, [
      unit({ serial: "SC02A", skuId: M2 }),
      unit({ serial: "SC02B", skuId: M3 }),
    ]);
    expect(invoiceChanges(rows).changes).toEqual([
      { invoiced: M1, received: M3, count: 1 },
    ]);
  });

  it("counts a product changed before its serial was read", () => {
    // The page knows a waiting row's product before the unit exists.
    const rows = receivingRows(po([piece("a"), piece("b")]), []);
    const { changes, flagged } = invoiceChanges(rows, (r) =>
      r.key === "b" ? M2 : r.expectedSkuId,
    );
    expect(changes).toEqual([{ invoiced: M1, received: M2, count: 1 }]);
    expect([...flagged]).toEqual(["b"]);
  });

  it("lists the machines that never came and the ones nobody invoiced", () => {
    const invoice = po([
      piece("a", { serial: "SC02A" }),
      piece("b", { notReceived: true }),
    ]);
    const rows = receivingRows(invoice, [
      unit({ serial: "SC02A" }),
      unit({ serial: "SC02X", skuId: M2 }),
    ]);
    expect(invoiceChanges(rows).changes).toEqual([
      { invoiced: M1, received: null, count: 1 },
      { invoiced: null, received: M2, count: 1 },
    ]);
  });
});
