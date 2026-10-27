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

/**
 * Where one machine on a hold has got to.
 *
 * `SOFT` (2026-10-27): reserved for somebody who has paid no DP. Only a DP
 * holds a unit — *"if reservation makes the stock decrease and reduce sale,
 * it is bad"* — so a hold without one leaves the unit `TERSEDIA` and on sale,
 * tagged for that customer. It still counts as the hold wanting something.
 */
export type HoldState = "HELD" | "SOFT" | "BOUGHT" | "RELEASED";

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
export function itemState(
  unitStatus: UnitStatus | null,
  /**
   * The item is on a hold nobody has paid a DP for, and the ledger has never
   * put this unit on hold for it (2026-10-27). Without the second half a unit
   * RELEASED from an old firm hold — back at `TERSEDIA` with its item still on
   * the row — would read as softly reserved again.
   */
  soft = false,
): HoldState {
  if (unitStatus === null) return "RELEASED";
  if (unitStatus === "DIRESERVASI") return "HELD";
  if (unitStatus === "TERJUAL") return "BOUGHT";
  if (unitStatus === "TERSEDIA" && soft) return "SOFT";
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
  /**
   * A DP is recorded on this hold and is neither on a sale nor refunded
   * (2026-10-27). Such a hold never closes by itself: when its units go back
   * on sale it stays open, waiting for staff to refund or keep the money —
   * closing it is that decision, and a `BATAL` written by a projection would
   * read as "kept".
   */
  options: { readonly dpOpen?: boolean } = {},
): ReservationStatus {
  if (current !== "TERJADWAL") return current;
  if (items.includes("HELD") || items.includes("SOFT")) return "TERJADWAL";
  if (options.dpOpen === true) return "TERJADWAL";
  if (items.includes("BOUGHT")) return "SELESAI";
  return "BATAL";
}

/** How far along a hold is, for the one line a table cell can afford. */
export interface HoldProgress {
  /** Still wanted — firmly held (`HELD`) or reserved unpaid (`SOFT`). */
  readonly held: number;
  readonly bought: number;
  readonly released: number;
  readonly total: number;
}

export function holdProgress(items: readonly HoldState[]): HoldProgress {
  return {
    held: items.filter((s) => s === "HELD" || s === "SOFT").length,
    bought: items.filter((s) => s === "BOUGHT").length,
    released: items.filter((s) => s === "RELEASED").length,
    total: items.length,
  };
}

// --- the DP rule -------------------------------------------------------------

/**
 * What a DP is and how long it holds (owner, 2026-10-27: *"they will have to
 * DP 500k for 1 week"*). Owner-editable in Settings; these are the answers
 * while nobody has typed one.
 */
export const DP_DEFAULT_AMOUNT = 500_000;
export const DP_DEFAULT_DAYS = 7;

/** The `AppSetting` keys the two live in — key/value, so no column. */
export const DP_SETTING_KEYS = {
  amount: "sales.dpAmount",
  days: "sales.dpDays",
} as const;

export interface DpRule {
  /** Whole rupiah. */
  readonly amount: number;
  readonly days: number;
}

/**
 * The rule from the stored text, each half falling back to its default when
 * absent, blank, not a whole number, or not above zero — a DP of nothing, or
 * a hold of no days, is a typo rather than a policy.
 */
export function dpRuleOf(stored: {
  readonly amount?: string | null;
  readonly days?: string | null;
}): DpRule {
  const whole = (v: string | null | undefined, fallback: number) => {
    const n = Number((v ?? "").trim());
    return (v ?? "").trim() !== "" && Number.isInteger(n) && n > 0
      ? n
      : fallback;
  };
  return {
    amount: whole(stored.amount, DP_DEFAULT_AMOUNT),
    days: whole(stored.days, DP_DEFAULT_DAYS),
  };
}

/** When a firm hold ends: the DP's moment plus the rule's days. */
export function heldUntilOf(paidAt: Date, days: number): Date {
  return new Date(paidAt.getTime() + days * 86_400_000);
}
