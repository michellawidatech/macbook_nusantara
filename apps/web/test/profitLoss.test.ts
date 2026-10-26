/**
 * Profit & Loss (owner ask 2026-10-23) — `lib/profitLoss.ts` is the rule.
 * A copy of the demo store with its money emptied and one month in 2030, so
 * every figure below is put there by the test.
 */
import { describe, expect, it } from "vitest";
import {
  monthPeriod,
  monthlyProfitLoss,
  profitLoss,
  unitProfits,
} from "../src/lib/profitLoss.js";
import { costIndex } from "../src/lib/service.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const MONTH = monthPeriod(new Date(2030, 0, 15));
const IN = new Date(2030, 0, 10, 10).toISOString();
const OUT = new Date(2030, 1, 3, 10).toISOString();

function empty(): MockDb {
  const db = structuredClone(getDb());
  db.orders = [];
  db.expenses = [];
  db.incomes = [];
  db.settlements = [];
  db.returns = [];
  return db;
}

const line = (r: ReturnType<typeof profitLoss>, key: string) =>
  [
    ...r.revenue,
    ...r.cogs,
    ...r.operating,
    ...r.otherIncome,
    ...r.otherExpense,
  ].find((l) => l.key === key)!.amount;

describe("profit & loss", () => {
  it("is revenue at list, the bargain and the code discount off it, and the unit's cost", () => {
    const db = empty();
    const unit = db.units[0]!;
    const cost = costIndex(db)(unit).total;
    db.orders.push({
      id: "o-pnl",
      code: "SI-2030/01-000001",
      ts: IN,
      customerId: null,
      serials: [unit.serial],
      prices: { [unit.serial]: 9_000_000 },
      listPrices: { [unit.serial]: 10_000_000 },
      discount: 200_000,
      source: "OFFLINE" as never,
      payMethod: "TUNAI",
      settled: true,
      extra: 50_000,
      total: 8_850_000,
    } as MockDb["orders"][number]);

    const r = profitLoss(db, MONTH);
    expect(r.sales).toBe(1);
    expect(line(r, "sales")).toBe(10_000_000);
    expect(line(r, "discounts")).toBe(-1_200_000);
    expect(line(r, "charges")).toBe(50_000);
    // Revenue is what the sale's bill says.
    expect(r.totalRevenue).toBe(8_850_000);
    expect(line(r, "cogsSold")).toBe(cost);
    expect(r.grossProfit).toBe(8_850_000 - cost);
    expect(r.netProfit).toBe(r.grossProfit);
  });

  it("counts operating costs and other income, and leaves what is not profit out", () => {
    const db = empty();
    const day = "2030-01-20";
    const exp = (kind: string, amount: number) =>
      db.expenses.push({
        id: `e-${kind}`,
        kind: kind as never,
        amount,
        date: day,
        method: "TUNAI",
      } as MockDb["expenses"][number]);
    exp("PAYROLL", 3_000_000);
    exp("RENT", 1_000_000);
    exp("BUNGA", 20_000);
    // Not costs: stock bought, money moved, a refund the RETUR already counts.
    exp("SUPPLIER", 50_000_000);
    exp("TRANSFER", 2_000_000);
    exp("REFUND", 500_000);
    db.incomes.push({
      id: "i-bunga",
      reason: "BUNGA",
      amount: 5_000,
      date: day,
      method: "TRANSFER",
    } as MockDb["incomes"][number]);
    db.incomes.push({
      id: "i-transfer",
      reason: "TRANSFER",
      amount: 2_000_000,
      date: day,
      method: "TUNAI",
    } as MockDb["incomes"][number]);
    // Outside the month.
    db.expenses.push({
      id: "e-feb",
      kind: "PAYROLL",
      amount: 9_999,
      date: OUT.slice(0, 10),
      method: "TUNAI",
    } as MockDb["expenses"][number]);

    const r = profitLoss(db, MONTH);
    expect(r.totalOperating).toBe(4_000_000);
    expect(line(r, "interestIn")).toBe(5_000);
    expect(line(r, "interestOut")).toBe(20_000);
    expect(r.totalOther).toBe(5_000 - 20_000);
    expect(r.netProfit).toBe(-4_000_000 + 5_000 - 20_000);
  });

  it("counts a paid service charge once — in the unit's cost, never as operating (2026-10-26)", () => {
    const db = empty();
    const unit = db.units[0]!;
    db.services = [
      {
        id: "svc-pnl",
        serial: unit.serial,
        fromLocationId: unit.locationId,
        openedAt: IN,
        arrivedAt: IN,
        fees: [
          {
            id: "sf-pnl",
            kind: "LABOUR",
            amount: 800_000,
            at: IN,
            staff: "Test",
          },
        ],
        raisedBy: "QC",
        staff: "Test",
      } as MockDb["services"][number],
    ];
    // The charge was paid: an expense of kind UNIT names it.
    db.expenses.push({
      id: "e-unit",
      kind: "UNIT",
      amount: 800_000,
      date: "2030-01-10",
      method: "TRANSFER",
      serviceFeeId: "sf-pnl",
    });
    const cost = costIndex(db)(unit).total;
    db.orders.push({
      id: "o-pnl-unit",
      code: "SI-2030/01-000002",
      ts: IN,
      customerId: null,
      serials: [unit.serial],
      prices: { [unit.serial]: 9_000_000 },
      listPrices: { [unit.serial]: 9_000_000 },
      discount: 0,
      source: "OFFLINE" as never,
      payMethod: "TUNAI",
      settled: true,
      total: 9_000_000,
    } as MockDb["orders"][number]);

    const r = profitLoss(db, MONTH);
    expect(line(r, "cogsSold")).toBe(cost);
    expect(r.totalOperating).toBe(0);
    expect(r.totalOther).toBe(0);
    expect(r.netProfit).toBe(9_000_000 - cost);
  });

  it("takes a return off on its own date, and puts the unit's cost back", () => {
    const db = empty();
    const unit = db.units[0]!;
    const cost = costIndex(db)(unit).total;
    db.orders.push({
      id: "o-old",
      code: "SI-2029/12-000001",
      ts: new Date(2029, 11, 20).toISOString(),
      customerId: null,
      serials: [unit.serial],
      prices: { [unit.serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE" as never,
      payMethod: "TUNAI",
      settled: true,
      total: 5_000_000,
      adjustments: [
        {
          id: "adj",
          type: "RETUR",
          code: "SG-2030/01-000001",
          amount: 4_800_000,
          reason: "Returned",
          at: IN,
        },
      ],
    } as MockDb["orders"][number]);
    db.events.push({
      id: "ev-ret",
      serial: unit.serial,
      seq: 9_999,
      type: "RETUR_PELANGGAN",
      at: IN,
      toStatus: "TERSEDIA",
      locationId: unit.locationId,
      refCode: "SG-2030/01-000001",
      staff: "Test",
    } as MockDb["events"][number]);

    const r = profitLoss(db, MONTH);
    expect(r.sales).toBe(0);
    expect(line(r, "returns")).toBe(-4_800_000);
    expect(line(r, "cogsReturned")).toBe(-cost);
    expect(r.grossProfit).toBe(-4_800_000 + cost);

    // Taken back since: the unit went out again, so no cost comes back.
    db.returns.push({
      id: "r",
      code: "SG-2030/01-000001",
      kind: "CUSTOMER",
      serial: unit.serial,
      reason: "x",
      date: "2030-01-10",
      status: "CANCELLED",
    });
    expect(line(profitLoss(db, MONTH), "cogsReturned")).toBe(0);
  });

  it("lists the transactions behind every line, adding up to it", () => {
    const db = structuredClone(getDb());
    const p = monthPeriod(new Date());
    const r = profitLoss(db, p);
    for (const l of [
      ...r.revenue,
      ...r.cogs,
      ...r.operating,
      ...r.otherIncome,
      ...r.otherExpense,
    ])
      expect(l.items.reduce((n, i) => n + i.amount, 0)).toBe(l.amount);
    expect(r.revenue[0]!.items.length).toBeGreaterThan(0);
  });

  it("averages profit per unit per product, the discount code shared by price", () => {
    const db = empty();
    const sku = db.units.find(
      (u) => db.units.filter((x) => x.skuId === u.skuId).length >= 2,
    )!.skuId;
    const [a, b] = db.units.filter((u) => u.skuId === sku);
    const cost = costIndex(db);
    db.orders.push({
      id: "o-avg",
      code: "SI-2030/01-000002",
      ts: IN,
      customerId: null,
      serials: [a!.serial, b!.serial],
      prices: { [a!.serial]: 6_000_000, [b!.serial]: 4_000_000 },
      discount: 1_000_000,
      source: "OFFLINE" as never,
      payMethod: "TUNAI",
      settled: true,
      total: 9_000_000,
    } as MockDb["orders"][number]);
    const [row] = unitProfits(db, MONTH);
    const spent = cost(a!).total + cost(b!).total;
    expect(row!.sold).toBe(2);
    expect(row!.revenue).toBe(9_000_000);
    expect(row!.profit).toBe(9_000_000 - spent);
    expect(row!.perUnit).toBe(Math.round((9_000_000 - spent) / 2));
  });

  it("gives twelve months, oldest first, each its own statement", () => {
    const db = structuredClone(getDb());
    const now = new Date();
    const months = monthlyProfitLoss(db, now, 12);
    expect(months).toHaveLength(12);
    expect(months.at(-1)!.month.getMonth()).toBe(now.getMonth());
    expect(months.at(-1)!.netProfit).toBe(
      profitLoss(db, monthPeriod(now)).netProfit,
    );
  });
});
