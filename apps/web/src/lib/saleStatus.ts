/**
 * What became of a sale after the till: did any of it come back, and where is
 * its money (owner ask 2026-09-19, for Transaction History).
 *
 * ## Payment status — four words over three states
 *
 * `lib/salePayments.ts` gives every part of a bill one of three states, and
 * they are three different parties: SETTLED money is the shop's, PENDING money
 * is with a marketplace (the customer HAS paid), and DUE money is the
 * customer's debt. A sale's payment status is which of those parties still
 * has something outstanding:
 *
 * | status | the customer owes | a marketplace holds |
 * |---|---|---|
 * | Settled | nothing | nothing |
 * | With a marketplace | nothing | some |
 * | Partly paid | some, and has paid some | either |
 * | Owed | all of it | nothing |
 *
 * The screen this replaces checked "does the customer owe anything?" first
 * and answered "Owed" whenever they did, so a bill half collected read
 * exactly like a bill nobody had paid a rupiah of — "Part paid" and "Unpaid"
 * existed in its vocabulary and could never be shown for a positive total.
 * "What the customer owes" counts the gap nobody has accounted for as well as
 * the promised DUE parts, as `saleBalance` does: a bill recorded short is
 * money somebody has to collect.
 *
 * ## Return status — read off the ledger, the way the server reads it
 *
 * A customer return (`ReturnRec`, prisma's `UnitReturn`) names a serial and a
 * day, never a sale. What ties it to a receipt is the rule `packages/db`'s
 * events adapter applies to `OrderItem.returnedAt`: a `RETUR_PELANGGAN` event
 * closes the unit's receipts dated BEFORE it, and never one dated after —
 * that is the unit's resale. This reads the same rule off the browser's copy
 * of the ledger, so the two cannot disagree about which sale a return undid.
 * Keying on the event rather than on the return's `refCode` is deliberate:
 * the return desk writes the SR code there and the demo seed writes the sale's
 * SI code, and the timestamp is the one fact both carry.
 *
 * Only an arrival counts. A return still PENDING has written no event — the
 * unit is not back yet — so its sale reads Completed until the unit is
 * received at the return desk.
 *
 * ## Unpaid, returned (owner ask 2026-10-26)
 *
 * > *"If the unit is bought, not paid yet, and then returned (the user cancel
 * > the payment): … the transaction history is marked as Unpaid, returned."*
 *
 * A return cancels the customer's debt first (`applyReturnCredit`), so a sale
 * nobody paid a rupiah of owes nothing afterwards — and read Settled, the
 * word for money that came in. `returnedDebt` reads the cancelled debt back
 * off what is stored; nothing new is. Two more words, both only where the
 * sale would otherwise read Settled — a sale that still owes or still waits
 * on a marketplace keeps the word that says what to chase:
 *
 * | status | the return cancelled debt | anything was ever paid |
 * |---|---|---|
 * | Unpaid, returned | yes | no |
 * | Partly paid, returned | yes | yes (and was handed back) |
 *
 * A sale paid in full and then returned keeps Settled: its money went back as
 * a refund, which is a different event from a debt somebody stopped owing.
 *
 * Pure: no React, no store. `test/saleStatus.test.ts` is the spec.
 */
import { holdsFunds, SALE_CHANNELS } from "./channels.js";
import {
  billAfterReturns,
  paymentsOf,
  refundedOf,
  saleBalance,
  type OrderAdjustmentRec,
  type SaleBalance,
  type SalePayment,
  type SaleRefund,
} from "./salePayments.js";

/** Where a sale's money stands, in the words Transaction History uses. */
export type SalePaymentStatus =
  | "SETTLED"
  | "WITH_MARKETPLACE"
  | "PARTLY_PAID"
  | "OWED"
  | "PARTLY_PAID_RETURNED"
  | "UNPAID_RETURNED";

/**
 * A sale's payment status, from its balance — and, for a sale a return
 * touched, from what the return cancelled (`returnedDebt`). See the tables in
 * the header.
 *
 * A bill of zero — a giveaway recorded as a sale — owes nothing and holds
 * nothing, so it reads Settled; there is nothing left to collect.
 */
export function salePaymentStatus(
  b: SaleBalance,
  returned?: ReturnedDebt,
): SalePaymentStatus {
  if (b.customerOwes > 0) {
    return b.settled + b.pending > 0 ? "PARTLY_PAID" : "OWED";
  }
  if (b.pending > 0) return "WITH_MARKETPLACE";
  if (returned !== undefined && returned.cancelled > 0) {
    return returned.paid > 0 ? "PARTLY_PAID_RETURNED" : "UNPAID_RETURNED";
  }
  return "SETTLED";
}

/** What the returns on a sale did to the customer's debt. */
export interface ReturnedDebt {
  /** Debt the returns cancelled — never paid, and no longer owed. */
  readonly cancelled: number;
  /** What the customer ever put on the sale: settled (refunds included) and held. */
  readonly paid: number;
}

