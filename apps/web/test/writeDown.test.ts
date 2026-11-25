/**
 * A unit's value written down while held (owner ask 2026-11-24) —
 * `lib/writeDown.ts`, the cost in `lib/service.ts` and the P&L line.
 */
import { describe, expect, it } from "vitest";
import { monthPeriod, profitLoss } from "../src/lib/profitLoss.js";
import { costBreakdown, costIndex } from "../src/lib/service.js";
import {
  rowLocked,
  writeDownAt,
  writeDownBlock,
  writeDownProblem,
  writeDownsOf,
} from "../src/lib/writeDown.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb, WriteDown } from "../src/mock/seed.js";

const JAN = monthPeriod(new Date(2030, 0, 15));
const FEB = monthPeriod(new Date(2030, 1, 15));
const at = (m: number, d: number) => new Date(2030, m, d, 10).toISOString();
const day = (m: number, d: number) =>
  `2030-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function empty(): MockDb {
  const db = structuredClone(getDb());
  db.orders = [];
  db.expenses = [];
  db.incomes = [];
  db.settlements = [];
  db.returns = [];
  db.writeDowns = [];
  return db;
}

const wd = (
  serial: string,
  amount: number,
  m: number,
  d: number,
): WriteDown => ({
  id: `wd-${serial}-${m}-${d}`,
  serial,
  amount,
  reason: "Layar retak",
  date: day(m, d),
  staff: "Test",
  createdAt: at(m, d),
  updatedAt: at(m, d),
});

const event = (
  serial: string,
  type: string,
  when: string,
  fromStatus: string,
  toStatus: string,
) =>
  ({
    id: `ev-${serial}-${type}-${when}`,
    serial,
    seq: 99,
    type,
    at: when,
    fromStatus,
    toStatus,
    locationId: "wh-1",
  }) as MockDb["events"][number];

const sale = (
  id: string,
  serial: string,
  ts: string,
  price: number,
): MockDb["orders"][number] =>
  ({
    id,
    code: `SI-${id}`,
    ts,
    customerId: null,
    serials: [serial],
    prices: { [serial]: price },
    listPrices: { [serial]: price },
    discount: 0,
    source: "OFFLINE" as never,
    payMethod: "TUNAI",
    settled: true,
    total: price,
  }) as MockDb["orders"][number];

const line = (r: ReturnType<typeof profitLoss>, key: string) =>
  [...r.cogs, ...r.otherExpense].find((l) => l.key === key)!;

describe("the rules", () => {
  it("writes down only a unit the shop still holds", () => {
    for (const s of ["QC", "TERSEDIA", "DIRESERVASI", "SERVIS"])
      expect(writeDownBlock(s)).toBeUndefined();
    for (const s of ["TERJUAL", "HILANG", "RETUR_SUPPLIER"])
      expect(writeDownBlock(s)).toBe("LEFT");
  });

  it("asks for an amount and a reason, and never goes below zero — against the cost without this row", () => {
    expect(writeDownProblem(null, "x", 1_000)).toBe("AMOUNT");
    expect(writeDownProblem(0, "x", 1_000)).toBe("AMOUNT");
    expect(writeDownProblem(100, "  ", 1_000)).toBe("REASON");
    expect(writeDownProblem(1_001, "x", 1_000)).toBe("BELOW_ZERO");
    expect(writeDownProblem(1_000, "x", 1_000)).toBeUndefined();
  });

  it("locks a row once an exit follows it, even if the unit came back", () => {
    const row = wd("S1", 100, 0, 5);
    expect(rowLocked(row, [])).toBe(false);
    expect(
      rowLocked(row, [
        event("S1", "DICATAT", at(0, 6), "TERSEDIA", "TERSEDIA"),
      ]),
    ).toBe(false);
    expect(
      rowLocked(row, [event("S1", "TERJUAL", at(0, 6), "TERSEDIA", "TERJUAL")]),
    ).toBe(true);
    // An exit BEFORE the row does not lock it.
    expect(
      rowLocked(row, [event("S1", "TERJUAL", at(0, 4), "TERSEDIA", "TERJUAL")]),
    ).toBe(false);
  });
});

describe("the cost", () => {
  it("takes the write-downs off the unit's COGS, and lists them newest first", () => {
    const db = empty();
    const unit = db.units[0]!;
    const before = costBreakdown(unit, db).total;
    db.writeDowns.push(
      wd(unit.serial, 500_000, 0, 5),
      wd(unit.serial, 200_000, 0, 9),
    );
    const after = costBreakdown(unit, db);
    expect(after.writeDown).toBe(700_000);
    expect(after.total).toBe(before - 700_000);
    expect(costIndex(db)(unit)).toEqual(after);
    expect(writeDownsOf(unit.serial, db).map((w) => w.amount)).toEqual([
      200_000, 500_000,
    ]);
  });

  it("starts clean after a buy-back, as repairs do", () => {
    const db = empty();
    const unit = db.units[0]!;
    db.writeDowns.push(wd(unit.serial, 500_000, 0, 5));
    db.events.push(event(unit.serial, "DITERIMA", at(0, 20), "TERJUAL", "QC"));
    expect(costBreakdown(unit, db).writeDown).toBe(0);
    expect(writeDownsOf(unit.serial, db)).toEqual([]);
  });

  it("reads the write-down as it stood at a moment", () => {
    const rows = [wd("S1", 100, 0, 5), wd("S1", 50, 1, 5)];
    const events = [event("S1", "DITERIMA", at(0, 20), "TERJUAL", "QC")];
    const asOf = writeDownAt(rows, events);
    expect(asOf("S1", at(0, 1))).toBe(0);
    expect(asOf("S1", at(0, 10))).toBe(100);
    // After the buy-back only what came after it.
    expect(asOf("S1", at(1, 10))).toBe(50);
  });
});

describe("profit & loss", () => {
  it("puts the write-down on its own line in its month, and the later sale's HPP is the lowered cost", () => {
    const db = empty();
    const unit = db.units.find((u) => u.status === "TERSEDIA")!;
    const full = costBreakdown(unit, db).total;
    db.writeDowns.push(wd(unit.serial, 500_000, 0, 5));
    db.orders.push(sale("o1", unit.serial, at(1, 3), 12_000_000));

    const jan = profitLoss(db, JAN);
    expect(line(jan, "writeDown").amount).toBe(500_000);
    expect(line(jan, "writeDown").items[0]).toMatchObject({
      ref: unit.serial,
      amount: 500_000,
    });
    expect(line(jan, "writeDown").items[0]!.description).toContain(
      "Layar retak",
    );
    const feb = profitLoss(db, FEB);
    expect(line(feb, "cogsSold").amount).toBe(full - 500_000);
    expect(line(feb, "writeDown").amount).toBe(0);
    // Counted once across the two months: the unlowered cost.
    expect(line(jan, "writeDown").amount + line(feb, "cogsSold").amount).toBe(
      full,
    );
  });

  it("leaves a sale's HPP alone when the unit is bought back and written down again", () => {
    const db = empty();
    const unit = db.units.find((u) => u.status === "TERSEDIA")!;
    db.writeDowns.push(wd(unit.serial, 500_000, 0, 5));
    db.orders.push(sale("o1", unit.serial, at(0, 10), 12_000_000));
    db.events.push(
      event(unit.serial, "TERJUAL", at(0, 10), "TERSEDIA", "TERJUAL"),
    );
    const first = line(profitLoss(db, JAN), "cogsSold").amount;

    db.events.push(event(unit.serial, "DITERIMA", at(1, 1), "TERJUAL", "QC"));
    db.writeDowns.push(wd(unit.serial, 300_000, 1, 5));
    expect(line(profitLoss(db, JAN), "cogsSold").amount).toBe(first);
    expect(line(profitLoss(db, FEB), "writeDown").amount).toBe(300_000);
  });

  it("does not count a lost unit's write-down twice", () => {
    const db = empty();
    const unit = db.units.find((u) => u.status === "TERSEDIA")!;
    const full = costBreakdown(unit, db).total;
    db.writeDowns.push(wd(unit.serial, 400_000, 0, 5));
    db.events.push(
      event(unit.serial, "HILANG", at(1, 2), "TERSEDIA", "HILANG"),
    );
    const jan = line(profitLoss(db, JAN), "writeDown").amount;
    const febLost = line(profitLoss(db, FEB), "stockAdjust").items.find((i) =>
      i.description.includes(unit.serial),
    )!.amount;
    expect(jan + febLost).toBe(full);
  });
});
