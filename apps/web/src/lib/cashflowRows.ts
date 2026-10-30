/**
 * Every movement of money, from every source, reduced to one row — what
 * Income & Expense lists and what Reconciliation counts (2026-10-27).
 *
 * It lived inside `CashflowPage`. Reconciliation needs the very same rows —
 * "the POS balance" there means exactly the Cash and Bank cards on Income &
 * Expense (owner answer 2026-10-27) — and a second projection beside the
 * first would be two answers to "what moved today" that drift the first time
 * somebody adds a source to one of them. So the projection moved here,
 * unchanged, and each row now also says WHICH record it came from
 * (`source`), which is what lets a reconciliation correct the real record.
 *
 * A `Payment` is a row, a `SaleRefund` is a row, a `ManualIncome` is a row,
 * an `Expense` is a row. Aggregating a split sale into one lump is the shape
 * this used to have and it was wrong the way half-cash-half-Shopee is wrong:
 * two facts about one receipt reported as one.
 *
 * Pure: no React, no store. `t` is passed in for the descriptions.
 */
import type { MockDb, Order } from "../mock/seed.js";
import { EXPENSE_CATEGORIES, INCOME_REASONS } from "../mock/seed.js";
import type { TFunction } from "../i18n/translate.js";
import { labelOf } from "../i18n/enumLabels.js";
import { balancesOf, type Balances } from "./accounts.js";
import { customerLabel } from "./customers.js";
import { fmtNone } from "./format.js";
import { paymentsOf } from "./salePayments.js";
import { returnedDebts } from "./saleStatus.js";
import type { AdjustmentRef } from "./adjustmentDeletion.js";

/** Category label maps, derived from `seed.ts` so there is one vocabulary. */
export const INCOME_REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(INCOME_REASONS.map((r) => [r.value, r.label])),
  // A reservation's DP (2026-10-27) — derived rows only, never typed: the
  // money a customer paid to hold a unit, and the same money once they did
  // not come back for it (`lib/dp.ts`).
  DP: "DP received",
  DP_HANGUS: "DP hangus",
};
export const EXPENSE_KIND_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
);

export type Direction = "INCOME" | "EXPENSE";

/** The record a row was read off — what a correction is written to. */
export type MovementSource =
  | {
      readonly kind: "salePayment";
      readonly orderId: string;
      readonly paymentId: string;
    }
  | {
      readonly kind: "refund";
      readonly orderId: string;
      readonly refundId: string;
    }
  | {
      readonly kind: "openingPayment";
      readonly customerId: string;
      readonly paymentId: string;
    }
  | {
      readonly kind: "poPayment";
      readonly poId: string;
      readonly paymentId: string;
    }
  | { readonly kind: "deposit"; readonly depositId: string }
  | { readonly kind: "expense"; readonly id: string }
  | { readonly kind: "income"; readonly id: string };

/** What a row is, once every source has been reduced to it. */
export interface CashflowRow {
  readonly key: string;
  readonly at: string;
  readonly direction: Direction;
  /** An `IncomeReason` or an `ExpenseKind`, per `direction`. */
  readonly category: string;
  /** How the money moved, spelled for a human. */
  readonly method: string;
  /** The `PaymentMethod` code behind `method` — what decides the pot. */
  readonly methodCode: string;
  /**
   * False when the money never passed through the shop's cash or bank
   * (`inBalance`, owner answer 2026-09-22). Listed, so the debt it settled
   * has a line; never counted, so the balance says what is really held.
   */
  readonly inBalance: boolean;
  readonly description: string;
  /** The order's code, when a row belongs to a sale or an invoice. */
  readonly orderCode?: string;
  /** Always positive. `direction` is the sign. */
  readonly amount: number;
  /**
   * The two `…_RETURNED` are a sale's debt a return cancelled — voided
   * income, listed and never counted (`isVoided`).
   */
  readonly status:
    "SETTLED" | "PENDING" | "DUE" | "UNPAID_RETURNED" | "PARTLY_PAID_RETURNED";
  /**
   * Orders rows that share an instant — and every hand-typed row of one day
   * does, since an adjustment carries a date and no time: when it was typed
   * (`createdAt`), empty for everything else.
   */
  readonly tie: string;
  /** The `Expense` / `ManualIncome` behind a typed row — what Delete removes. */
  readonly adjustment?: AdjustmentRef & { readonly date: string };
  /** The record behind the row. Absent on a voided debt, which is no record. */
  readonly source?: MovementSource;
  /**
   * On a marketplace payment: what the platform kept of it (its settlement's
   * deductions; below zero when it paid more). The payment stays at what the
   * customer paid and the deduction is its own row (`feeOf`), so the sale is
   * the sale and the bank still gets only what landed (owner 2026-10-30).
   */
  readonly deducted?: number;
  /**
   * On that deduction's own row: the key of the payment row it came off.
   * Derived from the settlement — corrected in Edit transaction, never here.
   */
  readonly feeOf?: string;
}

