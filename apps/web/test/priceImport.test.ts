/**
 * Sell prices from the owner's Harga IG list (2026-10-21). The sheet is the
 * app's own Export stock with a price column; see `lib/priceImport.ts`.
 */
import { describe, expect, it } from "vitest";
import type { MockDb, Sku, Unit, Warehouse } from "../src/mock/seed";
import { planPriceImport, readPriceSheet } from "../src/lib/priceImport";

// The shape of `Harga IG (2).xlsx`, sheet "Persediaan", trimmed.
const SHEET = [
  ["PERSEDIAAN BARANG", null, null, null, null, null],
  ["Dari Gudang: Semua gudang"],
  ["Sampai Tanggal: 21/10/2026"],
  ["Dicetak: 21/10/2026 12:34"],
  ["Unit", "Qty", "Gudang", "Harga IG (Rp)", "Umur story", "Keterangan"],
  ["02 · Kemang Sales", 3, null, null, null, null],
  [
    'MacBook Air 13" 2020 i3 · 8GB · 256GB',
    2,
    "02 · Kemang Sales",
    6200000,
    "9w",
    null,
  ],
  [
    'MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB',
    1,
    "02 · Kemang Sales",
    5750000,
    "15w",
    null,
  ],
  ["03 · Gudang Penjualan", 4, null, null, null, null],
  [
    'MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB',
    2,
    "03 · Gudang Penjualan",
    5200000,
    "15w",
    null,
  ],
  [
    'MacBook Air 13" M1 8GB · 256GB',
    1,
    "03 · Gudang Penjualan",
    8800000,
    "10w",
    null,
  ],
  [
    'MacBook Air 13" M5 16GB · 512GB · NEW',
    1,
    "03 · Gudang Penjualan",
    26000000,
    "9w",
    null,
  ],
  [
    'STUDIO DISPLAY 27"',
    4,
    "03 · Gudang Penjualan",
    "Rp 22.000.000",
    "3w",
    null,
  ],
  ["TOTAL", 7, null, null, null, null],
];

const wh = (id: string, code: string, name: string): Warehouse =>
  ({ id, code, name }) as unknown as Warehouse;
const sku = (
  id: string,
  name: string,
  variantLabel: string,
  price = 0,
): Sku => ({
  id,
  modelId: "m",
  code: id,
  name,
  variantLabel,
  price,
});
const unit = (
  serial: string,
  skuId: string,
  locationId: string,
  status: Unit["status"],
  price?: number,
): Unit =>
  ({
    serial,
    skuId,
    locationId,
    status,
    buy: 1,
    description: "",
    poId: "po-1",
    ...(price === undefined ? {} : { price }),
  }) as Unit;

const DB = {
  warehouses: [
    wh("wh-02", "02", "Kemang Sales"),
    wh("wh-03", "03", "Gudang Penjualan"),
  ],
  skus: [
    sku("air20", 'MacBook Air 13" 2020', "i3 · 8GB · 256GB"),
    sku("pro17", 'MacBook Pro 13" 2017', "i5 · 8GB · 256GB · NTB", 5_000_000),
    sku("m1", 'MacBook Air 13" M1', "8GB · 256GB"),
    sku("m5", 'MacBook Air 13" M5', "16GB · 512GB · NEW"),
  ],
  units: [
    unit("A1", "air20", "wh-02", "TERSEDIA"),
    unit("A2", "air20", "wh-02", "DIRESERVASI", 6_000_000),
    unit("P1", "pro17", "wh-02", "TERSEDIA"),
    unit("P2", "pro17", "wh-03", "TERSEDIA", 5_200_000),
    unit("P3", "pro17", "wh-03", "SERVIS"),
    unit("M1", "m1", "wh-03", "QC", 9_000_000),
    unit("M5", "m5", "wh-03", "TERJUAL"),
  ],
} as unknown as MockDb;

