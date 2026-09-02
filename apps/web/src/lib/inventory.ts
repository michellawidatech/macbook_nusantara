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
   * `Sku.price` — the price, full stop, since 2026-08-27.
   *
   * It used to be the list price sitting behind whatever QC had asked for each
   * individual serial, which is why the name still says "list". Every unit of
   * this variant now quotes exactly this.
   */
  listPrice: number;
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
  /** Range of battery readings among the units behind this row. */
  batteryMin?: number;
  batteryMax?: number;
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
    // `undefined`, not 0 — see battery.ts: an unmeasured battery and a dead
    // one are different facts and Math.min would merge them.
    const battery = mine
      .map((u) => u.batteryHealth)
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
      available,
      reserved,
      qc: count("QC"),
      service: count("SERVIS"),
      onHand: mine.length,
      // One price across the variant, so this is a multiplication rather than
      // a sum over per-unit prices. There is no "from" any more either: every
      // available unit of this row is quoted the same money.
      value: sellable.length * sku.price,
      batteryMin: battery.length ? Math.min(...battery) : undefined,
      batteryMax: battery.length ? Math.max(...battery) : undefined,
      locationIds: [...byLocation.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id),
      units: mine,
    };
  });
}
