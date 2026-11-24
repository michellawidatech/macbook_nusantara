/**
 * The MR01 re-test (2026-11-23): 176 questions from the owner's 3 Nov review
 * replayed against v2026.11.23.3. Each case here is a draft the AI wrote in
 * that replay — quoted from the worker's own refusal log — and what the
 * reply check must make of it.
 *
 * Most of the 46 wrong replies were GOOD drafts refused twice and replaced by
 * "Untuk stok unitnya nanti tim kami konfirmasi" or a bare stock list: the
 * check read "Pro ada kipasnya" as a stock claim, and could not match
 * "8/256" against a shelf label written "8GB · 256GB".
 */

import { describe, expect, it } from "vitest";
import { checkReply, trimToVouched, type StockFact } from "../src/index.js";
import { nameOf } from "../src/rules/understand.js";
import { applyEmojiRule, sanitiseReply } from "../src/sanitise.js";
import { visitRequestGate } from "../src/tools.js";

const AIR_M2_13: StockFact = {
  label: 'MacBook Air 13" M2 8GB · 256GB',
  serial: "K10DY4WVTX",
  available: true,
  prices: ["13300000"],
  count: 1,
};
const AIR_M1: StockFact = {
  label: 'MacBook Air 13" M1 8GB · 128GB',
  serial: "AIRM1X",
  available: true,
  prices: ["8300000"],
  count: 46,
};
const PRO_16: StockFact = {
  label: 'MacBook Pro 16" 2019 i7 · 16GB · 256GB',
  serial: "PRO16X",
  available: true,
  prices: ["8800000"],
  count: 2,
};
const AIR_2020_I3: StockFact = {
  label: 'MacBook Air 13" 2020 i3 / 8GB / 256GB',
  serial: "AIRI3X",
  available: true,
  prices: ["6200000"],
  count: 15,
};

const check = (
  message: string,
  stockFacts?: readonly StockFact[],
  sourceTexts: readonly string[] = ["Air lebih ringan, Pro ada kipas."],
) =>
  checkReply({
    message,
    sourceCount: 1,
    unknownSources: 0,
    sourceTexts,
    ...(stockFacts ? { stockFacts } : {}),
  });

describe("what a model HAS is not stock (re-test rows 54, 55, 123, 146, 153)", () => {
  it.each([
    "Tapi kalau editingnya rutin, MacBook Pro dengan chip Pro lebih enak, karena ada kipas jadi tetap stabil saat render lama.",
    'M1 Pro itu chip kelas atas, ada di MacBook Pro 14" atau 16", lebih kencang dan ada kipasnya.',
    "Untuk MacBook Air, M2 juga sudah desain baru: bezel lebih tipis, ada MagSafe, kamera lebih jernih.",
    "Pro lebih kuat untuk kerja berat yang lama, karena ada kipasnya jadi tetap stabil saat render lama.",
    "MacBook Air nggak ada kipas kak, jadi senyap. MacBook Pro ada kipasnya, jadi lebih kuat.",
  ])("passes %s", (message) => {
    expect(check(message)).toBeNull();
  });

  it("still refuses a named unit said to be on the shelf with nothing behind it", () => {
    expect(check("Ada Air M3 kak, mulus.")).toBe("AVAILABILITY_NOT_IN_SOURCE");
    expect(check("Air M3 ada kak.")).toBe("AVAILABILITY_NOT_IN_SOURCE");
    expect(check("Ada kak Air M3 16/512 nya.")).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
  });
});

describe("a configuration matches a label written with GB (re-test row 109)", () => {
  it("reads 8/256 as the shelf's 8GB · 256GB", () => {
    expect(check('Air M2 13" 8/256 ready kak.', [AIR_M2_13])).toBeNull();
    expect(
      check(
        'Bisa kak. Ada Air M2 13" 8/256 yang mulus, baterainya masih 84%, harganya Rp 13,3jt.',
        [AIR_M2_13],
      ),
    ).toBeNull();
  });

  it("and 8/256 against a label written with slashes", () => {
    expect(check("Air 2020 i3 8/256 ready kak.", [AIR_2020_I3])).toBeNull();
  });

  it("still refuses a configuration the shelf does not have", () => {
    expect(check('Air M2 13" 16/512 ready kak.', [AIR_M2_13])).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
  });
});

