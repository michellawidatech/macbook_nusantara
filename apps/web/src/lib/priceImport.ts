/**
 * Sell prices from a price list (owner ask 2026-10-21: "here's the price
 * lists … please also update the sell price, and please make sure this change
 * does not mess up the existing inbound").
 *
 * The list is the shop's own *Export stock* sheet (`lib/stockExport.ts`, the
 * B2Soft PERSEDIAAN BARANG layout) with a price column added — "Harga IG".
 * Because the app wrote every "Unit" cell itself, a row is matched back to its
 * stock EXACTLY: the same text the export builds (`Sku.name` + the variant
 * label), in the same warehouse. Nothing is guessed from a name.
 *
 * What a price lands on:
 * - **Units that have left QC** — on the shelf, reserved, or at service — get
 *   `Unit.price`, the per-unit counter price (2026-09-08).
 * - **Units still in QC are never touched.** Their price is decided at
 *   Inbound & QC, on an invoice somebody is still working through; a list
 *   arriving from outside must not rewrite it under them. They are counted
 *   and reported instead.
 * - `Sku.price`, unit costs, invoices and the ledger are not touched. Each
 *   repriced unit gets one `DICATAT` line, as *Set price* writes.
 *
 * A row is skipped, with its reason, when its product or warehouse is not
 * found, when nothing of it is in stock there, when every unit is in QC, or
 * when two rows of the sheet name the same units at different prices.
 *
 * Pure: no React, no store.
 */
import type { MockDb, Unit } from "../mock/seed.js";
import { warehouseLabelOf } from "./warehouses.js";
import { priceOf } from "./unitPrice.js";

type Cell = string | number | boolean | null | undefined;

/** One priced row of the sheet. */
export interface PriceRow {
  /** Spreadsheet row number, 1-based, for the person reading the preview. */
  readonly rowNo: number;
  readonly unit: string;
  /** The warehouse as the sheet prints it, e.g. `03 · Gudang Penjualan`. */
  readonly warehouse: string;
  readonly price: number;
  /** The `Qty` the list was exported with, when it has the column. */
  readonly qty?: number;
}

export type PriceSheetError = "NO_HEADER" | "NO_PRICE_COLUMN";

/** The statuses a list price may reprice: held, and past QC. */
export const REPRICED_STATUSES: readonly Unit["status"][] = [
  "TERSEDIA",
  "DIRESERVASI",
  "SERVIS",
];

const text = (c: Cell) =>
  c === null || c === undefined ? "" : String(c).trim();
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * The money in a cell: a number, or text like `Rp 6.200.000` / `6,200,000`.
 * Whole rupiah — every price on a list is.
 */
