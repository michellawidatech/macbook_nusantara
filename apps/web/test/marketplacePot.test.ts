/**
 * A marketplace's balance (owner ask 2026-11-13) — `lib/marketplacePot.ts` is
 * the rule. A Shopee payment is in the Shopee balance from the sale, net of
 * what it kept, until a withdrawal moves money to the bank; the cutoff keeps
 * what was settled before the rule in the bank, where it always was.
 */
import { describe, expect, it } from "vitest";
import { balancesOfRows, cashflowRows } from "../src/lib/cashflowRows.js";
import { monthlyFlow } from "../src/lib/cashflowCharts.js";
import {
  isWithdrawalReason,
  marketplacePotOf,
  marketplacePots,
  withdrawalChannel,
} from "../src/lib/marketplacePot.js";
import {
  invoiceProfits,
  monthPeriod,
  profitLoss,
} from "../src/lib/profitLoss.js";
import { posBalanceAt, potMovements } from "../src/lib/reconciliation.js";
import { costIndex } from "../src/lib/service.js";
import { makeT } from "../src/i18n/translate.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb, Order } from "../src/mock/seed.js";
import type { SalePayment } from "../src/lib/salePayments.js";

const t = makeT("en");
const DAY = "2030-01-12";
const AT = new Date(2030, 0, 12, 10).toISOString();
const LATER = new Date(2030, 0, 14, 10).toISOString();
const NO_OPENING = {
  openingCash: 0,
  openingBank: 0,
  openingBalanceAt: undefined,
} as const;

/** The demo store with its money emptied — every figure is the test's. */
function empty(): MockDb {
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
  db.settings = { ...db.settings, ...NO_OPENING };
  delete db.settings.marketplacePotFrom;
  return db;
}

function sale(db: MockDb, id: string, payments: SalePayment[]): Order {
  const total = payments.reduce((n, p) => n + p.amount, 0);
  const order = {
    id,
    code: `SI-${id}`,
    ts: AT,
    customerId: null,
    serials: [],
    prices: {},
    discount: 0,
    source: "SHOPEE",
    payMethod: "MARKETPLACE",
    payments,
    settled: payments.every((p) => p.state === "SETTLED"),
    total,
  } as unknown as Order;
  db.orders.push(order);
  return order;
}

const shopee = (
  id: string,
  amount: number,
  state: "SETTLED" | "PENDING",
  at = AT,
): SalePayment => ({
  id,
  method: "MARKETPLACE",
  amount,
  state,
  channel: "SHOPEE",
  at,
});

function deduct(db: MockDb, orderId: string, paymentId: string, fee: number) {
  const gross = db.orders
    .find((o) => o.id === orderId)!
    .payments!.find((p) => p.id === paymentId)!.amount;
  db.settlements.push({
    id: `stl-${paymentId}`,
    paymentId,
    orderId,
    channel: "SHOPEE",
    gross,
    fees: [{ id: "f", kind: "OTHER", label: "Komisi", amount: fee }],
    received: gross - fee,
    at: AT,
    staff: "t",
  } as MockDb["settlements"][number]);
}

function withdraw(
  db: MockDb,
  id: string,
  amount: number,
  reason = "PENARIKAN_SHOPEE",
) {
  db.incomes.push({
    id,
    reason: reason as never,
    amount,
    date: DAY,
    method: "TRANSFER",
    createdAt: LATER,
  });
}

const shopeePot = (db: MockDb) =>
  marketplacePots(cashflowRows(db, t)).find((p) => p.channel === "SHOPEE")!;
const bank = (db: MockDb) =>
  balancesOfRows(cashflowRows(db, t), db.settings).bank;

