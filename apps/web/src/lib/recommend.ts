/**
 * "What else can this customer be sold?" — a scored ranking over the shop's
 * own history and its own shelf.
 *
 * ## What this used to be, and why it changed (owner ask 2026-09-01)
 *
 * The owner asked whether the recommendations were hardcoded. They were not —
 * the add-on half already counted which CATEGORIES had shared a receipt — but
 * the ranking underneath was three tie-breaks in a fixed order (bundle, then
 * raw co-purchase count, then cheapest), and a fixed order of tie-breaks is
 * only one step away from a fixed list. Two candidates that differed on
 * everything except the first key were sorted by that key alone; a raw count
 * of 3 meant nothing without knowing whether that was 3 out of 4 receipts or
 * 3 out of 400; and nothing about the actual machine — what it cost the shop,
 * how long it had been sitting — could move a row at all.
 *
 * So this is now a real recommender, in the ordinary sense: candidates are
 * SCORED, the score is a weighted sum of independent signals, and the ranking
 * is whatever the scores say. Two of the signals come from association-rule
 * mining over past receipts — the standard market-basket method — and the rest
 * are the shop's own economics.
 *
 * It is deliberately not machine learning. There is no training step, no
 * stored model and nothing to retrain: every number is computed from the
 * current store on every call, which for a shop with a few hundred receipts is
 * microseconds and means a sale recorded a minute ago is already influencing
 * the next one.
 *
 * ## The signals
 *
 * | signal | where it comes from | why it earns a weight |
 * |---|---|---|
 * | confidence | P(candidate ∣ basket item), over past receipts | how often this actually followed that |
 * | lift | confidence ÷ the candidate's own base rate | whether that is a real association or just a popular item |
 * | margin | `Sku.price` vs `costOfUnit` (bought, shipping & tax, repairs) | two machines the customer would like equally are not equally worth selling |
 * | age | the unit's intake event | old stock is money on a shelf; the shop wants it gone first |
 * | fit | price step over the basket line (upgrades only) | a small step up is a conversation, a huge one is a different customer |
 * | bundle | a live `BUNDLE` discount this unit would complete | the one suggestion that makes the basket CHEAPER per item |
 *
 * Lift is the signal that stops the obvious failure of a naive count. The
 * shop's best-selling sleeve appears on many receipts, so it co-occurs with
 * everything and a count-ranked list would recommend it for every basket.
 * Dividing by its base rate asks the sharper question — does this pair up MORE
 * than chance — and a lift at or below 1 says no.
 *
 * ## Sparse history is the normal case, not the edge case
 *
 * This shop sells a handful of machines a day, and second-hand stock is
 * one-of-a-kind by nature: the exact model in the basket may never have been
 * sold before. So the history signals are computed at two levels — the
 * catalogue MODEL first, and the CATEGORY as a fallback — and where there is
 * no evidence at either, they contribute zero rather than a guess. A candidate
 * with no history can still be recommended on margin, age and fit alone, and
 * `why` says so out loud instead of inventing a receipt.
 *
 * Every candidate is a real, available serial with a real price — the same
 * grounding rule the chat agent works under. A recommendation the shop cannot
 * actually hand over is worse than none.
 */
import type { CatalogModel, MockDb, Sku, Unit } from "../mock/seed.js";
import {
  bundleProgress,
  isRedeemable,
  scopeMatches,
  type BasketLine,
} from "./pricing.js";
import { costIndex, type UnitCost } from "./service.js";

export type RecommendationKind = "UPGRADE" | "ADDON";

/** One scored input to a candidate's total. Rendered in the explain panel. */
export interface Signal {
  /** Which signal — matched to a sentence at the call site, so i18n can see it. */
  readonly key: SignalKey;
  /** Its normalised strength, 0…1. */
  readonly value: number;
  /** Its share of the final score, so a reader can see what actually decided. */
  readonly contribution: number;
  /** The raw figure behind it, for the ones where a number is worth showing. */
  readonly detail?: string;
}

export type SignalKey =
  | "confidence"
  | "lift"
  | "margin"
  | "age"
  | "fit"
  | "bundle";