function money(c: Cell): number | null {
  if (typeof c === "number")
    return Number.isFinite(c) && c > 0 ? Math.round(c) : null;
  const digits = text(c).replace(/[^0-9]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

/**
 * Read the sheet's rows. The header row is the one with a `Unit` cell; the
 * price column is the first whose heading says a sell price — `Harga IG`,
 * `Harga Jual`, `Sell price` — and never `Harga Satuan` (what a unit COST)
 * or a struck-through old price (`lama`, `coret`). The warehouse is the
 * `Gudang` column, or the banded group row above when there is none.
 */
export function readPriceSheet(
  rows: readonly (readonly Cell[])[],
): { rows: PriceRow[] } | { error: PriceSheetError } {
  const headerAt = rows.findIndex((r) =>
    r.some((c) => norm(text(c)) === "UNIT"),
  );
  if (headerAt < 0) return { error: "NO_HEADER" };
  const header = rows[headerAt]!.map((c) => norm(text(c)));
  const unitCol = header.indexOf("UNIT");
  const whCol = header.findIndex((h) => h === "GUDANG" || h === "WAREHOUSE");
  const qtyCol = header.findIndex((h) => h === "QTY" || h === "JUMLAH");
  const priceCol = header.findIndex(
    (h) =>
      /HARGA|PRICE/.test(h) &&
      !/SATUAN|UNIT PRICE|LAMA|CORET|OLD|BELI|COST|MODAL/.test(h),
  );
  if (priceCol < 0) return { error: "NO_PRICE_COLUMN" };

  const out: PriceRow[] = [];
  let group = "";
  rows.slice(headerAt + 1).forEach((r, i) => {
    const unit = text(r[unitCol]);
    if (unit === "" || norm(unit) === "TOTAL") return;
    const price = money(r[priceCol]);
    const wh = whCol >= 0 ? text(r[whCol]) : "";
    // A banded group row: a warehouse and its total, nothing priced.
    if (price === null && wh === "") {
      group = unit;
      return;
    }
    if (price === null) return;
    const qty = qtyCol >= 0 ? Number(r[qtyCol]) : NaN;
    out.push({
      rowNo: headerAt + 2 + i,
      unit,
      warehouse: wh || group,
      price,
      ...(Number.isInteger(qty) && qty >= 0 ? { qty } : {}),
    });
  });
  return { rows: out };
}

export type PriceRowStatus =
  | "OK"
  | "UNCHANGED"
  | "NO_PRODUCT"
  | "NO_WAREHOUSE"
  | "NO_STOCK"
  | "ONLY_QC"
  | "CONFLICT";

export interface PlannedRow extends PriceRow {
  readonly status: PriceRowStatus;
  /** Units this row reprices. */
  readonly serials: readonly string[];
  /** Units of it still in QC, left alone. */
  readonly inQc: number;
  /**
   * Every unit of it held there TODAY, QC included — what the list's `qty`
   * counted when it was exported. A difference means stock arrived or left
   * since: shown, never acted on beyond the rules above.
   */
  readonly heldNow: number;
  /** Their prices today, lowest and highest. */
  readonly before: readonly [number, number] | null;
}

export interface PricePlan {
  readonly rows: readonly PlannedRow[];
  /** Serial → new price, only where it changes. */
  readonly edits: readonly { serial: string; price: number }[];
}

export function planPriceImport(
  db: Pick<MockDb, "units" | "skus" | "warehouses">,
  sheet: readonly PriceRow[],
): PricePlan {
  const skuPrice = new Map(db.skus.map((s) => [s.id, s.price]));
  const skusByText = new Map<string, string[]>();
  for (const s of db.skus) {
    const key = norm([s.name, s.variantLabel].filter(Boolean).join(" "));
    skusByText.set(key, [...(skusByText.get(key) ?? []), s.id]);
  }
  const whByText = new Map<string, string>();
  for (const w of db.warehouses) {
    whByText.set(norm(warehouseLabelOf(db.warehouses, w.id) ?? w.name), w.id);
    whByText.set(norm(w.name), w.id);
  }

  const drafts = sheet.map((row) => {
    const skuIds = skusByText.get(norm(row.unit));
    const whId = whByText.get(norm(row.warehouse));
    if (!skuIds)
      return {
        row,
        status: "NO_PRODUCT" as const,
        units: [] as Unit[],
        inQc: 0,
      };
    if (!whId)
      return { row, status: "NO_WAREHOUSE" as const, units: [], inQc: 0 };
    const here = db.units.filter(
      (u) => skuIds.includes(u.skuId) && u.locationId === whId,
    );
    const units = here.filter((u) => REPRICED_STATUSES.includes(u.status));
    const inQc = here.filter((u) => u.status === "QC").length;
    const status =
      units.length > 0
        ? ("OK" as const)
        : inQc > 0
          ? ("ONLY_QC" as const)
          : ("NO_STOCK" as const);
    return { row, status, units, inQc };
  });

  // Two rows that land on the same unit at different prices: neither wins.
  const priceBySerial = new Map<string, Set<number>>();
  for (const d of drafts) {
    for (const u of d.units) {
      const set = priceBySerial.get(u.serial) ?? new Set<number>();
      set.add(d.row.price);
      priceBySerial.set(u.serial, set);
    }
  }

  const edits = new Map<string, number>();
  const rows: PlannedRow[] = drafts.map((d) => {
    const nowPrices = d.units.map((u) =>
      priceOf(u, skuPrice.get(u.skuId) ?? 0),
    );
    const before: [number, number] | null =
      nowPrices.length === 0
        ? null
        : [Math.min(...nowPrices), Math.max(...nowPrices)];
    const base = {
      ...d.row,
      inQc: d.inQc,
      heldNow: d.units.length + d.inQc,
      before,
    };
    if (d.status !== "OK") return { ...base, status: d.status, serials: [] };
    if (d.units.some((u) => priceBySerial.get(u.serial)!.size > 1)) {
      return { ...base, status: "CONFLICT", serials: [] };
    }
    const changing = d.units.filter(
      (u, i) => nowPrices[i] !== d.row.price || u.price === undefined,
    );
    for (const u of changing) edits.set(u.serial, d.row.price);
    return {
      ...base,
      status: changing.length === 0 ? "UNCHANGED" : "OK",
      serials: changing.map((u) => u.serial),
    };
  });

  return {
    rows,
    edits: [...edits].map(([serial, price]) => ({ serial, price })),
  };
}
