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
import type { Adjustment, MockDb, StockMove, UnitEvent } from "../mock/seed.js";

export interface StockHistoryRow extends Adjustment {
  /** Set on a counted product's row: the variant, and how many pieces moved. */
  counted?: { skuId: string; qty: number };
  /**
   * Set on a row read off the ledger rather than an adjustment (2026-11-04):
   * what kind of movement it was. Such a row is read-only — it is corrected
   * where it was made (the service bench, the till, the return desk).
   */
  movement?: LedgerMovement;
  fromLocationId?: string;
  toLocationId?: string;
}

/** The movements the history recaps beside the adjustments. */
export type LedgerMovement =
  | "RECEIVED"
  | "SOLD"
  | "CUSTOMER_RETURN"
  | "SUPPLIER_RETURN"
  | "TO_SERVICE"
  | "FROM_SERVICE"
  | "MOVED"
  | "WRITTEN_OFF"
  | "FOUND"
  | "TRADE_IN"
  | "STOCK_TAKE"
  | "ARRIVAL_UNDONE"
  | "CORRECTION";

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

/** Within this of an adjustment, a unit's event IS that adjustment's. */
const PAIR_MS = 5_000;

/**
 * What a unit event was as a movement, or null when it moved nothing — a QC
 * acceptance, a hold, a note. `prev` is the unit's event before it.
 */
function unitMovement(
  e: UnitEvent,
  prev: UnitEvent | undefined,
): { movement: LedgerMovement; kind: "IN" | "OUT" } | null {
  const from = prev?.locationId;
  const moved = from !== undefined && from !== e.locationId;
  if (e.type === "DITERIMA") return { movement: "RECEIVED", kind: "IN" };
  if (e.type === "TERJUAL") return { movement: "SOLD", kind: "OUT" };
  if (e.type === "TUKAR_TAMBAH") return { movement: "TRADE_IN", kind: "IN" };
  if (e.type === "RETUR_PELANGGAN")
    return { movement: "CUSTOMER_RETURN", kind: "IN" };
  if (e.type === "OPNAME_DITEMUKAN") return { movement: "FOUND", kind: "IN" };
  if (e.toStatus === "RETUR_SUPPLIER" && e.fromStatus !== "RETUR_SUPPLIER")
    return { movement: "SUPPLIER_RETURN", kind: "OUT" };
  if (e.toStatus === "SERVIS" && e.fromStatus !== "SERVIS")
    return { movement: "TO_SERVICE", kind: "OUT" };
  if (e.fromStatus === "SERVIS" && e.toStatus !== "SERVIS")
    return { movement: "FROM_SERVICE", kind: "IN" };
  if (e.toStatus === "HILANG" && e.fromStatus !== "HILANG")
    return { movement: "WRITTEN_OFF", kind: "OUT" };
  if (e.fromStatus === "HILANG" && e.toStatus !== "HILANG")
    return { movement: "FOUND", kind: "IN" };
  if (moved) return { movement: "MOVED", kind: "IN" };
  return null;
}

const COUNTED_MOVEMENT: Partial<Record<StockMove["type"], LedgerMovement>> = {
  MASUK: "RECEIVED",
  MASUK_BATAL: "ARRIVAL_UNDONE",
  TERJUAL: "SOLD",
  RETUR_PELANGGAN: "CUSTOMER_RETURN",
  RETUR_SUPPLIER: "SUPPLIER_RETURN",
  TUKAR_TAMBAH: "TRADE_IN",
  OPNAME: "STOCK_TAKE",
  KOREKSI: "CORRECTION",
};

/**
 * Every movement the adjustments do not already list (owner report
 * 2026-11-04: a unit sent to service in another warehouse was in no
 * history): a unit's received, sold, returned, serviced, moved, written off
 * or found — read off its ledger — and a counted product's every stock move
 * that is not an adjustment's. Read-only rows; `stockHistoryRows` keeps the
 * editable ones.
 */
export function ledgerMovementRows(
  db: Pick<MockDb, "events" | "adjustments" | "stockMoves">,
): StockHistoryRow[] {
  const adjusted = new Map<string, number[]>();
  for (const a of db.adjustments) {
    const list = adjusted.get(a.serial) ?? [];
    list.push(Date.parse(a.at));
    adjusted.set(a.serial, list);
  }
  const bySerial = new Map<string, UnitEvent[]>();
  for (const e of db.events) {
    const list = bySerial.get(e.serial) ?? [];
    list.push(e);
    bySerial.set(e.serial, list);
  }
  const out: StockHistoryRow[] = [];
  for (const [serial, events] of bySerial) {
    events.sort((a, b) => a.seq - b.seq);
    const stamps = adjusted.get(serial) ?? [];
    events.forEach((e, i) => {
      const prev = events[i - 1];
      const m = unitMovement(e, prev);
      if (!m) return;
      const t = Date.parse(e.at);
      if (stamps.some((s) => Math.abs(s - t) <= PAIR_MS)) return;
      out.push({
        id: `ev:${e.id}`,
        serial,
        description: e.note ?? "",
        reasonId: "",
        at: e.at,
        staff: e.staff,
        kind: m.kind,
        batchId: e.id,
        movement: m.movement,
        ...(prev && prev.locationId !== e.locationId
          ? { fromLocationId: prev.locationId }
          : {}),
        toLocationId: e.locationId,
      });
    });
  }
  for (const s of db.stockMoves) {
    if (s.type === "KOREKSI" && s.reasonId !== undefined) continue;
    const movement = COUNTED_MOVEMENT[s.type];
    if (!movement) continue;
    out.push({
      id: `sm:${s.id}`,
      serial: "",
      description: s.note ?? "",
      reasonId: "",
      at: s.at,
      staff: s.staff,
      kind: s.qty > 0 ? "IN" : "OUT",
      batchId: s.id,
      counted: { skuId: s.skuId, qty: Math.abs(s.qty) },
      movement,
      ...(s.qty > 0
        ? { toLocationId: s.locationId }
        : { fromLocationId: s.locationId }),
    });
  }
  return out;
}