/**
 * Why a row is on the list — as a tagged value, not as a sentence.
 *
 * The phrasing belongs to the call site, for the same reason `DiscountBlocker`
 * is a tagged value and `gradeText` takes its word as an argument: this module
 * has no `t()` in scope, CLAUDE.md requires every user-facing string to go
 * through one, and `test/i18n.test.ts` finds untranslated copy by reading
 * `t()` call sites — so a sentence built here is both untranslatable AND
 * invisible to the test that exists to catch it.
 *
 * Each variant carries the numbers the sentence needs and nothing else.
 */
export type WhyReason =
  /** An upgrade: this much more than the basket line it steps up from. */
  | {
      readonly kind: "STEP_UP";
      readonly step: number;
      readonly fromName: string;
      readonly fromVariant: string;
    }
  /** Model-level evidence: this share of past sales of the basket's model. */
  | { readonly kind: "MODEL_RULE"; readonly confidence: number }
  /** Category-level evidence, backed off — see `CATEGORY_BACKOFF`. */
  | {
      readonly kind: "CATEGORY_RULE";
      readonly category: string;
      readonly support: number;
    }
  /** No receipt has carried both. Said plainly rather than invented. */
  | { readonly kind: "NO_HISTORY"; readonly withProducts: string };

export interface Recommendation {
  readonly serial: string;
  readonly kind: RecommendationKind;
  readonly title: string;
  readonly variant: string;
  readonly price: number;
  readonly grade?: string;
  readonly description: string;
  /** Why this row is on the list. Phrased at the call site — see `WhyReason`. */
  readonly why: WhyReason;
  /** A live bundle this unit would complete, if any. Phrased at the call site. */
  readonly bundle?: { readonly code: string; readonly name: string };
  /** 0…1. What the ranking is actually on. */
  readonly score: number;
  /** What fed the score, strongest first. */
  readonly signals: readonly Signal[];
}

/** How many of each kind to offer. Past three, a suggestion list is a catalogue. */
const PER_KIND = 3;

/**
 * What each signal is worth.
 *
 * They sum to 1 within each kind, so a score is directly readable as "how good
 * is this, out of the best it could be". The two kinds weight differently on
 * purpose, and the difference is the whole distinction between them:
 *
 * - An **upgrade** is a substitution. Whether anyone has bought the two
 *   together is irrelevant — nobody buys two laptops — so it has no history
 *   signals at all, and `fit` (is this a plausible step up) carries most of it.
 * - An **add-on** is a second thing on the same receipt, which is precisely
 *   what past receipts are evidence about, so history carries most of it.
 *
 * `bundle` is weighted highest of any single add-on signal deliberately: it is
 * the only suggestion that makes the basket cheaper per item rather than
 * dearer, so a customer says yes to it far more often than to anything the
 * other signals can find.
 */
const WEIGHTS = {
  UPGRADE: { fit: 0.55, margin: 0.3, age: 0.15 },
  ADDON: {
    bundle: 0.34,
    confidence: 0.26,
    lift: 0.16,
    margin: 0.14,
    age: 0.1,
  },
} as const;

/**
 * Lift above this counts as "as strong as an association gets".
 *
 * With four receipts in a young shop, a pair that has co-occurred twice can
 * produce a lift in the tens — an artefact of the denominator, not a finding.
 * Capping at 3 means anything genuinely associated scores full marks and no
 * single lucky pair can outrank every other signal combined.
 */
const LIFT_CAP = 3;

/**
 * How much a CATEGORY-level rule is discounted against a model-level one.
 *
 * Back-off smoothing, the same idea an n-gram model uses: when the sharp
 * estimate has no data, fall back to the blunt one — and discount it, because
 * a coarser generalisation is genuinely weaker evidence. "People who buy this
 * exact Air also buy this exact mouse" is a finding; "people who buy MacBooks
 * also buy accessories" is close to a tautology in a shop that sells both.
 *
 * Without this, the two scored identically, and a store whose every receipt
 * carried a Mac and an accessory ranked the accessory nobody had ever paired
 * with anything level with the one that had been on three receipts — a real
 * failure the first test written against this file caught.
 */
