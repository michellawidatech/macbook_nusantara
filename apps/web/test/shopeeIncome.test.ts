/**
 * Shopee's income report, matched against the sales the app is waiting on
 * (owner brief 2026-09-19). See `lib/shopeeIncome.ts`.
 *
 * There is no sample income report, so those workbooks are built by
 * `xlsxFixture.ts` in the shape the brief describes — summary rows, then a
 * table headed "No. Pesanan" / "Total Penghasilan". The seller balance report
 * is a real file the owner supplied on 2026-09-21, and
 * `shopeeBalanceFixture.ts` copies its shape. Both are read back through
 * `lib/xlsxRead.ts`, the same path an upload takes.
 */
import { describe, expect, it } from "vitest";
import {
  balanceLeftovers,
  columnOptions,
  detectIncomeLayout,
  expectedPayout,
  guessColumns,
  incomeDrafts,
  incomeLines,
  normaliseOrderNo,
  parseAmount,
  payoutRows,
  reconcileIncome,
  recordable,
  releasedText,
  type IncomeLine,
} from "../src/lib/shopeeIncome.js";
import { settlementTotals } from "../src/lib/marketplace.js";
import {
  EXTRA_PAYMENT_LABEL,
  OTHER_FEES_LABEL,
  type ShopeeSaleFacts,
} from "../src/lib/shopeeFees.js";
import { readXlsx } from "../src/lib/xlsxRead.js";
import { workbook, type FixtureCell } from "./xlsxFixture.js";
import {
  BALANCE_HEADER,
  DONE,
  IN,
  INCOME,
  OUT,
  REAL_ROWS,
  TOP_UP,
  balanceReport,
  num,
} from "./shopeeBalanceFixture.js";

/** A report in the shape the brief describes: summary rows, then the table. */
function shopeeReport(table: readonly (readonly FixtureCell[])[]): Uint8Array {
  return workbook([
    {
      name: "Ringkasan",
      rows: [["Laporan Penghasilan"], ["Total Penghasilan", 9_999_999]],
    },
    {
      name: "Penghasilan",
      rows: [
        ["Laporan Penghasilan"],
        ["Username", "macbooknusantara"],
        ["Periode", "01/09/2026 - 18/09/2026"],
        [],
        [
          "No.",
          "No. Pesanan",
          "No. Pengajuan",
          "Tanggal Dana Dilepaskan",
          "Harga Asli Produk",
          "Biaya Administrasi",
          "Total Penghasilan",
        ],
        ...table,
      ],
    },
  ]);
}

describe("finding the table", () => {
  it("finds the header under the summary rows, on the sheet that has it", async () => {
    const sheets = await readXlsx(
      shopeeReport([
        [1, "2409153VKQ8NH5", null, 46_283, 10_000_000, 900_000, 8_850_000],
      ]),
    );
    expect(detectIncomeLayout(sheets)).toEqual({
      sheet: 1,
      headerRow: 4,
      order: 1,
      payout: 6,
      released: 3,
      // Recognised by name (2026-09-21), which is what tells an income report
      // from every other Shopee export: the order export has 49 columns and
      // not one fee among them.
      fees: [{ column: 5, label: "Biaya Administrasi" }],
      sure: true,
      orderExport: false,
    });
  });

  it("refuses the ORDER export, which carries no payout at all", () => {
    /*
     * `Order.completed.*.xlsx` (Pesanan → Export) has 49 columns and not one
     * fee. Its only seller-facing money column is `Total Pembayaran`, the
     * BUYER's bill — out by −46.750 on one sampled order and +425.572 on
     * another, so no correction factor rescues it. Before this it detected as
     * `sure: false`, which showed the column pickers, and a person could
     * hand-pick that column and import 27 rows of confident nonsense.
     */
    const guess = guessColumns([
      "No. Pesanan",
      "Status Pesanan",
      "Total Pembayaran",
      "No Resi",
      "Returned quantity",
    ]);
    expect(guess.orderExport).toBe(true);
    expect(guess.sure).toBe(false);
    expect(guess.payout).toBeUndefined();
  });

  it("reads the English export's headings too", () => {
    expect(
      guessColumns(["Order ID", "Buyer", "Payout Date", "Escrow Amount"]),
    ).toMatchObject({ order: 0, payout: 3, released: 2, sure: true });
  });

  it("never takes the row counter, a return number or a date for the columns", () => {
    const g = guessColumns([
      "No.",
      "No. Pengajuan",
      "Tanggal Dana Dilepaskan",
      "No. Pesanan",
      "Total Penghasilan",
    ]);
    expect(g.order).toBe(3);
    expect(g.payout).toBe(4);
    expect(g.released).toBe(2);
  });

  it("is unsure when two headings could each be the payout", () => {
    const g = guessColumns([
      "No. Pesanan",
      "Penghasilan Kotor",
      "Penghasilan Bersih",
    ]);
    expect(g.order).toBe(0);
    expect(g.sure).toBe(false);
  });

  it("offers the wordiest row, unsure, when nothing names an order number", async () => {
    const sheets = await readXlsx(
      workbook([
        {
          name: "Data",
          rows: [
            ["Export"],
            ["Pesanan", "Pembeli", "Uang masuk"],
            ["A1B2C3D4", "x", 1],
          ],
        },
      ]),
    );
    const layout = detectIncomeLayout(sheets)!;
    expect(layout).toEqual({ sheet: 0, headerRow: 1, sure: false });
    // …and the pickers are built from that row, a column per heading.
    expect(columnOptions(sheets[0]!, layout.headerRow)).toEqual([
      { index: 0, letter: "A", header: "Pesanan" },
      { index: 1, letter: "B", header: "Pembeli" },
      { index: 2, letter: "C", header: "Uang masuk" },
    ]);
  });

  it("offers a column with data and no heading, by its letter", () => {
    const options = columnOptions(
      { name: "S", rows: [["No. Pesanan"], ["X1234", 5_000]] },
      0,
    );
    expect(options[1]).toEqual({ index: 1, letter: "B" });
  });
});

