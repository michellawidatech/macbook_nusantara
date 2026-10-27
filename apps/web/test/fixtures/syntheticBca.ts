/**
 * A SYNTHETIC BCA e-statement, laid out the way the real one is (2026-10-27).
 *
 * The real September statement the parser was built against holds customers'
 * names and the shop's money, so it is never committed. This builds a
 * stand-in with the same geometry — the column positions, a description over
 * two sub-columns and several lines, a "DB" printed beside a debit and nothing
 * beside a credit, a running balance on some rows only, the header repeated
 * on every page and handed over AFTER the rows (as pdf.js does), a
 * "Bersambung" footer, and the closing summary — out of invented rows.
 *
 * `bcaItems` gives the positioned text pdf.js would; `bcaPdf` writes the same
 * text into a real (uncompressed, Helvetica) PDF so a test can run pdf.js
 * itself over it.
 */
import type { PdfPage, PdfTextItem } from "../../src/lib/bankStatement.js";

export interface SynRow {
  /** DD/MM as printed. */
  readonly date: string;
  /** The left description sub-column (x≈88.7), one string per printed line. */
  readonly left: readonly string[];
  /** The right sub-column (x≈194.3), one string per printed line. */
  readonly right?: readonly string[];
  /** Absent only on the SALDO AWAL row. Positive sen. */
  readonly amountSen?: number;
  readonly debit?: boolean;
  /** Printed in SALDO when given. */
  readonly balanceSen?: number;
}

export interface SynSummary {
  readonly openingSen: number;
  readonly creditSen: number;
  readonly creditCount: number;
  readonly debitSen: number;
  readonly debitCount: number;
  readonly closingSen: number;
}

export interface SynStatement {
  /** "JANUARI 2027". */
  readonly period: string;
  /** Rows per page. */
  readonly pages: readonly (readonly SynRow[])[];
  readonly summary?: SynSummary;
  /** Print a "DB" in the same text run as its amount ("4,000,000.00 DB"). */
  readonly mergeMarker?: boolean;
}

