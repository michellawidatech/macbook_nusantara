/**
 * What the bot must hand to a person whatever the model thinks, and what it
 * may never send — policy.ts, line by line, with the messages customers send.
 */
import { describe, expect, it } from "vitest";
import {
  HANDOFF_TOPICS,
  checkHoldingMessage,
  checkReply,
  dpKeepLine,
  holdingMessage,
  isHandoffTopic,
  mentionsProduct,
  moneyAmounts,
  routeMessage,
  actionKindOf,
  saysDpPaid,
  type StockFact,
} from "../src/policy.js";

const topic = (text: string, hasMedia = false) =>
  routeMessage(text, { hasMedia })?.topic ?? null;

describe("routeMessage — a named machine goes to a person", () => {
  it.each([
    ["kak air m1 ready?", "stock"],
    ["MacBook Pro M3 14 inch masih ada?", "stock"],
    ["mba 2020 8/256 ada ga kak", "stock"],
    ["harga air m2 berapa kak?", "price"],
    ["m1 pro 16/512 berapaan?", "price"],
    ["air m1 bisa kurang ga?", "negotiation"],
    ["10jt bisa nego ga", "negotiation"],
    ["kondisi pro 2019 nya gimana, ada lecet?", "unit_details"],
    ["foto real pict imac 24 dong", "unit_details"],
    ["ada m2?", "stock"],
    ["yang i5 aja kak", "stock"],
    ["air m1 8/256", "stock"],
  ])("%s → %s", (text, expected) => {
    expect(topic(text)).toBe(expected);
  });
});

describe("routeMessage — always a person, machine or not", () => {
  it.each([
    ["bh nya berapa kak?", "unit_details"],
    ["battery health berapa persen", "unit_details"],
    ["cycle count nya?", "unit_details"],
    ["baterainya masih bagus?", "unit_details"],
    ["kak saya sudah transfer ya", "order_payment"],
    ["ini bukti tf nya", "order_payment"],
    ["no resi nya berapa kak", "order_payment"],
    // Keep it / a DP / I'll take it: a person closes the sale (2026-10-27).
    ["bisa di keep dulu ga kak", "closing"],
    ["dp dulu boleh?", "closing"],
    ["oke kak saya ambil yang kedua", "closing"],
    ["minta no rek nya kak", "closing"],
    ["budget 10jt dapet apa ya", "recommendation"],
    ["dana 8 juta cukup?", "recommendation"],
  ])("%s → %s", (text, expected) => {
    expect(topic(text)).toBe(expected);
  });

  it("sends any photo, video or document to a person", () => {
    expect(topic("ini unit saya kak", true)).toBe("media");
    expect(topic("", true)).toBe("media");
  });
});

describe("routeMessage — the generic questions the owner answered stay with the bot", () => {
  it.each([
    "Apakah unitnya ready?",
    "Ada price list nya ga kak?",
    "Untuk harga udah net atau masih bisa nego kak?",
    // How to pay is in the approved answers (2026-10-27): not a hand-over.
    "cara bayarnya gimana kak?",
    "Kenapa harga di shopee/tokped lebih mahal ka?",
    "Cod bisa ga kak?",
    "bisa ganti baterai di toko?",
    "Garansi berapa lama kak?",
    "Bisa tukar tambah ga kak?",
    "jam operasional kak",
    "air m1 ram nya berapa?",
    "m1 vs m2 bedanya apa?",
    "halo kak",
  ])("%s → the bot may try", (text) => {
    expect(routeMessage(text)).toBeNull();
  });
});

describe("mentionsProduct", () => {
  it("knows a machine from the words for one, and not from the word macbook", () => {
    expect(mentionsProduct("pro 14 m3 max")).toBe(true);
    expect(mentionsProduct("yang i5 aja kak")).toBe(true);
    expect(mentionsProduct("apakah macbook nya ready")).toBe(false);
  });
});