describe("parseAmount", () => {
  it("reads a number cell as whole rupiah", () => {
    expect(parseAmount(8_850_000)).toBe(8_850_000);
    expect(parseAmount(1234.5)).toBe(1235);
  });

  it("reads Indonesian text — the dot is thousands", () => {
    expect(parseAmount("1.500")).toBe(1_500);
    expect(parseAmount("Rp 8.850.000")).toBe(8_850_000);
    expect(parseAmount("Rp8.850.000,-")).toBe(8_850_000);
    expect(parseAmount("8.850.000,50")).toBe(8_850_001);
    expect(parseAmount("12500,4")).toBe(12_500);
  });

  it("reads English text by its last separator", () => {
    expect(parseAmount("8,850,000")).toBe(8_850_000);
    expect(parseAmount("8,850,000.00")).toBe(8_850_000);
    expect(parseAmount("1,500")).toBe(1_500);
  });

  it("reads a negative, whichever way it is written", () => {
    expect(parseAmount("-12.500")).toBe(-12_500);
    expect(parseAmount("Rp -12.500")).toBe(-12_500);
    expect(parseAmount("(12.500)")).toBe(-12_500);
  });

  it("refuses what it would have to guess at", () => {
    expect(parseAmount("12.34,56")).toBeUndefined();
    expect(parseAmount("1.2345")).toBeUndefined();
    expect(parseAmount("1.23.456")).toBeUndefined();
    expect(parseAmount("#N/A")).toBeUndefined();
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount(null)).toBeUndefined();
    expect(parseAmount(true)).toBeUndefined();
  });
});

describe("the report's orders", () => {
  it("normalises an order number the same way on both sides", () => {
    expect(normaliseOrderNo(" 2409153vkq8nh5 ")).toBe("2409153VKQ8NH5");
    // A long all-digit number cell, written out in full rather than 2.4e+14.
    expect(normaliseOrderNo(240_915_123_456_789)).toBe("240915123456789");
    expect(normaliseOrderNo(null)).toBe("");
  });

  it("reads one line per order, adding up an order's rows", async () => {
    const sheets = await readXlsx(
      shopeeReport([
        [1, "2409153VKQ8NH5", null, 46_283, 10_000_000, 900_000, 8_850_000],
        [
          2,
          "240916ABCD1234",
          null,
          "18/09/2026",
          2_000_000,
          180_000,
          "1.790.000",
        ],
        // An adjustment on the first order, on a row of its own.
        [3, "2409153VKQ8NH5", null, null, 0, 0, -50_000],
        [4, "240917ZZZZ0000", null, null, 1_000_000, 0, "unreadable"],
        // The notes and totals under a table are not orders.
        [null, "TOTAL", null, null, null, null, 10_590_000],
        [null, "Catatan: dana dilepaskan ke Saldo Penjual"],
      ]),
    );
    const layout = detectIncomeLayout(sheets)!;
    const lines = incomeLines(sheets[layout.sheet]!, layout);
    expect(lines).toEqual([
      {
        orderNo: "2409153VKQ8NH5",
        payout: 8_800_000,
        released: "2026-09-18",
        // The adjustment row's zero fee is left out rather than added: a zero
        // line in a deductions table is noise.
        fees: [{ label: "Biaya Administrasi", amount: 900_000 }],
        rows: [6, 8],
      },
      {
        orderNo: "240916ABCD1234",
        payout: 1_790_000,
        released: "18/09/2026",
        fees: [{ label: "Biaya Administrasi", amount: 180_000 }],
        rows: [7],
      },
      { orderNo: "240917ZZZZ0000", payout: undefined, rows: [9] },
    ]);
    expect(recordable(lines[0]!)).toBe(true);
    expect(recordable(lines[2]!)).toBe(false);
  });

  it("turns an Excel date serial into a day and leaves text as written", () => {
    expect(releasedText(46_283)).toBe("2026-09-18");
    expect(releasedText("18/09/2026 14:02")).toBe("18/09/2026 14:02");
    expect(releasedText(8_850_000)).toBeUndefined();
  });
});

