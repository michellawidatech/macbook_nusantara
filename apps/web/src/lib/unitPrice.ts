/**
 * What one unit is worth, per serial — and what its variant is listed at on a
 * marketplace.
 *
 * ## The owner's revision of 2026-09-19 — one marketplace price per VARIANT
 *
 * *"Marketplace price is taken from the highest price for all unit, so it will
 * not be displayed per unit."*
 *
 * A Shopee or Tokopedia listing is a listing of a variant: a customer buys "a
 * MacBook Air M2 16/512" and the shop picks the unit. One listing therefore
 * carries one price, and the owner's rule is that it is the DEAREST unit's —
 * listed at the top of the spread, a buyer can be handed any unit on the shelf
 * without the shop selling one below what the counter would ask for it.
 * `variantMarketPrice` is that rule. Each unit's own figure (below) still
 * exists, but only as a term of the maximum: nothing shows it or edits it any
 * more, and the Inventory price grid lost its marketplace column the same day.
 *
 * Only units that can be sold today count — on the shelf or held for a
 * customer (`LISTABLE_STATUSES`). A unit still in QC has not been priced, and
 * one at a repairer is not for sale; letting either set the listing would
 * list a price no unit on the shelf asks.
 *
 * A legacy override (`Unit.marketPrice`, typed per unit between 2026-09-08 and
 * 2026-09-19) is not thrown away: it still feeds the maximum, until that unit's
 * store price is next saved — see `applyPriceEdits` in
 * `routes/stock/InventoryTable.tsx`, which hands the unit back to the rule.
 *
 * ## The owner's revision of 2026-09-08
 *
 * *"Price should be set per serial (not per variant or per grade) and will be
 * determined right after QC. Each unit will have different price (store price
 * and marketplace price), and the marketplace price will automatically be
 * determined by a rule (store price + additional fee by %), but can be
 * overwritten."*
 *
 * This reverses 2026-08-27, which had itself reversed 2026-08-15, and the
 * reason the pendulum lands here is worth writing down: a second-hand Mac is
 * not fungible with the next one off the same pallet. Two 2017 Airs of the
 * same variant can differ by a dented lid, a tired battery and Rp1.500.000,
 * and a shop that quotes one price for both either gives the good one away or
 * cannot sell the bad one. `Sku.price` does not go away — it becomes the
 * ASKING price, the catalogue figure a new unit starts from and the number a
 * customer is quoted before anybody has picked a machine.
 *
 * ## Two prices, one rule
 *
 * The marketplace price is the store price plus a percentage, because that is
 * what the marketplace takes back out of it. Until 2026-09-19 it was derived
 * per unit and overridable per unit; since then the rule is applied to every
 * sellable unit of a variant and the listing takes the highest (above), so
 * there is no per-unit figure left for anybody to override.
 *
 * The old override was stored as a NUMBER, not as a flag plus a number — a
 * unit either carries its own marketplace price or it does not — and that is
 * why an existing one can go on feeding the maximum without a migration.
 *
 * ## Ranges
 *
 * With a price per serial, "what does a MacBook Air M2 16/512 cost?" stops
 * having one answer, so Inventory lists a line per variant, grade and
 * warehouse (flat since 2026-09-19), showing a range when the units behind a
 * line disagree. Grade is the axis that MAKES them disagree — an A and a C of
 * one variant are two products as far as a customer is concerned, and
 * averaging them into one "from Rp…" tells nobody anything.
 *
 * Pure: no React, no store. `test/unitPrice.test.ts` is the spec.
 */

/** A machine, as far as pricing is concerned. */
export interface PricedUnit {
  readonly serial: string;
  readonly skuId: string;
  readonly grade?: string;
  /**
   * What the shop asks for THIS machine over the counter.
   *
   * Absent on a unit that has not been priced yet — one still in QC, or one
   * taken in before the per-serial price existed — and `priceOf` falls back to
   * the variant's asking price for those. A missing price is deliberately not
   * zero: zero is a giveaway somebody chose.
   */
  readonly price?: number;
  /**
   * A marketplace price somebody typed for this unit before 2026-09-19, when
   * the listing became the variant's. Nothing sets one any more; it feeds
   * `variantMarketPrice` until the unit's store price is next saved.
   */
  readonly marketPrice?: number;
}

