/**
 * Receiving: an invoice's machines, one row each (owner revision 2026-09-15;
 * the page was rebuilt around it on 2026-09-18).
 *
 * > *"Per unit usually have different price, so adding qty and assuming the
 * > price is the same is wrong (unit price and qty should not be on the same
 * > stage of input). Minimizing the input time & clicks → merging the 2
 * > section for inbound and QC, marked as 'not arrived', and edit the SKU/unit
 * > name."*
 *
 * An invoice used to be two cards: product lines of quantity × one unit cost,
 * and a Serials & QC grid derived from those quantities. Two 2017 Airs off one
 * pallet were therefore always the same price, and every machine was entered
 * twice — once inside a quantity and once as a serial.
 *
 * A row is now a machine, stored the way the schema already allowed and the
 * way the demo shop was already seeded: a `PoItem` of quantity one with its
 * own product and its own unit cost, whose `serial` names the `Unit` once
 * somebody reads the sticker (`PurchaseOrderItemSerial` is where that link has
 * always gone). Nothing new in the database.
 *
 * ## What the invoice expected, and what turned up
 *
 * The LINE says what the supplier invoiced — `PoItem.skuId` — and the UNIT
 * says what the machine turned out to be — `Unit.skuId`. The scanner reads a
 * serial and nothing else, so when the two differ it is because a person
 * looked at the machine and said so, and the line is left alone: that is what
 * lets the screen say "invoiced as an M1, received as an M2" instead of
 * quietly rewriting the invoice to match the pallet.
 *
 * A line the supplier never sent keeps its `notReceived` flag, now per machine
 * rather than per product: three of five turning up is three rows received
 * and two rows marked not arrived — still invoiced, no longer owed
 * (`poTotals`).
 *
 * ## Invoices written before this revision
 *
 * The B2Soft history and anything raised through the order form have lines of
 * quantity n, with their machines tied to the invoice only by product.
 * `receivingRows` shows such a line as n rows and gives each the next machine
 * of that product; `normaliseLines` turns it into n one-piece lines — carrying
 * each machine's serial across — the first time anybody EDITS that invoice.
 * Doing it when the page is merely opened would write to the database because
 * somebody looked. The line's unit cost is copied to every piece rather than
 * replaced by each machine's own cost, so normalising never changes what an
 * old invoice says is owed.
 *
 * Pure: no React, no store. `test/inboundRows.test.ts` is the spec.
 */
import type { Po, PoItem, Unit, UnitStatus } from "../mock/seed.js";
import { qcReady } from "./inboundQc.js";

/** One row of the receiving table — one machine. */
export interface ReceivingRow {
  /**
   * What the page files drafts under: the line's id for a one-piece line,
   * `<line>#<n>` for piece n of an older multi-piece line, and
   * `unit:<serial>` for a machine on the invoice that no line accounts for.
   */
  readonly key: string;
  /** The `PoItem` behind the row; null for a machine no line accounts for. */
  readonly itemId: string | null;
  /** Which piece of its line — always 0 once the line is one piece. */
  readonly piece: number;
  /**
   * The product the INVOICE names for this machine. "" while nobody has picked
   * one, and "" for a machine no line accounts for — nothing expected it.
   */
  readonly expectedSkuId: string;
  /** The machine, once its serial has been read. */
  readonly unit: Unit | null;
  /**
   * What this unit cost: the unit's own `buy` once it exists, the line's unit
   * price NET of the line's discount before that (owner ask 2026-09-20). The
   * page writes both together, so they only disagree on an invoice edited
   * before this revision.
   */
  readonly unitCost: number;
  /** The supplier never sent it. Still invoiced; no longer owed. */
  readonly notArrived: boolean;
  /** A machine on this invoice that no line accounts for any more. */
  readonly orphan: boolean;
}

/**
 * Is this variant COUNTED rather than identified — an accessory
 * (2026-09-19)? A counted product's line is a quantity that arrives on a
 * stock move, never a row of machines, so every function here leaves it out.
 */
export type IsCounted = (skuId: string) => boolean;

const NOTHING_COUNTED: IsCounted = () => false;

