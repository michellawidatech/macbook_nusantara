/**
 * Taking a recorded return back (owner ask 2026-09-25: *"add a delete / edit
 * button in return row"*).
 *
 * What is pinned here is the REFUSALS, because they are the whole design: the
 * undo restores the bill and lets the debt re-derive, and every case where it
 * cannot prove what to restore has to decline rather than guess. A money
 * reversal that is quietly wrong is worse than one that says no.
 */
import { describe, expect, it } from "vitest";
import {
  applyReturnEdit,
  canUndoReturn,
  enteredPayments,
  salesOfCodes,
  type UndoRec,
  type UndoSale,
  type UndoUnit,
} from "../src/lib/returnUndo.js";

const SERIAL = "C02740137JKM";

const rec = (over: Partial<UndoRec> = {}): UndoRec => ({
  id: "ret-1",
  code: "SG-2026/09-000001",
  kind: "CUSTOMER",
  serial: SERIAL,
  status: "ARRIVED",
  ...over,
});

const sale = (over: Partial<UndoSale> = {}): UndoSale => ({
  id: "o-1",
  code: "SI-2026/09-000001",
  ts: "2026-09-20T02:00:00.000Z",
  source: "TOKO",
  payments: [{ state: "SETTLED" }],
  adjustments: [{ type: "RETUR", code: "SG-2026/09-000001" }],
  ...over,
});

const shelf = (status = "TERSEDIA"): Map<string, UndoUnit> =>
  new Map([[SERIAL, { serial: SERIAL, status }]]);

describe("canUndoReturn", () => {
  it("allows a plain customer return whose unit is still on the shelf", () => {
    expect(
      canUndoReturn({ recs: [rec()], sales: [sale()], units: shelf() }),
    ).toEqual({ ok: true });
  });

  it("allows a supplier return whose unit has not come back", () => {
    expect(
      canUndoReturn({
        recs: [rec({ kind: "SUPPLIER" })],
        sales: [],
        units: shelf("RETUR_SUPPLIER"),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses once the unit has been sold again", () => {
    // The commonest way an undo would be wrong: somebody else took the
    // decision this would silently overwrite.
    expect(
      canUndoReturn({
        recs: [rec()],
        sales: [sale()],
        units: shelf("TERJUAL"),
      }),
    ).toEqual({ ok: false, why: "UNIT_MOVED" });
  });

  it("refuses a unit that has gone to service or been reserved", () => {
    for (const status of ["SERVIS", "DIRESERVASI", "HILANG", "QC"]) {
      expect(
        canUndoReturn({ recs: [rec()], sales: [sale()], units: shelf(status) }),
      ).toEqual({ ok: false, why: "UNIT_MOVED" });
    }
  });

  it("refuses a supplier return whose unit is already back in stock", () => {
    expect(
      canUndoReturn({
        recs: [rec({ kind: "SUPPLIER" })],
        sales: [],
        units: shelf("TERSEDIA"),
      }),
    ).toEqual({ ok: false, why: "UNIT_MOVED" });
  });

  it("refuses an exchange — the money moved between sales as copies", () => {
    expect(
      canUndoReturn({
        recs: [rec({ exchangeSerial: "C02999999ABC" })],
        sales: [sale()],
        units: shelf(),
      }),
    ).toEqual({ ok: false, why: "EXCHANGE" });
  });

  it("refuses a marketplace sale — nothing says what pending money was cut", () => {
    expect(
      canUndoReturn({
        recs: [rec()],
        sales: [sale({ source: "SHOPEE" })],
        units: shelf(),
      }),
    ).toEqual({ ok: false, why: "MARKETPLACE" });
  });

  it("refuses a sale still holding a pending part, whatever its channel", () => {
    expect(
      canUndoReturn({
        recs: [rec()],
        sales: [sale({ payments: [{ state: "PENDING" }] })],
        units: shelf(),
      }),
    ).toEqual({ ok: false, why: "MARKETPLACE" });
  });

  it("is not refused by a book closed before the close was retired (2026-10-27)", () => {
    expect(
      canUndoReturn({
        recs: [rec()],
        sales: [sale({ settled: true })],
        units: shelf(),
        settings: { booksClosedAt: "2026-09-30T16:59:59.999Z" },
      }),
    ).not.toEqual({ ok: false, why: "BOOKS_CLOSED" });
  });

  it("refuses a row whose documents are all withdrawn already", () => {
    expect(
      canUndoReturn({
        recs: [rec({ status: "CANCELLED" })],
        sales: [sale()],
        units: shelf(),
      }),
    ).toEqual({ ok: false, why: "ALREADY_CANCELLED" });
  });

  it("judges every unit of a row, not just the first", () => {
    const other = "C02740137JKN";
    const units = shelf();
    units.set(other, { serial: other, status: "TERJUAL" });
    expect(
      canUndoReturn({
        recs: [rec(), rec({ id: "ret-2", serial: other })],
        sales: [sale()],
        units,
      }),
    ).toEqual({ ok: false, why: "UNIT_MOVED" });
  });
});

describe("enteredPayments", () => {
  it("drops the derived shortfall so the bill can derive a new one", () => {
    // `withOwed` appends this row from the bill; keeping it across an undo
    // that RAISES the bill would leave the old, too-small debt on the sale.
    const rows = [
      { id: "pay-1", state: "SETTLED" },
      { id: "o-1-owed", state: "DUE" },
    ];
    expect(enteredPayments("o-1", rows)).toEqual([
      { id: "pay-1", state: "SETTLED" },
    ]);
  });

  it("keeps a DUE row somebody entered by hand", () => {
    const rows = [{ id: "pay-9", state: "DUE" }];
    expect(enteredPayments("o-1", rows)).toEqual(rows);
  });
});

describe("salesOfCodes", () => {
  it("finds the sales a return's codes credited", () => {
    const a = sale();
    const b = sale({
      id: "o-2",
      adjustments: [{ type: "RETUR", code: "SG-2026/09-000002" }],
    });
    const c = sale({ id: "o-3", adjustments: [{ type: "DISKON", code: "x" }] });
    expect(salesOfCodes([a, b, c], ["SG-2026/09-000001"])).toEqual([a]);
    expect(
      salesOfCodes([a, b, c], ["SG-2026/09-000001", "SG-2026/09-000002"]),
    ).toEqual([a, b]);
  });
});

describe("applyReturnEdit", () => {
  const full = { ...rec(), date: "2026-09-20", reason: "Rusak" };

  it("corrects when, why and the condition", () => {
    const out = applyReturnEdit(full, {
      date: "2026-09-21",
      reason: "Salah kirim",
      grades: { [SERIAL]: "B" },
    });
    expect(out.date).toBe("2026-09-21");
    expect(out.reason).toBe("Salah kirim");
    expect(out.afterGrade).toBe("B");
  });

  it("leaves the condition alone when the edit names no grade for it", () => {
    const out = applyReturnEdit(
      { ...full, afterGrade: "A" },
      {
        date: "2026-09-21",
        reason: "Rusak",
      },
    );
    expect(out.afterGrade).toBe("A");
  });

  it("clears a detail that was typed and then emptied", () => {
    const out = applyReturnEdit(
      { ...full, reasonDetail: "was here" },
      {
        date: "2026-09-20",
        reason: "Rusak",
      },
    );
    expect(out.reasonDetail).toBeUndefined();
  });

  it("never touches which unit came back", () => {
    const out = applyReturnEdit(full, { date: "2026-09-21", reason: "x" });
    expect(out.serial).toBe(SERIAL);
    expect(out.code).toBe(full.code);
  });
});
