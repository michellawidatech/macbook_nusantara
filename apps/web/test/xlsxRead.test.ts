/**
 * Reading an .xlsx without a dependency (owner brief 2026-09-19). See
 * `lib/xlsxRead.ts`. Every workbook here is built byte by byte by
 * `xlsxFixture.ts`, stored or deflated, because there is no sample file and a
 * binary fixture would be unreviewable.
 */
import { describe, expect, it } from "vitest";
import { columnIndex, readXlsx, XlsxError } from "../src/lib/xlsxRead.js";
import { workbook, zip } from "./xlsxFixture.js";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A one-sheet workbook whose sheet XML the test writes by hand. */
function rawSheet(sheetXml: string, sharedXml?: string): Uint8Array {
  const rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const office =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip([
    {
      name: "xl/workbook.xml",
      data: `<workbook xmlns="${MAIN}" xmlns:r="${office}"><sheets><sheet name="Only" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    ...(sharedXml === undefined
      ? []
      : [{ name: "xl/sharedStrings.xml", data: sharedXml }]),
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ]);
}

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await readXlsx(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(XlsxError);
    return (e as XlsxError).code;
  }
  throw new Error("expected the workbook to be refused");
}

describe("readXlsx", () => {
  it("reads shared strings and numbers from a deflated workbook", async () => {
    const sheets = await readXlsx(
      workbook([
        {
          name: "Income",
          rows: [
            ["No. Pesanan", "Total Penghasilan"],
            ["2409153VKQ8NH5", 8_850_000],
            ["240916ABCD1234", 1234.5],
          ],
        },
      ]),
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.name).toBe("Income");
    expect(sheets[0]!.rows).toEqual([
      ["No. Pesanan", "Total Penghasilan"],
      ["2409153VKQ8NH5", 8_850_000],
      ["240916ABCD1234", 1234.5],
    ]);
  });

  it("reads a STORED workbook with inline strings the same way", async () => {
    const sheets = await readXlsx(
      workbook(
        [{ name: "S", rows: [[{ inline: "Order ID" }, 42, true, false]] }],
        { method: 0 },
      ),
    );
    expect(sheets[0]!.rows).toEqual([["Order ID", 42, true, false]]);
  });

  it("places cells and rows by their reference, leaving gaps empty", async () => {
    // A writer is free to omit empty cells and rows; `rows[i][j]` must still
    // be row i + 1, column j, or the column pickers point at the wrong cell.
    const sheets = await readXlsx(
      rawSheet(
        `<worksheet xmlns="${MAIN}"><sheetData>` +
          `<row r="2"><c r="C2"><v>7</v></c><c r="A2"><v>1</v></c></row>` +
          `<row r="4"><c r="B4" t="inlineStr"><is><t>x</t></is></c></row>` +
          `</sheetData></worksheet>`,
      ),
    );
    const rows = sheets[0]!.rows;
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual([]);
    // C2 then A2, out of order on purpose: the reference wins.
    expect(rows[1]![0]).toBe(1);
    expect(rows[1]![2]).toBe(7);
    expect(rows[2]).toEqual([]);
    expect(rows[3]).toEqual([null, "x"]);
  });

  it("joins rich-text runs, leaves out phonetic ones and unescapes _xHHHH_", async () => {
    const sheets = await readXlsx(
      rawSheet(
        `<worksheet xmlns="${MAIN}"><sheetData><row r="1">` +
          `<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>` +
          `</row></sheetData></worksheet>`,
        `<sst xmlns="${MAIN}">` +
          `<si><r><t>Total </t></r><r><t>Penghasilan</t></r><rPh><t>ignored</t></rPh></si>` +
          `<si><t>line_x000D_break</t></si>` +
          `</sst>`,
      ),
    );
    expect(sheets[0]!.rows[0]).toEqual(["Total Penghasilan", "line\rbreak"]);
  });

  it("reads a sheet whose elements carry a namespace prefix", async () => {
    // Some writers emit <x:c> rather than <c>; a lookup by qualified name
    // would read an empty sheet from them.
    const sheets = await readXlsx(
      rawSheet(
        `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1">` +
          `<x:c r="A1" t="inlineStr"><x:is><x:t>No. Pesanan</x:t></x:is></x:c>` +
          `<x:c r="B1"><x:v>5</x:v></x:c>` +
          `</x:row></x:sheetData></x:worksheet>`,
      ),
    );
    expect(sheets[0]!.rows[0]).toEqual(["No. Pesanan", 5]);
  });

  it("keeps formula text, errors and blank values apart", async () => {
    const sheets = await readXlsx(
      rawSheet(
        `<worksheet xmlns="${MAIN}"><sheetData><row r="1">` +
          `<c r="A1" t="str"><f>A2&amp;""</f><v>SN-1</v></c>` +
          `<c r="B1" t="e"><v>#N/A</v></c>` +
          `<c r="C1"><v></v></c>` +
          `<c r="D1"><f>1+1</f><v>2</v></c>` +
          `</row></sheetData></worksheet>`,
      ),
    );
    expect(sheets[0]!.rows[0]).toEqual(["SN-1", "#N/A", null, 2]);
  });

  it("lists every sheet by name, in workbook order, whatever the part is called", async () => {
    const sheets = await readXlsx(
      workbook([
        { name: "Ringkasan", rows: [["Total", 1]], file: "summary.xml" },
        { name: "Penghasilan", rows: [["No. Pesanan"]], file: "income.xml" },
      ]),
    );
    expect(sheets.map((s) => s.name)).toEqual(["Ringkasan", "Penghasilan"]);
    expect(sheets[1]!.rows[0]).toEqual(["No. Pesanan"]);
  });

  it("finds the end record past an archive comment that mimics one", async () => {
    // "PK\x05\x06" inside the comment is a false signature; its comment length
    // does not reach the end of the file, so the reader keeps looking.
    const base = workbook([{ name: "S", rows: [[1]] }]);
    const fake = "PK\u0005\u0006 not really the end";
    const withComment = await readXlsx(appendComment(base, fake));
    expect(withComment[0]!.rows).toEqual([[1]]);
  });

  it("refuses what is not a workbook, naming why", async () => {
    // An old binary .xls, a CSV renamed — not a ZIP at all.
    expect(
      await refusal(
        new TextEncoder().encode("No. Pesanan,Total\n1,2\n".repeat(3)),
      ),
    ).toBe("NOT_ZIP");
    // A ZIP with no worksheet in it.
    expect(await refusal(zip([{ name: "readme.txt", data: "hello" }]))).toBe(
      "NOT_XLSX",
    );
    // A part that claims to be deflated and does not inflate.
    expect(
      await refusal(
        zip([
          {
            name: "xl/worksheets/sheet1.xml",
            data: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x13]),
            method: 0,
            declaredMethod: 8,
          },
        ]),
      ),
    ).toBe("CORRUPT");
    // An encrypted part.
    expect(
      await refusal(
        zip([{ name: "xl/worksheets/sheet1.xml", data: "<x/>", flags: 0x1 }]),
      ),
    ).toBe("UNSUPPORTED");
  });
});

describe("columnIndex", () => {
  it("reads the letters of a reference", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("AB12")).toBe(27);
    expect(columnIndex("xfd1")).toBe(16_383);
  });
});

/** The same archive, with `comment` as its archive comment. */
function appendComment(bytes: Uint8Array, comment: string): Uint8Array {
  const c = new TextEncoder().encode(comment);
  const out = new Uint8Array(bytes.length + c.length);
  out.set(bytes, 0);
  out.set(c, bytes.length);
  // The end record is the last 22 bytes of `bytes`; its comment length is at
  // offset 20.
  new DataView(out.buffer).setUint16(bytes.length - 22 + 20, c.length, true);
  return out;
}