const CATEGORY_BACKOFF = 0.6;

/** Where "old stock" starts. A machine sitting this long is the one to move. */
const STALE_DAYS = 90;

/**
 * The price step, as a fraction of the basket line, that an upgrade scores
 * best at.
 *
 * 20% up is the classic good-better-best gap: enough to be a real difference
 * in the machine, small enough that somebody who has already decided to spend
 * X will hear it. `fitScore` falls away smoothly on both sides — a 2% step is
 * not worth the conversation and a 200% one is a different customer.
 */
const IDEAL_STEP = 0.2;

interface Resolved {
  readonly unit: Unit;
  readonly name: string;
  readonly variant: string;
  readonly category: string;
  readonly price: number;
  readonly modelId: string;
  /** The catalogue model's axis names, sorted — this row's "spec grid". */
  readonly grid: string[];
}

/**
 * Every lookup this file does, indexed once.
 *
 * The scans it replaces were the whole cost of this module. `resolve` did a
 * `db.skus.find` plus a `db.models.find` per unit; `pastBaskets` did those two
 * AND a `db.units.find` per serial of every past order; `intakeOf` walked the
 * entire `db.events` array once per candidate. Against CLAUDE.md's stated 5 000
 * units that is tens of millions of comparisons, and `recommendFor` reruns on
 * every keystroke that changes the basket — a line added, a price overridden,
 * a trade-in taken.
 *
 * Built once at the top of `recommendFor` and threaded down. Same answers,
 * linear instead of quadratic.
 */
interface Index {
  readonly skus: Map<string, Sku>;
  readonly models: Map<string, CatalogModel>;
  readonly units: Map<string, Unit>;
  /** Serial → its earliest event timestamp. The intake date, per `intakeOf`. */
  readonly intake: Map<string, string>;
  /**
   * What each machine has cost the shop — `costIndex`: bought, its share of
   * its invoice's shipping and tax (2026-09-15), and its repairs. Indexed for
   * the reason everything else here is: one share needs its whole invoice.
   */
  readonly cost: (unit: Unit) => UnitCost;
}

function buildIndex(db: MockDb): Index {
  const skus = new Map(db.skus.map((s) => [s.id, s]));
  const models = new Map(db.models.map((m) => [m.id, m]));
  const units = new Map(db.units.map((u) => [u.serial, u]));
  const intake = new Map<string, string>();
  // One pass over the ledger rather than one pass per candidate. `at` is an
  // ISO string, so a lexical compare IS a chronological one.
  for (const e of db.events) {
    const held = intake.get(e.serial);
    if (held === undefined || e.at < held) intake.set(e.serial, e.at);
  }
  return { skus, models, units, intake, cost: costIndex(db) };
}

function resolve(ix: Index, unit: Unit): Resolved | null {
  const sku = ix.skus.get(unit.skuId);
  const model = sku && ix.models.get(sku.modelId);
  if (!sku || !model) return null;
  return {
    unit,
    name: sku.name,
    variant: sku.variantLabel,
    category: model.category,
    // The variant's price, since 2026-08-27. The `unit.price === null` guard
    // that used to sit in the condition above is gone with it: a SKU always
    // has a price, so a sellable unit can no longer be unquotable.
    price: sku.price,
    modelId: model.id,
    grid: model.axes.map((a) => a.name).sort(),
  };
}

