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

/**
 * Where one machine on a hold has got to.
 *
 * `SOFT` (owner, 2026-10-27): reserved for a customer who has paid no DP.
 * Only a DP holds a unit — *"if reservation makes the stock decrease and
 * reduce sale, it is bad"* — so the unit stays `TERSEDIA` and on sale, tagged
 * *Reserved for Budi, not paid*, and the till asks before selling it.
 */
export type HoldState = "HELD" | "SOFT" | "BOUGHT" | "RELEASED";

/** Nobody has paid a DP on this hold, so it holds nothing (2026-10-27). */
export function isUnpaidHold(
  r: Pick<Reservation, "dp" | "heldUntil">,
): boolean {
  return r.dp === undefined && r.heldUntil === undefined;
}

/**
 * Has the ledger ever put this serial on hold for this reservation? A unit
 * RELEASED from a firm hold (every hold made before 2026-10-27 was one) is
 * back at `TERSEDIA` with its item still on the row, and must not read as
 * softly reserved again.
 */
function heldByLedger(db: MockDb, r: Reservation, serial: string): boolean {
  return db.events.some(
    (e) =>
      e.serial === serial && e.type === "DIRESERVASI" && e.refCode === r.code,
  );
}

/**
 * The state of one item, read off its unit — and, for a unit still on sale,
 * off the hold it is on (`SOFT`).
 *
 * A serial with no unit behind it answers `RELEASED`: whatever happened to the
 * machine, it is certainly not being held for anybody now.
 */
export function itemState(
  db: MockDb,
  item: ReservationItem,
  r: Reservation,
): HoldState {
  const unit = db.units.find((u) => u.serial === item.serial);
  if (!unit) return "RELEASED";
  if (unit.status === "DIRESERVASI") return "HELD";
  if (unit.status === "TERJUAL") return "BOUGHT";
  if (
    unit.status === "TERSEDIA" &&
    r.status === "ACTIVE" &&
    isUnpaidHold(r) &&
    !heldByLedger(db, r, item.serial)
  )
    return "SOFT";
  return "RELEASED";
}

/**
 * Every unit on sale that a hold nobody paid for names — the till's and
 * Inventory's *Reserved for {name}, not paid* tag (2026-10-27). One pass, so
 * a catalogue of a thousand rows asks a map rather than every hold.
 */
export function softHolds(db: MockDb): Map<string, Reservation> {
  const out = new Map<string, Reservation>();
  for (const r of db.reservations) {
    if (r.status !== "ACTIVE" || !isUnpaidHold(r)) continue;
    for (const i of r.items)
      if (!out.has(i.serial) && itemState(db, i, r) === "SOFT")
        out.set(i.serial, r);
  }
  return out;
}

/** Whether a DP on this hold is neither on a sale nor handed back. */
export function dpOpen(r: Pick<Reservation, "dp">): boolean {
  return (
    r.dp !== undefined &&
    r.dp.orderId === undefined &&
    r.dp.refund === undefined
  );
}

/**
 * A visit: a reservation that holds nothing — the bot's "janji datang"
 * (2026-10-27). It has a time and a customer and no units.
 */
export function isVisit(r: Pick<Reservation, "items">): boolean {
  return r.items.length === 0;
}

/** Every visit still open — the customer has not come, nor cancelled. */
export function openVisits(db: MockDb): Reservation[] {
  return db.reservations.filter((r) => isVisit(r) && r.status === "ACTIVE");
}

/** The items still waiting to be collected. */
export function heldItems(
  db: MockDb,
  r: Reservation,
): readonly ReservationItem[] {
  return r.items.filter((i) => {
    const state = itemState(db, i, r);
    return state === "HELD" || state === "SOFT";
  });
}

/**
 * What the header's `status` should say.
 *
 * "Still holding something" wins over everything, because that is the only
 * state that asks the shop to do anything. Past that, a hold that sold at
 * least one machine reads as bought — the customer came and collected, and
 * that is the outcome — and one that sold none reads as cancelled.
 *
 * A hold whose items have all been taken off is `CANCELLED`, which is what
 * cancelling one looks like from the item side.
 *
 * ⚠️ A reservation with NO items at all is a VISIT (2026-10-27: the bot books
 * "janji datang" and holds nothing) — its status is a decision somebody made
 * (came, cancelled) and not a fact about any unit, so it is returned as it
 * stands. Without this, `reprojectHolds(d)` with no serials — Inventory's
 * write-off does exactly that — cancelled every visit in the shop.
 */
export function headerState(db: MockDb, r: Reservation): Reservation["status"] {
  if (isVisit(r)) return r.status;
  // A DP refunded or kept (2026-10-27) closed the hold by a person's
  // decision; no projection reopens it.
  if (r.status === "CANCELLED" && r.dp !== undefined) return r.status;
  const states = r.items.map((i) => itemState(db, i, r));
  if (states.includes("HELD") || states.includes("SOFT")) return "ACTIVE";
  // An open DP waits for staff to refund or keep it (2026-10-27): closing the
  // hold IS that decision, and a CANCELLED written here would read as "kept".
  if (dpOpen(r)) return "ACTIVE";
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
  const states = r.items.map((i) => itemState(db, i, r));
  return {
    held: states.filter((s) => s === "HELD" || s === "SOFT").length,
    bought: states.filter((s) => s === "BOUGHT").length,
    released: states.filter((s) => s === "RELEASED").length,
    total: states.length,
  };
}
