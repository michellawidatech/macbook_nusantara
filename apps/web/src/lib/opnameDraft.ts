/**
 * What a DRAFT stock take expects, and its figures, worked out from the store
 * as it is now (owner report 2026-11-09).
 *
 * A draft stores `counted` / `unknown` / `missing` as they were at its last
 * save, and the list page printed those. So when the rule of what a count
 * expects changed — units on service became expected — a draft scanned under
 * the old rule kept reporting them as unknown on the list until somebody
 * scanned again. The list and the count page now both call this, so they
 * cannot disagree. A POSTED count still reads what it stored: see the
 * docblock in `OpnameSessionPage`.
 */
import type { MockDb, OpnameRec, Unit } from "../mock/seed.js";
import { inOpnameScope, scopeOf } from "./opnameScope.js";
import { restoreScans, scanStatus } from "./opnameCount.js";
import { skuTracksSerial } from "./serialTracking.js";

/**
 * Statuses that mean the warehouse should physically be holding the unit.
 *
 * `SERVIS` is one of them (owner report 2026-11-09): since 2026-09-25 a unit
 * sent to service MOVES to the warehouse it is serviced in, so it is on that
 * shelf to be counted. Leaving it out filed every unit on service as
 * "Belongs elsewhere" in the very warehouse the system says it is in.
 */
export const OPNAME_ON_HAND: readonly string[] = [
  "TERSEDIA",
  "DIRESERVASI",
  "QC",
  "SERVIS",
];

/** unit → category, through its variant and model. */
export function categoryLookup(db: Pick<MockDb, "skus" | "models">) {
  return (skuId: string) => {
    const sku = db.skus.find((s) => s.id === skuId);
    return sku && db.models.find((m) => m.id === sku.modelId)?.category;
  };
}

/** Every unit in scope that is on hand, tracked or counted. */
export function onHandInScope(db: MockDb, rec: Partial<OpnameRec>): Unit[] {
  const scope = scopeOf(rec);
  const categoryOf = categoryLookup(db);
  return db.units.filter(
    (u) =>
      OPNAME_ON_HAND.includes(u.status) && inOpnameScope(u, scope, categoryOf),
  );
}

/** The units a count SCANS: on hand, in scope, identified by serial. */
export function expectedUnits(db: MockDb, rec: Partial<OpnameRec>): Unit[] {
  return onHandInScope(db, rec).filter((u) => skuTracksSerial(db, u.skuId));
}

/** A draft's three figures, re-judged against the store as it is now. */
export function draftFigures(
  db: MockDb,
  rec: OpnameRec,
): { counted: string[]; unknown: string[]; missing: string[] } {
  const expected = expectedUnits(db, rec);
  const expectedSet = new Set(expected.map((u) => u.serial));
  const known = new Set(db.units.map((u) => u.serial));
  const scans = restoreScans(rec.counted, rec.unknown);
  const scanned = new Set(scans);
  const counted: string[] = [];
  const unknown: string[] = [];
  for (const s of scans) {
    if (scanStatus(s, expectedSet, (x) => known.has(x)) === "FOUND")
      counted.push(s);
    else unknown.push(s);
  }
  const missing = expected
    .filter((u) => !scanned.has(u.serial))
    .map((u) => u.serial);
  return { counted, unknown, missing };
}
