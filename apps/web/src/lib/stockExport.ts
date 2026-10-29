/**
 * The stock report the Inventory page exports, laid out after the shop's old
 * B2Soft report "PERSEDIAAN BARANG" (owner ask 2026-09-19).
 *
 * > *"Option to include unit price and sell price, columns printed can be
 * > adjustable but by default is unit, qty, warehouse."*
 *
 * ## The layout, and why it copies B2Soft
 *
 * The shop has read its stock off B2Soft's report for years, and the
 * bookkeeper's own sheets start from it. A report that answers the same
 * question in a different shape is a report somebody re-types into the old
 * shape, so this one keeps it: the shop's name and the report's title on top,
 * which warehouses it is "from" and the date it runs "until", then the stock
 * GROUPED BY WAREHOUSE — each group opening with a banded row carrying the
 * warehouse and its total, the way B2Soft prints "159  03 - GUDANG PENJUALAN"
 * — and one row per product under it.
 *
 * "Sampai Tanggal" is always today. The app holds the stock as it stands, not
 * a history of it, so a report "until" last month would be today's stock with
 * last month's date on it.
 *
 * ## The columns decide the rows
 *
 * - **Warehouse** on (the default) is the B2Soft layout above: a group per
 *   warehouse, and the warehouse on every row too, so a row still says where
 *   it is once somebody copies it out of its group. Off, the warehouses are
 *   merged — one row per product across all of them, which is the other
 *   question a stock report gets asked ("how many do we have, anywhere?").
 * - **Grade** on splits a product's row by grade; off, the grades are added
 *   together. A grade column over rows that mixed grades would be a lie.
 * - **Serial** on (owner ask 2026-10-29: *"1 row 1 serial 1 product name"*)
 *   gives every unit its own row, its serial beside the product's name, so
 *   each Qty is 1 and the warehouse groups and totals still add up.
 * - **Unit** cannot be switched off: a row is a product, and a quantity with
 *   no name beside it is a number about nothing.
 *
 * ## Prices
 *
 * The unit price is `Unit.buy` — what the invoice charged, which is what
 * Inbound calls a unit's "Unit price" — and the sell price is what the units
 * on the shelf ask over the counter (`priceOf`), over the sellable ones only,
 * exactly as the Inventory table shows them. Both are per SERIAL, so a row
 * carries a range, written as two numeric columns (lowest, highest) rather
 * than as text: a bookkeeper sums and sorts a price column, and "Rp 4.500.000
 * – Rp 5.100.000" in one cell can be neither. Whole rupiah, formatted with the
 * reader's own thousands separator.
 *
 * ## One language
 *
 * The sheet is Indonesian whatever the interface is set to — a document, not
 * a screen, in the words of the report it replaces. The faktur is the same
 * kind of thing and is kept out of the language switch for the same reason
 * (it is in English there because its template was). The dialog that asks
 * for it is bilingual like every other screen.
 *
 * ⚠️ `Location.code` ("03" in B2Soft's "03 - GUDANG PENJUALAN") exists in
 * prisma but not in the store contract or the web `Warehouse` type, so the
 * report names a warehouse by its name alone.
 *
 * Pure: no React, no store, no clock (`now` is passed in).
 * `test/stockExport.test.ts` is the spec.
 */
import type { CatalogModel, Sku, Unit, Warehouse } from "../mock/seed.js";
import { gradeRank, gradeText } from "./condition.js";
import { HELD_STATUSES, isSellable } from "./inventory.js";
import { priceOf, priceRange, type PriceRange } from "./unitPrice.js";
import type { XlsxCell, XlsxRow, XlsxSheet, XlsxStyle } from "./xlsxWrite.js";
import {
  pdfTable,
  type PdfBlock,
  type PdfPageSize,
  type PdfStyle,
} from "./pdfWrite.js";
import { warehouseLabelOf } from "./warehouses.js";

/** What the export dialog offers to print. */
export type StockExportColumn =
  | "sku"
  | "unit"
  | "serial"
  | "grade"
  | "warehouse"
  | "qty"
  | "unitPrice"
  | "sellPrice";

