/**
 * Reading a bank's e-statement (owner ask 2026-10-27): BCA's PDF layout by
 * position, KlikBCA's CSV, and the add-up check that refuses a statement read
 * wrong. Every statement here is synthetic — the real one holds customers'
 * names and is never committed (test/fixtures/syntheticBca.ts).
 */
import { describe, expect, it } from "vitest";
import {
  checkStatement,
  parseBcaCsv,
  parseBcaPages,
  rupiahOf,
  senOf,
  senPartOf,
  statementTotals,
  StatementReadError,
  type ParsedStatement,
  type PdfPage,
} from "../src/lib/bankStatement.js";
import { bcaItems, januaryStatement } from "./fixtures/syntheticBca.js";

describe("senOf", () => {
  it("reads every way a figure is printed, exactly, in sen", () => {
    expect(senOf("18,450,000.00")).toBe(1_845_000_000);
    expect(senOf("18450000.00")).toBe(1_845_000_000);
    expect(senOf("902.47")).toBe(90_247);
    expect(senOf("4,512.37")).toBe(451_237);
    expect(senOf("1.234,56")).toBe(123_456);
    expect(senOf("18.450.000")).toBe(1_845_000_000);
    expect(senOf("=150000000.55")).toBe(15_000_000_055);
    expect(senOf("1,234,567,890.12")).toBe(123_456_789_012);
    expect(senOf("-1.5")).toBe(-150);
    expect(senOf("0.07")).toBe(7);
  });

  it("refuses what is not a figure", () => {
    expect(senOf("")).toBeUndefined();
    expect(senOf("DB")).toBeUndefined();
    expect(senOf("3108/ABCDE/ZZ00001")).toBeUndefined();
    expect(senOf("12,34,567")).toBeUndefined();
    expect(senOf("1.2.3")).toBeUndefined();
  });
});

describe("rupiahOf", () => {
  it("is the rupiah as printed, truncated toward zero", () => {
    expect(rupiahOf(451_237)).toBe(4_512);
    expect(rupiahOf(-90_247)).toBe(-902);
    expect(rupiahOf(-100)).toBe(-1);
    expect(rupiahOf(99)).toBe(0);
    expect(rupiahOf(0)).toBe(0);
    expect(senPartOf(451_237)).toBe(37);
    expect(senPartOf(-90_247)).toBe(-47);
  });
});

describe("parseBcaPages", () => {
  it("reads a two-page statement by position, and it adds up", () => {
    const s = parseBcaPages(bcaItems(januaryStatement()));
    expect(s.source).toBe("PDF");
    expect(s.periodStart).toBe("2027-01-01");
    expect(s.periodEnd).toBe("2027-01-31");
    expect(s.openingSen).toBe(1_000_000_050);
    expect(s.creditCount).toBe(4);
    expect(s.debitCount).toBe(2);
    expect(checkStatement(s)).toEqual([]);
    expect(
      s.lines.map((l) => [l.lineNo, l.date, l.amountSen, l.balanceSen]),
    ).toEqual([
      // The 31/12 posting on a January statement is LAST year's.
      [1, "2026-12-31", 1_845_000_000, undefined],
      [2, "2027-01-02", -400_000_000, undefined],
      [3, "2027-01-02", 90_000_000, 2_535_000_050],
      [4, "2027-01-15", 860_000_000, undefined],
      [5, "2027-01-31", 451_237, undefined],
      [6, "2027-01-31", -90_247, 3_395_361_040],
    ]);
  });

  it("joins every line of a description, and never takes its numbers for the amount", () => {
    const s = parseBcaPages(bcaItems(januaryStatement()));
    expect(s.lines[0]!.description).toBe(
      "TRSF E-BANKING CR 3112/ABCDE/ZZ00001 TANGGAL :31/12 18450000.00 BUDI SANTOSO",
    );
    expect(s.lines[3]!.description).toBe(
      "KR OTOMATIS SHOPEE PAYOUT 260115ABCDEF",
    );
    // Nothing from the notice above the table, the footer or the summary.
    expect(
      s.lines.some((l) => /Bersambung|CATATAN|SALDO/.test(l.description)),
    ).toBe(false);
  });

  it("reads a debit whose DB arrives in the same text run as the amount", () => {
    const s = parseBcaPages(bcaItems(januaryStatement({ mergeMarker: true })));
    expect(s.lines[1]!.amountSen).toBe(-400_000_000);
    expect(checkStatement(s)).toEqual([]);
  });

  it("takes the closing from the last balance when there is no summary", () => {
    const st = januaryStatement();
    const s = parseBcaPages(bcaItems({ ...st, summary: undefined }));
    expect(s.closingSen).toBe(3_395_361_040);
    expect(s.creditSen).toBeUndefined();
    expect(checkStatement(s)).toEqual([]);
  });

  it("refuses what it cannot read whole", () => {
    const code = (pages: PdfPage[]) => {
      try {
        parseBcaPages(pages);
      } catch (e) {
        return (e as StatementReadError).code;
      }
      return "read";
    };
    expect(code([[{ str: "Hello", x: 10, y: 10, width: 20 }]])).toBe(
      "NOT_A_STATEMENT",
    );
    const noPeriod = bcaItems(januaryStatement()).map((p) =>
      p.filter((i) => !/PERIODE|JANUARI/.test(i.str)),
    );
    expect(code(noPeriod)).toBe("NO_PERIOD");
    // A row with no amount that is not the opening balance.
    const st = januaryStatement();
    const broken = bcaItems({
      ...st,
      pages: [[...st.pages[0]!, { date: "03/01", left: ["BIAYA ADM"] }]],
    });
    expect(code(broken)).toBe("UNREADABLE_LINE");
  });
});

