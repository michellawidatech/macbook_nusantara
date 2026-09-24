/**
 * Export a flat table to .xlsx or .pdf.
 *
 * The two payable/receivable tabs, and later reports, want the same shape: a
 * heading, some rows, hand it over. `lib/stockExport.ts` builds one report the
 * long way because its rows are grouped by warehouse and its columns are
 * optional; a table with fixed columns is a few lines in front of the same
 * two writers.
 *
 * Pure aside from the DOM click that starts the download; the byte-writing
 * halves stay in `xlsxWrite.ts` / `pdfWrite.ts` where a test can read them.
 */
import {
  XLSX_MIME,
  xlsxFile,
  type XlsxSheet,
  type XlsxRow,
} from "./xlsxWrite.js";
import {
  PDF_MIME,
  pdfTable,
  type PdfBlock,
  type PdfCell,
  type PdfPageSize,
} from "./pdfWrite.js";

/** One column, spelled the same in both writers. */
export interface TableExportColumn<Row> {
  readonly key: string;
  readonly title: string;
  /** The text the row prints. Numbers are passed through as `number`. */
  readonly value: (row: Row) => string | number | null | undefined;
  /** Column width in Excel characters (defaults to 16). */
  readonly width?: number;
  /** Relative width for the PDF (defaults to 1). */
  readonly pdfWeight?: number;
  /** Right-align — for a money or a quantity column. */
  readonly numeric?: boolean;
}

export interface TableExportOptions<Row> {
  readonly title: string;
  readonly sheetName?: string;
  readonly filename: string;
  readonly columns: readonly TableExportColumn<Row>[];
  readonly rows: readonly Row[];
  /** Free lines above the heading — the shop's name, filters, the printed-at. */
  readonly headLines?: readonly string[];
  /** A total row under the body. Values by column key. */
  readonly totals?: Record<string, string | number>;
  readonly pageSize?: PdfPageSize;
  readonly landscape?: boolean;
  readonly now?: Date;
}

/** Turn the shared shape into the sheet `xlsxFile` writes. */
function toSheet<Row>(opts: TableExportOptions<Row>): XlsxSheet {
  const rows: XlsxRow[] = [];
  rows.push([{ v: opts.title, s: "title" }]);
  for (const line of opts.headLines ?? []) rows.push([{ v: line, s: "muted" }]);
  rows.push([]);
  rows.push(
    opts.columns.map((c) => ({
      v: c.title,
      s: c.numeric ? "headerNum" : "header",
    })),
  );
  for (const r of opts.rows) {
    rows.push(
      opts.columns.map((c) => {
        const v = c.value(r);
        return { v: v ?? "", s: c.numeric ? "num" : "default" };
      }),
    );
  }
  if (opts.totals) {
    rows.push(
      opts.columns.map((c) => {
        const t = opts.totals?.[c.key];
        if (t === undefined)
          return { v: "", s: c.numeric ? "numBold" : "bold" };
        return { v: t, s: c.numeric ? "numBold" : "bold" };
      }),
    );
  }
  return {
    name: (opts.sheetName ?? opts.title).slice(0, 31),
    rows,
    columnWidths: opts.columns.map((c) => c.width ?? 16),
    freezeRows: (opts.headLines?.length ?? 0) + 3,
  };
}

/** Turn the shared shape into the doc `pdfTable` prints. */
function toPdfBlocks<Row>(opts: TableExportOptions<Row>): {
  head: PdfBlock[];
  heading: PdfCell[];
  body: PdfBlock[];
  columnWidths: number[];
} {
  const head: PdfBlock[] = [{ kind: "text", text: opts.title, style: "title" }];
  for (const line of opts.headLines ?? [])
    head.push({ kind: "text", text: line, style: "muted" });
  head.push({ kind: "gap", height: 6 });
  const heading: PdfCell[] = opts.columns.map((c) => ({
    text: c.title,
    style: c.numeric ? "headerNum" : "header",
  }));
  const body: PdfBlock[] = [];
  for (const r of opts.rows) {
    body.push({
      kind: "row",
      cells: opts.columns.map((c) => {
        const v = c.value(r);
        return {
          text: v === null || v === undefined ? "" : String(v),
          style: c.numeric ? "num" : "default",
        };
      }),
    });
  }
  if (opts.totals) {
    body.push({
      kind: "row",
      cells: opts.columns.map((c) => {
        const t = opts.totals?.[c.key];
        return {
          text: t === undefined ? "" : String(t),
          style: c.numeric ? "numBold" : "bold",
        };
      }),
    });
  }
  return {
    head,
    heading,
    body,
    columnWidths: opts.columns.map((c) => c.pdfWeight ?? 1),
  };
}

/** Hand a `Uint8Array` to the browser as a download — same trick the stock export uses. */
export function downloadBytes(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download one .xlsx. */
export function exportXlsx<Row>(opts: TableExportOptions<Row>): void {
  const now = opts.now ?? new Date();
  downloadBytes(xlsxFile(toSheet(opts), now), XLSX_MIME, opts.filename);
}

/** Download one .pdf. */
export function exportPdf<Row>(opts: TableExportOptions<Row>): void {
  const parts = toPdfBlocks(opts);
  const bytes = pdfTable({
    title: opts.title,
    pageSize: opts.pageSize ?? "A4",
    ...(opts.landscape ? { landscape: true as const } : {}),
    columnWidths: parts.columnWidths,
    head: parts.head,
    heading: parts.heading,
    body: parts.body,
    now: opts.now ?? new Date(),
  });
  downloadBytes(bytes, PDF_MIME, opts.filename);
}
