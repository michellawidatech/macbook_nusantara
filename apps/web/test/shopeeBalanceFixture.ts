/**
 * Shopee's SELLER BALANCE report, built for the tests that read it.
 *
 * The owner's file of 2026-09-21 —
 * `my_balance_transaction_report.shopee.20260901_20260921.xlsx`, from Saldo
 * Penjual → Transaksi → Export — in its own shape: the title block, the
 * summary, the table on row 18, amounts as number cells written "5240002.00",
 * and a handful of its real rows. Not a test file: `shopeeIncome.test.ts` and
 * `shopeeImport.test.tsx` both import it.
 */
import { workbook, type FixtureCell } from "./xlsxFixture.js";

export const BALANCE_HEADER = [
  "Tanggal Transaksi",
  "Tipe Transaksi",
  "Deskripsi",
  "No. Pesanan",
  "Jenis Transaksi",
  "Jumlah",
  "Status",
  "Saldo Akhir",
] as const;

/** A number cell exactly as Shopee writes it: "5240002.00". */
export const num = (v: string): FixtureCell => ({
  xml: `<c r="{ref}"><v>${v}</v></c>`,
});

export const DONE = "Transaksi Selesai";
export const IN = "Transaksi Masuk";
export const OUT = "Transaksi Keluar";
export const INCOME = "Penghasilan dari Pesanan";
export const TOP_UP = "Isi Ulang Saldo Iklan/Koin Penjual";

export function balanceReport(
  table: readonly (readonly FixtureCell[])[],
): Uint8Array<ArrayBuffer> {
  return workbook([
    {
      name: "Transaction Report",
      rows: [
        ["Laporan"],
        [],
        [],
        [],
        ["Info Rekening"],
        ["Username (Penjual)", "macbooknusantara"],
        ["Dari", "2026-09-01"],
        ["Ke", "2026-09-21"],
        [
          "** Semua perubahan yang dibuat di laporan yang di-download akan menjadi tanggung jawab Penjual.",
        ],
        [],
        ["Ringkasan", "", "", "", "$", "Mata Uang", "Jumlah Transaksi"],
        ["Total Saldo Masuk", "", "", "", num("161889985.00"), "IDR", 18],
        ["Total Saldo Keluar", "", "", "", num("-146066302.00"), "IDR", 27],
        [],
        [],
        ["Rincian Transaksi"],
        [],
        [...BALANCE_HEADER],
        ...table,
      ],
    },
  ]);
}

/** An order's payout row, as the report writes one. */
export const payoutRow = (
  at: string,
  orderNo: string,
  amount: string,
  balance: string,
): FixtureCell[] => [
  at,
  INCOME,
  `${INCOME} #${orderNo}`,
  orderNo,
  amount.startsWith("-") ? OUT : IN,
  num(amount),
  DONE,
  num(balance),
];

export const REAL_ROWS: readonly (readonly FixtureCell[])[] = [
  payoutRow(
    "2026-09-21 11:29:57",
    "2609166BNSSUEK",
    "5240002.00",
    "42875796.00",
  ),
  [
    "2026-09-21 10:49:54",
    "Pembayaran dengan Saldo Penjual",
    TOP_UP,
    "-",
    OUT,
    num("-111000.00"),
    DONE,
    num("37635794.00"),
  ],
  [
    "2026-09-17 21:01:11",
    "Penyesuaian",
    "Kompensasi Jasa Kirim",
    "260912RGK2YKYU",
    IN,
    num("10000000.00"),
    DONE,
    num("15518144.00"),
  ],
  payoutRow("2026-09-17 20:45:13", "260912RGK2YKYU", "-53625.00", "5518144.00"),
  [
    "2026-09-17 10:27:27",
    "Penarikan Dana",
    "Penarikan Dana",
    "-",
    OUT,
    num("-68323696.00"),
    DONE,
    num("5571769.00"),
  ],
  [
    "2026-09-17 10:25:57",
    "Pembayaran dengan Saldo Penjual",
    TOP_UP,
    "-",
    OUT,
    num("-111000.00"),
    DONE,
    num("73895465.00"),
  ],
  payoutRow(
    "2026-09-06 16:13:57",
    "260825AEUJMHND",
    "4894000.00",
    "15172853.00",
  ),
];
