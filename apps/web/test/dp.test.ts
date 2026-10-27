/**
 * A DP holds a unit (owner, 2026-10-27, "yes to DP") — `lib/dp.ts`, and what
 * the money screens make of it. The claim that matters most: the DP is
 * counted ONCE — in the cash balance on the day it came in, never again at
 * the sale that takes it — and it is never revenue until a sale is.
 *
 * A copy of the demo store with its money emptied, so every figure below is
 * put there by the test.
 */
import { describe, expect, it } from "vitest";
import {
  dpRule,
  dpStage,
  dpToApply,
  keepDp,
  recordDp,
  recordDpBlock,
  refundDp,
} from "../src/lib/dp.js";
import {
  dpOpen,
  headerState,
  heldItems,
  itemState,
  softHolds,
} from "../src/lib/reservations.js";
import { balancesOfRows, cashflowRows } from "../src/lib/cashflowRows.js";
import { monthPeriod, profitLoss } from "../src/lib/profitLoss.js";
import { isSettled } from "../src/lib/salePayments.js";
import { makeT } from "../src/i18n/translate.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const t = makeT("en");
const RV = "rv-dp";
const CODE = "RV-2030/01-000001";
const SERIAL = "DPTEST0000001";
const PAID = new Date(2030, 0, 10, 10).toISOString();
const MONTH = monthPeriod(new Date(2030, 0, 15));

/** The browser's `appendEvent`, kept pure for a test. */
function appendEvent(
  d: MockDb,
  serial: string,
  ev: { type: string; toStatus?: string; refCode?: string; note?: string },
) {
  const unit = d.units.find((u) => u.serial === serial)!;
  d.events.push({
    id: `ev-${d.events.length}`,
    serial,
    seq: d.events.filter((e) => e.serial === serial).length + 1,
    type: ev.type,
    at: PAID,
    fromStatus: unit.status,
    toStatus: ev.toStatus ?? unit.status,
    locationId: unit.locationId,
    refCode: ev.refCode,
    staff: "Test",
  });
  if (ev.toStatus) unit.status = ev.toStatus as typeof unit.status;
}

/** A soft hold: one unit on sale, reserved for the first customer. */
function shop(): MockDb {
  const db = structuredClone(getDb());
  db.orders = [];
  db.expenses = [];
  db.incomes = [];
  db.settlements = [];
  db.returns = [];
  db.deposits = [];
  db.pos = db.pos.map((p) => ({ ...p, payments: [] }));
  db.customers = db.customers.map((c) => ({ ...c, openingPayments: [] }));
  db.reservations = [];
  db.settings = { ...db.settings, openingCash: 0, openingBank: 0 };
  delete db.settings.openingBalanceAt;
  db.units.push({
    serial: SERIAL,
    skuId: db.skus[0]!.id,
    status: "TERSEDIA",
    locationId: db.warehouses[0]!.id,
    buy: 8_000_000,
    description: "Mulus",
    poId: null,
    grade: "A",
  });
  db.reservations.push({
    id: RV,
    code: CODE,
    customerId: db.customers[0]!.id,
    when: PAID,
    note: "",
    items: [{ id: "rvi-dp", serial: SERIAL }],
    status: "ACTIVE",
  });
  return db;
}

const hold = (db: MockDb) => db.reservations.find((r) => r.id === RV)!;
const unit = (db: MockDb) => db.units.find((u) => u.serial === SERIAL)!;

function withDp(db: MockDb = shop()): MockDb {
  recordDp(
    db,
    RV,
    { id: "pay-dp", amount: 500_000, method: "TRANSFER", at: PAID },
    dpRule(db.settings),
    appendEvent,
  );
  return db;
}