describe("a note for staff never reaches the customer (re-test rows 71, 140)", () => {
  it.each([
    "Pelanggan tanya OS maksimal Pro 2016, bilang kayaknya sampai Monterey ya kak. Kita perlu cek akurat biar dia dapat info yang bener",
    "Kak dia tanya apakah minusnya ada di layar, tapi belum sebutin tipe MacBook yang dicari",
    "Customer minta foto unitnya, tolong dicek ya",
  ])("refuses %s", (message) => {
    expect(check(message, undefined, ["x"])).toBe("STAFF_NOTE");
  });

  it("does not mistake talking TO the customer for talking about them", () => {
    expect(
      check(
        "Kalau kakak mau, dia bisa langsung dicek di toko ya kak",
        undefined,
        ["x"],
      ),
    ).toBeNull();
    expect(
      check("Banyak pelanggan kami pakai buat kuliah kak", undefined, ["x"]),
    ).toBeNull();
  });
});

describe("'we don't have it' about what the shelf has (re-test rows 4, 149)", () => {
  it("refuses saying a model is out of stock when this turn saw it on the shelf", () => {
    expect(
      check("Sayang untuk Apple silicon (M1, M2, M3) lagi kosong stok kak.", [
        AIR_M1,
      ]),
    ).toBe("STOCK_DENIED");
    expect(check("Air M1 lagi kosong kak.", [AIR_M1])).toBe("STOCK_DENIED");
    expect(
      check('Kita nggak ada MacBook 16 inch kak, yang ada 13" sama 15"', [
        PRO_16,
      ]),
    ).toBe("STOCK_DENIED");
  });

  it("allows it when nothing this turn saw says otherwise", () => {
    expect(
      check("Untuk M4 belum ada stok kak.", [AIR_M1, AIR_M2_13]),
    ).toBeNull();
    expect(
      check("iPad gen 10 64GB tidak ada stok saat ini kak.", [AIR_M1]),
    ).toBeNull();
  });
});

describe("a draft refused twice keeps what is vouched for (re-test rows 48, 54, 109)", () => {
  const facts = [AIR_M2_13];
  const checkWith = (stock?: readonly StockFact[]) => (text: string) =>
    checkReply({
      message: text,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: ["x"],
      ...(stock ? { stockFacts: stock } : {}),
    });

  it("drops the one sentence nothing vouches for and sends the advice", () => {
    const draft =
      "Untuk coding dan editing video, Air M1 atau M2 dengan RAM 16GB sudah enak kak, soalnya baterainya awet.\n\nSaat ini ada Air M5 16/512 baru segel 23jt kak.";
    const first = checkWith(facts)(draft);
    expect(first).not.toBeNull();
    expect(trimToVouched(draft, first!, checkWith(facts))).toBe(
      "Untuk coding dan editing video, Air M1 atau M2 dengan RAM 16GB sudah enak kak, soalnya baterainya awet.",
    );
  });

  it("keeps a price sentence that leans on the unit named before it", () => {
    const draft =
      'Ada Air M2 13" 8/256 yang mulus kak. Harganya 13,3jt. Air M3 juga ready kak.';
    const first = checkWith(facts)(draft);
    expect(first).toBe("AVAILABILITY_NOT_IN_SOURCE");
    expect(trimToVouched(draft, first!, checkWith(facts))).toBe(
      'Ada Air M2 13" 8/256 yang mulus kak. Harganya 13,3jt.',
    );
  });

  it("gives up when nothing worth sending is left", () => {
    const draft = "Air M3 ready kak. Mau?";
    const first = checkWith(facts)(draft);
    expect(trimToVouched(draft, first!, checkWith(facts))).toBeNull();
  });

  it("never trims a discount or a staff note", () => {
    expect(
      trimToVouched(
        "Bisa nego kak. Air M2 mulus.",
        "DISCOUNT_OFFERED",
        checkWith(),
      ),
    ).toBeNull();
  });
});

describe("'aku tunggu' is not a name (re-test row 178)", () => {
  it.each([
    "Aku tunggu ya kak",
    "aku tunggu",
    "aku cek dulu ya",
    "saya pikir2 dulu",
  ])("%s", (t) => {
    expect(nameOf(t)).toBeNull();
  });
  it("still reads a real one", () => {
    expect(nameOf("aku Budi")).toBe("Budi");
    expect(nameOf("atas nama Rina ya kak")).toBe("Rina");
  });
});

describe("a visit is filed on the customer's words (re-test rows 51, 92, 167, 177)", () => {
  it("refuses when they never asked to come", () => {
    expect(
      visitRequestGate({ when: "2026-11-24T14:00", custName: "Budi" }, [
        "Kalo macbook pro dapet tipe apa kak?",
        "iyaaa boleh",
      ]),
    ).toMatchObject({ refuse: { notAsked: true } });
  });
  it("asks when, rather than picking a time", () => {
    expect(
      visitRequestGate({ when: "2026-11-24T14:00" }, [
        "aku mau ke toko lihat unitnya",
      ]),
    ).toMatchObject({ refuse: { needWhen: true } });
  });
  it("drops a name the customer never wrote", () => {
    expect(
      visitRequestGate({ when: "2026-11-24T14:00", custName: "Budi" }, [
        "aku mau ke toko besok jam 2",
      ]),
    ).toEqual({ args: { when: "2026-11-24T14:00" } });
  });
  it("goes ahead when they gave both", () => {
    expect(
      visitRequestGate({ when: "2026-11-24T14:00", custName: "Rina" }, [
        "besok jam 2 aku ke toko ya, atas nama Rina",
      ]),
    ).toEqual({ args: { when: "2026-11-24T14:00", custName: "Rina" } });
  });
});

