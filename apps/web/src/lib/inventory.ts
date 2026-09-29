/**
 * Stock as the Inventory table lists it: one line per variant, grade and
 * warehouse (owner ask 2026-09-19).
 *
 * ## Why flat
 *
 * > *"The previous design is less intuitive for them since it is nested."*
 *
 * Until 2026-09-19 a row was a product that expanded to its grades, each of
 * which expanded to its serials — three levels, and the question staff bring
 * to the screen ("how many A-grade Air M2 16/512 are in Serpong, and what do
 * they ask?") was answered on the second level of one row and the third of
 * another. A line here IS that question: one variant, at one grade, in one
 * warehouse, with its count and its prices on the line itself. The serials
 * behind it are a click away (a popup on the page), not a level of the table.
 *
 * Grade and warehouse are the two axes because they are the two that change
 * what staff do next. Grade changes what the unit asks (an A and a C of one
 * variant are two products to a customer); warehouse changes where somebody
 * has to walk. Everything else — battery, rack, description — varies per unit
 * and belongs in the popup, where each unit has its own row.
 *
 * ## Two rules this file holds
 *
 * - **Held, not owned.** A unit counts while the shop still has it to sell or
 *   to get back: in QC, on the shelf, on hold for a customer, away at service.
 *   Sold, written off and returned-to-supplier units are gone and are not
 *   stock, however recently they moved.
 * - **The caller filters, this counts.** Filtering by battery or by category
 *   has to happen on UNITS and before the roll-up, or the quantity on a line
 *   stops matching the filter that produced it — "3 available" while a
 *   poor-battery filter is on has to mean three tired units. So this takes
 *   whatever unit list the page has already narrowed and never filters on its
 *   own.
 *
 * Pure: no React, no store. `test/inventory.test.ts` is the spec.
 */
import type { CatalogModel, Sku, Unit, UnitStatus } from "../mock/seed.js";
import { gradeRank } from "./condition.js";
import { fmtNone } from "./format.js";
import { categoryTracksSerial } from "./serialTracking.js";
import { priceOf, priceRange, type PriceRange } from "./unitPrice.js";

/** Statuses that mean the shop still has the unit. */
export const HELD_STATUSES: readonly UnitStatus[] = [
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "SERVIS",
];

/**
 * Statuses a unit can be sold from today: on the shelf, or held for a named
 * customer. What a line's value is taken over — a unit in QC or at a repairer
 * is not for sale. Its sell price also counts any held unit priced at Inbound.
 */
export const SELLABLE_STATUSES: readonly UnitStatus[] = [
  "TERSEDIA",
  "DIRESERVASI",
];

/** Is this unit on the shelf or on hold — something a customer can buy today? */
export function isSellable(unit: Pick<Unit, "status">): boolean {
  return SELLABLE_STATUSES.includes(unit.status);
}

/** The slice of the store a line is described from. `MockDb` satisfies it. */
export interface InventoryCatalogue {
  readonly skus: readonly Sku[];
  readonly models: readonly CatalogModel[];
  /**
   * The shop's warehouses, in its own order — the order the lines of one
   * variant are listed in. A location missing from it sorts last.
   */
  readonly warehouses?: readonly { readonly id: string }[];
  /**
   * For `InventoryLine.tracksSerial`. Absent, every category tracks serials —
   * `lib/serialTracking.ts`'s safe direction.
   */
  readonly categories?: readonly {
    readonly name: string;
    readonly tracksSerial: boolean;
  }[];
}

