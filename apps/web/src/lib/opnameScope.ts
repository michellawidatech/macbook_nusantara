/**
 * What a stock take covers — and therefore what counts as missing from it
 * (owner ask 2026-08-31).
 *
 * ## Why a count needs a scope at all
 *
 * Until this revision a count named one warehouse and nothing else, so every
 * unit in that warehouse was expected and anything not scanned was reported
 * missing. That is the right answer for the once-a-month count of everything
 * and the wrong answer for every other count the shop actually does: a shelf
 * of iPads on a Tuesday afternoon, the sealed stock before a promotion, one
 * rack somebody wants to re-check. Run those against the old screen and the
 * confirmation step reports the entire rest of the warehouse as lost.
 *
 * The owner named four axes:
 *
 * | axis | example |
 * |---|---|
 * | warehouse | Gudang Utama |
 * | rack | Rak 1, Rak 2 |
 * | product category | MacBook, iPad, Mac mini |
 * | condition | New, Second |
 *
 * ## Empty means all, and that is the whole grammar
 *
 * The owner's own words: *"if the field is unpicked, assume all, e.g. Warehouse
 * 1 and not choosing which rack, so assume it's all rack in warehouse 1"*. So
 * an axis with nothing picked places no restriction, and the four axes are
 * ANDed — picking Gudang Utama and iPad means the iPads in Gudang Utama, not
 * the iPads anywhere plus everything in Gudang Utama.
 *
 * A scope with all four axes empty is the whole shop, which is exactly what a
 * count with no scope used to be. That is not an accident: it means the old
 * behaviour is a point inside the new grammar rather than a special case
 * beside it, and a count started before this revision still reads correctly.
 *
 * ## The rack axis excludes machines that have no rack
 *
 * A unit gets its `rackId` when QC accepts it onto a shelf, so a machine still
 * in QC has none. Naming racks therefore drops the QC ones, and it should: the
 * count is of what is on those shelves, and a machine nobody has shelved yet
 * is not on any of them. It is only ever an exclusion — a count that names no
 * rack still expects every unshelved machine in its warehouses.
 *
 * Pure: no React, no store. `test/opnameScope.test.ts` is the spec.
 */
import type { Unit } from "../mock/seed.js";
import { conditionOf, type UnitCondition } from "./condition.js";

/**
 * The four axes. Every one of them means "all" when empty — see the docblock.
 *
 * Arrays rather than optional single values because the owner asked for
 * multiple selection on each: a count can cover two racks, or MacBook and
 * iPad but not Accessory.
 */
export interface OpnameScope {
  /** `Warehouse.id`. */
  readonly locationIds: readonly string[];
  /** `RackLocation.id`. Excludes unshelved machines when non-empty. */
  readonly rackIds: readonly string[];
  /** `CatalogModel.category` — a name, because that is what the mock stores. */
  readonly categories: readonly string[];
  /** New or second-hand, derived from `Unit.grade` by `lib/condition.ts`. */
  readonly conditions: readonly UnitCondition[];
}

/** A scope that restricts nothing: the whole shop. */
export const WHOLE_SHOP: OpnameScope = {
  locationIds: [],
  rackIds: [],
  categories: [],
  conditions: [],
};

/**
 * Read a scope off a record that may predate any of these fields.
 *
 * The mock store is rebuilt from the seed on every reload, so this is not a
 * migration — it is what keeps the seeded count and any record written by an
 * older build readable rather than throwing on `undefined.length`.
 */
export function scopeOf(rec: Partial<OpnameScope>): OpnameScope {
  return {
    locationIds: rec.locationIds ?? [],
    rackIds: rec.rackIds ?? [],
    categories: rec.categories ?? [],
    conditions: rec.conditions ?? [],
  };
}

/** True when nothing is restricted — the count covers everything held. */
export function isWholeShop(scope: OpnameScope): boolean {
  return (
    scope.locationIds.length === 0 &&
    scope.rackIds.length === 0 &&
    scope.categories.length === 0 &&
    scope.conditions.length === 0
  );
}

/**
 * One axis, said once.
 *
 * Empty is not "match nothing", it is "ask nothing" — which is the opposite,
 * and is the bug this function exists to make impossible to write four times.
 */
function axis(picked: readonly string[], value: string | undefined): boolean {
  if (picked.length === 0) return true;
  return value !== undefined && picked.includes(value);
}

/**
 * Is this machine inside the count?
 *
 * `categoryOf` is passed in rather than looked up here so this file needs
 * neither the store nor the SKU and model tables — the caller already holds
 * both, and a category in the mock is reached through two hops (unit → sku →
 * model) that have nothing to do with what a scope means.
 */
export function inOpnameScope(
  unit: Unit,
  scope: OpnameScope,
  categoryOf: (skuId: string) => string | undefined,
): boolean {
  if (!axis(scope.locationIds, unit.locationId)) return false;
  // `rackId` is undefined for a machine still in QC. `axis` refuses it when
  // racks are named and passes it when none are — see the docblock.
  if (!axis(scope.rackIds, unit.rackId)) return false;
  if (!axis(scope.categories, categoryOf(unit.skuId))) return false;
  if (!axis(scope.conditions, conditionOf(unit.grade))) return false;
  return true;
}

/**
 * The warehouse a surplus machine found on this count belongs to.
 *
 * A count of one warehouse can answer this by itself, and almost every count
 * is of one warehouse. A count spanning two — or one scoped only by category,
 * which spans all of them — cannot, and the person holding the machine has to
 * say. Returns undefined in that case, which is what makes the field required
 * in the dialog rather than silently defaulted to whichever warehouse sorted
 * first.
 */
export function soleLocation(scope: OpnameScope): string | undefined {
  return scope.locationIds.length === 1 ? scope.locationIds[0] : undefined;
}
