/**
 * A bank's e-statement, read into lines (owner ask 2026-10-27, "1B 2B 3B 4A" —
 * docs/superpowers/specs/2026-10-27-reconciliation-design.md).
 *
 * The monthly reconciliation matches every line of the bank's own statement
 * against the POS. The statement the shop gets is BCA's *Rekening Tahapan*
 * e-statement, a PDF with real text in it, so the lines are read rather than
 * typed: `parseBcaPages` takes the text pdf.js finds on each page, WITH its
 * position, and rebuilds the table from where things sit. KlikBCA's "mutasi
 * rekening" CSV download carries the same lines, and `parseBcaCsv` reads it
 * into the same shape, so nothing downstream knows which file it was.
 *
 * ## Why positions, not text order
 *
 * The table's columns are not separated by anything a text stream keeps.
 * KETERANGAN holds numbers of its own — a transfer's reference amount,
 * "18450000.00", sits in the description of the row whose MUTASI is
 * "18,450,000.00" — and a debit is marked by a separate "DB" printed beside
 * the amount while a credit carries no mark at all. What decides which number
 * is the amount is which COLUMN it is in, and the columns are read off the
 * header line of each page (TANGGAL, KETERANGAN, CBG, MUTASI, SALDO). The
 * header words are centred over their columns rather than aligned with them,
 * so the bands are drawn between them: anything starting left of CBG is the
 * description, anything ending right of the gap between MUTASI and SALDO is a
 * running balance, and in between is the amount and its mark.
 *
 * A row starts at a line whose leftmost word is a DD/MM date; the lines below
 * it without one are the rest of its description. pdf.js hands items over in
 * the order the PDF drew them, which is not reading order — the page number
 * and the repeated header arrive after the last row — so items are grouped
 * into lines by height first.
 *
 * ## Sen, and why the reconciliation does not carry them (the cents decision)
 *
 * The statement prints sen ("4,512.37" of interest); money in this app is
 * whole rupiah, BigInt on the server (CLAUDE.md). So:
 *
 * - Every figure is read EXACTLY, in sen, as an integer built from the
 *   printed digits — never `parseFloat`, which cannot hold 0.23 — and the
 *   statement must add up in sen (`checkStatement`): opening + credits −
 *   debits = closing, the summary's totals and counts, and every running
 *   balance it prints. A statement that does not add up is refused, so a
 *   misread line can never reach the matching.
 * - What the reconciliation STORES and MATCHES is `rupiahOf`: the rupiah as
 *   printed, truncated toward zero ("902.47" is Rp 902). A POS amount matches
 *   a line when the rupiah agree. The sen are shown when the file is read and
 *   are not carried: a till cannot record them, and in practice only interest
 *   and its tax have any.
 *
 * Pure: no DOM, no pdf.js — `lib/bankStatementPdf.ts` is the one file that
 * touches pdf.js. `test/bankStatement.test.ts` is the spec.
 */

/** One piece of text on a PDF page, where pdf.js put it (points, origin bottom-left). */
export interface PdfTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** A page's text items, in the order pdf.js gave them. */
export type PdfPage = readonly PdfTextItem[];

/** One movement on the statement. */
export interface StatementLine {
  /** 1-based, in the statement's own order. */
  readonly lineNo: number;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Every line of the KETERANGAN cell, joined with a space. */
  readonly description: string;
  /** Signed SEN (1/100 rupiah), exact: a credit is positive, a debit negative. */
  readonly amountSen: number;
  /** The running balance printed beside it, in sen, where one is printed. */
  readonly balanceSen?: number;
}

/** A whole statement, as read. Every figure in sen. */
export interface ParsedStatement {
  readonly source: "PDF" | "CSV";
  /** First and last day of the period, YYYY-MM-DD. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingSen: number;
  readonly closingSen: number;
  /** The summary's own totals and counts, when the file states them. */
  readonly creditSen?: number;
  readonly debitSen?: number;
  readonly creditCount?: number;
  readonly debitCount?: number;
  readonly lines: readonly StatementLine[];
}