describe("an emoji that starts a line leaves no full stop (re-test rows 40, 163)", () => {
  it("drops the pin before Google Maps", () => {
    expect(
      applyEmojiRule(
        "Lokasi toko kami di Ruko Sorrento ya kak 😊\n\n📍 Google Maps: https://share.google/x",
        false,
      ),
    ).toBe(
      "Lokasi toko kami di Ruko Sorrento ya kak\n\nGoogle Maps: https://share.google/x",
    );
  });
  it("still keeps the stop for one that ended a sentence", () => {
    expect(applyEmojiRule("Oke kak 😊 Budgetnya berapa?", false)).toBe(
      "Oke kak. Budgetnya berapa?",
    );
  });
});

describe("battery life of an Intel unit is not promised (re-test rows 74, 156)", () => {
  const withAsk = (message: string, asked: string) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: ["x"],
      customerTexts: [asked],
    });
  it("refuses it for an Intel unit", () => {
    expect(
      withAsk(
        "Kalau dipakai buat ngetik, browsing, zoom, biasanya masih nyaman seharian",
        "Kalo boleh tau pro 2016 ketahan batre nya berapa jam kak?",
      ),
    ).toBe("FACT_NOT_IN_SOURCE");
    expect(
      withAsk(
        "Air 13 2020 i3 itu baterainya bisa tahan seharian tanpa perlu charge",
        "kalo batre nya kuat berapa lama ya",
      ),
    ).toBe("FACT_NOT_IN_SOURCE");
  });
  it("lets Apple silicon's all-day battery through", () => {
    expect(
      withAsk(
        "MacBook dengan Apple silicon (M1 ke atas) biasanya bisa tahan seharian untuk penggunaan normal",
        "macbook bisa bertahan berapa jam kalau dipake nonstop?",
      ),
    ).toBeNull();
  });
});

describe("a stray closing quote is dropped (re-test rows 82, 97, 119)", () => {
  it("at the end of a sentence or alone on a line", () => {
    expect(sanitiseReply('Biar aku bantu carikan yang paling pas."')).toBe(
      "Biar aku bantu carikan yang paling pas.",
    );
    expect(sanitiseReply('Spek hampir mirip\n\n"')).toBe("Spek hampir mirip");
  });
  it("but never an inch mark", () => {
    expect(sanitiseReply('Ada Air 13"')).toBe('Ada Air 13"');
    expect(sanitiseReply('Pro 14"/16"')).toBe('Pro 14"/16"');
  });
});

describe("'we don't have it' needs a look at the shelf (re-test row 149)", () => {
  it("refuses a blind 'tidak ada' about a named machine", () => {
    expect(
      check(
        "Kami nggak jual MacBook 16 inch kak, yang ada 13 inch sama 15 inch aja",
      ),
    ).toBe("STOCK_DENIED");
  });
  it("leaves alone a 'tidak ada' that is not about the shelf", () => {
    expect(check("MacBook Air nggak ada kipas kak, jadi senyap.")).toBeNull();
    expect(check("Untuk free aksesoris belum ada ya kak.")).toBeNull();
  });
});

describe("a configuration the shelf does not have (re-test rows 4, 59)", () => {
  it("refuses 'ada juga 16GB' after an Air M1 that comes only in 8GB", () => {
    expect(
      check(
        "Yang paling hemat ada Air M1 8/128GB kondisi mulus, 8,3jt kak. Kalau kakak mau yang lebih lega lagi, ada juga 16GB dengan harga sedikit lebih tinggi",
        [AIR_M1],
      ),
    ).toBe("AVAILABILITY_NOT_IN_SOURCE");
  });
  it("refuses catalogue configurations said as stock", () => {
    expect(
      check('Pro 13" M1 ada 8GB/256GB, 8GB/512GB, 16GB/256GB kak', [AIR_M1]),
    ).toBe("AVAILABILITY_NOT_IN_SOURCE");
  });
  it("lets 'ada varian' through as the catalogue talking", () => {
    expect(check("Air M2 ada varian 8/256 dan 16/512 kak")).toBeNull();
  });
});

