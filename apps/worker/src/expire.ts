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

import { dpDecisionTask } from "@nusantara/agent";
import { releaseHold, TXN_TIMEOUTS, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { upsertChatAction } from "./actions.js";

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
  /** DP holds that ran out unpaid — their units back on sale (2026-10-27). */
  readonly dpExpired?: number;
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

  const dp = await expireDpHolds(deps, at);
  return { expired, released: released + dp.released, dpExpired: dp.expired };
}

/**
 * A DP hold that ran out unpaid (owner, 2026-10-27: *"After that, back in
 * stock"*).
 *
 * A firm hold is one with `heldUntil` — set when staff record a DP. Past it,
 * with a unit still `DIRESERVASI`, the units go back on sale through
 * `releaseHold` (the ledger row says why) and the reservation STAYS open:
 * `reprojectHold` keeps a hold with an undecided DP at TERJADWAL, which is
 * what /reservations reads as **Decide DP**. Refunding or keeping the money is
 * staff's decision — this role cannot write a payment, and does not try.
 *
 * When the customer has a chat thread, a colleague also gets the task:
 * `Perlu putuskan DP — Budi tidak melunasi Air M2, DP Rp 500rb: kembalikan
 * atau hangus?`. Once only: a hold whose units are already back on sale is
 * not found again, because the query wants one still DIRESERVASI.
 *
 * Staff holds included, unlike the sweep above — the DP set the deadline, and
 * the owner set the DP's rule.
 */
async function expireDpHolds(
  deps: ExpireDeps,
  at: Date,
): Promise<{ expired: number; released: number }> {
  const { db, logger } = deps;
  const due = await db.reservation.findMany({
    where: {
      status: "TERJADWAL",
      heldUntil: { lt: at },
      items: { some: { removedAt: null, unit: { status: "DIRESERVASI" } } },
    },
    select: {
      id: true,
      code: true,
      phone: true,
      custName: true,
      payments: {
        where: { direction: "MASUK", voidedAt: null, orderId: null },
        select: { amount: true },
        take: 1,
      },
      items: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          unit: {
            select: {
              serial: true,
              sku: { select: { name: true, variantLabel: true } },
            },
          },
        },
      },
    },
    orderBy: { heldUntil: "asc" },
    take: deps.maxPerTick,
  });

  let expired = 0;
  let released = 0;
  for (const hold of due) {
    try {
      const n = await db.$transaction(async (tx) => {
        const result = await releaseHold(tx, {
          target: { reservationId: hold.id },
          staffId: deps.agentStaffId,
          at,
          expectStatus: "TERJADWAL",
          note: `DP ${hold.code} lewat batas, unit kembali dijual`,
        });
        if (result.skipped || result.released === 0) return 0;
        const dp = hold.payments[0];
        const from = hold.phone?.trim().replace(/^\+/, "") ?? "";
        const thread =
          dp !== undefined && from !== ""
            ? await tx.waMessage.findFirst({
                where: { from },
                select: { id: true },
              })
            : null;
        if (dp !== undefined && thread !== null) {
          const units = hold.items.flatMap((i) =>
            i.unit === null
              ? []
              : [
                  [i.unit.sku.name, i.unit.sku.variantLabel]
                    .filter(Boolean)
                    .join(" "),
                ],
          );
          await upsertChatAction(tx, {
            from,
            topic: "dp",
            kind: "RESERVATION",
            summary: dpDecisionTask({
              name: hold.custName,
              unit: units.join(", ") || null,
              amount: dp.amount,
            }),
            customerText: `Reservasi ${hold.code}`,
            ...(hold.items[0]?.unit
              ? { serial: hold.items[0].unit.serial }
              : {}),
            now: at,
          });
        }
        return result.released;
      }, TXN_TIMEOUTS);
      if (n > 0) {
        expired += 1;
        released += n;
        logger.info(
          {
            evt: "worker.reservation.dp_expired",
            ctx: { code: hold.code, released: n },
          },
          "a DP hold ran out unpaid — units back on sale, the DP waits for staff",
        );
      }
    } catch (err) {
      logger.error(
        {
          evt: "worker.reservation.dp_expire_failed",
          ctx: { code: hold.code },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "failed to release a DP hold that ran out",
      );
    }
  }
  return { expired, released };
}
