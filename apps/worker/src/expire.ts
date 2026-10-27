/**
 * The expiry pass — letting go of a hold nobody came for.
 *
 * A booking the bot made before 2026-10-27 took a real unit out of stock: it
 * stopped showing in `search_stock` for everybody, including the walk-in
 * standing at the counter. Since then a bot booking is a VISIT and holds
 * nothing (`createVisit`) — and the same sweep closes one nobody came to:
 * `releaseHold` finds no unit on it, writes no event, and reprojects the
 * empty header to BATAL. A visit's expiry never touches a unit. `Reservation` has no `expiresAt` column and nothing has ever swept
 * it, so without this pass a hold created at 2am by an unauthenticated phone
 * number ends only when a human notices. That is the one genuine hazard in
 * letting a chat move inventory, and this is the answer to it.
 *
 * ## Only the agent's own bookings
 *
 * `source = AGEN` is the whole filter. A staff booking is a person's decision
 * about a customer they spoke to, and expiring it automatically would overrule
 * them. An agent booking is unattended and unauthenticated, so it gets a
 * deadline. The enum has carried that distinction since the first migration;
 * this is the first thing to depend on it.
 *
 * ## No new columns
 *
 * Staleness is read from what is already there: an appointment that has passed
 * by more than the grace period, or a booking with no appointment at all that
 * has simply aged out. Adding an `expiresAt` would be tidier and would need a
 * migration and an owner's decision, which a sweeper should not have to wait
 * for.
 *
 * Releasing goes through `releaseHold` in `packages/db` — the same function the
 * POS and the chat agent call — so a unit returns to TERSEDIA with an event that
 * says why. The ledger is the reason anybody can later ask what happened to a
 * device, and a status flipped without one is exactly the drift `08 §1` exists
 * to prevent. This pass used to carry its own copy of that logic, and the three
 * copies had drifted apart on locking.
 */

import { releaseHold, TXN_TIMEOUTS, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

export interface ExpireDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** The reserved agent Staff row — the release is an event and must be attributable. */
  readonly agentStaffId: string;
  /** How long after a missed appointment the hold is released. */
  readonly graceMs: number;
  /** How long a booking with no appointment may hold a unit. */
  readonly ttlMs: number;
  readonly maxPerTick: number;
  readonly now?: () => Date;
}

export interface ExpirePassResult {
  /** Bookings cancelled. */
  readonly expired: number;
  /** Units handed back to stock. */
  readonly released: number;
}

export async function expirePass(deps: ExpireDeps): Promise<ExpirePassResult> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const at = now();

  const stale = await db.reservation.findMany({
    where: {
      // Never a staff booking. See the docblock.
      source: "AGEN",
      status: "TERJADWAL",
      OR: [
        { scheduledFor: { lt: new Date(at.getTime() - deps.graceMs) } },
        {
          scheduledFor: null,
          createdAt: { lt: new Date(at.getTime() - deps.ttlMs) },
        },
      ],
    },
    select: {
      id: true,
      code: true,
      scheduledFor: true,
    },
    orderBy: { createdAt: "asc" },
    take: deps.maxPerTick,
  });

  let expired = 0;
  let released = 0;

  for (const reservation of stale) {
    try {
      // One shared implementation, called by the POS and the chat agent too.
      // `expectStatus` is what stops this sweep overruling a staff member who
      // completed or cancelled the booking since the query above: the service
      // locks the header, compares under that lock, and skips rather than
      // writing. Unit locking, ordering and the header projection are all its
      // job now — this pass only decides WHICH holds are stale, which is the
      // only part that is a worker policy.
      const result = await db.$transaction(
        (tx) =>
          releaseHold(tx, {
            target: { reservationId: reservation.id },
            staffId: deps.agentStaffId,
            at,
            expectStatus: "TERJADWAL",
            note: `Reservasi ${reservation.code} kedaluwarsa, unit dilepas`,
          }),
        TXN_TIMEOUTS,
      );

      const releasedNow = result.skipped ? 0 : result.released;
      if (!result.skipped) {
        expired += 1;
        released += releasedNow;
      }

      if (releasedNow > 0) {
        logger.info(
          {
            evt: "worker.reservation.expired",
            ctx: { code: reservation.code, released: releasedNow },
          },
          "released a booking nobody came for",
        );
      }
    } catch (err) {
      // One stuck booking must not stop the sweep, and must never stop a reply.
      logger.error(
        {
          evt: "worker.reservation.expire_failed",
          ctx: { code: reservation.code },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "failed to expire a booking",
      );
    }
  }

  return { expired, released };
}