describe("checkReply", () => {
  const cod =
    "Bisa kak 😊 Untuk COD area Jabodetabek bisa kami bantu, namun ada biaya transportasi sebesar Rp180.000 ya kak.";

  it("sends an answer that cites a source and says only what it says", () => {
    expect(
      checkReply({
        message: "Bisa kak 😊 COD Jabodetabek ada biaya Rp180.000 ya kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [cod],
      }),
    ).toBeNull();
    // The same figure written the other way is the same figure.
    expect(
      checkReply({
        message: "biaya transportasinya 180.000 kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [cod],
      }),
    ).toBeNull();
  });

  it("refuses a figure no cited source contains", () => {
    expect(
      checkReply({
        message: "Air M1 nya Rp7.500.000 kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [cod],
      }),
    ).toBe("AMOUNT_NOT_IN_SOURCE");
    expect(
      checkReply({
        message: "bisa kak, 7,5jt aja",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [cod],
      }),
    ).toBe("AMOUNT_NOT_IN_SOURCE");
  });

  it("refuses to say a machine is available unless the cited answer says so", () => {
    expect(
      checkReply({
        message: "Ready kak, masih ada 2",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: ["The shop is open every day from 10.00 to 20.00 WIB."],
      }),
    ).toBe("AVAILABILITY_NOT_IN_SOURCE");
    expect(
      checkReply({
        message: "Ready kak 😊 boleh kirim tipe yang dicari?",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [
          "Apakah unitnya ready?\nReady kak 😊 Untuk memastikan ...",
        ],
      }),
    ).toBeNull();
  });

  it("refuses a reply with no source, a source that does not exist, or nothing in it", () => {
    const base = {
      message: "Bisa kak",
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: [],
    };
    expect(checkReply({ ...base, sourceCount: 0 })).toBe("NO_SOURCE");
    expect(checkReply({ ...base, unknownSources: 1 })).toBe("UNKNOWN_SOURCE");
    expect(checkReply({ ...base, message: "   " })).toBe("EMPTY");
    expect(checkReply({ ...base, message: "x".repeat(1_501) })).toBe(
      "TOO_LONG",
    );
  });
});

describe("the holding line", () => {
  it("carries no figure and no stock promise, for every topic, open or shut", () => {
    for (const t of HANDOFF_TOPICS) {
      for (const open of [true, false]) {
        const line = holdingMessage(t, open);
        expect(checkHoldingMessage(line), `${t} ${String(open)}`).toBeNull();
        expect(line).toMatch(/kak/);
      }
    }
    expect(holdingMessage("stock", false)).toMatch(/10\.00/);
  });

  it("fits the topic and sounds like the admin, never 'admin kami segera balas' (2026-10-27)", () => {
    expect(holdingMessage("price", true)).toBe(
      "Untuk harganya aku tanyain dulu ya kak 🙏",
    );
    expect(holdingMessage("negotiation", true)).toBe(
      "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
    );
    expect(holdingMessage("order_payment", true)).toBe(
      "Makasih kak, buktinya aku cek dulu ya 🙏",
    );
    expect(holdingMessage("order_payment", true, "dp_proof")).toBe(
      "Makasih kak, bukti DP-nya aku cek dulu ya 🙏",
    );
    expect(holdingMessage("closing", true, "buy")).toBe(
      "Siap kak, aku bantu prosesnya ya 🙏",
    );
    expect(holdingMessage("other", true)).toBe(
      "Bentar ya kak, aku cek dulu 🙏",
    );
    expect(holdingMessage("complaint", true)).toMatch(/^Waduh, maaf ya kak/);
    expect(holdingMessage("photos", true)).toBe(
      "Fotonya aku siapin dulu ya kak 🙏",
    );
    for (const t of HANDOFF_TOPICS) {
      const line = holdingMessage(t, true);
      expect(line, t).not.toMatch(
        /admin kami|segera balas|stok, harga, dan kondisi/i,
      );
      // Short: one breath on WhatsApp.
      expect(line.length, t).toBeLessThan(70);
    }
    // Shut, the same line says when.
    expect(holdingMessage("price", false)).toBe(
      "Untuk harganya aku tanyain dulu ya kak 🙏 Toko lagi tutup, nanti aku kabari pas buka jam 10.00 ya.",
    );
  });

  it("refuses a model's line that quotes a price", () => {
    expect(
      checkHoldingMessage("Siap kak, harganya 8jt, admin kami cek dulu ya"),
    ).toBe("AMOUNT_NOT_IN_SOURCE");
  });

  it("knows its own topics", () => {
    expect(isHandoffTopic("stock")).toBe(true);
    expect(isHandoffTopic("price_negotiation")).toBe(false);
    expect(isHandoffTopic(3)).toBe(false);
  });
});

describe("a price written the way people text it (2026-10-27)", () => {
  const facts: StockFact[] = [
    {
      label: "MacBook Air M2 8/256",
      available: true,
      prices: ["11900000"],
    },
    {
      label: "MacBook Pro 14 M3 8/512",
      available: true,
      prices: ["21925000"],
    },
  ];
  const check = (message: string) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: [],
      stockFacts: facts,
    });

  it.each([
    "Air M2 mulus, 11,9jt kak 😊",
    "Air M2 mulus 11.9jt kak",
    "Air M2 nya 11,9 juta kak",
    "Air M2 Rp11.900.000 kak",
    "Air M2 Rp 11.900.000 kak",
    "Air M2 11.900.000 kak",
    "Pro 14 M3 21,925jt kak",
    "Pro 14 M3 Rp21.925.000 kak",
  ])("accepts %s", (message) => {
    expect(check(message)).toBeNull();
  });

  it.each([
    // Rounded is a different price.
    "Air M2 mulus 12jt kak",
    "Pro 14 M3 21,9jt kak",
    // The right figure on the wrong unit.
    "Pro 14 M3 11,9jt kak",
  ])("refuses %s", (message) => {
    expect(check(message)).toBe("AMOUNT_NOT_IN_SOURCE");
  });

  it("reads thousands written with a k or rb as thousands", () => {
    expect(moneyAmounts("ongkir 1.500rb, charger 450k")).toEqual([
      1_500_000, 450_000,
    ]);
  });
});

