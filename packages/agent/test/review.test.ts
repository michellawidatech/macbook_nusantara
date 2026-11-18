/**
 * The chatbot audit's reviewer prompt and the reading of its answer
 * (2026-11-18) — pure, no model.
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_CATEGORIES,
  buildReviewPrompt,
  readReview,
} from "../src/index.js";

const at = new Date("2026-11-18T07:00:00.000Z");
const prompt = buildReviewPrompt({
  lines: [
    { messageId: "wm_a", at, who: "customer", text: "mau cari\nmacbook" },
    { messageId: "wm_a", at, who: "bot", text: "Air 2014, 2,3jt" },
    { messageId: "wm_b", at, who: "customer", text: "garansi?" },
    { messageId: "wm_b", at, who: "staff", text: "1 bulan kak" },
  ],
  units: [
    {
      serial: "AIR14A",
      label: 'MacBook Air 13" 2014 4/128',
      grade: "A",
      price: "Rp 2.300.000",
      status: "TERSEDIA",
      battery: "201 cycles",
    },
  ],
  earlier: "Mau: laptop kuliah",
  tester: true,
});

describe("the reviewer's prompt", () => {
  it("labels every line with a short handle, who said it and when (Jakarta)", () => {
    expect(prompt.user).toContain(
      "[m1 customer 18 Nov, 14:00] mau cari / macbook",
    );
    expect(prompt.user).toContain("[m1 bot 18 Nov, 14:00] Air 2014, 2,3jt");
    expect(prompt.user).toContain("[m2 staff");
    expect([...prompt.handles]).toEqual([
      ["m1", "wm_a"],
      ["m2", "wm_b"],
    ]);
  });

  it("carries the units as they read now, the earlier summary and the tester note", () => {
    expect(prompt.user).toMatch(
      /AIR14A: MacBook Air 13" 2014 4\/128, grade A, price Rp 2\.300\.000, battery 201 cycles, status TERSEDIA/,
    );
    expect(prompt.user).toContain("may have changed since");
    expect(prompt.user).toContain("Mau: laptop kuliah");
    expect(prompt.user).toContain("TESTER");
  });

  it("gives the seven categories, the shop's rules and its facts", () => {
    for (const c of REVIEW_CATEGORIES)
      expect(prompt.system).toContain(`- ${c}:`);
    expect(prompt.system).toContain("The shop's rules for the bot:");
    expect(prompt.system).toMatch(/Opening hours: 10\.00–20\.00 WIB/);
    expect(prompt.system).toContain("never flag a staff line");
  });
});

describe("reading the reviewer's answer", () => {
  it("keeps good flags, maps handles back and drops what names nothing in the window", () => {
    const flags = readReview(
      JSON.stringify({
        flags: [
          {
            category: "MISSED_SALE",
            severity: "BAD",
            message: "m1",
            quote: "Air 2014",
            suggestion: "Ask first.",
          },
          {
            category: "TONE",
            severity: "IMPROVE",
            message: "m9",
            quote: "x",
            suggestion: "y",
          },
          {
            category: "NOPE",
            severity: "BAD",
            message: "m1",
            quote: "x",
            suggestion: "y",
          },
          {
            category: "TONE",
            severity: "BAD",
            message: "m1",
            quote: "",
            suggestion: "y",
          },
        ],
      }),
      prompt.handles,
    );
    expect(flags).toEqual([
      {
        category: "MISSED_SALE",
        severity: "BAD",
        messageId: "wm_a",
        quote: "Air 2014",
        suggestion: "Ask first.",
      },
    ]);
  });

  it("is null when the answer is not the JSON asked for", () => {
    expect(readReview("not json", prompt.handles)).toBeNull();
    expect(readReview("{}", prompt.handles)).toBeNull();
    expect(readReview('{"flags":[]}', prompt.handles)).toEqual([]);
  });
});
