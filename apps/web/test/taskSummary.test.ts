/**
 * A hand-over's note, read as an action item (owner, 2026-10-27: *"Need …" —
 * short and concise, action items*). The worker writes it in Indonesian
 * (packages/agent tasks.ts); this screen reads it back into either language,
 * and reads the old code-carrying notes into the same wording.
 */
import { describe, expect, it } from "vitest";
import { makeT } from "../src/i18n/translate.js";
import { taskSummaryLines } from "../src/lib/taskSummary.js";

const en = makeT("en");
const id = makeT("id");

describe("an old note that named a code", () => {
  it("reads as the job and the reason, with the held draft quoted", () => {
    const note =
      'Balasan bot ditahan (AMOUNT_NOT_IN_SOURCE): "Halo kak, Air M1 nya 7jt ya"';
    expect(taskSummaryLines(en, note, "price")).toEqual({
      head: "Need price check — a figure in the draft has no source",
      quote: "Halo kak, Air M1 nya 7jt ya",
      rest: [],
    });
    expect(taskSummaryLines(id, note, "price").head).toBe(
      "Perlu cek harga — angka di draf tidak ada sumbernya",
    );
  });

  it("covers every code the checks could refuse with", () => {
    const head = (code: string) =>
      taskSummaryLines(en, `Balasan bot ditahan (${code}): "x"`, "other").head;
    expect(head("NO_SOURCE")).toBe("Need reply — no source for the answer");
    expect(head("TOO_LONG")).toBe("Need reply — draft too long");
    expect(head("AVAILABILITY_NOT_IN_SOURCE")).toBe(
      "Need stock check — stock in the draft has no source",
    );
    expect(head("UNKNOWN_SOURCE")).toMatch(/^Need reply — /);
    // The code itself is never on screen.
    for (const code of ["NO_SOURCE", "TOO_LONG", "EMPTY"])
      expect(head(code)).not.toContain(code);
  });

  it("reads a routed note by the task's topic, and the rules bot's", () => {
    expect(
      taskSummaryLines(
        en,
        'Dialihkan ke staf (price+product): "air m2 brp"',
        "price",
      ),
    ).toEqual({ head: "Need price check", quote: "air m2 brp", rest: [] });
    expect(
      taskSummaryLines(
        en,
        "Dialihkan ke staf (negotiation+product).",
        "negotiation",
      ).head,
    ).toBe("Need answer to an offer");
    expect(
      taskSummaryLines(
        en,
        'Bot (aturan) tidak bisa menjawab: "cicilan?"',
        "other",
      ),
    ).toEqual({
      head: "Need reply — the bot has no answer",
      quote: "cicilan?",
      rest: [],
    });
  });
});

describe("a note the worker writes now", () => {
  it("translates the head, keeps the unit, and keeps the quote apart", () => {
    const note =
      'Perlu cek harga — Air 15" M2 8/256\n"air 15 m2 8/256 berapa kak?"';
    expect(taskSummaryLines(en, note, "price")).toEqual({
      head: 'Need price check — Air 15" M2 8/256',
      quote: "air 15 m2 8/256 berapa kak?",
      rest: [],
    });
    expect(taskSummaryLines(id, note, "price").head).toBe(
      'Perlu cek harga — Air 15" M2 8/256',
    );
  });

  it("translates a known reason, also after a unit", () => {
    expect(
      taskSummaryLines(en, "Perlu dibalas — draf terlalu panjang", "other")
        .head,
    ).toBe("Need reply — draft too long");
    expect(
      taskSummaryLines(
        en,
        "Perlu kirim foto — Air M2, belum ada fotonya",
        "photos",
      ).head,
    ).toBe("Need photos sent — Air M2, no photos yet");
  });

  it("keeps a model's own note under the head", () => {
    expect(
      taskSummaryLines(
        en,
        "Perlu cek stok — Air M1\nTanya stok MacBook Air M1",
        "stock",
      ),
    ).toEqual({
      head: "Need stock check — Air M1",
      quote: null,
      rest: ["Tanya stok MacBook Air M1"],
    });
  });

  it("leaves a note it does not know as it is", () => {
    expect(taskSummaryLines(en, "Tanya stok Air M1", "stock")).toEqual({
      head: "Tanya stok Air M1",
      quote: null,
      rest: [],
    });
  });
});
