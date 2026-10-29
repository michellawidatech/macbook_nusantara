/**
 * Undo a stock movement (owner ask 2026-10-29: *"they should be able to undo
 * the stock movement and it will be erased from the history"*).
 *
 * One row of Stock Movement History is taken back as if it never happened:
 *
 * - **A unit's row** removes the `Adjustment` AND the unit's `KOREKSI` event
 *   it wrote, so the unit goes back to what the row before it says — the
 *   warehouse it came from, the status it had. `removeLastEvent` does the
 *   projection, the same door S/N history's delete uses.
 * - **A counted product's row** removes its `KOREKSI` stock move, so the
 *   shelf's SUM(qty) is what it was before.
 *
 * Refused, each because the undo could not put things back as they were:
 *
 * - `MOVED_ON` — the unit has a newer row than this adjustment. Taking out a
 *   row from the middle would leave the unit where the later row put it,
 *   which is not an undo. Undo the later one first.
 * - `CREATED_UNIT` — the adjustment brought in a serial the system did not
 *   know. Undoing it would leave a unit with no history; write it off with
 *   Stock out instead.
 * - `RELEASED_HOLD` — the adjustment took a reserved unit out and released
 *   its hold. Putting the status back would claim a hold that no longer
 *   lists the unit.
 * - `SHELF_SHORT` — the pieces brought in have since been sold or moved, so
 *   removing them would leave the shelf below zero.
 *
 * Pure apart from the `removeLastEvent` it is handed; `test/stockUndo.test.ts`
 * is the review. On Postgres the adapters accept the removal and the database
 * holds the counted half to KOREKSI moves with a reason
 * (`stock_move_drop_adjustment`, migration 20261029090000).
 */
import type { MockDb } from "../mock/seed.js";
import { onHand } from "./stock.js";
import type { StockHistoryRow } from "./stockHistory.js";

export type UndoBlock =
  "NOT_FOUND" | "MOVED_ON" | "CREATED_UNIT" | "RELEASED_HOLD" | "SHELF_SHORT";

/**
 * How far apart an adjustment and the event it wrote may be stamped. The
 * batch stamped them separately until 2026-10-29 (it passes one instant
 * now), a few milliseconds apart at most.
 */
const SAME_WRITE_MS = 5_000;

type Db = Pick<MockDb, "adjustments" | "stockMoves" | "events" | "units">;

/** The unit's KOREKSI event this adjustment wrote, if it is still the newest row. */
function eventOf(db: Db, row: StockHistoryRow) {
  const mine = db.events
    .filter((e) => e.serial === row.serial)
    .sort((a, b) => a.seq - b.seq);
  const last = mine[mine.length - 1];
  const at = Date.parse(row.at);
  const isOurs = (e: (typeof mine)[number]) =>
    e.type === "KOREKSI" && Math.abs(Date.parse(e.at) - at) <= SAME_WRITE_MS;
  return { mine, last, isOurs };
}

/** Why this row cannot be undone, or null when it can. */
export function undoBlock(db: Db, row: StockHistoryRow): UndoBlock | null {
  if (row.counted) {
    const move = db.stockMoves.find((m) => m.id === row.id);
    if (!move) return "NOT_FOUND";
    // An IN put pieces on this shelf; taking them back must leave it at zero
    // or above. An OUT's undo only adds.
    if (
      move.qty > 0 &&
      onHand(db.stockMoves, move.skuId, move.locationId) < move.qty
    )
      return "SHELF_SHORT";
    return null;
  }
  if (!db.adjustments.some((a) => a.id === row.id)) return "NOT_FOUND";
  if (row.newUnit) return "CREATED_UNIT";
  const { mine, last, isOurs } = eventOf(db, row);
  if (!last || !isOurs(last)) return "MOVED_ON";
  if (mine.length < 2) return "CREATED_UNIT";
  if (row.kind === "OUT" && last.fromStatus === "DIRESERVASI")
    return "RELEASED_HOLD";
  return null;
}

/**
 * Take the row back, inside a `mutate`. Returns false (and changes nothing)
 * when `undoBlock` would refuse it.
 */
export function undoStockMovement(
  draft: MockDb,
  row: StockHistoryRow,
  removeLastEvent: (draft: MockDb, serial: string) => unknown,
): boolean {
  if (undoBlock(draft, row) !== null) return false;
  if (row.counted) {
    draft.stockMoves = draft.stockMoves.filter((m) => m.id !== row.id);
    return true;
  }
  removeLastEvent(draft, row.serial);
  draft.adjustments = draft.adjustments.filter((a) => a.id !== row.id);
  return true;
}