/** A sale, as far as `returnedDebt` reads one. */
export interface DebtReturnedSale {
  readonly id: string;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly ts: string;
  readonly payments?: readonly SalePayment[];
  readonly refunds?: readonly SaleRefund[];
  readonly adjustments?: readonly OrderAdjustmentRec[];
}

/** "(Shopee 260912…)" — how a RETUR's reason names a marketplace order. */
const NAMES_MARKETPLACE = new RegExp(
  `\\((?:[^()]*, )?(?:${SALE_CHANNELS.filter((c) => c.holdsFunds)
    .map((c) => c.label)
    .join("|")}) [^()]*\\)\\s*$`,
);

/**
 * The debt a sale's returns cancelled, read back off what is stored —
 * undefined on a sale no return touched.
 *
 * A plain return applies its credit (the RETUR adjustments, R) to the debt
 * first, then to what a marketplace holds, then hands the rest back as a
 * refund (F). So, with T the bill as sold, S everything ever settled on it
 * (refunds not taken off), P what a marketplace still holds and O what the
 * customer owes now:
 *
 * - R − F is the credit that did not go back in money — debt cancelled, plus
 *   whatever a marketplace was holding;
 * - T − S − P − O is the part of the bill nobody paid and nobody owes.
 *
 * Without a marketplace the two are the same figure; the smaller is taken so
 * neither can overstate the other. Two cases the totals cannot answer, and
 * which therefore read zero rather than guess:
 *
 * - **a marketplace was involved** — the sale's channel holds funds, a part is
 *   pending or names a marketplace, or a RETUR names a marketplace order. A
 *   cut held payment leaves no row behind, and it is indistinguishable from a
 *   cancelled debt by the totals alone. Marketplace customers pay the
 *   marketplace, so a debt there is the rare case and Settled the honest one;
 * - **an exchange** (`exchanged`, from `exchangedSales`) — its credit paid
 *   for the replacements, which were added to the same bill.
 */
export function returnedDebt(
  order: DebtReturnedSale,
  exchanged = false,
): ReturnedDebt | undefined {
  const returns = (order.adjustments ?? []).filter((a) => a.type === "RETUR");
  if (returns.length === 0) return undefined;
  const payments = paymentsOf(order);
  const sum = (state: SalePayment["state"]) =>
    payments.filter((p) => p.state === state).reduce((t, p) => t + p.amount, 0);
  const settled = sum("SETTLED");
  const pending = sum("PENDING");
  const paid = settled + pending;
  const marketplace =
    holdsFunds(order.source) ||
    payments.some(
      (p) =>
        p.state === "PENDING" ||
        (p.channel !== undefined && holdsFunds(p.channel)),
    ) ||
    returns.some((a) => NAMES_MARKETPLACE.test(a.reason));
  if (exchanged || marketplace) return { cancelled: 0, paid };
  const credit = returns.reduce((t, a) => t + a.amount, 0);
  const refunded = refundedOf(order);
  const owes = saleBalance(
    billAfterReturns(order),
    payments,
    refunded,
  ).customerOwes;
  const cancelled = Math.max(
    0,
    Math.min(credit - refunded, order.total - settled - pending - owes),
  );
  return { cancelled, paid };
}

/** A ledger row, as far as `exchangedSales` reads one. */
export interface SoldEvent {
  readonly serial: string;
  readonly type: string;
  readonly at: string;
  readonly refCode?: string;
}

/** A counted-stock move, as far as `exchangedSales` reads one. */
export interface SoldMove {
  readonly type: string;
  readonly at: string;
  readonly orderId?: string;
}

/**
 * The sales that took something OUT after a return — an exchange's
 * replacement, or an item Edit transaction added since — by order id.
 *
 * A replacement unit's `TERJUAL` names the return (its SG code) or, when only
 * counted pieces came back, the sale itself; counted replacements are
 * `TERJUAL` moves naming the order. Only rows dated at or after the sale's
 * first return count, and a unit row only under one of the sale's own codes —
 * the same serial resold on another receipt names that receipt.
 */
