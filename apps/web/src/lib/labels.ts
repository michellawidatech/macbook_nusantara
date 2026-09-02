/**
 * Turning stock into stickers.
 *
 * Keeps the catalogue lookup in one place so the three screens that print
 * labels — Stock In history, Inventory and S/N tracking — cannot disagree
 * about what goes on the paper.
 */
import type { CatalogModel, Sku, Unit } from "../mock/seed.js";
import { productCodeLines } from "./productCode.js";
import { storeBarcodeOf } from "./serialScan.js";

/** One sticker: a QR of the store barcode, its text, and the product code. */
export interface LabelDatum {
  /**
   * The machine's own serial — Apple's barcode, what `Unit.serial` holds.
   *
   * Not what the sticker encodes. It is the identity of the row: the React
   * key, the QR cache key, and what the pre-print warnings are asked about.
   */
  readonly serial: string;
  /**
   * What the sticker actually carries (owner correction 2026-09-01).
   *
   * The STORE barcode — the supplier's two-letter origin code in front of the
   * whole serial — because that is the code on the shop's own label and the
   * one its phones scan. Falls back to the bare serial when there is no origin
   * code to derive one from, which is honest: the sticker then carries what
   * the shop actually knows about the machine, and a scan of it still finds
   * the unit.
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
  /**
   * The supplier's origin code for this unit, where the caller can find one.
   *
   * Passed in rather than looked up, for the reason `inOpnameScope` gives
   * about categories: reaching it is two hops the caller already holds
   * (unit → purchase order → supplier) and none of them is anything this file
   * is about.
   */
  supplierCode?: string,
): LabelDatum {
  const barcode = storeBarcodeOf(unit.serial, supplierCode) ?? unit.serial;
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
  /** Where the origin code for a unit comes from. See `labelFor`. */
  supplierCodeOf: (unit: Unit) => string | undefined = () => undefined,
): LabelDatum[] {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const modelById = new Map(models.map((m) => [m.id, m]));
  return units.map((u) => {
    const sku = skuById.get(u.skuId);
    return labelFor(
      u,
      sku,
      sku && modelById.get(sku.modelId),
      supplierCodeOf(u),
    );
  });
}