/** One line of the Inventory table: a variant, at a grade, in a warehouse. */
export interface InventoryLine {
  /** `lineKey(…)` — stable across renders, so it can be the table's row key. */
  readonly key: string;
  readonly skuId: string;
  readonly modelId: string;
  /** `Sku.code` — what a staff member types when they know what they want. */
  readonly code: string;
  /** `Sku.name` — the model as the catalogue names it. */
  readonly product: string;
  /** The variant axes as one string: "i5 / 8GB / 256GB". */
  readonly specs: string;
  readonly category: string;
  /**
   * False for a category the shop counts rather than identifies — the
   * accessories (2026-09-15). Their units have no battery and no serial
   * anybody reads, so the popup leaves both questions out.
   */
  readonly tracksSerial: boolean;
  /** `Unit.grade`; absent for units nobody has graded, and on an empty line. */
  readonly grade?: string;
  /**
   * `Unit.locationId`. Absent only on an EMPTY line — a variant with nothing
   * held, listed so "All products" can say "none" (see `includeEmpty`).
   */
  readonly locationId?: string;
  /**
   * `Sku.price` — the asking price a unit starts from (2026-09-08), not what
   * any unit on this line asks. See `store` for that.
   */
  readonly listPrice: number;
  /** Sellable right now. */
  readonly available: number;
  /** On hold for a named customer. */
  readonly reserved: number;
  /** Waiting to be graded; real stock, not yet sellable. */
  readonly qc: number;
  /** Away at a repairer. */
  readonly service: number;
  /** Everything held on this line — the four above. */
  readonly onHand: number;
  /**
   * What the units on this line were bought for — `Unit.buy`, the invoice
   * line, which Inbound calls a unit's "Unit price". Over every unit held,
   * whatever its status: what a unit cost does not depend on whether it is
   * for sale yet.
   */
  readonly buy: PriceRange;
  /**
   * What they have COST the shop: the invoice line plus its share of the
   * invoice's expenses plus every repair — `costOfUnit`, the figure every
   * margin is computed against. Until 2026-09-19 this screen showed buy +
   * repairs and left the expense share out.
   */
  readonly cost: PriceRange;
  /**
   * What the units on this line ask over the counter: every sellable unit,
   * plus any unit not yet on sale that has its own price already (set at
   * Inbound). `value` stays sellable-only.
   */
  readonly store: PriceRange;
  /** What the sellable units would fetch at their own asking prices. */
  readonly value: number;
  /** The units behind the line, available first. */
  readonly units: readonly Unit[];
  /**
   * A counted product's line (2026-09-19): its quantity is the stock
   * ledger's, `units` is empty, and what it cost is the moving average.
   */
  readonly counted?: boolean;
}

/**
 * A line's key. The empty string stands for "absent" in both slots, which no
 * grade and no location id ever is.
 */
export function lineKey(
  skuId: string,
  grade: string | undefined,
  locationId: string | undefined,
): string {
  return `${skuId}|${grade ?? ""}|${locationId ?? ""}`;
}

const STATUS_ORDER: Record<string, number> = {
  TERSEDIA: 0,
  DIRESERVASI: 1,
  QC: 2,
  SERVIS: 3,
};

/**
 * The Inventory table's lines, in catalogue order: variant as the catalogue
 * lists it, then best grade first, then the shop's own warehouse order.
 *
 * Catalogue order rather than by quantity, because a flat table sorted by
 * count scatters one variant's lines across the page — the A in Serpong at
 * the top, the B in the shop halfway down — and "what do we have of this
 * variant" becomes a search. Every column still sorts on a click.
 *
 * `costOf` is required, and is `costOfUnit`'s total (build it once with
 * `costIndex` over the store). Optional would mean a default, and the only
 * default available is `Unit.buy` — the bug this revision fixes.
 *
 * `includeEmpty` adds one empty line per variant that has nothing held in
 * `units`: "we don't have that one" is an answer, and the page's "All
 * products" switch is how staff ask for it.
 */
