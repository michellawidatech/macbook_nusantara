/**
 * A paginated table as a PDF, written by hand (owner ask 2026-09-21: *"Make a
 * export stock as a PDF or excel file or both (the user can choose)"*).
 *
 * ## Why not a library
 *
 * The same answer `lib/xlsxWrite.ts` already gives, and it
 * holds more strongly here. A PDF that needs no image, no colour profile and
 * no embedded font is a few hundred bytes of ASCII plus a cross-reference
 * table; the standard fourteen fonts — Helvetica among them — are in every
 * reader by specification, so a document that asks for one carries no font
 * data at all. pdfmake is ~1MB shipped to every till, jsPDF ~350KB, for one
 * button on one page that prints a table of numbers.
 *
 * ## What is written
 *
 * - **Uncompressed content streams.** Deflate is the only part worth a
 *   library and a stock report is tens of kilobytes either way. The spec has
 *   allowed a plain stream since 1.0, and it makes the output readable in a
 *   text editor, which is what makes it testable.
 * - **WinAnsiEncoding, Helvetica and Helvetica-Bold.** Enough for Indonesian:
 *   the language writes in plain Latin letters, and the one non-ASCII
 *   character this app puts in a report — the en dash — is in WinAnsi. Text is
 *   sanitised rather than trusted (`encodeText`), so a product name somebody
 *   pasted an emoji into cannot produce a file no reader will open.
 * - **Measured text.** `widthOf` carries Helvetica's own advance widths, so a
 *   column can be truncated to fit rather than running under the next one.
 *   Without it every table would need the same monospaced guess for every
 *   string, and "MacBook Pro 16 2019 i9 / 64GB / 8TB" would print over the
 *   quantity beside it.
 *
 * ## What it deliberately cannot do
 *
 * One font family, no images, no links, no rotation, no Unicode beyond
 * WinAnsi. It is a table printer, not a document engine. Anything that needs
 * more than that is a job for the browser's own print dialog.
 *
 * Pure: no DOM, no React, no clock. `test/pdfWrite.test.ts` is the spec.
 */

/** The MIME type a Blob of this should carry. */
export const PDF_MIME = "application/pdf";

/** A PDF point is 1/72 inch — the unit every co-ordinate below is in. */
const MM = 72 / 25.4;

/** The paper sizes the report offers, in points. */
export const PDF_PAGE_SIZES = {
  A4: { width: 210 * MM, height: 297 * MM },
  F4: { width: 215 * MM, height: 330 * MM },
  Letter: { width: 8.5 * 72, height: 11 * 72 },
  Legal: { width: 8.5 * 72, height: 14 * 72 },
} as const;

export type PdfPageSize = keyof typeof PDF_PAGE_SIZES;

/** How a cell is drawn. The names are `XlsxStyle`'s, so a report can share one map. */
export type PdfStyle =
  | "default"
  | "bold"
  | "title"
  | "muted"
  | "header"
  | "headerNum"
  | "group"
  | "groupNum"
  | "num"
  | "numBold";

interface StyleSpec {
  readonly bold: boolean;
  readonly size: number;
  /** 0 is black, 1 is white. */
  readonly grey: number;
}

const STYLE: Record<PdfStyle, StyleSpec> = {
  default: { bold: false, size: 8.5, grey: 0 },
  bold: { bold: true, size: 9.5, grey: 0 },
  title: { bold: true, size: 13, grey: 0 },
  muted: { bold: false, size: 7.5, grey: 0.45 },
  header: { bold: true, size: 8.5, grey: 0 },
  headerNum: { bold: true, size: 8.5, grey: 0 },
  group: { bold: true, size: 9, grey: 0 },
  groupNum: { bold: true, size: 9, grey: 0 },
  num: { bold: false, size: 8.5, grey: 0 },
  numBold: { bold: true, size: 9, grey: 0 },
};

/** Which styles are drawn right-aligned — the number columns. */
const RIGHT = new Set<PdfStyle>(["headerNum", "groupNum", "num", "numBold"]);

/** Which styles sit on a light grey band across the row. */
const BANDED = new Set<PdfStyle>(["group", "groupNum"]);

/** One cell of a table row. */
export interface PdfCell {
  readonly text: string;
  readonly style?: PdfStyle;
}

