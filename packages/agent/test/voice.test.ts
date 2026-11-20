/**
 * The last step every reply takes (voice.ts), held to the owner's words of
 * 2026-11-16 — *"full stops … rude … too demanding … it keeps repeating
 * itself, especially when the store is not open"* — with the production chat
 * of that week as the cases.
 */

import { describe, expect, it } from "vitest";
import {
  CLOSED_LINE,
  closedSince,
  confirmLine,
  confirmSubjects,
  finishReply,
  holdingMessage,
  isHoldingLine,
  joinSubjects,
  nearlySame,
  ruleReplies,
  safetyLine,
  sentencesOf,
} from "../src/index.js";

/** Monday 16 Nov 2026, 23:30 Jakarta — the shop closed at 20:00. */
const NIGHT = new Date("2026-11-16T16:30:00.000Z");
/** The same night, 21:00 Jakarta. */
const EARLIER_TONIGHT = new Date("2026-11-16T14:00:00.000Z");
/** The night before, 22:00 Jakarta — another closed period. */
const LAST_NIGHT = new Date("2026-11-15T15:00:00.000Z");
/** Tuesday 11:00 Jakarta — open. */
const DAY = new Date("2026-11-17T04:00:00.000Z");

const CLOSER =
  "Gimana kakk? Kakak juga bisa lihat unitnya langsung di toko kita 😊";
const RECOMMENDATION = `Yang paling terjangkau Air 13" 2014 mulus, baterai 201 siklus, 2,3jt (tinggal 1 unit kak)\n\n${CLOSER}`;

describe("no full stop ends a line (owner: full stops read as rude)", () => {
  it("strips them from a template and from an AI reply, keeping prices", () => {
    expect(
      finishReply("Harganya 8.500.000 kak. Mau aku bantu proses?", {
        first: false,
      }),
    ).toBe("Harganya 8.500.000 kak\nMau aku bantu proses?");
    expect(finishReply("Siap kak, aku catat ya.", { first: false })).toBe(
      "Siap kak, aku catat ya",
    );
  });

  it("keeps the first reply's one emoji and drops the rest", () => {
    expect(
      finishReply("Halo kak 😊 Selamat datang di Macbook Nusantara.", {
        first: true,
      }),
    ).toBe("Halo kak 😊 Selamat datang di Macbook Nusantara");
    expect(
      finishReply("Siap kak 😊 Mau aku cariin yang paling pas kak?", {
        first: false,
      }),
    ).toBe("Siap kak\nMau aku cariin yang paling pas kak?");
  });
});

describe("the recommendation closer is said once per conversation", () => {
  it("is kept the first time", () => {
    const out = finishReply(RECOMMENDATION, { first: false });
    expect(out).toContain("Gimana kakk? Kakak juga bisa lihat unitnya");
    expect(out).not.toMatch(/\.$/m);
  });

  it('"Oh ok ini kk ada fotonya gak ya" — the photos go without it again', () => {
    const out = finishReply(`Ini fotonya kak\n\n${CLOSER}`, {
      first: false,
      earlier: [{ text: finishReply(RECOMMENDATION, { first: false }) }],
      customerText: "Oh ok ini kk ada fotonya gak ya",
    });
    expect(out).toBe("Ini fotonya kak");
  });

  it("stays out even six replies later", () => {
    const earlier = [
      ...Array.from({ length: 8 }, (_, i) => ({ text: `Balasan ${i} kak` })),
      { text: RECOMMENDATION },
    ];
    expect(
      finishReply(`Ada juga Air M1 kak\n\n${CLOSER}`, {
        first: false,
        earlier,
      }),
    ).toBe("Ada juga Air M1 kak");
  });
});

describe("the closed-shop line, once per closed period", () => {
  it("is said the first time a hand-over happens at night", () => {
    const out = finishReply(
      holdingMessage("warranty_claim", false, "warranty"),
      { first: false, now: NIGHT },
    );
    expect(out).toBe(
      `Untuk garansinya nanti tim kami konfirmasi ya kak\n${CLOSED_LINE}`,
    );
  });

  it('"Ada defectnya/minusnya apa aja" — not again the same night', () => {
    const before = finishReply(
      holdingMessage("warranty_claim", false, "warranty"),
      { first: false, now: EARLIER_TONIGHT },
    );
    const out = finishReply(holdingMessage("unit_details", false, "defect"), {
      first: false,
      now: NIGHT,
      earlier: [{ text: before, at: EARLIER_TONIGHT }],
      customerText: "Ada defectnya/minusnya apa aja",
    });
    expect(out).toBe(
      "Untuk detail minus unitnya nanti tim kami konfirmasi ya kak",
    );
    expect(out).not.toMatch(/tutup|bentar|aku cek|kabari/i);
  });

  it("comes back in a new closed period, and the old wording counts too", () => {
    const old =
      "Bentar ya kak, aku cek dulu. Toko lagi tutup, nanti aku kabari pas buka jam 10.00 ya.";
    expect(
      finishReply(holdingMessage("price", false), {
        first: false,
        now: NIGHT,
        earlier: [{ text: old, at: LAST_NIGHT }],
      }),
    ).toContain(CLOSED_LINE);
    expect(
      finishReply(holdingMessage("price", false), {
        first: false,
        now: NIGHT,
        earlier: [{ text: old, at: EARLIER_TONIGHT }],
      }),
    ).not.toMatch(/tutup/i);
  });
});