/**
 * Do two units belong to the same *kind* of thing — one INSTEAD of the other?
 *
 * This is the one idea both halves of this file turn on, and it is read
 * straight out of the catalogue rather than added as a flag. Two signals, and
 * either one is enough:
 *
 * 1. **One spec grid contains the other.** Two models are substitutes when
 *    everything you configure on the smaller is also configured on the larger.
 *    A 2015 Pro is Chip x RAM x SSD and an M2 Air is RAM x SSD, so the Air's
 *    whole grid sits inside the Pro's — they are two answers to one question,
 *    and you pick one INSTEAD of the other. An iPad is Storage x Connectivity
 *    and shares neither axis with a Mac, so it is a genuine second purchase.
 * 2. **The same category.** Belt and braces for a generation whose axes have
 *    drifted so far they no longer overlap at all — two things the shop files
 *    under "MacBook Air" are alternatives whatever the spec sheet says.
 *
 * Two axes is the floor on BOTH signals, and it is what keeps the second one
 * from swallowing the accessory shelf. A catalogue entry with a single axis is
 * offering a choice, not a ladder: a black Magic Mouse is not an upgrade over
 * a white one, and a USB-C hub is not an upgrade over a sleeve just because it
 * costs more — even though "Accessory" is one category. Without the floor that
 * is exactly what the upgrade list suggested.
 *
 * Both signals arrived on 2026-09-01, and it was the scored ranking that
 * exposed the need for them: the rule used to be EXACT grid equality, which
 * let a 2015 Air (Chip x RAM x SSD) onto the ADD-ON list for an M2 Air
 * (RAM x SSD). The old cheapest-first sort had merely been hiding it behind
 * three accessories, so the bug shipped invisible.
 */
function sameKind(a: Resolved, b: Resolved): boolean {
  if (a.grid.length < 2 || b.grid.length < 2) return false;
  if (a.category === b.category) return true;
  const [small, large] =
    a.grid.length <= b.grid.length ? [a.grid, b.grid] : [b.grid, a.grid];
  return small.every((axis) => large.includes(axis));
}

/** Everything sellable today that is not already in the basket. */
function shelf(
  db: MockDb,
  ix: Index,
  inBasket: ReadonlySet<string>,
): Resolved[] {
  return db.units
    .filter((u) => u.status === "TERSEDIA" && !inBasket.has(u.serial))
    .map((u) => resolve(ix, u))
    .filter((r): r is Resolved => r !== null);
}

/**
 * Past receipts, as sets of item keys — the input every association rule is
 * computed from.
 *
 * Two projections of the same receipts, because the shop's history is thin.
 * `models` is the sharp question ("has anyone bought THIS with THAT") and goes
 * empty fast on one-of-a-kind stock; `categories` is the blunt one ("has
 * anyone bought a Mac with an accessory") and almost always has an answer.
 *
 * Deduped per receipt: one order carrying two sleeves and a Mac must vote once
 * for "Mac goes with sleeve", not twice.
 */
interface Baskets {
  readonly models: ReadonlySet<string>[];
  readonly categories: ReadonlySet<string>[];
}

function pastBaskets(db: MockDb, ix: Index): Baskets {
  const models: Set<string>[] = [];
  const categories: Set<string>[] = [];
  for (const order of db.orders) {
    const m = new Set<string>();
    const c = new Set<string>();
    for (const serial of order.serials) {
      const unit = ix.units.get(serial);
      const sku = unit && ix.skus.get(unit.skuId);
      const model = sku && ix.models.get(sku.modelId);
      if (!model) continue;
      m.add(model.id);
      c.add(model.category);
    }
    if (m.size > 0) models.push(m);
    if (c.size > 0) categories.push(c);
  }
  return { models, categories };
}

/** Confidence and lift for "basket item `from` → candidate `to`". */
interface Rule {
  /** P(to ∣ from) — of the receipts holding `from`, how many held `to`. */
  readonly confidence: number;
  /** confidence ÷ P(to). Above 1 is a real association; 1 is chance. */
  readonly lift: number;
  /** Receipts holding both. Shown, because 2-out-of-3 is not 200-out-of-300. */
  readonly support: number;
}

/**
 * Mine one rule out of a set of baskets.
 *
 * Returns null when there is no evidence either way — `from` never sold, or
 * the two never together. Null rather than zero because the two are different
 * facts and the caller says so differently: zero is "we have looked and they
 * do not go together", null is "we have not sold enough to know".
 */
