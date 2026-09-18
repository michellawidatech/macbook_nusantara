import { describe, expect, it } from "vitest";
import { parseQaText, questionKey } from "../src/qaText.js";

describe("parseQaText", () => {
  it("reads the owner's sheet: a heading, then pairs with multi-line answers", () => {
    const { pairs, unanswered } = parseQaText(
      [
        "Lists of Questions: ",
        "Q: Cod bisa ga kak ?",
        "A: Bisa kak 😊 Untuk COD area jabodetabek bisa kami bantu.",
        "Kalau kakak berkenan, boleh info lokasi pengiriman 🙏",
        "Q:  Garansi berapa lama kak?",
        "A: Garansi dari kami 1 bulan ya kak 😊",
        "",
      ].join("\n"),
    );
    expect(unanswered).toEqual([]);
    expect(pairs).toEqual([
      {
        question: "Cod bisa ga kak ?",
        answer:
          "Bisa kak 😊 Untuk COD area jabodetabek bisa kami bantu.\nKalau kakak berkenan, boleh info lokasi pengiriman 🙏",
      },
      {
        question: "Garansi berapa lama kak?",
        answer: "Garansi dari kami 1 bulan ya kak 😊",
      },
    ]);
  });

  it("keeps a note under a question with the question, and takes any spelling of the keys", () => {
    const { pairs } = parseQaText(
      [
        "  q : Battery health nya berapa kak?",
        "(lampirkan foto macbook dengan Bh nya)",
        "Jawaban: Kami kirimkan fotonya ya kak",
        "Pertanyaan. Jam operasional?",
        "a. 10.00 – 20.00 WIB",
      ].join("\r\n"),
    );
    expect(pairs).toEqual([
      {
        question:
          "Battery health nya berapa kak?\n(lampirkan foto macbook dengan Bh nya)",
        answer: "Kami kirimkan fotonya ya kak",
      },
      { question: "Jam operasional?", answer: "10.00 – 20.00 WIB" },
    ]);
  });

  it("drops what comes before the first question, and reports a question with no answer", () => {
    const { pairs, unanswered } = parseQaText(
      ["intro line", "Q: Bisa PO?", "", "Q: Bisa kirim?", "A: Bisa kak"].join(
        "\n",
      ),
    );
    expect(pairs).toEqual([{ question: "Bisa kirim?", answer: "Bisa kak" }]);
    expect(unanswered).toEqual(["Bisa PO?"]);
  });

  it("keeps a second A: line inside the answer it belongs to", () => {
    const { pairs } = parseQaText("Q: x?\nA: first\nA: second");
    expect(pairs).toEqual([{ question: "x?", answer: "first\nA: second" }]);
  });

  it("finds nothing in text with no questions, and ignores an empty question", () => {
    expect(parseQaText("just words\nA: an orphan answer")).toEqual({
      pairs: [],
      unanswered: [],
    });
    expect(parseQaText("Q:\nA: answer to nothing")).toEqual({
      pairs: [],
      unanswered: [],
    });
  });
});

describe("questionKey", () => {
  it("ignores case, spacing, punctuation and emoji", () => {
    expect(questionKey("Cod bisa ga kak ?")).toBe(
      questionKey("cod BISA ga kak😊"),
    );
    expect(questionKey("  Garansi   berapa lama kak?? ")).toBe(
      "garansi berapa lama kak",
    );
    expect(questionKey("Élma")).toBe("elma");
  });
});
