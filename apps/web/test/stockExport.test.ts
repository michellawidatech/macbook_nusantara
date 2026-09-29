/**
 * The stock export (owner ask 2026-09-19): the report's rows, and the sheet
 * laid out after B2Soft's "PERSEDIAAN BARANG".
 */
import { describe, expect, it } from "vitest";
import { buildSeed, type Unit } from "../src/mock/seed.js";
import { HELD_STATUSES, isSellable } from "../src/lib/inventory.js";
import { priceOf } from "../src/lib/unitPrice.js";
import {
  DEFAULT_STOCK_EXPORT_COLUMNS,
  EVERYTHING,
  STOCK_EXPORT_COLUMNS,
  STOCK_REPORT_TEXT,
  fmtReportDate,
  fmtReportDateTime,
  stockExportFileName,
  stockReport,
  stockReportFor,
  stockReportSheet,
  type StockExportColumn,
} from "../src/lib/stockExport.js";
import {
  XLSX_STYLES,
  worksheetXml,
  type XlsxCell,
  type XlsxRow,
} from "../src/lib/xlsxWrite.js";

const db = buildSeed();
const held = db.units.filter((u) => HELD_STATUSES.includes(u.status));
const modelOf = (u: Unit) =>
  db.models.find(
    (m) => m.id === db.skus.find((s) => s.id === u.skuId)?.modelId,
  )!;
const now = new Date(2026, 8, 19, 7, 5);

/** A cell's value, whether it was written bare or with a style. */
const valueOf = (c: XlsxRow[number]) =>
  c !== null && typeof c === "object" ? (c as XlsxCell).v : c;
const styleOf = (c: XlsxRow[number]) =>
  c !== null && typeof c === "object" ? (c as XlsxCell).s : undefined;
const texts = (row: XlsxRow) => row.map(valueOf);

describe("stockReport — which units, and how they are grouped", () => {
  it("takes every unit the shop holds when nothing is chosen — empty means all", () => {
    const r = stockReport(db, EVERYTHING, {
      byWarehouse: true,
      byGrade: false,
    });
    expect(r.qty).toBe(held.length);
    const sold = db.units.find((u) => u.status === "TERJUAL");
    expect(sold).toBeDefined();
    const skus = r.groups.flatMap((g) => g.lines.map((l) => l.skuId));
    // A sold unit's variant may still be stocked; its COUNT must not include it.
    for (const g of r.groups) {
      for (const l of g.lines) {
        expect(l.qty).toBe(
          held.filter(
            (u) => u.skuId === l.skuId && u.locationId === g.locationId,
          ).length,
        );
      }
    }
    expect(skus.length).toBe(r.lineCount);
  });

  it("narrows by warehouse, category and product, each ANDed with the others", () => {
    const wh = held[0]!.locationId;
    const cat = modelOf(held[0]!).category;
    const byWh = stockReport(
      db,
      { ...EVERYTHING, warehouseIds: [wh] },
      { byWarehouse: true, byGrade: false },
    );
    expect(byWh.groups.map((g) => g.locationId)).toEqual([wh]);
    expect(byWh.qty).toBe(held.filter((u) => u.locationId === wh).length);

    const byCat = stockReport(
      db,
      { ...EVERYTHING, categories: [cat] },
      { byWarehouse: true, byGrade: false },
    );
    expect(byCat.qty).toBe(
      held.filter((u) => modelOf(u).category === cat).length,
    );

    const model = modelOf(held[0]!).id;
    const both = stockReport(
      db,
      { warehouseIds: [wh], categories: [cat], modelIds: [model] },
      { byWarehouse: true, byGrade: false },
    );
    expect(both.qty).toBe(
      held.filter(
        (u) =>
          u.locationId === wh &&
          modelOf(u).category === cat &&
          modelOf(u).id === model,
      ).length,
    );
    expect(both.qty).toBeGreaterThan(0);

    const none = stockReport(
      db,
      { ...EVERYTHING, categories: ["No such category"] },
      { byWarehouse: true, byGrade: false },
    );
    expect(none.qty).toBe(0);
    expect(none.groups).toEqual([]);
  });

  it("groups by warehouse in the shop's own order, each with its total", () => {
    const r = stockReport(db, EVERYTHING, {
      byWarehouse: true,
      byGrade: false,
    });
    const order = r.groups.map((g) =>
      db.warehouses.findIndex((w) => w.id === g.locationId),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(r.groups.length).toBeGreaterThan(1);
    for (const g of r.groups) {
      expect(g.warehouse).toBe(
        db.warehouses.find((w) => w.id === g.locationId)!.name,
      );
      expect(g.qty).toBe(g.lines.reduce((n, l) => n + l.qty, 0));
    }
  });

  it("merges the warehouses when the Warehouse column is off", () => {
    const split = stockReportFor(db, EVERYTHING, ["unit", "qty", "warehouse"]);
    const merged = stockReportFor(db, EVERYTHING, ["unit", "qty"]);
    expect(merged.byWarehouse).toBe(false);
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0]!.warehouse).toBe("");
    expect(merged.qty).toBe(split.qty);
    // One row per variant, however many warehouses hold it.
    const skus = merged.groups[0]!.lines.map((l) => l.skuId);
    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(skus)).toEqual(new Set(held.map((u) => u.skuId)));
  });

  it("splits by grade only when the Grade column is on", () => {
    const plain = stockReportFor(db, EVERYTHING, ["unit", "qty"]);
    const graded = stockReportFor(db, EVERYTHING, ["unit", "qty", "grade"]);
    expect(plain.groups[0]!.lines.every((l) => l.grade === undefined)).toBe(
      true,
    );
    expect(graded.lineCount).toBeGreaterThanOrEqual(plain.lineCount);
    for (const l of graded.groups[0]!.lines) {
      expect(l.qty).toBe(
        held.filter(
          (u) => u.skuId === l.skuId && (u.grade ?? undefined) === l.grade,
        ).length,
      );
    }
  });

  it("names a row by product and variant, and prices it from its own units", () => {
    const r = stockReport(db, EVERYTHING, { byWarehouse: true, byGrade: true });
    for (const g of r.groups) {
      for (const l of g.lines) {
        const sku = db.skus.find((s) => s.id === l.skuId)!;
        expect(l.unit).toBe(`${sku.name} ${sku.variantLabel}`);
        expect(l.code).toBe(sku.code);
        const units = held.filter(
          (u) =>
            u.skuId === l.skuId &&
            u.locationId === g.locationId &&
            (u.grade ?? undefined) === l.grade,
        );
        // Unit price: what the invoice charged, over every unit held.
        expect(l.unitPrice.min).toBe(Math.min(...units.map((u) => u.buy)));
        expect(l.unitPrice.max).toBe(Math.max(...units.map((u) => u.buy)));
        // Sell price: what the SELLABLE units ask — a unit in QC asks nothing.
        const asks = units.filter(isSellable).map((u) => priceOf(u, sku.price));
        expect(l.sellPrice.count).toBe(asks.length);
        if (asks.length > 0) {
          expect(l.sellPrice.min).toBe(Math.min(...asks));
          expect(l.sellPrice.max).toBe(Math.max(...asks));
        }
      }
    }
  });
});