describe("reconcileIncome", () => {
  const line = (orderNo: string, payout: number | undefined): IncomeLine => ({
    orderNo,
    payout,
    rows: [1],
  });
  interface Pend {
    readonly code: string;
    readonly ref?: string;
  }
  const pending: Pend[] = [
    { code: "SI-1", ref: "2409153vkq8nh5" },
    { code: "SI-2", ref: "DUP-0001" },
    { code: "SI-3", ref: "DUP-0001" },
    { code: "SI-4", ref: "2409180000AAAA" },
    { code: "SI-5" },
  ];

  it("sorts every report order and every pending sale into one place", () => {
    const r = reconcileIncome(
      [
        line("2409153VKQ8NH5", 8_850_000),
        line("DUP-0001", 1_000),
        line("2409010000OLD1", 500_000),
        line("2409019999NEW1", 700_000),
      ],
      pending,
      (p) => p.ref,
      ["2409010000old1"],
    );
    expect(r.matched.map((m) => [m.line.orderNo, m.pending.code])).toEqual([
      ["2409153VKQ8NH5", "SI-1"],
    ]);
    // Two pending sales carry one number: a person decides, not the import.
    expect(r.ambiguous.map((l) => l.orderNo)).toEqual(["DUP-0001"]);
    // Uploading last week's report again says so, and settles nothing twice.
    expect(r.alreadySettled.map((l) => l.orderNo)).toEqual(["2409010000OLD1"]);
    expect(r.unknown.map((l) => l.orderNo)).toEqual(["2409019999NEW1"]);
    // Waiting, and not in this report — including a sale with no number.
    expect(r.missing.map((p) => p.code)).toEqual(["SI-4", "SI-5"]);
  });
});

describe("incomeDrafts", () => {
  it("records the report's payout as what landed, one settlement per payment", () => {
    let n = 0;
    const [agrees, short] = incomeDrafts(
      [
        {
          paymentId: "p1",
          orderId: "o1",
          gross: 10_000_000,
          payout: expectedPayout(10_000_000, { SHOPEE: 10 }),
        },
        { paymentId: "p2", orderId: "o2", gross: 2_000_000, payout: 1_790_000 },
      ],
      { SHOPEE: 10 },
      "Marketplace fee adjustment",
      () => `fee-${++n}`,
    );
    // The commission rule is the fee line, as in the dialog…
    expect(agrees!.fees).toEqual([
      { id: "fee-1", kind: "COMMISSION", label: "10%", amount: 1_000_000 },
    ]);
    expect(agrees!.received).toBe(9_000_000);
    expect(agrees!.reason).toBeUndefined();
    // …and where the report disagrees with it, the difference carries a reason.
    expect(short!.received).toBe(1_790_000);
    expect(
      settlementTotals({
        gross: 2_000_000,
        fees: short!.fees,
        received: 1_790_000,
      }).discrepancy,
    ).toBe(-10_000);
    expect(short!.reason).toBe("Marketplace fee adjustment");
  });
});