/**
 * A line's discount over its pieces, in whole rupiah that add back up — the
 * leftover on the first pieces. The same split `lib/invoiceLines.ts` does;
 * written out here because `packages/domain` is the only thing this module
 * may import and a two-line sum does not earn a dependency.
 */
function spread(total: number, pieces: number): number[] {
  if (pieces <= 0) return [];
  const each = Math.floor(Math.max(0, total) / pieces);
  let left = Math.max(0, total) - each * pieces;
  return Array.from({ length: pieces }, () => {
    const extra = left > 0 ? 1 : 0;
    left -= extra;
    return each + extra;
  });
}

/**
 * What one piece of a line cost: its price less its share of the line's own
 * discount (`PurchaseOrderItem.discount`, 2026-09-20). A line is one piece
 * since 2026-09-18, so the share is the whole discount; an invoice written
 * before that spells a line as qty n and splits it.
 */
function netUnitCost(item: PoItem): number {
  const pieces = Math.max(1, item.qty);
  return Math.max(0, item.unitCost - Math.round((item.discount ?? 0) / pieces));
}

export function receivingRows(
  po: Pick<Po, "id" | "items">,
  units: readonly Unit[],
  isCounted: IsCounted = NOTHING_COUNTED,
): ReceivingRow[] {
  const mine = units.filter((u) => u.poId === po.id);
  const bySerial = new Map(mine.map((u) => [u.serial, u]));
  // A line's own serial is authoritative, whatever product the machine turned
  // out to be. Only machines no line names are handed out by product.
  const claimed = new Set<string>();
  for (const item of po.items) {
    if (item.serial && bySerial.has(item.serial)) claimed.add(item.serial);
  }

  const rows: ReceivingRow[] = [];
  for (const item of po.items) {
    if (item.skuId !== "" && isCounted(item.skuId)) continue;
    const pieces = Math.max(1, item.qty);
    for (let piece = 0; piece < pieces; piece += 1) {
      let unit: Unit | null = null;
      if (piece === 0 && item.serial) {
        // A dangling link stays dangling rather than borrowing a machine: the
        // row names a serial, and handing it somebody else's would be a lie.
        unit = bySerial.get(item.serial) ?? null;
      } else if (!item.notReceived && item.skuId !== "") {
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
        expectedSkuId: item.skuId,
        unit,
        unitCost: unit?.buy ?? netUnitCost(item),
        // A machine in hand has arrived, whatever the line was once marked.
        notArrived: item.notReceived === true && unit === null,
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
      expectedSkuId: "",
      unit,
      unitCost: unit.buy,
      notArrived: false,
      orphan: true,
    });
  }
  return rows;
}

/**
 * Turn every multi-piece line into one-piece lines, in place.
 *
 * Returns which row keys moved (old key → the id of the line that now carries
 * that piece), so a page can move whatever it was holding for those rows. A
 * one-piece line whose machine was tied to it only by product gets its serial
 * written down while this is at it, so the link is explicit from then on — and
 * the product can differ from the line's without the machine falling off it.
 *
 * Changes nothing — and assigns nothing, so a copy-on-write draft sees no
 * edit — when the invoice is already one piece per line.
 */
