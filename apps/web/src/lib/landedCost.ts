/**
 * An invoice's shipping and tax, spread over the machines it bought.
 *
 * ## The owner's ask (2026-09-15)
 *
 * > *"Shipping fee and tax fee should be divided across all units evenly for
 * > the COGS and margin calculation."*
 *
 * A purchase invoice charges its ongkir and its tax on the whole order, not on
 * a line (`Po.shippingFee`, `Po.taxFee`), and until now neither reached a
 * machine: `costOfUnit` was `Unit.buy` plus repairs, so every margin in the app
 * was computed as though somebody else had paid the forwarder and the tax
 * office. Rp300.000 of ongkir on a ten-machine invoice is Rp30.000 of cost on
 * each of the ten.
 *
 * Evenly, not in proportion to price: the owner said so, and a courier charges
 * by the box — a Rp4jt Air and a Rp20jt Pro in one parcel cost the forwarder
 * the same.
 *
 * ## A share belongs to a ROW of the invoice, not to a serial
 *
 * Inbound & QC is one table with a row per machine, and each row shows what its
 * machine costs — price plus share — before anybody has turned the machine over
 * to read the serial (owner, the same day: a line of qty 3 "assuming the price
 * is the same is wrong", so every new machine is its own line). The split is
 * therefore defined on the invoice's rows, and a serial only decides which row
 * a unit stands in. Entering one later changes nobody's share.
 *
 * - **Rows**: every piece of every line that arrived, line by line (`qty` 3 is
 *   pieces 0, 1 and 2). A line that never turned up is out, for the reason
 *   `poTotals` leaves it out of what is owed. A quantity-tracked accessory line
 *   no unit will ever carry still counts: its boxes shared the parcel.
 * - **Which position a unit takes**, in this order:
 *   1. the row whose line carries the unit's serial;
 *   2. otherwise the next unclaimed piece of a line of the unit's product that
 *      carries no serial — line order, units in intake order;
 *   3. otherwise a position after the last row, in intake order.
 * - **The divisor** is every position: the rows, plus one for each unit in (3).
 *   That is the number of units on the invoice when there are more of them than
 *   rows, and the rows otherwise — except when a machine arrives whose product
 *   has no free row while rows of another product are still waiting. That
 *   machine gets a position of its own rather than somebody else's row, and
 *   the rows share with it; any other reading would quote a row one share and
 *   a unit another out of the same rupiah.
 * - **Whole rupiah**: `allocateFees` from `packages/domain` over equal weights —
 *   the floor of charges ÷ positions each, the leftover rupiah to the first
 *   positions — so the shares add back up to the charges exactly.
 *
 * Intake order is a unit's first `DITERIMA`, then its serial. Until every row
 * has its machine, the units add up to less than the charges: that money is on
 * the invoice and not yet on a machine, and it lands with the unit.
 *
 * ## What is not spread
 *
 * The invoice's discount. The owner named two charges, and a discount is not a
 * charge on the delivery: it was negotiated off the GOODS, which is where
 * `poTotals` puts it — a supplier knocking a million off does not reduce the
 * forwarder's bill. Netted in here, it would make a "shipping & tax" line
 * smaller than what the forwarder and the tax office were actually paid.
 * Whether a discount should lower the machines' cost is its own owner decision.
 *
 * A machine with no invoice — a trade-in, a stock-take find — has no shipping
 * or tax behind it and carries nothing.
 *
 * ⚠️ Browser-side only. The store's units adapter writes `Unit.landed` as
 * `Unit.buy`, and `OrderItem.cogs` / `Order.cogs` are written from `buy` too,
 * so PostgreSQL's cost columns do not carry this share yet.
 *
 * Pure: no React, no store. `test/landedCost.test.ts` is the spec.
 */
import { allocateFees } from "@nusantara/domain";
import type { Po, PoItem, Unit, UnitEvent } from "../mock/seed.js";

/** What an invoice has to say for its charges to be spread. A `Po` is one. */
export type InvoiceForCharges = Pick<Po, "id" | "shippingFee" | "taxFee"> & {
  readonly items: readonly Pick<
    PoItem,
    "id" | "skuId" | "serial" | "qty" | "notReceived"
  >[];
};

