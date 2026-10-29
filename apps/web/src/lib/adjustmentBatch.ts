/**
 * What is wrong with a batch of stock adjustments, as a function.
 *
 * Kept out of `StockAdjustmentPage` for the reason `scanFill.ts` gives about
 * Stock In's auto-advance: this is the part with the interesting cases — a
 * serial nothing carries, the same serial twice, a unit that is already where
 * you are trying to send it — and a component has to be rendered to check
 * those, while a function can be read.
 *
 * The rule that is easiest to get wrong, written down: **a unit still in QC
 * cannot be adjusted at all.** Not because the flow forbids it, but because
 * `Unit.price` is NULL until QC prices it and the database's
 * `Unit_price_set_when_sellable_check` reads
 * `status = 'QC' OR (price IS NOT NULL AND price > 0)`. Moving such a unit to
 * TERSEDIA — or to HILANG, which is just as much "not QC" — would leave a row
 * the real schema refuses to store. Stock In is where a unit gets its price,
 * so that is where a unit in QC is dealt with.
 */
import {
  CYCLE_COUNT_MAX,
  CYCLE_COUNT_MIN,
  FCC_MAX,
  FCC_MIN,
  isBatteryHealthInRange,
  isCycleCountInRange,
  isFccInRange,
} from "./battery.js";
import { HELD_STATUSES } from "./inventory.js";
import type { AdjustmentKind, Unit } from "../mock/seed.js";

/** Serials are compared and stored one way: trimmed and upper-case. */
export const normaliseSerial = (s: string) => s.trim().toUpperCase();

export interface BatchLine {
  serial: string;
  /** The product staff picked for a serial the system does not carry. */
  skuId?: string;
  /**
   * Percentage of original capacity, if anyone read one off the machine.
   * A 2021-or-later machine's reading — see `batteryEra` in lib/battery.ts.
   */
  batteryHealth?: number;
  /** Charge cycles, for a 2020-or-earlier machine. */
  cycleCount?: number;
  /** Full charge capacity in mAh, beside the cycle count. */
  fcc?: number;
}

/**
 * A counted product on the batch — an accessory, by quantity (2026-09-19).
 * `onHand` is what the shelf holds of it where an OUT would take from.
 */
export interface CountedBatchLine {
  skuId?: string;
  /** Name for the messages; the product's own. */
  label: string;
  qty: number | null;
  onHand: number;
}

export interface BatchInput {
  kind: AdjustmentKind;
  reason: string;
  /** Only the lines the operator actually touched. */
  lines: readonly BatchLine[];
  /** Counted products on the batch, if any. */
  counted?: readonly CountedBatchLine[];
  /**
   * The warehouse an IN batch puts its units in. A unit already on the shelf
   * somewhere else is a TRANSFER (2026-10-29: C02CK4Y2ML7J in 03 could not be
   * moved to 05, because every in-stock unit was refused); only one already
   * in this warehouse is a no-op.
   */
  locationId?: string;
}

/** On the shelf: an IN of one of these moves it, keeping its status. */
export const IN_STOCK: readonly string[] = ["TERSEDIA", "DIRESERVASI"];

/**
 * Everything wrong with the batch, in the order a reader would fix it. Empty
 * means it can be written.
 *
 * `statusLabel` is passed in rather than imported so this file needs neither
 * the enum maps nor a `t` — the caller already has both.
 */
export function batchProblems(
  { kind, reason, lines, counted = [], locationId }: BatchInput,
  unitBySerial: (serial: string) => Unit | undefined,
  statusLabel: (status: string) => string,
  warehouseLabel: (locationId: string) => string = (id) => id,
): string[] {
  const out: string[] = [];
  if (!reason.trim()) out.push("Pick or type a reason for this batch.");
  if (lines.length === 0 && counted.length === 0)
    out.push("Add at least one unit.");
  const seenSku = new Set<string>();
  for (const c of counted) {
    if (!c.skuId) {
      out.push("Every counted line needs its product.");
      continue;
    }
    if (seenSku.has(c.skuId)) out.push(`${c.label} is on this batch twice.`);
    seenSku.add(c.skuId);
    if (c.qty === null || !Number.isInteger(c.qty) || c.qty <= 0) {
      out.push(`${c.label} needs a quantity of at least 1.`);
      continue;
    }
    if (kind === "OUT" && c.qty > c.onHand) {
      out.push(
        `${c.label}: only ${c.onHand} in stock — ${c.qty} cannot be taken out.`,
      );
    }
  }

  const seen = new Set<string>();
  for (const line of lines) {
    const serial = normaliseSerial(line.serial);
    if (!serial) {
      out.push("Every line needs a serial number.");
      continue;
    }
    if (seen.has(serial)) out.push(`${serial} is on this batch twice.`);
    seen.add(serial);

    // Checked here rather than left to the input's own `max`, and checked
    // before the unit is looked at so that a line with something else wrong
    // with it still reports this too. antd's bound does not refuse an
    // out-of-range number, it snaps it when the box is left — so a stray digit
    // becomes a reading of a machine nobody measured, and the batch writes it
    // onto the unit, the adjustment and the timeline note in one go.
    if (!isBatteryHealthInRange(line.batteryHealth)) {
      out.push(
        `${serial} has a battery health of ${line.batteryHealth}% — a reading is 0 to 100.`,
      );
    }
    if (!isCycleCountInRange(line.cycleCount)) {
      out.push(
        `${serial} has a cycle count of ${line.cycleCount} — a count is ${CYCLE_COUNT_MIN} to ${CYCLE_COUNT_MAX}.`,
      );
    }
    if (!isFccInRange(line.fcc)) {
      out.push(
        `${serial} has a capacity of ${line.fcc} mAh — a capacity is ${FCC_MIN} to ${FCC_MAX}.`,
      );
    }

    const unit = unitBySerial(serial);
    if (!unit) {
      // An unknown serial is a unit the shop has and the system does not. That
      // is a thing you can put IN; there is nothing to take out.
      if (kind === "OUT") {
        out.push(
          `${serial} is not in the system — an unknown serial can only be adjusted in.`,
        );
      } else if (!line.skuId) {
        out.push(`${serial} is unknown — choose its product and specs.`);
      }
      continue;
    }
    if (unit.status === "QC") {
      out.push(
        `${serial} is still in QC — accept or reject it in Stock In, which is where it gets its price.`,
      );
      continue;
    }
    // On the bench, a unit comes back through the service screen's *Back in
    // stock*, which closes the visit; adjusting it here would leave the bench
    // waiting for a unit that is already on a shelf (or written off).
    if (unit.status === "SERVIS") {
      out.push(
        `${serial} is on service — bring it back with Back in stock on the Service page.`,
      );
      continue;
    }
    // A sold unit is still on its receipt. Putting it back here would leave
    // the sale carrying a unit the shelf also offers; that is a customer
    // return, which credits the sale in the same write.
    if (kind === "IN" && unit.status === "TERJUAL") {
      out.push(`${serial} is sold — take it back through Returns.`);
      continue;
    }
    if (
      kind === "IN" &&
      IN_STOCK.includes(unit.status) &&
      (locationId === undefined || unit.locationId === locationId)
    ) {
      out.push(
        `${serial} is already in ${warehouseLabel(unit.locationId)} (${statusLabel(unit.status)}).`,
      );
    }
    if (kind === "OUT" && !HELD_STATUSES.includes(unit.status)) {
      out.push(
        `${serial} is ${statusLabel(unit.status)} — there is nothing to take out.`,
      );
    }
  }
  return out;
}
