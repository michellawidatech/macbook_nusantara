/**
 * Which machines are identified one by one, and which are merely counted.
 *
 * > *"Accessories do not have serial number, and in stock opname, they will
 * > only be counted and validated by qty, not serial."* (owner ask 2026-09-15)
 *
 * ## A counted product has no units at all (owner decision 2026-09-19)
 *
 * Until 2026-09-19 a counted item was still a `Unit` with a minted `QTY-…`
 * serial nobody read. The owner took that out — *"purely by qty … in the
 * database too"* — so a counted category's stock is a quantity on the
 * `StockMove` ledger (`lib/stock.ts`) and nothing else. This module only
 * answers WHICH categories those are; `lib/stock.ts` is how they are held.
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
