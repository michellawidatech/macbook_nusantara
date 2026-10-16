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

/**
 * One PIECE in the basket, already resolved to the price that will actually
 * be charged: a unit by its serial, or one of a counted product's pieces by
 * its variant (2026-09-19 — three mice are three lines here, because a bundle
 * counts pieces).
 */
export interface BasketLine {
  readonly serial?: string;
  readonly skuId?: string;
  readonly price: number;
}

/** What a basket line, or a bare serial, names. */
export type LineRef = string | Pick<BasketLine, "serial" | "skuId">;

/** The variant behind a line: its unit's, or the one it names. */
export function skuIdOfLine(db: MockDb, ref: LineRef): string | undefined {
  const line = typeof ref === "string" ? { serial: ref } : ref;
  if (line.skuId) return line.skuId;
  if (!line.serial) return undefined;
  return db.units.find((u) => u.serial === line.serial)?.skuId;
}

/** The catalogue model behind a serial or a line, via its SKU. */
export function modelOfSerial(db: MockDb, ref: LineRef) {
  const skuId = skuIdOfLine(db, ref);
  const sku = skuId && db.skus.find((s) => s.id === skuId);
  return sku ? db.models.find((m) => m.id === sku.modelId) : undefined;
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
  line: LineRef,
): boolean {
  if (!scope || scope === "All products") return true;
  const model = modelOfSerial(db, line);
  if (!model) return false;
  return model.name === scope || model.category === scope;
}

/** The three things a discount can apply to (owner ask 2026-10-08). */
export type DiscountScopeKind = "ALL" | "CATEGORY" | "PRODUCT";

/**
 * Which of the three a stored `scope` names.
 *
 * Read the way the database reads it (`scopeOf` in packages/db's reference
 * adapter): empty or "All products" is everything, then a category name,
 * and anything else a product — a model. A category is tried first because
 * that is the order Postgres resolves the same string in, so the form and
 * the database cannot disagree about what a saved discount covers.
 */
