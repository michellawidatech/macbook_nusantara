/**
 * Reading an .xlsx workbook in the browser, without a dependency.
 *
 * > *"Upload a Shopee Income report (Laporan Penghasilan, .xlsx) to mark sales
 * > received."* — owner brief, 2026-09-19
 *
 * ## Why not a library
 *
 * The one job here is "give me the cell values of a workbook Shopee wrote",
 * and the usual answer to that is a spreadsheet package of several hundred
 * kilobytes that also formats, writes, evaluates and charts. An .xlsx file is
 * a ZIP of XML documents, and the browser already carries both halves of
 * reading one: `DecompressionStream("deflate-raw")` unpacks a ZIP entry and
 * `DOMParser` reads the XML. What is left is two hundred lines of bookkeeping,
 * and those are here.
 *
 * ## What it reads, and what it deliberately does not
 *
 * - **Values, not formatting.** A number cell is a `number` (the XML holds it
 *   unformatted, so no locale is involved), a text cell is a `string`, a
 *   boolean is a `boolean`, an empty cell is `null`. A date is a number, as
 *   Excel stores it — the caller knows which column is a date; this module
 *   does not read `styles.xml` to guess.
 * - **Shared strings, inline strings, formula results.** `t="s"`,
 *   `t="inlineStr"`, `t="str"`; rich-text runs are joined and phonetic runs
 *   (`rPh`) left out, as Excel shows them.
 * - **Every sheet, by its name**, in workbook order — located through the
 *   package's relationships rather than by guessing `sheet1.xml`, because a
 *   writer is free to name the parts anything.
 * - **Gaps by reference.** A row or cell the writer omitted is placed by its
 *   `r` attribute (`C7` is row 6, column 2), so `rows[i][j]` is always
 *   spreadsheet row `i + 1`, column `j` — which is what the column pickers on
 *   the import screen show.
 * - **Not:** ZIP64 (a workbook over 4GB), encrypted workbooks, the old binary
 *   `.xls`. Each is refused with an `XlsxError` whose `code` the screen turns
 *   into a sentence, rather than half-read.
 *
 * Pure apart from the two platform APIs above: no React, no store.
 * `test/xlsxRead.test.ts` builds workbooks byte by byte — stored and deflated —
 * and reads them back.
 */

/** One cell's value. */
export type Cell = string | number | boolean | null;

export interface XlsxSheet {
  readonly name: string;
  /**
   * `rows[i]` is spreadsheet row `i + 1`; `rows[i][j]` is column `j` (A = 0).
   * A missing row is an empty array and a missing cell reads `null` or
   * `undefined` (past the row's last cell) — treat both as empty.
   */
  readonly rows: readonly (readonly Cell[])[];
}

/** Why a file could not be read. The screen words each one. */
export type XlsxErrorCode =
  /** Not a ZIP at all — an old `.xls`, a CSV, a PDF renamed. */
  | "NOT_ZIP"
  /** A ZIP, but with no worksheet in it. */
  | "NOT_XLSX"
  /** A feature this reader does not handle: ZIP64, encryption, a method. */
  | "UNSUPPORTED"
  /** Truncated, or its XML does not parse. */
  | "CORRUPT";

export class XlsxError extends Error {
  readonly code: XlsxErrorCode;
  constructor(code: XlsxErrorCode, message: string) {
    super(message);
    this.name = "XlsxError";
    this.code = code;
  }
}

/**
 * Past these a sheet is not a payout report, and a stray cell at `XFD1048576`
 * must not make the reader allocate a million empty rows.
 */
const MAX_ROWS = 200_000;
const MAX_COLS = 16_384;

// ---------------------------------------------------------------------------
// The ZIP container
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