describe("round 4 failures", () => {
  it("refuses Tahoe for Intel Macs in general, but not the Pros that run it or a 'no'", () => {
    expect(
      check(
        "MacBook Intel lama (2015–2019) bisa update sampai macOS Tahoe kak",
      ),
    ).toBe("FACT_NOT_IN_SOURCE");
    expect(
      check("Air 2020 i3 itu Intel kak, nggak bisa Tahoe, sampai Sequoia aja"),
    ).toBeNull();
  });
  it("refuses an Apple warranty nothing gives", () => {
    expect(check("Pro 14 M5 mulus, garansi Apple sampai Desember kak")).toBe(
      "FACT_NOT_IN_SOURCE",
    );
  });
  it("refuses a cycle count given as a percentage", () => {
    expect(check("Cycle count-nya berkisar 86–99%, semua masih bagus")).toBe(
      "FACT_NOT_IN_SOURCE",
    );
  });
  it("refuses a price beside a configuration that is not that unit's", () => {
    const i5_128: StockFact = {
      label: 'MacBook Air 13" 2018 i5 · 8GB · 128GB',
      available: true,
      prices: ["5300000"],
    };
    const i5_256: StockFact = {
      label: 'MacBook Air 13" 2018 i5 · 8GB · 256GB',
      available: true,
      prices: ["4000000"],
    };
    expect(
      check('Air 13" 2018 i5 8/256 ada lecet tipis, 5,3jt kak', [
        i5_128,
        i5_256,
      ]),
    ).toBe("AMOUNT_NOT_IN_SOURCE");
    expect(
      check('Air 13" 2018 i5 8/128 mulus, 5,3jt kak', [i5_128, i5_256]),
    ).toBeNull();
  });
  it("refuses a photo promise when only an unrelated task is open", () => {
    expect(
      checkReply({
        message: "Nanti tim kami bantu kirimkan fotonya ya kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: ["x"],
        openTasks: 1,
        openTopics: ["warranty_claim"],
      }),
    ).toBe("PROMISE_UNFILED");
    expect(
      checkReply({
        message: "Nanti tim kami bantu kirimkan fotonya ya kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: ["x"],
        openTasks: 1,
        openTopics: ["photos"],
      }),
    ).toBeNull();
  });
  it("reads 'aku cek dulu' as filler", async () => {
    const { isFiller } = await import("../src/rules/understand.js");
    expect(isFiller("Baik kak aku cek dulu")).toBe(true);
    expect(isFiller("aku pikir-pikir dulu ya")).toBe(true);
    expect(isFiller("aku cek harga dulu, berapa?")).toBe(false);
  });
});

describe("round 5 false refusals", () => {
  it("'dukungan update macOS-nya terbatas' is not urgency", () => {
    expect(
      check(
        "Air 2020 i3 itu Intel kak, jadi dukungan update macOS-nya terbatas",
      ),
    ).toBeNull();
    expect(check("Buruan kak, stoknya terbatas")).toBe("URGENCY_INVENTED");
  });
  it("'Bisa dikirim foto unitnya dulu' is not a stock claim", () => {
    expect(
      check("Bisa dikirim foto unitnya dulu kak, nanti tim kami cek harganya"),
    ).toBeNull();
  });
  it("'tidak ada garansi resmi' is not a warranty claim", () => {
    expect(
      check(
        "Inter itu MacBook dari luar negeri kak, jadi tidak ada garansi resmi Indonesia",
        undefined,
        ["inter atau ex ibox kak — Ini inter ya kakk"],
      ),
    ).toBeNull();
  });
  it("battery life is refused when the shelf this turn is all Intel", () => {
    expect(
      checkReply({
        message:
          "Untuk pemakaian kantor sehari-hari, masih cukup awet kok, bisa tahan seharian",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: ["x"],
        stockFacts: [AIR_2020_I3],
        customerTexts: ["kalo batre nya kuat berapa lama ya", "cc berapa iti"],
      }),
    ).toBe("FACT_NOT_IN_SOURCE");
  });
});

describe("round 6", () => {
  it("reads '8/256GB' as a configuration beside a price", () => {
    const i5_128: StockFact = {
      label: 'MacBook Air 13" 2018 i5 · 8GB · 128GB',
      available: true,
      prices: ["5300000"],
    };
    const i5_256: StockFact = {
      label: 'MacBook Air 13" 2018 i5 · 8GB · 256GB',
      available: true,
      prices: ["4000000"],
    };
    expect(
      check('Air 13" 2018 i5 8/256GB ada lecet tipis, 5,3jt kak', [
        i5_128,
        i5_256,
      ]),
    ).toBe("AMOUNT_NOT_IN_SOURCE");
  });
  it("refuses 'tidak ada di stok' about a model the lookup saw", () => {
    expect(
      check("Untuk Air M2, M3, M4 tidak ada di stok sekarang kak", [AIR_M2_13]),
    ).toBe("STOCK_DENIED");
  });
});