/** A debt a return cancelled: listed in Accrual, never counted anywhere. */
export const isVoided = (r: CashflowRow): boolean =>
  r.status === "UNPAID_RETURNED" || r.status === "PARTLY_PAID_RETURNED";

/**
 * When a typed row happened: the day somebody picked, at the clock time they
 * typed it (owner ask 2026-10-24: an hour and minute on every row). The day is
 * theirs to back-date; the time is the only one there is. A row with no
 * `createdAt` sits at noon, so it sorts among the day's sales rather than
 * always above them — midnight would be a claim it does not make.
 */
export function typedAt(date: string, createdAt: string | undefined): string {
  const typed = createdAt === undefined ? undefined : new Date(createdAt);
  if (typed === undefined || Number.isNaN(typed.getTime()))
    return `${date}T12:00:00.000Z`;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(
    y,
    m - 1,
    d,
    typed.getHours(),
    typed.getMinutes(),
    typed.getSeconds(),
    typed.getMilliseconds(),
  ).toISOString();
}

/**
 * Oldest first, and TOTAL: by instant, then by `tie`, then by key.
 *
 * ⚠️ Without the last two the order of a day's typed rows was whatever order
 * the collections happened to hold them in, and the table — sorted newest
 * first by a stable sort — kept them in that same order, oldest on top. So
 * the "Latest balance" on the first row of a busy day was not the latest: on
 * 2026-10-24 it read Rp 21.722.500 above two expenses that had already taken
 * it to Rp 21.622.200, and the shop counted the Rp 100.300 as missing (owner
 * report, 2026-10-24). The table now sorts on this order's position, so the
 * walk and the view cannot disagree.
 */
export function chronological(a: CashflowRow, b: CashflowRow): number {
  return (
    a.at.localeCompare(b.at) ||
    a.tie.localeCompare(b.tie) ||
    a.key.localeCompare(b.key)
  );
}

/** Auto-generate a description for a movement rooted in a sale. */
export function saleDescription(o: Order, t: TFunction): string {
  return t("cashflow.saleDescription", "Sale via {{channel}}", {
    channel: o.source.toLowerCase(),
  });
}

type CashflowDb = Pick<
  MockDb,
  | "orders"
  | "events"
  | "stockMoves"
  | "incomes"
  | "expenses"
  | "returns"
  | "pos"
  | "deposits"
  | "suppliers"
  | "customers"
  | "paymentMethods"
> &
  Partial<Pick<MockDb, "reservations" | "settlements">>;

/** How far apart one save's two writes can be stamped. */
const SAME_SAVE_MS = 2 * 60_000;

/**
 * The REFUND adjustments the customer return desk wrote beside the money it
 * had already recorded on the sale, until 2026-10-30 (audit): an `Expense`
 * repeating the sale's refunds and a `ManualIncome` repeating an exchange's
 * top-up payment — the same rupiah twice on Income & Expense and against the
 * statement. Recognised by what that save wrote and nothing a person types:
 * no order and no supplier return named, the same method, and an amount equal
 * to what the sale recorded in the SAME save (stamped within a couple of
 * minutes). Returns the row keys to leave out.
 */
export function returnDuplicates(
  db: Pick<MockDb, "orders" | "incomes" | "expenses">,
): Set<string> {
  const near = (a: string, b: string | undefined) =>
    b !== undefined &&
    Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= SAME_SAVE_MS;
  const out = new Set<string>();
  for (const e of db.expenses) {
    if (e.kind !== "REFUND" || e.orderId !== undefined) continue;
    if (e.createdAt === undefined) continue;
    const handed = db.orders
      .flatMap((o) => o.refunds ?? [])
      .filter((r) => r.method === e.method && near(r.at, e.createdAt))
      .reduce((n, r) => n + r.amount, 0);
    if (handed === e.amount) out.add(`e-${e.id}`);
  }
  for (const i of db.incomes) {
    if (i.reason !== "REFUND" || i.orderId !== undefined) continue;
    if (i.returnId !== undefined || i.createdAt === undefined) continue;
    const taken = db.orders.some((o) =>
      (o.payments ?? []).some(
        (p) =>
          p.method === i.method &&
          p.amount === i.amount &&
          p.note?.startsWith("Exchange top-up") === true &&
          near(p.at, i.createdAt),
      ),
    );
    if (taken) out.add(`i-${i.id}`);
  }
  return out;
}

