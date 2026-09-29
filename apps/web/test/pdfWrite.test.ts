/**
 * The hand-written PDF (owner ask 2026-09-21).
 *
 * The output is uncompressed on purpose, so these tests read the file back as
 * text and check the two things a reader will refuse a document over: the
 * cross-reference offsets, and the stream lengths. Both are byte counts, and
 * both fail silently — a PDF with a wrong `startxref` opens in some readers
 * and in none of the others.
 */
import { describe, expect, it } from "vitest";
import {
  encodeText,
  fitText,
  pdfDate,
  pdfTable,
  widthOf,
  type PdfTableDoc,
} from "../src/lib/pdfWrite.js";

const NOW = new Date("2026-09-21T10:30:00");

function doc(over: Partial<PdfTableDoc> = {}): PdfTableDoc {
  return {
    title: "PERSEDIAAN BARANG",
    pageSize: "A4",
    columnWidths: [40, 10, 20],
    head: [
      { kind: "text", text: "Macbook Nusantara", style: "title" },
      { kind: "text", text: "PERSEDIAAN BARANG", style: "bold" },
      { kind: "gap" },
    ],
    heading: [
      { text: "Unit", style: "header" },
      { text: "Qty", style: "headerNum" },
      { text: "Gudang", style: "header" },
    ],
    body: [
      {
        kind: "row",
        cells: [
          { text: 'AIR 13" 2020 I5 8/256' },
          { text: "3", style: "num" },
          { text: "Gudang Pusat" },
        ],
      },
    ],
    now: NOW,
    ...over,
  };
}

const read = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("the file a reader is handed", () => {
  it("starts with a PDF header and ends with the trailer", () => {
    const text = read(pdfTable(doc()));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("points startxref at the xref table's own byte offset", () => {
    // The one number a reader follows first. Wrong, and the document does not
    // open at all in the readers that check it.
    const bytes = pdfTable(doc());
    const text = read(bytes);
    const at = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(at, at + 4)).toBe("xref");
  });

  it("gives every object the offset the xref table claims", () => {
    const text = read(pdfTable(doc()));
    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text)!;
    const count = Number(table[1]);
    const lines = table[2]!.trimEnd().split("\n");
    expect(lines).toHaveLength(count);
    // Entry 0 is the free head of the list; 1..n are the objects.
    lines.slice(1).forEach((line, i) => {
      const at = Number(line.slice(0, 10));
      expect(text.slice(at, at + String(i + 1).length + 6)).toBe(
        `${i + 1} 0 obj`,
      );
    });
  });

  it("declares each content stream's real length", () => {
    const text = read(pdfTable(doc()));
    const streams = [
      ...text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g),
    ];
    expect(streams.length).toBeGreaterThan(0);
    for (const [, declared, body] of streams) {
      expect(body!.length).toBe(Number(declared));
    }
  });

  it("writes the text it was given, and the heading on the page", () => {
    const text = read(pdfTable(doc()));
    expect(text).toContain("(Macbook Nusantara) Tj");
    expect(text).toContain('(AIR 13\\" 2020 I5 8/256) Tj'.replace('\\"', '"'));
    expect(text).toContain("(Gudang) Tj");
  });

  it("numbers every page, and says how many there are", () => {
    const one = read(pdfTable(doc()));
    expect(one).toContain("(1 / 1) Tj");
  });
});

describe("pagination", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      kind: "row" as const,
      cells: [{ text: `Row ${i}` }, { text: String(i) }, { text: "Pusat" }],
    }));

  it("breaks onto a second page and repeats the heading", () => {
    const text = read(pdfTable(doc({ body: rows(120) })));
    expect(/\/Type \/Pages \/Count (\d+)/.exec(text)![1]).not.toBe("1");
    // The heading is drawn once per page, so it appears as many times as
    // there are pages.
    const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(text)![1]);
    const headings = [...text.matchAll(/\(Gudang\) Tj/g)].length;
    expect(headings).toBe(pages);
  });

  it("puts a footer with the page number on each page", () => {
    const text = read(pdfTable(doc({ body: rows(120), footer: "Dicetak" })));
    const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(text)![1]);
    for (let i = 1; i <= pages; i += 1) {
      const dot = String.fromCharCode(0xb7);
      expect(text).toContain(`Dicetak  ${dot}  ${i} / ${pages}) Tj`);
    }
  });
});

describe("text that a font cannot carry", () => {
  it("escapes the three characters a PDF literal reserves", () => {
    expect(encodeText("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
  });

  it("keeps the punctuation this app actually prints", () => {
    // The en dash of a price range, and the × of a counted line.
    expect(encodeText("4.500.000 – 5.100.000")).toBe(
      `4.500.000 ${String.fromCharCode(0x96)} 5.100.000`,
    );
    expect(encodeText("×3")).toBe(`${String.fromCharCode(0xd7)}3`);
  });

  it("replaces anything else rather than writing a byte nobody can read", () => {
    // A product name somebody pasted an emoji into must not produce a file no
    // reader will open.
    expect(encodeText("Air 😀")).toBe("Air ?");
  });
});

describe("measuring and fitting", () => {
  it("measures Helvetica, not a monospaced guess", () => {
    // `i` is narrow and `W` is wide; a monospaced guess would call them equal.
    expect(widthOf("i", 10, false)).toBeLessThan(widthOf("W", 10, false));
    // 10pt Helvetica space is 278/1000 em.
    expect(widthOf(" ", 10, false)).toBeCloseTo(2.78, 5);
  });

  it("leaves a string that fits alone", () => {
    expect(fitText("Air 13", 200, 9, false)).toBe("Air 13");
  });

  it("cuts one that does not, and says it cut", () => {
    const cut = fitText('MacBook Pro 16" 2019 i9 64/8TB', 40, 9, false);
    expect(cut.endsWith("...")).toBe(true);
    expect(widthOf(cut, 9, false)).toBeLessThanOrEqual(40);
  });

  it("gives back nothing rather than an ellipsis alone", () => {
    expect(fitText("Anything", 2, 9, false)).toBe("");
  });
});

describe("pdfDate", () => {
  it("writes the local clock with its offset", () => {
    // The shop's day, not UTC's: a report printed at seven in the morning in
    // Jakarta must not be dated yesterday.
    expect(pdfDate(new Date("2026-09-21T10:30:00"))).toMatch(
      /^D:20260921103000[+-]\d\d'\d\d'$/,
    );
  });
});
