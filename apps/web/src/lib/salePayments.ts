/**
 * What a customer has actually handed over, and what they still owe.
 *
 * ## Three owner asks, one model (2026-09-08)
 *
 * > *"Customer can do a split payment … they might buy 5jt in cash and 5jt more
 * > in tokopedia instead of 1, so we need to track different payment handling
 * > and reflect it on invoice."*
 *
 * > *"We should also be able to edit how much the user have paid, for error
 * > handling, but keep a log for it … a customer can pay partially and have a
 * > due date of payment."*
 *
 * > *"In customer management, we know how much a customer still owes us, the
 * > pending from tokopedia/shopee, from split payment, etc."*
 *
 * All three are the same change: a sale stops having ONE payment method and a
 * settled flag, and starts having a LIST of receipts. Everything else falls
 * out of that — the split, the part payment, the due date, the marketplace
 * escrow, and the customer's balance, which is the sum over their sales.
 *
 * ## Why a list and not two columns
 *
 * The obvious cheap version is `paidAmount` plus `payMethod`, and it breaks on
 * the owner's own example: Rp5jt cash and Rp5jt Shopee PayLater are not one
 * payment of Rp10jt, because the cash is in the till TODAY and the PayLater
 * money is with Shopee until a withdrawal clears. Which half is which is the
 * whole question the finance screens are asked, and a single figure cannot
 * answer it. So each receipt carries its own method, its own channel and its
 * own state, and `Order.settled` becomes a projection over them.
 *
 * ## Pending is not unpaid
 *
 * A payment is in one of three states and they are genuinely different:
 *
 * - **SETTLED** — the money is the shop's. Cash, a transfer that cleared, a
 *   marketplace withdrawal that landed.
 * - **PENDING** — the customer has paid, and somebody else is holding it. Every
 *   marketplace sale starts here. It is NOT a debt the customer owes; chasing
 *   them for it would be chasing the wrong party.
 * - **DUE** — the customer has not paid. This is the debt, and the only state
 *   with a date on it.
 *
 * Netting the first two together is what the old `settled` boolean did, and it
 * is why "how much do our customers owe us?" had no answer: a Shopee sale
 * awaiting withdrawal looked exactly like a customer who had not paid.
 *
 * Money is whole rupiah numbers, as everywhere in the mock layer.
 *
 * Pure: no React, no store. `test/salePayments.test.ts` is the spec.
 */

/** Where one part of a bill stands. See the header. */
export type PaymentState =
  /** The money is the shop's. */
  | "SETTLED"
  /** Paid, but a marketplace is holding it. Not a customer debt. */
  | "PENDING"
  /** Not paid. The only state that carries a due date. */
  | "DUE";

/**
 * One part of what a sale was paid with.
 *
 * Mirrors prisma's `Payment` — which already has `orderId`, `methodId`,
 * `amount`, `status`, `paidAt` and `dueAt`, so most of this is a shape the
 * schema can carry. What it cannot carry is `channel`: `Payment` has no column
 * saying WHICH marketplace is holding the money, because until now that was a
 * fact about the order.
 *
 * ⚠️ Mock-only as a list on the order — see `Order.payments` in seed.ts.
 */
export interface SalePayment {
  readonly id: string;
  /** A `PaymentMethod` code — TUNAI, TRANSFER, QRIS, MARKETPLACE… */
  readonly method: string;
  readonly amount: number;
  readonly state: PaymentState;
  /**
   * Which marketplace is holding this part, when one is.
   *
   * Only meaningful while `state` is PENDING. It is per PAYMENT and not per
   * order because a split sale can be half cash and half Shopee PayLater, and
   * the order-level channel — where the sale came FROM — is a different fact
   * from where this particular money is sitting.
   */
  readonly channel?: string;
  /** When it was taken, or when it settled. */
  readonly at: string;
  /** DUE only: when the customer promised to pay. */
  readonly dueAt?: string;
  /** What staff wrote — "deposit", "sisa dibayar tunai". */
  readonly note?: string;
  /**
   * The marketplace's own order number — required on a Shopee, Tokopedia or
   * TikTok sale (owner ask 2026-09-19). It is what a marketplace's income
   * report names each payout by, so it is the key a report is matched on.
   * Prisma's `Payment.ref`.
   */
  readonly ref?: string;
  /**
   * Did this money reach the shop's cash or bank? (owner answer 2026-09-22.)
   * `false` when it went somewhere the balance does not keep — the owner's
   * own account — so the debt is settled and Income & Expense's balance does
   * not move. Absent means it counts. `Payment.inBalance`.
   */
  readonly inBalance?: boolean;
}

