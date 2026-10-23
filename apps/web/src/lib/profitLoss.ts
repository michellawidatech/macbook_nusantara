/**
 * Profit & Loss — Laba Rugi (owner ask 2026-10-23: *"add a PnL page / report
 * … it has to follow templates like the one Olsera uses"*).
 *
 * The layout is Olsera Akunting's *Laporan Laba Rugi*: Pendapatan, Biaya
 * pokok penjualan, Laba kotor, Biaya operasional, Pendapatan bersih
 * operasional, the non-operating income and costs, and Laba bersih — each
 * line with an account code and brackets for what is taken off.
 *
 * ACCRUAL, by the sale's own date: a sale counts in the month it was made,
 * paid or not, because that is the only basis on which its cost (HPP) and its
 * revenue fall in the same period. One deliberate difference from Olsera:
 * Olsera works out HPP the periodic way (opening stock + purchases − closing
 * stock). This app knows what every unit cost (`costOfUnit`) and every
 * counted piece (`lineCost`), so HPP is the cost of what was SOLD — the same
 * answer without a stock count at both ends of the month.
 *
 * What is NOT here, and why:
 * - Supplier payments, deposits and invoices: buying stock is not a cost
 *   until the unit sells, and then it is HPP.
 * - Cash ↔ bank and account transfers: money moving between the shop's own
 *   pots.
 * - Refunds (`Expense`/`ManualIncome` REFUND, `Order.refunds`): a return is
 *   already taken off sales by its RETUR adjustment; counting the cash too
 *   would take it off twice.
 * - The trade-in allowance: it buys a unit, it is not a discount.
 * - Opening balances and debt payments.
 *
 * Pure: no React, no store — a test reads the arithmetic.
 */
import type { MockDb } from "../mock/seed.js";
import { costIndex } from "./service.js";
import { lineCost } from "./stock.js";

/** The half-open instant range a report covers: from ≤ t < until. */
export interface Period {
  readonly from: Date;
  readonly until: Date;
}

/** One line of the report. `amount` is signed as it adds into its section. */
export interface PnlLine {
  readonly key: string;
  /** Olsera's account code for the line. */
  readonly code: string;
  readonly amount: number;
}

export interface ProfitLoss {
  readonly revenue: readonly PnlLine[];
  readonly totalRevenue: number;
  readonly cogs: readonly PnlLine[];
  readonly totalCogs: number;
  readonly grossProfit: number;
  readonly operating: readonly PnlLine[];
  readonly totalOperating: number;
  readonly operatingProfit: number;
  readonly otherIncome: readonly PnlLine[];
  readonly otherExpense: readonly PnlLine[];
  readonly totalOther: number;
  readonly netProfit: number;
  /** Sales counted — for the heading, and for "nothing in this period". */
  readonly sales: number;
}

/** Expense kinds that are the cost of running the shop, in report order. */
export const OPERATING_KINDS = [
  "OPERATIONAL",
  "PAYROLL",
  "MARKETING",
  "RENT",
  "PROFESSIONAL",
  "SOFTWARE",
] as const;

const OPERATING_CODES: Record<(typeof OPERATING_KINDS)[number], string> = {
  OPERATIONAL: "60000",
  PAYROLL: "60100",
  MARKETING: "60200",
  RENT: "60300",
  PROFESSIONAL: "60400",
  SOFTWARE: "60500",
};