export function scopeKindOf(
  db: Pick<MockDb, "categories" | "models">,
  scope: string | undefined,
): DiscountScopeKind {
  const clean = (scope ?? "").trim();
  if (clean === "" || clean === "All products") return "ALL";
  const isCategory =
    db.categories.some((c) => c.name === clean) ||
    db.models.some((m) => m.category === clean);
  return isCategory ? "CATEGORY" : "PRODUCT";
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
    .filter((l) => scopeMatches(db, d.scope, l))
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

/**
 * What one discount takes off this basket. Never more than the basket costs.
 *
 * ⚠️ Scope binds on every shape of discount, and did not until 2026-08-26.
 * `BUNDLE` has always honoured it — that is what `bundleProgress` counts — but
 * `PCT` and `NOMINAL` were applied to the whole subtotal whatever they were
 * scoped to, so "AIRHEMAT — Rp300k off MacBook Air" took Rp300.000 off a
 * basket of three mice. It was invisible while the till only ever showed the
 * codes and never said what they applied to; showing eligibility (see
 * `fitDiscount`) made it a promise the arithmetic had to keep, because a
 * screen that says "eligible: Rp300.000 off" beside a MacBook Air discount
 * and a basket with no MacBook Air in it is a till argument the shop loses.
 *
 * A percentage is therefore taken on the qualifying lines and a nominal amount
 * is capped by them — never more than the in-scope goods are worth, which is
 * the same rule the basket-wide cap already expressed one level up.
 */
export function discountAmount(
  db: MockDb,
  d: Discount | undefined,
  lines: readonly BasketLine[],
): number {
  if (!d) return 0;
  const qualifying = lines.filter((l) => scopeMatches(db, d.scope, l));
  const inScope = qualifying.reduce((t, l) => t + l.price, 0);
  if (d.type === "PCT") {
    const raw = Math.round((inScope * (d.pct ?? 0)) / 100);
    return Math.min(d.maxRp ? Math.min(raw, d.maxRp) : raw, inScope);
  }
  if (d.type === "NOMINAL") return Math.min(d.amountRp ?? 0, inScope);
  return Math.min(bundleProgress(db, d, lines).saving, inScope);
}

/**
 * Why a discount cannot be used on this basket right now.
 *
 * Returned as a tagged value rather than as a sentence so the till can render
 * it in the operator's own language — this module has no `t()` in scope, and a
 * lib that hands back English is a lib that ships English into an Indonesian
 * screen. Each one names the fix, because "not eligible" on its own is the
 * thing staff ring the owner about.
 */
export type DiscountBlocker =
  /** Switched off in the Discounts screen. */
  | { readonly kind: "INACTIVE" }
  | { readonly kind: "NOT_STARTED"; readonly date: string }
  | { readonly kind: "ENDED"; readonly date: string }
  | { readonly kind: "USED_UP"; readonly limit: number }
  | { readonly kind: "EMPTY_BASKET" }
  /** Nothing on the sale falls inside the discount's scope. */
  | { readonly kind: "OUT_OF_SCOPE"; readonly scope: string }
  /** A bundle that is part-formed: N more qualifying units would complete it. */
  | {
      readonly kind: "BUNDLE_SHORT";
      readonly need: number;
      readonly scope: string;
    }
  /** It applies, but the arithmetic comes to nothing. */
  | { readonly kind: "NO_SAVING" };

/** How one discount lands against the basket in front of the operator. */
export interface DiscountFit {
  readonly discount: Discount;
  /** Empty when the code can be applied. */
  readonly blockers: readonly DiscountBlocker[];
  readonly eligible: boolean;
  /** What it would take off, as the basket stands. Zero when blocked. */
  readonly saving: number;
  /** Bundles only — the numbers the UI narrates. */
  readonly bundle?: BundleProgress;
}

/**
 * Score one discount against a basket.
 *
 * Every blocker is collected rather than the first one returned, because they
 * are genuinely different jobs: a code that is both switched off AND out of
 * date needs two things doing to it, and reporting one at a time turns that
 * into two trips to the Discounts screen.
 */
export function fitDiscount(
  db: MockDb,
  d: Discount,
  lines: readonly BasketLine[],
  today = new Date().toISOString().slice(0, 10),
): DiscountFit {
  const blockers: DiscountBlocker[] = [...redemptionBlockers(d, today)];

  const priced = lines.filter((l) => l.serial || l.skuId);
  const qualifying = priced.filter((l) => scopeMatches(db, d.scope, l));
  const bundle =
    d.type === "BUNDLE" ? bundleProgress(db, d, priced) : undefined;

  if (priced.length === 0) {
    blockers.push({ kind: "EMPTY_BASKET" });
  } else if (qualifying.length === 0) {
    blockers.push({ kind: "OUT_OF_SCOPE", scope: d.scope || "All products" });
  } else if (bundle && bundle.complete === 0) {
    blockers.push({
      kind: "BUNDLE_SHORT",
      need: bundle.shortBy || bundle.perBundle,
      scope: d.scope || "All products",
    });
  }

  const saving = discountAmount(db, d, priced);
  // Checked last and only if nothing else is wrong: "this saves nothing" is
  // useless advice next to "this expired in June".
  if (blockers.length === 0 && saving <= 0)
    blockers.push({ kind: "NO_SAVING" });

  return {
    discount: d,
    blockers,
    eligible: blockers.length === 0,
    saving: blockers.length === 0 ? saving : 0,
    bundle,
  };
}

/**
 * Every discount the shop has, scored against this basket — eligible ones
 * first, then the near-misses, then the rest.
 *
 * ALL of them, not just the redeemable ones (owner decision 2026-08-26). The
 * till used to offer a select of codes that could be used today and say
 * nothing about the others, which meant the answer to "why can't I use
 * MERDEKA10?" was a shrug and a phone call. A promotion the customer has seen
 * advertised and the operator cannot find on screen is worse than one that is
 * visibly out of date.
 *
 * The near-miss ordering is the useful part: a bundle one unit short of paying
 * out belongs directly under the codes that already work, because it is the
 * one row on the list that is an instruction rather than an explanation.
 */
export function fitAllDiscounts(
  db: MockDb,
  lines: readonly BasketLine[],
  today = new Date().toISOString().slice(0, 10),
): DiscountFit[] {
  const rank = (f: DiscountFit) => {
    if (f.eligible) return 0;
    // Fixable here and now, at the till, by adding a unit to the sale.
    const fixableHere = f.blockers.every(
      (b) =>
        b.kind === "BUNDLE_SHORT" ||
        b.kind === "OUT_OF_SCOPE" ||
        b.kind === "EMPTY_BASKET" ||
        b.kind === "NO_SAVING",
    );
    return fixableHere ? 1 : 2;
  };
  return db.discounts
    .map((d) => fitDiscount(db, d, lines, today))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.saving - a.saving ||
        a.discount.code.localeCompare(b.discount.code),
    );
}

