/**
 * Workbooks built byte by byte, for the tests that read them.
 *
 * There is no sample Shopee income report in the repo (owner brief
 * 2026-09-19: "I do not have a sample file"), and a binary fixture checked in
 * would be a file nobody can read in a diff. So the tests write the ZIP
 * themselves — local headers, central directory, end record — with each part
 * either STORED or DEFLATED through `node:zlib`, which is exactly the pair of
 * methods `lib/xlsxRead.ts` claims to handle.
 *
 * Not a test file: `test/xlsxRead.test.ts` and `test/shopeeIncome.test.ts`
 * both import it.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipPart {
  readonly name: string;
  readonly data: string | Uint8Array;
  /** 0 = stored, 8 = deflated. */
  readonly method?: 0 | 8;
  /** General-purpose flags, for the tests that want an odd one. */
  readonly flags?: number;
  /**
   * The method the HEADERS claim, when it should differ from how the data was
   * actually written — how a test hands the reader bytes that do not inflate.
   */
  readonly declaredMethod?: number;
}

/** A ZIP archive holding `parts`, with an optional archive comment. */
export function zip(
  parts: readonly ZipPart[],
  comment = "",
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const p of parts) {
    const raw = typeof p.data === "string" ? enc.encode(p.data) : p.data;
    const method = p.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(p.name);
    const crc = crc32(raw);
    const flags = p.flags ?? 0;
    const declared = p.declaredMethod ?? method;

    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, declared, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, declared, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const commentBytes = enc.encode(comment);
  const end = new Uint8Array(22 + commentBytes.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);

  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A cell as a test writes it. `{ xml }` is dropped into the sheet verbatim. */
export type FixtureCell =
  | string
  | number
  | boolean
  | null
  | { readonly inline: string }
  | { readonly xml: string };

export interface FixtureSheet {
  readonly name: string;
  readonly rows: readonly (readonly FixtureCell[])[];
  /** The part's file name under xl/worksheets/. Default sheetN.xml. */
  readonly file?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const colName = (i: number): string => {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * A minimal but real .xlsx: content types, the package and workbook
 * relationships, a shared-string table and one part per sheet. Strings go
 * into the shared table (as Excel writes them); `{ inline }` writes an inline
 * string instead.
 */
export function workbook(
  sheets: readonly FixtureSheet[],
  options: { readonly method?: 0 | 8 } = {},
): Uint8Array<ArrayBuffer> {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const intern = (s: string) => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };

  const sheetParts = sheets.map((sheet, si) => {
    const rows = sheet.rows
      .map((row, ri) => {
        const cells = row
          .map((cell, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (cell === null) return "";
            if (typeof cell === "number")
              return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === "boolean")
              return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
            if (typeof cell === "string")
              return `<c r="${ref}" t="s"><v>${intern(cell)}</v></c>`;
            if ("inline" in cell)
              return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.inline)}</t></is></c>`;
            return cell.xml.replace(/\{ref\}/g, ref);
          })
          .join("");
        return cells === "" ? "" : `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    return {
      name: sheet.name,
      file: sheet.file ?? `sheet${si + 1}.xml`,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}" xmlns:r="${OFFICE_REL}"><sheetData>${rows}</sheetData></worksheet>`,
    };
  });

  const method = options.method ?? 8;
  return zip(
    [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${OFFICE_REL}"><sheets>${sheetParts
          .map(
            (s, i) =>
              `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join("")}</sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELS}">${sheetParts
          .map(
            (s, i) =>
              `<Relationship Id="rId${i + 1}" Type="${OFFICE_REL}/worksheet" Target="worksheets/${s.file}"/>`,
          )
          .join(
            "",
          )}<Relationship Id="rIdS" Type="${OFFICE_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      },
      {
        name: "xl/sharedStrings.xml",
        data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN}" count="${shared.length}" uniqueCount="${shared.length}">${shared
          .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
          .join("")}</sst>`,
      },
      ...sheetParts.map((s) => ({
        name: `xl/worksheets/${s.file}`,
        data: s.xml,
      })),
    ].map((p) => ({ ...p, method })),
  );
}
