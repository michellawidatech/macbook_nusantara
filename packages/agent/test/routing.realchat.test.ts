/**
 * What goes to a person, read off the kind of WhatsApp lines this shop's
 * customers actually send (owner, 2026-10-27: *"the chatbot always escalates
 * to human for things that they can actually answer"*).
 *
 * Run with the shop's real switches (`SHOP_CAPABILITIES`): the bot reads the
 * shelf, quotes prices, sends photos and books visits. Against that, only
 * five things are a person's — a payment or DP already made, a real offer or
 * bargain, committing to a unit, a hold, and a picture the customer sent —
 * and every line below that is none of those must come back null.
 *
 * `shown` is whether the bot's previous reply showed units: "bisa nego?" and
 * "mau ambil yang M2" are about those units then, and a person takes them.
 */
import { describe, expect, it } from "vitest";
import { SHOP_CAPABILITIES, routeMessage } from "../src/policy.js";

type Case = readonly [text: string, expected: string | null, shown?: boolean];

const rows = (cases: readonly Case[]) =>
  cases.map(([text, expected, shown = false]) => ({ text, expected, shown }));

const route = (text: string, shown = false) =>
  routeMessage(text, { capabilities: SHOP_CAPABILITIES, shown })?.topic ?? null;

describe("the bot answers these itself (the 2026-10-27 false hand-overs)", () => {
  const cases: Case[] = [
    // Wanting to buy is a customer starting out, not a sale to close.
    ["mau beli macbook buat kuliah", null],
    ["kak mau cari macbook", null],
    ["pengen beli macbook air kak", null],
    ["saya mau beli laptop buat kerja, ada rekomendasi?", null],
    ["i want to buy a macbook for college", null],
    // How to pay is in the owner's approved answers.
    ["cara bayarnya gimana kak?", null],
    ["bisa transfer?", null],
    ["bisa bayar pakai qris?", null],
    ["bisa cicilan tanpa dp ga kak?", null],
    // Cheaper is a search, not a negotiation.
    ["ada yang lebih murah?", null],
    ["ada yang lebih murah ga kak", null, true],
    ["hmm kemahalan", null],
    ["kemahalan kak, ada yang lain?", null, true],
    ["turun harga gak?", null],
    ["ada diskon ga kak?", null],
    ["harga udah net atau masih bisa nego kak?", null],
    // A price range is a budget, not an offer.
    ["kalo yang 12 jutaan ada?", null],
    ["ada yg 15 jutaan gak ya", null],
    ["yang 10jt aja ada ga kak", null],
    ["budget 10jt dapet apa ya", null],
    ["kalo 12jt dapet apa kak?", null],
    ["ada yang di bawah 15jt?", null],
    ["yang kurang dari 10 juta ada?", null],
    ["air m2 harganya berapa?", null],
    // "Tahan" and "simpan" are about the battery and the disk.
    ["baterainya tahan berapa jam?", null],
    ["baterai tahan lama ga kak?", null],
    ["bisa simpan file gede ga?", null],
    ["ssd 256 cukup buat simpan foto?", null],
    // Ordinary questions.
    ["halo kak", null],
    ["air m1 ready?", null],
    ["garansinya berapa lama?", null],
    ["bisa cod ga?", null],
    ["toko buka jam berapa?", null],
    ["m1 vs m2 bedanya apa?", null],
    ["minta fotonya dong", null, true],
    ["yang pertama berapa kak?", null, true],
    ["mau datang besok jam 2 bisa?", null],
    ["ok kak", null, true],
  ];
  it.each(rows(cases))("$text → $expected", ({ text, expected, shown }) => {
    expect(route(text, shown)).toBe(expected);
  });
});

describe("a person takes these", () => {
  const cases: Case[] = [
    // A payment or a DP already made.
    ["kak saya sudah transfer ya", "order_payment"],
    ["ini bukti tf nya", "order_payment"],
    ["udah tf dp barusan", "order_payment"],
    // A real offer or bargain.
    ["bisa 14jt aja?", "negotiation"],
    ["14jt aja ya kak", "negotiation"],
    ["nego dong", "negotiation"],
    ["kurangin dikit dong kak", "negotiation"],
    ["harga pas berapa?", "negotiation"],
    ["best price kak?", "negotiation"],
    ["air m1 bisa kurang ga?", "negotiation"],
    ["kalau 7jt boleh?", "negotiation"],
    ["kalo 14jt gimana kak?", "negotiation", true],
    ["bisa nego?", "negotiation", true],
    ["7,5 aja ya kak", "negotiation", true],
    ["bisa dimurahin ga?", "negotiation"],
    // Committing to a unit the bot showed, or an explicit close.
    ["saya ambil yang air m2", "closing"],
    ["oke jadi ambil yang pertama", "closing"],
    ["mau ambil yang Air M2 kak", "closing", true],
    ["yang kedua aja deh", "closing", true],
    ["deal kak", "closing"],
    ["ok deal", "closing"],
    ["kirim no rek nya kak", "closing"],
    ["transfer ke mana kak?", "closing"],
    ["mau checkout", "closing"],
    ["I'll take it", "closing"],
    // A hold.
    ["bisa di-keep?", "closing"],
    ["bisa di keep dulu ga kak", "closing"],
    ["tahan dulu ya kak, besok saya ke toko", "closing"],
    ["amankan unitnya ya kak", "closing"],
    ["mau DP dulu", "closing"],
    ["bisa ditahan sampai sabtu?", "closing"],
  ];
  it.each(rows(cases))("$text → $expected", ({ text, expected, shown }) => {
    expect(route(text, shown)).toBe(expected);
  });

  it("a picture the customer sent is always a person's", () => {
    expect(
      routeMessage("ini unitnya kak", {
        capabilities: SHOP_CAPABILITIES,
        hasMedia: true,
      })?.topic,
    ).toBe("media");
  });
});