interface ZipEntry {
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

const utf8 = new TextDecoder("utf-8");

/**
 * The central directory: every entry's name, method, size and where its data
 * starts. Read from the END of the file, which is where a ZIP keeps its index
 * — the local headers alone are not enough, because a writer that streams
 * (bit 3 of the flags) leaves their sizes at zero.
 */
function centralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is 22 bytes plus a comment of up to 65535. Scanning
  // backwards finds the last signature; one inside the comment is rejected by
  // checking that its comment length reaches exactly to the end of the file.
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 0xffff);
    i--
  ) {
    if (
      view.getUint32(i, true) === EOCD_SIG &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new XlsxError("NOT_ZIP", "No ZIP end-of-central-directory record.");
  }
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new XlsxError("UNSUPPORTED", "ZIP64 archives are not supported.");
  }
  if (offset + size > bytes.length) {
    throw new XlsxError("CORRUPT", "The central directory runs past the file.");
  }
  const entries = new Map<string, ZipEntry>();
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CEN_SIG) {
      throw new XlsxError(
        "CORRUPT",
        `Central directory entry ${i} is damaged.`,
      );
    }
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    // Names are ASCII in every workbook; UTF-8 (flag bit 11) is a superset.
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, {
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      localOffset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Undo raw DEFLATE (ZIP method 8) with the platform's own decompressor. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new XlsxError(
      "UNSUPPORTED",
      "This browser cannot unpack compressed files (DecompressionStream).",
    );
  }
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // Not awaited: the readable side has to be drained concurrently, or a large
  // entry fills the stream's queue and the write never resolves. A corrupt
  // entry rejects the READ below, which is where the error is reported; these
  // two are caught only so the same failure is not also an unhandled
  // rejection.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
  } catch (e) {
    throw new XlsxError(
      "CORRUPT",
      `A compressed part does not unpack: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One entry's bytes, unpacked. */
async function entryData(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = e.localOffset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== LOC_SIG) {
    throw new XlsxError("CORRUPT", "A local file header is damaged.");
  }
  if (e.flags & 0x1) {
    throw new XlsxError("UNSUPPORTED", "The workbook is encrypted.");
  }
  // The local header's own name and extra lengths — they may differ from the
  // central directory's copy, and the data starts after THESE.
  const start =
    p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const end = start + e.compressedSize;
  if (end > bytes.length) {
    throw new XlsxError("CORRUPT", "The file is truncated.");
  }
  const data = bytes.subarray(start, end);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data);
  throw new XlsxError(
    "UNSUPPORTED",
    `Compression method ${e.method} is not supported.`,
  );
}

// ---------------------------------------------------------------------------
// The XML parts
// ---------------------------------------------------------------------------

function parseXml(text: string, part: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new XlsxError("CORRUPT", `${part} is not well-formed XML.`);
  }
  return doc;
}

/**
 * Children by LOCAL name. Most writers use SpreadsheetML as the default
 * namespace (`<c>`), some prefix it (`<x:c>`), and a name lookup that only
 * matched one of the two would read an empty sheet from the other.
 */
function kids(el: Element, local: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === local);
}

function firstDeep(doc: Document | Element, local: string): Element | null {
  return doc.getElementsByTagNameNS("*", local)[0] ?? null;
}

/** Excel's escape for a control character in text: `_x000D_` is a CR. */
function unescapeText(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * The text of a string item (`<si>` or `<is>`): its own `<t>`, or its rich
 * runs' `<t>`s joined. Phonetic runs (`<rPh>`) are a reading aid Excel does
 * not display, so neither does this.
 */
function stringItem(el: Element): string {
  let out = "";
  for (const c of Array.from(el.children)) {
    if (c.localName === "t") out += c.textContent ?? "";
    else if (c.localName === "r") {
      for (const t of kids(c, "t")) out += t.textContent ?? "";
    }
  }
  return unescapeText(out);
}

/** `"AB12"` → 27. Letters only; the row digits are ignored. */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function cellValue(c: Element, shared: readonly string[]): Cell {
  const type = c.getAttribute("t");
  const v = kids(c, "v")[0]?.textContent ?? null;
  switch (type) {
    case "s": {
      const i = v === null ? NaN : Number(v);
      return Number.isInteger(i) ? (shared[i] ?? null) : null;
    }
    case "inlineStr": {
      const is = kids(c, "is")[0];
      return is ? stringItem(is) : null;
    }
    // A formula's text result, an error like "#N/A", an ISO date: text.
    case "str":
    case "e":
    case "d":
      return v === null ? null : unescapeText(v);
    case "b":
      return v === null ? null : v.trim() === "1" || v.trim() === "true";
    default: {
      // A number. The XML holds it unformatted ("1234567", "1.5E-3"), so
      // `Number` is the right reading here — there is no thousands separator
      // or locale in it to be misread.
      if (v === null || v.trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
  }
}

function sheetRows(doc: Document, shared: readonly string[]): Cell[][] {
  const data = firstDeep(doc, "sheetData");
  if (data === null) return [];
  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rowEl of kids(data, "row")) {
    const r = rowEl.getAttribute("r");
    const index = r === null ? nextRow : Number(r) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ROWS) continue;
    nextRow = index + 1;
    const cells: Cell[] = [];
    let nextCol = 0;
    for (const c of kids(rowEl, "c")) {
      const ref = c.getAttribute("r");
      const col = ref === null ? nextCol : columnIndex(ref);
      if (col < 0 || col >= MAX_COLS) continue;
      nextCol = col + 1;
      while (cells.length < col) cells.push(null);
      cells[col] = cellValue(c, shared);
    }
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return rows;
}

/** A part path joined onto the folder of the part that points at it. */
function resolvePart(base: string, target: string): string {
  const parts = (target.startsWith("/") ? [] : base.split("/").slice(0, -1))
    .concat(target.replace(/^\//, "").split("/"))
    .filter((s) => s !== "" && s !== ".");
  const out: string[] = [];
  for (const s of parts) {
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}

/** `Id` → target part, from a `.rels` document. */
function relationships(
  doc: Document,
  base: string,
): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  for (const rel of Array.from(
    doc.getElementsByTagNameNS("*", "Relationship"),
  )) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id === null || target === null) continue;
    if (rel.getAttribute("TargetMode") === "External") continue;
    out.set(id, {
      target: resolvePart(base, target),
      type: rel.getAttribute("Type") ?? "",
    });
  }
  return out;
}

const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Read every worksheet in a workbook, in the order the workbook lists them.
 *
 * Throws `XlsxError` for a file this cannot read; never returns a partial
 * workbook for one that is damaged.
 */
export async function readXlsx(
  input: ArrayBuffer | Uint8Array,
): Promise<XlsxSheet[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22) {
    throw new XlsxError("NOT_ZIP", "The file is too short to be a workbook.");
  }
  const entries = centralDirectory(bytes);
  const text = async (name: string): Promise<string | undefined> => {
    const e = entries.get(name);
    return e === undefined ? undefined : utf8.decode(await entryData(bytes, e));
  };

  // Where the workbook part is: the package's root relationship says, and
  // `xl/workbook.xml` is what every writer in practice uses when it is silent.
  let workbookPath = "xl/workbook.xml";
  const rootRels = await text("_rels/.rels");
  if (rootRels !== undefined) {
    for (const rel of relationships(
      parseXml(rootRels, "_rels/.rels"),
      "",
    ).values()) {
      if (rel.type.endsWith("/officeDocument")) workbookPath = rel.target;
    }
  }

  // The workbook's own relationships name its sheets and its string table.
  const slash = workbookPath.lastIndexOf("/");
  const relsPath = `${workbookPath.slice(0, slash + 1)}_rels/${workbookPath.slice(slash + 1)}.rels`;
  const relsXml = await text(relsPath);
  const rels =
    relsXml === undefined
      ? new Map<string, { target: string; type: string }>()
      : relationships(parseXml(relsXml, relsPath), workbookPath);

  const sharedPath =
    [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"))?.target ??
    resolvePart(workbookPath, "sharedStrings.xml");
  const sharedXml = await text(sharedPath);
  const shared =
    sharedXml === undefined
      ? []
      : Array.from(
          parseXml(sharedXml, sharedPath).getElementsByTagNameNS("*", "si"),
        ).map(stringItem);

  // The sheets, named and in order.
  const listed: { name: string; path: string }[] = [];
  const workbookXml = await text(workbookPath);
  if (workbookXml !== undefined) {
    const workbook = parseXml(workbookXml, workbookPath);
    for (const sheet of Array.from(
      workbook.getElementsByTagNameNS("*", "sheet"),
    )) {
      const rid =
        sheet.getAttributeNS(REL_NS, "id") ?? sheet.getAttribute("r:id");
      const path = rid === null ? undefined : rels.get(rid)?.target;
      if (path !== undefined && entries.has(path)) {
        listed.push({ name: sheet.getAttribute("name") ?? path, path });
      }
    }
  }
  // A workbook whose index could not be followed still has its sheets.
  if (listed.length === 0) {
    const found = [...entries.keys()]
      .map((name) => ({
        name,
        n: /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name),
      }))
      .filter((x): x is { name: string; n: RegExpExecArray } => x.n !== null)
      .sort((a, b) => Number(a.n[1]) - Number(b.n[1]));
    for (const f of found)
      listed.push({ name: `Sheet${f.n[1]}`, path: f.name });
  }
  if (listed.length === 0) {
    throw new XlsxError("NOT_XLSX", "The file has no worksheet in it.");
  }

  const sheets: XlsxSheet[] = [];
  for (const { name, path } of listed) {
    const xml = await text(path);
    if (xml === undefined) continue;
    sheets.push({ name, rows: sheetRows(parseXml(xml, path), shared) });
  }
  return sheets;
}
