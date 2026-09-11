/**
 * What one machine is worth, per serial — and what it is worth on a
 * marketplace.
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
 * what the marketplace takes back out of it. Derived by default and
 * overridable always: the rule is right for most machines and wrong for the
 * ones somebody is trying to move, and a derived number nobody can override is
 * a number staff work around in the marketplace's own dashboard, where this
 * app cannot see it.
 *
 * The override is stored as a NUMBER, not as a flag plus a number. A unit
 * either carries its own marketplace price or it does not, and asking "is this
 * overridden?" is asking whether the column is null — one fact, one place. A
 * repricing of the store price therefore moves the derived price and leaves an
 * overridden one alone, which is exactly what an override is for.
 *
 * ## Ranges
 *
 * With a price per serial, "what does a MacBook Air M2 16/512 cost?" stops
 * having one answer, so Inventory expands one level: a row per variant AND
 * grade, showing a range when the machines behind it disagree. Grade is the
 * right second axis because it is the thing that MAKES them disagree — an A
 * and a C of one variant are two products as far as a customer is concerned,
 * and averaging them into one "from Rp…" tells nobody anything.
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
  /** What it is listed at on Shopee/Tokopedia, when somebody overrode the rule. */
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
  const raw = storePrice * (1 + Math.max(0, markupPct) / 100);
  return Math.ceil(raw / PRICE_ROUNDING) * PRICE_ROUNDING;
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

/** What it is listed at on a marketplace: the override, or the rule. */
export function marketPriceOf(
  unit: PricedUnit,
  skuPrice: number,
  markupPct: number = DEFAULT_MARKETPLACE_MARKUP_PCT,
): number {
  return unit.marketPrice ?? derivedMarketPrice(priceOf(unit, skuPrice), markupPct);
}

/** Is this machine's marketplace price a number somebody typed? */
export function isMarketPriceOverridden(unit: PricedUnit): boolean {
  return unit.marketPrice != null;
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
export function markupOf(storePrice: number, marketPrice: number): number | null {
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