/**
 * What a discount offers, as a tagged value rather than a sentence.
 *
 * Same reasoning as `DiscountBlocker` directly above, and it applies here for
 * exactly the same reason: this module has no `t()` in scope, CLAUDE.md
 * requires every user-facing string to go through one, and
 * `test/i18n.test.ts` finds missing Indonesian by reading `t()` call sites —
 * so English built here is untranslatable AND invisible to the check.
 *
 * Rendered by the Discounts table, the discount drawer and the till's picker;
 * `describeDiscountText` in `lib/discountText.ts` is the one phrasing all
 * three share.
 */
export type DiscountShape =
  | { readonly kind: "PCT"; readonly pct: number; readonly maxRp?: number }
  | { readonly kind: "NOMINAL"; readonly amountRp: number }
  | {
      readonly kind: "BUNDLE";
      readonly qty: number;
      readonly priceRp: number;
    };

/** What a discount offers, for a caller to put into words. */
export function describeDiscount(d: Discount): DiscountShape {
  if (d.type === "PCT")
    return {
      kind: "PCT",
      pct: d.pct ?? 0,
      ...(d.maxRp ? { maxRp: d.maxRp } : {}),
    };
  if (d.type === "NOMINAL")
    return { kind: "NOMINAL", amountRp: d.amountRp ?? 0 };
  return {
    kind: "BUNDLE",
    qty: d.bundleQty ?? 2,
    priceRp: d.bundlePriceRp ?? 0,
  };
}

/**
 * What stops a discount being redeemable AT ALL, before any basket is looked
 * at — switched off, outside its window, out of uses.
 *
 * One definition, two readers. `fitDiscount` spreads these in front of the
 * basket-dependent blockers it adds; `isRedeemable` asks whether the list is
 * empty. They used to encode the same four rules separately, which meant a
 * fifth condition — a channel restriction, a minimum basket — had to be
 * remembered twice: edit only `fitDiscount` and `unusedBundles` goes on
 * advertising a code the till will refuse; edit only `isRedeemable` and the
 * picker stops explaining why.
 */
export function redemptionBlockers(
  d: Discount,
  today = new Date().toISOString().slice(0, 10),
): DiscountBlocker[] {
  const blockers: DiscountBlocker[] = [];
  if (!d.active) blockers.push({ kind: "INACTIVE" });
  if (d.fromDate && d.fromDate > today)
    blockers.push({ kind: "NOT_STARTED", date: d.fromDate });
  if (d.toDate && d.toDate < today)
    blockers.push({ kind: "ENDED", date: d.toDate });
  if (d.usageLimit !== undefined && d.used >= d.usageLimit)
    blockers.push({ kind: "USED_UP", limit: d.usageLimit });
  return blockers;
}

/** Is a discount live today — switched on, inside its window, uses left? */
export function isRedeemable(
  d: Discount,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return redemptionBlockers(d, today).length === 0;
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
