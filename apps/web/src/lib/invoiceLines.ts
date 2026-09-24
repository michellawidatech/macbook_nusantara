/**
 * The invoice as a person reads it: a product, how many, one price, a
 * discount (owner ask 2026-09-20).
 *
 * > *"The second screen (adding product) is more simple. So if the purchase
 * > has arrived, user will input: unit, qty, price. It will not automatically
 * > expand the unit below it. Input product name > QTY > price > discount >
 * > display total (+ COGS based on the tax + shipping fee displayed before)."*
 *
 * This REVERSES the per-unit price boxes of 2026-09-19. A line is one price
 * again, and two units of one product that cost different money are entered
 * as two lines — the owner's own answer when asked: *"if 2 same unit have
 * different price, they would manually input 2 times."*
 *
 * ## Nothing about the storage changed
 *
 * A `PoItem` is still one piece — that is what pins a unit to the line it
 * arrived on (`PoItem.serial`), what `lib/landedCost.ts` spreads the
 * invoice's expenses over, and what `lib/inboundRows.ts` builds the bench's
 * rows from. What changed is the READING: the lines of one product at one
 * price are one row on screen, and the row's boxes write every line under it.
 *
 * Grouped on product AND price, not on product alone. Two lines of the same
 * product at the same price are one line of an invoice however they were
 * typed; two at different prices are two, which is the whole point of the
 * owner's answer above.
 *
 * ## The discount belongs to the line
 *
 * `PurchaseOrderItem.discount` (migration
 * `20260920120000_po_item_line_discount`) is money off THESE goods, as
 * opposed to `Po.discount`, which is negotiated off the whole order. A row's
 * discount is the sum of its lines', and typing one spreads it back over them
 * with `allocateFees`, so the rupiah always add up and each piece carries its
 * own share into `Unit.buy`.
 *
 * Pure: no React, no store. `test/invoiceLines.test.ts` is the spec.
 */
import { allocateFees } from "@nusantara/domain";
import type { Po, PoItem, Unit } from "../mock/seed.js";
import {
  receivingRows,
  type IsCounted,
  type ReceivingRow,
} from "./inboundRows.js";

/** One unit a line stands for — a row of the detail popup behind it. */
export interface InvoiceUnit {
  /** The row, which is where the serial and the QC answers live. */
  readonly row: ReceivingRow;
  /** Which piece of the line it is, from 1 — the "#" the popup prints. */
  readonly n: number;
}

/** One line of the invoice, as the two inbound screens draw it. */
export interface PurchaseLine {
  /** What the table keys on: the first `PoItem` under it. */
  readonly key: string;
  /** The product the invoice names; "" while nobody has picked one. */
  readonly skuId: string;
  /** The `PoItem`s this row writes, in invoice order. */
  readonly lines: readonly PoItem[];
  /** Pieces invoiced, the ones never sent included. */
  readonly qty: number;
  /** The one price every piece of this line was bought at. */
  readonly unitCost: number;
  /** Knocked off the line — the sum of its `PoItem`s'. */
  readonly discount: number;
  /** Of the pieces, how many the supplier never sent. */
  readonly notArrived: number;
  /**
   * Of them, how many are a unit somebody has already identified — or, for a
   * counted product, how many pieces reached the stock ledger.
   */
  readonly received: number;
  /** qty × unitCost of the pieces that arrived, before the discount. */
  readonly subtotal: number;
  /** What is owed for them: the subtotal less the discount, never below nil. */
  readonly total: number;
  /** Every piece net of discount, the ones never sent included. */
  readonly invoiced: number;
  /** One per piece, in list order. Empty for a counted product. */
  readonly units: readonly InvoiceUnit[];
  /**
   * A counted product — an accessory (2026-09-19): a quantity on the stock
   * ledger, with no units under it and no serial to ask for.
   */
  readonly counted: boolean;
}

/**
 * A line's discount over its pieces, in whole rupiah that add back up.
 *
 * Evenly: a discount is given on the goods, and the goods on one line are all
 * the same price. `allocateFees` puts the leftover rupiah on the first pieces.
 */
export function spreadDiscount(discount: number, pieces: number): number[] {
  if (pieces <= 0) return [];
  return allocateFees(
    new Array<bigint>(pieces).fill(1n),
    BigInt(Math.max(0, Math.round(discount))),
  ).map(Number);
}

/**
 * What each of a line's pieces cost — its price less its share of the line's
 * discount. This is what `Unit.buy` is written from, so a discounted line
 * makes every margin behind it right rather than only the invoice total.
 */
