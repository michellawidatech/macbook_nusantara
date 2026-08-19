/**
 * "What else can this customer be sold?" — rule-based, read straight from the
 * shop's own data. No model, no scoring service, nothing to train.
 *
 * Two questions, deliberately kept apart because they are answered differently
 * and a person at the till acts on them differently:
 *
 *  - **Upgrade** — same category, more machine, more money. Answered from the
 *    catalogue: what is on the shelf right now that is a step up from what is
 *    already in the basket. This is the question worth asking BEFORE the sale
 *    is agreed, because it changes the line rather than adding one.
 *  - **Add-on** — a different category, bought alongside this one before.
 *    Answered from history: past orders that carried both, so the shop is
 *    recommending what it has actually sold together rather than what somebody
 *    guessed goes together. Where there is no history yet it falls back to the
 *    complementary categories on the shelf and says so, which is honest and
 *    still useful on day one.
 *
 * Every candidate is a real, available serial with a real price — the same
 * grounding rule the chat agent works under. A recommendation the shop cannot
 * actually hand over is worse than none.
 */
import type { MockDb, Unit } from "../mock/seed.js";
import {
  bundleProgress,
  isRedeemable,
  scopeMatches,
  type BasketLine,
} from "./pricing.js";

export type RecommendationKind = "UPGRADE" | "ADDON";

export interface Recommendation {
  readonly serial: string;
  readonly kind: RecommendationKind;
  readonly title: string;
  readonly variant: string;
  readonly price: number;
  readonly grade?: string;
  readonly description: string;
  /** Why this row is on the list, in words a person can repeat to a customer. */
  readonly why: string;
  /** A live bundle this unit would complete, if any. */
  readonly bundleNote?: string;
}

/** How many of each kind to offer. Past three, a suggestion list is a catalogue. */
const PER_KIND = 3;

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

function resolve(db: MockDb, unit: Unit): Resolved | null {
  const sku = db.skus.find((s) => s.id === unit.skuId);
  const model = sku && db.models.find((m) => m.id === sku.modelId);
  if (!sku || !model || unit.price === null) return null;
  return {
    unit,
    name: sku.name,
    variant: sku.variantLabel,
    category: model.category,
    price: unit.price,
    modelId: model.id,
    grid: model.axes.map((a) => a.name).sort(),
  };
}

/**
 * Do two units belong to the same *kind* of thing?
 *
 * This is the one idea both halves of this file turn on, and it is read
 * straight out of the catalogue rather than added as a flag: two models are
 * the same kind of thing when they are configured along the same axes. A
 * MacBook Air and a MacBook Pro are both RAM x SSD, so they are substitutes —
 * you pick one INSTEAD of the other. A sleeve is a Colour and a keyboard is a
 * Layout, so they are neither substitutes for each other nor for a Mac.
 *
 * Two axes is the floor. A catalogue entry with a single axis is offering a
 * choice, not a ladder: a black Magic Mouse is not an upgrade over a white one,
 * and a USB-C hub is not an upgrade over a sleeve just because it costs more.
 * Without this floor that is exactly what the upgrade list suggested.
 */
function sameKind(a: Resolved, b: Resolved): boolean {
  if (a.grid.length < 2 || a.grid.length !== b.grid.length) return false;
  return a.grid.every((axis, i) => axis === b.grid[i]);
}

/** Everything sellable today that is not already in the basket. */
function shelf(db: MockDb, inBasket: ReadonlySet<string>): Resolved[] {
  return db.units
    .filter(
      (u) =>
        u.status === "TERSEDIA" && u.price !== null && !inBasket.has(u.serial),
    )
    .map((u) => resolve(db, u))
    .filter((r): r is Resolved => r !== null);
}

/**
 * Categories that have shared a receipt, counted from past orders.
 *
 * Counted per ORDER rather than per pair of lines, so one receipt carrying two
 * sleeves and a Mac does not vote twice for "Mac goes with sleeve".
 */
function coPurchase(db: MockDb): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const categoryOf = (serial: string) => {
    const unit = db.units.find((u) => u.serial === serial);
    const sku = unit && db.skus.find((s) => s.id === unit.skuId);
    return sku && db.models.find((m) => m.id === sku.modelId)?.category;
  };
  for (const order of db.orders) {
    const cats = [
      ...new Set(
        order.serials.map(categoryOf).filter((c): c is string => Boolean(c)),
      ),
    ];
    for (const a of cats) {
      for (const b of cats) {
        if (a === b) continue;
        const row = counts.get(a) ?? new Map<string, number>();
        row.set(b, (row.get(b) ?? 0) + 1);
        counts.set(a, row);
      }
    }
  }
  return counts;
}

