/**
 * Holds: what is still on hold, what has been bought, and what has been let go.
 *
 * A reservation became a header with items on 2026-08-26, matching the shape
 * `schema.prisma` has had all along (`Reservation` → `ReservationItem`). The
 * flat one-row-per-serial model it replaced could not say the ordinary thing:
 * a customer puts three machines aside in one conversation, and cancelling
 * "the reservation" ought to be one act rather than a hunt through three rows
 * sorted apart by whatever came in between.
 *
 * ## Why nothing here is stored
 *
 * Because a hold's state is not a fact about the hold. It is a fact about the
 * machines: a unit sitting at `DIRESERVASI` is on hold, one at `TERJUAL` has
 * been bought, and one that has drifted anywhere else has been let go. The
 * ledger writes `Unit.status` on every one of those transitions, and it does
 * so whether or not the person doing it knew a reservation existed — a
 * salesperson can pick a reserved serial straight off the shelf list and never
 * open this screen.
 *
 * A `status` column on `ReservationItem` would therefore be a second copy of
 * something already recorded, and the copy that goes stale is the second one.
 * So it is derived. `Reservation.status` — which the schema DOES store — is
 * kept as a projection, written in the same mutation as whatever moved the
 * units, exactly as `Unit.status` is.
 *
 * ## Partial checkout
 *
 * This is what the derivation buys. Selling two machines out of a hold of
 * three needs no new state anywhere: the two sold units go to `TERJUAL`, the
 * third stays at `DIRESERVASI`, and the hold reads as part-collected because
 * that is what its machines say.
 */
import type { MockDb, Reservation, ReservationItem } from "../mock/seed.js";

/** Where one machine on a hold has got to. */
export type HoldState = "HELD" | "BOUGHT" | "RELEASED";

/**
 * The state of one item, read off its unit.
 *
 * A serial with no unit behind it answers `RELEASED`: whatever happened to the
 * machine, it is certainly not being held for anybody now.
 */
export function itemState(db: MockDb, item: ReservationItem): HoldState {
  const unit = db.units.find((u) => u.serial === item.serial);
  if (!unit) return "RELEASED";
  if (unit.status === "DIRESERVASI") return "HELD";
  if (unit.status === "TERJUAL") return "BOUGHT";
  return "RELEASED";
}

/** The items still waiting to be collected. */
export function heldItems(
  db: MockDb,
  r: Reservation,
): readonly ReservationItem[] {
  return r.items.filter((i) => itemState(db, i) === "HELD");
}

/**
 * What the header's `status` should say.
 *
 * "Still holding something" wins over everything, because that is the only
 * state that asks the shop to do anything. Past that, a hold that sold at
 * least one machine reads as bought — the customer came and collected, and
 * that is the outcome — and one that sold none reads as cancelled.
 *
 * An empty hold is `CANCELLED`: every machine has been taken off it, which is
 * what cancelling one looks like from the item side.
 */
export function headerState(db: MockDb, r: Reservation): Reservation["status"] {
  const states = r.items.map((i) => itemState(db, i));
  if (states.includes("HELD")) return "ACTIVE";
  if (states.includes("BOUGHT")) return "DONE";
  return "CANCELLED";
}

/**
 * Rewrite the header projections for every hold touching these serials.
 *
 * Must be called INSIDE the same `mutate` as whatever moved the units — the
 * same rule the unit ledger follows, and for the same reason: a projection
 * written a moment later is a window in which the screen and the data disagree.
 *
 * Passing no serials refreshes every hold, which is what a page does after
 * editing the items themselves.
 */
export function reprojectHolds(
  draft: MockDb,
  serials?: readonly string[],
): void {
  const touched = serials ? new Set(serials) : null;
  for (const r of draft.reservations) {
    if (touched && !r.items.some((i) => touched.has(i.serial))) continue;
    r.status = headerState(draft, r);
  }
}

/** Every hold with at least one machine still waiting to be collected. */
export function activeHolds(db: MockDb): Reservation[] {
  return db.reservations.filter((r) => heldItems(db, r).length > 0);
}

/** How far along a hold is, for the one line a table cell can afford. */
export interface HoldProgress {
  readonly held: number;
  readonly bought: number;
  readonly released: number;
  readonly total: number;
}

export function holdProgress(db: MockDb, r: Reservation): HoldProgress {
  const states = r.items.map((i) => itemState(db, i));
  return {
    held: states.filter((s) => s === "HELD").length,
    bought: states.filter((s) => s === "BOUGHT").length,
    released: states.filter((s) => s === "RELEASED").length,
    total: states.length,
  };
}
