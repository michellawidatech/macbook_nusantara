/**
 * Turning stock into stickers.
 *
 * Keeps the catalogue lookup in one place so the three screens that print
 * labels — Inbound & QC, Inventory and S/N tracking — cannot disagree about
 * what goes on the sticker.
 *
 * Since 2026-10-22 (owner) the sticker carries a QR of the serial and two
 * lines of text: the product's name and its SKU code. The serial is NOT
 * printed as text — it is in the QR, and on the unit already.
 */
import type { CatalogModel, Sku, Unit } from "../mock/seed.js";

/** One sticker: a QR of the serial, the product name and the SKU code. */
export interface LabelDatum {
  /**
   * The unit's serial — what `Unit.serial` holds. The identity of the row: the
   * React key, the QR cache key, and what the pre-print warnings are asked
   * about.
   */
  readonly serial: string;
  /**
   * What the QR encodes: the serial, as stored (2026-09-21). Kept as its own
   * field so a sticker's CONTENT stays a separate question from the row's
   * identity.
   */
  readonly barcode: string;
  /** `MacBook Air 13" 2020` — the product, in full. */
  readonly name: string;
  /** `AIR 13" 2020 I5 8/256` — `Sku.code`. May be empty. */
  readonly code: string;
}

/** The label for one unit. */
export function labelFor(
  unit: Unit,
  sku: Sku | undefined,
  model: CatalogModel | undefined,
): LabelDatum {
  return {
    serial: unit.serial,
    barcode: unit.serial,
    name: sku?.name || model?.name || "",
    code: sku?.code ?? "",
  };
}

/** Labels for a set of units, in the order given. */
export function labelsFor(
  units: readonly Unit[],
  skus: readonly Sku[],
  models: readonly CatalogModel[],
): LabelDatum[] {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const modelById = new Map(models.map((m) => [m.id, m]));
  return units.map((u) => {
    const sku = skuById.get(u.skuId);
    return labelFor(u, sku, sku && modelById.get(sku.modelId));
  });
}