/** A unit, as far as its place on an invoice is concerned. */
export type UnitOnInvoice = Pick<Unit, "serial" | "skuId" | "poId">;

/** The slices of the store a share is read from. `MockDb` satisfies it. */
export interface LandedCostSources {
  readonly pos: readonly InvoiceForCharges[];
  readonly units: readonly UnitOnInvoice[];
  readonly events: readonly Pick<UnitEvent, "serial" | "type" | "at">[];
}

/** One piece of one line — a position the charges are spread over. */
export interface InvoiceRow {
  /** `rowKey(itemId, piece)`. */
  readonly key: string;
  readonly itemId: string;
  /** 0 … qty − 1 within its line; a one-machine line is always piece 0. */
  readonly piece: number;
  readonly skuId: string;
  /** The line's serial once its machine is identified, else null. */
  readonly serial: string | null;
}

/** The key a row's share is filed under: `${itemId}#${piece}`. */
export function rowKey(itemId: string, piece: number): string {
  return `${itemId}#${piece}`;
}

/**
 * What an invoice spreads over its machines: shipping plus tax.
 *
 * A negative charge counts as nothing rather than being netted, as a repair
 * fee's does — money coming back from a forwarder is a credit, and its own
 * document.
 */
export function invoiceCharges(po: Pick<Po, "shippingFee" | "taxFee">): number {
  return wholeRupiah(po.shippingFee) + wholeRupiah(po.taxFee);
}

/** The invoice's rows: every piece of every line that arrived, in line order. */
export function invoiceRows(
  po: Pick<InvoiceForCharges, "items">,
): InvoiceRow[] {
  const rows: InvoiceRow[] = [];
  for (const item of po.items) {
    if (item.notReceived) continue;
    for (let piece = 0; piece < item.qty; piece += 1) {
      rows.push({
        key: rowKey(item.id, piece),
        itemId: item.id,
        piece,
        skuId: item.skuId,
        serial: item.serial || null,
      });
    }
  }
  return rows;
}

/**
 * Every row's share, keyed `rowKey(itemId, piece)`, in row order — what the
 * Inbound table shows beside a machine before its serial is known.
 *
 * `units` may be the whole store's; the ones naming this invoice are picked
 * out. They only move a row's share when they need positions of their own
 * (rule 3), which spreads the charges thinner for everybody. No ledger is
 * needed: intake order decides WHICH unit takes a position, never how many
 * positions there are.
 */
export function poRowShares(
  po: InvoiceForCharges,
  units: readonly UnitOnInvoice[] = [],
): Map<string, number> {
  return place(po, onThisInvoice(po, units), NO_INTAKE).byRow;
}

/** How many positions an invoice's charges are spread over. */
export function machinesOnInvoice(
  po: InvoiceForCharges,
  units: readonly UnitOnInvoice[] = [],
): number {
  return place(po, onThisInvoice(po, units), NO_INTAKE).positions;
}

/**
 * Every unit's share, in one pass over the store — for a screen that asks
 * about many. Units with nothing to carry are absent rather than zero.
 */
export function shippingTaxShares(
  store: LandedCostSources,
): Map<string, number> {
  const byInvoice = new Map<string, UnitOnInvoice[]>();
  for (const u of store.units) {
    if (!u.poId) continue;
    const held = byInvoice.get(u.poId);
    if (held) held.push(u);
    else byInvoice.set(u.poId, [u]);
  }
  const out = new Map<string, number>();
  if (byInvoice.size === 0) return out;
  const received = intakeOf(store.events);
  for (const po of store.pos) {
    const members = byInvoice.get(po.id);
    if (members === undefined || invoiceCharges(po) === 0) continue;
    for (const [serial, share] of place(po, members, received).bySerial) {
      out.set(serial, share);
    }
  }
  return out;
}

/**
 * One unit's share, reading only its own invoice. The same answer
 * `shippingTaxShares` gives: the invoice's units are the ones the STORE holds
 * under its `poId`, so a unit the store does not hold carries nothing.
 */
