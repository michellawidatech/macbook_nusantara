/**
 * The till's catalogue, and what a basket is worth.
 *
 * ## Why the till lists VARIANTS and not serials (owner revision 2026-08-27)
 *
 * The shelf panel this replaces listed every sellable serial, one row each. It
 * was honest — a serial is what gets sold — and it was the wrong thing to put
 * in front of a cashier: a customer points at a machine and says "the Air, the
 * silver one", and the till answered with forty rows of C02XY… that all looked
 * the same. Nobody scans a list of serials to find a model.
 *
 * So the catalogue is one row per variant with a count beside it — the shape
 * the owner asked for, and the shape every till in every shop has. Which
 * PARTICULAR machine goes out is a separate question, asked in a dialog once
 * the model is agreed, where a serial's grade, battery and shelf are worth
 * reading. That is the owner's answer of 2026-08-27: *always ask which one*.
 *
 * ## One row per variant AND grade (owner ask 2026-10-08)
 *
 * *"Per row is per unit with same grade and same spec, then the grade is on
 * the left next to the unit."* A row holding a New, an A and a C quoted
 * "Rp12.387.623 – Rp23.847.634", which is three shelves' worth of price in
 * one line and answers nothing a customer asked. Grade is what makes the
 * price differ, so it splits the row; the range that is left is the spread
 * WITHIN a grade — a tired battery — which is how Inventory has drawn its
 * lines since 2026-09-08.
 *
 * ## A price RANGE per row
 *
 * A variant had one asking price between 2026-08-27 and 2026-09-08, and does
 * not any more: the price is per serial again (owner revision), because two
 * machines of one variant in different condition are not worth the same money.
 * So the row carries a RANGE, and the chooser says what each particular
 * machine asks. A cashier who sees "Rp7.900.000 – Rp9.400.000" beside an A
 * knows there is a decision to make; the same row showing one number would
 * have them quote whichever machine came out of the dialog first.
 *
 * Pure: no React, no store. The page renders what this returns.
 */
import type { MockDb, Sku, Unit } from "../mock/seed.js";
import { gradeRank } from "./condition.js";
import { fmtNone } from "./format.js";
import { priceOf, priceRange, type PriceRange } from "./unitPrice.js";
import { stockLevels } from "./stock.js";

/**
 * One row of the till's catalogue: a variant in one grade, and what is left
 * of it. A counted product is one row per variant — it has no grade.
 */
export interface ShelfRow {
  /** Unique across the catalogue: the variant and the grade. */
  readonly key: string;
  readonly sku: Sku;
  /**
   * The grade every unit on the row shares; undefined for an ungraded unit
   * and for a counted product.
   */
  readonly grade: string | undefined;
  /** The category its model belongs to — "MacBook", "iPad". Drives the chips. */
  readonly category: string;
  /**
   * Sellable machines of this variant, in a stable order.
   *
   * Serial order today, not intake order — the mock `Unit` has no intake
   * date. See the sort in `shelfRows` for what this is meant to be.
   */
  readonly units: readonly Unit[];
  /** How many are left once the basket has taken its share. */
  readonly remaining: number;
  /**
   * What the machines left on this row ask (owner revision 2026-09-08).
   *
   * A RANGE, because the price is per serial again. `sku.price` is still on
   * the row — it is what the shop asks for the variant, and what an unpriced
   * machine quotes — but it is no longer what anything is sold at, so a
   * catalogue showing only that number would misquote every haggled shelf.
   */
  readonly price: PriceRange;
  /** True when a machine of this variant is on hold for somebody. */
  readonly anyReserved: boolean;
  /**
   * A counted product — an accessory (2026-09-19). It has no units: `units`
   * is empty, `remaining` is what the stock ledger holds less what the basket
   * has taken, and a tap adds one more piece instead of opening a chooser.
   */
  readonly counted: boolean;
}

/**
 * Grades ascend NEW, A, B, C; ungraded sorts last.
 *
 * `lib/condition.ts` owns the order since 2026-08-28. This used to be
 * `charCodeAt(0)`, which put `NEW` (78) behind `C` (67) and listed a sealed
 * machine as the worst thing on the shelf.
 */

/**
 * What the till can sell.
 *
 * Reserved units are included, exactly as the serial picker always included
 * them: a hold is a promise, not a removal, and the shop sells the machine it
 * promised to the person it promised it to. The row says so, and the serial
 * chooser says which one.
 */
