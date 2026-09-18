/**
 * Product in Invoice: an invoice's rows, one per machine (owner revision
 * 2026-09-15).
 *
 * > *"Per unit usually have different price, so adding qty and assuming the
 * > price is the same is wrong (unit price and qty should not be on the same
 * > stage of input). Minimizing the input time & clicks → merging the 2
 * > section for inbound and QC."*
 *
 * An invoice used to be two cards: product lines of quantity × one unit cost,
 * and a Serials & QC grid derived from those quantities. Two 2017 Airs off one
 * pallet were therefore always the same price, and every machine was entered
 * twice — once inside a quantity and once as a serial.
 *
 * A row is now a machine, stored the way the schema already allowed: a
 * `PoItem` of quantity one with its own product and its own unit price, whose
 * `serial` names the `Unit` once somebody reads the sticker
 * (`PurchaseOrderItemSerial` is where that link has always gone). Nothing new
 * in the database.
 *
 * ## Invoices written before this revision
 *
 * The demo shop and the B2Soft history have lines of quantity n, with their
 * machines tied to the invoice only by product. `invoiceRows` shows such a
 * line as n rows and gives each the next machine of that product;
 * `normaliseLines` turns it into n one-piece lines — carrying each machine's
 * serial across — the first time anybody EDITS that invoice. Doing it when the
 * page is merely opened would write to the database because somebody looked.
 * The line's unit cost is copied to every piece rather than replaced by each
 * machine's own cost, so normalising never changes what an old invoice says
 * is owed.
 *
 * Pure: no React, no store.
 */
import type { Po, PoItem, Unit, UnitStatus } from "../mock/seed.js";

/** One row of Product in Invoice. */
export interface InvoiceRow {
  /**
   * What drafts are filed under: the line's id for a one-piece line,
   * `<line>#<n>` for piece n of an older multi-piece line, and
   * `unit:<serial>` for a machine on the invoice that no line accounts for.
   */
  readonly key: string;
  /** The `PoItem` behind the row; null for a machine no line accounts for. */
  readonly itemId: string | null;
  /** Which piece of its line — always 0 once the line is one piece. */
  readonly piece: number;
  /** "" while nobody has picked the product. */
  readonly skuId: string;
  /**
   * What this machine cost: the machine's own `buy` once it exists, the
   * line's unit cost before that.
   */
  readonly unitCost: number;
  /** The supplier never sent it. Still invoiced; no longer owed. */
  readonly notArrived: boolean;
  /** The machine, once its serial has been read. */
  readonly unit: Unit | null;
  /**
   * A counted product — stocked by quantity, with no serial (owner decision
   * 2026-09-15, accessories). One row for the whole line.
   */
  readonly counted: boolean;
  /** Pieces the row stands for: the line's quantity when counted, else 1. */
  readonly qty: number;
  /** A machine on this invoice that no line accounts for any more. */
  readonly orphan: boolean;
}

/** Whether a product is stocked by quantity rather than by serial. */
export type CountedPredicate = (skuId: string) => boolean;

const NOTHING_COUNTED: CountedPredicate = () => false;

export function invoiceRows(
  po: Po,
  units: readonly Unit[],
  isCounted: CountedPredicate = NOTHING_COUNTED,
): InvoiceRow[] {
  const mine = units.filter((u) => u.poId === po.id);
  const bySerial = new Map(mine.map((u) => [u.serial, u]));
  // A line's own serial is authoritative. Only machines no line names are
  // handed out by product.
  const claimed = new Set<string>();
  for (const item of po.items) {
    if (item.serial && bySerial.has(item.serial)) claimed.add(item.serial);
  }

  const rows: InvoiceRow[] = [];
  for (const item of po.items) {
    const notArrived = item.notReceived === true;
    if (item.skuId !== "" && isCounted(item.skuId)) {
      rows.push({
        key: item.id,
        itemId: item.id,
        piece: 0,
        skuId: item.skuId,
        unitCost: item.unitCost,
        notArrived,
        unit: null,
        counted: true,
        qty: Math.max(0, item.qty),
        orphan: false,
      });
      continue;
    }
    const pieces = Math.max(1, item.qty);
    for (let piece = 0; piece < pieces; piece += 1) {
      let unit: Unit | null = null;
      if (piece === 0 && item.serial) {
        // A dangling link stays dangling rather than borrowing a machine: the
        // row names a serial, and handing it somebody else's would be a lie.
        unit = bySerial.get(item.serial) ?? null;
      } else if (!notArrived && item.skuId !== "") {
        const next = mine.find(
          (u) => u.skuId === item.skuId && !claimed.has(u.serial),
        );
        if (next !== undefined) {
          unit = next;
          claimed.add(next.serial);
        }
      }
      rows.push({
        key: pieces === 1 ? item.id : `${item.id}#${piece}`,
        itemId: item.id,
        piece,
        skuId: item.skuId,
        unitCost: unit?.buy ?? item.unitCost,
        notArrived,
        unit,
        counted: false,
        qty: 1,
        orphan: false,
      });
    }
  }

  for (const unit of mine) {
    if (claimed.has(unit.serial)) continue;
    rows.push({
      key: `unit:${unit.serial}`,
      itemId: null,
      piece: 0,
      skuId: unit.skuId,
      unitCost: unit.buy,
      notArrived: false,
      unit,
      counted: false,
      qty: 1,
      orphan: true,
    });
  }
  return rows;
}