const within = (iso: string | undefined, p: Period): boolean => {
  if (iso === undefined || iso === "") return false;
  // A bare date (an expense's `date`) is that LOCAL day.
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`)
    : new Date(iso);
  return t >= p.from && t < p.until;
};

/** Profit & Loss for one period. */
export function profitLoss(db: MockDb, p: Period): ProfitLoss {
  const cost = costIndex(db);
  const unitOf = new Map(db.units.map((u) => [u.serial, u]));
  const unitCost = (serial: string): number => {
    const u = unitOf.get(serial);
    return u === undefined ? 0 : cost(u).total;
  };

  // ── Pendapatan ────────────────────────────────────────────────────────
  let sales = 0;
  let gross = 0;
  let bargains = 0;
  let discounts = 0;
  let charges = 0;
  let soldCost = 0;
  const salesInPeriod = db.orders.filter((o) => within(o.ts, p));
  for (const o of salesInPeriod) {
    sales += 1;
    for (const s of o.serials) {
      const price = o.prices[s] ?? 0;
      const list = o.listPrices?.[s] ?? price;
      // The shop's asking price, plus anything charged above it; what was
      // knocked off it is a discount line, as Olsera's Potongan penjualan.
      gross += Math.max(list, price);
      bargains += Math.max(0, list - price);
      soldCost += unitCost(s);
    }
    for (const l of o.lines ?? []) {
      const list = l.listPrice ?? l.price;
      gross += Math.max(list, l.price) * l.qty;
      bargains += Math.max(0, list - l.price) * l.qty;
      soldCost += lineCost(db.stockMoves, l.id);
    }
    discounts += o.discount;
    charges += o.extra ?? 0;
  }
  // Takings this app did not ring up, entered by hand.
  const outside = db.incomes
    .filter((i) => i.reason === "SALES" && within(i.date, p))
    .reduce((n, i) => n + i.amount, 0);
  // Returns fall on their OWN date, whatever month the sale was in.
  const returns = db.orders
    .flatMap((o) => o.adjustments ?? [])
    .filter((a) => a.type === "RETUR" && within(a.at, p))
    .reduce((n, a) => n + a.amount, 0);

  const revenue: PnlLine[] = clean([
    { key: "sales", code: "40000", amount: gross },
    { key: "outsideSales", code: "40100", amount: outside },
    { key: "charges", code: "44000", amount: charges },
    { key: "discounts", code: "46100", amount: -(discounts + bargains) },
    { key: "returns", code: "46300", amount: -returns },
  ]);
  const totalRevenue = sum(revenue);

  // ── Biaya pokok penjualan ─────────────────────────────────────────────
  // What came back goes back into stock at what it cost — unless the return
  // was taken back since, which put the unit back out.
  const withdrawn = new Set(
    db.returns.filter((r) => r.status === "CANCELLED").map((r) => r.code),
  );
  const backCost =
    db.events
      .filter(
        (e) =>
          e.type === "RETUR_PELANGGAN" &&
          within(e.at, p) &&
          !(e.refCode !== undefined && withdrawn.has(e.refCode)),
      )
      .reduce((n, e) => n + unitCost(e.serial), 0) +
    db.stockMoves
      .filter((m) => m.type === "RETUR_PELANGGAN" && within(m.at, p))
      .reduce((n, m) => n + m.qty * m.cost, 0);
  const cogs: PnlLine[] = clean([
    { key: "cogsSold", code: "50000", amount: soldCost },
    { key: "cogsReturned", code: "50400", amount: -backCost },
  ]);
  const totalCogs = sum(cogs);
  const grossProfit = totalRevenue - totalCogs;

  // ── Biaya operasional ─────────────────────────────────────────────────
  const expenseOf = (kind: string) =>
    db.expenses
      .filter((e) => e.kind === kind && within(e.date, p))
      .reduce((n, e) => n + e.amount, 0);
  // What a marketplace kept, on the sales of this period. Only where somebody
  // itemised the payout — an unitemised one is still inside the sale.
  const saleIds = new Set(salesInPeriod.map((o) => o.id));
  const marketplaceFees = db.settlements
    .filter((s) => saleIds.has(s.orderId))
    .reduce((n, s) => n + s.fees.reduce((m, f) => m + f.amount, 0), 0);
  const operating: PnlLine[] = [
    ...OPERATING_KINDS.map((k) => ({
      key: k,
      code: OPERATING_CODES[k],
      amount: expenseOf(k),
    }))
      // The two retired categories only while something old still uses them.
      .filter(
        (l) =>
          l.amount !== 0 || (l.key !== "PROFESSIONAL" && l.key !== "SOFTWARE"),
      ),
    { key: "marketplaceFees", code: "60600", amount: marketplaceFees },
  ];
  const totalOperating = sum(operating);
  const operatingProfit = grossProfit - totalOperating;

  // ── Non operasional ───────────────────────────────────────────────────
  const incomeOf = (reason: string) =>
    db.incomes
      .filter((i) => i.reason === reason && within(i.date, p))
      .reduce((n, i) => n + i.amount, 0);
  const otherIncome: PnlLine[] = [
    { key: "interestIn", code: "70000", amount: incomeOf("BUNGA") },
    { key: "mismatchIn", code: "70100", amount: incomeOf("SELISIH") },
  ];
  const otherExpense: PnlLine[] = [
    { key: "interestOut", code: "80000", amount: expenseOf("BUNGA") },
    { key: "mismatchOut", code: "80100", amount: expenseOf("SELISIH") },
    { key: "compensation", code: "80200", amount: expenseOf("KOMPENSASI") },
    {
      key: "stockAdjust",
      code: "81000",
      amount: stockWriteOffs(db, p, unitCost),
    },
  ];
  const totalOther = sum(otherIncome) - sum(otherExpense);

  return {
    revenue,
    totalRevenue,
    cogs,
    totalCogs,
    grossProfit,
    operating,
    totalOperating,
    operatingProfit,
    otherIncome,
    otherExpense,
    totalOther,
    netProfit: operatingProfit + totalOther,
    sales,
  };
}

/**
 * Penyesuaian barang — stock lost or found, at cost. A unit marked lost or
 * written off is its cost; one found again gives it back. A counted product's
 * stock-count and correction moves count the same way, except a correction
 * that belongs to a sale (Edit transaction), which is the sale's own cost.
 */
function stockWriteOffs(
  db: MockDb,
  p: Period,
  unitCost: (serial: string) => number,
): number {
  let total = 0;
  const bySerial = new Map<string, MockDb["events"]>();
  for (const e of db.events) {
    const list = bySerial.get(e.serial) ?? [];
    list.push(e);
    bySerial.set(e.serial, list);
  }
  const GONE = new Set(["HILANG", "KOREKSI_KELUAR"]);
  for (const [serial, list] of bySerial) {
    list.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < list.length; i += 1) {
      const e = list[i]!;
      if (!within(e.at, p)) continue;
      const before = i > 0 ? list[i - 1]!.toStatus : null;
      const lost = GONE.has(e.toStatus) && !GONE.has(before ?? "");
      const found = !GONE.has(e.toStatus) && GONE.has(before ?? "");
      if (lost) total += unitCost(serial);
      if (found) total -= unitCost(serial);
    }
  }
  for (const m of db.stockMoves) {
    if (!within(m.at, p)) continue;
    if (m.type !== "OPNAME" && m.type !== "KOREKSI") continue;
    if (m.orderId !== undefined || m.orderLineId !== undefined) continue;
    total += -m.qty * m.cost;
  }
  return total;
}

const sum = (lines: readonly PnlLine[]): number =>
  lines.reduce((n, l) => n + l.amount, 0);

/** No "-0": a line with nothing taken off is zero, not minus zero. */
const clean = (lines: PnlLine[]): PnlLine[] =>
  lines.map((l) => (Object.is(l.amount, -0) ? { ...l, amount: 0 } : l));

/** The calendar month containing `d`, local time. */
export function monthPeriod(d: Date): Period {
  return {
    from: new Date(d.getFullYear(), d.getMonth(), 1),
    until: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}
