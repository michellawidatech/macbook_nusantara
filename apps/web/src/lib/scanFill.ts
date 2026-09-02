/**
 * Where a scanned serial goes on a grid of rows that are each waiting for one.
 *
 * This is the rule behind Stock In's auto-advance, kept out of the component
 * because it is the part with the interesting cases: the same serial arriving
 * twice, a serial the system already knows, and a grid with nothing left to
 * fill. A component can be rendered to check those, but a function can be read.
 */

export interface FillRow {
  /** The unit's current key — a `TBD-…` placeholder until a serial is set. */
  readonly key: string;
  /** What that row's serial cell currently shows, trimmed. */
  readonly shown: string;
}

export type FillPlan =
  | { readonly kind: "fill"; readonly rowKey: string }
  /** The serial is already a unit in the system — accepting it would collide. */
  | { readonly kind: "exists" }
  /** Already typed or scanned onto another row of this same intake. */
  | { readonly kind: "duplicate"; readonly rowKey: string }
  /** Every row already carries a serial. */
  | { readonly kind: "full" };

export function planSerialFill(
  serial: string,
  rows: readonly FillRow[],
  isKnownSerial: (serial: string) => boolean,
): FillPlan {
  if (isKnownSerial(serial)) return { kind: "exists" };

  const clash = rows.find((r) => r.shown === serial);
  if (clash !== undefined) return { kind: "duplicate", rowKey: clash.key };

  const target = rows.find((r) => r.shown === "");
  if (target === undefined) return { kind: "full" };

  return { kind: "fill", rowKey: target.key };
}
