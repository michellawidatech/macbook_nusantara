/**
 * A unit's value written down while the shop holds it — "Penurunan harga
 * barang" (owner ask 2026-11-24).
 *
 * > *"Now the modal price cannot be edited, but it can go down in valuation.
 * > For example, it might decrease by 500k because it has been broken while
 * > they still store it. And this 500k minus will get into 'penurunan harga
 * > barang' … it will not decrease any bank balance or shopee or cash, but it
 * > will get into the PnL."*
 *
 * - The unit's COGS is buy + its share of the invoice's expenses + repairs −
 *   its write-downs (`costBreakdown`, `costIndex` in `lib/service.ts`).
 * - Profit & Loss lists each write-down on its own line, in the month of its
 *   `date`; a later sale's HPP is the lowered cost, so the loss is counted
 *   once, in the month the value was lost.
 * - **Editable and deletable while the unit is held** (owner choice A) and
 *   nothing has taken it out of the shop since the row was written. A unit
 *   that left and came back keeps its earlier rows locked: they are already
 *   in a past month's HPP. The store adapter checks the same against the
 *   database.
 *
 * Pure: no React, no store. `test/writeDown.test.ts` is the spec.
 */
import type { MockDb, WriteDown } from "../mock/seed.js";
import { isBuyBack } from "./service.js";

/** Where a unit is still the shop's to write down. */
export const HELD_STATUSES: ReadonlySet<string> = new Set([
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "SERVIS",
]);

/** A status that takes a unit out of the shop. */
const EXIT_STATUSES: ReadonlySet<string> = new Set([
  "TERJUAL",
  "HILANG",
  "KOREKSI_KELUAR",
  "RETUR_SUPPLIER",
]);

/** Why this unit's value cannot be written down now; undefined when it can. */
export function writeDownBlock(status: string): "LEFT" | undefined {
  return HELD_STATUSES.has(status) ? undefined : "LEFT";
}

type LedgerRow = {
  readonly serial: string;
  readonly type: string;
  readonly at: string;
  readonly toStatus: string;
  readonly fromStatus?: string;
};

/** True once an exit of the unit follows the row — it can no longer change. */
export function rowLocked(
  row: Pick<WriteDown, "serial" | "createdAt">,
  events: readonly LedgerRow[],
): boolean {
  return events.some(
    (e) =>
      e.serial === row.serial &&
      e.at > row.createdAt &&
      EXIT_STATUSES.has(e.toStatus),
  );
}

export type WriteDownProblem = "AMOUNT" | "REASON" | "BELOW_ZERO";

/**
 * What is wrong with a write-down about to be saved. `costBefore` is the
 * unit's COGS WITHOUT this row — so correcting a row is checked against the
 * cost before it, not against a cost it has already lowered.
 */
export function writeDownProblem(
  amount: number | null | undefined,
  reason: string,
  costBefore: number,
): WriteDownProblem | undefined {
  if (amount === null || amount === undefined || !(amount > 0))
    return "AMOUNT";
  if (reason.trim() === "") return "REASON";
  if (amount > costBefore) return "BELOW_ZERO";
  return undefined;
}

/** The unit's write-downs since its last buy-back, newest first. */
export function writeDownsOf(
  serial: string,
  db: Pick<MockDb, "writeDowns" | "events">,
): WriteDown[] {
  let since: string | undefined;
  for (const e of db.events)
    if (e.serial === serial && isBuyBack(e) && (since === undefined || e.at > since))
      since = e.at;
  return db.writeDowns
    .filter(
      (w) =>
        w.serial === serial && (since === undefined || w.createdAt >= since),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Σ a unit's write-downs made before `at` and after the buy-back before it.
 *
 * Profit & Loss works a past sale's cost out from today's data, so it cannot
 * use the CURRENT write-down: once a unit is bought back, "since the last
 * buy-back" drops the rows from before it, and the earlier sale's HPP would
 * go back up while those rows still sit on their own line — counted twice.
 * This is the write-down as it stood at the moment of the event.
 */
export function writeDownAt(
  rows: readonly Pick<WriteDown, "serial" | "amount" | "createdAt">[],
  events: readonly LedgerRow[],
): (serial: string, at: string) => number {
  const buyBacks = new Map<string, string[]>();
  for (const e of events)
    if (isBuyBack(e)) {
      const list = buyBacks.get(e.serial) ?? [];
      list.push(e.at);
      buyBacks.set(e.serial, list);
    }
  const bySerial = new Map<string, (typeof rows)[number][]>();
  for (const w of rows) {
    const list = bySerial.get(w.serial) ?? [];
    list.push(w);
    bySerial.set(w.serial, list);
  }
  return (serial, at) => {
    const list = bySerial.get(serial);
    if (list === undefined) return 0;
    let from: string | undefined;
    for (const b of buyBacks.get(serial) ?? [])
      if (b < at && (from === undefined || b > from)) from = b;
    return list
      .filter(
        (w) => w.createdAt <= at && (from === undefined || w.createdAt >= from),
      )
      .reduce((n, w) => n + w.amount, 0);
  };
}
