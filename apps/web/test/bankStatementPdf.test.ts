/**
 * The real pdf.js (its Node build) over a real PDF file — a synthetic BCA
 * statement written by test/fixtures/syntheticBca.ts — so the positions the
 * parser reads are pdf.js's own, not the fixture's guess at them. pdf.js
 * notices it is under Node even inside jsdom and runs its worker in-process.
 */
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pagesOfPdf, type PdfJsLike } from "../src/lib/bankStatementPdf.js";
import { checkStatement, parseBcaPages } from "../src/lib/bankStatement.js";
import { bcaPdf, januaryStatement } from "./fixtures/syntheticBca.js";

describe("a statement PDF, through pdf.js", () => {
  it("reads every line, amount and balance exactly, and adds up", async () => {
    const pages = await pagesOfPdf(
      pdfjs as unknown as PdfJsLike,
      bcaPdf(januaryStatement()),
    );
    expect(pages).toHaveLength(2);
    const s = parseBcaPages(pages);
    expect(checkStatement(s)).toEqual([]);
    expect(s.periodStart).toBe("2027-01-01");
    expect(s.openingSen).toBe(1_000_000_050);
    expect(s.closingSen).toBe(3_395_361_040);
    expect(
      s.lines.map((l) => [l.date, l.amountSen, l.balanceSen ?? null]),
    ).toEqual([
      ["2026-12-31", 1_845_000_000, null],
      ["2027-01-02", -400_000_000, null],
      ["2027-01-02", 90_000_000, 2_535_000_050],
      ["2027-01-15", 860_000_000, null],
      ["2027-01-31", 451_237, null],
      ["2027-01-31", -90_247, 3_395_361_040],
    ]);
    expect(s.lines[1]!.description).toBe(
      "TRSF E-BANKING DB 0201/FGHIJ/ZZ00001 - SUPPLIER CONTOH",
    );
  });

  it("reads a debit printed in one run with its DB", async () => {
    const pages = await pagesOfPdf(
      pdfjs as unknown as PdfJsLike,
      bcaPdf(januaryStatement({ mergeMarker: true })),
    );
    const s = parseBcaPages(pages);
    expect(s.lines[1]!.amountSen).toBe(-400_000_000);
    expect(checkStatement(s)).toEqual([]);
  });
});