describe("stockReportSheet — the B2Soft layout", () => {
  const columns = DEFAULT_STOCK_EXPORT_COLUMNS;
  const report = stockReportFor(db, EVERYTHING, columns);
  const sheet = stockReportSheet(report, {
    columns,
    shopName: "NUSANTARA",
    warehouseNames: [],
    now,
  });
  const header = sheet.rows[sheet.freezeRows! - 1]!;

  it("defaults to unit, qty and warehouse — the owner's three", () => {
    expect(DEFAULT_STOCK_EXPORT_COLUMNS).toEqual(["unit", "qty", "warehouse"]);
    const h = STOCK_REPORT_TEXT.heading;
    expect(texts(header)).toEqual([h.unit, h.qty, h.warehouse]);
    expect(header.map(styleOf)).toEqual(["header", "headerNum", "header"]);
  });

  it("opens with the shop, the title, the warehouses, the date and when it was printed", () => {
    const top = sheet.rows.slice(0, 5).map((r) => valueOf(r[0]!));
    expect(top).toEqual([
      "NUSANTARA",
      "PERSEDIAAN BARANG",
      "Dari Gudang: Semua gudang",
      "Sampai Tanggal: 19/09/2026",
      "Dicetak: 19/09/2026 07:05",
    ]);
    // The heading row stays on screen while the stock scrolls under it.
    expect(sheet.freezeRows).toBe(7);
    expect(sheet.rows[5]).toEqual([]);
  });

  it("opens each warehouse with a banded row of its name and total", () => {
    const qtyAt = 1;
    const groupRows = sheet.rows.filter((r) => styleOf(r[0]!) === "group");
    expect(groupRows.map((r) => valueOf(r[0]!))).toEqual(
      report.groups.map((g) => g.warehouse),
    );
    groupRows.forEach((r, i) => {
      expect(valueOf(r[qtyAt]!)).toBe(report.groups[i]!.qty);
      expect(styleOf(r[qtyAt]!)).toBe("groupNum");
      // The band spans the whole row, not just the name.
      expect(r).toHaveLength(header.length);
    });
  });

  it("prints a row per product under its warehouse, and a total at the end", () => {
    const body = sheet.rows.slice(sheet.freezeRows!);
    let at = 0;
    for (const g of report.groups) {
      expect(valueOf(body[at]![0]!)).toBe(g.warehouse);
      at += 1;
      for (const l of g.lines) {
        expect(texts(body[at]!)).toEqual([l.unit, l.qty, g.warehouse]);
        at += 1;
      }
    }
    const total = body[at]!;
    expect(valueOf(total[0]!)).toBe(STOCK_REPORT_TEXT.total);
    expect(valueOf(total[1]!)).toBe(held.length);
    expect(styleOf(total[1]!)).toBe("numBold");
    expect(body).toHaveLength(at + 1);
  });

  it("names the chosen warehouses, and says so when a category or product narrowed it", () => {
    const narrowed = stockReportSheet(report, {
      columns,
      shopName: "NUSANTARA",
      warehouseNames: ["Toko Kelapa Gading", "Gudang Serpong"],
      categoryNames: ["MacBook Air"],
      productNames: ["MacBook Air 13 2017"],
      now,
    });
    const top = narrowed.rows.slice(0, 7).map((r) => valueOf(r[0]!));
    expect(top).toEqual([
      "NUSANTARA",
      "PERSEDIAAN BARANG",
      "Dari Gudang: Toko Kelapa Gading, Gudang Serpong",
      "Kategori: MacBook Air",
      "Produk: MacBook Air 13 2017",
      "Sampai Tanggal: 19/09/2026",
      "Dicetak: 19/09/2026 07:05",
    ]);
  });

  it("leaves the shop line out rather than inventing a name", () => {
    const anonymous = stockReportSheet(report, {
      columns,
      shopName: "  ",
      warehouseNames: [],
      now,
    });
    expect(valueOf(anonymous.rows[0]![0]!)).toBe("PERSEDIAAN BARANG");
    expect(anonymous.freezeRows).toBe(sheet.freezeRows! - 1);
  });

  it("prints the prices as two numeric columns each, lowest and highest", () => {
    const all: StockExportColumn[] = [...STOCK_EXPORT_COLUMNS];
    const r = stockReportFor(db, EVERYTHING, all);
    const s = stockReportSheet(r, { columns: all, warehouseNames: [], now });
    const h = STOCK_REPORT_TEXT.heading;
    const head = s.rows[s.freezeRows! - 1]!;
    expect(texts(head)).toEqual([
      h.sku,
      h.unit,
      h.grade,
      h.qty,
      h.unitPriceMin,
      h.unitPriceMax,
      h.sellPriceMin,
      h.sellPriceMax,
      h.warehouse,
    ]);
    expect(s.columnWidths).toHaveLength(head.length);
    const line = r.groups[0]!.lines[0]!;
    const row = s.rows[s.freezeRows! + 1]!;
    expect(valueOf(row[4]!)).toBe(line.unitPrice.min);
    expect(valueOf(row[5]!)).toBe(line.unitPrice.max);
    expect(styleOf(row[4]!)).toBe("num");
    // A row with nothing sellable has no sell price — empty, not zero.
    const qcOnly = r.groups
      .flatMap((g) => g.lines)
      .find((l) => l.sellPrice.count === 0);
    expect(qcOnly, "the seed should hold a unit in QC").toBeDefined();
    const qcRow = s.rows.find(
      (x) => valueOf(x[1]!) === qcOnly!.unit && valueOf(x[0]!) === qcOnly!.code,
    )!;
    expect(valueOf(qcRow[6]!)).toBeUndefined();
  });

  it("keeps Unit even when it is left out — a row is a product", () => {
    const r = stockReportFor(db, EVERYTHING, ["qty"]);
    const s = stockReportSheet(r, {
      columns: ["qty"],
      warehouseNames: [],
      now,
    });
    expect(texts(s.rows[s.freezeRows! - 1]!)).toEqual([
      STOCK_REPORT_TEXT.heading.unit,
      STOCK_REPORT_TEXT.heading.qty,
    ]);
    // Merged across warehouses: no bands.
    expect(s.rows.some((x) => styleOf(x[0]!) === "group")).toBe(false);
  });

  it("says so when nothing matches, and prints no total", () => {
    const empty = stockReportFor(
      db,
      { ...EVERYTHING, categories: ["No such category"] },
      columns,
    );
    const s = stockReportSheet(empty, { columns, warehouseNames: [], now });
    const body = s.rows.slice(s.freezeRows!);
    expect(body).toHaveLength(1);
    expect(valueOf(body[0]![0]!)).toBe(STOCK_REPORT_TEXT.empty);
  });

  it("only points at styles the writer defines, and is well-formed XML", () => {
    for (const row of sheet.rows) {
      for (const c of row) {
        const s = styleOf(c);
        if (s !== undefined) expect(XLSX_STYLES).toContain(s);
      }
    }
    const doc = new DOMParser().parseFromString(
      worksheetXml(sheet),
      "application/xml",
    );
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });
});

describe("dates", () => {
  it("writes the shop's own day, not UTC's", () => {
    // Seven in the morning in Jakarta is midnight in UTC — still yesterday.
    expect(stockExportFileName(now)).toBe("Persediaan-Barang-2026-09-19.xlsx");
    expect(fmtReportDate(new Date(2026, 0, 5))).toBe("05/01/2026");
    expect(fmtReportDateTime(new Date(2026, 0, 5, 9, 3))).toBe(
      "05/01/2026 09:03",
    );
  });
});
