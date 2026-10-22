/**
 * Counted products — accessories — as quantities (owner decision 2026-09-19).
 *
 * > *"For accessories literally don't record any individual measurements like
 * > code, no need, that should purely be by qty."* And, asked how far: in the
 * > database too.
 *
 * A category with `tracksSerial` off has no `Unit` rows at all. What the shop
 * holds of one of its variants is the SUM of that variant's `StockMove` rows
 * at a location, and nothing stores the sum — so, like `Unit.status` against
 * its events, there is no second copy that can disagree with the ledger.
 *
 * ## Cost
 *
 * A counted product is costed by **moving average**, per variant across every
 * location (a mouse in Serpong and one in the shop are the same mouse):
 *
 * - an arrival (`MASUK`) adds its pieces at the invoice line's unit price
 *   PLUS each piece's share of the invoice's COGS expenses — the same split
 *   every unit gets (`lib/landedCost.ts`, where a counted line's pieces have
 *   always been rows of the parcel). The share is read from the invoice as it
 *   stands, so an expense added later reaches the pieces still on the shelf;
 * - any other move in (a return, a trade-in, a stock-take find, an
 *   adjustment) adds its pieces at the cost the move carries;
 * - a move out takes pieces at the average as it stands, and a SALE writes
 *   that average onto its `TERJUAL` move — the sale's COGS is a snapshot,
 *   never recomputed after the fact.
 *
 * Pure: no React, no store. `test/stock.test.ts` is the spec.
 */
import type { MockDb, Po, StockMove } from "../mock/seed.js";
import { poRowShares, rowKey } from "./landedCost.js";

/** The slices of the store this reads. `MockDb` satisfies it. */
export type StockSources = Pick<MockDb, "stockMoves" | "pos" | "units">;

/** Ledger order: by time, then by id so two moves in one instant are stable. */
export function byTime(a: StockMove, b: StockMove): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

/** On hand of one variant — at one location, or everywhere. */
export function onHand(
  moves: readonly Pick<StockMove, "skuId" | "locationId" | "qty">[],
  skuId: string,
  locationId?: string,
): number {
  let n = 0;
  for (const m of moves) {
    if (m.skuId !== skuId) continue;
    if (locationId !== undefined && m.locationId !== locationId) continue;
    n += m.qty;
  }
  return n;
}

/** Every variant's on-hand, by location: `sku → location → qty`, zeros kept out. */
export function stockLevels(
  moves: readonly Pick<StockMove, "skuId" | "locationId" | "qty">[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const m of moves) {
    let at = out.get(m.skuId);
    if (!at) out.set(m.skuId, (at = new Map()));
    at.set(m.locationId, (at.get(m.locationId) ?? 0) + m.qty);
  }
  for (const [sku, at] of out) {
    for (const [loc, n] of at) if (n === 0) at.delete(loc);
    if (at.size === 0) out.delete(sku);
  }
  return out;
}

/** Pieces of a counted invoice line that have arrived, net of take-backs. */
export function arrivedQty(
  moves: readonly Pick<StockMove, "poItemId" | "type" | "qty">[],
  poItemId: string,
): number {
  let n = 0;
  for (const m of moves) {
    if (m.poItemId !== poItemId) continue;
    if (m.type === "MASUK" || m.type === "MASUK_BATAL") n += m.qty;
  }
  return n;
}

/**
 * What one piece of an arrival costs: the move's own price plus the average
 * share of the invoice's expenses over that line's pieces.
 */
function arrivalCost(
  move: StockMove,
  po: Po | undefined,
  shares: Map<string, Map<string, number>>,
  store: StockSources,
): number {
  if (move.type !== "MASUK" || !po || !move.poItemId) return move.cost;
  let perRow = shares.get(po.id);
  if (!perRow) {
    perRow = poRowShares(po, store.units);
    shares.set(po.id, perRow);
  }
  const item = po.items.find((i) => i.id === move.poItemId);
  if (!item || item.qty <= 0) return move.cost;
  let fee = 0;
  for (let p = 0; p < item.qty; p += 1)
    fee += perRow.get(rowKey(item.id, p)) ?? 0;
  return move.cost + Math.round(fee / item.qty);
}