describe("readPriceSheet", () => {
  it("reads the priced rows, their warehouse and a price written as text", () => {
    const r = readPriceSheet(SHEET);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0]).toEqual({
      rowNo: 7,
      unit: 'MacBook Air 13" 2020 i3 · 8GB · 256GB',
      warehouse: "02 · Kemang Sales",
      price: 6_200_000,
      qty: 2,
    });
    expect(r.rows.at(-1)!.price).toBe(22_000_000);
  });

  it("refuses the plain export, which has no price", () => {
    expect(
      readPriceSheet([
        ["Unit", "Qty", "Gudang"],
        ["X", 1, "02 · Kemang Sales"],
      ]),
    ).toEqual({ error: "NO_PRICE_COLUMN" });
  });

  it("never takes a cost or an old struck-through price for the sell price", () => {
    const r = readPriceSheet([
      [
        "Unit",
        "Harga Satuan (terendah)",
        "Harga lama/coret (Rp)",
        "Harga Jual (terendah)",
      ],
      ["X", 1000, 2000, 3000],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows[0]!.price).toBe(3000);
  });
});

describe("planPriceImport", () => {
  const sheet = readPriceSheet(SHEET);
  if ("error" in sheet) throw new Error(sheet.error);
  const plan = planPriceImport(DB, sheet.rows);
  const status = (unitText: string, w: string) =>
    plan.rows.find((r) => r.unit === unitText && r.warehouse === w)!;

  it("prices the units past QC in that warehouse, and only those", () => {
    expect(plan.edits).toEqual([
      { serial: "A1", price: 6_200_000 },
      { serial: "A2", price: 6_200_000 },
      { serial: "P1", price: 5_750_000 },
      { serial: "P3", price: 5_200_000 },
    ]);
  });

  it("gives one variant two prices in two warehouses, as the sheet does", () => {
    expect(
      status('MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB', "02 · Kemang Sales")
        .serials,
    ).toEqual(["P1"]);
    // P2 already asks 5.2jt; P3 is at service and still gets the list price.
    expect(
      status(
        'MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB',
        "03 · Gudang Penjualan",
      ).serials,
    ).toEqual(["P3"]);
  });

  it("leaves a unit still in QC alone — inbound decides its price", () => {
    const r = status('MacBook Air 13" M1 8GB · 256GB', "03 · Gudang Penjualan");
    expect(r.status).toBe("ONLY_QC");
    expect(r.inQc).toBe(1);
    expect(plan.edits.some((e) => e.serial === "M1")).toBe(false);
  });

  it("counts what is held there TODAY beside what the list was exported with", () => {
    // The list says 2 Pros at Gudang Penjualan; today P2 and P3 are there.
    const r = status(
      'MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB',
      "03 · Gudang Penjualan",
    );
    expect([r.qty, r.heldNow]).toEqual([2, 2]);
    // The list says 1 M1 there; the one held today is still in QC.
    const m1 = status(
      'MacBook Air 13" M1 8GB · 256GB',
      "03 · Gudang Penjualan",
    );
    expect([m1.qty, m1.heldNow]).toEqual([1, 1]);
    // Stock that arrived since: priced with the rest, and counted.
    const more = planPriceImport(
      {
        ...DB,
        units: [...DB.units, unit("A3", "air20", "wh-02", "TERSEDIA")],
      } as MockDb,
      sheet.rows,
    );
    const air = more.rows.find((x) =>
      x.unit.startsWith('MacBook Air 13" 2020'),
    )!;
    expect([air.qty, air.heldNow, air.serials.length]).toEqual([2, 3, 3]);
  });

  it("says why a row did nothing", () => {
    expect(
      status('MacBook Air 13" M5 16GB · 512GB · NEW', "03 · Gudang Penjualan")
        .status,
    ).toBe("NO_STOCK");
    expect(status('STUDIO DISPLAY 27"', "03 · Gudang Penjualan").status).toBe(
      "NO_PRODUCT",
    );
  });

  it("refuses two rows that price the same units differently", () => {
    const twice = planPriceImport(DB, [
      {
        rowNo: 1,
        unit: 'MacBook Air 13" 2020 i3 · 8GB · 256GB',
        warehouse: "02 · Kemang Sales",
        price: 1,
      },
      {
        rowNo: 2,
        unit: 'MacBook Air 13" 2020 i3 · 8GB · 256GB',
        warehouse: "Kemang Sales",
        price: 2,
      },
    ]);
    expect(twice.rows.map((r) => r.status)).toEqual(["CONFLICT", "CONFLICT"]);
    expect(twice.edits).toEqual([]);
  });
});