/**
 * Every column, in the order the SHEET prints them: what the row is, how many,
 * what they cost and ask, and where. The owner's own order for the defaults —
 * unit, qty, warehouse — with the optional columns slotted in beside the one
 * each is about.
 */
export const STOCK_EXPORT_COLUMNS: readonly StockExportColumn[] = [
  "sku",
  "unit",
  "serial",
  "grade",
  "qty",
  "unitPrice",
  "sellPrice",
  "warehouse",
];

/** The owner's default (2026-09-19): "by default is unit, qty, warehouse". */
export const DEFAULT_STOCK_EXPORT_COLUMNS: readonly StockExportColumn[] = [
  "unit",
  "qty",
  "warehouse",
];

/** The column that cannot be switched off — see the docblock. */
export const REQUIRED_STOCK_EXPORT_COLUMN: StockExportColumn = "unit";

/**
 * What to export. Each axis is a list, and an EMPTY list means all of it —
 * the grammar a stock take's scope uses (`lib/opnameScope.ts`). The axes are
 * ANDed.
 */
export interface StockExportFilter {
  readonly warehouseIds: readonly string[];
  /** `CatalogModel.category` names. */
  readonly categories: readonly string[];
  /** `CatalogModel.id` — a product, all of its variants. */
  readonly modelIds: readonly string[];
}

export const EVERYTHING: StockExportFilter = {
  warehouseIds: [],
  categories: [],
  modelIds: [],
};

/** The slices of the store the report reads. `MockDb` satisfies it. */
export interface StockExportSources {
  readonly units: readonly Unit[];
  readonly skus: readonly Sku[];
  readonly models: readonly CatalogModel[];
  readonly warehouses: readonly Warehouse[];
}

/** One printed row: a product (and a grade, when split by grade). */
export interface StockReportLine {
  readonly skuId: string;
  /** `Sku.code`. */
  readonly code: string;
  /** The product and its variant, as one cell: "MacBook Air 13 2015 i5 / 8GB / 256GB". */
  readonly unit: string;
  /** Present only when the report is one row per serial. */
  readonly serial?: string;
  /** Present only when the report is split by grade; absent means ungraded there. */
  readonly grade?: string;
  /** How many units the shop holds of it. */
  readonly qty: number;
  /** `Unit.buy` over every unit on the row. */
  readonly unitPrice: PriceRange;
  /** The asking price over the row's sellable units. */
  readonly sellPrice: PriceRange;
}

/** A warehouse's block, or — merged — the one block of the whole report. */
export interface StockReportGroup {
  /** The warehouse's id; empty when the report is not split by warehouse. */
  readonly locationId: string;
  /** Its name; empty when merged. */
  readonly warehouse: string;
  readonly qty: number;
  readonly lines: readonly StockReportLine[];
}

export interface StockReport {
  /** True when grouped by warehouse (the B2Soft layout). */
  readonly byWarehouse: boolean;
  readonly byGrade: boolean;
  readonly bySerial?: boolean;
  readonly groups: readonly StockReportGroup[];
  /** Every unit on the report. */
  readonly qty: number;
  /** Every printed row, across the groups. */
  readonly lineCount: number;
}

/** A unit is on the report while the shop holds it and every axis admits it. */
export function inStockExport(
  unit: Pick<Unit, "status" | "locationId" | "skuId">,
  filter: StockExportFilter,
  modelOf: (skuId: string) => CatalogModel | undefined,
): boolean {
  if (!HELD_STATUSES.includes(unit.status)) return false;
  if (
    filter.warehouseIds.length > 0 &&
    !filter.warehouseIds.includes(unit.locationId)
  ) {
    return false;
  }
  if (filter.categories.length === 0 && filter.modelIds.length === 0) {
    return true;
  }
  const model = modelOf(unit.skuId);
  if (
    filter.categories.length > 0 &&
    !filter.categories.includes(model?.category ?? "")
  ) {
    return false;
  }
  return (
    filter.modelIds.length === 0 || filter.modelIds.includes(model?.id ?? "")
  );
}

