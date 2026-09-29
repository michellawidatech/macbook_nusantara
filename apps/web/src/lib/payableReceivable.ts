/**
 * What the shop owes, and what is owed to the shop — the two halves of the
 * same question, side by side.
 *
 * ## The owner's ask (2026-09-21)
 *
 * > *"Create a separate view 'Payable and Receivable', containing all the
 * > payable (inbound that have not been paid, grouped by supplier). The table
 * > contains supplier, transaction, and amount), and receivable (all
 * > transaction that has not been finished, the user is either using
 * > cash/transfer (owe the store), but remember this is not the one from
 * > shopee, it is just the one from what the user owe / have not paid). The
 * > table should display name, transaction, and amount."*
 *
 * ## Why this is a screen and not two links
 *
 * Both figures already existed and neither was ever in the same room as the
 * other. What is owed to a supplier is on `/suppliers`, one supplier at a
 * time. What a customer owes is on `/finance/receivables`, beside — and
 * visually equal to — money a MARKETPLACE is holding, which is not a debt at
 * all. So "how much does the shop owe, and how much is it owed" took two
 * screens, a filter, and somebody knowing that the Shopee half of one of them
 * did not count.
 *
 * It is also the pair of numbers the owner is migrating from B2Soft — utang
 * and piutang — so it is the screen that says whether the migration landed.
 *
 * ## The one rule that is easy to get wrong
 *
 * **A marketplace is not a debtor.** A PENDING payment at Shopee or Tokopedia
 * is money the customer has already handed over; it is on its way and nobody
 * is going to be telephoned about it. So this file does not ask "total minus
 * what landed", which would sweep every Shopee sale onto a call list.
 *
 * But it does not simply ask `customerOwes` either, and `customerDebtOf`
 * records why: a sale written before the payment list existed reads as one
 * PENDING payment on the ORDER's channel, so an unpaid walk-in was filed as
 * "a marketplace is holding this" and its debt came back zero. Every sale the
 * B2Soft import brings over is that shape, which would have made this page
 * report nothing on the day it is most needed. `holdsPendingMoney` in
 * `lib/channels.ts` is the rule both sides read.
 *
 * Pure: no React, no store. `test/payableReceivable.test.ts` is the spec.
 */
import { holdsPendingMoney } from "./channels.js";
import { customerLabel } from "./customers.js";
import { openingOwed, openingPaidOf } from "./debtPayments.js";
import { poTotals } from "./inbound.js";
import { orderBalance, isOverdue, paymentsOf } from "./salePayments.js";
import type { Po } from "../mock/seed.js";

/** One unpaid invoice, under the supplier it belongs to. */
export interface PayableRow {
  readonly key: string;
  readonly supplierId: string;
  readonly supplierName: string;
  /** The shop's own document code — PI-2026/09-000003. */
  readonly code: string;
  /** The number the supplier put on their own invoice, when there is one. */
  readonly invoiceNo?: string;
  readonly at: string;
  readonly total: number;
  readonly paid: number;
  readonly owed: number;
}

/** One supplier's payable, with its invoices under it. */
export interface PayableGroup {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly rows: readonly PayableRow[];
  readonly owed: number;
  /** The oldest unpaid invoice, which is the one they telephone about. */
  readonly oldestAt?: string;
}

/**
 * Invoices with money still owed on them, grouped by supplier.
 *
 * A **draft** is not owed: nobody has agreed to it, and `/inbound/new` writes
 * one every time somebody presses *Save draft*. Everything else counts,
 * **closed included** — closing an invoice was never a statement that it had
 * been paid (that is `poPaymentStatus`, 2026-09-15), and an invoice closed
 * with the ongkir still outstanding is exactly the row this page exists to
 * surface. A cancelled invoice does not appear because there is no such row:
 * cancelling drops it from the store (`askDelete` in `InboundPage`).
 */
