/**
 * What a hold and its machines are doing — lifted from the web's
 * `lib/reservations.ts`, where the derivation was already right.
 *
 * ## Why nothing here is stored per item
 *
 * A hold item's state is not a fact about the hold. It is a fact about the
 * MACHINE: a unit sitting at `DIRESERVASI` is on hold, one at `TERJUAL` has
 * been bought, and one that has drifted anywhere else has been let go. The
 * ledger writes `Unit.status` on every one of those transitions, and it does so
 * whether or not the person doing it knew a reservation existed — a salesperson
 * can pick a reserved serial straight off the shelf list and never open the
 * holds screen.
 *
 * A `status` column on `ReservationItem` would therefore be a second copy of
 * something already recorded, and the copy that goes stale is the second one.
 * `Reservation.status` — which the schema DOES store — is kept as a projection,
 * written in the same transaction as whatever moved the units, exactly as
 * `Unit.status` is.
 *
 * ## Partial collection
 *
 * This is what the derivation buys. Selling two machines out of a hold of three
 * needs no new state anywhere: the two sold units go to `TERJUAL`, the third
 * stays at `DIRESERVASI`, and the hold reads as part-collected because that is
 * what its machines say.
 *
 * Pure: no Prisma, no clock, no I/O.
 */

import type { UnitStatus } from "./unitState.js";

/**
 * The reservation vocabulary, declared here rather than imported from Prisma.
 *
 * `packages/domain` depends on nothing, and `packages/db` already depends on
 * `packages/domain` — importing the generated enum back would be a cycle. Same
 * shape as `UNIT_STATUSES` in unitState.ts, and Prisma's generated
 * string-literal union stays assignable in both directions.
 */
export const RESERVATION_STATUSES = ["TERJADWAL", "SELESAI", "BATAL"] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function isReservationStatus(v: string): v is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(v);
}

/** Where one machine on a hold has got to. */
export type HoldState = "HELD" | "BOUGHT" | "RELEASED";

/**
 * The state of one item, read off its unit's status.
 *
 * A null status — an item with no unit behind it, or a unit that has been
 * archived away — answers `RELEASED`: whatever happened to the machine, it is
 * certainly not being held for anybody now.
 *
 * Note what this does NOT take: the database. The web version was
 * `itemState(db, item)` and looked the unit up live, which guaranteed
 * freshness for free. Here the caller owns freshness, and must pass statuses
 * read AFTER whatever it just wrote — a stale array reads a machine that was
 * released a moment ago as still held.
 */
export function itemState(unitStatus: UnitStatus | null): HoldState {
  if (unitStatus === null) return "RELEASED";
  if (unitStatus === "DIRESERVASI") return "HELD";
  if (unitStatus === "TERJUAL") return "BOUGHT";
  return "RELEASED";
}

/**
 * What the header's `status` should say, given where it is now.
 *
 * "Still holding something" wins over everything, because that is the only
 * state that asks the shop to do anything. Past that, a hold that sold at least
 * one machine reads as collected — the customer came and took it, and that is
 * the outcome — and one that sold none reads as cancelled. An empty hold is
 * `BATAL`: every machine has been taken off it, which is what cancelling one
 * looks like from the item side.
 *
 * ## Why it is monotone
 *
 * Only `TERJADWAL` may move. `SELESAI` and `BATAL` absorb.
 *
 * Nothing in the schema binds a unit to at most one open hold, so the item
 * statuses this reads are not necessarily about THIS hold. Hold A is cancelled,
 * its machine goes back to `TERSEDIA`, and hold B then takes the same machine —
 * re-projecting hold A now sees `DIRESERVASI`, reads HELD, and would resurrect a
 * cancelled booking. Worse, if that machine is sold to somebody else entirely,
 * hold A would project `SELESAI`: the database asserting a cancelled booking was
 * collected.
 *
 * A settled hold is a receipt. Receipts do not change.
 */
export function headerState(
  current: ReservationStatus,
  items: readonly HoldState[],
): ReservationStatus {
  if (current !== "TERJADWAL") return current;
  if (items.includes("HELD")) return "TERJADWAL";
  if (items.includes("BOUGHT")) return "SELESAI";
  return "BATAL";
}

/** How far along a hold is, for the one line a table cell can afford. */
export interface HoldProgress {
  readonly held: number;
  readonly bought: number;
  readonly released: number;
  readonly total: number;
}

export function holdProgress(items: readonly HoldState[]): HoldProgress {
  return {
    held: items.filter((s) => s === "HELD").length,
    bought: items.filter((s) => s === "BOUGHT").length,
    released: items.filter((s) => s === "RELEASED").length,
    total: items.length,
  };
}
