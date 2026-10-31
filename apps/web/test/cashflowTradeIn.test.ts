/**
 * A trade-in worth more than the bill, on Income & Expense (owner ask
 * 2026-10-31): *"1 person buying 1 unit 12,5, but trade in 27 … record the
 * 12,5 as income and 27 as expense."* Both halves are listed, the pot moves
 * by the difference handed over, and a reconciliation sees that difference.
 */
import { describe, expect, it } from "vitest";
import { balancesOfRows, cashflowRows } from "../src/lib/cashflowRows.js";
import { signedAmount } from "../src/lib/reconciliation.js";
import { makeT } from "../src/i18n/translate.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const t = makeT("en");
const AT = new Date(2030, 0, 12, 10).toISOString();

function shop(tradeIn: number, total: number): MockDb {
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
    code: "SI-2030/01-000009",
    ts: AT,
    customerId: null,
    serials: ["TISOLD000001"],
    prices: { TISOLD000001: 12_500_000 },
    listPrices: { TISOLD000001: 12_500_000 },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    payments:
      total > 0
        ? [
            {
              id: "pay-ti",
              method: "TUNAI",
              amount: total,
              state: "SETTLED",
              at: AT,
            },
          ]
        : [],
    settled: true,
    tradeIns: [{ id: "t1", label: "Pro 16 2019", value: tradeIn }],
    total,
  });
  return db;
}

const mine = (db: MockDb) =>
  cashflowRows(db, t).filter((r) => r.orderCode === "SI-2030/01-000009");

describe("a trade-in worth more than the bill", () => {
  it("lists the sale as income and the trade-in as an expense", () => {
    const db = shop(27_000_000, 12_500_000);
    expect(
      mine(db)
        .map((r) => [r.direction, r.category, r.amount, r.methodCode])
        .sort(),
    ).toEqual([
      ["EXPENSE", "TRADE_IN", 27_000_000, "TUNAI"],
      ["INCOME", "SALES", 12_500_000, "TUNAI"],
    ]);
  });

  it("moves the drawer by what was handed over", () => {
    const db = shop(27_000_000, 12_500_000);
    const b = balancesOfRows(cashflowRows(db, t), {
      ...db.settings,
      openingCash: 0,
      openingBank: 0,
      openingBalanceAt: undefined,
    });
    expect(b.cash).toBe(-14_500_000);
  });

  it("is paired by a reconciliation as the one figure that moved", () => {
    const rows = mine(shop(27_000_000, 12_500_000));
    const sale = rows.find((r) => r.category === "SALES")!;
    const bought = rows.find((r) => r.category === "TRADE_IN")!;
    expect(signedAmount(sale)).toBe(-14_500_000);
    expect(bought.feeOf).toBe(sale.key);
  });
});

describe("a trade-in worth less than the bill", () => {
  it("only comes off the bill — no purchase row", () => {
    const rows = mine(shop(2_000_000, 10_500_000));
    expect(rows.map((r) => [r.category, r.amount])).toEqual([
      ["SALES", 10_500_000],
    ]);
  });
});