describe("the team confirms a thing once — and several in one line", () => {
  it("merges every confirm line of a reply into one", () => {
    const out = finishReply(
      [
        "Untuk garansinya nanti tim kami konfirmasi ya kak",
        "COD bisa kak untuk Jabodetabek",
        "Untuk ongkirnya nanti tim kami hitungkan ya kak",
      ].join("\n"),
      { first: false },
    );
    expect(out).toBe(
      "COD bisa kak untuk Jabodetabek\nUntuk garansi dan ongkirnya nanti tim kami konfirmasi dulu ya kak",
    );
  });

  it("says a subject again once, in other words, then not at all", () => {
    const first = "Untuk garansinya nanti tim kami konfirmasi ya kak";
    const again = finishReply(first, {
      first: false,
      earlier: [{ text: first }],
      customerText: "garansinya gmn kak",
    });
    expect(again).toBe("Soal garansinya masih dicek tim kami ya kak");
    const third = finishReply(first, {
      first: false,
      earlier: [{ text: again }, { text: first }],
      customerText: "garansinya gmn kak",
    });
    expect(third).not.toMatch(/garansi/);
    expect(third.length).toBeGreaterThan(0);
  });

  it("names only the new subject when one was said before", () => {
    const out = finishReply(
      "Untuk garansinya nanti tim kami konfirmasi ya kak\nUntuk fotonya nanti tim kami siapin ya kak",
      {
        first: false,
        earlier: [
          { text: "Untuk garansinya nanti tim kami konfirmasi ya kak" },
        ],
      },
    );
    expect(out).toBe("Untuk fotonya nanti tim kami siapin ya kak");
  });

  it("reads and writes the subjects", () => {
    expect(
      confirmSubjects(
        "Untuk garansi dan ongkirnya nanti tim kami konfirmasi dulu ya kak",
      ),
    ).toEqual(["garansi", "ongkir"]);
    expect(confirmSubjects("Harganya 8,5jt kak")).toBeNull();
    expect(joinSubjects(["garansi", "ongkir", "foto"])).toBe(
      "garansi, ongkir dan fotonya",
    );
    expect(joinSubjects(["yang ini"])).toBe("yang ini");
    expect(confirmLine(["garansi"])).toBe(
      "Untuk garansinya nanti tim kami konfirmasi dulu ya kak",
    );
  });
});

describe("nothing is said twice unless they ask for it", () => {
  it('"Hmm" after "Mau aku cariin yang paling pas kak?" does not get it again', () => {
    const earlier = [{ text: "Siap kak\nMau aku cariin yang paling pas kak?" }];
    const out = finishReply("Siap kak 😊 Mau aku cariin yang paling pas kak?", {
      first: false,
      earlier,
      customerText: "Hmm",
    });
    expect(out).not.toContain("Mau aku cariin");
    expect(out.length).toBeGreaterThan(0);
  });

  it("repeats a figure when they ask again, and anything when they ask to hear it again", () => {
    const said = "Air M1 8/256 mulus, 7,5jt kak";
    expect(
      finishReply(said, {
        first: false,
        earlier: [{ text: said }],
        customerText: "yang air m1 berapa kak?",
      }),
    ).toBe(said);
    expect(
      finishReply("Kakak bisa datang langsung ke toko kita ya", {
        first: false,
        earlier: [{ text: "Kakak bisa datang langsung ke toko kita ya" }],
        customerText: "ulang dong kak",
      }),
    ).toBe("Kakak bisa datang langsung ke toko kita ya");
  });

  it("drops a sentence repeated inside one reply", () => {
    expect(
      finishReply("Ada Air M1 mulus 7,5jt kak\nAda Air M1 mulus 7,5jt kak", {
        first: false,
      }),
    ).toBe("Ada Air M1 mulus 7,5jt kak");
  });

  it("never touches a list's question lines", () => {
    const out = finishReply("1. ada air m1?\nAda kak 7,5jt", {
      first: false,
      earlier: [{ text: "1. ada air m1?\nAda kak 7,5jt" }],
      customerText: "1. ada air m1?",
    });
    expect(out).toContain("1. ada air m1?");
  });

  it("falls back to a short line nothing recent used", () => {
    const earlier = [{ text: "Siap kak" }];
    expect(
      finishReply(CLOSER, {
        first: false,
        earlier: [...earlier, { text: RECOMMENDATION }],
      }),
    ).toBe("Oke kak, kalau ada yang mau ditanyain lagi kabarin aja ya");
    expect(
      finishReply(CLOSER, {
        first: false,
        earlier: [{ text: RECOMMENDATION }],
        customerText: "thanks, I'll think about it",
      }),
    ).toBe("Sure");
  });

  it("compares sentences by their words", () => {
    expect(nearlySame("Siap kak 😊", "Siapp kakk")).toBe(true);
    expect(
      nearlySame(
        "Untuk garansinya nanti tim kami konfirmasi ya kak",
        "Untuk garansinya nanti tim kami konfirmasi ya kakak",
      ),
    ).toBe(true);
    expect(nearlySame("Ada Air M1 kak", "Ada Air M2 kak")).toBe(false);
    expect(nearlySame("", "x")).toBe(false);
    expect(sentencesOf("Siap kak. Gimana kak? Oke")).toEqual([
      "Siap kak",
      "Gimana kak?",
      "Oke",
    ]);
  });
});