export function payableGroups(
  invoices: readonly Po[],
  suppliers: readonly { readonly id: string; readonly name: string }[],
): PayableGroup[] {
  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
  const groups = new Map<string, PayableRow[]>();
  const push = (key: string, row: PayableRow) => {
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  };

  for (const po of invoices) {
    if (po.status === "DRAFT") continue;
    const { total, paid, outstanding } = poTotals(po);
    if (outstanding <= 0) continue;
    /*
     * An invoice with no supplier on it is still money owed, and dropping it
     * would make the page's total disagree with the invoices it lists. It is
     * grouped under its own id so it cannot be merged with anybody else's.
     */
    const supplierId =
      po.supplierId.trim() === "" ? `po:${po.id}` : po.supplierId;
    push(supplierId, {
      key: po.id,
      supplierId,
      supplierName: nameOf.get(po.supplierId) ?? "",
      code: po.code,
      ...(po.invoice.trim() ? { invoiceNo: po.invoice.trim() } : {}),
      at: po.date,
      total,
      paid,
      owed: outstanding,
    });
  }

  /*
   * ~~The opening balance.~~ `Supplier.openingBalance` went on 2026-09-24
   * (*"we don't track it anymore"*). A supplier's payable is its open
   * invoices and nothing before them.
   */

  const out: PayableGroup[] = [];
  for (const [supplierId, rows] of groups) {
    // Oldest first inside a group: an invoice outstanding for six weeks is the
    // one the supplier rings about (owner ask 2026-09-24: *"the inbound is
    // listed per the earliest date"*).
    const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
    const dated = sorted.map((r) => r.at).filter((at) => at !== "");
    out.push({
      supplierId,
      supplierName: sorted[0]!.supplierName,
      rows: sorted,
      owed: sorted.reduce((n, r) => n + r.owed, 0),
      ...(dated[0] === undefined ? {} : { oldestAt: dated[0] }),
    });
  }
  // Most owed first. The question this page is open to answer is "who do we
  // owe money to", and the answer is read from the top.
  return out.sort((a, b) => b.owed - a.owed);
}

/** One sale a customer has not finished paying for. */
export interface ReceivableRow {
  readonly key: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly phone: string;
  /** The sale's code. Empty for a debt from before this app. */
  readonly code: string;
  readonly at: string;
  readonly total: number;
  /** What the shop has actually collected on it. */
  readonly received: number;
  readonly owed: number;
  readonly dueAt?: string;
  readonly overdue: boolean;
  /** A debt from before this app: `Customer.openingBalance`. No sale. */
  readonly opening: boolean;
}

/** One customer's debt, with the sales behind it. */
export interface ReceivableGroup {
  readonly customerId: string;
  readonly customerName: string;
  readonly phone: string;
  readonly rows: readonly ReceivableRow[];
  readonly owed: number;
  /** True when any of the sales under it is past its promise date. */
  readonly overdue: boolean;
  readonly nextDueAt?: string;
}

/**
 * What a PERSON still owes on one sale.
 *
 * `customerOwes` — what the customer has promised and not paid, plus what
 * nothing accounts for — and one thing it cannot see on its own: a payment in
 * PENDING on a channel that holds no money.
 *
 * That case is `legacyPayments`. A sale written before the payment list
 * existed (2026-09-08) carries only `payMethod` and `settled`, and an
 * unsettled one is read as ONE PENDING payment carrying the ORDER's channel —
 * so an unpaid walk-in reads as "a marketplace is holding this", and
 * `customerOwes` comes back zero for a sale nobody has paid a rupiah towards.
 * Every sale the B2Soft import brings over is this shape.
 *
 * `holdsPendingMoney` is the same rule Receivables uses from the other end
 * (owner ask 2026-09-20): money can only be WAITING at Shopee or Tokopedia.
 * Pending anywhere else is a person who has not paid.
 */
