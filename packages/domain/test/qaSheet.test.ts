import { describe, expect, it } from "vitest";
import { parseCsv, qaFromRows } from "../src/index.js";

describe("qaFromRows", () => {
  it("reads column A as the question and column B as the answer", () => {
    expect(
      qaFromRows([
        ["Cod bisa ga kak?", "Bisa kak 😊"],
        ["Garansi berapa lama?", "1 bulan ya kak"],
      ]).pairs,
    ).toEqual([
      { question: "Cod bisa ga kak?", answer: "Bisa kak 😊" },
      { question: "Garansi berapa lama?", answer: "1 bulan ya kak" },
    ]);
  });

  it("does not import a header row as an answer", () => {
    const sheet = qaFromRows([
      ["Question", "Answer"],
      ["Cod bisa ga kak?", "Bisa kak"],
    ]);
    expect(sheet.pairs).toEqual([
      { question: "Cod bisa ga kak?", answer: "Bisa kak" },
    ]);
  });

  it("follows the header to its columns, wherever they are", () => {
    const sheet = qaFromRows([
      [],
      ["No", "Jawaban", "Pertanyaan"],
      [1, "Bisa kak", "Cod bisa ga kak?"],
    ]);
    expect(sheet.pairs).toEqual([
      { question: "Cod bisa ga kak?", answer: "Bisa kak" },
    ]);
  });

  it("keeps a first row that only looks like a question", () => {
    // "Bisa tanya stok?" contains a header word and is not a header.
    const sheet = qaFromRows([["Bisa tanya stok?", "Jawaban kami: bisa kak"]]);
    expect(sheet.pairs).toHaveLength(1);
  });

  it("reports a question with no answer and does not import it", () => {
    const sheet = qaFromRows([
      ["Cod bisa ga kak?", "Bisa kak"],
      ["Bisa nego?", "  "],
      ["", "an answer to nothing"],
      [null, null],
    ]);
    expect(sheet.pairs).toHaveLength(1);
    expect(sheet.unanswered).toEqual(["Bisa nego?"]);
  });

  it("takes the first of a repeated question and reports the rest", () => {
    const sheet = qaFromRows([
      ["Cod bisa ga kak?", "Bisa kak"],
      ["COD bisa ga, kak ??", "Tidak bisa"],
    ]);
    expect(sheet.pairs).toEqual([
      { question: "Cod bisa ga kak?", answer: "Bisa kak" },
    ]);
    expect(sheet.repeated).toEqual(["COD bisa ga, kak ??"]);
  });

  it("reads a number or a boolean cell as the text it shows", () => {
    expect(qaFromRows([["Garansi berapa hari?", 30]]).pairs[0]?.answer).toBe(
      "30",
    );
  });

  it("is empty for an empty sheet", () => {
    expect(qaFromRows([])).toEqual({ pairs: [], unanswered: [], repeated: [] });
    expect(qaFromRows([[], [null, ""]]).pairs).toEqual([]);
  });
});

describe("parseCsv", () => {
  it("splits on commas and line breaks", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a comma, a line break and a quote inside a quoted cell", () => {
    expect(
      parseCsv(
        'Question,Answer\n"Cod, bisa?","Bisa kak\nArea ""Jabodetabek"""',
      ),
    ).toEqual([
      ["Question", "Answer"],
      ["Cod, bisa?", 'Bisa kak\nArea "Jabodetabek"'],
    ]);
  });

  it("reads the semicolons Excel writes on an Indonesian machine", () => {
    expect(parseCsv("Pertanyaan;Jawaban\r\nCod bisa?;Bisa, kak\r\n")).toEqual([
      ["Pertanyaan", "Jawaban"],
      ["Cod bisa?", "Bisa, kak"],
    ]);
  });

  it("looks past a line break inside a quoted first cell for the separator", () => {
    // A question typed over two lines: the first line of the FILE ends after
    // the semicolon, not at the break inside the quotes.
    expect(parseCsv('"Garansi\nberapa lama?";"1 bulan, kak"\n')).toEqual([
      ["Garansi\nberapa lama?", "1 bulan, kak"],
    ]);
  });

  it("reads tabs, and drops the byte-order mark Excel adds", () => {
    expect(parseCsv("\uFEFFq\ta\nx\ty")).toEqual([
      ["q", "a"],
      ["x", "y"],
    ]);
  });

  it("goes straight into qaFromRows", () => {
    expect(
      qaFromRows(parseCsv('Question,Answer\n"Garansi?","1 bulan\nya kak"\n'))
        .pairs,
    ).toEqual([{ question: "Garansi?", answer: "1 bulan\nya kak" }]);
  });
});
