/** Income & Expense's two charts (owner ask 2026-10-23) — `lib/cashflowCharts.ts`. */
import { describe, expect, it } from "vitest";
import {
  expenseBreakdown,
  monthlyFlow,
  type FlowRow,
} from "../src/lib/cashflowCharts.js";

const row = (
  at: Date,
  direction: FlowRow["direction"],
  category: string,
  amount: number,
  inBalance = true,
): FlowRow => ({
  at: at.toISOString(),
  direction,
  category,
  amount,
  inBalance,
});

describe("the revenue-vs-expense trend", () => {
  it("buckets by month, oldest first, and leaves own-account moves out", () => {
    const last = new Date(2030, 2, 15);
    const rows = [
      row(new Date(2030, 2, 1, 10), "INCOME", "SALES", 1_000),
      row(new Date(2030, 2, 2, 10), "EXPENSE", "PAYROLL", 300),
      row(new Date(2030, 1, 9, 10), "INCOME", "SALES", 500),
      // Cash ↔ bank, both halves, and a payment that never touched the pots.
      row(new Date(2030, 2, 3, 10), "EXPENSE", "TRANSFER", 2_000),
      row(new Date(2030, 2, 3, 10), "INCOME", "TRANSFER", 2_000),
      row(new Date(2030, 2, 4, 10), "EXPENSE", "SUPPLIER", 9_000, false),
      // Before the window.
      row(new Date(2029, 10, 1, 10), "INCOME", "SALES", 7),
    ];
    const months = monthlyFlow(rows, last, 3);
    expect(months.map((m) => m.month.getMonth())).toEqual([0, 1, 2]);
    expect(months.map((m) => m.income)).toEqual([0, 500, 1_000]);
    expect(months.map((m) => m.expense)).toEqual([0, 0, 300]);
  });
});

describe("the expense breakdown", () => {
  it("is largest first, with the smallest folded into Other past five", () => {
    const from = new Date(2030, 0, 1);
    const at = new Date(2030, 0, 5);
    const rows = [
      row(at, "EXPENSE", "PAYROLL", 600),
      row(at, "EXPENSE", "RENT", 500),
      row(at, "EXPENSE", "MARKETING", 400),
      row(at, "EXPENSE", "OPERATIONAL", 300),
      row(at, "EXPENSE", "BUNGA", 20),
      row(at, "EXPENSE", "SELISIH", 10),
      row(at, "INCOME", "SALES", 99_999),
      row(new Date(2029, 11, 1), "EXPENSE", "RENT", 77),
    ];
    const s = expenseBreakdown(rows, from);
    expect(s.map((x) => x.category)).toEqual([
      "PAYROLL",
      "RENT",
      "MARKETING",
      "OPERATIONAL",
      "OTHER",
    ]);
    expect(s.at(-1)!.amount).toBe(30);
    expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
  });

  it("is empty when nothing was spent", () => {
    expect(expenseBreakdown([], new Date())).toEqual([]);
  });
});
