/**
 * The two charts on Income & Expense (owner ask 2026-10-23: *"Revenue vs.
 * Expense Trend Line and Expense Breakdown Pie/Donut Chart"*), read off the
 * SAME rows the page's table lists, so a chart can never say something the
 * table does not.
 *
 * Left out of both: money moved between the shop's own pots (`TRANSFER`,
 * either way — counting it would show a cash ↔ bank move as income AND
 * expense) and a row that never passed through the shop's cash or bank
 * (`inBalance` false).
 *
 * Pure — the page decides which rows (cash basis or accrual) come in.
 */

/** What a chart needs of one of the page's rows. */
export interface FlowRow {
  readonly at: string;
  readonly direction: "INCOME" | "EXPENSE";
  readonly category: string;
  readonly amount: number;
  readonly inBalance: boolean;
}

const counts = (r: FlowRow) => r.inBalance && r.category !== "TRANSFER";

/** One month of the trend. */
export interface FlowMonth {
  /** First day of the month, local. */
  readonly month: Date;
  readonly income: number;
  readonly expense: number;
}

/** The `count` months ending with the one containing `last`, oldest first. */
export function monthlyFlow(
  rows: readonly FlowRow[],
  last: Date,
  count: number,
): FlowMonth[] {
  const months = Array.from({ length: count }, (_, i) => ({
    month: new Date(last.getFullYear(), last.getMonth() - (count - 1 - i), 1),
    income: 0,
    expense: 0,
  }));
  const index = (d: Date) =>
    (d.getFullYear() - months[0]!.month.getFullYear()) * 12 +
    d.getMonth() -
    months[0]!.month.getMonth();
  for (const r of rows) {
    if (!counts(r)) continue;
    const i = index(new Date(r.at));
    if (i < 0 || i >= count) continue;
    if (r.direction === "INCOME") months[i]!.income += r.amount;
    else months[i]!.expense += r.amount;
  }
  return months;
}

/** One slice of the expense donut. */
export interface ExpenseSlice {
  /** An `ExpenseKind`, or `OTHER` for the categories folded together. */
  readonly category: string;
  readonly amount: number;
  /** 0–1 of the whole. */
  readonly share: number;
}

/**
 * Expenses by category since `from`, largest first. Past `max` slices the
 * smallest fold into one `OTHER`, because a donut of eleven thin wedges
 * cannot be read — the legend still names every category that is in it.
 */
export function expenseBreakdown(
  rows: readonly FlowRow[],
  from: Date,
  max = 5,
): ExpenseSlice[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.direction !== "EXPENSE" || !counts(r)) continue;
    if (new Date(r.at) < from) continue;
    by.set(r.category, (by.get(r.category) ?? 0) + r.amount);
  }
  const sorted = [...by.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((n, [, a]) => n + a, 0);
  const head = sorted.length > max ? sorted.slice(0, max - 1) : sorted;
  const rest = sorted.length > max ? sorted.slice(max - 1) : [];
  const slices = head.map(([category, amount]) => ({ category, amount }));
  if (rest.length > 0)
    slices.push({
      category: "OTHER",
      amount: rest.reduce((n, [, a]) => n + a, 0),
    });
  return slices.map((s) => ({
    ...s,
    share: total === 0 ? 0 : s.amount / total,
  }));
}
