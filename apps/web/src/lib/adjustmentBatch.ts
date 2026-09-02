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
import { isBatteryHealthInRange } from "./battery.js";
import { HELD_STATUSES } from "./inventory.js";
import type { AdjustmentKind, Unit } from "../mock/seed.js";

/** Serials are compared and stored one way: trimmed and upper-case. */
export const normaliseSerial = (s: string) => s.trim().toUpperCase();

export interface BatchLine {
  serial: string;
  /** The product staff picked for a serial the system does not carry. */
  skuId?: string;
  /** Percentage of original capacity, if anyone read one off the machine. */
  batteryHealth?: number;
}

export interface BatchInput {
  kind: AdjustmentKind;
  reason: string;
  /** Only the lines the operator actually touched. */
  lines: readonly BatchLine[];
}

/** In stock right now, in the sense an IN adjustment would be a no-op. */
const IN_STOCK = ["TERSEDIA", "DIRESERVASI"];

/**
 * Everything wrong with the batch, in the order a reader would fix it. Empty
 * means it can be written.
 *
 * `statusLabel` is passed in rather than imported so this file needs neither
 * the enum maps nor a `t` — the caller already has both.
 */
export function batchProblems(
  { kind, reason, lines }: BatchInput,
  unitBySerial: (serial: string) => Unit | undefined,
  statusLabel: (status: string) => string,
): string[] {
  const out: string[] = [];
  if (!reason.trim()) out.push("Pick or type a reason for this batch.");
  if (lines.length === 0) out.push("Add at least one unit.");

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
    if (kind === "IN" && IN_STOCK.includes(unit.status)) {
      out.push(`${serial} is already in stock (${statusLabel(unit.status)}).`);
    }
    if (kind === "OUT" && !HELD_STATUSES.includes(unit.status)) {
      out.push(
        `${serial} is ${statusLabel(unit.status)} — there is nothing to take out.`,
      );
    }
  }
  return out;
}