/**
 * Money handed BACK to the customer on a sale — what a return refunds (owner
 * brief 2026-09-19). Prisma's `Payment` with direction KELUAR on the order.
 *
 * A list of its own rather than a row in `payments` with a sign: `payments`
 * is what the customer paid, and every screen that reads it — the payment
 * editor, Receivables, the period's takings — would otherwise have to learn
 * that one kind of row means the opposite of the others.
 */
export interface SaleRefund {
  readonly id: string;
  /** A `PaymentMethod` code — how the money went back. */
  readonly method: string;
  readonly amount: number;
  readonly at: string;
  readonly note?: string;
}

/**
 * What a return took off a sale's bill — prisma's `OrderAdjustment`. A RETUR
 * carries the return's own SG code, which is what ties a return to the sale
 * it undid.
 */
export interface OrderAdjustmentRec {
  readonly id: string;
  readonly type: "RETUR" | "REFUND" | "VOID";
  readonly code?: string;
  readonly amount: number;
  readonly reason: string;
  readonly at: string;
}

/** A sale's bill after what returns took off it — what it is worth now. */
export function billAfterReturns(order: {
  readonly total: number;
  readonly adjustments?: readonly OrderAdjustmentRec[];
}): number {
  const off = (order.adjustments ?? [])
    .filter((a) => a.type === "RETUR")
    .reduce((t, a) => t + a.amount, 0);
  return Math.max(0, order.total - off);
}

/** What was handed back on a sale. */
export function refundedOf(order: {
  readonly refunds?: readonly SaleRefund[];
}): number {
  return (order.refunds ?? []).reduce((t, r) => t + r.amount, 0);
}

/**
 * One change to a payment, kept forever.
 *
 * *"Keep a log for it"* — and the reason is not audit theatre: the whole point
 * of allowing an edit is that somebody typed Rp5.000.000 when they meant
 * Rp500.000, and the way that gets found is a customer disputing a balance
 * three weeks later. What has to survive is the number BEFORE the edit, which
 * is the one thing an in-place correction destroys.
 *
 * ⚠️ Mock-only. Prisma has `AuditLog`, which is where this belongs when the
 * API carries it — it is a general before/after table and needs no new column.
 */
export interface PaymentLogEntry {
  readonly id: string;
  readonly paymentId: string;
  readonly at: string;
  readonly staff: string;
  /** What happened: added, amended, removed. */
  readonly action: "ADDED" | "AMENDED" | "REMOVED";
  /** The figures before, absent on an ADDED. */
  readonly before?: { readonly amount: number; readonly state: PaymentState };
  /** The figures after, absent on a REMOVED. */
  readonly after?: { readonly amount: number; readonly state: PaymentState };
  readonly reason?: string;
}

/** What one sale's money adds up to. */
export interface SaleBalance {
  /** The bill — what the customer owes in total. */
  readonly total: number;
  /** Money that is the shop's. */
  readonly settled: number;
  /** Money a marketplace is holding. Paid by the customer, not by the shop. */
  readonly pending: number;
  /** What the customer has promised and not yet paid. */
  readonly due: number;
  /** Everything recorded against the bill, whatever its state. */
  readonly recorded: number;
  /**
   * The bill minus everything recorded.
   *
   * Positive means part of the sale has no payment against it at all — not a
   * part payment somebody entered, but a gap nobody has accounted for. It is a
   * different thing from `due`, which is money a person has promised.
   */
  readonly unaccounted: number;
  /** True when every rupiah of the bill is in the shop's hands. */
  readonly fullySettled: boolean;
  /** What the CUSTOMER still owes: the due parts, plus anything unaccounted. */
  readonly customerOwes: number;
  /** The earliest promise date among the unpaid parts. */
  readonly nextDueAt?: string;
}

/**
 * Add one sale's money up.
 *
 * `unaccounted` is floored at zero on purpose: a sale over-recorded — a
 * deposit larger than the bill — is a different problem and not one this
 * function should express as a negative gap. `overpaid` is where that shows.
 *
 * `refunded` is money already handed back (`SaleRefund`): it leaves what the
 * shop holds, so it comes off `settled`. A bill of nothing — every unit
 * returned, or a trade-in worth the lot — is settled: there is nothing left
 * to collect.
 */