/** The sale that takes the hold's unit, paying the rest in cash. */
function sell(db: MockDb, total = 10_000_000) {
  const r = hold(db);
  const dp = dpToApply(r)!;
  const rest = {
    id: "pay-rest",
    method: "TUNAI",
    amount: total - dp.amount,
    state: "SETTLED" as const,
    at: new Date(2030, 0, 12, 10).toISOString(),
  };
  db.orders.push({
    id: "o-dp",
    code: "SI-2030/01-000001",
    ts: rest.at,
    customerId: r.customerId,
    serials: [SERIAL],
    prices: { [SERIAL]: total },
    listPrices: { [SERIAL]: total },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    payments: [dp, rest],
    settled: isSettled(total, [dp, rest]),
    total,
    reservationId: RV,
  });
  r.dp!.orderId = "o-dp";
  appendEvent(db, SERIAL, {
    type: "TERJUAL",
    toStatus: "TERJUAL",
    refCode: "SI-2030/01-000001",
  });
  r.status = headerState(db, r);
}

/** What the balance says the shop holds, cash and bank, cash basis. */
const balance = (db: MockDb) =>
  balancesOfRows(cashflowRows(db, t), db.settings);

describe("only a DP holds a unit", () => {
  it("leaves a hold nobody paid for on sale, tagged for the customer", () => {
    const db = shop();
    expect(itemState(db, hold(db).items[0]!, hold(db))).toBe("SOFT");
    expect(unit(db).status).toBe("TERSEDIA");
    expect(softHolds(db).get(SERIAL)?.id).toBe(RV);
    // Still wanted, so still open.
    expect(headerState(db, hold(db))).toBe("ACTIVE");
    expect(heldItems(db, hold(db)).map((i) => i.serial)).toEqual([SERIAL]);
  });

  it("holds firmly once a DP is recorded: the ledger row and the end date", () => {
    const db = withDp();
    expect(unit(db).status).toBe("DIRESERVASI");
    expect(
      db.events.filter((e) => e.serial === SERIAL).map((e) => e.refCode),
    ).toEqual([CODE]);
    expect(hold(db).heldUntil).toBe(
      new Date(new Date(PAID).getTime() + 7 * 86_400_000).toISOString(),
    );
    expect(hold(db).dp).toMatchObject({ amount: 500_000, method: "TRANSFER" });
    expect(dpStage(db, hold(db), new Date(2030, 0, 11))).toBe("HOLDING");
    expect(softHolds(db).has(SERIAL)).toBe(false);
    // One DP a hold.
    expect(recordDpBlock(db, hold(db))).toBe("HAS_DP");
  });

  it("follows the DP rule in Settings", () => {
    expect(dpRule({})).toEqual({ amount: 500_000, days: 7 });
    expect(dpRule({ dpAmount: 1_000_000, dpDays: 3 })).toEqual({
      amount: 1_000_000,
      days: 3,
    });
    expect(dpRule({ dpAmount: 0, dpDays: 1.5 })).toEqual({
      amount: 500_000,
      days: 7,
    });
  });

  it("waits for staff once the hold is over — it never closes itself", () => {
    const db = withDp();
    // The worker released the unit after the days ran out.
    appendEvent(db, SERIAL, {
      type: "RESERVASI_BATAL",
      toStatus: "TERSEDIA",
      refCode: CODE,
    });
    hold(db).status = headerState(db, hold(db));
    expect(hold(db).status).toBe("ACTIVE");
    expect(dpOpen(hold(db))).toBe(true);
    expect(dpStage(db, hold(db))).toBe("DECIDE");
    // Released from a firm hold, it is not softly reserved again.
    expect(itemState(db, hold(db).items[0]!, hold(db))).toBe("RELEASED");
  });
});