/** A line of the document: a run of free text, a table row, or a rule. */
export type PdfBlock =
  /** A line of text across the page, in one style. */
  | { readonly kind: "text"; readonly text: string; readonly style?: PdfStyle }
  /** Vertical space, in points. */
  | { readonly kind: "gap"; readonly height?: number }
  /** A hairline across the printable width. */
  | { readonly kind: "rule" }
  /** One row of the table, one cell per column. */
  | { readonly kind: "row"; readonly cells: readonly PdfCell[] };

export interface PdfTableDoc {
  /** Shown in the reader's title bar and in the document's metadata. */
  readonly title: string;
  readonly pageSize: PdfPageSize;
  readonly landscape?: boolean;
  /**
   * Relative column widths. They are scaled to the printable width, so the
   * numbers are proportions and their absolute size does not matter.
   */
  readonly columnWidths: readonly number[];
  /** Everything above the table — the shop's name, the filters, the date. */
  readonly head: readonly PdfBlock[];
  /** The heading row, repeated at the top of every page. */
  readonly heading: readonly PdfCell[];
  readonly body: readonly PdfBlock[];
  /** Printed at the foot of every page, with the page number after it. */
  readonly footer?: string;
  /** When it was made, for the PDF's own metadata. */
  readonly now: Date;
}

/*
 * Helvetica's advance widths, in 1/1000 em, for the printable WinAnsi range.
 *
 * Copied from the font's own metrics (Adobe's Core 14 AFM set) rather than
 * measured: they are a property of the font, identical in every reader, and
 * the reason a column can be truncated to fit instead of guessed at. The two
 * arrays start at code 32 (space) and run to 126 (~); anything outside the
 * table falls back to the average, which is what `encodeText` leaves behind
 * when it replaces a character it cannot carry.
 */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

/** How wide a string is at one size, in points. */
export function widthOf(text: string, size: number, bold: boolean): number {
  const table = bold ? W_BOLD : W_REGULAR;
  let mille = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    mille += code >= 32 && code <= 126 ? table[code - 32]! : bold ? 556 : 500;
  }
  return (mille * size) / 1000;
}

/**
 * Cut a string to fit a width, with an ellipsis when it had to be cut.
 *
 * A stock report has a forty-character product name and a column that is not
 * forty characters wide; the alternative to cutting is text running under the
 * next column, which is the one outcome that makes the whole page unreadable
 * rather than one cell incomplete.
 */
export function fitText(
  text: string,
  width: number,
  size: number,
  bold: boolean,
): string {
  if (widthOf(text, size, bold) <= width) return text;
  const dots = "...";
  const room = width - widthOf(dots, size, bold);
  if (room <= 0) return "";
  let out = "";
  for (const ch of text) {
    if (widthOf(out + ch, size, bold) > room) break;
    out += ch;
  }
  return `${out}${dots}`;
}

/**
 * A character's WinAnsi byte, or null when the font cannot carry it.
 *
 * ASCII is itself. Three characters this app really does put in a report get
 * their WinAnsi codes: the en dash a price range is written with, and the two
 * curly quotes the copy uses. Everything else becomes a question mark rather
 * than a byte that would render as a random glyph — a report saying `?` is
 * obviously incomplete, and one saying `Ã©` looks like corruption.
 */
const WINANSI_EXTRA: Readonly<Record<string, number>> = {
  "–": 0x96, // –
  "—": 0x97, // —
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "·": 0xb7,
  "×": 0xd7, // ×, which the counted-product rows print
};

/** One string as a PDF literal: WinAnsi bytes, with `(`, `)` and `\` escaped. */
export function encodeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (code >= 32 && code <= 126) byte = code;
    else if (WINANSI_EXTRA[ch] !== undefined) byte = WINANSI_EXTRA[ch]!;
    else if (code === 9) byte = 32;
    else byte = 63; // "?"
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** Page geometry, all in points. */
const MARGIN = 14 * MM;
const FOOT = 10 * MM;
const LINE = 12;
const ROW = 13;

/** Fixed-point with two decimals — PDF wants a number, not `1e-7`. */
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

/** A page being drawn: its content stream, and where the pen is. */
interface Page {
  readonly parts: string[];
  y: number;
}