/**
 * Turn every multi-piece line of a machine into one-piece lines, in place.
 *
 * Returns which row keys moved (old key → the id of the line that now carries
 * that piece), so a page can move whatever it was holding for those rows. A
 * one-piece line whose machine was tied to it only by product gets its serial
 * written down while this is at it, so the link is explicit from then on.
 *
 * Changes nothing — and assigns nothing, so a copy-on-write draft sees no
 * edit — when the invoice is already one piece per line.
 */
export function normaliseLines(
  po: Po,
  units: readonly Unit[],
  newId: () => string,
  isCounted: CountedPredicate = NOTHING_COUNTED,
): Record<string, string> {
  const rows = invoiceRows(po, units, isCounted);
  const moved: Record<string, string> = {};
  const items: PoItem[] = [];
  let changed = false;
  for (const item of po.items) {
    const own = rows.filter((r) => r.itemId === item.id);
    const first = own[0];
    if (first === undefined || first.counted) {
      items.push(item);
      continue;
    }
    if (own.length === 1) {
      const serial = first.unit?.serial ?? null;
      if ((serial !== null && item.serial !== serial) || item.qty !== 1) {
        items.push({ ...item, qty: 1, serial: serial ?? item.serial });
        changed = true;
      } else {
        items.push(item);
      }
      continue;
    }
    changed = true;
    own.forEach((row, n) => {
      const id = n === 0 ? item.id : newId();
      moved[row.key] = id;
      items.push({
        id,
        skuId: item.skuId,
        serial: row.unit?.serial ?? null,
        qty: 1,
        unitCost: item.unitCost,
        ...(item.notReceived ? { notReceived: true } : {}),
      });
    });
  }
  if (changed) po.items = items;
  return moved;
}

/** Where a row stands, which decides what it offers. */
export type InvoiceRowState =
  | "NO_PRODUCT"
  | "NOT_ARRIVED"
  | "WAITING"
  | "IN_QC"
  | "IN_STOCK"
  | "RESERVED"
  | "ON_SERVICE"
  | "RETURNED"
  | "SOLD"
  | "GONE";

const STATE_OF_STATUS: Partial<Record<UnitStatus, InvoiceRowState>> = {
  QC: "IN_QC",
  TERSEDIA: "IN_STOCK",
  DIRESERVASI: "RESERVED",
  SERVIS: "ON_SERVICE",
  RETUR_SUPPLIER: "RETURNED",
  TERJUAL: "SOLD",
};

export function rowState(row: InvoiceRow): InvoiceRowState {
  if (row.unit !== null) return STATE_OF_STATUS[row.unit.status] ?? "GONE";
  if (row.skuId === "") return "NO_PRODUCT";
  if (row.notArrived) return "NOT_ARRIVED";
  return "WAITING";
}

/** What is still missing before a machine in QC can be accepted. */
export type AcceptGap = "unitPrice" | "sellingPrice";

/**
 * Accept moves a machine onto the sellable shelf, so it asks for the two
 * numbers a shelf needs: what the machine cost, which every margin is
 * measured against, and what it is sold for. The serial is implied — a row
 * without one has no machine to accept. The grade never gates acceptance, as
 * it never has.
 */
export function acceptGaps(row: InvoiceRow, sellingPrice: number): AcceptGap[] {
  const gaps: AcceptGap[] = [];
  if (!(row.unitCost > 0)) gaps.push("unitPrice");
  if (!(sellingPrice > 0)) gaps.push("sellingPrice");
  return gaps;
}

/**
 * Each row's share of shipping and tax, per piece, evenly (owner ask
 * 2026-09-15: *"Shipping fee and tax fee should be divided across all units
 * evenly for the COGS and margin calculation"*).
 *
 * Evenly, not by price: a courier charges for boxes, not for what is inside
 * them. Rows the supplier never sent carry nothing. Whole rupiah, and no
 * rupiah lost: the remainder goes one rupiah at a time to the first pieces,
 * in row order, so the shares add up to exactly the fees and a serial typed
 * in later moves nobody's share.
 */
export function rowShares(
  rows: readonly InvoiceRow[],
  fees: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.key, 0);
  const live = rows.filter((r) => !r.notArrived);
  const divisor = live.reduce((n, r) => n + r.qty, 0);
  if (divisor === 0 || !(fees > 0)) return out;
  const base = Math.floor(fees / divisor);
  let remainder = fees - base * divisor;
  for (const row of live) {
    let total = 0;
    for (let piece = 0; piece < row.qty; piece += 1) {
      total += base;
      if (remainder > 0) {
        total += 1;
        remainder -= 1;
      }
    }
    out.set(row.key, row.qty === 0 ? 0 : Math.round(total / row.qty));
  }
  return out;
}