/** Every movement, newest first in the one total order (`chronological`). */
export function cashflowRows(db: CashflowDb, t: TFunction): CashflowRow[] {
  /** Method-code → the human label from `PaymentMethod.label`. */
  const methodLabel = (code: string) =>
    db.paymentMethods.find((m) => m.code === code)?.label ?? code;
  /** The receipt an adjustment names, where its category needs one. */
  const orderCodeOf = (id?: string) =>
    id === undefined ? undefined : db.orders.find((o) => o.id === id)?.code;

  const out: CashflowRow[] = [];
  const debts = returnedDebts(db.orders, db.events, db.stockMoves);
  for (const o of db.orders) {
    /*
     * What a return cancelled of this sale's debt — at the sale, where the
     * DUE row it replaces stood. No method: nothing moved, and naming the
     * one a shortfall row defaults to would put it in a pot.
     */
    const voided = debts.get(o.id);
    if (voided !== undefined && voided.cancelled > 0) {
      out.push({
        key: `rd-${o.id}`,
        at: o.ts,
        direction: "INCOME",
        category: "SALES",
        method: fmtNone(),
        methodCode: "",
        inBalance: false,
        description: saleDescription(o, t),
        orderCode: o.code,
        amount: voided.cancelled,
        status: voided.paid > 0 ? "PARTLY_PAID_RETURNED" : "UNPAID_RETURNED",
        tie: "",
      });
    }
    for (const p of paymentsOf(o)) {
      // Only while the part is still a marketplace's: a payment corrected to
      // cash keeps its id, and its old settlement must not keep a fee on it.
      const settlement =
        p.channel === undefined
          ? undefined
          : db.settlements?.find((s) => s.paymentId === p.id);
      const kept =
        settlement === undefined ? 0 : settlement.gross - settlement.received;
      out.push({
        key: `p-${o.id}-${p.id}`,
        at: p.at,
        direction: "INCOME",
        // A DP the sale took is the money that came in on its own day — the
        // same row the reservation listed, still under its own name.
        category: p.reservationId === undefined ? "SALES" : "DP",
        method: methodLabel(p.method),
        methodCode: p.method,
        inBalance: p.inBalance !== false,
        description: saleDescription(o, t),
        orderCode: o.code,
        amount: p.amount,
        status: p.state,
        tie: "",
        source: { kind: "salePayment", orderId: o.id, paymentId: p.id },
        ...(kept !== 0 ? { deducted: kept } : {}),
      });
      /*
       * What the marketplace kept, as an expense beside the sale rather than
       * netted into it (owner 2026-10-30): the same instant, pot and state as
       * the payment, so the balance moves by exactly what landed. Shopee
       * paying MORE than the published fees nets below zero — that is money
       * in, filed as a balance mismatch.
       */
      if (settlement !== undefined && kept !== 0) {
        // The names the deductions were typed with; the kind codes have no
        // translated label, and an English one would be invisible in English.
        const names = settlement.fees
          .filter((f) => f.amount !== 0 && f.label)
          .map((f) => f.label)
          .join(", ");
        out.push({
          key: `fee-${o.id}-${p.id}`,
          at: p.at,
          direction: kept > 0 ? "EXPENSE" : "INCOME",
          category: kept > 0 ? "BIAYA_ADMIN" : "SELISIH",
          method: methodLabel(p.method),
          methodCode: p.method,
          inBalance: p.inBalance !== false,
          description:
            t("cashflow.keptByMarketplace", "Kept by {{channel}}", {
              channel: settlement.channel,
            }) + (names ? ` · ${names}` : ""),
          orderCode: o.code,
          amount: Math.abs(kept),
          status: p.state,
          tie: "",
          feeOf: `p-${o.id}-${p.id}`,
        });
      }
    }
    for (const r of o.refunds ?? []) {
      out.push({
        key: `rf-${o.id}-${r.id}`,
        at: r.at,
        direction: "EXPENSE",
        category: "REFUND",
        method: methodLabel(r.method),
        methodCode: r.method,
        inBalance: true,
        description:
          r.note?.trim() ||
          t("cashflow.refundOnSale", "Refund on sale {{code}}", {
            code: o.code,
          }),
        orderCode: o.code,
        amount: r.amount,
        status: "SETTLED",
        tie: "",
        source: { kind: "refund", orderId: o.id, refundId: r.id },
      });
    }
  }
  const duplicate = returnDuplicates(db);
  for (const i of db.incomes) {
    if (duplicate.has(`i-${i.id}`)) continue;
    // A supplier's refund names its return (2026-10-26): the SP code is
    // what anybody checking it against the bank statement asks for.
    const sp =
      i.returnId === undefined
        ? undefined
        : db.returns.find((r) => r.id === i.returnId)?.code;
    const said = i.note?.trim() || labelOf(INCOME_REASON_LABEL, i.reason, t);
    const code = orderCodeOf(i.orderId);
    out.push({
      key: `i-${i.id}`,
      at: typedAt(i.date, i.createdAt),
      direction: "INCOME",
      category: i.reason,
      method: methodLabel(i.method),
      methodCode: i.method,
      inBalance: true,
      description: sp ? `${said} · ${sp}` : said,
      ...(code ? { orderCode: code } : {}),
      amount: i.amount,
      status: "SETTLED",
      tie: i.createdAt ?? "",
      adjustment: { kind: "income", id: i.id, date: i.date },
      source: { kind: "income", id: i.id },
    });
  }
  for (const e of db.expenses) {
    if (duplicate.has(`e-${e.id}`)) continue;
    const code = orderCodeOf(e.orderId);
    out.push({
      key: `e-${e.id}`,
      at: typedAt(e.date, e.createdAt),
      direction: "EXPENSE",
      category: e.kind,
      method: methodLabel(e.method),
      methodCode: e.method,
      inBalance: true,
      description:
        e.label ?? e.note?.trim() ?? labelOf(EXPENSE_KIND_LABEL, e.kind, t),
      ...(code ? { orderCode: code } : {}),
      amount: e.amount,
      status: "SETTLED",
      tie: e.createdAt ?? "",
      adjustment: { kind: "expense", id: e.id, date: e.date },
      source: { kind: "expense", id: e.id },
    });
  }
  /*
   * Money paid to suppliers. A deposit is the day the money left; a payment
   * allocated OUT of one moved nothing that day, and counting it again would
   * spend the deposit twice (`lib/accounts.ts`).
   */
  const supplierName = (id: string) =>
    db.suppliers.find((x) => x.id === id)?.name ||
    t("utang.noSupplier", "No supplier named");
  for (const po of db.pos) {
    for (const p of po.payments) {
      if (p.fromDepositId) continue;
      // A supplier return's credit (2026-10-26) moved no money at all: the
      // invoice owes less, and that is Payable's to show, not this page's.
      if (p.method === "RETUR_SUPPLIER" || p.returnId !== undefined) continue;
      out.push({
        key: `pp-${po.id}-${p.id}`,
        at: p.at,
        direction: "EXPENSE",
        category: "SUPPLIER",
        method: methodLabel(p.method),
        methodCode: p.method,
        inBalance: p.inBalance !== false,
        description: t("cashflow.paidTo", "Paid to {{name}}", {
          name: supplierName(po.supplierId),
        }),
        orderCode: po.code,
        amount: p.amount,
        status: "SETTLED",
        tie: "",
        source: { kind: "poPayment", poId: po.id, paymentId: p.id },
      });
    }
  }
  for (const d of db.deposits) {
    out.push({
      key: `dep-${d.id}`,
      at: d.at,
      direction: "EXPENSE",
      category: "SUPPLIER",
      method: methodLabel(d.method),
      methodCode: d.method,
      inBalance: d.inBalance !== false,
      description:
        d.note?.trim() ||
        t("cashflow.depositWith", "Deposit with {{name}}", {
          name: supplierName(d.supplierId),
        }),
      amount: d.amount,
      status: "SETTLED",
      tie: "",
      source: { kind: "deposit", depositId: d.id },
    });
  }
  // Payments off a debt from before this app. Customers only since
  // 2026-09-24: a supplier's old debt is no longer recorded at all.
  for (const c of db.customers) {
    for (const p of c.openingPayments ?? []) {
      out.push({
        key: `cop-${c.id}-${p.id}`,
        at: p.at,
        direction: "INCOME",
        category: "SALES",
        method: methodLabel(p.method),
        methodCode: p.method,
        inBalance: p.inBalance !== false,
        description:
          p.note?.trim() ||
          t("cashflow.oldDebtTo", "{{name}} — debt from before this app", {
            name: customerLabel(c),
          }),
        amount: p.amount,
        status: "SETTLED",
        tie: "",
        source: { kind: "openingPayment", customerId: c.id, paymentId: p.id },
      });
    }
  }
  out.push(...dpRows(db, t, methodLabel));
  // Newest first, so the top of the page is what happened last.
  return out.sort((a, b) => chronological(b, a));
}