export function saleBalance(
  total: number,
  payments: readonly SalePayment[],
  refunded = 0,
): SaleBalance {
  const sum = (state: PaymentState) =>
    payments.filter((p) => p.state === state).reduce((t, p) => t + p.amount, 0);
  const settled = Math.max(0, sum("SETTLED") - refunded);
  const pending = sum("PENDING");
  const due = sum("DUE");
  const recorded = settled + pending + due;
  const unaccounted = Math.max(0, total - recorded);
  const dues = payments
    .filter((p) => p.state === "DUE" && p.dueAt)
    .map((p) => p.dueAt!)
    .sort();
  return {
    total,
    settled,
    pending,
    due,
    recorded,
    unaccounted,
    fullySettled: settled >= total,
    customerOwes: due + unaccounted,
    ...(dues[0] === undefined ? {} : { nextDueAt: dues[0] }),
  };
}

/** Money recorded above the bill — a deposit, or a mistake. */
export function overpaid(balance: SaleBalance): number {
  return Math.max(0, balance.recorded - balance.total);
}

/**
 * Is this sale settled, in the sense `Order.settled` has always meant?
 *
 * A projection over the payments, exactly as `Unit.status` is a projection
 * over the ledger. Written in the same mutation as whatever changed the
 * payments; nothing should set it by hand.
 *
 * "Settled" is deliberately strict: every rupiah of the bill is in the shop's
 * hands. A sale half-collected and half-pending is not settled, and neither is
 * one the customer still owes for — which is what the flag meant before this,
 * for the marketplace case, and now means for all of them.
 */
export function isSettled(
  total: number,
  payments: readonly SalePayment[],
  refunded = 0,
) {
  return saleBalance(total, payments, refunded).fullySettled;
}

/**
 * A recorded sale's balance, its returns included: the bill after what
 * returns took off it, against what was paid less what was handed back.
 * What every screen that shows one sale's money should ask.
 */
export function orderBalance(order: {
  readonly id: string;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly ts: string;
  readonly payments?: readonly SalePayment[];
  readonly refunds?: readonly SaleRefund[];
  readonly adjustments?: readonly OrderAdjustmentRec[];
}): SaleBalance {
  return saleBalance(
    billAfterReturns(order),
    paymentsOf(order),
    refundedOf(order),
  );
}

/**
 * The payment list a sale gets when nothing more specific is known.
 *
 * Every order written before this model existed carries `payMethod` and
 * `settled` and nothing else, and this is how those are read: one payment for
 * the whole bill, in the state the flag implies. It is not a migration — it is
 * the honest reading of what those two columns actually said.
 */
export function legacyPayments(order: {
  readonly id: string;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly ts: string;
}): SalePayment[] {
  return [
    {
      id: `${order.id}-legacy`,
      method: order.payMethod,
      amount: order.total,
      state: order.settled ? "SETTLED" : "PENDING",
      ...(order.settled ? {} : { channel: order.source }),
      at: order.ts,
    },
  ];
}

/** A sale's payments, however the order happens to carry them. */
export function paymentsOf(order: {
  readonly id: string;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly ts: string;
  readonly payments?: readonly SalePayment[];
  readonly adjustments?: readonly OrderAdjustmentRec[];
}): readonly SalePayment[] {
  if (order.payments && order.payments.length > 0) return order.payments;
  /*
   * A sale a return has touched had its payments written out by that return,
   * every time — so no payments there is the truth: everything was cancelled,
   * or moved to the sale an exchange went out on (2026-09-21). Reading it as
   * a sale from before the list existed invented one payment for the whole
   * ORIGINAL total, and the balance counted money nobody received. Keyed on
   * the RETUR rather than on an empty array because Postgres projects "no
   * payment rows" as no list at all.
   */
  if ((order.adjustments ?? []).some((a) => a.type === "RETUR")) return [];
  return legacyPayments(order);
}

/** What one customer owes across every sale of theirs. */
export interface CustomerBalance {
  readonly customerId: string;
  /** Bills totalled. */
  readonly billed: number;
  /** In the shop's hands. */
  readonly settled: number;
  /** With a marketplace. Not the customer's debt. */
  readonly pending: number;
  /** The customer's actual debt: promised-and-unpaid, plus unaccounted. */
  readonly owed: number;
  /**
   * Debt from before this app — `Customer.openingBalance` — which is already
   * inside `owed`. Reported apart because there is no sale to open for it.
   */
  readonly openingBalance: number;
  /** How many of their sales still owe something. */
  readonly openSales: number;
  /** The earliest promise date across their sales. */
  readonly nextDueAt?: string;
}

/**
 * Roll a customer's sales into one balance.
 *
 * The screen the owner asked for — *"in customer management, we know how much
 * a customer still owes us, the pending from tokopedia/shopee, from split
 * payment"* — is this shape, per row. Note `pending` is reported and is NOT
 * part of `owed`: a marketplace holding the money is not the customer failing
 * to pay, and a shop that chases the second for the first loses the customer.
 *
 * `openingBalance` is what the customer owed before this app existed. It is
 * debt, so it is part of `owed`; it has no sale and no promise date, so it
 * moves neither `openSales` nor `nextDueAt`.
 */
