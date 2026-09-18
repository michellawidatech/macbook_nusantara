/**
 * Stock rolled up BY PRODUCT — the other way of asking what the shop holds.
 *
 * Every existing stock screen is per serial, because the serial is the subject
 * of this database and a second-hand Mac is not interchangeable with the next
 * one. But "do you have a MacBook Air M2 16/512?" is a question about a SKU,
 * not about a serial, and answering it by counting rows in a 5 000-line table
 * is not answering it. That question is asked dozens of times a day by the
 * chatbot and by whoever is standing at the counter, so it gets its own shape
 * of the same data.
 *
 * Two rules this file holds:
 *
 * - **Held, not owned.** A unit counts towards inventory while the shop still
 *   has it to sell or to get back: in QC, on the shelf, on hold for a customer,
 *   away at service. Sold, written off and returned-to-supplier units are gone
 *   and are not stock, however recently they moved.
 * - **The caller filters, this counts.** Filtering by warehouse or by battery
 *   health has to happen on UNITS and before the roll-up, or the quantity in
 *   the row stops matching the filter that produced it — "3 in stock" while a
 *   poor-battery filter is on has to mean three tired units, not a product that
 *   happens to own one. So this takes whatever unit list the page has already
 *   narrowed and never filters on its own.
 */
import type { CatalogModel, Sku, Unit, UnitStatus } from "../mock/seed.js";
import {
  DEFAULT_BATTERY_SETTINGS,
  batteryEra,
  readBattery,
  type BatteryEra,
  type BatterySettings,
} from "./battery.js";
import { gradeRank } from "./condition.js";
import {
  marketPriceOf,
  priceOf,
  priceRange,
  type PriceRange,
} from "./unitPrice.js";

/** Statuses that mean the shop still has the unit. */
export const HELD_STATUSES: readonly UnitStatus[] = [
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "SERVIS",
];

export interface InventoryRow {
  skuId: string;
  modelId: string;
  /** `Sku.code` — what a staff member types when they know exactly what they want. */
  code: string;
  product: string;
  /** The variant axes as one string: "16GB / 512GB". */
  specs: string;
  category: string;
  releaseYear?: number;
  /**
   * `Sku.price` — what the catalogue asks for the variant.
   *
   * The starting point of a machine's own price since 2026-09-08, not the
   * price anything is sold at. See `store` for what the machines on this row
   * are actually asking.
   */
  listPrice: number;
  /** What the sellable machines on this row ask over the counter. */
  store: PriceRange;
  /** What they are listed at on a marketplace — the rule, or an override. */
  market: PriceRange;
  /** Sellable right now. */
  available: number;
  /** On hold for a named customer. */
  reserved: number;
  /** Waiting to be graded; real stock, not yet sellable. */
  qc: number;
  /** Away at a repairer. */
  service: number;
  /** Everything the shop is holding — the four above. */
  onHand: number;
  /** What the sellable units on this row would fetch at the asking price. */
  value: number;
  /**
   * Range of battery readings among the units behind this row, in whichever
   * units this row's era reports.
   *
   * A row is one variant, so it is one model, so it is one era — which is what
   * makes a range meaningful at all. A range over a mixed shelf would put a
   * cycle count and a percentage at opposite ends of one dash.
   */
  batteryMin?: number;
  batteryMax?: number;
  /** Which reading `batteryMin`/`batteryMax` are in. See `batteryEra`. */
  batteryEra: BatteryEra;
  /** Which warehouses hold it, by location id, most-stocked first. */
  locationIds: string[];
  /** The serials behind the row, available first. */
  units: Unit[];
}

const STATUS_ORDER: Record<string, number> = {
  TERSEDIA: 0,
  DIRESERVASI: 1,
  QC: 2,
  SERVIS: 3,
};

/**
 * One row per SKU in the catalogue, whether or not any of it is in stock.
 *
 * Zero-quantity rows are kept deliberately: "we don't have that one" is an
 * answer, and a lookup that silently omits the product cannot give it. The
 * page decides whether to show them.
 */
