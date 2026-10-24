import { describe, expect, it } from "vitest";
import {
  knowledgeWorkbook,
  planKnowledgeImport,
  readKnowledgeFile,
} from "../src/lib/knowledgeSheet.js";
import { xlsxFile } from "../src/lib/xlsxWrite.js";

const BASE = [
  { id: "k1", question: "Cod bisa ga kak?", answer: "Bisa kak 😊" },
  { id: "k2", question: "Garansi berapa lama?", answer: "1 bulan ya kak" },
];

/** What `File` gives the reader, without needing a DOM `File`. */
const file = (name: string, bytes: Uint8Array) => ({
  name,
  arrayBuffer: async () =>
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
});

describe("planKnowledgeImport", () => {
  it("sorts a sheet into new, changed and unchanged", () => {
    const rows = planKnowledgeImport(
      [
        { question: "COD bisa ga, kak ??", answer: "Bisa kak 😊" },
        { question: "Garansi berapa lama?", answer: "3 bulan ya kak" },
        { question: "Bisa tukar tambah?", answer: "Bisa kak" },
      ],
      BASE,
    );
    expect(rows.map((r) => r.state)).toEqual(["same", "changed", "new"]);
    expect(rows[1]).toMatchObject({ id: "k2", current: "1 bulan ya kak" });
    expect(rows[2]?.id).toBeUndefined();
  });

  it("does not call a different line ending a different answer", () => {
    const rows = planKnowledgeImport(
      [{ question: "Cod bisa ga kak?", answer: "Bisa kak 😊\r\n" }],
      BASE,
    );
    expect(rows[0]?.state).toBe("same");
  });
});

describe("readKnowledgeFile", () => {
  it("reads a CSV by its name", async () => {
    const sheet = await readKnowledgeFile(
      file(
        "answers.csv",
        new TextEncoder().encode('Question;Answer\n"Cod bisa?";"Bisa, kak"\n'),
      ),
    );
    expect(sheet.pairs).toEqual([
      { question: "Cod bisa?", answer: "Bisa, kak" },
    ]);
  });

  it("reads back the workbook the page downloads, line breaks included", async () => {
    const base = [
      ...BASE,
      { id: "k3", question: "Alamat toko?", answer: "Jl. Contoh 1\nJakarta" },
    ];
    const sheet = await readKnowledgeFile(
      file("knowledge.xlsx", xlsxFile(knowledgeWorkbook(base))),
    );
    expect(sheet.pairs).toEqual(
      base.map(({ question, answer }) => ({ question, answer })),
    );
    expect(
      planKnowledgeImport(sheet.pairs, base).every((r) => r.state === "same"),
    ).toBe(true);
  });

  it("downloads an empty base as a template of two headings", async () => {
    const sheet = await readKnowledgeFile(
      file("knowledge.xlsx", xlsxFile(knowledgeWorkbook([]))),
    );
    expect(sheet).toEqual({ pairs: [], unanswered: [], repeated: [] });
  });
});
