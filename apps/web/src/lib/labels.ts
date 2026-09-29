/**
 * Turning stock into stickers.
 *
 * Keeps the catalogue lookup in one place so the three screens that print
 * labels — Stock In history, Inventory and S/N tracking — cannot disagree
 * about what goes on the paper.
 */
import type { CatalogModel, Sku, Unit } from "../mock/seed.js";
import { productCodeLines } from "./productCode.js";

/** One sticker: a QR of the serial, its text, and the product code. */
export interface LabelDatum {
  /**
   * The unit's serial — what `Unit.serial` holds. The identity of the row: the
   * React key, the QR cache key, and what the pre-print warnings are asked
   * about.
   */
  readonly serial: string;
  /**
   * What the sticker carries: the serial, as stored.
   *
   * It was a DERIVED "store barcode" from 2026-09-01 — the supplier's
   * two-letter code in front of Apple's barcode — and the owner retired it on
   * 2026-09-21: *"it turns out we do not record that at all"*. Kept as its own
   * field so a sticker's CONTENT stays a separate question from the row's
   * identity.
   */
  readonly barcode: string;
  /** `PRO 13" 2017` — what the machine is. */
  readonly line1: string;
  /** `i5 8/128 NTB` — how it is configured. May be empty. */
  readonly line2: string;
}

/**
 * The label for one unit.
 *
 * Built from the model and the SKU's axis values rather than from the SKU's
 * stored `code`, so that a catalogue correction shows up on the next sticker
 * printed instead of reprinting a stale string forever.
 *
 * Falls back to `variantLabel` when a SKU predates structured axis values —
 * those exist only until the Master Product rework. The fallback shows the
 * variant as the shop wrote it, which is wrong-looking but never *wrong*: it
 * is the same text the SKU is listed under everywhere else in the app.
 */
export function labelFor(
  unit: Unit,
  sku: Sku | undefined,
  model: CatalogModel | undefined,
): LabelDatum {
  const barcode = unit.serial;
  if (!sku) return { serial: unit.serial, barcode, line1: "", line2: "" };

  const axes = sku.axisValues;
  if (!axes) {
    return {
      serial: unit.serial,
      barcode,
      line1: sku.name,
      line2: sku.variantLabel,
    };
  }

  const [line1, line2] = productCodeLines({
    line: model?.line,
    sizeInch: model?.sizeInch,
    year: model ? String(model.releaseYear) : undefined,
    chip: axes["Chip"],
    ram: axes["RAM"],
    ssd: axes["SSD"],
    extra: axes["Touch Bar"],
  });

  // A model with neither a line nor a size — an accessory — would otherwise
  // print a blank top line and read as a misprint. Its name is the only thing
  // worth putting there.
  return {
    serial: unit.serial,
    barcode,
    line1: line1 === "" ? sku.name : line1,
    line2: line2 === "" ? sku.variantLabel : line2,
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
