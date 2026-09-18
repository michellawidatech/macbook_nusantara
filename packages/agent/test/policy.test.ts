/**
 * What the bot must hand to a person whatever the model thinks, and what it
 * may never send — policy.ts, line by line, with the messages customers send.
 */
import { describe, expect, it } from "vitest";
import {
  HANDOFF_TOPICS,
  checkHoldingMessage,
  checkReply,
  holdingMessage,
  isHandoffTopic,
  mentionsProduct,
  routeMessage,
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
    ["bisa di keep dulu ga kak", "reservation"],
    ["dp dulu boleh?", "reservation"],
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
