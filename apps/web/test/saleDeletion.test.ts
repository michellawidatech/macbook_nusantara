/**
 * Deleting a sale, and deleting one row of a unit's history (owner ask
 * 2026-10-22) — `lib/saleDeletion.ts` is the rule; this is its spec. Run on
 * copies of the demo store, so nothing here leaks into another file.
 */
import { describe, expect, it } from "vitest";
import {
  deleteSale,
  historyRowBlock,
  saleDeletionBlock,
  takeUnitOffSale,
} from "../src/lib/saleDeletion.js";
import { appendEvent, getDb, removeEvent } from "../src/mock/store.js";
import type { MockDb, Order } from "../src/mock/seed.js";

const copy = (): MockDb => structuredClone(getDb());

const historyOf = (db: MockDb, serial: string) =>
  db.events.filter((e) => e.serial === serial).sort((a, b) => a.seq - b.seq);

/** A seed sale nothing has happened to since: plain units, nothing back. */
function plainSale(db: MockDb): Order {
  const o = db.orders.find(
    (x) =>
      x.serials.length > 0 &&
      (x.lines?.length ?? 0) === 0 &&
      saleDeletionBlock(db, x) === undefined,
  );
  expect(o).toBeDefined();
  return o!;
}

const opts = () => {
  let n = 0;
  return {
    staff: "Test",
    now: "2026-10-22T05:00:00.000Z",
    nextMoveId: () => `sm-del-${(n += 1)}`,
  };
};

describe("deleting a sale", () => {
  it("removes it and puts each unit back as its history was before the sale", () => {
    const db = copy();
    const sale = plainSale(db);
    const before = new Map(
      sale.serials.map((s) => [s, historyOf(db, s).at(-2)!]),
    );
    const rows = new Map(sale.serials.map((s) => [s, historyOf(db, s).length]));

    expect(deleteSale(db, sale.id, opts())).toBe(true);

    expect(db.orders.some((o) => o.id === sale.id)).toBe(false);
    for (const s of sale.serials) {
      const unit = db.units.find((u) => u.serial === s)!;
      expect(unit.status).toBe(before.get(s)!.toStatus);
      expect(unit.locationId).toBe(before.get(s)!.locationId);
      expect(historyOf(db, s)).toHaveLength(rows.get(s)! - 1);
      expect(
        historyOf(db, s).some(
          (e) => e.type === "TERJUAL" && e.refCode === sale.code,
        ),
      ).toBe(false);
    }
  });

  it("takes every row the sale wrote, even one after the sold row (2026-10-23)", () => {
    // Owner report: a deleted sale left C02D503ZM6KJ Sold — a note the sale
    // wrote after the sold row hid the sold row from the delete.
    const db = copy();
    const sale = plainSale(db);
    const serial = sale.serials[0]!;
    const before = historyOf(db, serial).at(-2)!;
    appendEvent(
      db,
      serial,
      { type: "DICATAT", note: "payout", refCode: sale.code },
      "Test",
    );
    expect(saleDeletionBlock(db, sale)).toBeUndefined();
    expect(deleteSale(db, sale.id, opts())).toBe(true);
    const unit = db.units.find((u) => u.serial === serial)!;
    expect(unit.status).toBe(before.toStatus);
    expect(historyOf(db, serial).some((e) => e.refCode === sale.code)).toBe(
      false,
    );
  });

  it("refuses when another document wrote on the unit after the sale", () => {
    const db = copy();
    const sale = plainSale(db);
    appendEvent(
      db,
      sale.serials[0]!,
      { type: "DICATAT", note: "elsewhere", refCode: "SG-X" },
      "Test",
    );
    expect(saleDeletionBlock(db, sale)).toBe("UNIT_MOVED");
  });

  it("puts a counted piece back with an opposite move, never by removing the sale's", () => {
    const db = copy();
    const sale = plainSale(db);
    db.stockMoves.push({
      id: "sm-sold",
      skuId: "acc",
      locationId: "wh-1",
      qty: -2,
      cost: 50_000,
      type: "TERJUAL",
      at: sale.ts,
      orderId: sale.id,
      refCode: sale.code,
      staff: "Test",
    });
    expect(deleteSale(db, sale.id, opts())).toBe(true);
    expect(db.stockMoves.find((m) => m.id === "sm-sold")).toBeDefined();
    const back = db.stockMoves.filter(
      (m) => m.type === "KOREKSI" && m.refCode === sale.code,
    );
    expect(back).toHaveLength(1);
    expect(back[0]!.qty).toBe(2);
    expect(back[0]!.orderId).toBeUndefined();
  });

  it("frees a redeemed discount", () => {
    const db = copy();
    const sale = plainSale(db);
    const discount = db.discounts[0]!;
    discount.used = 3;
    sale.discountId = discount.id;
    expect(deleteSale(db, sale.id, opts())).toBe(true);
    expect(db.discounts[0]!.used).toBe(2);
  });

  it("deletes a settled sale in a month an old book close had closed (retired 2026-10-27)", () => {
    // A shop that closed a month before the book close was retired still has
    // `booksClosedAt` stored. It is ignored: reconciliation flags an edited
    // period instead of refusing the edit.
    const db = copy();
    const sale = plainSale(db);
    sale.settled = true;
    sale.payments = [
      {
        id: "pay-settled",
        method: "TUNAI",
        amount: sale.total,
        state: "SETTLED",
        at: sale.ts,
      },
    ];
    db.settings = {
      ...db.settings,
      booksClosedAt: "2099-12-31T16:59:59.999Z",
    };
    expect(saleDeletionBlock(db, sale)).toBeUndefined();
    expect(deleteSale(db, sale.id, opts())).toBe(true);
    expect(db.orders.some((o) => o.id === sale.id)).toBe(false);
  });

  it("refuses a sale with a return, a trade-in, or a unit that moved on", () => {
    const db = copy();
    const sale = plainSale(db);
    expect(
      saleDeletionBlock(db, {
        ...sale,
        adjustments: [
          { id: "adj", type: "RETUR", amount: 1, reason: "x", at: sale.ts },
        ] as Order["adjustments"],
      }),
    ).toBe("RETURNED");
    expect(
      saleDeletionBlock(db, {
        ...sale,
        tradeIns: [{ id: "ti", label: "x", value: 1 }] as Order["tradeIns"],
      }),
    ).toBe("TRADE_IN");
    appendEvent(db, sale.serials[0]!, { type: "DICATAT", note: "moved on" });
    expect(saleDeletionBlock(db, sale)).toBe("UNIT_MOVED");
  });

  it("refuses a sale an Income & Expense line names", () => {
    const db = copy();
    const sale = plainSale(db);
    db.expenses.push({ ...db.expenses[0]!, id: "ex-link", orderId: sale.id });
    expect(saleDeletionBlock(db, sale)).toBe("LINKED_MONEY");
  });
});