describe("which pot a marketplace payment is in", () => {
  it("is the channel's while pending, and from the cutoff on once settled", () => {
    const from = "2030-01-01T00:00:00.000Z";
    const p = (state: string, at: string) => ({
      channel: "SHOPEE",
      state,
      at,
    });
    expect(marketplacePotOf(p("PENDING", "2029-01-01T00:00:00Z"), from)).toBe(
      "SHOPEE",
    );
    expect(marketplacePotOf(p("SETTLED", "2029-12-31T23:00:00Z"), from)).toBe(
      undefined,
    );
    expect(marketplacePotOf(p("SETTLED", "2030-01-02T00:00:00Z"), from)).toBe(
      "SHOPEE",
    );
    // No cutoff: the rule applies to everything.
    expect(
      marketplacePotOf(p("SETTLED", "2001-01-01T00:00:00Z"), undefined),
    ).toBe("SHOPEE");
    // Cash, or a channel that holds no seller balance, is not a pot.
    expect(
      marketplacePotOf({ state: "SETTLED", at: AT }, undefined),
    ).toBeUndefined();
    expect(
      marketplacePotOf({ channel: "TIKTOK", state: "PENDING", at: AT }, from),
    ).toBeUndefined();
  });

  it("names the two withdrawal reasons and nothing else", () => {
    expect(withdrawalChannel("PENARIKAN_SHOPEE")).toBe("SHOPEE");
    expect(withdrawalChannel("PENARIKAN_TOKOPEDIA")).toBe("TOKOPEDIA");
    expect(isWithdrawalReason("TRANSFER")).toBe(false);
  });
});

describe("the seller balance", () => {
  it("holds a released payment net of its deduction, and the bank does not move", () => {
    const db = empty();
    sale(db, "o-1", [shopee("p-1", 10_000_000, "SETTLED")]);
    deduct(db, "o-1", "p-1", 1_150_000);

    const pot = shopeePot(db);
    expect(pot.paidIn).toBe(8_850_000);
    expect(pot.balance).toBe(8_850_000);
    expect(bank(db)).toBe(0);

    // The rows say where they are, and are not counted in either reconciliation.
    const mine = cashflowRows(db, t).filter((r) => r.orderCode === "SI-o-1");
    expect(mine.map((r) => r.marketplace)).toEqual(["SHOPEE", "SHOPEE"]);
    expect(
      potMovements(cashflowRows(db, t), db.settings, "BANK", DAY, DAY),
    ).toEqual([]);
    expect(posBalanceAt(cashflowRows(db, t), db.settings, "BANK", DAY)).toBe(0);
  });

  it("counts a payment stored PENDING the same — it is in the balance from the sale", () => {
    const db = empty();
    sale(db, "o-2", [shopee("p-2", 4_000_000, "PENDING")]);
    deduct(db, "o-2", "p-2", 400_000);
    const pot = shopeePot(db);
    expect(pot.balance).toBe(3_600_000);
    // And it reads Settled on Income & Expense, with the balance named.
    const rows = cashflowRows(db, t).filter((r) => r.orderCode === "SI-o-2");
    expect(rows.map((r) => [r.status, r.marketplace])).toEqual([
      ["SETTLED", "SHOPEE"],
      ["SETTLED", "SHOPEE"],
    ]);
    // Not in the bank on either basis.
    expect(
      balancesOfRows(cashflowRows(db, t), db.settings, { accrual: true }).bank,
    ).toBe(0);
  });

  it("is emptied by a withdrawal, which is what moves the bank", () => {
    const db = empty();
    sale(db, "o-1", [shopee("p-1", 10_000_000, "SETTLED")]);
    deduct(db, "o-1", "p-1", 1_150_000);
    sale(db, "o-2", [shopee("p-2", 4_000_000, "PENDING")]);
    withdraw(db, "i-w1", 5_000_000);

    const pot = shopeePot(db);
    expect(pot.withdrawn).toBe(5_000_000);
    expect(pot.balance).toBe(8_850_000 + 4_000_000 - 5_000_000);
    expect(bank(db)).toBe(5_000_000);

    // The withdrawal is the one bank movement the statement can show.
    const moved = potMovements(
      cashflowRows(db, t),
      db.settings,
      "BANK",
      DAY,
      DAY,
    );
    expect(moved.map((r) => r.key)).toEqual(["i-i-w1"]);
  });

  it("keeps Tokopedia's pot apart from Shopee's", () => {
    const db = empty();
    sale(db, "o-3", [
      {
        id: "p-3",
        method: "MARKETPLACE",
        amount: 2_000_000,
        state: "SETTLED",
        channel: "TOKOPEDIA",
        at: AT,
      },
    ]);
    withdraw(db, "i-w2", 500_000, "PENARIKAN_TOKOPEDIA");
    const pots = marketplacePots(cashflowRows(db, t));
    expect(pots.find((p) => p.channel === "TOKOPEDIA")!.balance).toBe(
      1_500_000,
    );
    expect(pots.find((p) => p.channel === "SHOPEE")!.balance).toBe(0);
  });

  it("leaves a payment released before the cutoff in the bank, as it always was", () => {
    const db = empty();
    db.settings.marketplacePotFrom = new Date(2030, 0, 13).toISOString();
    sale(db, "o-old", [shopee("p-old", 3_000_000, "SETTLED", AT)]);
    sale(db, "o-new", [shopee("p-new", 7_000_000, "SETTLED", LATER)]);

    expect(bank(db)).toBe(3_000_000);
    expect(shopeePot(db).balance).toBe(7_000_000);
  });

  it("does not count a withdrawal as revenue in the charts or in Profit & Loss", () => {
    const db = empty();
    sale(db, "o-1", [shopee("p-1", 10_000_000, "SETTLED")]);
    withdraw(db, "i-w1", 6_000_000);

    const flow = monthlyFlow(cashflowRows(db, t), new Date(2030, 0, 20), 1);
    expect(flow[0]!.income).toBe(10_000_000);

    // Profit & Loss reads no line off a withdrawal: the same with and without.
    const month = monthPeriod(new Date(2030, 0, 15));
    const withIt = profitLoss(db, month);
    const without = profitLoss({ ...db, incomes: [] }, month);
    expect(withIt.totalRevenue).toBe(without.totalRevenue);
    expect(withIt.netProfit).toBe(without.netProfit);
    expect(withIt.otherIncome.reduce((n, l) => n + l.amount, 0)).toBe(0);
  });
});