function ruleFor(
  baskets: readonly ReadonlySet<string>[],
  from: string,
  to: string,
): Rule | null {
  const n = baskets.length;
  if (n === 0) return null;
  let withFrom = 0;
  let withTo = 0;
  let withBoth = 0;
  for (const b of baskets) {
    const hasFrom = b.has(from);
    const hasTo = b.has(to);
    if (hasFrom) withFrom += 1;
    if (hasTo) withTo += 1;
    if (hasFrom && hasTo) withBoth += 1;
  }
  if (withFrom === 0 || withTo === 0) return null;
  const confidence = withBoth / withFrom;
  const baseRate = withTo / n;
  return { confidence, lift: confidence / baseRate, support: withBoth };
}

/**
 * The strongest rule from anything in the basket to this candidate.
 *
 * Max rather than mean: the basket is a set of separate reasons, and one
 * strong "people who buy this Air buy this sleeve" is not weakened by a second
 * basket line nobody has ever paired with anything. Model level first, then
 * category — see `Baskets`.
 */
function bestRule(
  baskets: Baskets,
  basket: readonly Resolved[],
  candidate: Resolved,
): { rule: Rule; level: "model" | "category" } | null {
  let best: { rule: Rule; level: "model" | "category" } | null = null;
  for (const line of basket) {
    const atModel = ruleFor(baskets.models, line.modelId, candidate.modelId);
    if (atModel && (!best || atModel.confidence > best.rule.confidence)) {
      best = { rule: atModel, level: "model" };
    }
  }
  if (best) return best;
  for (const line of basket) {
    const atCategory = ruleFor(
      baskets.categories,
      line.category,
      candidate.category,
    );
    if (atCategory && (!best || atCategory.confidence > best.rule.confidence)) {
      best = { rule: atCategory, level: "category" };
    }
  }
  return best;
}

/**
 * When this machine came into stock, from its own ledger.
 *
 * `Unit` carries no intake date — the event log is where a machine's history
 * lives, which is this codebase's one rule — so the age is the first event
 * against the serial. Undefined for a unit with no events at all, which scores
 * as "not old" rather than "infinitely old": absence of a record is not
 * evidence of a year on the shelf.
 */
function intakeOf(ix: Index, serial: string): string | undefined {
  return ix.intake.get(serial);
}

/** Days on the shelf, normalised to 0…1 against `STALE_DAYS`. */
function ageScore(intake: string | undefined, now: number): number {
  if (intake === undefined) return 0;
  const days = (now - new Date(intake).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(1, days / STALE_DAYS);
}

/**
 * Margin on this machine, as a fraction of what it sells for, clamped to 0…1.
 *
 * Of revenue, matching `marginPct` in lib/pos.ts and the P&L, and against all
 * the machine cost — `costOfUnit`, so one that came in carrying a share of an
 * invoice's ongkir is worth that much less to sell (2026-09-15). A unit with
 * no recorded purchase price scores 0 rather than 1: an unknown cost is not a
 * 100% margin, and treating it as one would float every un-costed machine to
 * the top. A share of shipping on top of an unknown price is still an unknown
 * cost, which is why the test is on `buy`.
 */
function marginScore(price: number, cost: UnitCost): number {
  if (price <= 0 || cost.buy <= 0) return 0;
  return Math.max(0, Math.min(1, (price - cost.total) / price));
}

/**
 * How good a step up this is, 0…1, peaking at `IDEAL_STEP`.
 *
 * A triangular falloff rather than a curve with a name: it is monotone either
 * side of the peak, it reaches zero at 3× the ideal, and anybody reading this
 * file can predict its output. A fancier kernel would not change the ranking
 * and would need a paragraph to justify.
 */
function fitScore(step: number, from: number): number {
  if (from <= 0) return 0;
  const ratio = step / from;
  const distance = Math.abs(ratio - IDEAL_STEP) / (IDEAL_STEP * 2);
  return Math.max(0, 1 - distance);
}

/**
 * A live bundle this candidate would complete once added to the basket.
 *
 * The code and the name, not a sentence about them — see `WhyReason`.
 */
function bundleFor(
  db: MockDb,
  lines: readonly BasketLine[],
  candidate: Resolved,
): { code: string; name: string } | undefined {
  for (const d of db.discounts) {
    if (d.type !== "BUNDLE" || !isRedeemable(d)) continue;
    if (!scopeMatches(db, d.scope, candidate.unit.serial)) continue;
    const before = bundleProgress(db, d, lines);
    const after = bundleProgress(db, d, [
      ...lines,
      { serial: candidate.unit.serial, price: candidate.price },
    ]);
    if (after.complete > before.complete) {
      return { code: d.code, name: d.name };
    }
  }
  return undefined;
}

/**
 * Money and percentages for the `detail` line of a SIGNAL, which is a
 * developer-facing breakdown in the explain panel rather than shop copy.
 * `id-ID` grouping either way — the currency is rupiah in both languages, the
 * same reasoning `fmtRp` records.
 */
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Turn a weighted signal set into a score and an ordered breakdown.
 *
 * The contributions are what the explain panel shows, and they are computed
 * here rather than in the component so that what a reader is told decided the
 * ranking IS what decided it — the two cannot drift, because there is only one
 * calculation.
 */
function combine(
  weights: Readonly<Record<string, number>>,
  values: Readonly<Partial<Record<SignalKey, { value: number; detail?: string }>>>,
): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const got = values[key as SignalKey];
    const value = got?.value ?? 0;
    const contribution = value * weight;
    score += contribution;
    signals.push({
      key: key as SignalKey,
      value,
      contribution,
      ...(got?.detail ? { detail: got.detail } : {}),
    });
  }
  return {
    score,
    signals: signals.sort((a, b) => b.contribution - a.contribution),
  };
}

