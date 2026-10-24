/**
 * Closing the book: a date before which no recorded transaction takes another
 * change (owner ask 2026-09-24).
 *
 * > *"The transaction & money related will be closed and uneditable. It is the
 * > same with money-related, so for the transaction, add a close book button
 * > to close and lock all the transaction."*
 *
 * The parallel the owner drew is with closing an invoice, and it is the right
 * one: `Po.closedAt` makes one purchase read-only, and this makes a PERIOD of
 * sales read-only. A sale has no closed flag of its own and should not grow
 * one — three users and thousands of receipts, and nobody is going to close
 * them one at a time.
 *
 * ## What "locked" means
 *
 * Everything money-related about a sale dated on or before the closing
 * instant: its units, its channel, its customer, its payments. A locked sale
 * takes **no new payment either** (owner answer 2026-09-24), which is what
 * makes it a book close rather than a lock on typing — a customer paying down
 * a debt from a closed period has to be recorded after the book is reopened,
 * so the month's figures cannot move under a report that has already gone out.
 *
 * ## Reopenable, deliberately
 *
 * One button puts it back. A close that could not be undone would be a close
 * nobody dares press, and the shop is three people who correct each other's
 * typing; the audit trail this leans on is `PaymentLog`, which records every
 * money edit whether the book was open or shut.
 *
 * `booksClosedAt` mirrors an `AppSetting` row, so it needs no column of its
 * own — the same footing as the opening balances beside it.
 *
 * Pure: no React, no store. `test/bookClose.test.ts` is the spec.
 */
import { orderBalance } from "./salePayments.js";

/** The parts of `AppSettings` this file reads. */
export interface BookCloseSettings {
  readonly booksClosedAt?: string;
}

/**
 * The instant the book is closed up to, or undefined when it is open.
 *
 * A blank string is "open": that is what clearing the setting writes, and the
 * store spells an absent key the same way.
 */
export function booksClosedAt(
  settings: BookCloseSettings | undefined,
): string | undefined {
  const at = settings?.booksClosedAt?.trim();
  return at === undefined || at === "" ? undefined : at;
}

/**
 * Is a transaction dated `at` inside the closed period?
 *
 * Inclusive of the boundary: closing the book "to 30 September" means the
 * thirtieth is in it. The caller passes the closing instant as the END of its
 * day, which is what `endOfDay` below is for — comparing ISO instants as
 * strings is exact and needs no parsing, and every date in the store is UTC.
 */
export function isBookClosed(
  at: string | undefined,
  settings: BookCloseSettings | undefined,
): boolean {
  const closed = booksClosedAt(settings);
  if (closed === undefined || at === undefined || at === "") return false;
  return at <= closed;
}

/**
 * The last instant of a local day, as an ISO string — what a date picker's
 * answer becomes.
 *
 * Local, not UTC: somebody closing the book on the 30th means their own 30th,
 * and in Jakarta that runs to 16:59 UTC. Taking the date at face value would
 * leave seven hours of the last day open.
 */
export function endOfDay(day: Date): string {
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

/**
 * The last instant of a local MONTH (owner ask 2026-10-22: *"add a close
 * transaction monthly"*). The book closes a whole month at a time now; any
 * day of the month picks it. Local, for the reason `endOfDay` gives.
 */
export function endOfMonth(day: Date): string {
  const end = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  return endOfDay(end);
}

/**
 * Is this SALE locked by the closed book? (owner ask 2026-10-22: *"by default
 * should close book to all the payment that already settled (need to get X,
 * received X, no pending), and we can still add received amount even if it is
 * closed"*.)
 *
 * A closed month locks only what is finished: a sale dated inside it whose
 * bill is wholly in the shop's hands — nothing pending with a marketplace,
 * nothing owed. A sale still waiting on money stays open after the close, so
 * the payout or the customer's payment can still be recorded, and corrected.
 */
export function isSaleLocked(
  order: Parameters<typeof orderBalance>[0] | undefined,
  settings: BookCloseSettings | undefined,
): boolean {
  if (order === undefined || !isBookClosed(order.ts, settings)) return false;
  const b = orderBalance(order);
  return b.fullySettled && b.pending === 0 && b.customerOwes === 0;
}