/**
 * A reservation's DP and its refund (owner, 2026-10-27). Listed when the
 * money came in — cash basis, in the pot its method names — and ONLY while no
 * sale has taken it: once one has, the sale's payment list carries the same
 * payment (above, category DP), so it is counted once. A kept DP stays the
 * same row and reads *DP hangus*; a refund is money out.
 *
 * No `source`: a DP is corrected on /reservations, not by a reconciliation.
 */
function dpRows(
  db: CashflowDb,
  t: TFunction,
  methodLabel: (code: string) => string,
): CashflowRow[] {
  const out: CashflowRow[] = [];
  for (const r of db.reservations ?? []) {
    const dp = r.dp;
    if (dp === undefined || dp.orderId !== undefined) continue;
    const who = db.customers.find((c) => c.id === r.customerId);
    const name = who ? customerLabel(who) : r.code;
    out.push({
      key: `dp-${r.id}`,
      at: dp.at,
      direction: "INCOME",
      category:
        r.status === "CANCELLED" && dp.refund === undefined
          ? "DP_HANGUS"
          : "DP",
      method: methodLabel(dp.method),
      methodCode: dp.method,
      inBalance: true,
      description:
        dp.note?.trim() || t("cashflow.dpFrom", "DP from {{name}}", { name }),
      orderCode: r.code,
      amount: dp.amount,
      status: "SETTLED",
      tie: "",
    });
    if (dp.refund !== undefined)
      out.push({
        key: `dpr-${r.id}`,
        at: dp.refund.at,
        direction: "EXPENSE",
        category: "REFUND",
        method: methodLabel(dp.refund.method),
        methodCode: dp.refund.method,
        inBalance: true,
        description: t("cashflow.dpRefundTo", "DP refunded to {{name}}", {
          name,
        }),
        orderCode: r.code,
        amount: dp.refund.amount,
        status: "SETTLED",
        tie: "",
      });
  }
  return out;
}