/**
 * The report's rows, grouped.
 *
 * Groups follow the shop's own warehouse order; a location the store does
 * not list sorts after them by id. Rows follow the catalogue, best grade
 * first — the order the Inventory table uses, so the two read alike.
 */
export function stockReport(
  src: StockExportSources,
  filter: StockExportFilter,
  opts: {
    readonly byWarehouse: boolean;
    readonly byGrade: boolean;
    readonly bySerial?: boolean;
  },
): StockReport {
  const skuById = new Map(src.skus.map((s) => [s.id, s]));
  const modelById = new Map(src.models.map((m) => [m.id, m]));
  const skuIndex = new Map(src.skus.map((s, i) => [s.id, i]));
  const whIndex = new Map(src.warehouses.map((w, i) => [w.id, i]));
  const modelOf = (skuId: string) => {
    const sku = skuById.get(skuId);
    return sku && modelById.get(sku.modelId);
  };

  const groups = new Map<string, Map<string, Unit[]>>();
  for (const u of src.units) {
    if (!inStockExport(u, filter, modelOf)) continue;
    const group = opts.byWarehouse ? u.locationId : "";
    const row = `${u.skuId}|${opts.byGrade ? (u.grade ?? "") : ""}|${opts.bySerial ? u.serial : ""}`;
    let rows = groups.get(group);
    if (!rows) groups.set(group, (rows = new Map()));
    const list = rows.get(row);
    if (list) list.push(u);
    else rows.set(row, [u]);
  }

  const at = (id: string) => whIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
  const out: StockReportGroup[] = [...groups.entries()]
    .sort(([a], [b]) => at(a) - at(b) || a.localeCompare(b))
    .map(([locationId, rows]) => {
      const lines = [...rows.values()]
        .map((units): StockReportLine => {
          const first = units[0]!;
          const sku = skuById.get(first.skuId);
          const asking = sku?.price ?? 0;
          return {
            skuId: first.skuId,
            code: sku?.code ?? "",
            unit: sku
              ? [sku.name, sku.variantLabel].filter(Boolean).join(" ")
              : first.skuId,
            ...(opts.bySerial ? { serial: first.serial } : {}),
            ...(opts.byGrade && first.grade ? { grade: first.grade } : {}),
            qty: units.length,
            unitPrice: priceRange(units.map((u) => u.buy)),
            sellPrice: priceRange(
              units.filter(isSellable).map((u) => priceOf(u, asking)),
            ),
          };
        })
        .sort(
          (a, b) =>
            (skuIndex.get(a.skuId) ?? Number.MAX_SAFE_INTEGER) -
              (skuIndex.get(b.skuId) ?? Number.MAX_SAFE_INTEGER) ||
            gradeRank(a.grade) - gradeRank(b.grade) ||
            (a.serial ?? "").localeCompare(b.serial ?? ""),
        );
      return {
        locationId,
        warehouse: opts.byWarehouse
          ? (warehouseLabelOf(src.warehouses, locationId) ?? locationId)
          : "",
        qty: lines.reduce((n, l) => n + l.qty, 0),
        lines,
      };
    });

  return {
    byWarehouse: opts.byWarehouse,
    byGrade: opts.byGrade,
    bySerial: opts.bySerial === true,
    groups: out,
    qty: out.reduce((n, g) => n + g.qty, 0),
    lineCount: out.reduce((n, g) => n + g.lines.length, 0),
  };
}

/** The report for a set of chosen columns — the columns decide the rows. */
export function stockReportFor(
  src: StockExportSources,
  filter: StockExportFilter,
  columns: readonly StockExportColumn[],
): StockReport {
  return stockReport(src, filter, {
    byWarehouse: columns.includes("warehouse"),
    byGrade: columns.includes("grade"),
    bySerial: columns.includes("serial"),
  });
}

/**
 * The report's own words. Indonesian, whatever the interface language — see
 * the docblock.
 */