export function rollUpInventory(
  units: readonly Unit[],
  skus: readonly Sku[],
  models: readonly CatalogModel[],
  opts: {
    readonly markupPct?: number;
    readonly battery?: BatterySettings;
  } = {},
): InventoryRow[] {
  const held = new Map<string, Unit[]>();
  for (const u of units) {
    if (!HELD_STATUSES.includes(u.status)) continue;
    const list = held.get(u.skuId);
    if (list) list.push(u);
    else held.set(u.skuId, [u]);
  }

  return skus.map((sku) => {
    const model = models.find((m) => m.id === sku.modelId);
    const mine = (held.get(sku.id) ?? [])
      .slice()
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          a.serial.localeCompare(b.serial),
      );
    const count = (s: UnitStatus) => mine.filter((u) => u.status === s).length;
    const available = count("TERSEDIA");
    const reserved = count("DIRESERVASI");
    const sellable = mine.filter((u) =>
      ["TERSEDIA", "DIRESERVASI"].includes(u.status),
    );
    const era = batteryEra(model?.releaseYear);
    // `undefined`, not 0 — see battery.ts: an unmeasured battery and a dead
    // one are different facts and Math.min would merge them. Read through
    // `readBattery` so the numbers in the range are the ones the era reports:
    // a stray percentage on a 2017 body must not end up at one end of a
    // cycle-count dash.
    const battery = mine
      .map((u) => {
        const r = readBattery(u, model?.releaseYear, opts.battery ?? DEFAULT_BATTERY_SETTINGS);
        return r.mode === "CYCLES" ? r.cycleCount : r.health;
      })
      .filter((c): c is number => c != null && Number.isFinite(c));
    const byLocation = new Map<string, number>();
    for (const u of mine)
      byLocation.set(u.locationId, (byLocation.get(u.locationId) ?? 0) + 1);

    return {
      skuId: sku.id,
      modelId: sku.modelId,
      code: sku.code,
      product: sku.name,
      specs: sku.variantLabel,
      category: model?.category ?? "—",
      releaseYear: model?.releaseYear,
      listPrice: sku.price,
      store: priceRange(sellable.map((u) => priceOf(u, sku.price))),
      market: priceRange(
        sellable.map((u) => marketPriceOf(u, sku.price, opts.markupPct)),
      ),
      available,
      reserved,
      qc: count("QC"),
      service: count("SERVIS"),
      onHand: mine.length,
      // A SUM over the machines again, not a multiplication (owner revision
      // 2026-09-08). Each one asks its own money now, so multiplying a count
      // by the catalogue price would value a shelf of tired Cs at what a shelf
      // of As is worth.
      value: sellable.reduce((t, u) => t + priceOf(u, sku.price), 0),
      batteryMin: battery.length ? Math.min(...battery) : undefined,
      batteryMax: battery.length ? Math.max(...battery) : undefined,
      batteryEra: era,
      locationIds: [...byLocation.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id),
      units: mine,
    };
  });
}

/**
 * One rung further down: a variant AND a grade (owner ask 2026-09-08).
 *
 * *"For the price display on inventory, the product should be expanded to
 * variant-grade level and the display price is a range if there is more than
 * one price per variant per grade."*
 *
 * Grade is the right second axis because it is the thing that MAKES two
 * machines of one variant cost different money. An A and a C of one MacBook
 * Air are two products as far as a customer is concerned, and folding them
 * into one "from Rp7.900.000" tells nobody whether the cheap one is the one
 * they want. Within a grade the prices still spread — a tired battery, a
 * missing box — and THAT is what the range is for.
 *
 * The ungraded machines get a group of their own rather than being dropped or
 * lumped with the As: a unit in QC has no grade yet and is real stock.
 */
export interface GradeGroup {
  readonly skuId: string;
  /** `Unit.grade`, or undefined for machines nobody has graded. */
  readonly grade?: string;
  /** Sellable right now. */
  readonly available: number;
  /** On hold for a named customer. */
  readonly reserved: number;
  /** Everything held at this grade — QC and service included. */
  readonly onHand: number;
  readonly store: PriceRange;
  readonly market: PriceRange;
  readonly units: readonly Unit[];
}

/**
 * The grade groups behind one Inventory row, best grade first.
 *
 * Takes the row rather than the raw units so the page cannot accidentally
 * group a set the filters have not been applied to — the same "the caller
 * filters, this counts" rule the roll-up follows.
 */
export function gradeGroupsOf(
  row: InventoryRow,
  skuPrice: number,
  markupPct?: number,
): GradeGroup[] {
  const by = new Map<string, Unit[]>();
  for (const u of row.units) {
    const key = u.grade ?? "";
    const list = by.get(key);
    if (list) list.push(u);
    else by.set(key, [u]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => gradeRank(a || undefined) - gradeRank(b || undefined))
    .map(([grade, units]) => {
      const sellable = units.filter((u) =>
        ["TERSEDIA", "DIRESERVASI"].includes(u.status),
      );
      return {
        skuId: row.skuId,
        ...(grade === "" ? {} : { grade }),
        available: units.filter((u) => u.status === "TERSEDIA").length,
        reserved: units.filter((u) => u.status === "DIRESERVASI").length,
        onHand: units.length,
        store: priceRange(sellable.map((u) => priceOf(u, skuPrice))),
        market: priceRange(
          sellable.map((u) => marketPriceOf(u, skuPrice, markupPct)),
        ),
        units,
      };
    });
}
