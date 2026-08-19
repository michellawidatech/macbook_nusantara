/**
 * What a discount is worth against a particular basket.
 *
 * Pulled out of Stock Out into its own module for two reasons: the bundle rule
 * is the first discount in this app whose answer depends on *which* units are
 * in the basket rather than only on the total, and a rule that subtle should be
 * readable and testable on its own rather than buried in a form's render.
 *
 * Money is whole rupiah numbers throughout, as everywhere else in the mock
 * layer (the API boundary is what serializes BigInt as strings).
 */
import type { Discount, MockDb } from "../mock/seed.js";

/** One basket line, already resolved to the price that will actually be charged. */
export interface BasketLine {
  readonly serial: string;
  readonly price: number;
}

/** The catalogue model behind a serial, via its unit and SKU. */
export function modelOfSerial(db: MockDb, serial: string) {
  const unit = db.units.find((u) => u.serial === serial);
  const sku = unit && db.skus.find((s) => s.id === unit.skuId);
  return sku && db.models.find((m) => m.id === sku.modelId);
}

/**
 * Does this serial fall inside a discount's scope?
 *
 * `scope` is stored as the literal string the Add Discount form offered, which
 * is one of three things: "All products", a model name, or a category name.
 * The form labels the last one "Category: Accessory" but stores the bare
 * "Accessory", so both a model name and a category name have to be tried here.
 */
export function scopeMatches(
  db: MockDb,
  scope: string,
  serial: string,
): boolean {
  if (!scope || scope === "All products") return true;
  const model = modelOfSerial(db, serial);
  if (!model) return false;
  return model.name === scope || model.category === scope;
}

/** How a bundle lands against the current basket — the numbers the UI narrates. */
export interface BundleProgress {
  /** Lines inside the discount's scope. */
  readonly qualifying: number;
  /** Units per bundle. */
  readonly perBundle: number;
  /** Complete bundles the basket can form right now. */
  readonly complete: number;
  /** How many more qualifying units the NEXT bundle needs. 0 when none is part-formed. */
  readonly shortBy: number;
  /** What those complete bundles take off. */
  readonly saving: number;
}

/**
 * Work out the bundles in a basket.
 *
 * The interesting decision is which units go into a bundle when the basket has
 * more than a whole number of them. They are taken MOST EXPENSIVE FIRST, so
 * three accessories at 1.450k / 950k / 385k bundle the first two and leave the
 * cheapest at full price. That is the reading a customer will argue for and the
 * one every shop actually honours — grouping the cheapest pair instead would
 * quietly hand them the smallest possible saving out of the same promotion.
 */
export function bundleProgress(
  db: MockDb,
  d: Discount,
  lines: readonly BasketLine[],
): BundleProgress {
  const perBundle = Math.max(2, d.bundleQty ?? 2);
  const price = d.bundlePriceRp ?? 0;
  const qualifying = lines
    .filter((l) => scopeMatches(db, d.scope, l.serial))
    .map((l) => l.price)
    .sort((a, b) => b - a);

  const complete = Math.floor(qualifying.length / perBundle);
  const remainder = qualifying.length % perBundle;
  let saving = 0;
  for (let i = 0; i < complete; i += 1) {
    const chunk = qualifying.slice(i * perBundle, (i + 1) * perBundle);
    // Floored at zero: a bundle price above what the units cost anyway is a
    // pricing mistake, not a surcharge to add to the customer's bill.
    saving += Math.max(0, chunk.reduce((t, n) => t + n, 0) - price);
  }
  return {
    qualifying: qualifying.length,
    perBundle,
    complete,
    shortBy: remainder > 0 ? perBundle - remainder : 0,
    saving,
  };
}

/** What one discount takes off this basket. Never more than the basket costs. */
export function discountAmount(
  db: MockDb,
  d: Discount | undefined,
  lines: readonly BasketLine[],
): number {
  if (!d) return 0;
  const subtotal = lines.reduce((t, l) => t + l.price, 0);
  if (d.type === "PCT") {
    const raw = Math.round((subtotal * (d.pct ?? 0)) / 100);
    return Math.min(d.maxRp ? Math.min(raw, d.maxRp) : raw, subtotal);
  }
  if (d.type === "NOMINAL") return Math.min(d.amountRp ?? 0, subtotal);
  return Math.min(bundleProgress(db, d, lines).saving, subtotal);
}

/** One line of prose for a discount, used in tables, selects and the drawer. */
export function describeDiscount(d: Discount): string {
  if (d.type === "PCT")
    return `${d.pct}%${d.maxRp ? ` up to Rp ${d.maxRp.toLocaleString("id-ID")}` : ""}`;
  if (d.type === "NOMINAL")
    return `Rp ${(d.amountRp ?? 0).toLocaleString("id-ID")}`;
  return `Any ${d.bundleQty ?? 2} for Rp ${(d.bundlePriceRp ?? 0).toLocaleString("id-ID")}`;
}

/** Is a discount live today — switched on, inside its window, uses left? */
export function isRedeemable(
  d: Discount,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (!d.active) return false;
  if (d.fromDate && d.fromDate > today) return false;
  if (d.toDate && d.toDate < today) return false;
  if (d.usageLimit !== undefined && d.used >= d.usageLimit) return false;
  return true;
}

/**
 * Bundles this basket already qualifies for but is not using.
 *
 * A promotion nobody applies is a promotion that did not run. The shop knows
 * the codes; the person at the till on a Saturday does not, so Stock Out says
 * so rather than waiting to be asked.
 */
export function unusedBundles(
  db: MockDb,
  lines: readonly BasketLine[],
  appliedId: string | undefined,
): { discount: Discount; progress: BundleProgress }[] {
  return db.discounts
    .filter((d) => d.type === "BUNDLE" && d.id !== appliedId && isRedeemable(d))
    .map((discount) => ({
      discount,
      progress: bundleProgress(db, discount, lines),
    }))
    .filter((x) => x.progress.complete > 0 && x.progress.saving > 0);
}
