/**
 * Which machines are identified one by one, and which are merely counted.
 *
 * > *"Accessories do not have serial number, and in stock opname, they will
 * > only be counted and validated by qty, not serial."* (owner ask 2026-09-15)
 *
 * ## What this does NOT change
 *
 * A `Unit` row per item, and a serial on it. The serial is the subject of this
 * database — it is what a `UnitEvent` names, what an `OrderItem` sold and what
 * `Unit.buy` is the cost of — and a sleeve that has been bought, shelved and
 * sold has all of those facts about it just as a MacBook does. Taking the row
 * away would mean a second kind of stock that every screen has to learn.
 *
 * What changes is who the serial is FOR. On a tracked category it is a
 * number a person reads off the machine, types, scans and searches by. On a
 * counted one nobody ever sees it: Inbound & QC stops asking, a stock take
 * asks for a number instead, and the app mints one (`countedSerial`) so the
 * ledger still has something to name.
 *
 * ## Per category, and from the database
 *
 * `Category.tracksSerial`, added on 2026-09-15 with migration
 * `20260915140000_category_tracks_serial`. Deliberately NOT the category
 * being NAMED "Accessory": `wh-4` taught this codebase that reading a shop's
 * own data as a constant is how the next shop's data stops working, and a shop
 * that starts counting cables has to be able to say so without a deploy.
 *
 * A category the store has never heard of tracks serials. That is the safe
 * direction: the cost of being wrong is one box asking for a serial somebody
 * can leave empty, where the other way round is a MacBook entering stock with
 * no serial and no way to tell it from the one beside it.
 *
 * Pure: no React, no store. Structural parameters, so `test/serialTracking.
 * test.ts` can ask it without a `MockDb`.
 */

/** The slice of the catalogue this needs. `MockDb` satisfies it. */
export interface TrackingCatalogue {
  readonly categories: readonly {
    readonly name: string;
    readonly tracksSerial: boolean;
  }[];
  readonly models: readonly {
    readonly id: string;
    readonly category: string;
  }[];
  readonly skus: readonly { readonly id: string; readonly modelId: string }[];
}

/** Is this category's stock identified one by one? An unknown name is. */
export function categoryTracksSerial(
  cat: Pick<TrackingCatalogue, "categories">,
  name: string | undefined,
): boolean {
  if (name === undefined) return true;
  const wanted = name.trim().toLowerCase();
  const row = cat.categories.find(
    (c) => c.name.trim().toLowerCase() === wanted,
  );
  return row === undefined ? true : row.tracksSerial;
}

/** …and for one variant, resolved through its model. */
export function skuTracksSerial(
  cat: TrackingCatalogue,
  skuId: string | undefined,
): boolean {
  if (!skuId) return true;
  const sku = cat.skus.find((s) => s.id === skuId);
  const model = sku && cat.models.find((m) => m.id === sku.modelId);
  return categoryTracksSerial(cat, model?.category);
}

/** The categories the shop counts, by name — for a hint that lists them. */
export function countedCategories(
  cat: Pick<TrackingCatalogue, "categories">,
): string[] {
  return cat.categories.filter((c) => !c.tracksSerial).map((c) => c.name);
}

/**
 * The prefix on a serial the app minted rather than read off a machine.
 *
 * Visible on purpose. A counted item's serial is an internal handle, and
 * anybody who does meet one — on a timeline, in a search — should be able to
 * tell at a glance that it is not a number printed on anything.
 */
export const COUNTED_SERIAL_PREFIX = "QTY-";

/** Is this a serial the app minted for a counted item? */
export function isCountedSerial(serial: string): boolean {
  return serial.startsWith(COUNTED_SERIAL_PREFIX);
}

/**
 * Mint a handle for one counted item.
 *
 * `skuId` and a per-call `n` rather than a random string, so the same intake
 * run produces the same handles twice — which is what lets a commit be
 * retried after a refused one without minting a second set.
 */
export function countedSerial(skuId: string, n: number): string {
  return `${COUNTED_SERIAL_PREFIX}${skuId.toUpperCase()}-${n}`;
}