/** Why a statement does not add up. */
export type StatementProblem =
  | { readonly code: "NO_LINES" }
  | {
      readonly code: "DOES_NOT_ADD_UP";
      /** opening + credits − debits, from the lines. */
      readonly computedSen: number;
      readonly closingSen: number;
    }
  | {
      readonly code: "CREDIT_TOTAL" | "DEBIT_TOTAL";
      readonly statedSen: number;
      readonly summedSen: number;
    }
  | {
      readonly code: "CREDIT_COUNT" | "DEBIT_COUNT";
      readonly stated: number;
      readonly counted: number;
    }
  | {
      readonly code: "BALANCE_BREAK";
      readonly lineNo: number;
      readonly expectedSen: number;
      readonly printedSen: number;
    };

/** A file that is not a statement this reader knows. */
export class StatementReadError extends Error {
  constructor(
    readonly code: "NOT_A_STATEMENT" | "NO_PERIOD" | "UNREADABLE_LINE",
    message: string,
  ) {
    super(message);
    this.name = "StatementReadError";
  }
}

/**
 * Whole rupiah from sen, TRUNCATED toward zero — the rupiah as printed
 * ("4,512.37" is Rp 4.512). Money in this app is whole rupiah.
 */
export function rupiahOf(sen: number): number {
  return sen < 0 ? -Math.floor(-sen / 100) : Math.floor(sen / 100);
}