/**
 * The percentage the marketplace price sits above the store price.
 *
 * The owner's example is 10%, which is roughly what a marketplace takes off a
 * sale — so a machine listed 10% up nets what the counter would have taken.
 * One number for the shop rather than one per channel: Shopee, Tokopedia and
 * TikTok are within a point of each other, and a shop that has to maintain
 * three price lists maintains none.
 *
 * ⚠️ Mock-only. Lives on `AppSettings.marketplaceMarkupPct` — the `AppSetting`
 * table is key/value so this needs no migration, but the KEY does not exist
 * there yet.
 */
export const DEFAULT_MARKETPLACE_MARKUP_PCT = 10;

/** Round to the nearest thousand rupiah — nobody prices a Mac at Rp8.415.372. */
export const PRICE_ROUNDING = 1000;

/**
 * The marketplace price the rule produces for a store price.
 *
 * Rounded UP to the nearest thousand, not to the nearest: rounding down would
 * shave the fee the markup exists to cover, and the direction of a rounding
 * error should never be the direction that loses money. Rp0 in gives Rp0 out
 * rather than Rp1.000 — a free machine listed at a thousand rupiah is a
 * pricing bug that would reach a customer.
 */
export function derivedMarketPrice(
  storePrice: number,
  markupPct: number = DEFAULT_MARKETPLACE_MARKUP_PCT,
): number {
  if (!Number.isFinite(storePrice) || storePrice <= 0) return 0;
  // Multiplied by the whole percentage before dividing, and with a
  // micro-rupiah of slack under the ceiling (2026-09-19). `storePrice * 1.1`
  // is 33000000.000000004 for Rp30.000.000, and a ceiling taken on that
  // listed the unit at Rp33.001.000 — a thousand rupiah invented by the
  // floating point, on every listing whose figure lands exactly on a
  // thousand. No real price has a fraction smaller than the slack.
  const raw = (storePrice * (100 + Math.max(0, markupPct))) / 100;
  return Math.ceil(raw / PRICE_ROUNDING - 1e-9) * PRICE_ROUNDING;
}

/**
 * What the shop asks for this machine over the counter.
 *
 * Falls back to the variant's asking price, which is what every machine taken
 * in before 2026-09-08 has and what a unit still in QC has. The fallback is
 * not a default anybody chose — it is the catalogue answering for a machine
 * nobody has priced — so a screen that wants to say "not priced yet" asks
 * `unit.price === undefined` rather than comparing the two numbers.
 */
export function priceOf(unit: PricedUnit, skuPrice: number): number {
  return unit.price ?? skuPrice;
}

/**
 * One unit's term in its variant's marketplace price: a legacy override, or
 * the rule applied to its store price.
 *
 * Not a price anything is listed at since 2026-09-19 — a listing takes the
 * highest of these across the variant, see `variantMarketPrice`.
 */
export function marketPriceOf(
  unit: PricedUnit,
  skuPrice: number,
  markupPct: number = DEFAULT_MARKETPLACE_MARKUP_PCT,
): number {
  return (
    unit.marketPrice ?? derivedMarketPrice(priceOf(unit, skuPrice), markupPct)
  );
}

/** Does this unit still carry a marketplace price somebody typed before 2026-09-19? */
export function isMarketPriceOverridden(unit: PricedUnit): boolean {
  return unit.marketPrice != null;
}

/**
 * The statuses a marketplace listing can be sold from: on the shelf, or held
 * for a customer.
 *
 * The same pair `lib/inventory.ts` calls sellable, restated rather than
 * imported because this file imports nothing. A reserved unit is still in:
 * a hold is a promise to one person, and the variant is listed for everybody
 * else in the meantime.
 */
export const LISTABLE_STATUSES: readonly string[] = ["TERSEDIA", "DIRESERVASI"];

/** A unit, as far as its variant's marketplace listing is concerned. */
export interface ListedUnit extends PricedUnit {
  readonly status: string;
}