describe("deleting one row of a unit's history", () => {
  it("keeps a live sale's sold row and a unit's last row", () => {
    const db = copy();
    const sale = plainSale(db);
    const serial = sale.serials[0]!;
    const sold = historyOf(db, serial).at(-1)!;
    expect(historyRowBlock(db, sold)).toBe("LIVE_SALE");

    const lone = db.units.find((u) => historyOf(db, u.serial).length === 1);
    if (lone)
      expect(historyRowBlock(db, historyOf(db, lone.serial)[0]!)).toBe(
        "ONLY_ROW",
      );
  });

  it("takes a row out of the middle and leaves the unit where it is", () => {
    const db = copy();
    const unit = db.units.find((u) => historyOf(db, u.serial).length >= 3)!;
    const rows = historyOf(db, unit.serial);
    const middle = rows[1]!;
    const status = unit.status;
    expect(historyRowBlock(db, middle)).toBeUndefined();
    expect(removeEvent(db, middle.id)).toBe(true);
    expect(historyOf(db, unit.serial)).toHaveLength(rows.length - 1);
    expect(db.units.find((u) => u.serial === unit.serial)!.status).toBe(status);

    // The next row follows the newest, not the count — the store refuses a
    // number that is already taken.
    appendEvent(db, unit.serial, { type: "DICATAT", note: "after a gap" });
    const after = historyOf(db, unit.serial);
    expect(after.at(-1)!.seq).toBe(rows.at(-1)!.seq + 1);
  });

  it("taking the newest row puts the unit back to the row before it", () => {
    const db = copy();
    const unit = db.units.find(
      (u) =>
        u.status !== "TERJUAL" &&
        historyOf(db, u.serial).length >= 2 &&
        historyOf(db, u.serial).at(-1)!.type !== "TERJUAL",
    )!;
    const rows = historyOf(db, unit.serial);
    const newest = rows.at(-1)!;
    const prev = rows.at(-2)!;
    expect(removeEvent(db, newest.id)).toBe(true);
    const now = db.units.find((u) => u.serial === unit.serial)!;
    expect(now.status).toBe(prev.toStatus);
    expect(now.locationId).toBe(prev.locationId);
  });
});

describe("the rows a document stands on (audit 2026-10-23)", () => {
  const shelfUnit = (db: MockDb) =>
    db.units.find(
      (u) => u.status === "TERSEDIA" && historyOf(db, u.serial).length >= 2,
    )!;

  it("keeps the newest hold row; a middle one may go", () => {
    const db = copy();
    const unit = shelfUnit(db);
    appendEvent(
      db,
      unit.serial,
      { type: "DIRESERVASI", toStatus: "DIRESERVASI", refCode: "RV-X" },
      "Test",
    );
    const hold = historyOf(db, unit.serial).at(-1)!;
    expect(historyRowBlock(db, hold)).toBe("DOCUMENT_ROW");
    appendEvent(db, unit.serial, { type: "DICATAT", note: "a note" }, "Test");
    expect(historyRowBlock(db, hold)).toBeUndefined();
  });

  it("keeps an exchange replacement's sold row, which names the return", () => {
    const db = copy();
    const sale = plainSale(db);
    const unit = shelfUnit(db);
    sale.serials.push(unit.serial);
    appendEvent(
      db,
      unit.serial,
      { type: "TERJUAL", toStatus: "TERJUAL", refCode: "SG-X" },
      "Test",
    );
    expect(historyRowBlock(db, historyOf(db, unit.serial).at(-1)!)).toBe(
      "LIVE_SALE",
    );
  });

  it("a unit sold out of a hold and taken off the sale is held again", () => {
    const db = copy();
    const unit = shelfUnit(db);
    appendEvent(
      db,
      unit.serial,
      { type: "DIRESERVASI", toStatus: "DIRESERVASI", refCode: "RV-X" },
      "Test",
    );
    appendEvent(
      db,
      unit.serial,
      { type: "TERJUAL", toStatus: "TERJUAL", refCode: "SI-X" },
      "Test",
    );
    db.reservations.push({
      id: "res-x",
      code: "RV-X",
      customerId: db.customers[0]!.id,
      when: "2026-10-23T05:00:00.000Z",
      note: "",
      items: [{ id: "ri-x", serial: unit.serial }],
      status: "DONE",
    });
    expect(takeUnitOffSale(db, unit.serial, "SI-X")).toBe(true);
    expect(db.units.find((u) => u.serial === unit.serial)!.status).toBe(
      "DIRESERVASI",
    );
    expect(db.reservations.find((r) => r.id === "res-x")!.status).toBe(
      "ACTIVE",
    );
  });
});
