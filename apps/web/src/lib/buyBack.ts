/**
 * Buying back a unit the shop sold (owner 2026-11-17): *"after a unit is
 * sold they can buy it back lah, we don't lock it."*
 *
 * Every door that takes a unit IN under a serial — a trade-in, a purchase
 * from a customer, a line on a supplier's invoice at Inbound & QC — asks the
 * same two things here, so no door can drift from the others:
 *
 * - `canBuyBack`: a serial the shop already knows may come in again only
 *   once it is SOLD. One still on the shelf, in QC, held or at a repairer is
 *   the shop's own, and receiving it again would be a typo, not a purchase.
 * - `receiveInto`: the unit goes into the store. A new serial is a new row;
 *   a sold one comes back as the SAME row, so its history runs on — bought,
 *   sold, bought again — and the caller's `DITERIMA` (from `TERJUAL`, the
 *   arrow in `packages/domain/unitState.ts`) says so. Everything the last
 *   round said about it — QC, price, cost, rack, invoice — is this round's
 *   now; `fresh` carries the new answers.
 *
 * Pure: no React, no store module.
 */
import type { MockDb } from "../mock/seed.js";

type Unit = MockDb["units"][number];

/** May a unit the shop already knows be received again? Only once sold. */
export const canBuyBack = (u: Pick<Unit, "status">): boolean =>
  u.status === "TERJUAL";

/**
 * Put a received unit into the store. Returns whether it went in: false when
 * the serial belongs to a unit the shop still holds (nothing is written).
 *
 * A bought-back unit keeps its SOLD status until the caller's `DITERIMA`
 * moves it, so that event records where it came from.
 */
export function receiveInto(d: MockDb, fresh: Unit): boolean {
  const at = d.units.findIndex((u) => u.serial === fresh.serial);
  if (at === -1) {
    d.units.push(fresh);
    return true;
  }
  const was = d.units[at]!;
  if (!canBuyBack(was)) return false;
  d.units[at] = { ...fresh, status: was.status };
  return true;
}