export function pieceCosts(
  qty: number,
  unitCost: number,
  discount: number,
): number[] {
  const pieces = Math.max(0, Math.floor(qty));
  const capped = Math.min(Math.max(0, discount), unitCost * pieces);
  return spreadDiscount(capped, pieces).map((off) =>
    Math.max(0, unitCost - off),
  );
}

/** The key lines are grouped on: one product at one price. */
const groupKey = (item: PoItem) => JSON.stringify([item.skuId, item.unitCost]);

export function purchaseLines(
  po: Pick<Po, "id" | "items">,
  units: readonly Unit[],
  isCounted: IsCounted = () => false,
  arrivedOf: (itemId: string) => number = () => 0,
): PurchaseLine[] {
  const rows = receivingRows(po, units, isCounted);
  const receivedOf = new Map<string, number>();
  const unitsOf = new Map<string, ReceivingRow[]>();
  for (const row of rows) {
    if (row.itemId === null) continue;
    const held = unitsOf.get(row.itemId);
    if (held) held.push(row);
    else unitsOf.set(row.itemId, [row]);
    if (row.unit === null) continue;
    receivedOf.set(row.itemId, (receivedOf.get(row.itemId) ?? 0) + 1);
  }

  const order: string[] = [];
  const grouped = new Map<string, PoItem[]>();
  for (const item of po.items) {
    const key = groupKey(item);
    const held = grouped.get(key);
    if (held) held.push(item);
    else {
      order.push(key);
      grouped.set(key, [item]);
    }
  }

  return order.map((key) => {
    const lines = grouped.get(key)!;
    const first = lines[0]!;
    const counted = first.skuId !== "" && isCounted(first.skuId);
    // A counted line is a real quantity; an identified line is one piece,
    // and an invoice written before 2026-09-18 spells that as qty n.
    const pieces = (i: PoItem) => (counted ? i.qty : Math.max(1, i.qty));
    const came = lines.filter((i) => !i.notReceived);
    const subtotal = came.reduce((n, i) => n + i.unitCost * pieces(i), 0);
    const discountCame = came.reduce((n, i) => n + (i.discount ?? 0), 0);
    const discount = lines.reduce((n, i) => n + (i.discount ?? 0), 0);
    return {
      key: first.id,
      skuId: first.skuId,
      unitCost: first.unitCost,
      lines,
      counted,
      discount,
      qty: lines.reduce((n, i) => n + pieces(i), 0),
      notArrived: lines
        .filter((i) => i.notReceived)
        .reduce((n, i) => n + pieces(i), 0),
      received: counted
        ? lines.reduce((n, i) => n + arrivedOf(i.id), 0)
        : lines.reduce((n, i) => n + (receivedOf.get(i.id) ?? 0), 0),
      subtotal,
      total: Math.max(0, subtotal - discountCame),
      invoiced: Math.max(
        0,
        lines.reduce((n, i) => n + i.unitCost * pieces(i), 0) - discount,
      ),
      units: counted
        ? []
        : lines
            .flatMap((i) => unitsOf.get(i.id) ?? [])
            .map((row, n) => ({ row, n: n + 1 })),
    };
  });
}

/**
 * Which of a line's `PoItem`s may go when its quantity comes down.
 *
 * Only ones no unit stands in — a unit that has been scanned is proof the
 * piece arrived, and the invoice cannot be edited out from under it. From the
 * END of the line, so the rows somebody has been working down stay where they
 * are. Null when there are not enough such pieces; the page says why.
 */
export function linesToDrop(
  po: Pick<Po, "id" | "items">,
  units: readonly Unit[],
  within: readonly PoItem[],
  count: number,
  isCounted: IsCounted = () => false,
): string[] | null {
  if (count <= 0) return [];
  const held = new Set(
    receivingRows(po, units, isCounted)
      .filter((r) => r.itemId !== null && r.unit !== null)
      .map((r) => r.itemId!),
  );
  const free = within
    .filter((i) => !held.has(i.id) && i.qty <= 1)
    .map((i) => i.id);
  if (free.length < count) return null;
  return free.slice(free.length - count);
}

/**
 * Where a line's new pieces go: straight after its last one, so the units of
 * one line stay together in the popup behind it. At the end for a line the
 * invoice did not have.
 */
export function insertAfterGroup(
  items: readonly PoItem[],
  after: readonly PoItem[],
  added: readonly PoItem[],
): PoItem[] {
  const mine = new Set(after.map((i) => i.id));
  let last = -1;
  items.forEach((item, i) => {
    if (mine.has(item.id)) last = i;
  });
  if (last < 0) return [...items, ...added];
  return [...items.slice(0, last + 1), ...added, ...items.slice(last + 1)];
}