export function shippingTaxShareOf(
  unit: Pick<Unit, "serial" | "poId">,
  store: LandedCostSources,
): number {
  if (!unit.poId) return 0;
  const po = store.pos.find((p) => p.id === unit.poId);
  if (po === undefined || invoiceCharges(po) === 0) return 0;
  const members = onThisInvoice(po, store.units);
  const received = intakeOf(
    store.events,
    new Set(members.map((u) => u.serial)),
  );
  return place(po, members, received).bySerial.get(unit.serial) ?? 0;
}

interface Placement {
  /** The rows plus the positions after them that units took — the divisor. */
  readonly positions: number;
  readonly byRow: Map<string, number>;
  readonly bySerial: Map<string, number>;
}

const NO_INTAKE: ReadonlyMap<string, string> = new Map();

/**
 * Stand an invoice's units in its rows, then split the charges over the
 * positions.
 *
 * The one implementation behind every export, so a row and the unit standing
 * in it can never be quoted two different shares.
 */
function place(
  po: InvoiceForCharges,
  members: readonly UnitOnInvoice[],
  received: ReadonlyMap<string, string>,
): Placement {
  const rows = invoiceRows(po);
  const rowOfSerial = new Map<string, number>();
  /** Positions of serial-less rows, per product, in line order. */
  const free = new Map<string, number[]>();
  rows.forEach((row, p) => {
    if (row.serial === null) {
      const list = free.get(row.skuId);
      if (list) list.push(p);
      else free.set(row.skuId, [p]);
    } else if (!rowOfSerial.has(row.serial)) {
      rowOfSerial.set(row.serial, p);
    }
  });

  const seat = new Map<string, number>();
  const taken = new Set<number>();
  const waiting: UnitOnInvoice[] = [];
  const inIntakeOrder = [...members].sort((a, b) =>
    byIntake(a.serial, b.serial, received),
  );
  // 1. The row that names the unit, whenever the unit arrived.
  for (const u of inIntakeOrder) {
    const p = rowOfSerial.get(u.serial);
    if (p !== undefined && !taken.has(p)) {
      taken.add(p);
      seat.set(u.serial, p);
    } else {
      waiting.push(u);
    }
  }
  // 2. Its product's next free piece; 3. else a position after the last row.
  let positions = rows.length;
  for (const u of waiting) {
    seat.set(u.serial, free.get(u.skuId)?.shift() ?? positions++);
  }

  const charges = invoiceCharges(po);
  // `allocateFees` refuses an empty list, which is an invoice with no rows and
  // no units — nothing to spread over, so nothing is spread.
  const shares =
    positions === 0
      ? []
      : allocateFees(
          new Array<bigint>(positions).fill(1n),
          BigInt(charges),
        ).map(Number);
  return {
    positions,
    byRow: new Map(rows.map((row, p) => [row.key, shares[p] ?? 0])),
    bySerial: new Map([...seat].map(([serial, p]) => [serial, shares[p] ?? 0])),
  };
}

function onThisInvoice(
  po: Pick<InvoiceForCharges, "id">,
  units: readonly UnitOnInvoice[],
): UnitOnInvoice[] {
  return units.filter((u) => u.poId === po.id);
}

/**
 * Earliest received first, then by serial; a unit with no `DITERIMA` last.
 *
 * Serials compare by code unit rather than `localeCompare`: this order decides
 * which machine carries a leftover rupiah, and that must not depend on the
 * browser's locale.
 */
function byIntake(
  a: string,
  b: string,
  received: ReadonlyMap<string, string>,
): number {
  const ra = received.get(a);
  const rb = received.get(b);
  if (ra !== rb) {
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra < rb ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Serial → its first `DITERIMA`, in one pass over the ledger.
 *
 * `at` is an ISO string, so a lexical compare IS a chronological one — the
 * same reading `lib/recommend.ts` makes of it.
 */
function intakeOf(
  events: LandedCostSources["events"],
  only?: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "DITERIMA") continue;
    if (only !== undefined && !only.has(e.serial)) continue;
    const held = out.get(e.serial);
    if (held === undefined || e.at < held) out.set(e.serial, e.at);
  }
  return out;
}

/** Never negative, never a fraction: `BigInt` throws on one, and a render must not. */
function wholeRupiah(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
