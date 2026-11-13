/**
 * Which variants need restocking — the *Needs restock* card on Today (owner
 * ask 2026-11-13: *"on top he can see which needs restock"*).
 *
 * The owner named the card and left the rule to the builder. The rule:
 *
 * > A variant **sold at least once in the last 30 days** whose **stock
 * > available to sell** is **below what it sold in those 30 days**.
 *
 * - **Sold** is what left on a receipt in the window: a tracked variant's
 *   serials plus a counted product's pieces, less any pieces that came back
 *   (`OrderLine.returnedQty`). A sale deleted from Transaction History is not
 *   in `orders`, so it is not counted.
 * - **Available** is a tracked variant's units on the shelf (`TERSEDIA`) — a
 *   unit in QC is not sellable yet, one at service is away, and one a DP holds
 *   is already a customer's — and a counted product's `StockMove` on-hand.
 * - Thirty days, because that is a month of the shop's selling and a variant
 *   that sold once last year is not a restock question. A variant that never
 *   sold is not asked about: there is no rate to fall below.
 *
 * The list is ordered by how far short it is (sold − available), then by
 * name, so the worst gap is on top.
 *
 * Pure: no React, no store. `test/restock.test.ts` is the spec.
 */

/** A month of selling. */
export const RESTOCK_WINDOW_DAYS = 30;

export interface RestockSources {
  readonly orders: readonly {
    readonly ts: string;
    readonly serials: readonly string[];
    readonly lines?: readonly {
      readonly skuId: string;
      readonly qty: number;
      readonly returnedQty?: number;
    }[];
  }[];
  readonly units: readonly {
    readonly serial: string;
    readonly skuId: string;
    readonly status: string;
  }[];
  readonly stockMoves: readonly {
    readonly skuId: string;
    readonly qty: number;
  }[];
  readonly skus: readonly {
    readonly id: string;
    readonly name: string;
    readonly variantLabel: string;
    readonly mergedIntoId?: string;
  }[];
}

export interface RestockRow {
  readonly skuId: string;
  readonly name: string;
  readonly variantLabel: string;
  /** Available to sell now. */
  readonly onHand: number;
  /** Pieces sold in the window. */
  readonly sold: number;
  /** sold − onHand, always above zero. */
  readonly short: number;
}

/** Every variant short of a month's selling, worst first. */
export function needsRestock(
  src: RestockSources,
  now: Date = new Date(),
  days: number = RESTOCK_WINDOW_DAYS,
): RestockRow[] {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const skuOfSerial = new Map(src.units.map((u) => [u.serial, u.skuId]));

  const sold = new Map<string, number>();
  const add = (skuId: string, n: number) => {
    if (n > 0) sold.set(skuId, (sold.get(skuId) ?? 0) + n);
  };
  for (const o of src.orders) {
    if (o.ts < since || o.ts > now.toISOString()) continue;
    for (const s of o.serials) {
      const sku = skuOfSerial.get(s);
      if (sku !== undefined) add(sku, 1);
    }
    for (const l of o.lines ?? []) add(l.skuId, l.qty - (l.returnedQty ?? 0));
  }

  const onShelf = new Map<string, number>();
  for (const u of src.units)
    if (u.status === "TERSEDIA")
      onShelf.set(u.skuId, (onShelf.get(u.skuId) ?? 0) + 1);
  const pieces = new Map<string, number>();
  for (const m of src.stockMoves)
    pieces.set(m.skuId, (pieces.get(m.skuId) ?? 0) + m.qty);

  const rows: RestockRow[] = [];
  for (const [skuId, n] of sold) {
    const sku = src.skus.find((s) => s.id === skuId);
    // A variant merged into another (2026-10-21) sells and stocks as that one
    // now; its old receipts are history, not a restock question.
    if (sku === undefined || sku.mergedIntoId !== undefined) continue;
    const have = Math.max(
      0,
      (onShelf.get(skuId) ?? 0) + (pieces.get(skuId) ?? 0),
    );
    if (have >= n) continue;
    rows.push({
      skuId,
      name: sku.name,
      variantLabel: sku.variantLabel,
      onHand: have,
      sold: n,
      short: n - have,
    });
  }
  return rows.sort(
    (a, b) =>
      b.short - a.short ||
      `${a.name} ${a.variantLabel}`.localeCompare(
        `${b.name} ${b.variantLabel}`,
      ),
  );
}
