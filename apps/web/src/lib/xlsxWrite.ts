/**
 * A one-sheet .xlsx file, written by hand (owner ask 2026-09-19: *"export
 * stock to Excel"*).
 *
 * ## Why not a library
 *
 * The same reason `lib/code128.ts` is written out: the job is small and the
 * format is public. An .xlsx is a ZIP of a handful of XML parts, and a stock
 * report needs strings, numbers, a bold row and column widths — nothing a
 * spreadsheet library earns its weight for. SheetJS is several hundred
 * kilobytes shipped to every till for one button on one page, and its
 * community build has been off npm since 2023, so "installing it" means
 * pinning a tarball from somebody's CDN. Neither is worth one report.
 *
 * ## What is written
 *
 * - **The ZIP is STORED** — no compression. Deflate is the only part of a ZIP
 *   worth a library, and a stock sheet is a few tens of kilobytes either way.
 *   Every reader of the format (Excel, Numbers, LibreOffice, Google Sheets)
 *   accepts stored entries; they are in the ZIP spec from its first version.
 * - **Strings are inline** (`t="inlineStr"`), not a shared-string table. A
 *   shared table is Excel's own space optimisation, and optional: one fewer
 *   part to get wrong, at the cost of some bytes nobody will notice.
 * - **Numbers are numbers.** Rupiah go in as numeric cells with a thousands
 *   format, so the bookkeeper can sum a column without first converting text.
 * - **A fixed palette of styles** (`XlsxStyle`) rather than a style builder:
 *   a report asks for a handful and naming them keeps `styles.xml` a constant
 *   that can be read at a glance.
 *
 * Pure: no DOM, no React. The page turns the bytes into a `Blob`. The spec is
 * `test/xlsxWrite.test.ts`, which unzips its own output and reads it back.
 */

/** What a cell holds. `null`/`undefined` is an empty cell. */
export type XlsxValue = string | number | null | undefined;

/**
 * The styles a sheet can use — index order is `cellXfs` order in
 * `styles.xml`, which is what a cell's `s` attribute points at.
 */
export const XLSX_STYLES = [
  /** Plain text. */
  "default",
  /** Bold. */
  "bold",
  /** Bold at 14pt — a report's first line. */
  "title",
  /** Grey italic at 10pt — a footnote, the printed-at line. */
  "muted",
  /** A column heading: bold with a rule under it. */
  "header",
  /** A heading over a number column: the same, right-aligned. */
  "headerNum",
  /** A group's opening row: bold on a light grey band. */
  "group",
  /** A number on that band. */
  "groupNum",
  /** A whole number with thousands separators — money, quantities. */
  "num",
  /** The same, bold — a total. */
  "numBold",
] as const;

export type XlsxStyle = (typeof XLSX_STYLES)[number];

/** A cell with a style. A bare value is the same with `"default"` (or `"num"`). */
export interface XlsxCell {
  readonly v: XlsxValue;
  readonly s?: XlsxStyle;
}

export type XlsxRow = readonly (XlsxValue | XlsxCell)[];

export interface XlsxSheet {
  /** The tab's name. Excel refuses `[]:*?/\` and anything past 31 characters. */
  readonly name: string;
  readonly rows: readonly XlsxRow[];
  /** Column widths in characters, column A first. */
  readonly columnWidths?: readonly number[];
  /** Keep this many rows on screen while the rest scrolls (a frozen pane). */
  readonly freezeRows?: number;
  /** Print one page wide, as many pages tall as it takes, on A4. */
  readonly fitToWidth?: boolean;
}

/** The media type a browser should hand the file over as. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Excel's own ceiling on one cell's text. */
const MAX_CELL_TEXT = 32_767;

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = Math.floor(index);
  if (n < 0) throw new RangeError(`no column ${index}`);
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Text as XML character data.
 *
 * The five entities, plus dropping what XML 1.0 cannot hold at all — the C0
 * control characters other than tab, newline and carriage return. A serial or
 * a description pasted from somewhere else can carry one, and a single
 * `\u0007` makes Excel declare the whole file corrupt.
 */
export function xmlText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

/** A name Excel will accept for a tab. */
export function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return (clean || "Sheet1").slice(0, 31);
}

function cellOf(raw: XlsxValue | XlsxCell): XlsxCell {
  return raw !== null && typeof raw === "object" ? raw : { v: raw };
}

