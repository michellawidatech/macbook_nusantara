/**
 * Finding the owner's answer for what a customer actually typed.
 *
 * Run against the owner's real answer sheet (docs/chatbot/knowledge-…md), read
 * through the same parser the paste dialog and the `knowledge` CLI use — so a
 * change to the sheet that the ranker can no longer find fails here, not in a
 * customer's chat.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseQaText } from "@nusantara/domain";
import {
  indexKnowledge,
  isStrongMatch,
  searchWords,
  STRONG_MATCH,
} from "../src/retrieval.js";

const SHEET = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "chatbot",
  "knowledge-2026-09-18.md",
);
const { pairs } = parseQaText(readFileSync(SHEET, "utf8"));
const docs = pairs.map((p, i) => ({ id: `K${i + 1}`, ...p }));
const index = indexKnowledge(docs);

const top = (query: string) => index.rank(query, 3)[0];
const questionOf = (query: string) => top(query)?.doc.question;

describe("the owner's sheet", () => {
  it("is all there: every pair parsed, none left without an answer", () => {
    expect(docs).toHaveLength(31);
  });
});

describe("a question asked the way customers type it", () => {
  it.each([
    ["cod bisa ga kak", "Cod bisa ga kak?"],
    ["garansinya brp lama ya", "Garansi berapa lama kak?"],
    ["jam oprasional toko", "Jam operasional kak?"],
    ["tokonya dimana kak? share lokasi dong", "Lokasi toko dimana kak?"],
    ["bisa tt ga", "Bisa tukar tambah ga kak?"],
    [
      "kalo checkout di shopee bisa ambil ke toko?",
      "Kalo co dari shopee bisa di ambil langsung ke toko ga kak?",
    ],
    ["bisa cicil pake kartu kredit?", "Cicilan bisa pake apa aja kak?"],
    ["cara cicilannya gimana", "Cara cicilannya gimana kak?"],
    [
      "pengiriman ke surabaya berapa hari",
      "Pengiriman keluar kota estimasinya berapa lama kak?",
    ],
    ["free install office?", "Free install apk office ga kak?"],
    [
      "kenapa di tokped lebih mahal",
      "Kenapa harga di shopee/tokped lebih mahal ka?",
    ],
    ["ada asuransi pengiriman?", "Apakah pengirimannya ada asuransinya kak?"],
    [
      "kalau paket hilang gimana",
      "Kalo semisal barang hilang dalam proses pengiriman gimana kak?",
    ],
    ["human error itu apa", "Human error itu apa aja kak?"],
    ["bisa po?", "Bisa PO ga kak?"],
    ["dapet charger ga? fullset?", "Kalo fullset isinya apa aja kak?"],
    ["bisa jual macbook saya?", "Bisa jual macbook ga kak?"],
    ["bisa servis ganti baterai?", "Apakah bisa service juga kak?"],
    ["Apakah unitnya ready?", "Apakah unitnya ready?"],
    [
      "harga udah net? bisa nego?",
      "Untuk harga udah net atau masih bisa nego kak?",
    ],
    ["ada pricelist?", "Ada price list nya ga kak?"],
    ["minusnya apa aja", "Minusnya apa aja kak?"],
    ["pernah ganti sparepart?", "Apakah pernah ganti sparepart kak?"],
    ["bisa kirim instan gosend?", "Untuk pengiriman bisa instan ga kak?"],
    [
      "kurir toko ada?",
      "Selain kurir gojek biasa, ada kurir toko yang trusted ga kak?",
    ],
    [
      "rekomendasi macbook buat kuliah",
      "Bingung pilih MacBook yang mana kak, bisa bantu rekomendasi?",
    ],
    ["ada bonus aksesoris?", "Ada free aksesoris ga kak?"],
    ["split payment bisa?", "Bisa split payment ga kak?"],
    ["bisa kirim ke luar kota", "Bisa kirim ke luar kota ga kak?"],
  ])("%s → %s", (query, question) => {
    expect(questionOf(query)).toBe(question);
    expect(top(query)!.score).toBeGreaterThanOrEqual(STRONG_MATCH);
  });

  it("forgives a typo the spelling table never listed", () => {
    expect(questionOf("garansiii berapa lama")).toBe(
      "Garansi berapa lama kak?",
    );
    expect(questionOf("asuransii pengiriman")).toBe(
      "Apakah pengirimannya ada asuransinya kak?",
    );
  });
});

describe("a question the owner never answered", () => {
  it("scores under the strong line, so the model is told nothing matched", () => {
    const hit = top("bisa bayar pakai crypto?");
    expect(hit === undefined || !isStrongMatch(hit)).toBe(true);
  });

  it("finds nothing at all in pure small talk or nonsense", () => {
    expect(index.rank("halo kak")).toEqual([]);
    expect(index.rank("makasih ya kak")).toEqual([]);
    expect(index.rank("zzzz")).toEqual([]);
  });
});

describe("a knowledge base of one", () => {
  it("still knows a strong match, where BM25 on its own cannot", () => {
    // With one entry every word is in every document, so its IDF — and the
    // score — collapses. Coverage of the question does not.
    const tiny = indexKnowledge([
      {
        id: "K1",
        question: "Garansi berapa lama kak?",
        answer: "1 bulan ya kak",
      },
    ]);
    const hit = tiny.rank("garansinya brp lama?")[0]!;
    expect(hit.score).toBeLessThan(STRONG_MATCH);
    expect(hit.coverage).toBe(1);
    expect(isStrongMatch(hit)).toBe(true);
    expect(
      isStrongMatch(
        tiny.rank("berapa ongkirnya")[0] ?? { score: 0, coverage: 0 },
      ),
    ).toBe(false);
  });
});

describe("searchWords", () => {
  it("joins phrases, maps chat spelling, strips particles and drops filler", () => {
    expect(searchWords("Kak, tukar tambah bisa? Garansinya brp?")).toEqual([
      "tukartambah",
      "garansi",
      "berapa",
    ]);
    expect(searchWords("co di tokped, bs COD ga?")).toEqual([
      "checkout",
      "tokopedia",
      "cod",
    ]);
    expect(searchWords("Battery health nya berapa 😊🙏")).toEqual([
      "baterai",
      "berapa",
    ]);
  });

  it("returns nothing for an index of nothing", () => {
    expect(indexKnowledge([]).rank("garansi")).toEqual([]);
  });
});