/**
 * The moving average cost of one piece of a variant, over the ledger up to
 * (and excluding) `before` — or all of it. Zero when nothing was ever bought.
 */
export function averageCost(
  store: StockSources,
  skuId: string,
  before?: Pick<StockMove, "at" | "id">,
): number {
  const moves = store.stockMoves
    .filter((m) => m.skuId === skuId)
    .sort(byTime)
    .filter(
      (m) =>
        before === undefined ||
        m.at < before.at ||
        (m.at === before.at && m.id < before.id),
    );
  const shares = new Map<string, Map<string, number>>();
  let qty = 0;
  let value = 0;
  let last = 0;
  for (const m of moves) {
    if (m.qty > 0) {
      const each = arrivalCost(
        m,
        store.pos.find((p) => p.id === m.poId),
        shares,
        store,
      );
      qty += m.qty;
      value += each * m.qty;
      last = each;
    } else {
      const avg = qty > 0 ? value / qty : last;
      qty += m.qty;
      value += avg * m.qty;
      if (qty <= 0) {
        // Nothing left (or a count ran ahead of the paperwork): the next
        // piece in starts the average again rather than inheriting a debt.
        qty = 0;
        value = 0;
        last = avg;
      }
    }
  }
  return Math.round(qty > 0 ? value / qty : last);
}

/**
 * Where `qty` pieces of a variant come from: the preferred location first,
 * then the others fullest first. Null when the shop does not hold that many.
 */
export function takeFrom(
  moves: readonly Pick<StockMove, "skuId" | "locationId" | "qty">[],
  skuId: string,
  qty: number,
  prefer?: string,
): { locationId: string; qty: number }[] | null {
  const at = stockLevels(moves).get(skuId) ?? new Map<string, number>();
  const order = [...at.entries()]
    .filter(([, n]) => n > 0)
    .sort(
      ([a, x], [b, y]) =>
        Number(b === prefer) - Number(a === prefer) ||
        y - x ||
        a.localeCompare(b),
    );
  const out: { locationId: string; qty: number }[] = [];
  let left = qty;
  for (const [locationId, n] of order) {
    if (left <= 0) break;
    const take = Math.min(n, left);
    out.push({ locationId, qty: take });
    left -= take;
  }
  return left > 0 ? null : out;
}

/** What a sale's counted line cost the shop: its `TERJUAL` moves, net. */
export function lineCost(
  moves: readonly Pick<StockMove, "orderLineId" | "type" | "qty" | "cost">[],
  orderLineId: string,
): number {
  let total = 0;
  for (const m of moves) {
    // Sold pieces, less any an Edit transaction put back (2026-10-22).
    if (
      m.orderLineId !== orderLineId ||
      (m.type !== "TERJUAL" && !(m.type === "KOREKSI" && m.qty > 0))
    )
      continue;
    total += -m.qty * m.cost;
  }
  return total;
}

/**
 * A sale's counted lines as words — "Magic Mouse White ×2" — for the lists
 * that print a sale's serials and have no serial to print for an accessory.
 */
export function countedLineLabels(
  skus: readonly {
    readonly id: string;
    readonly name: string;
    readonly variantLabel: string;
  }[],
  lines:
    readonly { readonly skuId: string; readonly qty: number }[] | undefined,
): string[] {
  return (lines ?? []).map((l) => {
    const sku = skus.find((s) => s.id === l.skuId);
    return `${sku ? `${sku.name} ${sku.variantLabel}` : l.skuId} ×${l.qty}`;
  });
}

/** Pieces sold on a sale: its units plus its counted lines' quantities. */
export function piecesSold(order: {
  readonly serials: readonly string[];
  readonly lines?: readonly { readonly qty: number }[];
}): number {
  return (
    order.serials.length + (order.lines ?? []).reduce((n, l) => n + l.qty, 0)
  );
}
