/**
 * A sale recorded on the wrong serial, found by a stock take (owner ask
 * 2026-11-19).
 *
 * > *"The one that is actually sold is FVFFP4P3Q6L7 (wrong input as
 * > FVFFP4LZQ6L7), so when SO, one is not in warehouse and 1 is missing."*
 *
 * ## The two halves of one slip at the till
 *
 * The till sold unit A on the receipt while unit B went out of the door. A is
 * still on the shelf, so the count scans it and the system says it is SOLD
 * (*scanned, not expected here*); B is gone, and the system still files it
 * on the shelf (*expected here, not scanned*). Neither half is a typo of a
 * serial — both units are real — so `lib/opnameMatch.ts`'s rename does not
 * apply. What is wrong is which unit the sale names.
 *
 * ## The swap
 *
 * Exactly what Transaction History's *Edit transaction* does when its serial
 * is changed (owner decision 2026-09-23): A's rows from that sale come off
 * its history (`takeUnitOffSale`), so A is back where it was picked from, and
 * B gets a `TERJUAL` under the sale's code. The sale keeps what it charged —
 * the price moves with the line, so no bargain or upsell is invented. B's row
 * says it was swapped, and at which count, because unlike a correction made
 * on the receipt this one was found on a shelf.
 *
 * Pure but for the draft it is handed. `test/saleSwap.test.ts` is the spec.
 */
import type { MockDb, Order } from "../mock/seed.js";
import { appendEvent } from "../mock/store.js";
import { saleRowsOf, takeUnitOffSale } from "./saleDeletion.js";

export type SaleSwapBlock =
  /** The scanned unit is not sold — nothing to swap off. */
  | "NOT_SOLD"
  /** No sale carries it (a B2Soft sale, a buy-back's history). */
  | "NO_SALE"
  /** Its sale has been followed by another document — a return, a resale. */
  | "MOVED_ON"
  /** The missing unit is not on the shelf: held, in QC, in service, sold. */
  | "NOT_ON_SHELF";

/** The newest sale that carries `serial`, if any. */
export function saleOfSerial(
  db: Pick<MockDb, "orders">,
  serial: string,
): Order | undefined {
  let best: Order | undefined;
  for (const o of db.orders) {
    if (!o.serials.includes(serial)) continue;
    if (best === undefined || o.ts > best.ts) best = o;
  }
  return best;
}

/** Why `sold` cannot be swapped off its sale for `missing`, if it cannot. */
export function saleSwapBlock(
  db: Pick<MockDb, "orders" | "units" | "events">,
  sold: string,
  missing: string,
): SaleSwapBlock | undefined {
  const a = db.units.find((u) => u.serial === sold);
  if (a === undefined || a.status !== "TERJUAL") return "NOT_SOLD";
  const order = saleOfSerial(db, sold);
  if (order === undefined) return "NO_SALE";
  if (saleRowsOf(db.events, sold, order.code) === null) return "MOVED_ON";
  const b = db.units.find((u) => u.serial === missing);
  if (b === undefined || b.status !== "TERSEDIA") return "NOT_ON_SHELF";
  if (order.serials.includes(missing)) return "NOT_ON_SHELF";
  return undefined;
}

/**
 * Inside a `mutate`: the sale that carries `sold` carries `missing` instead.
 * Returns the sale's code, or undefined (and changes nothing) when
 * `saleSwapBlock` refuses — the draft may have moved since the dialog drew.
 */
export function swapSaleUnit(
  draft: MockDb,
  sold: string,
  missing: string,
  note: string,
): string | undefined {
  if (saleSwapBlock(draft, sold, missing) !== undefined) return undefined;
  const o = saleOfSerial(draft, sold)!;
  if (!takeUnitOffSale(draft, sold, o.code)) return undefined;
  o.serials = o.serials.map((s) => (s === sold ? missing : s));
  const price = o.prices[sold];
  delete o.prices[sold];
  if (price !== undefined) o.prices[missing] = price;
  if (o.listPrices) {
    const list = o.listPrices[sold];
    delete o.listPrices[sold];
    if (list !== undefined) o.listPrices[missing] = list;
  }
  appendEvent(draft, missing, {
    type: "TERJUAL",
    toStatus: "TERJUAL",
    refCode: o.code,
    note,
  });
  return o.code;
}