describe("the seller balance report", () => {
  it("is recognised by its headings, and Jumlah is the payout", () => {
    expect(guessColumns(BALANCE_HEADER)).toMatchObject({
      order: 3,
      // NOT 7: "Saldo Akhir" is the running balance, and read as a payout it
      // would record Rp42.875.796 for a Rp5.240.002 order.
      payout: 5,
      released: 0,
      sure: true,
      orderExport: false,
      balance: { type: 1, description: 2, direction: 4, status: 6 },
    });
  });

  it("never reads Jumlah as money in the ORDER export, where it is a quantity", () => {
    const guess = guessColumns([
      "No. Pesanan",
      "Status Pesanan",
      "Nama Produk",
      "Jumlah",
      "Subtotal Pesanan",
      "Total Pembayaran",
    ]);
    expect(guess.payout).toBeUndefined();
    expect(guess.balance).toBeUndefined();
    expect(guess.orderExport).toBe(true);
  });

  it("finds the table under the title block and the summary", async () => {
    const sheets = await readXlsx(balanceReport(REAL_ROWS));
    expect(detectIncomeLayout(sheets)).toMatchObject({
      sheet: 0,
      headerRow: 17,
      order: 3,
      payout: 5,
    });
  });

  it("reads each order's payout, adding up a compensation beside it", async () => {
    const sheets = await readXlsx(balanceReport(REAL_ROWS));
    const layout = detectIncomeLayout(sheets)!;
    const lines = incomeLines(sheets[0]!, layout);
    expect(lines).toEqual([
      {
        orderNo: "2609166BNSSUEK",
        payout: 5_240_002,
        released: "2026-09-21 11:29:57",
        parts: [{ label: INCOME, amount: 5_240_002, payout: true }],
        rows: [19],
      },
      {
        // A return the courier compensated: the order itself paid −53.625 and the
        // courier's compensation paid 10.000.000. What it netted is the sum.
        orderNo: "260912RGK2YKYU",
        payout: 9_946_375,
        released: "2026-09-17 21:01:11",
        parts: [
          { label: "Kompensasi Jasa Kirim", amount: 10_000_000, payout: false },
          { label: INCOME, amount: -53_625, payout: true },
        ],
        rows: [21, 22],
      },
      {
        orderNo: "260825AEUJMHND",
        payout: 4_894_000,
        released: "2026-09-06 16:13:57",
        parts: [{ label: INCOME, amount: 4_894_000, payout: true }],
        rows: [25],
      },
    ]);
  });

  it("says what else the balance held, and records none of it", async () => {
    const sheets = await readXlsx(
      balanceReport([
        ...REAL_ROWS,
        // Money still moving is not money received.
        [
          "2026-09-21 12:00:00",
          INCOME,
          `${INCOME} #260920ABCDEFGH`,
          "260920ABCDEFGH",
          IN,
          num("3000000.00"),
          "Sedang Diproses",
          num("45875796.00"),
        ],
      ]),
    );
    const layout = detectIncomeLayout(sheets)!;
    expect(incomeLines(sheets[0]!, layout).map((l) => l.orderNo)).not.toContain(
      "260920ABCDEFGH",
    );
    expect(balanceLeftovers(sheets[0]!, layout)).toEqual({
      other: [
        { label: TOP_UP, count: 2, amount: -222_000 },
        { label: "Penarikan Dana", count: 1, amount: -68_323_696 },
      ],
      notDone: 1,
    });
  });

  it("takes an outgoing row's sign from its direction when the amount has none", async () => {
    const sheets = await readXlsx(
      balanceReport([
        [
          "2026-09-17 20:45:13",
          INCOME,
          `${INCOME} #260912RGK2YKYU`,
          "260912RGK2YKYU",
          OUT,
          num("53625.00"),
          DONE,
          num("5518144.00"),
        ],
      ]),
    );
    const layout = detectIncomeLayout(sheets)!;
    expect(incomeLines(sheets[0]!, layout)[0]?.payout).toBe(-53_625);
  });
});