describe("the DP is counted once", () => {
  it("is money in on the day it came in, in its own pot, and not revenue", () => {
    const db = withDp();
    const rows = cashflowRows(db, t).filter((r) => r.orderCode === CODE);
    expect(rows.map((r) => [r.category, r.amount, r.at])).toEqual([
      ["DP", 500_000, PAID],
    ]);
    expect(balance(db)).toMatchObject({ cash: 0, bank: 500_000 });
    // A liability until a sale takes it: no revenue, no other income.
    const r = profitLoss(db, MONTH);
    expect(r.totalRevenue).toBe(0);
    expect(r.otherIncome.find((l) => l.key === "dpForfeited")!.amount).toBe(0);
  });

  it("is the same payment once the sale takes it — never a second time", () => {
    const db = withDp();
    sell(db);
    const order = db.orders[0]!;
    expect(order.settled).toBe(true);
    expect(order.payments!.map((p) => [p.id, p.reservationId])).toEqual([
      ["pay-dp", RV],
      ["pay-rest", undefined],
    ]);
    expect(hold(db).status).toBe("DONE");
    expect(dpStage(db, hold(db))).toBe("APPLIED");

    const dpRows = cashflowRows(db, t).filter(
      (r) => r.category === "DP" || r.category === "DP_HANGUS",
    );
    // One row for the DP — from the sale now, the reservation's listing gone.
    expect(dpRows.map((r) => [r.key, r.amount, r.at])).toEqual([
      ["p-o-dp-pay-dp", 500_000, PAID],
    ]);
    // Bank 500.000 (the DP's day) + cash 9.500.000 (the rest): the sale's
    // total and not a rupiah more.
    expect(balance(db)).toMatchObject({ cash: 9_500_000, bank: 500_000 });
    // Revenue is the sale, as before — the DP only paid part of it.
    const r = profitLoss(db, MONTH);
    expect(r.totalRevenue).toBe(10_000_000);
    expect(r.otherIncome.find((l) => l.key === "dpForfeited")!.amount).toBe(0);
  });

  it("refunds out of the pot named, and nets to nothing", () => {
    const db = withDp();
    expect(
      refundDp(
        db,
        RV,
        { id: "pay-dp-back", method: "TRANSFER", at: PAID },
        appendEvent,
      ),
    ).toBe(true);
    expect(hold(db).status).toBe("CANCELLED");
    expect(unit(db).status).toBe("TERSEDIA");
    expect(dpStage(db, hold(db))).toBe("REFUNDED");
    const rows = cashflowRows(db, t).filter((r) => r.orderCode === CODE);
    expect(rows.map((r) => [r.direction, r.category, r.amount]).sort()).toEqual(
      [
        ["EXPENSE", "REFUND", 500_000],
        ["INCOME", "DP", 500_000],
      ],
    );
    expect(balance(db)).toMatchObject({ cash: 0, bank: 0 });
    expect(profitLoss(db, MONTH).netProfit).toBe(0);
    // Decided once.
    expect(keepDp(db, RV, PAID, appendEvent)).toBe(false);
  });

  it("keeps a DP as the same row, read as DP hangus, and other income", () => {
    const db = withDp();
    const keptAt = new Date(2030, 0, 17, 11).toISOString();
    expect(keepDp(db, RV, keptAt, appendEvent)).toBe(true);
    expect(dpStage(db, hold(db))).toBe("KEPT");
    expect(unit(db).status).toBe("TERSEDIA");
    const rows = cashflowRows(db, t).filter((r) => r.orderCode === CODE);
    // No second row: the money came in once, on its day.
    expect(rows.map((r) => [r.category, r.amount, r.at])).toEqual([
      ["DP_HANGUS", 500_000, PAID],
    ]);
    expect(balance(db)).toMatchObject({ cash: 0, bank: 500_000 });
    const r = profitLoss(db, MONTH);
    expect(r.totalRevenue).toBe(0);
    expect(r.otherIncome.find((l) => l.key === "dpForfeited")!.amount).toBe(
      500_000,
    );
    // A decision no projection reopens.
    expect(headerState(db, hold(db))).toBe("CANCELLED");
    expect(dpToApply(hold(db))).toBeUndefined();
  });
});
