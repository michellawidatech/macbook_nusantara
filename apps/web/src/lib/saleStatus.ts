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
 * Pure: no React, no store. `test/saleStatus.test.ts` is the spec.
 */
import type { SaleBalance, SalePayment } from "./salePayments.js";

/** Where a sale's money stands, in the words Transaction History uses. */
export type SalePaymentStatus =
  "SETTLED" | "WITH_MARKETPLACE" | "PARTLY_PAID" | "OWED";

/**
 * A sale's payment status, from its balance. See the table in the header.
 *
 * A bill of zero — a giveaway recorded as a sale — owes nothing and holds
 * nothing, so it reads Settled; there is nothing left to collect.
 */
export function salePaymentStatus(b: SaleBalance): SalePaymentStatus {
  if (b.customerOwes > 0) {
    return b.settled + b.pending > 0 ? "PARTLY_PAID" : "OWED";
  }
  return b.pending > 0 ? "WITH_MARKETPLACE" : "SETTLED";
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
