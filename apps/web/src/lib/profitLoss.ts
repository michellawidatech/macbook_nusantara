/**
 * Profit & Loss — Laba Rugi (owner ask 2026-10-23: *"add a PnL page / report
 * … it has to follow templates like the one Olsera uses"*).
 *
 * The layout is Olsera Akunting's *Laporan Laba Rugi*: Pendapatan, Biaya
 * pokok penjualan, Laba kotor, Biaya operasional, Pendapatan bersih
 * operasional, the non-operating income and costs, and Laba bersih, with
 * what is taken off in brackets. Olsera's account codes are left off (owner,
 * the same day: *"the number on the left … I don't think I need to see it"*).
 *
 * Every line carries the transactions it was added up from (`items`) — the
 * page lists them beside the statement and exports them.
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

/** One transaction behind a line. `amount` is signed as the line adds it. */
export interface PnlItem {
  /** ISO instant or YYYY-MM-DD. */
  readonly date: string;
  /** The document — SI-…, SG-… — or empty for an expense with none. */
  readonly ref: string;
  /** What it is: the product and serial, the expense's note. */
  readonly description: string;
  readonly amount: number;
}

/** One line of the report. `amount` is signed as it adds into its section. */
export interface PnlLine {
  readonly key: string;
  readonly amount: number;
  readonly items: readonly PnlItem[];
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

/** The two categories no longer offered; listed only while something uses them. */
const RETIRED = new Set(["PROFESSIONAL", "SOFTWARE"]);

const within = (iso: string | undefined, p: Period): boolean => {
  if (iso === undefined || iso === "") return false;
  // A bare date (an expense's `date`) is that LOCAL day.
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`)
    : new Date(iso);
  return t >= p.from && t < p.until;
};

/** Collects a line's items and its total together, so the two cannot drift. */
class LineBuilder {
  readonly items: PnlItem[] = [];
  add(item: PnlItem): void {
    if (item.amount !== 0) this.items.push(item);
  }
  line(key: string): PnlLine {
    const amount = this.items.reduce((n, i) => n + i.amount, 0);
    return { key, amount: amount === 0 ? 0 : amount, items: this.items };
  }
}

/** A sale's pieces, each with what it fetched and what it cost. */
interface SoldPiece {
  readonly order: MockDb["orders"][number];
  readonly skuId: string;
  /** Serial, or empty for a counted product. */
  readonly serial: string;
  readonly qty: number;
  readonly list: number;
  readonly price: number;
  readonly cost: number;
}

function soldPieces(db: MockDb, p: Period): SoldPiece[] {
  const cost = costIndex(db);
  const unitOf = new Map(db.units.map((u) => [u.serial, u]));
  const out: SoldPiece[] = [];
  for (const o of db.orders) {
    if (!within(o.ts, p)) continue;
    for (const s of o.serials) {
      const u = unitOf.get(s);
      const price = o.prices[s] ?? 0;
      out.push({
        order: o,
        skuId: u?.skuId ?? "",
        serial: s,
        qty: 1,
        price,
        list: o.listPrices?.[s] ?? price,
        cost: u === undefined ? 0 : cost(u).total,
      });
    }
    for (const l of o.lines ?? []) {
      out.push({
        order: o,
        skuId: l.skuId,
        serial: "",
        qty: l.qty,
        price: l.price,
        list: l.listPrice ?? l.price,
        cost: lineCost(db.stockMoves, l.id),
      });
    }
  }
  return out;
}

/** Profit & Loss for one period. */
export function profitLoss(db: MockDb, p: Period): ProfitLoss {
  const cost = costIndex(db);
  const unitOf = new Map(db.units.map((u) => [u.serial, u]));
  const unitCost = (serial: string): number => {
    const u = unitOf.get(serial);
    return u === undefined ? 0 : cost(u).total;
  };
  const skuName = skuNamer(db);
  const nameOfSerial = (serial: string) =>
    `${skuName(unitOf.get(serial)?.skuId ?? "")} · ${serial}`;
  const pieceName = (x: SoldPiece) =>
    x.serial !== "" ? nameOfSerial(x.serial) : `${skuName(x.skuId)} ×${x.qty}`;

  // ── Pendapatan ────────────────────────────────────────────────────────
  const sales = new LineBuilder();
  const outside = new LineBuilder();
  const charges = new LineBuilder();
  const discounts = new LineBuilder();
  const returns = new LineBuilder();
  const cogsSold = new LineBuilder();
  const pieces = soldPieces(db, p);
  for (const x of pieces) {
    // The shop's asking price, plus anything charged above it; what was
    // knocked off it is a discount, as Olsera's Potongan penjualan.
    sales.add({
      date: x.order.ts,
      ref: x.order.code,
      description: pieceName(x),
      amount: Math.max(x.list, x.price) * x.qty,
    });
    discounts.add({
      date: x.order.ts,
      ref: x.order.code,
      description: pieceName(x),
      amount: -Math.max(0, x.list - x.price) * x.qty,
    });
    cogsSold.add({
      date: x.order.ts,
      ref: x.order.code,
      description: pieceName(x),
      amount: x.cost,
    });
  }
  const salesInPeriod = db.orders.filter((o) => within(o.ts, p));
  for (const o of salesInPeriod) {
    discounts.add({
      date: o.ts,
      ref: o.code,
      description: db.discounts.find((d) => d.id === o.discountId)?.code ?? "",
      amount: -o.discount,
    });
    charges.add({
      date: o.ts,
      ref: o.code,
      description: o.extraNote ?? "",
      amount: o.extra ?? 0,
    });
  }
  // Takings this app did not ring up, entered by hand.
  for (const i of db.incomes)
    if (i.reason === "SALES" && within(i.date, p))
      outside.add({
        date: i.date,
        ref: "",
        description: i.note ?? "",
        amount: i.amount,
      });
  // Returns fall on their OWN date, whatever month the sale was in.
  for (const o of db.orders)
    for (const a of o.adjustments ?? [])
      if (a.type === "RETUR" && within(a.at, p))
        returns.add({
          date: a.at,
          ref: a.code ?? o.code,
          description: `${o.code} · ${a.reason}`,
          amount: -a.amount,
        });

  const revenue: PnlLine[] = [
    sales.line("sales"),
    outside.line("outsideSales"),
    charges.line("charges"),
    discounts.line("discounts"),
    returns.line("returns"),
  ];
  const totalRevenue = sum(revenue);

  // ── Biaya pokok penjualan ─────────────────────────────────────────────
  // What came back goes back into stock at what it cost — unless the return
  // was taken back since, which put the unit back out.
  const withdrawn = new Set(
    db.returns.filter((r) => r.status === "CANCELLED").map((r) => r.code),
  );
  const cogsBack = new LineBuilder();
  for (const e of db.events)
    if (
      e.type === "RETUR_PELANGGAN" &&
      within(e.at, p) &&
      !(e.refCode !== undefined && withdrawn.has(e.refCode))
    )
      cogsBack.add({
        date: e.at,
        ref: e.refCode ?? "",
        description: nameOfSerial(e.serial),
        amount: -unitCost(e.serial),
      });
  for (const m of db.stockMoves)
    if (m.type === "RETUR_PELANGGAN" && within(m.at, p))
      cogsBack.add({
        date: m.at,
        ref: m.refCode ?? "",
        description: `${skuName(m.skuId)} ×${m.qty}`,
        amount: -m.qty * m.cost,
      });
  const cogs: PnlLine[] = [
    cogsSold.line("cogsSold"),
    cogsBack.line("cogsReturned"),
  ];
  const totalCogs = sum(cogs);
  const grossProfit = totalRevenue - totalCogs;

  // ── Biaya operasional ─────────────────────────────────────────────────
  const expenseLine = (kind: string): PnlLine => {
    const b = new LineBuilder();
    for (const e of db.expenses)
      if (e.kind === kind && within(e.date, p))
        b.add({
          date: e.date,
          ref: db.orders.find((o) => o.id === e.orderId)?.code ?? "",
          description: [e.label, e.note].filter(Boolean).join(" · "),
          amount: e.amount,
        });
    return b.line(kind);
  };
  // What a marketplace kept, on the sales of this period. Only where somebody
  // itemised the payout — an unitemised one is still inside the sale.
  const saleOf = new Map(salesInPeriod.map((o) => [o.id, o]));
  const fees = new LineBuilder();
  for (const s of db.settlements) {
    const o = saleOf.get(s.orderId);
    if (o === undefined) continue;
    for (const f of s.fees)
      fees.add({
        date: o.ts,
        ref: o.code,
        description: `${s.channel} · ${f.label ?? f.kind}`,
        amount: f.amount,
      });
  }
  const operating: PnlLine[] = [
    ...OPERATING_KINDS.map(expenseLine).filter(
      (l) => l.amount !== 0 || !RETIRED.has(l.key),
    ),
    fees.line("marketplaceFees"),
  ];
  const totalOperating = sum(operating);
  const operatingProfit = grossProfit - totalOperating;

  // ── Non operasional ───────────────────────────────────────────────────
  const incomeLine = (reason: string, key: string): PnlLine => {
    const b = new LineBuilder();
    for (const i of db.incomes)
      if (i.reason === reason && within(i.date, p))
        b.add({
          date: i.date,
          ref: "",
          description: i.note ?? "",
          amount: i.amount,
        });
    return b.line(key);
  };
  const otherIncome: PnlLine[] = [
    incomeLine("BUNGA", "interestIn"),
    incomeLine("SELISIH", "mismatchIn"),
  ];
  const otherExpense: PnlLine[] = [
    { ...expenseLine("BUNGA"), key: "interestOut" },
    { ...expenseLine("SELISIH"), key: "mismatchOut" },
    { ...expenseLine("KOMPENSASI"), key: "compensation" },
    stockWriteOffs(db, p, unitCost, nameOfSerial, skuName),
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
    sales: salesInPeriod.length,
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
  nameOfSerial: (serial: string) => string,
  skuName: (skuId: string) => string,
): PnlLine {
  const b = new LineBuilder();
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
      const before = i > 0 ? list[i - 1]!.toStatus : "";
      const lost = GONE.has(e.toStatus) && !GONE.has(before);
      const found = !GONE.has(e.toStatus) && GONE.has(before);
      if (lost || found)
        b.add({
          date: e.at,
          ref: e.refCode ?? "",
          description: nameOfSerial(serial),
          amount: (lost ? 1 : -1) * unitCost(serial),
        });
    }
  }
  for (const m of db.stockMoves) {
    if (!within(m.at, p)) continue;
    if (m.type !== "OPNAME" && m.type !== "KOREKSI") continue;
    if (m.orderId !== undefined || m.orderLineId !== undefined) continue;
    b.add({
      date: m.at,
      ref: m.refCode ?? "",
      description: `${skuName(m.skuId)} ×${m.qty}`,
      amount: -m.qty * m.cost,
    });
  }
  return b.line("stockAdjust");
}

const sum = (lines: readonly PnlLine[]): number =>
  lines.reduce((n, l) => n + l.amount, 0);

function skuNamer(db: MockDb): (skuId: string) => string {
  const skus = new Map(db.skus.map((k) => [k.id, k]));
  return (id) => {
    const k = skus.get(id);
    return k ? `${k.name} ${k.variantLabel}`.trim() : id;
  };
}

/** The calendar month containing `d`, local time. */
export function monthPeriod(d: Date): Period {
  return {
    from: new Date(d.getFullYear(), d.getMonth(), 1),
    until: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

/** One month of the trend: the three figures a graph and its table need. */
export interface MonthFigures {
  /** First day of the month. */
  readonly month: Date;
  readonly revenue: number;
  readonly grossProfit: number;
  readonly netProfit: number;
}

/** The `count` months ending with the one containing `last`, oldest first. */
export function monthlyProfitLoss(
  db: MockDb,
  last: Date,
  count: number,
): MonthFigures[] {
  const out: MonthFigures[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const month = new Date(last.getFullYear(), last.getMonth() - i, 1);
    const r = profitLoss(db, monthPeriod(month));
    out.push({
      month,
      revenue: r.totalRevenue,
      grossProfit: r.grossProfit,
      netProfit: r.netProfit,
    });
  }
  return out;
}

/** What one product made, per piece sold, in a period. */
export interface UnitProfitRow {
  readonly skuId: string;
  readonly name: string;
  readonly sold: number;
  readonly revenue: number;
  readonly cost: number;
  readonly profit: number;
  /** `profit / sold`. */
  readonly perUnit: number;
  /** `profit / revenue`, 0–1; 0 when nothing was fetched. */
  readonly margin: number;
}

/**
 * Average profit per unit, per product (owner ask 2026-10-23). A piece is
 * worth what it sold for less its share of the sale's discount code (split by
 * price), against what it cost. A unit that came back (a customer return
 * still standing) is not counted: it was not, in the end, sold.
 */
export function unitProfits(db: MockDb, p: Period): UnitProfitRow[] {
  const returned = new Set(
    db.returns
      .filter((r) => r.kind === "CUSTOMER" && r.status !== "CANCELLED")
      .map((r) => r.serial),
  );
  const skuName = skuNamer(db);
  const pieces = soldPieces(db, p);
  const orderValue = new Map<string, number>();
  for (const x of pieces)
    orderValue.set(
      x.order.id,
      (orderValue.get(x.order.id) ?? 0) + x.price * x.qty,
    );
  const rows = new Map<
    string,
    { sold: number; revenue: number; cost: number }
  >();
  for (const x of pieces) {
    if (x.serial !== "" && returned.has(x.serial)) continue;
    const value = orderValue.get(x.order.id) ?? 0;
    const gross = x.price * x.qty;
    const share =
      value === 0 ? 0 : Math.round((x.order.discount * gross) / value);
    const row = rows.get(x.skuId) ?? { sold: 0, revenue: 0, cost: 0 };
    row.sold += x.qty;
    row.revenue += gross - share;
    row.cost += x.cost;
    rows.set(x.skuId, row);
  }
  return [...rows.entries()]
    .map(([skuId, r]) => {
      const profit = r.revenue - r.cost;
      return {
        skuId,
        name: skuName(skuId),
        sold: r.sold,
        revenue: r.revenue,
        cost: r.cost,
        profit,
        perUnit: r.sold === 0 ? 0 : Math.round(profit / r.sold),
        margin: r.revenue === 0 ? 0 : profit / r.revenue,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}