export function inventoryLines(
  units: readonly Unit[],
  cat: InventoryCatalogue,
  opts: {
    readonly costOf: (unit: Unit) => number;
    readonly includeEmpty?: boolean;
    /**
     * Counted products — accessories — off the stock ledger (2026-09-19):
     * `sku → location → qty`, and what one piece of a variant costs.
     */
    readonly counted?: {
      readonly levels: ReadonlyMap<string, ReadonlyMap<string, number>>;
      readonly averageCost: (skuId: string) => number;
      /** Leave a variant out — the page's category filter. */
      readonly include?: (skuId: string) => boolean;
    };
  },
): InventoryLine[] {
  const skuIndex = new Map(cat.skus.map((s, i) => [s.id, i]));
  const warehouseIndex = new Map(
    (cat.warehouses ?? []).map((w, i) => [w.id, i]),
  );

  const groups = new Map<string, Unit[]>();
  for (const u of units) {
    if (!HELD_STATUSES.includes(u.status)) continue;
    const key = lineKey(u.skuId, u.grade || undefined, u.locationId);
    const list = groups.get(key);
    if (list) list.push(u);
    else groups.set(key, [u]);
  }

  const skuById = new Map(cat.skus.map((s) => [s.id, s]));
  const modelById = new Map(cat.models.map((m) => [m.id, m]));
  const describe = (skuId: string) => {
    const sku = skuById.get(skuId);
    const model = sku && modelById.get(sku.modelId);
    return {
      skuId,
      modelId: sku?.modelId ?? "",
      code: sku?.code ?? "",
      product: sku?.name ?? skuId,
      specs: sku?.variantLabel ?? "",
      category: model?.category ?? fmtNone(),
      tracksSerial: cat.categories
        ? categoryTracksSerial({ categories: cat.categories }, model?.category)
        : true,
      listPrice: sku?.price ?? 0,
    };
  };

  const lines: InventoryLine[] = [];
  for (const [key, held] of groups) {
    const first = held[0]!;
    const base = describe(first.skuId);
    const mine = held
      .slice()
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          a.serial.localeCompare(b.serial),
      );
    const count = (s: UnitStatus) => mine.filter((u) => u.status === s).length;
    const sellable = mine.filter(isSellable);
    // A unit still in QC or at a repairer is not for sale, but one that was
    // PRICED at Inbound already says what it will ask (owner report
    // 2026-09-28: a sell price set in the Inbound popup read Rp 0 here). Only
    // its own price counts — one that has none has not been priced yet.
    const asking = mine.filter((u) => isSellable(u) || u.price != null);
    lines.push({
      key,
      ...base,
      ...(first.grade ? { grade: first.grade } : {}),
      locationId: first.locationId,
      available: count("TERSEDIA"),
      reserved: count("DIRESERVASI"),
      qc: count("QC"),
      service: count("SERVIS"),
      onHand: mine.length,
      buy: priceRange(mine.map((u) => u.buy)),
      cost: priceRange(mine.map((u) => opts.costOf(u))),
      store: priceRange(asking.map((u) => priceOf(u, base.listPrice))),
      // A SUM over the units, not a count times the catalogue price (owner
      // revision 2026-09-08): each one asks its own money.
      value: sellable.reduce((t, u) => t + priceOf(u, base.listPrice), 0),
      units: mine,
    });
  }

  for (const [skuId, at] of opts.counted?.levels ?? []) {
    if (opts.counted?.include && !opts.counted.include(skuId)) continue;
    const base = describe(skuId);
    const each = opts.counted!.averageCost(skuId);
    for (const [locationId, qty] of at) {
      if (qty <= 0) continue;
      lines.push({
        key: lineKey(skuId, undefined, locationId),
        ...base,
        locationId,
        available: qty,
        reserved: 0,
        qc: 0,
        service: 0,
        onHand: qty,
        buy: priceRange([each]),
        cost: priceRange([each]),
        store: priceRange([base.listPrice]),
        value: base.listPrice * qty,
        units: [],
        counted: true,
      });
    }
  }

  if (opts.includeEmpty) {
    const stocked = new Set(lines.map((l) => l.skuId));
    for (const sku of cat.skus) {
      if (stocked.has(sku.id)) continue;
      lines.push({
        key: lineKey(sku.id, undefined, undefined),
        ...describe(sku.id),
        available: 0,
        reserved: 0,
        qc: 0,
        service: 0,
        onHand: 0,
        buy: priceRange([]),
        cost: priceRange([]),
        store: priceRange([]),
        value: 0,
        units: [],
      });
    }
  }

  const place = (id: string | undefined) =>
    id === undefined
      ? Number.MAX_SAFE_INTEGER
      : (warehouseIndex.get(id) ?? Number.MAX_SAFE_INTEGER - 1);
  return lines.sort(
    (a, b) =>
      (skuIndex.get(a.skuId) ?? Number.MAX_SAFE_INTEGER) -
        (skuIndex.get(b.skuId) ?? Number.MAX_SAFE_INTEGER) ||
      gradeRank(a.grade) - gradeRank(b.grade) ||
      place(a.locationId) - place(b.locationId) ||
      (a.locationId ?? "").localeCompare(b.locationId ?? ""),
  );
}