export function sellableUnits(db: MockDb): Unit[] {
  return db.units.filter(
    (u) => u.status === "TERSEDIA" || u.status === "DIRESERVASI",
  );
}

/** Every category the sellable stock actually spans, for the filter chips. */
export function shelfCategories(rows: readonly ShelfRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) if (!seen.includes(r.category)) seen.push(r.category);
  return seen.sort((a, b) => a.localeCompare(b));
}

/**
 * The catalogue, filtered.
 *
 * `taken` is the serials already in the basket. They come off `remaining`
 * rather than out of the list: a row that vanishes as it is clicked is a row
 * that moves the next one under the cursor, and a cashier adding two of the
 * same model would click the wrong thing every time. A row with nothing left
 * stays visible, at zero, so "we had one of those" is answerable.
 *
 * The query matches the variant's name, its code, its model AND the serials
 * behind it — a scanned serial has to find its row, and staff who know a
 * machine by its serial should not have to translate.
 */
export function shelfRows(
  db: MockDb,
  opts: {
    readonly query?: string;
    readonly category?: string;
    readonly taken?: readonly string[];
    /** Pieces of counted products already in the basket, by variant. */
    readonly takenQty?: Readonly<Record<string, number>>;
  } = {},
): ShelfRow[] {
  const taken = new Set(opts.taken ?? []);
  const q = (opts.query ?? "").trim().toLowerCase();

  // By variant AND grade (owner ask 2026-10-08) — see the module docblock.
  const byRow = new Map<string, Unit[]>();
  for (const u of sellableUnits(db)) {
    const key = shelfKey(u.skuId, u.grade);
    const held = byRow.get(key);
    if (held) held.push(u);
    else byRow.set(key, [u]);
  }

  const rows: ShelfRow[] = [];
  for (const [key, units] of byRow) {
    const skuId = units[0]!.skuId;
    const grade = units[0]!.grade || undefined;
    const sku = db.skus.find((s) => s.id === skuId);
    if (!sku) continue;
    const category =
      db.models.find((m) => m.id === sku.modelId)?.category ?? fmtNone();

    if (opts.category && opts.category !== category) continue;
    if (q !== "") {
      const hay = [
        sku.name,
        sku.variantLabel,
        sku.code,
        ...units.map((u) => u.serial),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    /*
     * By serial, and that is NOT the ordering this wants.
     *
     * What it wants is oldest intake first, so that a variant down to its last
     * machine — which skips the chooser and goes straight in the basket — hands
     * over the one that has been sitting longest, and so the chooser's top row
     * is the shop's oldest stock. That is the reason for having an order here
     * at all.
     *
     * It cannot be done yet: the mock `Unit` carries no intake date, and the
     * ledger is where a machine's history lives (`lib/recommend.ts`'s
     * `intakeOf` walks `db.events` for exactly this and pays a full scan per
     * serial for it). Serial order is a stable, arbitrary stand-in — stable
     * matters, because an unstable one would move rows under a cashier's
     * finger.
     *
     * ⚠️ When `Unit` gains an intake date (or this reads the API, where
     * `UnitCard.intakeAt` already exists), sort on it and delete this note.
     */
    const ordered = [...units].sort((a, b) => a.serial.localeCompare(b.serial));
    const left = ordered.filter((u) => !taken.has(u.serial));
    rows.push({
      key,
      sku,
      grade,
      category,
      units: ordered,
      remaining: left.length,
      // Over what is LEFT, not over every machine of the variant: a row's
      // price has to be a price a customer could still be quoted, and a
      // basket that has already taken the cheap one must not go on advertising
      // it.
      price: priceRange(left.map((u) => priceOf(u, sku.price))),
      anyReserved: left.some((u) => u.status === "DIRESERVASI"),
      counted: false,
    });
  }

  // Counted products, off the stock ledger rather than off units. A variant
  // with nothing on any shelf is not listed — it was never "on the shelf".
  for (const [skuId, at] of stockLevels(db.stockMoves)) {
    const sku = db.skus.find((s) => s.id === skuId);
    if (!sku) continue;
    const category =
      db.models.find((m) => m.id === sku.modelId)?.category ?? fmtNone();
    if (opts.category && opts.category !== category) continue;
    if (q !== "") {
      const hay = [sku.name, sku.variantLabel, sku.code]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    let held = 0;
    for (const n of at.values()) held += n;
    if (held <= 0) continue;
    rows.push({
      key: shelfKey(skuId, undefined),
      sku,
      grade: undefined,
      category,
      units: [],
      remaining: Math.max(0, held - (opts.takenQty?.[skuId] ?? 0)),
      price: priceRange([sku.price]),
      anyReserved: false,
      counted: true,
    });
  }

  return rows.sort(
    (a, b) =>
      a.sku.name.localeCompare(b.sku.name) ||
      a.sku.variantLabel.localeCompare(b.sku.variantLabel) ||
      gradeRank(a.grade) - gradeRank(b.grade),
  );
}

/** A catalogue row's key: the variant, and the grade its units share. */
export function shelfKey(skuId: string, grade: string | undefined): string {
  return `${skuId}|${grade ?? ""}`;
}

/**
 * What the shop makes on a sale, as a percentage of what it charges.
 *
 * Against `costOfUnit` — what this particular machine COST: its invoice line,
 * its share of that invoice's shipping and tax, and its repairs (lib/service.ts)
 * — because that is the one figure on the sale that is per-serial. Two machines of one variant ask
 * the same money and were very often bought for different amounts, so a margin
 * computed off the variant would be a margin about no actual transaction.
 *
 * Of REVENUE, not of cost: 100 bought and 125 sold is a 20% margin here, not
 * 25%. That is the number a shop reads on a P&L, and reading one convention
 * while the accounts use the other is how a floor price gets set wrong.
 *
 * Returns null when there is nothing to be a percentage of. A basket that adds
 * up to zero has no margin — it has a mistake, and 0% would look like an
 * answer.
 */
export function marginPct(revenue: number, cost: number): number | null {
  if (revenue <= 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

/**
 * A trade-in: the customer's own machine, taken against the bill.
 *
 * Only `value` matters to the arithmetic below — everything else is what the
 * unit needs when the shop is KEEPING the machine, which it carries here so
 * that one dialog can gather it all (owner ask 2026-09-01). Mirrors
 * `TradeInRec` in the seed; see it for which fields prisma actually has.
 */
export interface TradeInLine {
  readonly id: string;
  /** What it is, in words — the label the schema's `TradeIn.label` stores. */
  readonly label: string;
  /** Its serial, when the shop is taking it into stock. Optional in the schema. */
  readonly serial?: string;
  /** What the shop is allowing for it. Comes off the bill. */
  readonly value: number;
  readonly note?: string;
  /** The catalogue variant it was recognised as, when it is one. */
  readonly skuId?: string;
  /** Sealed or second-hand — becomes `Unit.grade` via `gradeForCondition`. */
  readonly condition?: "NEW" | "SECOND";
  /** What the grading checklist concluded, where one was run. */
  readonly grade?: string;
}

/** What a basket costs the customer once everything is counted. */
export interface SaleTotals {
  /**
   * Σ LIST prices — what the shop asks, before anybody negotiated.
   *
   * Owner revision 2026-09-01. It used to be Σ of the charged prices, so a
   * haggled machine simply had a smaller subtotal and the receipt could not
   * say that anything had been given away. The subtotal is now the shop's own
   * price list and the negotiation is a line of its own — see `bargain`.
   */
  readonly subtotal: number;
  /**
   * What was knocked off at the counter, as a single line (owner ask
   * 2026-09-01).
   *
   * Deliberately NOT a discount, and the difference is the point of it
   * existing. A discount is the shop's own promotion — a code with a name, a
   * window and a limit, redeemable by anyone who qualifies. A bargain is one
   * cashier and one customer agreeing a number on one machine, and lumping the
   * two together made the discount report a fiction.
   */
  readonly bargain: number;
  /**
   * The other direction: charged ABOVE the list price (owner ask 2026-09-01).
   *
   * Rarer and real — a rush job, a bundled setup, a scarce model somebody
   * wants today — and the figure the salesperson's upsell number is made of.
   * Kept apart from `bargain` rather than netted against it, because one sale
   * carrying a machine sold Rp2jt under and another Rp2jt over is not the same
   * event as a sale where nothing was negotiated at all.
   */
  readonly upsell: number;
  readonly discount: number;
  /**
   * Σ the sale's named charges — delivery, a bag, a setup fee.
   *
   * A total of a LIST since 2026-09-01 (owner ask): one sale can carry several
   * and folding them into one number is a line nobody can account for later.
   * The breakdown lives on the order as `fees`.
   */
  readonly extra: number;
  /** Σ trade-in values — money the customer does not have to find. */
  readonly tradeCredit: number;
  /** What the customer pays in money, after the trade-in. Never negative. */
  readonly total: number;
  /**
   * The same sale as the five columns an `Order` row actually has.
   *
   * Here because the numbers above are the TILL's — `subtotal` is the list
   * price, and `total` is what the customer hands over — and the database's
   * are not the same numbers. `Order_total_arithmetic_check` (migration
   * 20260815060658) is
   *
   *     CHECK (total = subtotal - discount + extra)
   *
   * which the till's figures violate three ways at once: `bargain` and
   * `upsell` sit between the list subtotal and what is charged, and
   * `tradeCredit` is subtracted from the till's total but is its own column in
   * the schema and deliberately absent from the CHECK — it is credit against
   * what is COLLECTED, not a reduction of the bill.
   *
   * So `order.subtotal` is what the goods are CHARGED at (Σ `OrderItem.sub`,
   * which is the only subtotal the schema can hold — there is no list-price
   * column), and `order.total` is the bill before the trade-in. Written as
   * given, the CHECK holds by construction.
   *
   * ⚠️ `bargain` and `upsell` are NOT persistable today. They are derived from
   * `listPrices`, and `Order.listPrices` is mock-only — the schema has no
   * per-line list price to snapshot. A sale written now keeps the money right
   * and loses the fact that haggling happened.
   */
  readonly order: {
    /** → `Order.subtotal`. Σ what the lines are charged, not the list. */
    readonly subtotal: number;
    /** → `Order.discount`. */
    readonly discount: number;
    /** → `Order.extra`. */
    readonly extra: number;
    /** → `Order.total`. The bill, BEFORE the trade-in. Never negative. */
    readonly total: number;
    /**
     * → `Order.tradeCredit`. Not netted into `total`, by schema design.
     *
     * Uncapped on purpose. A trade-in worth more than the bill leaves the shop
     * owing the customer cash, and capping this would make that debt vanish
     * from the books instead of surfacing as the refund it is.
     */
    readonly tradeCredit: number;
  };
  /** Σ what the machines going out COST — `costOfUnit`, not `Unit.buy`. */
  readonly cogs: number;
  /** Margin on the goods, as a percentage of what they sold for. */
  readonly margin: number | null;
}

/**
 * The arithmetic of one sale, in one place.
 *
 * Order matters and is the shop's, not the arithmetic's: the discount comes off
 * the goods, the extra is a charge the shop adds on top of them, and the
 * trade-in is the customer handing over value rather than money. A trade-in
 * worth more than the bill leaves a total of zero rather than a negative —
 * the shop owing the customer cash is a refund, which is a different document.
 *
 * `margin` deliberately ignores the extra and the trade-in. Delivery is a
 * pass-through the shop does not mark up, and a traded machine is stock coming
 * IN at a cost — its margin is earned when it is sold again, not here. Folding
 * either into this figure would make the number on the till disagree with the
 * number the P&L reports for the same sale.
 *
 * The subtotal is the LIST price since 2026-09-01 (owner ask), and what was
 * negotiated off it is `bargain` — see the field. The total is still computed
 * from what is being charged, so the arithmetic on the receipt reads
 * subtotal − bargain + upsell − discount + extra − trade-in and lands on the
 * same number it always did.
 */
export function saleTotals(input: {
  /** What each line is actually being charged. */
  readonly prices: readonly number[];
  /**
   * What each line is LISTED at, index-matched to `prices`.
   *
   * Optional, and absent means "the list price is what is being charged" —
   * which keeps every caller written before 2026-09-01 producing the numbers
   * it always did, with a zero bargain and a zero upsell.
   */
  readonly listPrices?: readonly number[];
  /**
   * What each line COST the shop, index-matched to `prices` — `costOfUnit`:
   * the invoice line, its share of that invoice's shipping and tax, and its
   * repairs. Bare `Unit.buy` here flatters every margin.
   */
  readonly costs: readonly number[];
  readonly discount: number;
  /**
   * The named charges. A bare number is still accepted and means one unnamed
   * charge — every caller written before 2026-09-01 passes that.
   */
  readonly extra: number | readonly { readonly amount: number }[];
  readonly tradeIns: readonly TradeInLine[];
}): SaleTotals {
  const charged = input.prices.reduce((t, p) => t + p, 0);
  const list = input.listPrices ?? input.prices;
  const subtotal = list.reduce((t, p) => t + p, 0);

  // Per line, not on the totals. A sale with one machine Rp2jt under list and
  // another Rp2jt over is a bargain AND an upsell, and netting them to zero
  // would tell the salesperson's report that neither happened.
  let bargain = 0;
  let upsell = 0;
  input.prices.forEach((price, i) => {
    const listed = list[i] ?? price;
    if (price < listed) bargain += listed - price;
    else if (price > listed) upsell += price - listed;
  });

  // Against the CHARGED goods, not the list: a discount code that takes 10%
  // off takes it off what is being paid, and capping at the list price would
  // let a haggled basket be discounted below zero.
  const discount = Math.min(Math.max(0, input.discount), Math.max(0, charged));
  // Negative fees are refused rather than netted: a charge that reduces the
  // bill is a discount or a bargain, and both of those have their own line.
  const extra = Array.isArray(input.extra)
    ? input.extra.reduce((t, f) => t + Math.max(0, f.amount), 0)
    : Math.max(0, input.extra as number);
  const tradeCredit = input.tradeIns.reduce(
    (t, x) => t + Math.max(0, x.value),
    0,
  );
  const cogs = input.costs.reduce((t, c) => t + c, 0);

  // The bill: what the goods are charged at, less the discount, plus the
  // charges. `discount` is already capped at `charged` and `extra` cannot be
  // negative, so this is >= 0 and satisfies Order_money_nonneg_check as well.
  const billTotal = charged - discount + extra;

  return {
    subtotal,
    bargain,
    upsell,
    discount,
    extra,
    tradeCredit,
    // What is left to collect. The trade-in comes off here and not off the
    // bill — see `order.tradeCredit`.
    total: Math.max(0, billTotal - tradeCredit),
    order: {
      subtotal: charged,
      discount,
      extra,
      total: billTotal,
      tradeCredit,
    },
    cogs,
    // On what the goods actually fetch. The bargain and the upsell are already
    // inside `charged`, so this needs no term for either — which is the point
    // of computing the total from `charged` rather than from the subtotal.
    margin: marginPct(charged - discount, cogs),
  };
}

/**
 * What a recorded sale went out ABOVE its own asking price.
 *
 * Read off the order's two snapshots — what each serial was charged, and what
 * it was LISTED at when the sale was written — rather than off `Sku.price`,
 * which is what the shop asks today. A variant repriced last week would
 * otherwise turn every sale of it into an upsell or a bargain that nobody
 * made. See `Order.listPrices`.
 *
 * Per line and only upwards. A receipt carrying one machine sold Rp2jt over
 * and another Rp2jt under is an upsell of Rp2jt here, not zero: the two are
 * separate things a salesperson did, and netting them lets one haggled machine
 * erase the other. `bargainOn` is the mirror.
 *
 * Zero for an order written before the snapshot existed, which is the honest
 * answer — those tills had no way to record that anything was negotiated.
 */
/** A counted line as the two snapshots read it. */
interface PricedLine {
  readonly qty: number;
  readonly price: number;
  readonly listPrice?: number;
}

export function upsellOn(order: {
  readonly serials: readonly string[];
  readonly prices: Readonly<Record<string, number>>;
  readonly listPrices?: Readonly<Record<string, number>>;
  readonly lines?: readonly PricedLine[];
}): number {
  let total = 0;
  for (const l of order.lines ?? []) {
    if (l.listPrice !== undefined && l.price > l.listPrice) {
      total += (l.price - l.listPrice) * l.qty;
    }
  }
  if (!order.listPrices) return total;
  for (const serial of order.serials) {
    const charged = order.prices[serial];
    const listed = order.listPrices[serial];
    if (charged === undefined || listed === undefined) continue;
    if (charged > listed) total += charged - listed;
  }
  return total;
}

/** The other direction: what a recorded sale gave away off its asking price. */
export function bargainOn(order: {
  readonly serials: readonly string[];
  readonly prices: Readonly<Record<string, number>>;
  readonly listPrices?: Readonly<Record<string, number>>;
  readonly lines?: readonly PricedLine[];
}): number {
  let total = 0;
  for (const l of order.lines ?? []) {
    if (l.listPrice !== undefined && l.price < l.listPrice) {
      total += (l.listPrice - l.price) * l.qty;
    }
  }
  if (!order.listPrices) return total;
  for (const serial of order.serials) {
    const charged = order.prices[serial];
    const listed = order.listPrices[serial];
    if (charged === undefined || listed === undefined) continue;
    if (charged < listed) total += listed - charged;
  }
  return total;
}