describe("the never-silent line never repeats back to back", () => {
  it('"Ok" after a holding line gets a light question, not another "bentar ya"', () => {
    const first = safetyLine([]);
    expect(first).toBe("Bentar ya kak, aku cek dulu 🙏");
    const second = safetyLine([{ text: finishReply(first, { first: false }) }]);
    expect(second).not.toMatch(/bentar|aku cek dulu/i);
    expect(second).toMatch(/\?$/);
    const third = safetyLine([
      { text: second },
      { text: finishReply(first, { first: false }) },
    ]);
    expect(third).not.toBe(second);
  });

  it("after a confirm line, carries the chat on too", () => {
    expect(
      safetyLine([
        { text: "Untuk garansinya nanti tim kami konfirmasi ya kak" },
      ]),
    ).toMatch(/kebutuhan apa\?$/);
  });
});

describe("the hand-over lines", () => {
  it("never make the customer wait", () => {
    for (const topic of [
      "stock",
      "price",
      "unit_details",
      "warranty_claim",
      "photos",
      "other",
    ] as const) {
      const line = holdingMessage(topic, true);
      expect(line).not.toMatch(/bentar|aku cek dulu|nanti aku kabari/i);
    }
  });

  it("are still read as the bot's — the new ones and the old", () => {
    expect(
      isHoldingLine(
        finishReply(holdingMessage("price", false), { first: false }),
      ),
    ).toBe(true);
    expect(isHoldingLine("Bentar ya kak, aku cek dulu 🙏")).toBe(true);
    expect(
      isHoldingLine(
        "Bentar ya kak, aku cek dulu. Toko lagi tutup, nanti aku kabari pas buka jam 10.00 ya.",
      ),
    ).toBe(true);
    expect(isHoldingLine("Harganya 8,5jt kak")).toBe(false);
  });

  it("the shop's closed period starts at 20:00", () => {
    expect(closedSince(DAY)).toBeNull();
    expect(closedSince(NIGHT)?.toISOString()).toBe("2026-11-16T13:00:00.000Z");
    // 08:00 Jakarta: closed since the evening before.
    expect(
      closedSince(new Date("2026-11-17T01:00:00.000Z"))?.toISOString(),
    ).toBe("2026-11-16T13:00:00.000Z");
  });

  it("the keep-talking question is never a re-ask", () => {
    const lacks = { usage: true, budget: true, preferences: true, apps: true };
    const q = ruleReplies.keepTalking(lacks, "id", []);
    expect(q).toBe("Oh iya kak, rencananya laptopnya mau dipakai buat apa?");
    // Asked in the last reply: the next need instead.
    expect(ruleReplies.keepTalking(lacks, "id", [q!])).toBe(
      "Oh iya kak, budgetnya kira-kira di kisaran berapa?",
    );
    // Both asked lately: nothing.
    expect(
      ruleReplies.keepTalking({ ...lacks, preferences: false }, "id", [
        "Budgetnya kira-kira berapa kak?",
        q!,
      ]),
    ).toBeNull();
  });
});

describe("a list is never thinned (owner's price list, 2026-11-20)", () => {
  it("keeps every bullet, however alike, and leaves no empty heading", () => {
    const list = [
      "Siap kak, ini pricelist sampai Rp10jt hari ini ya:",
      "",
      'MacBook Air 12" 2016',
      "• m3 · 8GB · 256GB · RETINA mulus: Rp 4.500.000 (tinggal 1 unit)",
      "",
      'MacBook Air 12" 2017',
      "• m3 · 8GB · 256GB · RETINA mulus: Rp 4.500.000 (tinggal 1 unit)",
      "",
      'MacBook Air 13" 2018',
      "• i5 · 8GB · 256GB ada lecet tipis: Rp 4.000.000 (tinggal 1 unit)",
      "• i5 · 8GB · 256GB ada bekas pemakaian: Rp 5.000.000 (tinggal 1 unit)",
    ].join("\n");
    const out = finishReply(list, {
      first: false,
      earlier: [
        {
          text: "• i5 · 8GB · 256GB ada lecet tipis: Rp 4.000.000 (tinggal 1 unit)",
        },
      ],
      customerText: "boleh minta pricelistnya?",
    });
    expect(out).toBe(list.replace(" ya:", " ya:"));
    expect(out).not.toMatch(/\n\n\n/);
  });
});
