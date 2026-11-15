/**
 * Why stock moved — a short fixed list, each reason with its own behaviour
 * (owner ask 2026-10-30: *"the reason should be predefined … and each of that
 * will have the corresponding behavior"*).
 *
 * It replaces the free-typed reason. A typed reason said why and did nothing:
 * the batch wrote the same KOREKSI whether it was a transfer or a write-off,
 * and the screens that know how to do a service visit or a return were a
 * different door with different questions. Now the reason IS the door:
 *
 * | | Stock out | Stock in |
 * |---|---|---|
 * | Internal use | written off (HILANG) | not offered since 2026-11-16 |
 * | Stock transfer | moved to the warehouse picked | the same |
 * | Service | the batch send (`ServiceBatchForm`) | the batch back |
 * | Return | to the supplier (`SupplierReturnForm`) | from a customer (`CustomerReturnForm`) |
 *
 * Internal use and Stock transfer are written by the adjustment batch itself,
 * under an `ADJUSTMENT` reason of that name (`ensureReason`), so the history
 * and the schema's `reasonId` are unchanged. Service and the two returns are
 * the forms that already do that job, drawn inside the same dialog since
 * 2026-11-16 (they used to be a second dialog the first one handed over to).
 *
 * **What each button offers, 2026-11-16 (owner):** Stock Out — Internal use,
 * Service, Return to supplier, Stock transfer; Stock In — Stock transfer,
 * Return from customer, Back from service. Stock In's Internal use (a
 * written-off unit found again) is no longer offered; the batch still knows
 * how to write it (`batchProblems` with kind IN and mode INTERNAL), so
 * nothing else that reads that path changes.
 *
 * Pure: `test/stockReasons.test.ts`.
 */
import type { AdjustmentKind } from "../mock/seed.js";

export type StockReason =
  "INTERNAL" | "TRANSFER" | "SERVICE" | "SUPPLIER_RETURN" | "CUSTOMER_RETURN";

/** The types each button offers, in the order they are drawn (2026-11-16). */
export function reasonsFor(kind: AdjustmentKind): readonly StockReason[] {
  return kind === "OUT"
    ? ["INTERNAL", "SERVICE", "SUPPLIER_RETURN", "TRANSFER"]
    : ["TRANSFER", "CUSTOMER_RETURN", "SERVICE"];
}

/** Written by the adjustment batch, rather than handed to another dialog. */
export function isBatchReason(r: StockReason): r is "INTERNAL" | "TRANSFER" {
  return r === "INTERNAL" || r === "TRANSFER";
}

/**
 * The `ADJUSTMENT` reason a batch is filed under. Stored, so English and
 * frozen, the footing every event note is on; `reasonWord` reads it back in
 * the desk's language.
 */
export const STORED_REASON: Record<"INTERNAL" | "TRANSFER", string> = {
  INTERNAL: "Internal use",
  TRANSFER: "Stock transfer",
};

/** Which fixed reason a stored label is, if it is one of them. */
export function fixedReasonOf(
  label: string | undefined,
): "INTERNAL" | "TRANSFER" | undefined {
  const l = (label ?? "").trim().toLowerCase();
  if (l === STORED_REASON.INTERNAL.toLowerCase()) return "INTERNAL";
  if (l === STORED_REASON.TRANSFER.toLowerCase()) return "TRANSFER";
  return undefined;
}

/**
 * The cheapest whole-rupiah split of one charge over n units: equal shares,
 * the rupiah that do not divide going to the first unit, so the shares add up
 * to the charge exactly (owner: the courier fee "split to the COGS").
 */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const whole = Math.max(0, Math.round(total));
  const share = Math.floor(whole / n);
  const out = Array.from({ length: n }, () => share);
  out[0] = share + (whole - share * n);
  return out;
}
