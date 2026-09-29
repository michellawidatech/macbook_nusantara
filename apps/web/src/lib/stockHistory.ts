/**
 * Stock Movement History — the rows Inventory's second tab lists, and how one
 * of them is corrected (owner ask 2026-09-24: *"make the movement log
 * editable … each row is editable"*).
 *
 * Two records, one list. A unit's adjustment is an `Adjustment` (Postgres:
 * `StockAdjustment`); a counted product's — an accessory, by quantity since
 * 2026-09-19 — is a `KOREKSI` stock move carrying a reason. The history reads
 * both as one shape, and a correction writes back to whichever the row came
 * from.
 *
 * **What a correction may change is what somebody can get wrong and find out
 * about later**: when it happened, why, the sentence, and the battery reading
 * typed alongside a unit. **What it may not change is what the row IS** — the
 * unit, the direction, the quantity of a counted product, the batch, whose
 * hand. A unit that went out is out; a shelf that lost two pieces lost two;
 * correcting either is another adjustment, in the history like the first.
 * `packages/db`'s adapters refuse the rest and the database grants UPDATE on
 * exactly the correctable columns, so this rule is not a convention.
 *
 * **The unit follows the correction while it still says what the adjustment
 * wrote.** An adjustment copies its description and its reading onto the
 * unit; a corrected typo has to reach the unit too, or the log says 91% and
 * the shelf says 19%. But only while the unit still carries THIS row's
 * figures — a later adjustment or a QC edit that has since overwritten them
 * is the newer fact, and a correction to an old row must not undo it.
 *
 * The unit's `KOREKSI` event is left as written: the ledger is the record of
 * what was recorded at the time, and this row is the corrected one.
 */
import type { Adjustment, MockDb } from "../mock/seed.js";

export interface StockHistoryRow extends Adjustment {
  /** Set on a counted product's row: the variant, and how many pieces moved. */
  counted?: { skuId: string; qty: number };
}

/** The three readings an adjustment can carry, as the unit carries them. */
const READINGS = ["batteryHealth", "cycleCount", "fcc"] as const;

/**
 * Every unit adjusted, and every counted product adjusted by quantity — an
 * accessory's adjustment is a `KOREKSI` stock move, and it belongs in the
 * same history as a unit's. A counted row borrows the adjustment shape: its
 * `id` is the move's, its description is the move's note, and `counted` says
 * how many pieces.
 */
export function stockHistoryRows(
  db: Pick<MockDb, "adjustments" | "stockMoves">,
): StockHistoryRow[] {
  return [
    ...db.adjustments,
    ...db.stockMoves
      .filter((m) => m.type === "KOREKSI" && m.reasonId !== undefined)
      .map((m): StockHistoryRow => ({
        id: m.id,
        serial: "",
        description: m.note ?? "",
        reasonId: m.reasonId!,
        at: m.at,
        staff: m.staff,
        kind: m.qty > 0 ? "IN" : "OUT",
        batchId: m.id,
        counted: { skuId: m.skuId, qty: Math.abs(m.qty) },
      })),
  ];
}

/** The variant a row is about: the counted product's, or the unit's. */
export function stockHistorySkuId(
  db: Pick<MockDb, "units">,
  row: StockHistoryRow,
): string | undefined {
  return (
    row.counted?.skuId ?? db.units.find((u) => u.serial === row.serial)?.skuId
  );
}

export interface StockHistoryEdit {
  /** When it happened, as an ISO instant. */
  at: string;
  /** The reason, already resolved to a row in `reasons` (`ensureReason`). */
  reasonId: string;
  description: string;
  /**
   * A unit row's reading, in the fields its era reports and nothing else —
   * `batteryPatch` gives exactly that. Ignored on a counted row, which has
   * no battery.
   */
  batteryHealth?: number;
  cycleCount?: number;
  fcc?: number;
}

/**
 * Apply a correction to the record the row came from, and carry it onto the
 * unit while the unit still says what the record said. `false` when the row
 * is no longer there to correct.
 */
export function applyStockHistoryEdit(
  draft: MockDb,
  row: StockHistoryRow,
  edit: StockHistoryEdit,
): boolean {
  const description = edit.description.trim();
  if (row.counted !== undefined) {
    const move = draft.stockMoves.find((m) => m.id === row.id);
    if (move === undefined || move.type !== "KOREKSI") return false;
    move.at = edit.at;
    move.reasonId = edit.reasonId;
    if (description === "") delete move.note;
    else move.note = description;
    return true;
  }

  const adj = draft.adjustments.find((a) => a.id === row.id);
  if (adj === undefined) return false;
  const before: Adjustment = { ...adj };
  adj.at = edit.at;
  adj.reasonId = edit.reasonId;
  adj.description = description;
  for (const field of READINGS) {
    const value = edit[field];
    if (value === undefined) delete adj[field];
    else adj[field] = value;
  }

  const unit = draft.units.find((u) => u.serial === adj.serial);
  if (unit === undefined) return true;
  // Only to a sentence: an emptied box means "nothing was said", and that
  // must not blank the unit's own description.
  if (
    before.description !== "" &&
    unit.description === before.description &&
    description !== ""
  ) {
    unit.description = description;
  }
  for (const field of READINGS) {
    const was = before[field];
    if (was === undefined || unit[field] !== was) continue;
    const now = edit[field];
    if (now === was) continue;
    // Cleared on the row is cleared on the unit: the reading came from this
    // adjustment, and a correction that withdraws it withdraws it.
    if (now === undefined) delete unit[field];
    else unit[field] = now;
  }
  return true;
}
