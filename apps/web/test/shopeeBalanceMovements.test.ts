/**
 * The Shopee balance's own movements (owner, 2026-11-23): ad top-ups and
 * withdrawals in the seller balance report become an expense paid from the
 * Shopee balance and a Shopee withdrawal — after the base only, and never
 * twice. Rows copied from the owner's report of 1 Oct – 23 Nov 2026.
 */
import { describe, expect, it } from "vitest";
import type { XlsxSheet } from "../src/lib/xlsxRead.js";
import { detectIncomeLayout } from "../src/lib/shopeeIncome.js";
import {
  balanceMovements,
  movementKind,
  movementWrites,
  planMovements,
} from "../src/lib/shopeeBalanceMovements.js";
import {
  marketplacePots,
  potBasesOf,
  sellerPotOfMethod,
} from "../src/lib/marketplacePot.js";
import { accountOfMethod } from "../src/lib/accounts.js";
import { cashflowRows } from "../src/lib/cashflowRows.js";
import { makeT } from "../src/i18n/translate.js";
import { getDb } from "../src/mock/store.js";

const HEADER = [
  "Tanggal Transaksi",
  "Tipe Transaksi",
  "Deskripsi",
  "No. Pesanan",
  "Jenis Transaksi",
  "Jumlah",
  "Status",
  "Saldo Akhir",
];
const ROWS: (string | number)[][] = [
  [
    "2026-11-24 10:05:00",
    "Pembayaran dengan Saldo Penjual",
    "Isi Ulang Saldo Iklan/Koin Penjual",
    "-",
    "Transaksi Keluar",
    -111000,
    "Transaksi Selesai",
    188064685,
  ],
  [
    "2026-11-23 13:54:42",
    "Penghasilan dari Pesanan",
    "Penghasilan dari Pesanan #261117H92YBV9K",
    "261117H92YBV9K",
    "Transaksi Masuk",
    9178236,
    "Transaksi Selesai",
    188175685,
  ],
  [
    "2026-11-23 10:08:08",
    "Pembayaran dengan Saldo Penjual",
    "Isi Ulang Saldo Iklan/Koin Penjual",
    "-",
    "Transaksi Keluar",
    -111000,
    "Transaksi Selesai",
    178997449,
  ],
  [
    "2026-11-13 11:12:27",
    "Penarikan Dana",
    "Penarikan Dana",
    "-",
    "Transaksi Keluar",
    -10261789,
    "Transaksi Selesai",
    65091469,
  ],
  [
    "2026-10-17 00:22:37",
    "Penyesuaian",
    "Penyesuaian saldo dilakukan untuk pesanan 2610084C37AX5A karena terdapat Pengembalian Barang/Dana setelah dana dilepaskan",
    "2610084C37AX5A",
    "Transaksi Keluar",
    -10883925,
    "Transaksi Selesai",
    60143071,
  ],
];
const sheet: XlsxSheet = {
  name: "Sheet1",
  rows: [["Laporan"], [], ["Rincian Transaksi"], HEADER, ...ROWS],
};
const layout = detectIncomeLayout([sheet])!;
/** The base the owner set on 23 Nov: Rp188.175.685 at 13:54:42 WIB. */
const BASE_AT = "2026-11-23T06:54:42.000Z";
const moves = balanceMovements(sheet, layout);

describe("reading the report's balance movements", () => {
  it("finds the ad top-ups and withdrawals, oldest first, and no order row", () => {
    expect(layout).toBeDefined();
    const moves = balanceMovements(sheet, layout);
    expect(moves.map((m) => [m.kind, m.date, m.amount])).toEqual([
      ["WITHDRAWAL", "2026-11-13", 10261789],
      ["AD_TOPUP", "2026-11-23", 111000],
      ["AD_TOPUP", "2026-11-24", 111000],
    ]);
    // Shopee's wall clock is Jakarta's.
    expect(moves[1]!.at).toBe("2026-11-23T03:08:08.000Z");
    expect(moves[1]!.label).toBe("Isi Ulang Saldo Iklan/Koin Penjual");
  });

  it("names the kind from Shopee's words", () => {
    expect(movementKind("Penarikan Dana", "Penarikan Dana")).toBe("WITHDRAWAL");
    expect(
      movementKind(
        "Pembayaran dengan Saldo Penjual",
        "Isi Ulang Saldo Iklan/Koin Penjual",
      ),
    ).toBe("AD_TOPUP");
    expect(
      movementKind("Penyesuaian", "Kompensasi untuk pesanan"),
    ).toBeUndefined();
  });
});

describe("what an upload records", () => {
  it("only what came after the base", () => {
    const plan = planMovements(moves, { expenses: [], incomes: [] }, BASE_AT);
    expect(plan.toRecord.map((m) => m.date)).toEqual(["2026-11-24"]);
    expect(plan.beforeBase).toBe(2);
  });

  it("nothing a second time — per day and amount, two equal top-ups stay two", () => {
    const twice = [...moves, { ...moves[2]! }];
    const first = planMovements(
      twice,
      { expenses: [], incomes: [] },
      undefined,
    );
    expect(first.toRecord).toHaveLength(4);
    const written = movementWrites(
      first.toRecord,
      (p) => `${p}-${Math.random()}`,
    );
    const again = planMovements(twice, written, undefined);
    expect(again.toRecord).toHaveLength(0);
    expect(again.alreadyRecorded).toBe(4);
    // One of the two 24 Nov top-ups recorded by hand: only the other is new.
    const one = planMovements(
      twice,
      { expenses: [written.expenses[1]!], incomes: [] },
      undefined,
    );
    expect(one.toRecord.map((m) => m.kind)).toEqual([
      "WITHDRAWAL",
      "AD_TOPUP",
      "AD_TOPUP",
    ]);
  });

  it("writes a top-up as Marketing paid from the Shopee balance, a withdrawal as a transfer in", () => {
    const { expenses, incomes } = movementWrites(moves, (p) => p);
    expect(expenses[0]).toMatchObject({
      kind: "MARKETING",
      method: "SALDO_SHOPEE",
      amount: 111000,
      date: "2026-11-23",
      createdAt: "2026-11-23T03:08:08.000Z",
    });
    expect(incomes[0]).toMatchObject({
      reason: "PENARIKAN_SHOPEE",
      method: "TRANSFER",
      amount: 10261789,
    });
  });
});

describe("the Shopee balance as a payment method", () => {
  it("is Shopee's pot and neither cash nor bank", () => {
    expect(sellerPotOfMethod("SALDO_SHOPEE")).toBe("SHOPEE");
    expect(accountOfMethod("SALDO_SHOPEE")).toBeUndefined();
    expect(sellerPotOfMethod("TRANSFER")).toBeUndefined();
  });

  it("a top-up after the base comes off the Shopee balance, one before it does not", () => {
    const db = structuredClone(getDb());
    const settings = {
      ...db.settings,
      shopeeBalanceBase: 188_175_685,
      shopeeBalanceBaseAt: BASE_AT,
    };
    const { expenses } = movementWrites(
      moves,
      (p) => `${p}-${p.length}-${Math.random()}`,
    );
    const after = {
      ...db,
      settings,
      // Only Shopee's own rows, so the seed's sales do not move the figure.
      orders: [],
      incomes: [],
      expenses,
    };
    const rows = cashflowRows(after, makeT("en"));
    const shopee = marketplacePots(rows, potBasesOf(settings)).find(
      (p) => p.channel === "SHOPEE",
    )!;
    // 23 Nov 10:08 is inside the base; 24 Nov 10:05 is not.
    expect(shopee.balance).toBe(188_175_685 - 111_000);
  });
});
