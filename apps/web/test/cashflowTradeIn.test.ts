/**
 * A trade-in on Income & Expense (owner asks 2026-10-31): *"record the 12,5
 * as income and 27 as expense"*, and later the same day *"every trade-in
 * should be recorded the same way"* — gross, `lib/tradeIn.ts`.
 */
import { describe, expect, it } from "vitest";
import { balancesOfRows, cashflowRows } from "../src/lib/cashflowRows.js";
import { signedAmount } from "../src/lib/reconciliation.js";
import { makeT } from "../src/i18n/translate.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb, Order } from "../src/mock/seed.js";

const t = makeT("en");
const AT = new Date(2030, 0, 12, 10).toISOString();
const CODE = "SI-2030/01-000009";

function shop(order: Partial<Order>, payout?: number): MockDb {
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
  db.orders.push({
    id: "o-ti",
    code: CODE,
    ts: AT,
    customerId: null,
    serials: ["TISOLD000001"],
    prices: { TISOLD000001: 12_500_000 },
    listPrices: { TISOLD000001: 12_500_000 },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    payments: [],
    settled: true,
    total: 12_500_000,
    ...order,
  });
  if (payout !== undefined) {
    db.expenses.push({
      id: "e-payout",
      kind: "TUKAR_TAMBAH",
      amount: payout,
      date: "2030-01-12",
      method: "TRANSFER",
      orderId: "o-ti",
      note: "BCA 0671705342 · Abdul Basid",
      ref: "TRF-1",
      createdAt: AT,
    });
  }
  return db;
}

const mine = (db: MockDb) =>
  cashflowRows(db, t).filter((r) => r.orderCode === CODE);

const pots = (db: MockDb) =>
  balancesOfRows(cashflowRows(db, t), {
    ...db.settings,
    openingCash: 0,
    openingBank: 0,
    openingBalanceAt: undefined,
  });

const tt = (amount: number) => ({
  id: "pay-tt",
  method: "TUKAR_TAMBAH",
  amount,
  state: "SETTLED" as const,
  at: AT,
  inBalance: false,
});

describe("a trade-in recorded gross", () => {
  it("worth more: the bill is income, the trade-in an expense, the bank moves by the payout", () => {
    const db = shop(
      {
        tradeInGross: true,
        payments: [tt(12_500_000)],
        tradeIns: [{ id: "t1", label: "Pro 14 M5", value: 27_000_000 }],
      },
      14_500_000,
    );
    const rows = mine(db);
    expect(
      rows.map((r) => [r.direction, r.category, r.amount, r.inBalance]).sort(),
    ).toEqual([
      ["EXPENSE", "TUKAR_TAMBAH", 12_500_000, false],
      ["EXPENSE", "TUKAR_TAMBAH", 14_500_000, true],
      ["INCOME", "SALES", 12_500_000, false],
    ]);
    // 12,5jt in, 27jt out, and only the 14,5jt actually moved.
    const income = rows
      .filter((r) => r.direction === "INCOME")
      .reduce((n, r) => n + r.amount, 0);
    const expense = rows
      .filter((r) => r.direction === "EXPENSE")
      .reduce((n, r) => n + r.amount, 0);
    expect([income, expense]).toEqual([12_500_000, 27_000_000]);
    expect(pots(db).bank).toBe(-14_500_000);
    // The payout is a real record: the bank statement's line pairs with it.
    const payout = rows.find((r) => r.inBalance && r.direction === "EXPENSE")!;
    expect(payout.source).toEqual({ kind: "expense", id: "e-payout" });
    expect(signedAmount(payout)).toBe(-14_500_000);
    expect(payout.description).toContain("Abdul Basid");
    expect(payout.description).toContain("TRF-1");
    // …and it belongs to its sale: not deletable from Income & Expense.
    expect(payout.adjustment).toBeUndefined();
  });

  it("worth less: the bill is income, the trade-in an expense, the drawer moves by the cash", () => {
    const db = shop({
      tradeInGross: true,
      payments: [
        tt(2_000_000),
        {
          id: "pay-cash",
          method: "TUNAI",
          amount: 10_500_000,
          state: "SETTLED",
          at: AT,
        },
      ],
      tradeIns: [{ id: "t1", label: "Air 2017", value: 2_000_000 }],
    });
    const rows = mine(db);
    expect(rows.map((r) => [r.direction, r.amount]).sort()).toEqual([
      ["EXPENSE", 2_000_000],
      ["INCOME", 10_500_000],
      ["INCOME", 2_000_000],
    ]);
    expect(pots(db).cash).toBe(10_500_000);
  });
});

describe("a trade-in recorded before the gross rule", () => {
  it("bought outright on 2026-10-31 still reads as it was written", () => {
    const db = shop({
      payMethod: "TRANSFER",
      payments: [
        {
          id: "pay-ti",
          method: "TRANSFER",
          amount: 12_500_000,
          state: "SETTLED",
          at: AT,
        },
      ],
      tradeIns: [{ id: "t1", label: "Pro 16", value: 27_000_000 }],
    });
    const rows = mine(db);
    expect(
      rows.map((r) => [r.direction, r.category, r.amount, r.methodCode]).sort(),
    ).toEqual([
      ["EXPENSE", "TUKAR_TAMBAH", 27_000_000, "TRANSFER"],
      ["INCOME", "SALES", 12_500_000, "TRANSFER"],
    ]);
    const sale = rows.find((r) => r.category === "SALES")!;
    expect(signedAmount(sale)).toBe(-14_500_000);
  });

  it("netted off the bill is only the money paid — no purchase row", () => {
    const db = shop({
      total: 10_500_000,
      payments: [
        {
          id: "pay-net",
          method: "TUNAI",
          amount: 10_500_000,
          state: "SETTLED",
          at: AT,
        },
      ],
      tradeIns: [{ id: "t1", label: "Pro 14", value: 2_000_000 }],
    });
    expect(mine(db).map((r) => [r.category, r.amount])).toEqual([
      ["SALES", 10_500_000],
    ]);
  });
});