export function customerBalance(
  customerId: string,
  orders: readonly {
    readonly id: string;
    readonly customerId: string | null;
    readonly total: number;
    readonly payMethod: string;
    readonly settled: boolean;
    readonly source: string;
    readonly ts: string;
    readonly payments?: readonly SalePayment[];
    readonly refunds?: readonly SaleRefund[];
    readonly adjustments?: readonly OrderAdjustmentRec[];
  }[],
  openingBalance = 0,
): CustomerBalance {
  const opening = Math.max(0, openingBalance);
  let billed = 0;
  let settled = 0;
  let pending = 0;
  let owed = opening;
  let openSales = 0;
  const dues: string[] = [];
  for (const o of orders) {
    if (o.customerId !== customerId) continue;
    const b = orderBalance(o);
    billed += b.total;
    settled += b.settled;
    pending += b.pending;
    owed += b.customerOwes;
    if (b.customerOwes > 0) openSales += 1;
    if (b.nextDueAt) dues.push(b.nextDueAt);
  }
  dues.sort();
  return {
    customerId,
    billed,
    settled,
    pending,
    owed,
    openingBalance: opening,
    openSales,
    ...(dues[0] === undefined ? {} : { nextDueAt: dues[0] }),
  };
}

/** Is a promise overdue, as of now? */
export function isOverdue(
  payment: SalePayment,
  now: number = Date.now(),
): boolean {
  if (payment.state !== "DUE" || !payment.dueAt) return false;
  return Date.parse(payment.dueAt) < now;
}

/*
 * =============================================================================
 * The owner's revision, 2026-09-23: a payment row says three things
 * =============================================================================
 *
 * > *"For payment per transaction, it should only have these columns: Payment
 * > method (Transfer, Cash, Shopee, Tokopedia) | Status (Pending, settled) |
 * > Amount. The owe should automatically be calculated."*
 *
 * DUE stops being something anybody types. What a customer still owes is the
 * bill less everything recorded against it, which is arithmetic and therefore
 * cannot disagree with itself the way two typed figures can.
 *
 * It does NOT stop being stored. A DUE row is still what Receivable, the
 * customer balance, `DebtPaymentModal` and the overdue tag all read, and it is
 * the only row that carries a promise date — so the shortfall is written back
 * as ONE DUE row, derived in the same mutation as `Order.settled`, exactly the
 * projection rule `Unit.status` follows. `owedRow` builds it and `withOwed`
 * puts a list back together; `enteredPayments` is what a screen shows.
 */

/** The id a derived shortfall row is filed under, per sale. */
export const OWED_ID_SUFFIX = "-owed";

/** The rows somebody actually entered — everything but the derived shortfall. */
export function enteredPayments(
  payments: readonly SalePayment[],
): SalePayment[] {
  return payments.filter((p) => p.state !== "DUE");
}

/** The promise date carried by a sale's derived shortfall, if it has one. */
export function owedDueAt(
  payments: readonly SalePayment[],
): string | undefined {
  return payments.find((p) => p.state === "DUE" && p.dueAt)?.dueAt;
}

/**
 * The one DUE row a sale needs, or none.
 *
 * Its id is derived from the sale so a correction rewrites the same row rather
 * than growing a new one each time somebody opens the dialog and saves.
 */
export function owedRow(
  orderId: string,
  total: number,
  entered: readonly SalePayment[],
  dueAt?: string,
  at: string = new Date().toISOString(),
): SalePayment | undefined {
  const recorded = entered.reduce((t, p) => t + p.amount, 0);
  const short = total - recorded;
  if (short <= 0) return undefined;
  return {
    id: `${orderId}${OWED_ID_SUFFIX}`,
    // The shortfall is not a method anybody chose. TUNAI is what an unpaid
    // balance is finally collected in nine times in ten, and `inBalance` is
    // never read on a DUE row because nothing has moved.
    method: "TUNAI",
    amount: short,
    state: "DUE",
    at,
    ...(dueAt ? { dueAt } : {}),
  };
}

/** Entered rows plus the shortfall they leave — what a save writes. */
export function withOwed(
  orderId: string,
  total: number,
  entered: readonly SalePayment[],
  dueAt?: string,
  at?: string,
): SalePayment[] {
  const owed = owedRow(orderId, total, entered, dueAt, at);
  return owed === undefined ? [...entered] : [...entered, owed];
}