describe("profit per invoice", () => {
  it("is each sale's bill against what its pieces cost", () => {
    const db = empty();
    const [a, b] = db.units;
    const cost = costIndex(db);
    db.orders.push({
      id: "o-inv",
      code: "SI-2030/01-000001",
      ts: AT,
      customerId: db.customers[0]!.id,
      serials: [a!.serial],
      prices: { [a!.serial]: 9_000_000 },
      discount: 200_000,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      extra: 50_000,
      total: 8_850_000,
    } as unknown as Order);
    db.orders.push({
      id: "o-inv2",
      code: "SI-2030/01-000002",
      ts: LATER,
      customerId: null,
      serials: [b!.serial],
      prices: { [b!.serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      total: 5_000_000,
    } as unknown as Order);

    const rows = invoiceProfits(db, monthPeriod(new Date(2030, 0, 15)));
    // Newest first.
    expect(rows.map((r) => r.code)).toEqual([
      "SI-2030/01-000002",
      "SI-2030/01-000001",
    ]);
    const first = rows[1]!;
    const spent = cost(a!).total;
    expect(first.revenue).toBe(8_850_000);
    expect(first.cost).toBe(spent);
    expect(first.profit).toBe(8_850_000 - spent);
    expect(first.margin).toBeCloseTo((8_850_000 - spent) / 8_850_000);
    expect(first.customer).not.toBe("");
    expect(rows[0]!.customer).toBe("");
  });

  it("takes a return off the bill and the returned unit off the cost", () => {
    const db = empty();
    const unit = db.units[0]!;
    db.orders.push({
      id: "o-back",
      code: "SI-2030/01-000003",
      ts: AT,
      customerId: null,
      serials: [unit.serial],
      prices: { [unit.serial]: 6_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      total: 6_000_000,
      adjustments: [
        {
          id: "adj",
          type: "RETUR",
          amount: 5_900_000,
          reason: "back",
          at: LATER,
        },
      ],
    } as unknown as Order);
    db.events.push({
      id: "ev-back",
      serial: unit.serial,
      seq: 9_999,
      type: "RETUR_PELANGGAN",
      fromStatus: "TERJUAL",
      toStatus: "TERSEDIA",
      at: LATER,
    } as unknown as MockDb["events"][number]);

    const [row] = invoiceProfits(db, monthPeriod(new Date(2030, 0, 15)));
    expect(row!.revenue).toBe(100_000);
    expect(row!.cost).toBe(0);
    expect(row!.profit).toBe(100_000);
  });
});