/**
 * Lay a table document out and write the PDF.
 *
 * Returns the file's bytes. The caller wraps them in a `Blob` — this module
 * touches no DOM, so a test can read the output back as text.
 */
export function pdfTable(doc: PdfTableDoc): Uint8Array {
  const size = PDF_PAGE_SIZES[doc.pageSize];
  const pageW = doc.landscape ? size.height : size.width;
  const pageH = doc.landscape ? size.width : size.height;
  const left = MARGIN;
  const right = pageW - MARGIN;
  const printable = right - left;

  const totalWeight = doc.columnWidths.reduce((t, w) => t + Math.max(0, w), 0);
  const widths = doc.columnWidths.map((w) =>
    totalWeight <= 0
      ? printable / Math.max(1, doc.columnWidths.length)
      : (Math.max(0, w) / totalWeight) * printable,
  );
  /** The left edge of each column. */
  const xs: number[] = [];
  widths.reduce((x, w) => {
    xs.push(x);
    return x + w;
  }, left);

  const pages: Page[] = [];
  let page: Page = { parts: [], y: pageH - MARGIN };
  pages.push(page);

  const newPage = () => {
    page = { parts: [], y: pageH - MARGIN };
    pages.push(page);
    drawRow(doc.heading);
  };
  /** Is there room for one more line of `height`? */
  const room = (height: number) => page.y - height >= MARGIN + FOOT;

  const text = (
    value: string,
    x: number,
    y: number,
    style: PdfStyle,
    width?: number,
    align: "left" | "right" = "left",
  ) => {
    const spec = STYLE[style];
    const shown =
      width === undefined ? value : fitText(value, width, spec.size, spec.bold);
    if (shown === "") return;
    const at =
      align === "right"
        ? x + (width ?? 0) - widthOf(shown, spec.size, spec.bold)
        : x;
    page.parts.push(
      "BT",
      `/${spec.bold ? "F2" : "F1"} ${n2(spec.size)} Tf`,
      `${n2(spec.grey)} g`,
      `1 0 0 1 ${n2(at)} ${n2(y)} Tm`,
      `(${encodeText(shown)}) Tj`,
      "ET",
    );
  };

  const band = (y: number, height: number) => {
    page.parts.push(
      "q",
      "0.92 g",
      `${n2(left)} ${n2(y)} ${n2(printable)} ${n2(height)} re`,
      "f",
      "Q",
    );
  };

  function drawRow(cells: readonly PdfCell[]) {
    const height = ROW;
    if (!room(height)) {
      newPage();
      if (cells === doc.heading) return;
    }
    const top = page.y;
    if (cells.some((c) => BANDED.has(c.style ?? "default"))) {
      band(top - height + 3, height);
    }
    cells.forEach((cell, i) => {
      const style = cell.style ?? "default";
      const x = xs[i] ?? left;
      const w = widths[i] ?? printable;
      // A cell is inset either side so text never touches the column beside
      // it even when both are full. A right-aligned column gets more, because
      // its last character sits against the NEXT column's first one — which
      // is the pair that reads as one word when they touch.
      const pad = RIGHT.has(style) ? 6 : 2;
      text(
        cell.text,
        x + 2,
        top - height + 4,
        style,
        Math.max(0, w - 2 - pad),
        RIGHT.has(style) ? "right" : "left",
      );
    });
    page.y = top - height;
    if (cells === doc.heading) {
      page.parts.push(
        "q",
        "0.6 w",
        "0.3 G",
        `${n2(left)} ${n2(page.y + 1)} m ${n2(right)} ${n2(page.y + 1)} l`,
        "S",
        "Q",
      );
      page.y -= 3;
    }
  }

  const drawBlock = (block: PdfBlock) => {
    if (block.kind === "row") return drawRow(block.cells);
    if (block.kind === "gap") {
      const h = block.height ?? 6;
      if (room(h)) page.y -= h;
      else newPage();
      return;
    }
    if (block.kind === "rule") {
      if (!room(6)) newPage();
      page.parts.push(
        "q",
        "0.5 w",
        "0.7 G",
        `${n2(left)} ${n2(page.y - 3)} m ${n2(right)} ${n2(page.y - 3)} l`,
        "S",
        "Q",
      );
      page.y -= 6;
      return;
    }
    const style = block.style ?? "default";
    const spec = STYLE[style];
    const height = Math.max(LINE, spec.size + 4);
    if (!room(height)) newPage();
    text(block.text, left, page.y - height + 3, style, printable);
    page.y -= height;
  };

  for (const block of doc.head) drawBlock(block);
  drawRow(doc.heading);
  for (const block of doc.body) drawBlock(block);

  // The foot goes on last, when the page count is known.
  pages.forEach((p, i) => {
    const label =
      doc.footer === undefined
        ? `${i + 1} / ${pages.length}`
        : `${doc.footer}  ·  ${i + 1} / ${pages.length}`;
    const spec = STYLE.muted;
    const shown = encodeText(label);
    p.parts.push(
      "BT",
      `/F1 ${n2(spec.size)} Tf`,
      `${n2(spec.grey)} g`,
      `1 0 0 1 ${n2(right - widthOf(label, spec.size, false))} ${n2(MARGIN)} Tm`,
      `(${shown}) Tj`,
      "ET",
    );
  });

  return assemble(doc, pages, pageW, pageH);
}