export const STOCK_REPORT_TEXT = {
  title: "PERSEDIAAN BARANG",
  fromWarehouse: "Dari Gudang",
  allWarehouses: "Semua gudang",
  category: "Kategori",
  product: "Produk",
  asOf: "Sampai Tanggal",
  printedAt: "Dicetak",
  total: "TOTAL",
  empty: "Tidak ada stok yang cocok dengan filter ini.",
  newGrade: "Baru",
  heading: {
    sku: "Kode SKU",
    unit: "Unit",
    serial: "Serial",
    grade: "Grade",
    warehouse: "Gudang",
    qty: "Qty",
    unitPriceMin: "Harga Satuan (terendah)",
    unitPriceMax: "Harga Satuan (tertinggi)",
    sellPriceMin: "Harga Jual (terendah)",
    sellPriceMax: "Harga Jual (tertinggi)",
  },
} as const;

/** `19/09/2026` — how the shop writes a date. Local time: the shop's day. */
export function fmtReportDate(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `19/09/2026 14:05`. */
export function fmtReportDateTime(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${fmtReportDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * `Persediaan-Barang-2026-09-19.xlsx`. The LOCAL date, not `toISOString`'s:
 * at seven in the morning in Jakarta the UTC date is still yesterday.
 */
export function stockExportFileName(
  now: Date,
  format: StockExportFormat = "xlsx",
): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `Persediaan-Barang-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.${format}`;
}

/**
 * What the dialog can hand over (owner ask 2026-09-21: *"Make a export stock
 * as a PDF or excel file or both (the user can choose)"*).
 *
 * The same report either way — same filters, same columns, same grouping —
 * because they answer different questions about one document rather than being
 * two documents. The **spreadsheet** is for a bookkeeper, who sorts a column
 * and sums it; the **PDF** is for a shelf, a supplier or a WhatsApp message,
 * where what matters is that it looks the same on every screen it lands on and
 * cannot be edited on the way. Asking for both is one download each, not a
 * third format.
 */
export type StockExportFormat = "xlsx" | "pdf";

export interface StockSheetOptions {
  readonly columns: readonly StockExportColumn[];
  /** `AppSettings.shopName`. Blank leaves the line out rather than inventing one. */
  readonly shopName?: string;
  /** Names of the warehouses the filter chose; empty is every warehouse. */
  readonly warehouseNames: readonly string[];
  /** Names of the categories chosen, for the header; empty prints nothing. */
  readonly categoryNames?: readonly string[];
  /** Names of the products chosen, for the header; empty prints nothing. */
  readonly productNames?: readonly string[];
  readonly now: Date;
}

/** One sheet column: what heads it, how wide it is, and what a row puts in it. */
interface SheetColumn {
  readonly key: StockExportColumn;
  readonly heading: string;
  readonly width: number;
  readonly numeric: boolean;
  readonly cell: (line: StockReportLine, group: StockReportGroup) => CellValue;
}

type CellValue = string | number | undefined;

function sheetColumns(chosen: readonly StockExportColumn[]): SheetColumn[] {
  const h = STOCK_REPORT_TEXT.heading;
  const wanted = new Set<StockExportColumn>([
    ...chosen,
    REQUIRED_STOCK_EXPORT_COLUMN,
  ]);
  const low = (r: PriceRange) => (r.count === 0 ? undefined : r.min);
  const high = (r: PriceRange) => (r.count === 0 ? undefined : r.max);
  const all: Record<StockExportColumn, SheetColumn[]> = {
    sku: [
      {
        key: "sku",
        heading: h.sku,
        width: 26,
        numeric: false,
        cell: (l) => l.code,
      },
    ],
    unit: [
      {
        key: "unit",
        heading: h.unit,
        width: 46,
        numeric: false,
        cell: (l) => l.unit,
      },
    ],
    serial: [
      {
        key: "serial",
        heading: h.serial,
        width: 18,
        numeric: false,
        cell: (l) => l.serial ?? "",
      },
    ],
    grade: [
      {
        key: "grade",
        heading: h.grade,
        width: 8,
        numeric: false,
        cell: (l) => gradeText(l.grade, STOCK_REPORT_TEXT.newGrade) ?? "",
      },
    ],
    warehouse: [
      {
        key: "warehouse",
        heading: h.warehouse,
        width: 24,
        numeric: false,
        cell: (_, g) => g.warehouse,
      },
    ],
    qty: [
      {
        key: "qty",
        heading: h.qty,
        width: 8,
        numeric: true,
        cell: (l) => l.qty,
      },
    ],
    unitPrice: [
      {
        key: "unitPrice",
        heading: h.unitPriceMin,
        width: 22,
        numeric: true,
        cell: (l) => low(l.unitPrice),
      },
      {
        key: "unitPrice",
        heading: h.unitPriceMax,
        width: 22,
        numeric: true,
        cell: (l) => high(l.unitPrice),
      },
    ],
    sellPrice: [
      {
        key: "sellPrice",
        heading: h.sellPriceMin,
        width: 20,
        numeric: true,
        cell: (l) => low(l.sellPrice),
      },
      {
        key: "sellPrice",
        heading: h.sellPriceMax,
        width: 20,
        numeric: true,
        cell: (l) => high(l.sellPrice),
      },
    ],
  };
  return STOCK_EXPORT_COLUMNS.filter((c) => wanted.has(c)).flatMap(
    (c) => all[c],
  );
}

/**
 * The report as a sheet: the title block, the heading row (frozen, so it
 * stays on screen), then the groups and a total.
 */
export function stockReportSheet(
  report: StockReport,
  opts: StockSheetOptions,
): XlsxSheet {
  const text = STOCK_REPORT_TEXT;
  const cols = sheetColumns(opts.columns);
  const qtyAt = cols.findIndex((c) => c.key === "qty");
  const styled = (v: CellValue, s: XlsxStyle): XlsxCell => ({ v, s });
  const rows: XlsxRow[] = [];

  const shop = opts.shopName?.trim();
  if (shop) rows.push([styled(shop, "title")]);
  rows.push([styled(text.title, "bold")]);
  rows.push([
    `${text.fromWarehouse}: ${
      opts.warehouseNames.length > 0
        ? opts.warehouseNames.join(", ")
        : text.allWarehouses
    }`,
  ]);
  // Said only when narrowed: a report that is quietly one category reads as
  // the whole shop to anybody who did not export it.
  if (opts.categoryNames && opts.categoryNames.length > 0) {
    rows.push([`${text.category}: ${opts.categoryNames.join(", ")}`]);
  }
  if (opts.productNames && opts.productNames.length > 0) {
    rows.push([`${text.product}: ${opts.productNames.join(", ")}`]);
  }
  rows.push([`${text.asOf}: ${fmtReportDate(opts.now)}`]);
  rows.push([
    styled(`${text.printedAt}: ${fmtReportDateTime(opts.now)}`, "muted"),
  ]);
  rows.push([]);

  rows.push(
    cols.map((c) => styled(c.heading, c.numeric ? "headerNum" : "header")),
  );
  const freezeRows = rows.length;

  if (report.lineCount === 0) {
    rows.push([styled(text.empty, "muted")]);
  }
  for (const group of report.groups) {
    if (report.byWarehouse) {
      // B2Soft's "159  03 - GUDANG PENJUALAN": the warehouse and its total,
      // on a band across the whole row.
      rows.push(
        cols.map((_, i) =>
          i === qtyAt
            ? styled(group.qty, "groupNum")
            : styled(i === 0 ? group.warehouse : undefined, "group"),
        ),
      );
    }
    for (const line of group.lines) {
      rows.push(
        cols.map((c) => {
          const v = c.cell(line, group);
          return c.numeric ? styled(v, "num") : v;
        }),
      );
    }
  }
  if (qtyAt >= 0 && report.lineCount > 0) {
    rows.push(
      cols.map((_, i) =>
        i === qtyAt
          ? styled(report.qty, "numBold")
          : i === 0
            ? styled(text.total, "bold")
            : undefined,
      ),
    );
  }

  return {
    name: "Persediaan",
    rows,
    columnWidths: cols.map((c) => c.width),
    freezeRows,
    fitToWidth: true,
  };
}

/**
 * The same report as a PDF (owner ask 2026-09-21).
 *
 * Built from the SAME `StockReport` and the same `sheetColumns`, so the two
 * files cannot disagree about what is in stock or which columns were asked
 * for. What differs is only what a page can hold:
 *
 * - **Money is formatted here**, into Indonesian thousands separators, because
 *   a PDF cell is a string and there is no reader to apply a number format.
 *   The spreadsheet keeps real numbers, which is the whole point of having a
 *   spreadsheet.
 * - **The column widths become proportions.** `SheetColumn.width` is in
 *   spreadsheet characters, which is near enough a relative weight for a page
 *   to be laid out from — `pdfTable` scales them to the printable width.
 * - **Landscape past five columns.** A stock report with both price pairs is
 *   nine columns; portrait would give the product name about a centimetre.
 */
export function stockReportPdf(
  report: StockReport,
  opts: StockSheetOptions & {
    readonly pageSize?: PdfPageSize;
  },
): Uint8Array {
  const text = STOCK_REPORT_TEXT;
  const cols = sheetColumns(opts.columns);
  const qtyAt = cols.findIndex((c) => c.key === "qty");
  const head: PdfBlock[] = [];

  const shop = opts.shopName?.trim();
  if (shop) head.push({ kind: "text", text: shop, style: "title" });
  head.push({ kind: "text", text: text.title, style: "bold" });
  head.push({
    kind: "text",
    text: `${text.fromWarehouse}: ${
      opts.warehouseNames.length > 0
        ? opts.warehouseNames.join(", ")
        : text.allWarehouses
    }`,
    style: "muted",
  });
  if (opts.categoryNames && opts.categoryNames.length > 0) {
    head.push({
      kind: "text",
      text: `${text.category}: ${opts.categoryNames.join(", ")}`,
      style: "muted",
    });
  }
  if (opts.productNames && opts.productNames.length > 0) {
    head.push({
      kind: "text",
      text: `${text.product}: ${opts.productNames.join(", ")}`,
      style: "muted",
    });
  }
  head.push({
    kind: "text",
    text: `${text.asOf}: ${fmtReportDate(opts.now)}`,
    style: "muted",
  });
  head.push({ kind: "gap", height: 4 });

  /** A number as the shop writes it. Blank for a column with nothing in it. */
  const show = (v: CellValue): string =>
    v === undefined || v === null
      ? ""
      : typeof v === "number"
        ? v.toLocaleString("id-ID")
        : v;

  const body: PdfBlock[] = [];
  if (report.lineCount === 0) {
    body.push({ kind: "text", text: text.empty, style: "muted" });
  }
  for (const group of report.groups) {
    if (report.byWarehouse) {
      body.push({
        kind: "row",
        cells: cols.map((_, i) => ({
          text:
            i === qtyAt
              ? group.qty.toLocaleString("id-ID")
              : i === 0
                ? group.warehouse
                : "",
          style: (i === qtyAt ? "groupNum" : "group") as PdfStyle,
        })),
      });
    }
    for (const line of group.lines) {
      body.push({
        kind: "row",
        cells: cols.map((c) => ({
          text: show(c.cell(line, group)),
          style: (c.numeric ? "num" : "default") as PdfStyle,
        })),
      });
    }
  }
  if (qtyAt >= 0 && report.lineCount > 0) {
    body.push({ kind: "rule" });
    body.push({
      kind: "row",
      cells: cols.map((_, i) => ({
        text:
          i === qtyAt
            ? report.qty.toLocaleString("id-ID")
            : i === 0
              ? text.total
              : "",
        style: (i === qtyAt ? "numBold" : "bold") as PdfStyle,
      })),
    });
  }

  return pdfTable({
    title: `${text.title} — ${fmtReportDate(opts.now)}`,
    pageSize: opts.pageSize ?? "A4",
    // Past five columns a portrait page gives the product name a centimetre.
    landscape: cols.length > 5,
    columnWidths: cols.map((c) => c.width),
    head,
    heading: cols.map((c) => ({
      text: c.heading,
      style: (c.numeric ? "headerNum" : "header") as PdfStyle,
    })),
    body,
    footer: `${text.printedAt}: ${fmtReportDateTime(opts.now)}`,
    now: opts.now,
  });
}
