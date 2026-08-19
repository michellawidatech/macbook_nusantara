/**
 * The 24-hour customer service window — 06 §11.
 *
 * Free-form text delivers only within 24 hours of the customer's last inbound
 * message. Outside it, only a pre-approved template gets through, and Graph
 * says so with a success-shaped response that is easy to miss.
 *
 * 06 §11: "The inbox UI must show the remaining window per thread; a reply box
 * that looks functional but silently cannot deliver is worse than a disabled
 * one." That is what this file is for. Pure arithmetic, no I/O, so both the API
 * and the worker can agree on the answer without asking Graph.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1_000;

/** When the window opened by `lastInboundAt` closes. */
export function windowClosesAt(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + WINDOW_MS);
}

/** Milliseconds of window left, floored at zero. */
export function windowRemainingMs(
  lastInboundAt: Date,
  now: Date = new Date(),
): number {
  return Math.max(0, windowClosesAt(lastInboundAt).getTime() - now.getTime());
}

/**
 * Can a free-form text still be delivered to this thread?
 *
 * A thread with no inbound message at all is outside the window: the shop has
 * never been written to, so there is nothing to reply within.
 */
export function isWithinWindow(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): boolean {
  return lastInboundAt !== null && windowRemainingMs(lastInboundAt, now) > 0;
}