export function exchangedSales(
  orders: readonly {
    readonly id: string;
    readonly code: string;
    readonly serials: readonly string[];
    readonly adjustments?: readonly OrderAdjustmentRec[];
  }[],
  events: readonly SoldEvent[],
  moves: readonly SoldMove[],
): Set<string> {
  const out = new Set<string>();
  const returned = orders.filter((o) =>
    (o.adjustments ?? []).some((a) => a.type === "RETUR"),
  );
  if (returned.length === 0) return out;
  const soldBySerial = new Map<string, SoldEvent[]>();
  for (const e of events) {
    if (e.type !== "TERJUAL") continue;
    const list = soldBySerial.get(e.serial) ?? [];
    list.push(e);
    soldBySerial.set(e.serial, list);
  }
  const movesByOrder = new Map<string, SoldMove[]>();
  for (const m of moves) {
    if (m.type !== "TERJUAL" || m.orderId === undefined) continue;
    const list = movesByOrder.get(m.orderId) ?? [];
    list.push(m);
    movesByOrder.set(m.orderId, list);
  }
  for (const o of returned) {
    const retur = (o.adjustments ?? []).filter((a) => a.type === "RETUR");
    const first = retur.reduce(
      (min, a) => (a.at < min ? a.at : min),
      retur[0]!.at,
    );
    const codes = new Set([
      o.code,
      ...retur.flatMap((a) => (a.code === undefined ? [] : [a.code])),
    ]);
    const unitOut = o.serials.some((serial) =>
      (soldBySerial.get(serial) ?? []).some(
        (e) => e.at >= first && e.refCode !== undefined && codes.has(e.refCode),
      ),
    );
    const piecesOut = (movesByOrder.get(o.id) ?? []).some((m) => m.at >= first);
    if (unitOut || piecesOut) out.add(o.id);
  }
  return out;
}

/**
 * Every sale's `returnedDebt`, keyed by order id — what Transaction History
 * and Income & Expense ask. A sale no return touched is absent.
 */
export function returnedDebts(
  orders: readonly (DebtReturnedSale & {
    readonly code: string;
    readonly serials: readonly string[];
  })[],
  events: readonly SoldEvent[],
  moves: readonly SoldMove[],
): Map<string, ReturnedDebt> {
  const exchanged = exchangedSales(orders, events, moves);
  const out = new Map<string, ReturnedDebt>();
  for (const o of orders) {
    const r = returnedDebt(o, exchanged.has(o.id));
    if (r !== undefined) out.set(o.id, r);
  }
  return out;
}

/** Whether any of a sale's units came back. */
export type SaleReturnStatus = "COMPLETED" | "PARTLY_RETURNED" | "RETURNED";

/** A sale, as far as returns are concerned. */
export interface ReturnableSale {
  readonly id: string;
  /** When it was sold, ISO. */
  readonly ts: string;
  readonly serials: readonly string[];
}

/** A ledger row, as far as returns are concerned. */
export interface ReturnEvent {
  readonly serial: string;
  readonly type: string;
  readonly at: string;
}

/**
 * The serials each sale has had brought back, keyed by order id. A sale with
 * nothing returned is absent.
 *
 * A serial's line is returned when a `RETUR_PELANGGAN` for it is dated at or
 * after the sale — the events adapter's `order.ts <= at`. Only the NEWEST
 * return of each serial needs comparing: if any return is dated after the
 * sale, the newest one is too. A unit sold, returned and sold again therefore
 * reads Returned on the first receipt and Completed on the second, until it
 * comes back a second time.
 */
export function returnedSerials(
  orders: readonly ReturnableSale[],
  events: readonly ReturnEvent[],
): Map<string, ReadonlySet<string>> {
  const lastBack = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "RETUR_PELANGGAN") continue;
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;
    const seen = lastBack.get(e.serial);
    if (seen === undefined || at > seen) lastBack.set(e.serial, at);
  }
  const out = new Map<string, Set<string>>();
  if (lastBack.size === 0) return out;
  for (const o of orders) {
    const soldAt = Date.parse(o.ts);
    if (Number.isNaN(soldAt)) continue;
    for (const serial of o.serials) {
      const back = lastBack.get(serial);
      if (back === undefined || back < soldAt) continue;
      const set = out.get(o.id) ?? new Set<string>();
      set.add(serial);
      out.set(o.id, set);
    }
  }
  return out;
}

/** Completed, partly returned or returned — from what came back. */
export function saleReturnStatus(
  serials: readonly string[],
  returned: ReadonlySet<string> | undefined,
  lines: readonly {
    readonly qty: number;
    readonly returnedQty?: number;
  }[] = [],
): SaleReturnStatus {
  // Pieces, not lines: two mice of which one came back is part of a sale.
  const sold = serials.length + lines.reduce((n, l) => n + l.qty, 0);
  const back =
    serials.filter((s) => returned?.has(s) ?? false).length +
    lines.reduce((n, l) => n + Math.min(l.qty, l.returnedQty ?? 0), 0);
  if (back === 0) return "COMPLETED";
  return back === sold ? "RETURNED" : "PARTLY_RETURNED";
}

/**
 * The marketplace's own order number(s) for a sale (`SalePayment.ref`, owner
 * ask 2026-09-19). It is what the marketplace's income report names a payout
 * by, so it is what somebody matching that report against this screen
 * searches for.
 *
 * Every distinct one, in payment order, since a sale paid partly through
 * Shopee and partly through Tokopedia carries two (owner revision
 * 2026-09-21) — showing only the first would hide the second payout's number.
 */
export function paymentRefOf(
  payments: readonly SalePayment[],
): string | undefined {
  const refs: string[] = [];
  for (const p of payments) {
    const ref = p.ref?.trim();
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs.length === 0 ? undefined : refs.join(", ");
}