/**
 * A variant's marketplace price: the highest `marketPriceOf` among its units
 * that can be sold today (owner ask 2026-09-19).
 *
 * *"Marketplace price is taken from the highest price for all unit."* The
 * dearest unit, not the average and not the catalogue figure: the listing is
 * one price for whichever unit the shop ends up sending, so it has to cover
 * the one the counter would ask most for.
 *
 * `undefined` when nothing of the variant is sellable — a variant with no
 * unit on the shelf has nothing to list, and a number here would be a price
 * no unit asks. `skuPrice` is `Sku.price`, what a unit nobody has priced yet
 * quotes (`priceOf`).
 */
export function variantMarketPrice(
  units: readonly ListedUnit[],
  skuId: string,
  skuPrice: number,
  markupPct: number = DEFAULT_MARKETPLACE_MARKUP_PCT,
): number | undefined {
  let best: number | undefined;
  for (const u of units) {
    if (u.skuId !== skuId || !LISTABLE_STATUSES.includes(u.status)) continue;
    const p = marketPriceOf(u, skuPrice, markupPct);
    if (best === undefined || p > best) best = p;
  }
  return best;
}

/**
 * Every variant's marketplace price in one pass over the units — for a screen
 * that shows many. The same answers `variantMarketPrice` gives, keyed by SKU
 * id; a variant with nothing sellable is absent rather than zero.
 */
export function variantMarketPrices(
  units: readonly ListedUnit[],
  skuPrice: (skuId: string) => number,
  markupPct: number = DEFAULT_MARKETPLACE_MARKUP_PCT,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of units) {
    if (!LISTABLE_STATUSES.includes(u.status)) continue;
    const p = marketPriceOf(u, skuPrice(u.skuId), markupPct);
    const held = out.get(u.skuId);
    if (held === undefined || p > held) out.set(u.skuId, p);
  }
  return out;
}

/** The spread of one set of prices — what a row of Inventory shows. */
export interface PriceRange {
  readonly min: number;
  readonly max: number;
  /** True when every machine on the row asks the same money. */
  readonly single: boolean;
  /** How many machines the range is over. */
  readonly count: number;
}

/**
 * The range a list of prices spans.
 *
 * `single` rather than leaving the caller to compare min and max, because "one
 * price" and "a range that happens to be one wide" are the same thing on
 * screen and there is no reason for two call sites to decide that
 * independently. An empty list is a range of zero and `single`, which reads as
 * "nothing here" wherever a count of zero is already shown beside it.
 */
export function priceRange(prices: readonly number[]): PriceRange {
  if (prices.length === 0) {
    return { min: 0, max: 0, single: true, count: 0 };
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, single: min === max, count: prices.length };
}

/** The percentage a marketplace price sits above a store price, for display. */
export function markupOf(
  storePrice: number,
  marketPrice: number,
): number | null {
  if (storePrice <= 0) return null;
  return ((marketPrice - storePrice) / storePrice) * 100;
}

/**
 * The bounds of a price somebody can type.
 *
 * Zero is allowed and means a giveaway — a machine going out with a repair, a
 * unit written off against a claim — which is a real thing that happens and
 * which a shop wants recorded as a sale at zero rather than not recorded. The
 * ceiling is where a rupiah figure stops being a Mac and starts being a
 * slipped keyboard repeat.
 */
export const PRICE_MIN = 0;
export const PRICE_MAX = 10_000_000_000;

export function isPriceInRange(price: number | null | undefined): boolean {
  if (price == null) return true;
  return Number.isFinite(price) && price >= PRICE_MIN && price <= PRICE_MAX;
}

/**
 * The variant's asking price as a new unit's starting price — or none.
 *
 * A variant at Rp 0 has not been priced (the go-live import of 2026-09-29
 * priced none of them), and handing that zero on to a unit is the giveaway
 * nobody chose that `PricedUnit.price` warns about. Absent, the unit quotes
 * its variant through `priceOf` like any other unpriced unit, and the sell
 * price box at Inbound & QC shows the figure as a hint instead of a value it
 * cannot be emptied of (owner report 2026-10-08).
 */
export function startingPrice(
  asking: number | null | undefined,
): number | undefined {
  return asking != null && asking > 0 ? asking : undefined;
}