/**
 * Suggestions for the basket as it stands.
 *
 * Returns upgrades first, then add-ons; each list already scored, sorted and
 * trimmed, so the caller only has to render it.
 *
 * `now` is injected so a test can pin the age signal. It defaults to the
 * wall clock, which is what every caller in the app passes.
 */
export function recommendFor(
  db: MockDb,
  lines: readonly BasketLine[],
  now: number = Date.now(),
): Recommendation[] {
  const basketSerials = new Set(lines.map((l) => l.serial));
  if (basketSerials.size === 0) return [];

  // Indexed once, then threaded down — see `Index`. Everything below used to
  // rescan the whole store per candidate.
  const ix = buildIndex(db);
  const basket = [...basketSerials]
    .map((serial) => {
      const unit = ix.units.get(serial);
      return unit ? resolve(ix, unit) : null;
    })
    .filter((r): r is Resolved => r !== null);
  if (basket.length === 0) return [];

  const available = shelf(db, ix, basketSerials);
  const baskets = pastBaskets(db, ix);
  const out: Recommendation[] = [];

  // --- Upgrades: the same kind of thing, dearer -----------------------------
  // No history signals: nobody has ever bought two laptops on one receipt, so
  // co-purchase evidence is not merely thin here, it is the wrong question.
  // Scored on the step itself, then on what the shop makes and how long the
  // machine has been sitting.
  const upgrades: (Recommendation & { serial: string })[] = [];
  const seenUpgrade = new Set<string>();
  for (const line of basket) {
    for (const cand of available) {
      if (cand.category !== line.category) continue;
      // Same category is not enough — see `sameKind`. Without this an
      // "Accessory" basket happily proposed a hub as an upgrade over a sleeve.
      if (!sameKind(cand, line)) continue;
      if (cand.price <= line.price) continue;
      if (seenUpgrade.has(cand.unit.serial)) continue;
      seenUpgrade.add(cand.unit.serial);

      const step = cand.price - line.price;
      const { score, signals } = combine(WEIGHTS.UPGRADE, {
        fit: {
          value: fitScore(step, line.price),
          detail: `${rp(step)} (${pct(step / line.price)})`,
        },
        margin: {
          value: marginScore(cand.price, ix.cost(cand.unit)),
          detail: pct(marginScore(cand.price, ix.cost(cand.unit))),
        },
        age: {
          value: ageScore(intakeOf(ix, cand.unit.serial), now),
        },
      });
      upgrades.push({
        serial: cand.unit.serial,
        kind: "UPGRADE",
        title: cand.name,
        variant: cand.variant,
        price: cand.price,
        ...(cand.unit.grade ? { grade: cand.unit.grade } : {}),
        description: cand.unit.description,
        why: {
          kind: "STEP_UP",
          step,
          fromName: line.name,
          fromVariant: line.variant,
        },
        score,
        signals,
      });
    }
  }
  upgrades.sort((a, b) => b.score - a.score);
  out.push(...upgrades.slice(0, PER_KIND));

  // --- Add-ons: a second thing on the same receipt --------------------------
  /**
   * What counts as an add-on.
   *
   * NOT "a category the basket does not already have" — that was the first cut
   * and it was wrong in a way the bundle feature made obvious: once a sleeve is
   * on the sale, "Accessory" is in the basket, and the shop can no longer be
   * shown the second accessory that would complete an any-2-for-Rp1.000.000
   * bundle. Two narrower exclusions do the job properly:
   *
   *  - anything that shares a spec grid with a basket line is a SUBSTITUTE
   *    (a MacBook Pro against a MacBook Air), and belongs on the upgrade list
   *    or nowhere;
   *  - anything of the same catalogue model is a duplicate. Nobody needs a
   *    second sleeve, whatever colour it is.
   */
  const basketModels = new Set(basket.map((b) => b.modelId));
  const takenByUpgrade = new Set(out.map((r) => r.serial));
  const addonCandidates = available.filter(
    (c) =>
      !basketModels.has(c.modelId) &&
      !takenByUpgrade.has(c.unit.serial) &&
      !basket.some((line) => sameKind(c, line)),
  );

  const withProducts = [...new Set(basket.map((b) => b.name))].join(" / ");
  const addons: Recommendation[] = [];
  for (const cand of addonCandidates) {
    const note = bundleFor(db, lines, cand);
    const found = bestRule(baskets, basket, cand);
    const margin = marginScore(cand.price, ix.cost(cand.unit));
    const age = ageScore(intakeOf(ix, cand.unit.serial), now);

    // Discounted for a backed-off rule — see `CATEGORY_BACKOFF`. Applied to
    // both history signals rather than to one, because the reason to distrust
    // a category-level match is the same for the strength of the association
    // as for how often it holds.
    const backoff = found?.level === "category" ? CATEGORY_BACKOFF : 1;

    const { score, signals } = combine(WEIGHTS.ADDON, {
      bundle: { value: note ? 1 : 0 },
      confidence: {
        value: found ? found.rule.confidence * backoff : 0,
        ...(found
          ? {
              detail: `${pct(found.rule.confidence)} of ${
                found.level === "model" ? "receipts for this model" : "receipts in this category"
              } (${found.rule.support})`,
            }
          : {}),
      },
      lift: {
        // Below 1 is "less often than chance", which is evidence AGAINST and
        // must not be allowed to add to the score just because it is nonzero.
        value: found
          ? Math.max(
              0,
              Math.min(1, (found.rule.lift - 1) / (LIFT_CAP - 1)) * backoff,
            )
          : 0,
        ...(found ? { detail: `${found.rule.lift.toFixed(1)}×` } : {}),
      },
      margin: { value: margin, detail: pct(margin) },
      age: { value: age },
    });

    addons.push({
      serial: cand.unit.serial,
      kind: "ADDON",
      title: cand.name,
      variant: cand.variant,
      price: cand.price,
      ...(cand.unit.grade ? { grade: cand.unit.grade } : {}),
      description: cand.unit.description,
      // What the evidence actually is, including when there is none: "no past
      // receipt has carried both yet" is a true and useful thing to be able to
      // say to a customer, and a made-up statistic is not. Phrased at the call
      // site — see `WhyReason`.
      why: found
        ? found.level === "model"
          ? { kind: "MODEL_RULE", confidence: found.rule.confidence }
          : {
              kind: "CATEGORY_RULE",
              category: basket[0]?.category ?? "",
              support: found.rule.support,
            }
        : { kind: "NO_HISTORY", withProducts },
      ...(note ? { bundle: note } : {}),
      score,
      signals,
    });
  }
  addons.sort((a, b) => b.score - a.score);
  out.push(...addons.slice(0, PER_KIND));

  return out;
}