/** `D:20260921134500+07'00'` — the date form PDF metadata wants. */
export function pdfDate(d: Date): string {
  const two = (x: number) => String(x).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `D:${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
    `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}` +
    `${sign}${two(Math.floor(abs / 60))}'${two(abs % 60)}'`
  );
}

/**
 * The objects, the cross-reference table and the trailer.
 *
 * Byte offsets, not character offsets: `xref` entries are positions in the
 * FILE, and a multi-byte character anywhere above one would shift it. Every
 * string here is WinAnsi by construction (`encodeText`), so the two agree —
 * but the length is measured on the encoded bytes all the same, because
 * "they agree today" is not a thing to leave unstated in a format that fails
 * silently when they do not.
 */
function assemble(
  doc: PdfTableDoc,
  pages: readonly Page[],
  pageW: number,
  pageH: number,
): Uint8Array {
  const objects: string[] = [];
  /** 1-based object numbers, in the order they are written. */
  const CATALOG = 1;
  const PAGES = 2;
  const FONT_R = 3;
  const FONT_B = 4;
  const INFO = 5;
  const firstPage = 6;
  const pageIds = pages.map((_, i) => firstPage + i * 2);

  objects[CATALOG] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;
  objects[PAGES] =
    `<< /Type /Pages /Count ${pages.length} /Kids [` +
    `${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[FONT_R] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[FONT_B] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[INFO] =
    `<< /Title (${encodeText(doc.title)}) /Producer (Macbook Nusantara) ` +
    `/CreationDate (${pdfDate(doc.now)}) >>`;

  pages.forEach((p, i) => {
    const id = pageIds[i]!;
    const streamId = id + 1;
    const content = p.parts.join("\n");
    objects[id] =
      `<< /Type /Page /Parent ${PAGES} 0 R ` +
      `/MediaBox [0 0 ${n2(pageW)} ${n2(pageH)}] ` +
      `/Resources << /Font << /F1 ${FONT_R} 0 R /F2 ${FONT_B} 0 R >> >> ` +
      `/Contents ${streamId} 0 R >>`;
    objects[streamId] =
      `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  // A comment of high bytes right after the header: the convention that tells
  // a transfer agent this is binary and must not be newline-translated.
  out += "%âãÏÓ\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    const body = objects[i];
    if (body === undefined) continue;
    offsets[i] = byteLength(out);
    out += `${i} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = byteLength(out);
  const count = objects.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i += 1) {
    const at = offsets[i] ?? 0;
    out += `${String(at).padStart(10, "0")} 00000 n \n`;
  }
  out +=
    `trailer\n<< /Size ${count} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  return toBytes(out);
}

/** Every character here is one byte by construction; this is what says so. */
function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n += s.charCodeAt(i) > 0xff ? 2 : 1;
  return n;
}

function toBytes(s: string): Uint8Array {
  const out = new Uint8Array(byteLength(s));
  let j = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code > 0xff) {
      out[j++] = code >> 8;
      out[j++] = code & 0xff;
    } else {
      out[j++] = code;
    }
  }
  return out;
}
