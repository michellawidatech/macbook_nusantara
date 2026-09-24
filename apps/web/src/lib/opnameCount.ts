/**
 * The stock take's one table, as data — what each row says and where it sits
 * (owner brief 2026-09-19: *"Show all the unit early, move upward & show
 * status & green/red"*).
 *
 * ## Every expected unit is a row from the start
 *
 * The counting screen used to list only what had been scanned, and kept the
 * units the count expected out of sight until the counter said they were done
 * — a "blind count", argued for in the page's own docblock and never an owner
 * decision. The owner's brief reverses it. The table now opens holding every
 * unit the count's scope expects, each saying it has not been scanned yet, and
 * a scan changes a row's answer rather than adding a row. What cannot be
 * listed in advance still gets a row the moment it is scanned: a serial the
 * count did not expect.
 *
 * What stops this becoming a list somebody ticks is that there is nothing to
 * tick. A row turns green only by its serial arriving through the scan box —
 * read off the unit, by scanner or by hand — so the evidence a count rests on
 * is exactly what it was.
 *
 * ## Four answers
 *
 * | status | meaning | colour |
 * |---|---|---|
 * | `FOUND` | expected here, and scanned | green |
 * | `NOT_SCANNED` | expected here, not scanned yet | red |
 * | `ELSEWHERE` | scanned, a unit the shop holds, but filed outside this scope | orange |
 * | `UNREGISTERED` | scanned, and no unit anywhere carries the serial | red |
 *
 * The two unexpected answers are kept apart because they ask for different
 * work: a unit filed elsewhere needs MOVING, and one the system has never
 * heard of is stock that was never booked in — the only row the page offers
 * to take into inventory.
 *
 * `NOT_SCANNED` is the same fact the confirmation step calls *missing*, worded
 * for the middle of a count, when it usually means "not reached yet". It
 * becomes missing only at the review, once the counter says they are done.
 *
 * ## Order: what was just done, then what is left
 *
 * Scanned rows first, the most recent at the top, so the person holding the
 * scanner sees what the last read did without looking for it. A serial scanned
 * a second time moves back to the top rather than appearing twice — it counts
 * once, and the row answering "did that one go in?" is the one in front of
 * them. Everything not scanned yet follows in the order the caller hands it,
 * which is shelf order on the page.
 *
 * Pure: no React, no store. `test/opnameCount.test.ts` is the spec.
 */

/** What one row of the counting table says. See the docblock's table. */
export type CountStatus =
  "FOUND" | "NOT_SCANNED" | "ELSEWHERE" | "UNREGISTERED";

/** The answer for a serial that has been scanned — never `NOT_SCANNED`. */
export type ScanStatus = Exclude<CountStatus, "NOT_SCANNED">;

export interface CountRow {
  readonly serial: string;
  readonly status: CountStatus;
}

/**
 * What a scanned serial turns out to be.
 *
 * `isKnown` is passed in rather than looked up here, so this file needs no
 * store: the page holds every unit already, and "does any unit carry this
 * serial" is one lookup it can make faster than this could.
 */
export function scanStatus(
  serial: string,
  expected: ReadonlySet<string>,
  isKnown: (serial: string) => boolean,
): ScanStatus {
  if (expected.has(serial)) return "FOUND";
  return isKnown(serial) ? "ELSEWHERE" : "UNREGISTERED";
}

/**
 * The table's rows, in the order they are shown.
 *
 * @param scanned  every serial counted so far, oldest first — the order
 *                 `recordScan` keeps.
 * @param expected every serial the count expects, in the order the not-yet-
 *                 scanned block should read.
 */
export function countRows(
  scanned: readonly string[],
  expected: readonly string[],
  isKnown: (serial: string) => boolean,
): CountRow[] {
  const expectedSet = new Set(expected);
  const scannedSet = new Set(scanned);
  const rows: CountRow[] = [];
  // Newest first. A serial can only appear once in `scanned` (`recordScan`
  // sees to it), but a list written by an older build is not trusted to have
  // kept that promise — a duplicate would be two rows with one React key.
  const seen = new Set<string>();
  for (let i = scanned.length - 1; i >= 0; i -= 1) {
    const serial = scanned[i]!;
    if (seen.has(serial)) continue;
    seen.add(serial);
    rows.push({ serial, status: scanStatus(serial, expectedSet, isKnown) });
  }
  for (const serial of expected) {
    if (scannedSet.has(serial)) continue;
    rows.push({ serial, status: "NOT_SCANNED" });
  }
  return rows;
}

/**
 * The scan list a saved draft reopens with — every serial it had read.
 *
 * A draft is stored as two lists, `counted` (the scans the count expected) and
 * `unknown` (the ones it did not), because that is the shape a posted count is
 * read back in. Reopening from `counted` alone — which the counting page did
 * until 2026-09-19 — dropped every unexpected serial on a reload, and the next
 * autosave then dropped the take-into-stock decision hanging off it. The order
 * BETWEEN the two lists was never stored, so the unexpected serials come back
 * as the most recent: the rows still asking for a decision land on top.
 */
export function restoreScans(
  counted: readonly string[] = [],
  unknown: readonly string[] = [],
): readonly string[] {
  return [...new Set([...counted, ...unknown])];
}

/**
 * The scan list after one more scan: the serial at the end, where the most
 * recent belongs.
 *
 * A serial already on the list is MOVED rather than added — scanned twice, it
 * still counts once — and the list comes back untouched when it was already
 * the latest, so re-reading the same label does not register as a change to
 * the draft.
 */
export function recordScan(
  scanned: readonly string[],
  serial: string,
): readonly string[] {
  if (scanned[scanned.length - 1] === serial) return scanned;
  return [...scanned.filter((s) => s !== serial), serial];
}

/**
 * The scan list without one serial — the row's Delete.
 *
 * Takes back a READ, never a unit: the serial goes back to whatever it was
 * before it was scanned (not scanned yet, or simply absent), and nothing in
 * the store is touched. A draft count writes nothing until it is posted.
 */
export function removeScan(
  scanned: readonly string[],
  serial: string,
): readonly string[] {
  return scanned.includes(serial)
    ? scanned.filter((s) => s !== serial)
    : scanned;
}
