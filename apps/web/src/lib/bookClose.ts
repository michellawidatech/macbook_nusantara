/**
 * Closing the book — RETIRED 2026-10-27. Every function here still answers,
 * and every answer is "open".
 *
 * > *"Remove the close book button in the transaction history, it will be the
 * > reconcile basically."* (owner, 2026-10-27)
 *
 * The button, its dialog and the closed-book banner left Transaction History
 * that day, and the LOCK went with them: without the banner's Reopen, a month
 * already closed in the shop would have stayed read-only for ever. What
 * replaces it is reconciliation — a reconciled period that is later edited is
 * FLAGGED there, not refused here.
 *
 * Made inert in ONE place: `booksClosedAt` answers undefined whatever the
 * setting says, so `isBookClosed` and `isSaleLocked` answer false and every
 * screen that asked them (the payment editors, the debt dialog, a return's
 * undo, an adjustment's or a service charge's delete) carries on as if the
 * book were open. `AppSettings.booksClosedAt` (`finance.booksClosedAt`) is
 * still read and written by the store, so a shop that closed a month still
 * loads — it is kept, and ignored. The server's twin is `booksClosedUntil` in
 * packages/db's store context.
 *
 * What it was (2026-09-24, monthly and finished-only since 2026-10-22): a
 * date before which a recorded sale took no edit and no new payment.
 *
 * Pure: no React, no store. `test/bookClose.test.ts` is the spec.
 */
import { orderBalance } from "./salePayments.js";

/** The parts of `AppSettings` this file reads. */
export interface BookCloseSettings {
  readonly booksClosedAt?: string;
}

/**
 * The instant the book is closed up to — always undefined since 2026-10-27,
 * when the book close was retired (see the head of this file). A stored
 * `booksClosedAt` is ignored rather than deleted.
 */
export function booksClosedAt(
  _settings: BookCloseSettings | undefined,
): string | undefined {
  return undefined;
}

/**
 * Is a transaction dated `at` inside the closed period? Never, since
 * 2026-10-27 — `booksClosedAt` answers undefined.
 *
 * Inclusive of the boundary when there was one, compared as ISO strings
 * (exact, and every date in the store is UTC).
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
 * Is this SALE locked by the closed book? (owner ask 2026-10-22: *"by default
 * should close book to all the payment that already settled (need to get X,
 * received X, no pending), and we can still add received amount even if it is
 * closed"*.)
 *
 * A closed month locks only what is finished: a sale dated inside it whose
 * bill is wholly in the shop's hands — nothing pending with a marketplace,
 * nothing owed. A sale still waiting on money stays open after the close, so
 * the payout or the customer's payment can still be recorded, and corrected.
 * Never true since 2026-10-27: the book close is retired.
 */
export function isSaleLocked(
  order: Parameters<typeof orderBalance>[0] | undefined,
  settings: BookCloseSettings | undefined,
): boolean {
  if (order === undefined || !isBookClosed(order.ts, settings)) return false;
  const b = orderBalance(order);
  return b.fullySettled && b.pending === 0 && b.customerOwes === 0;
}