function cellXml(ref: string, raw: XlsxValue | XlsxCell): string {
  const { v, s } = cellOf(raw);
  const style = s === undefined ? "" : ` s="${XLSX_STYLES.indexOf(s)}"`;
  if (typeof v === "number") {
    // NaN and Infinity have no spelling in a cell; an empty cell is honest.
    if (!Number.isFinite(v)) return style ? `<c r="${ref}"${style}/>` : "";
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  if (v === null || v === undefined || v === "") {
    // A styled empty cell still paints — it is how a band spans a row.
    return style ? `<c r="${ref}"${style}/>` : "";
  }
  const text = xmlText(v.slice(0, MAX_CELL_TEXT));
  // Excel trims a string's outer whitespace unless told not to.
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL =
  "http://schemas.openxmlformats.org/package/2006/relationships";

/** `xl/worksheets/sheet1.xml`. Element order is the schema's, and it matters. */
export function worksheetXml(sheet: XlsxSheet): string {
  const parts: string[] = [];
  if (sheet.fitToWidth) {
    parts.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  }
  const freeze = Math.max(0, Math.floor(sheet.freezeRows ?? 0));
  parts.push(
    freeze > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freeze + 1}" sqref="A${freeze + 1}"/></sheetView></sheetViews>`
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
  );
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  const widths = sheet.columnWidths ?? [];
  if (widths.length > 0) {
    parts.push(
      "<cols>" +
        widths
          .map(
            (w, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, Math.min(255, w))}" customWidth="1"/>`,
          )
          .join("") +
        "</cols>",
    );
  }
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => cellXml(`${columnLetter(c)}${r + 1}`, cell))
        .join("");
      // An empty row is left out altogether; the numbering carries the gap.
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  parts.push(`<sheetData>${rows}</sheetData>`);
  parts.push(
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>',
  );
  if (sheet.fitToWidth) {
    parts.push(
      '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>',
    );
  }
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${parts.join("")}</worksheet>`;
}

/**
 * `xl/styles.xml` — the palette `XLSX_STYLES` names, in the same order.
 *
 * numFmtId 3 is Excel's built-in `#,##0`: grouped thousands, no decimals, in
 * whatever separator the reader's own locale uses — `1.500.000` in an
 * Indonesian Excel, which is how the shop reads rupiah.
 */
export const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF7F7F7F"/><name val="Calibri"/><family val="2"/></font>' +
  "</fonts>" +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="2">' +
  "<border><left/><right/><top/><bottom/><diagonal/></border>" +
  '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  `<cellXfs count="${XLSX_STYLES.length}">` +
  // default
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  // bold
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  // title
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  // muted
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  // header
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
  // headerNum
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
  // group
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  // groupNum
  '<xf numFmtId="3" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
  // num
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  // numBold
  '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** The package parts of a one-sheet workbook, in the order they are zipped. */
export function xlsxParts(
  sheet: XlsxSheet,
): { readonly name: string; readonly text: string }[] {
  return [
    {
      name: "[Content_Types].xml",
      text:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      text:
        XML_HEAD +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      text:
        XML_HEAD +
        `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<sheets><sheet name="${xmlText(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets>` +
        "</workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text:
        XML_HEAD +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
        "</Relationships>",
    },
    { name: "xl/styles.xml", text: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", text: worksheetXml(sheet) },
  ];
}

/** The whole file. `modified` stamps the ZIP entries; it defaults to now. */
export function xlsxFile(
  sheet: XlsxSheet,
  modified: Date = new Date(),
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipStored(
    xlsxParts(sheet).map((p) => ({
      name: p.name,
      data: encoder.encode(p.text),
    })),
    modified,
  );
}

// ── ZIP, stored ─────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null;

/** CRC-32 as ZIP computes it (IEEE 802.3, reflected, 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what a ZIP entry carries. Local time, to
 * the even second; a year before 1980 cannot be written and is clamped.
 */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/**
 * A ZIP archive of STORED (uncompressed) entries.
 *
 * Local header + data per entry, then the central directory, then the end
 * record — the layout of APPNOTE.TXT §4.3. No data descriptors, no ZIP64
 * (a stock sheet is nowhere near 4 GB), no extra fields.
 */
export function zipStored(
  entries: readonly { readonly name: string; readonly data: Uint8Array }[],
  modified: Date = new Date(),
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(modified);
  const names = entries.map((e) => encoder.encode(e.name));
  const crcs = entries.map((e) => crc32(e.data));

  const localSize = entries.reduce(
    (n, e, i) => n + 30 + names[i]!.length + e.data.length,
    0,
  );
  const centralSize = names.reduce((n, name) => n + 46 + name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, at);
    at += b.length;
  };

  const offsets: number[] = [];
  entries.forEach((e, i) => {
    offsets.push(at);
    u32(0x04034b50); // local file header
    u16(20); // version needed: 2.0
    u16(0x0800); // flags: names are UTF-8
    u16(0); // method: stored
    u16(time);
    u16(date);
    u32(crcs[i]!);
    u32(e.data.length); // compressed = uncompressed when stored
    u32(e.data.length);
    u16(names[i]!.length);
    u16(0); // no extra field
    bytes(names[i]!);
    bytes(e.data);
  });

  const centralAt = at;
  entries.forEach((e, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by: 2.0, MS-DOS attributes
    u16(20); // version needed
    u16(0x0800);
    u16(0);
    u16(time);
    u16(date);
    u32(crcs[i]!);
    u32(e.data.length);
    u32(e.data.length);
    u16(names[i]!.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]!);
    bytes(names[i]!);
  });

  u32(0x06054b50); // end of central directory
  u16(0); // this disk
  u16(0); // disk holding the directory
  u16(entries.length);
  u16(entries.length);
  u32(centralSize); // the directory's size — the end record is not in it
  u32(centralAt);
  u16(0); // no comment
  return out;
}
