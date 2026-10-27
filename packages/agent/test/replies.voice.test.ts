/**
 * How the rules bot sounds (owner, 2026-10-27: *"the reply so bad, not like
 * human"*): a shop admin texting — short, "kak", "aku", condition words and
 * "11,9jt" — and still only what a lookup returned.
 */
import { describe, expect, it } from "vitest";
import { reply, shortPrice, unitLine } from "../src/rules/replies.js";

const AIR = {
  serial: "C02AIRM2XX",
  model: "MacBook Air M2",
  variant: "8/256",
  grade: "A",
  price: "Rp 11.900.000",
  batteryHealth: 92,
};

describe("prices as people text them", () => {
  it.each([
    ["Rp 11.900.000", "11,9jt"],
    ["Rp 15.000.000", "15jt"],
    ["Rp 15.500.000", "15,5jt"],
    ["Rp 11.950.000", "11,95jt"],
    ["Rp 850.000", "850rb"],
    // Not exact in short form: left whole rather than rounded.
    ["Rp 11.925.500", "Rp11.925.500"],
  ])("%s → %s", (price, short) => {
    expect(shortPrice(price)).toBe(short);
  });
});

describe("a unit, said the way the counter says it", () => {
  it("is the short name, the condition in words, the battery and the price", () => {
    expect(unitLine(AIR, "id", undefined, { variant: false })).toBe(
      "Air M2 mulus, baterai 92%, 11,9jt",
    );
    expect(unitLine({ ...AIR, grade: "NEW" }, "id")).toBe(
      "Air M2 8/256 baru segel, baterai 92%, 11,9jt",
    );
    expect(unitLine({ ...AIR, grade: "B" }, "en")).toBe(
      "Air M2 8/256 light marks, battery 92%, 11,9jt",
    );
  });

  it("never prints a grade letter or a spec dump in a recommendation", () => {
    const text = reply.recommend(
      {
        best: AIR,
        cheaper: {
          ...AIR,
          model: "MacBook Air M1",
          grade: "B",
          price: "Rp 8.000.000",
        },
        stepUp: null,
      },
      "id",
    );
    expect(text).toBe(
      "Paling pas buat kakak Air M2 mulus, baterai 92%, 11,9jt 😊\nKalau mau lebih hemat, ada Air M1 ada lecet tipis, baterai 92%, 8jt.",
    );
    expect(text).not.toMatch(/grade|·|GB|Rp /);
  });
});

describe("the everyday lines", () => {
  it("are short and say aku, never 'admin kami'", () => {
    const lines = [
      reply.greeting("id"),
      reply.whichUnit("id"),
      reply.noPhotos("id"),
      reply.noStock("id"),
      reply.bookingFailed("id"),
      reply.passedOnToo("id"),
      reply.stillWaiting(["price"], "id"),
      reply.askForVisit({ unit: false, name: true, when: true }, "id"),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/admin kami|Mohon maaf|segera/i);
      expect(line.length).toBeLessThan(110);
    }
    expect(reply.noPhotos("id")).toBe(
      "Fotonya belum ada kak, aku fotoin dulu ya 🙏",
    );
    expect(reply.whichUnit("id")).toBe(
      "Yang mana kak? Sebutin aja tipenya, misal Air M2 😊",
    );
    expect(reply.stillWaiting(["negotiation"], "id")).toBe(
      "Soal tawarannya masih aku cekin ya kak, nanti aku kabari di sini 🙏",
    );
  });
});
