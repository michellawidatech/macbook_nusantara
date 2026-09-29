/**
 * The hand-written .xlsx (owner ask 2026-09-19, the stock export).
 *
 * The file is checked the way a reader would open it: the ZIP is walked from
 * its end record through the central directory to every local header, each
 * entry's CRC is recomputed, and the XML inside is parsed and read back. A
 * writer tested only against the strings it meant to write would pass on a
 * file Excel calls corrupt.
 */
import { describe, expect, it } from "vitest";
import {
  columnLetter,
  crc32,
  dosDateTime,
  sheetName,
  STYLES_XML,
  worksheetXml,
  xlsxFile,
  XLSX_MIME,
  XLSX_STYLES,
  xmlText,
  zipStored,
  type XlsxSheet,
} from "../src/lib/xlsxWrite.js";

const decoder = new TextDecoder();

interface Entry {
  readonly name: string;
  readonly method: number;
  readonly data: Uint8Array;
  readonly text: string;
}

/** A ZIP reader just strict enough to catch a malformed archive. */
function readZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // No archive comment is ever written, so the end record is the last 22.
  const end = bytes.length - 22;
  expect(view.getUint32(end, true), "end of central directory").toBe(
    0x06054b50,
  );
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  expect(offset + size, "directory runs up to the end record").toBe(end);

  const entries: Entry[] = [];
  let p = offset;
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(p, true), `central header ${i}`).toBe(0x02014b50);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const plain = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    expect(view.getUint32(local, true), `local header of ${name}`).toBe(
      0x04034b50,
    );
    expect(view.getUint16(local + 8, true)).toBe(method);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(compressed);
    expect(view.getUint32(local + 22, true)).toBe(plain);
    const localNameLen = view.getUint16(local + 26, true);
    const localExtraLen = view.getUint16(local + 28, true);
    expect(
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLen)),
    ).toBe(name);
    const start = local + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(start, start + compressed);
    expect(crc32(data), `CRC of ${name}`).toBe(crc);
    entries.push({ name, method, data, text: decoder.decode(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  expect(p, "nothing between the directory and its end").toBe(end);
  return entries;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  expect(
    doc.getElementsByTagName("parsererror").length,
    text.slice(0, 200),
  ).toBe(0);
  return doc;
}

const sheet: XlsxSheet = {
  name: "Persediaan",
  columnWidths: [40, 10],
  freezeRows: 2,
  fitToWidth: true,
  rows: [
    [{ v: "NUSANTARA", s: "title" }],
    [
      { v: "Unit", s: "header" },
      { v: "Qty", s: "headerNum" },
    ],
    [],
    ["MacBook Air & <Pro> \u0007", 12],
    [
      { v: "Gudang", s: "group" },
      { v: 159, s: "groupNum" },
      { v: null, s: "group" },
    ],
    ["  spaced  ", Number.NaN, null, undefined, ""],
  ],
};

describe("zipStored", () => {
  it("computes the IEEE CRC-32 ZIP uses", () => {
    // The check value every CRC-32 implementation is tested against.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes entries a reader can walk back from the end record", () => {
    const enc = new TextEncoder();
    const bytes = zipStored(
      [
        { name: "a.txt", data: enc.encode("hello") },
        { name: "dir/b.xml", data: enc.encode("<x/>") },
        { name: "empty", data: new Uint8Array() },
      ],
      new Date(2026, 8, 19, 10, 15, 30),
    );
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.xml", "empty"]);
    // Stored, not deflated: method 0 and the bytes as given.
    expect(entries.every((e) => e.method === 0)).toBe(true);
    expect(entries.map((e) => e.text)).toEqual(["hello", "<x/>", ""]);
  });

  it("stamps the entries with an MS-DOS date and time", () => {
    const { date, time } = dosDateTime(new Date(2026, 8, 19, 10, 15, 31));
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0xf).toBe(9);
    expect(date & 0x1f).toBe(19);
    expect(time >> 11).toBe(10);
    expect((time >> 5) & 0x3f).toBe(15);
    // Two-second resolution: 31 is written as 30.
    expect((time & 0x1f) * 2).toBe(30);
    // A year DOS cannot say is clamped, not wrapped.
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

describe("xlsxFile", () => {
  const entries = readZip(xlsxFile(sheet, new Date(2026, 8, 19, 10, 15)));
  const part = (name: string) => {
    const e = entries.find((x) => x.name === name);
    expect(e, name).toBeDefined();
    return e!;
  };

  it("holds exactly the parts of a one-sheet workbook, every one well-formed", () => {
    expect(entries.map((e) => e.name).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
      ].sort(),
    );
    for (const e of entries) parseXml(e.text);
  });

  it("declares a content type for every part and resolves every relationship", () => {
    const types = parseXml(part("[Content_Types].xml").text);
    const overrides = Array.from(types.getElementsByTagName("Override")).map(
      (o) => o.getAttribute("PartName"),
    );
    for (const name of [
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/styles.xml",
    ]) {
      expect(overrides).toContain(`/${name}`);
    }
    const target = (rels: string, base: string) =>
      Array.from(parseXml(part(rels).text).getElementsByTagName("Relationship"))
        .map((r) => `${base}${r.getAttribute("Target")}`)
        .forEach((t) => part(t));
    target("_rels/.rels", "");
    target("xl/_rels/workbook.xml.rels", "xl/");
  });

  it("names the sheet, and keeps a name Excel would refuse out of the file", () => {
    const wb = parseXml(part("xl/workbook.xml").text);
    expect(wb.getElementsByTagName("sheet")[0]!.getAttribute("name")).toBe(
      "Persediaan",
    );
    expect(sheetName("Stok: 19/09 [A]*?")).toBe("Stok  19 09  A");
    expect(sheetName("")).toBe("Sheet1");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
  });

  it("defines one cell style per name, in the order cells point at them", () => {
    const styles = parseXml(STYLES_XML);
    const cellXfs = styles.getElementsByTagName("cellXfs")[0]!;
    const xfs = Array.from(cellXfs.children).filter((c) => c.tagName === "xf");
    expect(Number(cellXfs.getAttribute("count"))).toBe(XLSX_STYLES.length);
    expect(xfs).toHaveLength(XLSX_STYLES.length);
    // "bold" is a bold font; "num" is the built-in #,##0 format.
    const fonts = Array.from(styles.getElementsByTagName("font"));
    const bold = xfs[XLSX_STYLES.indexOf("bold")]!;
    expect(
      fonts[Number(bold.getAttribute("fontId"))]!.getElementsByTagName("b"),
    ).toHaveLength(1);
    expect(xfs[XLSX_STYLES.indexOf("num")]!.getAttribute("numFmtId")).toBe("3");
  });

  it("writes strings inline, numbers as numbers, and styles by index", () => {
    const ws = parseXml(part("xl/worksheets/sheet1.xml").text);
    const cell = (ref: string) =>
      Array.from(ws.getElementsByTagName("c")).find(
        (c) => c.getAttribute("r") === ref,
      );
    const a1 = cell("A1")!;
    expect(a1.getAttribute("t")).toBe("inlineStr");
    expect(a1.getAttribute("s")).toBe(String(XLSX_STYLES.indexOf("title")));
    expect(a1.textContent).toBe("NUSANTARA");

    const b4 = cell("B4")!;
    expect(b4.getAttribute("t")).toBeNull();
    expect(b4.getElementsByTagName("v")[0]!.textContent).toBe("12");

    // Escaped on the way in, whole on the way out — and the BEL is gone,
    // because one control character makes Excel reject the whole file.
    expect(cell("A4")!.textContent).toBe("MacBook Air & <Pro> ");
    expect(
      cell("A6")!.getElementsByTagName("t")[0]!.getAttribute("xml:space"),
    ).toBe("preserve");
    expect(cell("A6")!.textContent).toBe("  spaced  ");

    // A styled empty cell is written — it is how a band spans a row — and an
    // unstyled one is not.
    expect(cell("C5")!.getAttribute("s")).toBe(
      String(XLSX_STYLES.indexOf("group")),
    );
    expect(cell("C5")!.childNodes).toHaveLength(0);
    for (const ref of ["B6", "C6", "D6", "E6"])
      expect(cell(ref)).toBeUndefined();
  });

  it("leaves an empty row out and keeps the numbering of the rest", () => {
    const ws = parseXml(part("xl/worksheets/sheet1.xml").text);
    const rows = Array.from(ws.getElementsByTagName("row")).map((r) =>
      r.getAttribute("r"),
    );
    expect(rows).toEqual(["1", "2", "4", "5", "6"]);
  });

  it("sets column widths, freezes the heading, and prints one page wide", () => {
    const ws = parseXml(part("xl/worksheets/sheet1.xml").text);
    const cols = Array.from(ws.getElementsByTagName("col")).map((c) => [
      c.getAttribute("min"),
      c.getAttribute("width"),
    ]);
    expect(cols).toEqual([
      ["1", "40"],
      ["2", "10"],
    ]);
    const pane = ws.getElementsByTagName("pane")[0]!;
    expect(pane.getAttribute("ySplit")).toBe("2");
    expect(pane.getAttribute("topLeftCell")).toBe("A3");
    expect(pane.getAttribute("state")).toBe("frozen");
    expect(
      ws.getElementsByTagName("pageSetup")[0]!.getAttribute("fitToWidth"),
    ).toBe("1");
    // Schema order: sheetPr first, sheetData before pageMargins.
    const order = Array.from(ws.documentElement.children).map((c) => c.tagName);
    expect(order).toEqual([
      "sheetPr",
      "sheetViews",
      "sheetFormatPr",
      "cols",
      "sheetData",
      "pageMargins",
      "pageSetup",
    ]);
  });

  it("writes a plain sheet with no pane, no widths and no page setup", () => {
    const ws = parseXml(worksheetXml({ name: "x", rows: [["a"]] }));
    expect(ws.getElementsByTagName("pane")).toHaveLength(0);
    expect(ws.getElementsByTagName("cols")).toHaveLength(0);
    expect(ws.getElementsByTagName("pageSetup")).toHaveLength(0);
  });
});

describe("the small helpers", () => {
  it("letters columns the way Excel does", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });

  it("escapes all five XML entities", () => {
    expect(xmlText(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("hands the browser the spreadsheet media type", () => {
    expect(XLSX_MIME).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