describe("honest urgency (2026-10-27)", () => {
  const facts: StockFact[] = [
    {
      label: "MacBook Air M2 8/256",
      available: true,
      prices: ["11900000"],
      count: 1,
    },
    {
      label: "MacBook Air M1 8/256",
      available: true,
      prices: ["8000000"],
      count: 3,
    },
  ];
  const check = (message: string, stockFacts: readonly StockFact[] = facts) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: [],
      stockFacts,
    });

  it("lets the shelf's own count of one say 'tinggal 1 unit'", () => {
    expect(check("Air M2 8/256 tinggal 1 unit kak 😊")).toBeNull();
  });

  it("refuses a 'tinggal 1' the count does not say", () => {
    expect(check("Air M1 8/256 tinggal 1 unit kak")).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
    expect(check("Air M1 sisa 2 lagi kak")).toBe("AVAILABILITY_NOT_IN_SOURCE");
    expect(check("Air M1 tinggal 3 unit kak")).toBeNull();
  });

  it("refuses scarcity about nothing in particular when the units disagree", () => {
    expect(check("Tinggal 1 unit kak, buruan ya")).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
    expect(check("Tinggal 1 unit kak", [facts[0]!])).toBeNull();
  });

  it("refuses it outright when nothing was counted", () => {
    expect(
      check("Air M2 tinggal satu kak", [
        { label: "MacBook Air M2 8/256", available: true, prices: [] },
      ]),
    ).toBe("AVAILABILITY_NOT_IN_SOURCE");
  });
});

describe("the closing task (2026-10-27)", () => {
  it("is its own kind of task, and a keep is told the DP rule (2026-10-27)", () => {
    expect(actionKindOf("closing")).toBe("CLOSING");
    // The owner's line, with the shop's own default rule.
    expect(holdingMessage("closing", true, "keep")).toBe(
      "Untuk amankan unitnya bisa DP Rp 500rb kak, unit kami tahan 7 hari. Setelah transfer, kirim buktinya ya, tim kami cek dulu 🙏",
    );
    // And whatever Settings says instead.
    expect(
      holdingMessage("closing", true, "keep", { amount: 1_000_000, days: 3 }),
    ).toBe(
      "Untuk amankan unitnya bisa DP Rp 1jt kak, unit kami tahan 3 hari. Setelah transfer, kirim buktinya ya, tim kami cek dulu 🙏",
    );
    expect(holdingMessage("closing", false, "buy")).toContain(
      "Siap kak, aku bantu prosesnya ya 🙏",
    );
  });
});

describe("the DP (2026-10-27)", () => {
  it("states the rule from the settings, and never says a unit is held", () => {
    expect(dpKeepLine()).toContain("DP Rp 500rb");
    expect(dpKeepLine({ amount: 750_000, days: 7 })).toContain("DP Rp 750rb");
    expect(dpKeepLine({ amount: 1_500_000, days: 14 })).toContain(
      "DP Rp 1,5jt kak, unit kami tahan 14 hari",
    );
    expect(dpKeepLine()).not.toMatch(/sudah kami tahan|sudah di-?keep/i);
  });

  it("lets a hand-over line repeat the DP figure — the settings vouch for it", () => {
    const line = dpKeepLine({ amount: 500_000, days: 7 });
    expect(checkHoldingMessage(line)).toBe("AMOUNT_NOT_IN_SOURCE");
    expect(checkHoldingMessage(line, [line])).toBeNull();
    // Only that figure: any other amount is still refused.
    expect(checkHoldingMessage("Bisa DP Rp 300rb kak 🙏", [line])).toBe(
      "AMOUNT_NOT_IN_SOURCE",
    );
  });

  it("hands a customer who says they paid a DP to a person to verify", () => {
    for (const text of [
      "kak sudah saya transfer DP nya ya",
      "ini bukti dp 500rb kak",
      "udah tf dp barusan",
    ])
      expect(routeMessage(text)).toEqual({
        topic: "order_payment",
        rule: "dp_proof",
      });
    // A photo captioned so is the same thing.
    expect(routeMessage("bukti DP", { hasMedia: true })?.rule).toBe("dp_proof");
    // Asking how to pay one is still a keep.
    expect(routeMessage("mau dp, transfer ke mana kak?")?.rule).toBe("keep");
    expect(saysDpPaid("bisa dp ga?")).toBe(false);
    expect(holdingMessage("order_payment", true, "dp_proof")).toContain(
      "bukti DP-nya aku cek dulu",
    );
  });
});