/** "18,450,000.00" from sen. */
export function fmtSen(sen: number): string {
  const abs = Math.abs(sen);
  const rp = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${sen < 0 ? "-" : ""}${rp}.${String(abs % 100).padStart(2, "0")}`;
}

/** Helvetica's advance widths, roughly — enough to right-align a figure. */
function widthOf(text: string, size: number): number {
  let w = 0;
  for (const c of text) {
    if (/[0-9]/.test(c)) w += 556;
    else if (/[,.:/ ]/.test(c)) w += 278;
    else if (c === "-") w += 333;
    else if (/[A-Z]/.test(c)) w += 667;
    else w += 500;
  }
  return (w * size) / 1000;
}

interface Drawn extends PdfTextItem {
  readonly size: number;
}

const item = (str: string, x: number, y: number, size = 7): Drawn => ({
  str,
  x,
  y,
  width: widthOf(str, size),
  size,
});
const rightAt = (str: string, right: number, y: number): Drawn =>
  item(str, right - widthOf(str, 7), y);

const LINE = 12.1;
const AMOUNT_RIGHT = 436.7;
const BALANCE_RIGHT = 569;

function pageItems(st: SynStatement, p: number): Drawn[] {
  const total = st.pages.length;
  const last = p === total - 1;
  const top: Drawn[] = [
    item("REKENING TAHAPAN", 202.5, 795.8, 17),
    item("TOKO CONTOH SEJAHTERA", 31, 754.4),
    item("JL. CONTOH RAYA NO. 1", 31, 742.3),
    item("NO. REKENING", 324.4, 755.4),
    item(":", 416.8, 755.4),
    item("0001234567", 435.3, 755.4),
    item("HALAMAN", 324.4, 739.3),
    item(":", 416.8, 739.3),
    item("PERIODE", 324.4, 723.2),
    item(":", 416.8, 723.2),
    item(st.period, 435.3, 723.2),
    item("MATA UANG", 324.4, 707.1),
    item(":", 416.8, 707.1),
    item("IDR", 435.3, 707.1),
    item("CATATAN :", 23, 663.9, 6),
    item(
      "Apabila ada transaksi 1,000,000.00 yang tidak sesuai",
      34.4,
      649.5,
      6,
    ),
  ];
  const header: Drawn[] = [
    item("TANGGAL", 33.1, 596.7),
    item("KETERANGAN", 163.9, 596.7),
    item("CBG", 308.0, 596.7),
    item("MUTASI", 380.3, 596.7),
    item("SALDO", 500.5, 596.7),
  ];
  const pageNo: Drawn[] = [
    item(`${p + 1} /`, 435.6, 739.8),
    item(String(total), 449.8, 739.8),
  ];
  const body: Drawn[] = [];
  let y = 576;
  for (const r of st.pages[p]!) {
    body.push(item(r.date, 43.7, y));
    r.left.forEach((s, i) => body.push(item(s, 88.7, y - i * LINE)));
    (r.right ?? []).forEach((s, i) => body.push(item(s, 194.3, y - i * LINE)));
    if (r.amountSen !== undefined) {
      const amount = fmtSen(r.amountSen);
      if (r.debit && st.mergeMarker) {
        const run = `${amount} DB`;
        body.push(item(run, AMOUNT_RIGHT - widthOf(amount, 7), y));
      } else {
        body.push(rightAt(amount, AMOUNT_RIGHT, y));
        if (r.debit) body.push(item("DB", 442, y));
      }
    }
    if (r.balanceSen !== undefined)
      body.push(rightAt(fmtSen(r.balanceSen), BALANCE_RIGHT, y));
    const height = Math.max(r.left.length, r.right?.length ?? 0, 1);
    y -= height * LINE + 2;
  }
  if (last && st.summary) {
    const s = st.summary;
    let sy = y - 40;
    const sum = (label: string, sen: number, count?: number) => {
      body.push(item(label, 208.5, sy));
      body.push(item(":", 265.2, sy));
      body.push(rightAt(fmtSen(sen), 368.2, sy));
      if (count !== undefined) body.push(rightAt(String(count), 416.5, sy));
      sy -= LINE;
    };
    sum("SALDO AWAL", s.openingSen);
    sum("MUTASI CR", s.creditSen, s.creditCount);
    sum("MUTASI DB", s.debitSen, s.debitCount);
    sum("SALDO AKHIR", s.closingSen);
  }
  if (!last) body.push(item("Bersambung ke halaman berikut", 400, 35));
  // pdf.js hands over the first page's header in order and, on later pages,
  // the repeated header and the page number AFTER the rows.
  return p === 0
    ? [...top, ...header, ...body, ...pageNo]
    : [...top, ...body, ...header, ...pageNo];
}

/** The positioned text pdf.js would give for each page. */
export function bcaItems(st: SynStatement): PdfPage[] {
  return st.pages.map((_, p) =>
    pageItems(st, p).map(({ str, x, y, width }) => ({ str, x, y, width })),
  );
}

/** A PDF string literal, WinAnsi, with its three special characters escaped. */
const literal = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/**
 * The same statement as a real PDF file: one uncompressed content stream per
 * page, every piece of text drawn on its own at its own position in
 * Helvetica, and a cross-reference table with the true byte offsets.
 */
export function bcaPdf(st: SynStatement): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font; then a page and its content per page.
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  st.pages.forEach((_, p) => {
    const pageId = 4 + p * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = pageItems(st, p)
      .map(
        (d) =>
          `BT /F1 ${d.size} Tf 1 0 0 1 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Tm ${literal(d.str)} Tj ET`,
      )
      .join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character written is ASCII, so the string's length is its bytes.
  return new TextEncoder().encode(out);
}

/**
 * A January 2027 statement over two pages: a 31/12 posting carried into it,
 * transfers whose descriptions carry numbers of their own, debits, interest
 * and its tax in sen, and a running balance on some rows only.
 */
export function januaryStatement(
  opts: { mergeMarker?: boolean } = {},
): SynStatement {
  const opening = 10_000_000_50; // Rp 10.000.000,50
  const rows1: SynRow[] = [
    { date: "01/01", left: ["SALDO AWAL"], balanceSen: opening },
    {
      date: "31/12",
      left: ["TRSF E-BANKING CR", "TANGGAL :31/12"],
      right: ["3112/ABCDE/ZZ00001", "18450000.00", "BUDI SANTOSO"],
      amountSen: 18_450_000_00,
    },
    {
      date: "02/01",
      left: ["TRSF E-BANKING DB"],
      right: ["0201/FGHIJ/ZZ00001", "-", "SUPPLIER CONTOH"],
      amountSen: 4_000_000_00,
      debit: true,
    },
    {
      date: "02/01",
      left: ["SETORAN VIA CDM"],
      right: ["TOKO CONTOH"],
      amountSen: 900_000_00,
      balanceSen: opening + 18_450_000_00 - 4_000_000_00 + 900_000_00,
    },
  ];
  const rows2: SynRow[] = [
    {
      date: "15/01",
      left: ["KR OTOMATIS"],
      right: ["SHOPEE PAYOUT", "260115ABCDEF"],
      amountSen: 8_600_000_00,
    },
    { date: "31/01", left: ["BUNGA"], amountSen: 4_512_37 },
    {
      date: "31/01",
      left: ["PAJAK BUNGA"],
      amountSen: 902_47,
      debit: true,
      balanceSen:
        opening +
        18_450_000_00 -
        4_000_000_00 +
        900_000_00 +
        8_600_000_00 +
        4_512_37 -
        902_47,
    },
  ];
  const credit = 18_450_000_00 + 900_000_00 + 8_600_000_00 + 4_512_37;
  const debit = 4_000_000_00 + 902_47;
  return {
    period: "JANUARI 2027",
    pages: [rows1, rows2],
    summary: {
      openingSen: opening,
      creditSen: credit,
      creditCount: 4,
      debitSen: debit,
      debitCount: 2,
      closingSen: opening + credit - debit,
    },
    ...(opts.mergeMarker ? { mergeMarker: true } : {}),
  };
}