describe("payoutRows", () => {
  interface Pend {
    readonly code: string;
    readonly gross: number;
  }
  const facts = (p: Pend): ShopeeSaleFacts => ({
    gross: p.gross,
    qty: 1,
    category: "LAPTOP",
  });
  const plain = (orderNo: string, payout: number): IncomeLine => ({
    orderNo,
    payout,
    parts: [{ label: INCOME, amount: payout, payout: true }],
    rows: [1],
  });
  const rows = (
    matched: { line: IncomeLine; pending: Pend }[],
    payoutColumn: number | undefined = 5,
  ) =>
    payoutRows(
      matched,
      payoutColumn === undefined ? {} : { payout: payoutColumn },
      (p) => p.gross,
      facts,
    );

  it("breaks a stated payout down by the rates and names the rest Biaya Lainnya", () => {
    // 2609153FVWW6NY: a Rp5.300.000 sale that paid 4.796.900. The rates
    // explain 392.500 of the 503.100 Shopee kept; the 110.600 left is an
    // affiliate's commission no export can see.
    const [row] = rows([
      {
        line: plain("2609153FVWW6NY", 4_796_900),
        pending: { code: "SI-1", gross: 5_300_000 },
      },
    ]);
    expect(row).toMatchObject({
      status: "STATED",
      received: 4_796_900,
      recordable: true,
      preselect: true,
      review: [],
    });
    expect(row!.fees.map((f) => [f.label, f.amount])).toEqual([
      ["Biaya Administrasi", 278_250],
      ["Biaya Proses Pesanan", 1_250],
      ["Biaya Gratis Ongkir XTRA", 26_500],
      ["Biaya Promo XTRA", 60_000],
      ["Premi", 26_500],
      [OTHER_FEES_LABEL, 110_600],
    ]);
    // The lines close on Shopee's figure, which is what the deductions dialog
    // computes what landed from.
    expect(
      settlementTotals({
        gross: 5_300_000,
        fees: row!.fees.map((f, i) => ({ id: `${i}`, ...f })),
      }).expected,
    ).toBe(4_796_900);
  });

  it("leaves an order with a compensation beside its payout for a person", () => {
    const [row] = rows([
      {
        line: {
          orderNo: "260912RGK2YKYU",
          payout: 9_946_375,
          parts: [
            {
              label: "Kompensasi Jasa Kirim",
              amount: 10_000_000,
              payout: false,
            },
            { label: INCOME, amount: -53_625, payout: true },
          ],
          rows: [21, 22],
        },
        pending: { code: "SI-2", gross: 10_725_000 },
      },
    ]);
    expect(row).toMatchObject({
      status: "STATED",
      recordable: true,
      preselect: false,
      review: [{ kind: "PARTS" }],
    });
  });

  it("writes a payout above the rates as Pembayaran Tambahan, unticked", () => {
    const [row] = rows([
      {
        line: plain("2609990000AAAA", 6_400_000),
        pending: { code: "SI-3", gross: 6_800_000 },
      },
    ]);
    expect(row!.review).toEqual([{ kind: "ABOVE_RATES", amount: 86_250 }]);
    expect(row!.preselect).toBe(false);
    expect(row!.fees.at(-1)).toMatchObject({
      label: EXTRA_PAYMENT_LABEL,
      amount: -86_250,
    });
  });

  it("never records an order Shopee paid nothing for, or one it could not read", () => {
    const [refund, unreadable] = rows([
      {
        line: plain("260912RGK2YKYU", -53_625),
        pending: { code: "SI-4", gross: 10_725_000 },
      },
      {
        line: { orderNo: "2609990000BBBB", payout: undefined, rows: [30] },
        pending: { code: "SI-5", gross: 6_800_000 },
      },
    ]);
    expect(refund).toMatchObject({
      status: "NOTHING_PAID",
      recordable: false,
      preselect: false,
    });
    // The file HAS a payout column, so a blank cell is a question — not a
    // cue to estimate one.
    expect(unreadable).toMatchObject({
      status: "UNREADABLE",
      recordable: false,
    });
  });

  it("estimates only when the file carries no payout at all", () => {
    let asked: boolean | undefined;
    const [row] = payoutRows(
      [
        {
          line: { orderNo: "2609166VUDCU4M", payout: undefined, rows: [2] },
          pending: { code: "SI-6", gross: 6_800_000 },
        },
      ],
      {},
      (p) => p.gross,
      (p, estimating) => {
        asked = estimating;
        return facts(p);
      },
    );
    expect(asked).toBe(true);
    expect(row).toMatchObject({
      status: "ESTIMATED",
      received: 6_313_750,
      preselect: true,
    });
  });

  it("keeps the conditional switches off a payout Shopee stated", () => {
    // They would only cut the Biaya Lainnya remainder into a guess.
    let asked: boolean | undefined;
    payoutRows(
      [
        {
          line: plain("2609166VUDCU4M", 6_313_750),
          pending: { code: "SI-7", gross: 6_800_000 },
        },
      ],
      { payout: 5 },
      (p) => p.gross,
      (p, estimating) => {
        asked = estimating;
        return facts(p);
      },
    );
    expect(asked).toBe(false);
  });
});