const CSV_COMMA = [
  "No. rekening : 0001234567",
  "Nama : TOKO CONTOH",
  "Periode : 01/01/2027 - 31/01/2027",
  "Kode Mata Uang : Rp",
  "",
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
  `'31/12,"TRSF E-BANKING CR 3112/ABCDE/ZZ00001 18450000.00 BUDI ""BS"" SANTOSO",'0000,18450000.00,CR,18451000.50`,
  `'02/01/2027,"TRSF E-BANKING DB 0201 SUPPLIER CONTOH",'0000,4000000.00,DB,14451000.50`,
  `'PEND,"TRSF E-BANKING CR BELUM MASUK",'0000,1.00,CR,0.00`,
  `'31/01,"BUNGA",'0000,4512.37,CR,14455512.87`,
  "",
  "Saldo Awal,=1000.50",
  "Mutasi Kredit,=18454512.37,2",
  "Mutasi Debet,=4000000.00,1",
  "Saldo Akhir,=14455512.87",
].join("\r\n");

describe("parseBcaCsv", () => {
  it("reads KlikBCA's download: quotes, apostrophes, a pending row skipped", () => {
    const s = parseBcaCsv(CSV_COMMA);
    expect(s.source).toBe("CSV");
    expect(s.periodStart).toBe("2027-01-01");
    expect(s.periodEnd).toBe("2027-01-31");
    expect(s.lines.map((l) => [l.date, l.amountSen])).toEqual([
      ["2026-12-31", 1_845_000_000],
      ["2027-01-02", -400_000_000],
      ["2027-01-31", 451_237],
    ]);
    expect(s.lines[0]!.description).toContain('BUDI "BS" SANTOSO');
    expect(s.openingSen).toBe(100_050);
    expect(s.creditCount).toBe(2);
    expect(checkStatement(s)).toEqual([]);
  });

  it("reads semicolons and a CR/DB after the figure, and derives the balances when there is no footer", () => {
    const csv = [
      "Periode : 01/01/2027 - 31/01/2027",
      "Tanggal;Keterangan;Cabang;Jumlah;Saldo",
      "'05/01;SETORAN VIA CDM;'0123;500.000,00 CR;1.500.000,00",
      "'06/01;BIAYA ADM;'0000;10.000,00 DB;1.490.000,00",
    ].join("\n");
    const s = parseBcaCsv(csv);
    expect(s.openingSen).toBe(100_000_000);
    expect(s.closingSen).toBe(149_000_000);
    expect(s.lines.map((l) => l.amountSen)).toEqual([50_000_000, -1_000_000]);
    expect(checkStatement(s)).toEqual([]);
  });

  it("refuses a file it cannot check", () => {
    expect(() => parseBcaCsv("hello,world")).toThrow(StatementReadError);
    expect(() =>
      parseBcaCsv(
        "Periode : 01/01/2027 - 31/01/2027\nTanggal,Keterangan,Cabang,Jumlah,,Saldo\n'05/01,X,'0,5.00,CR,",
      ),
    ).toThrow(/no balances/);
    expect(() =>
      parseBcaCsv(
        "Periode : 01/01/2027 - 31/01/2027\nTanggal,Keterangan,Cabang,Jumlah,,Saldo\nrubbish,X,'0,5.00,CR,1.00",
      ),
    ).toThrow(StatementReadError);
  });
});

describe("checkStatement", () => {
  const good = (): ParsedStatement => ({
    source: "CSV",
    periodStart: "2027-01-01",
    periodEnd: "2027-01-31",
    openingSen: 1_000,
    closingSen: 1_250,
    creditSen: 500,
    debitSen: 250,
    creditCount: 1,
    debitCount: 1,
    lines: [
      {
        lineNo: 1,
        date: "2027-01-02",
        description: "A",
        amountSen: 500,
        balanceSen: 1_500,
      },
      { lineNo: 2, date: "2027-01-03", description: "B", amountSen: -250 },
    ],
  });

  it("is empty when the statement adds up", () => {
    expect(checkStatement(good())).toEqual([]);
    expect(statementTotals(good().lines)).toEqual({
      creditSen: 500,
      debitSen: 250,
      creditCount: 1,
      debitCount: 1,
    });
  });

  it("names each thing that does not", () => {
    expect(checkStatement({ ...good(), lines: [] })).toEqual([
      { code: "NO_LINES" },
    ]);
    expect(checkStatement({ ...good(), closingSen: 1_251 })).toEqual([
      { code: "DOES_NOT_ADD_UP", computedSen: 1_250, closingSen: 1_251 },
    ]);
    expect(
      checkStatement({ ...good(), creditSen: 501, debitSen: 249 }),
    ).toEqual([
      { code: "CREDIT_TOTAL", statedSen: 501, summedSen: 500 },
      { code: "DEBIT_TOTAL", statedSen: 249, summedSen: 250 },
    ]);
    expect(
      checkStatement({ ...good(), creditCount: 2, debitCount: 0 }),
    ).toEqual([
      { code: "CREDIT_COUNT", stated: 2, counted: 1 },
      { code: "DEBIT_COUNT", stated: 0, counted: 1 },
    ]);
    const s = good();
    expect(
      checkStatement({
        ...s,
        lines: [{ ...s.lines[0]!, balanceSen: 1_499 }, s.lines[1]!],
      }),
    ).toEqual([
      {
        code: "BALANCE_BREAK",
        lineNo: 1,
        expectedSen: 1_500,
        printedSen: 1_499,
      },
    ]);
  });
});