/** A live bundle this candidate would complete once added to the basket. */
function bundleNoteFor(
  db: MockDb,
  lines: readonly BasketLine[],
  candidate: Resolved,
): string | undefined {
  for (const d of db.discounts) {
    if (d.type !== "BUNDLE" || !isRedeemable(d)) continue;
    if (!scopeMatches(db, d.scope, candidate.unit.serial)) continue;
    const before = bundleProgress(db, d, lines);
    const after = bundleProgress(db, d, [
      ...lines,
      { serial: candidate.unit.serial, price: candidate.price },
    ]);
    if (after.complete > before.complete) {
      return `Adding this completes ${d.code} — ${d.name}.`;
    }
  }
  return undefined;
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Suggestions for the basket as it stands.
 *
 * Returns upgrades first, then add-ons; each list already trimmed and sorted so
 * the caller only has to render it.
 */
export function recommendFor(
  db: MockDb,
  lines: readonly BasketLine[],
): Recommendation[] {
  const basketSerials = new Set(lines.map((l) => l.serial));
  if (basketSerials.size === 0) return [];

  const basket = [...basketSerials]
    .map((serial) => {
      const unit = db.units.find((u) => u.serial === serial);
      return unit ? resolve(db, unit) : null;
    })
    .filter((r): r is Resolved => r !== null);
  if (basket.length === 0) return [];

  const available = shelf(db, basketSerials);
  const basketCategories = new Set(basket.map((b) => b.category));
  const out: Recommendation[] = [];

  // --- Upgrades: same category, dearer than what is in the basket ----------
  // Scored by how small the step up is: the machine Rp2jt above what someone
  // already chose is a conversation, the one Rp12jt above it is a different
  // customer.
  const upgrades: { cand: Resolved; from: Resolved; step: number }[] = [];
  for (const line of basket) {
    for (const cand of available) {
      if (cand.category !== line.category) continue;
      // Same category is not enough — see `sameKind`. Without this an
      // "Accessory" basket happily proposed a hub as an upgrade over a sleeve.
      if (!sameKind(cand, line)) continue;
      if (cand.price <= line.price) continue;
      upgrades.push({ cand, from: line, step: cand.price - line.price });
    }
  }
  upgrades.sort((a, b) => a.step - b.step);
  const usedSerials = new Set<string>();
  for (const u of upgrades) {
    if (out.filter((r) => r.kind === "UPGRADE").length >= PER_KIND) break;
    if (usedSerials.has(u.cand.unit.serial)) continue;
    usedSerials.add(u.cand.unit.serial);
    out.push({
      serial: u.cand.unit.serial,
      kind: "UPGRADE",
      title: u.cand.name,
      variant: u.cand.variant,
      price: u.cand.price,
      grade: u.cand.unit.grade,
      description: u.cand.unit.description,
      why: `${rp(u.step)} more than the ${u.from.name} ${u.from.variant} on this sale.`,
    });
  }

  // --- Add-ons: another category, evidenced by past receipts ---------------
  const co = coPurchase(db);
  const affinity = new Map<string, number>();
  for (const cat of basketCategories) {
    for (const [other, n] of co.get(cat) ?? []) {
      if (basketCategories.has(other)) continue;
      affinity.set(other, (affinity.get(other) ?? 0) + n);
    }
  }

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
  const addonCandidates = available.filter(
    (c) =>
      !basketModels.has(c.modelId) && !basket.some((line) => sameKind(c, line)),
  );

  const notes = new Map<string, string>();
  for (const c of addonCandidates) {
    const note = bundleNoteFor(db, lines, c);
    if (note) notes.set(c.unit.serial, note);
  }

  addonCandidates.sort((a, b) => {
    // A unit that completes a live bundle outranks everything: it is the one
    // suggestion that makes the basket cheaper per item rather than dearer.
    const byBundle =
      Number(notes.has(b.unit.serial)) - Number(notes.has(a.unit.serial));
    if (byBundle !== 0) return byBundle;
    const byAffinity =
      (affinity.get(b.category) ?? 0) - (affinity.get(a.category) ?? 0);
    // Cheapest first otherwise: an add-on is an impulse, and the cheapest one
    // is the one that gets said yes to.
    return byAffinity !== 0 ? byAffinity : a.price - b.price;
  });

  const withCategories = [...basketCategories].join(" / ");
  // The fallback names the actual products rather than the category, because
  // "goes alongside the Accessory" is not a sentence anybody would say.
  const withProducts = [...new Set(basket.map((b) => b.name))].join(" / ");
  for (const cand of addonCandidates) {
    if (out.filter((r) => r.kind === "ADDON").length >= PER_KIND) break;
    if (usedSerials.has(cand.unit.serial)) continue;
    usedSerials.add(cand.unit.serial);
    const n = affinity.get(cand.category) ?? 0;
    const note = notes.get(cand.unit.serial);
    out.push({
      serial: cand.unit.serial,
      kind: "ADDON",
      title: cand.name,
      variant: cand.variant,
      price: cand.price,
      grade: cand.unit.grade,
      description: cand.unit.description,
      why:
        n > 0
          ? `Bought together with ${withCategories} on ${n} past sale${n === 1 ? "" : "s"}.`
          : `Goes alongside the ${withProducts} on this sale — no past receipt has carried both yet.`,
      ...(note ? { bundleNote: note } : {}),
    });
  }

  return out;
}