export function customerDebtOf(sale: ReceivableSale): number {
  const b = orderBalance(sale);
  const misfiled = paymentsOf(sale)
    .filter(
      (p) =>
        p.state === "PENDING" && !holdsPendingMoney(p.channel ?? sale.source),
    )
    .reduce((n, p) => n + p.amount, 0);
  return b.customerOwes + misfiled;
}

export interface ReceivableSale {
  readonly id: string;
  readonly code: string;
  readonly customerId: string | null;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly ts: string;
  readonly payments?: Parameters<typeof orderBalance>[0]["payments"];
  readonly refunds?: Parameters<typeof orderBalance>[0]["refunds"];
  readonly adjustments?: Parameters<typeof orderBalance>[0]["adjustments"];
}

/**
 * Sales a customer still owes money on, grouped by customer.
 *
 * **Not marketplace money.** `customerOwes` counts what a PERSON has not paid
 * — cash and transfer parts that were left short, and whole sales nobody has
 * paid for. A Shopee part sits in `pending`, which is on the other screen and
 * is not a debt. See this file's header.
 *
 * A walk-in with no customer record still owes what they owe. Those rows are
 * grouped under one heading rather than under an invented person: there is
 * nobody to telephone, and pretending otherwise would put a name on a call
 * list that does not resolve to a number.
 */
export function receivableGroups(
  sales: readonly ReceivableSale[],
  customers: readonly {
    readonly id: string;
    readonly name: string;
    readonly phone?: string;
    readonly openingBalance?: number;
    readonly openingPayments?: readonly { readonly amount: number }[];
  }[],
  walkInLabel: string,
  now: number = Date.now(),
): ReceivableGroup[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const groups = new Map<string, ReceivableRow[]>();
  const push = (key: string, row: ReceivableRow) => {
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  };

  for (const o of sales) {
    const b = orderBalance(o);
    const owed = customerDebtOf(o);
    if (owed <= 0) continue;
    const customer = o.customerId === null ? undefined : byId.get(o.customerId);
    const key = o.customerId ?? "walk-in";
    push(key, {
      key: o.id,
      customerId: key,
      // The name, or the number when that is all there is (2026-09-24).
      customerName: customer ? customerLabel(customer) : walkInLabel,
      phone: customer?.phone ?? "",
      code: o.code,
      at: o.ts,
      total: b.total,
      received: b.settled,
      owed,
      ...(b.nextDueAt === undefined ? {} : { dueAt: b.nextDueAt }),
      overdue: paymentsOf(o).some((p) => isOverdue(p, now)),
      opening: false,
    });
  }

  for (const c of customers) {
    const opening = Math.max(0, c.openingBalance ?? 0);
    const owed = openingOwed(c);
    if (owed <= 0) continue;
    push(c.id, {
      key: `opening-${c.id}`,
      customerId: c.id,
      customerName: customerLabel(c),
      phone: c.phone ?? "",
      code: "",
      at: "",
      total: opening,
      received: openingPaidOf(c),
      owed,
      overdue: false,
      opening: true,
    });
  }

  const out: ReceivableGroup[] = [];
  for (const [customerId, rows] of groups) {
    const sorted = [...rows].sort(
      (a, b) =>
        Number(b.opening) - Number(a.opening) || a.at.localeCompare(b.at),
    );
    const dues = sorted
      .map((r) => r.dueAt)
      .filter((d): d is string => d !== undefined)
      .sort();
    out.push({
      customerId,
      customerName: sorted[0]!.customerName,
      phone: sorted[0]!.phone,
      rows: sorted,
      owed: sorted.reduce((n, r) => n + r.owed, 0),
      overdue: sorted.some((r) => r.overdue),
      ...(dues[0] === undefined ? {} : { nextDueAt: dues[0] }),
    });
  }
  // Overdue first, then most owed: this is a call list before it is a report.
  return out.sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || b.owed - a.owed,
  );
}

/** Σ a list of groups. */
export function totalOwed(
  groups: readonly { readonly owed: number }[],
): number {
  return groups.reduce((n, g) => n + g.owed, 0);
}