export function normaliseLines(
  po: Pick<Po, "id" | "items">,
  units: readonly Unit[],
  newId: () => string,
  isCounted: IsCounted = NOTHING_COUNTED,
): Record<string, string> {
  const rows = receivingRows(po, units, isCounted);
  const moved: Record<string, string> = {};
  const items: PoItem[] = [];
  let changed = false;
  for (const item of po.items) {
    const own = rows.filter((r) => r.itemId === item.id);
    const first = own[0];
    if (first === undefined) {
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
    const share = spread(item.discount ?? 0, own.length);
    own.forEach((row, n) => {
      const id = n === 0 ? item.id : newId();
      moved[row.key] = id;
      items.push({
        id,
        skuId: item.skuId,
        serial: row.unit?.serial ?? null,
        qty: 1,
        unitCost: item.unitCost,
        // The line's discount splits with its pieces, or an invoice written
        // as "qty 3 less Rp500.000" would lose the Rp500.000 the first time
        // anybody touched it.
        ...(share[n] ? { discount: share[n] } : {}),
        ...(item.notReceived ? { notReceived: true } : {}),
      });
    });
  }
  if (changed) po.items = items;
  return moved;
}

/** Where a row stands, which decides what it offers. */
export type ReceivingState =
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

const STATE_OF_STATUS: Partial<Record<UnitStatus, ReceivingState>> = {
  QC: "IN_QC",
  TERSEDIA: "IN_STOCK",
  DIRESERVASI: "RESERVED",
  SERVIS: "ON_SERVICE",
  RETUR_SUPPLIER: "RETURNED",
  TERJUAL: "SOLD",
};

export function receivingState(row: ReceivingRow): ReceivingState {
  if (row.unit !== null) return STATE_OF_STATUS[row.unit.status] ?? "GONE";
  if (row.notArrived) return "NOT_ARRIVED";
  if (row.expectedSkuId === "") return "NO_PRODUCT";
  return "WAITING";
}

/**
 * The machine arrived as something other than what the invoice names.
 *
 * Only a machine in hand can differ: before the serial, whatever product the
 * row shows is still a claim about a box nobody has opened.
 */
export function isDifferentProduct(row: ReceivingRow): boolean {
  return (
    row.unit !== null &&
    !row.orphan &&
    row.expectedSkuId !== "" &&
    row.unit.skuId !== row.expectedSkuId
  );
}

/** What the header of the receiving table says, counted once. */
export interface ReceivingSummary {
  /** Machines the invoice lists — every row a line accounts for. */
  readonly expected: number;
  /** Of those, how many have been identified. */
  readonly received: number;
  /** Still expected and not yet identified. */
  readonly waiting: number;
  /** Marked as never sent. */
  readonly notArrived: number;
  /** Received as a different product from the one invoiced. */
  readonly differentProduct: number;
  /** Machines on the invoice that no line accounts for. */
  readonly extra: number;
  /** Identified machines still in QC — orphans included. */
  readonly inQc: number;
  /** Of those, how many could be accepted now (`qcReady`). */
  readonly readyToAccept: number;
  /** Identified machines that have left QC, whichever way. */
  readonly decided: number;
}

export function receivingSummary(
  rows: readonly ReceivingRow[],
): ReceivingSummary {
  let expected = 0;
  let received = 0;
  let waiting = 0;
  let notArrived = 0;
  let differentProduct = 0;
  let extra = 0;
  let inQc = 0;
  let readyToAccept = 0;
  let decided = 0;
  for (const row of rows) {
    if (row.orphan) extra += 1;
    else {
      expected += 1;
      if (row.unit !== null) received += 1;
      else if (row.notArrived) notArrived += 1;
      else waiting += 1;
      if (isDifferentProduct(row)) differentProduct += 1;
    }
    if (row.unit === null) continue;
    if (row.unit.status === "QC") {
      inQc += 1;
      if (qcReady(row.unit)) readyToAccept += 1;
    } else {
      decided += 1;
    }
  }
  return {
    expected,
    received,
    waiting,
    notArrived,
    differentProduct,
    extra,
    inQc,
    readyToAccept,
    decided,
  };
}

/**
 * One way the delivery differs from the invoice, counted (owner ask
 * 2026-09-18: *"the discrepancies will show at the bottom (the unit changes:
 * old unit -> new unit)"*).
 */
export interface InvoiceChange {
  /** What the invoice names; null for a machine no line accounts for. */
  readonly invoiced: string | null;
  /** What turned up; null for one that never did. */
  readonly received: string | null;
  readonly count: number;
}

export interface InvoiceChanges {
  /** In the order the rows first show them. Empty when nothing differs. */
  readonly changes: readonly InvoiceChange[];
  /**
   * Keys of the rows that are part of a real difference. A row whose product
   * was changed and still is not in here was a swap — see `invoiceChanges`.
   */
  readonly flagged: ReadonlySet<string>;
}

/** What a row's machine is, as far as anybody has said. */
export type ActualOf = (row: ReceivingRow) => string;

const actualOfUnit: ActualOf = (row) => row.unit?.skuId ?? row.expectedSkuId;

/**
 * How the delivery differs from the invoice, NET of rows that merely swapped
 * products.
 *
 * > *"They might just be inputting the price wrong but the product correctly
 * > and then they might swap the unit name. That is a price correction and is
 * > not a change in unit, you should not flag it, but should still display
 * > the prev unit."* (owner, 2026-09-18)
 *
 * So the comparison is between two COUNTS per product — invoiced and
 * received — and never row by row. An M1 at Rp10jt and an M2 at Rp12jt that
 * trade names are still one M1 and one M2: nothing is flagged, and each row
 * still says what it was entered as (that is the page's job, not this
 * function's). A difference that does exist is said the way the owner put it,
 * old product → new product:
 *
 * 1. a row whose product changed, while its old product is short and its new
 *    one is over — the plain case;
 * 2. a row the supplier never sent (`received: null`);
 * 3. a machine on the invoice that no line accounts for (`invoiced: null`);
 * 4. whatever is still short and over after those — a chain of changes (M1 →
 *    M2 on one row, M2 → M3 on another) nets to M1 → M3.
 *
 * `actualOf` is what a row's machine is. The page passes its own, which knows
 * about a product somebody changed before the serial was read.
 */
export function invoiceChanges(
  rows: readonly ReceivingRow[],
  actualOf: ActualOf = actualOfUnit,
): InvoiceChanges {
  const invoiced = new Map<string, number>();
  const received = new Map<string, number>();
  const bump = (map: Map<string, number>, sku: string) =>
    map.set(sku, (map.get(sku) ?? 0) + 1);
  /** What each row counts as: its invoiced product and what turned up. */
  const read = rows.map((row) => {
    const was =
      row.orphan || row.expectedSkuId === "" ? null : row.expectedSkuId;
    const now =
      row.notArrived && row.unit === null ? null : actualOf(row) || null;
    if (was !== null) bump(invoiced, was);
    if (now !== null) bump(received, now);
    return { row, was, now };
  });

  const short = new Map<string, number>();
  const over = new Map<string, number>();
  for (const sku of new Set([...invoiced.keys(), ...received.keys()])) {
    const d = (invoiced.get(sku) ?? 0) - (received.get(sku) ?? 0);
    if (d > 0) short.set(sku, d);
    if (d < 0) over.set(sku, -d);
  }

  // A row is part of a difference when what it was entered as is short or
  // what it turned out to be is over — decided on the counts before anything
  // is paired, so a swap (both balanced) is never flagged.
  const flagged = new Set<string>();
  for (const { row, was, now } of read) {
    if (was === now) continue;
    if ((was !== null && short.has(was)) || (now !== null && over.has(now))) {
      flagged.add(row.key);
    }
  }

  const out: {
    invoiced: string | null;
    received: string | null;
    count: number;
  }[] = [];
  const add = (from: string | null, to: string | null, n = 1) => {
    const held = out.find((c) => c.invoiced === from && c.received === to);
    if (held) held.count += n;
    else out.push({ invoiced: from, received: to, count: n });
  };
  const take = (map: Map<string, number>, sku: string, n = 1) => {
    const left = (map.get(sku) ?? 0) - n;
    if (left > 0) map.set(sku, left);
    else map.delete(sku);
  };

  for (const { was, now } of read) {
    if (was === null || now === null || was === now) continue;
    if (short.has(was) && over.has(now)) {
      add(was, now);
      take(short, was);
      take(over, now);
    }
  }
  for (const { was, now } of read) {
    if (was !== null && now === null && short.has(was)) {
      add(was, null);
      take(short, was);
    }
  }
  for (const { was, now } of read) {
    if (was === null && now !== null && over.has(now)) {
      add(null, now);
      take(over, now);
    }
  }
  for (const [from, n] of [...short]) {
    let left = n;
    for (const [to, m] of [...over]) {
      if (left === 0) break;
      const k = Math.min(left, m);
      add(from, to, k);
      take(over, to, k);
      left -= k;
    }
    if (left > 0) add(from, null, left);
  }
  for (const [to, m] of over) add(null, to, m);

  return { changes: out, flagged };
}