/** The sen left over after `rupiahOf`, with the figure's sign (−47 for −902.47). */
export function senPartOf(sen: number): number {
  return sen - rupiahOf(sen) * 100;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** 18,450,000.00 — comma thousands, dot sen (BCA's PDF, and English Excel). */
const GROUPED_DOT = /^(\d{1,3}(?:,\d{3})+|\d{1,3})(?:\.(\d{1,2}))?$/;
/** 18.450.000,00 — dot thousands, comma sen (Indonesian Excel). */
const GROUPED_COMMA = /^(\d{1,3}(?:\.\d{3})+|\d{1,3})(?:,(\d{1,2}))?$/;
/** 18450000.00 or 18450000,00 — no grouping (KlikBCA's CSV). */
const PLAIN = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * A printed figure, in sen, or undefined when it is not one.
 *
 * Built from the digits as a string — the rupiah part times a hundred plus the
 * sen — so nothing passes through a float. A leading `=` (a CSV cell written
 * as a formula) and a leading minus are accepted; thousands separators are
 * accepted only where they group threes, so a reference number is not taken
 * for a figure by accident.
 */
export function senOf(text: string): number | undefined {
  let s = text.trim().replace(/^=/, "").replace(/\s+/g, "");
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (s === "") return undefined;
  const m = GROUPED_DOT.exec(s) ?? GROUPED_COMMA.exec(s) ?? PLAIN.exec(s);
  if (m === null) return undefined;
  const rupiah = m[1]!.replace(/[.,]/g, "");
  const sen = (m[2] ?? "").padEnd(2, "0");
  const value = Number(rupiah) * 100 + Number(sen);
  if (!Number.isSafeInteger(value)) return undefined;
  return sign * value;
}

/** Credits and debits on the lines, each as a positive total, with counts. */
export function statementTotals(lines: readonly StatementLine[]): {
  readonly creditSen: number;
  readonly debitSen: number;
  readonly creditCount: number;
  readonly debitCount: number;
} {
  let creditSen = 0;
  let debitSen = 0;
  let creditCount = 0;
  let debitCount = 0;
  for (const l of lines) {
    if (l.amountSen > 0) {
      creditSen += l.amountSen;
      creditCount += 1;
    } else if (l.amountSen < 0) {
      debitSen -= l.amountSen;
      debitCount += 1;
    }
  }
  return { creditSen, debitSen, creditCount, debitCount };
}

/**
 * What does not add up, or nothing when the statement is whole.
 *
 * Everything is compared in sen, exactly. The running balances are the
 * strongest check of the four: BCA prints one on some rows only, and each
 * must equal the opening plus every movement above it — so a line read with
 * the wrong sign, or two lines read as one, breaks at the next printed
 * balance rather than only at the end. Only the first break is reported; the
 * rest follow from it.
 */
export function checkStatement(s: ParsedStatement): StatementProblem[] {
  if (s.lines.length === 0) return [{ code: "NO_LINES" }];
  const out: StatementProblem[] = [];
  const t = statementTotals(s.lines);
  const computedSen = s.openingSen + t.creditSen - t.debitSen;
  if (computedSen !== s.closingSen) {
    out.push({
      code: "DOES_NOT_ADD_UP",
      computedSen,
      closingSen: s.closingSen,
    });
  }
  if (s.creditSen !== undefined && s.creditSen !== t.creditSen) {
    out.push({
      code: "CREDIT_TOTAL",
      statedSen: s.creditSen,
      summedSen: t.creditSen,
    });
  }
  if (s.debitSen !== undefined && s.debitSen !== t.debitSen) {
    out.push({
      code: "DEBIT_TOTAL",
      statedSen: s.debitSen,
      summedSen: t.debitSen,
    });
  }
  if (s.creditCount !== undefined && s.creditCount !== t.creditCount) {
    out.push({
      code: "CREDIT_COUNT",
      stated: s.creditCount,
      counted: t.creditCount,
    });
  }
  if (s.debitCount !== undefined && s.debitCount !== t.debitCount) {
    out.push({
      code: "DEBIT_COUNT",
      stated: s.debitCount,
      counted: t.debitCount,
    });
  }
  let running = s.openingSen;
  for (const l of s.lines) {
    running += l.amountSen;
    if (l.balanceSen !== undefined && l.balanceSen !== running) {
      out.push({
        code: "BALANCE_BREAK",
        lineNo: l.lineNo,
        expectedSen: running,
        printedSen: l.balanceSen,
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = {
  JANUARI: 1,
  JANUARY: 1,
  FEBRUARI: 2,
  FEBRUARY: 2,
  MARET: 3,
  MARCH: 3,
  APRIL: 4,
  MEI: 5,
  MAY: 5,
  JUNI: 6,
  JUNE: 6,
  JULI: 7,
  JULY: 7,
  AGUSTUS: 8,
  AUGUST: 8,
  SEPTEMBER: 9,
  OKTOBER: 10,
  OCTOBER: 10,
  NOVEMBER: 11,
  DESEMBER: 12,
  DECEMBER: 12,
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The last day of a month, from the calendar rather than a table. */
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthBounds(
  year: number,
  month: number,
): { periodStart: string; periodEnd: string } {
  return {
    periodStart: `${year}-${pad2(month)}-01`,
    periodEnd: `${year}-${pad2(month)}-${pad2(lastDayOf(year, month))}`,
  };
}

/**
 * A DD/MM row date in a statement for `month` of `year`. A month later than
 * the statement's own belongs to the year before: a January statement can
 * carry a 31/12 posting.
 */
function dayOfRow(
  dd: number,
  mm: number,
  year: number,
  month: number,
): string | undefined {
  if (mm < 1 || mm > 12) return undefined;
  const y = mm > month ? year - 1 : year;
  if (dd < 1 || dd > lastDayOf(y, mm)) return undefined;
  return `${y}-${pad2(mm)}-${pad2(dd)}`;
}

// ---------------------------------------------------------------------------
// The PDF layout
// ---------------------------------------------------------------------------

/** A word, where it sits. Items are split into words so a merged run still reads. */
interface Token {
  readonly s: string;
  readonly x: number;
  readonly right: number;
  readonly y: number;
}

interface Line {
  readonly y: number;
  readonly tokens: readonly Token[];
  readonly text: string;
}

/** Lines are this close in height, or they are two lines. */
const SAME_LINE = 2;

/**
 * Each item's words, positioned in proportion to where they fall in the item.
 * pdf.js usually gives one item per cell, but nothing promises it: an amount
 * and its "DB" can arrive as one run, and splitting by characters keeps each
 * word in the column it was printed in.
 */
function tokensOf(page: PdfPage): Token[] {
  const out: Token[] = [];
  for (const it of page) {
    const str = it.str;
    if (str.trim() === "") continue;
    const per = str.length > 0 ? it.width / str.length : 0;
    for (const m of str.matchAll(/\S+/g)) {
      const at = m.index;
      out.push({
        s: m[0],
        x: it.x + at * per,
        right: it.x + (at + m[0].length) * per,
        y: it.y,
      });
    }
  }
  return out;
}

/** Tokens grouped into lines, top of the page first, each left to right. */
function linesOf(page: PdfPage): Line[] {
  const tokens = tokensOf(page).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; tokens: Token[] }[] = [];
  for (const t of tokens) {
    const last = lines[lines.length - 1];
    if (last !== undefined && Math.abs(last.y - t.y) <= SAME_LINE) {
      last.tokens.push(t);
    } else {
      lines.push({ y: t.y, tokens: [t] });
    }
  }
  return lines.map((l) => {
    const sorted = [...l.tokens].sort((a, b) => a.x - b.x);
    return { y: l.y, tokens: sorted, text: sorted.map((t) => t.s).join(" ") };
  });
}

/** Where each column's band starts and ends on one page. */
interface Columns {
  /** The header line's height; rows are below it. */
  readonly headerY: number;
  /** A row's date is left of this (where the KETERANGAN header word starts). */
  readonly dateBefore: number;
  /** Anything starting left of this is description. */
  readonly descriptionBefore: number;
  /** Anything ending right of this is past CBG — the amount or the balance. */
  readonly branchUntil: number;
  /** Anything ending right of this is the running balance. */
  readonly amountUntil: number;
}

function columnsOf(lines: readonly Line[]): Columns | undefined {
  for (const line of lines) {
    const find = (w: string) =>
      line.tokens.find((t) => t.s.toUpperCase() === w);
    const tanggal = find("TANGGAL");
    const keterangan = find("KETERANGAN");
    const cbg = find("CBG");
    const mutasi = find("MUTASI");
    const saldo = find("SALDO");
    if (!tanggal || !keterangan || !cbg || !mutasi || !saldo) continue;
    if (!(
      tanggal.x < keterangan.x &&
      keterangan.x < cbg.x &&
      cbg.x < mutasi.x &&
      mutasi.x < saldo.x
    ))
      continue;
    return {
      headerY: line.y,
      dateBefore: keterangan.x,
      descriptionBefore: cbg.x - 1,
      branchUntil: (cbg.right + mutasi.x) / 2,
      amountUntil: (mutasi.right + saldo.x) / 2,
    };
  }
  return undefined;
}

const DATE_TOKEN = /^(\d{2})\/(\d{2})$/;
const SUMMARY =
  /^(SALDO AWAL|MUTASI CR|MUTASI DB|SALDO AKHIR)\s*:?\s*(-?[\d.,]+)(?:\s+(\d+))?/;
const MARKER = /^(DB|CR)$/;

interface RowDraft {
  dd: number;
  mm: number;
  words: string[];
  amount: string[];
  marker?: "DB" | "CR";
  balance: string[];
  /** For a refusal that names where. */
  page: number;
}

/**
 * The statement period, from "PERIODE : SEPTEMBER 2026" in the page header.
 * The value sits to the right of the label on the same line.
 */
function periodOf(
  pagesLines: readonly (readonly Line[])[],
): { year: number; month: number } | undefined {
  for (const lines of pagesLines) {
    for (const line of lines) {
      const m = /PERIODE\s*:?\s*([A-Za-z]+)\s+(\d{4})/i.exec(line.text);
      if (m === null) continue;
      const month = MONTHS[m[1]!.toUpperCase()];
      if (month !== undefined) return { year: Number(m[2]), month };
    }
  }
  return undefined;
}

/**
 * BCA's *Rekening Tahapan* e-statement, from the text pdf.js found on each
 * page. Throws `StatementReadError` for anything it cannot read whole —
 * a refused file is better than a statement missing a line.
 */
export function parseBcaPages(pages: readonly PdfPage[]): ParsedStatement {
  const pagesLines = pages.map(linesOf);
  const period = periodOf(pagesLines);
  const rows: RowDraft[] = [];
  const summary: {
    opening?: number;
    closing?: number;
    credit?: number;
    debit?: number;
    creditCount?: number;
    debitCount?: number;
  } = {};
  let sawHeader = false;
  let ended = false;

  for (const [p, lines] of pagesLines.entries()) {
    if (ended) break;
    const cols = columnsOf(lines);
    if (cols === undefined) continue;
    sawHeader = true;
    for (const line of lines) {
      if (line.y >= cols.headerY - SAME_LINE) continue;
      if (/Bersambung/i.test(line.text)) continue;
      const first = line.tokens[0]!;
      const date = first.x < cols.dateBefore ? DATE_TOKEN.exec(first.s) : null;

      if (date === null) {
        const sum = SUMMARY.exec(line.text.toUpperCase());
        if (sum !== null) {
          const value = senOf(sum[2]!);
          if (value === undefined) {
            throw new StatementReadError(
              "UNREADABLE_LINE",
              `The summary line "${sum[1]}" has no figure that can be read.`,
            );
          }
          const count = sum[3] === undefined ? undefined : Number(sum[3]);
          switch (sum[1]) {
            case "SALDO AWAL":
              summary.opening = value;
              break;
            case "MUTASI CR":
              summary.credit = value;
              if (count !== undefined) summary.creditCount = count;
              break;
            case "MUTASI DB":
              summary.debit = value;
              if (count !== undefined) summary.debitCount = count;
              break;
            case "SALDO AKHIR":
              summary.closing = value;
              ended = true;
              break;
          }
          continue;
        }
        // Once the summary has begun, nothing below it is a row.
        if (summary.opening !== undefined || summary.credit !== undefined)
          continue;
      }

      let current: RowDraft | undefined;
      let tokens = line.tokens;
      if (date !== null) {
        current = {
          dd: Number(date[1]),
          mm: Number(date[2]),
          words: [],
          amount: [],
          balance: [],
          page: p + 1,
        };
        rows.push(current);
        tokens = tokens.slice(1);
      } else {
        current = rows[rows.length - 1];
        // Text above the first row of the statement (a notice) is not a row.
        if (current === undefined) continue;
      }
      for (const t of tokens) {
        if (t.x < cols.descriptionBefore) {
          current.words.push(t.s);
        } else if (MARKER.test(t.s) && t.right <= cols.amountUntil + 20) {
          current.marker = t.s as "DB" | "CR";
        } else if (t.right > cols.amountUntil) {
          current.balance.push(t.s);
        } else if (t.right > cols.branchUntil) {
          current.amount.push(t.s);
        }
        // Anything else is the branch code (CBG), which nothing reads.
      }
    }
  }

  if (!sawHeader) {
    throw new StatementReadError(
      "NOT_A_STATEMENT",
      "This file has no TANGGAL / KETERANGAN / CBG / MUTASI / SALDO table.",
    );
  }
  if (period === undefined) {
    throw new StatementReadError(
      "NO_PERIOD",
      "The statement does not say which month it covers (PERIODE).",
    );
  }

  const lines: StatementLine[] = [];
  let openingRow: number | undefined;
  for (const r of rows) {
    const date = dayOfRow(r.dd, r.mm, period.year, period.month);
    const where = `${pad2(r.dd)}/${pad2(r.mm)} (page ${r.page})`;
    if (date === undefined) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The row dated ${where} has no real date.`,
      );
    }
    const description = r.words.join(" ");
    const balance =
      r.balance.length === 0 ? undefined : senOf(r.balance.join(""));
    if (r.balance.length > 0 && balance === undefined) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The balance on the row dated ${where} cannot be read.`,
      );
    }
    if (r.amount.length === 0) {
      if (/^SALDO AWAL\b/i.test(description) && balance !== undefined) {
        openingRow = balance;
        continue;
      }
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The row dated ${where} has no amount.`,
      );
    }
    const amount = r.amount.length === 1 ? senOf(r.amount[0]!) : undefined;
    if (amount === undefined || amount < 0) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The amount on the row dated ${where} cannot be read.`,
      );
    }
    lines.push({
      lineNo: lines.length + 1,
      date,
      description,
      amountSen: r.marker === "DB" ? -amount : amount,
      ...(balance === undefined ? {} : { balanceSen: balance }),
    });
  }

  const opening = summary.opening ?? openingRow;
  if (opening === undefined) {
    throw new StatementReadError(
      "UNREADABLE_LINE",
      "The statement has no opening balance (SALDO AWAL).",
    );
  }
  const lastBalance = closingFromBalances(opening, lines);
  const closing = summary.closing ?? lastBalance;
  if (closing === undefined) {
    throw new StatementReadError(
      "UNREADABLE_LINE",
      "The statement has no closing balance (SALDO AKHIR).",
    );
  }
  return {
    source: "PDF",
    ...monthBounds(period.year, period.month),
    openingSen: opening,
    closingSen: closing,
    ...(summary.credit === undefined ? {} : { creditSen: summary.credit }),
    ...(summary.debit === undefined ? {} : { debitSen: summary.debit }),
    ...(summary.creditCount === undefined
      ? {}
      : { creditCount: summary.creditCount }),
    ...(summary.debitCount === undefined
      ? {}
      : { debitCount: summary.debitCount }),
    lines,
  };
}

/**
 * The closing balance the printed balances imply: the last one printed, plus
 * whatever moved after it. Undefined when none is printed.
 */
function closingFromBalances(
  opening: number | undefined,
  lines: readonly StatementLine[],
): number | undefined {
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.balanceSen !== undefined) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    if (opening === undefined) return undefined;
    return lines.reduce((n, l) => n + l.amountSen, opening);
  }
  return lines
    .slice(at + 1)
    .reduce((n, l) => n + l.amountSen, lines[at]!.balanceSen!);
}

// ---------------------------------------------------------------------------
// KlikBCA's CSV
// ---------------------------------------------------------------------------

/** One CSV record, quotes honoured ("" is a quote inside a quoted field). */
function csvFields(line: string, sep: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  // KlikBCA writes text cells as 'value so Excel keeps their leading zeros.
  return out.map((f) => f.trim().replace(/^'/, "").trim());
}

type FooterKind = "opening" | "closing" | "credit" | "debit";

function footerKind(label: string): FooterKind | undefined {
  const l = label.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^SALDO AWAL\b/.test(l)) return "opening";
  if (/^SALDO AKHIR\b/.test(l)) return "closing";
  if (/^(MUTASI |TOTAL )?(KREDIT|CR|CREDIT)\b/.test(l)) return "credit";
  if (/^(MUTASI |TOTAL )?(DEBET|DEBIT|DB)\b/.test(l)) return "debit";
  return undefined;
}

/**
 * KlikBCA's "mutasi rekening" download: a few lines about the account, a
 * header row, a row per movement, and a footer of balances and totals.
 *
 * Tolerant of what varies between downloads and spreadsheet round-trips —
 * the separator, a CR/DB in its own column or after the figure, a date with
 * or without its year, the footer's exact labels — and strict about what
 * matters: every movement row must read, or the file is refused. Pending
 * rows ("PEND") are not on the statement yet and are skipped.
 */
export function parseBcaCsv(text: string): ParsedStatement {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerAt = raw.findIndex(
    (l) => /tanggal/i.test(l) && /keterangan/i.test(l),
  );
  if (headerAt < 0) {
    throw new StatementReadError(
      "NOT_A_STATEMENT",
      "This file has no Tanggal / Keterangan header row.",
    );
  }
  const headerLine = raw[headerAt]!;
  const sep =
    (headerLine.match(/;/g)?.length ?? 0) >
    (headerLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const header = csvFields(headerLine, sep).map((h) => h.toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const dateCol = col(/tanggal/);
  const descCol = col(/keterangan/);
  const amountCol = col(/jumlah|mutasi|amount/);
  const balanceCol = col(/saldo|balance/);
  if (dateCol < 0 || descCol < 0 || amountCol < 0) {
    throw new StatementReadError(
      "NOT_A_STATEMENT",
      "The header row has no Tanggal, Keterangan or Jumlah column.",
    );
  }

  // "Periode : 01/09/2026 - 30/09/2026", above the header.
  let period: { from: string; to: string } | undefined;
  for (const l of raw.slice(0, headerAt)) {
    const m =
      /periode\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(
        l,
      );
    if (m !== null) {
      period = {
        from: `${m[3]}-${m[2]}-${m[1]}`,
        to: `${m[6]}-${m[5]}-${m[4]}`,
      };
    }
  }

  interface CsvRow {
    dd: number;
    mm: number;
    yyyy?: number;
    description: string;
    amount: number;
    balance?: number;
    row: number;
  }
  const rows: CsvRow[] = [];
  const footer: Partial<Record<FooterKind, number>> = {};
  const counts: { credit?: number; debit?: number } = {};

  for (let i = headerAt + 1; i < raw.length; i++) {
    const line = raw[i]!;
    if (line.trim() === "") continue;
    const f = csvFields(line, sep);
    const first = f[dateCol] ?? f[0] ?? "";
    if (/^PEND/i.test(first)) continue;

    const kind = footerKind(f[0] ?? "");
    if (kind !== undefined) {
      const rest = f.slice(1).filter((x) => x !== "");
      const value = rest.length > 0 ? senOf(rest[0]!) : undefined;
      if (value === undefined) {
        throw new StatementReadError(
          "UNREADABLE_LINE",
          `The footer line "${f[0]}" has no figure that can be read.`,
        );
      }
      footer[kind] = value;
      const count = rest[1];
      if (
        (kind === "credit" || kind === "debit") &&
        count !== undefined &&
        /^\d+$/.test(count)
      )
        counts[kind] = Number(count);
      continue;
    }

    const date = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(first);
    if (date === null) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `Line ${i + 1} is neither a movement nor a total.`,
      );
    }
    let amountText = f[amountCol] ?? "";
    let marker: string | undefined;
    const suffix = /^(.*?)\s*(CR|DB)$/i.exec(amountText);
    if (suffix !== null) {
      amountText = suffix[1]!;
      marker = suffix[2]!.toUpperCase();
    } else {
      marker = f
        .slice(amountCol + 1)
        .find((x) => /^(CR|DB)$/i.test(x))
        ?.toUpperCase();
    }
    const amount = senOf(amountText);
    if (amount === undefined || marker === undefined) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The amount on line ${i + 1} cannot be read.`,
      );
    }
    const balanceText = balanceCol < 0 ? "" : (f[balanceCol] ?? "");
    const balance = balanceText === "" ? undefined : senOf(balanceText);
    if (balanceText !== "" && balance === undefined) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The balance on line ${i + 1} cannot be read.`,
      );
    }
    rows.push({
      dd: Number(date[1]),
      mm: Number(date[2]),
      ...(date[3] === undefined ? {} : { yyyy: Number(date[3]) }),
      description: (f[descCol] ?? "").replace(/\s+/g, " ").trim(),
      amount: marker === "DB" ? -Math.abs(amount) : Math.abs(amount),
      ...(balance === undefined ? {} : { balance }),
      row: i + 1,
    });
  }

  // The year a DD/MM row is in: the period's, or the year before for a month
  // past the period's end (a January statement's 31/12 posting).
  const end = period?.to ?? undefined;
  const withYear = rows.find((r) => r.yyyy !== undefined);
  const endYear = end ? Number(end.slice(0, 4)) : withYear?.yyyy;
  const endMonth = end ? Number(end.slice(5, 7)) : withYear?.mm;
  if (endYear === undefined || endMonth === undefined) {
    throw new StatementReadError(
      "NO_PERIOD",
      "The file does not say which period it covers (Periode).",
    );
  }

  const lines: StatementLine[] = rows.map((r, i) => {
    const date =
      r.yyyy === undefined
        ? dayOfRow(r.dd, r.mm, endYear, endMonth)
        : r.dd >= 1 && r.dd <= lastDayOf(r.yyyy, r.mm) && r.mm <= 12
          ? `${r.yyyy}-${pad2(r.mm)}-${pad2(r.dd)}`
          : undefined;
    if (date === undefined) {
      throw new StatementReadError(
        "UNREADABLE_LINE",
        `The date on line ${r.row} is not a real date.`,
      );
    }
    return {
      lineNo: i + 1,
      date,
      description: r.description,
      amountSen: r.amount,
      ...(r.balance === undefined ? {} : { balanceSen: r.balance }),
    };
  });

  // Without a footer, the balances say where it started and ended.
  let opening = footer.opening;
  if (opening === undefined) {
    let moved = 0;
    for (const l of lines) {
      moved += l.amountSen;
      if (l.balanceSen !== undefined) {
        opening = l.balanceSen - moved;
        break;
      }
    }
  }
  const closing = footer.closing ?? closingFromBalances(opening, lines);
  if (opening === undefined || closing === undefined) {
    throw new StatementReadError(
      "UNREADABLE_LINE",
      "The file states no balances, so it cannot be checked.",
    );
  }

  const bounds =
    period !== undefined
      ? { periodStart: period.from, periodEnd: period.to }
      : lines.length > 0
        ? {
            periodStart: `${lines[0]!.date.slice(0, 7)}-01`,
            periodEnd: monthBounds(
              Number(lines[lines.length - 1]!.date.slice(0, 4)),
              Number(lines[lines.length - 1]!.date.slice(5, 7)),
            ).periodEnd,
          }
        : monthBounds(endYear, endMonth);

  return {
    source: "CSV",
    ...bounds,
    openingSen: opening,
    closingSen: closing,
    ...(footer.credit === undefined ? {} : { creditSen: footer.credit }),
    ...(footer.debit === undefined ? {} : { debitSen: footer.debit }),
    ...(counts.credit === undefined ? {} : { creditCount: counts.credit }),
    ...(counts.debit === undefined ? {} : { debitCount: counts.debit }),
    lines,
  };
}