/** The parts of `AppSettings` a balance starts from. */
export interface OpeningSettings {
  readonly openingCash?: number;
  readonly openingBank?: number;
  /** ISO instant; the opening figures already hold everything before it. */
  readonly openingBalanceAt?: string;
}

/**
 * Does this row move a pot's real balance? Cash basis — what Income &
 * Expense's Cash and Bank cards count, and what Reconciliation calls the POS
 * balance: settled, not voided, through the shop's own cash or bank, and on
 * or after the opening balance.
 */
export function movesBalance(
  r: CashflowRow,
  settings: OpeningSettings,
  accrual = false,
): boolean {
  return (
    r.inBalance &&
    !isVoided(r) &&
    r.at >= (settings.openingBalanceAt ?? "") &&
    (accrual || r.status === "SETTLED")
  );
}

/**
 * What is in the drawer and in the bank (owner ask 2026-10-22), from the
 * opening balance on — `balancesOf` over the rows that move a balance.
 * `accrual` adds what is promised: a marketplace payout still pending counts
 * toward the bank, a customer's debt toward the pot its method names. `until`
 * (an instant, exclusive) stops the walk — a reconciliation's end of day.
 */
export function balancesOfRows(
  rows: readonly CashflowRow[],
  settings: OpeningSettings,
  options: { readonly accrual?: boolean; readonly until?: string } = {},
): Balances {
  return balancesOf(
    rows
      .filter(
        (r) =>
          movesBalance(r, settings, options.accrual === true) &&
          (options.until === undefined || r.at < options.until),
      )
      .map((r) => ({
        method: r.methodCode,
        amount: r.direction === "INCOME" ? r.amount : -r.amount,
      })),
    { cash: settings.openingCash ?? 0, bank: settings.openingBank ?? 0 },
  );
}
