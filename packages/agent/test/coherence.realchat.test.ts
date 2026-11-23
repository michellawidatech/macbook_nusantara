/**
 * The owner's test chat of 2026-11-20 (Jakarta 04:30–04:55), five complaints:
 *
 *  1. "why does it repeat itself" — a hand-over sent the customer their own
 *     request back ("Boleh minta cycle count / battery health untuk Air M1
 *     yang sudah dibahas ya kak").
 *  2. "very non coherent" — "udah ada fotonya?" answered "Soal stok unitnya
 *     masih dicek tim kami".
 *  3. "not answering" — "Mau liat dong starlight-nya gimana?" answered
 *     "Siap kak" and nothing else.
 *  4. "the format is broken" — `Air 13\" 2014`, the JSON escape copied out of
 *     the tool result.
 *  5. "why escalate stock, you have access to it" — the stock switch is on,
 *     and every stock hand-over of the night was the CODE refusing the bot's
 *     own "Air M1 belum ready" (the Air M1 was on the shelf, above the 6jt
 *     budget the search had been filtered by). And the count: under 3 say the
 *     number, 3 or more say "masih lumayan banyak".
 */

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { converse, type ConverseInput } from "../src/converse.js";
import { knowledgeBase } from "../src/knowledge.js";
import { LIVE_CAPABILITIES, checkReply, type StockFact } from "../src/index.js";
import { sanitiseReply } from "../src/sanitise.js";
import {
  calls,
  handsOver,
  noDb,
  replies,
  scriptedClient,
  type ScriptStep,
} from "./fixtures.js";

/** 14:15 in Jakarta: open, so no closed-shop line muddies the replies. */
const OPEN = new Date("2026-08-21T07:15:00.000Z");
const KB = knowledgeBase([]);

const AIR_2018 = {
  serial: "C02X2018",
  model: 'MacBook Air 13" 2018',
  variant: "i5 8/256",
  grade: "A",
  price: "Rp 5.300.000",
  left: 1,
  photos: 2,
};
const AIR_M1 = {
  serial: "FVFM1AIR01",
  model: 'MacBook Air 13" M1',
  variant: "8/256",
  grade: "A",
  price: "Rp 8.800.000",
  left: 2,
  photos: 3,
};

function run(
  script: readonly ScriptStep[],
  text: string,
  stock: Record<string, unknown> = { units: [AIR_M1] },
  over: Partial<ConverseInput> = {},
) {
  const scripted = scriptedClient(script);
  const result = converse({
    client: scripted.client,
    db: noDb as unknown as PrismaClient,
    ctx: { from: "628123", now: OPEN, capabilities: LIVE_CAPABILITIES },
    prompt: { stable: "STABLE", volatile: "VOLATILE" },
    turns: [{ role: "user", text }],
    knowledge: KB,
    storeFacts: "Open 10.00–20.00.",
    route: null,
    capabilities: LIVE_CAPABILITIES,
    dispatch: async (name) => (name === "search_stock" ? stock : {}),
    ...over,
  });
  return { result, calls: scripted.calls };
}

describe("4. a JSON escape never reaches the customer", () => {
  it('turns 13\\" back into 13"', () => {
    expect(
      sanitiseReply(
        'Yang cocok Air 13\\" 2014 kak, 2,3jt\nAda juga Air 13\\" 2018',
      ),
    ).toBe('Yang cocok Air 13" 2014 kak, 2,3jt\nAda juga Air 13" 2018');
  });
});

describe('5. "belum ready" says a unit is NOT there', () => {
  const facts: StockFact[] = [
    {
      label: 'MacBook Air 13" 2018 i5 8/256',
      serial: "C02X2018",
      available: true,
      prices: ["5300000"],
      count: 1,
    },
  ];
  const check = (message: string) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: [],
      stockFacts: facts,
      factTexts: [],
      customerTexts: ["6jt kak"],
    });

  it("is not read as a claim that the Air M1 is ready", () => {
    for (const no of ["masih belum ready", "lagi gak ready", "tidak tersedia"])
      expect(
        check(
          `Air M1 ${no} kak, tapi ada alternatif yang bagus dalam budget kakak. Air 13" 2018 ada kak, 5,3jt`,
        ),
      ).toBeNull();
  });
});

describe('5. how many are left: the number under 3, "lumayan banyak" from 3', () => {
  const fact = (count: number): StockFact[] => [
    {
      label: 'MacBook Air 13" M1 8/256',
      available: true,
      prices: ["8800000"],
      count,
    },
  ];
  const check = (message: string, count: number) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts: [],
      stockFacts: fact(count),
      factTexts: [],
      customerTexts: [],
    });

  it("says the exact number when it is 1 or 2", () => {
    expect(check("Air M1 8/256 ready kak, tinggal 2 unit", 2)).toBeNull();
    expect(check("Air M1 8/256 ready kak, tinggal 1 unit", 1)).toBeNull();
    expect(check("Air M1 8/256 ready kak, tinggal 1 unit", 2)).not.toBeNull();
  });

  it("never gives a number from 3 up, and says 'lumayan banyak' only then", () => {
    expect(check("Air M1 8/256 ready kak, tinggal 4 unit", 4)).not.toBeNull();
    expect(check("Air M1 8/256 ada 5 unit kak", 5)).not.toBeNull();
    expect(
      check("Air M1 8/256 ready kak, stoknya masih lumayan banyak", 5),
    ).toBeNull();
    expect(
      check("Air M1 8/256 ready kak, stoknya masih lumayan banyak", 1),
    ).not.toBeNull();
  });
});

describe("1 & 3. a hand-over line tells the customer what happens next", () => {
  it("never sends the customer their own request back", async () => {
    for (const [asked, echo] of [
      [
        "Boleh minta foto cc battery health untuk unit air m1 yg diatas?",
        "Boleh minta foto cycle count / battery health untuk Air M1 yang sudah dibahas ya kak",
      ],
      [
        "aku mau nya air m1 8/256 min, mau liat foto cc dan bh nya",
        "Kakak mau liat foto dan cycle count / battery health untuk Air M1 8/256 ya kak",
      ],
      [
        "kak macbook yang aku beli minggu lalu layarnya tiba2 bergaris, gimana ya?",
        "Kak, MacBook yang aku beli minggu lalu layarnya tiba-tiba bergaris\nIni termasuk garansi kita ga kak?",
      ],
    ] as const) {
      const r = await run(
        [handsOver("unit_details", "Perlu cek — Air M1", echo)],
        asked,
      ).result;
      expect(r?.handoff).toBeDefined();
      expect(r?.reply).not.toBe(echo);
      expect(r?.reply).toMatch(/tim kami/);
    }
  });

  it('is never a bare "Siap kak"', async () => {
    const r = await run(
      [handsOver("unit_details", "Perlu foto — Air M1 starlight", "Siap kak")],
      "Mau liat dong starlightnya gimana?",
    ).result;
    expect(r?.reply).not.toBe("Siap kak");
    expect(r?.reply).toMatch(/tim kami/);
  });

  it("keeps a line that does say it", async () => {
    const line = "Untuk foto layar baterainya aku mintain ke tim dulu ya kak";
    const r = await run(
      [handsOver("unit_details", "Perlu foto baterai — Air M1", line)],
      "mau liat foto cc dan bh nya",
    ).result;
    expect(r?.reply).toBe(line);
  });
});

describe("5. the battery is on the shelf: it is answered, not handed over", () => {
  it("sends a battery hand-over back once, and the reply goes out", async () => {
    const { result, calls: made } = run(
      [
        handsOver(
          "unit_details",
          "Perlu cek baterai — Air M1",
          "Untuk baterainya nanti tim kami cek ya kak",
        ),
        calls("search_stock", { query: "air m1" }),
        replies("Air M1 8/256 baterainya masih 92% kak", "stock"),
      ],
      "Boleh minta cc battery health untuk unit air m1 yg diatas?",
      { units: [{ ...AIR_M1, batteryHealth: 92 }] },
    );
    const r = await result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toMatch(/92%/);
    expect(JSON.stringify(made[1]!.messages)).toMatch(/battery/i);
  });
});

describe("2 & 5. a refused stock draft is answered from the shelf, never handed over", () => {
  it("answers with what the lookup found when the draft is refused twice", async () => {
    // The night's draft: "Air M1 belum ada" while the lookup (above budget)
    // had one — a false claim the check refuses, twice.
    const wrong = "Air M2 ready kak, 13jt";
    const r = await run(
      [
        calls("search_stock", { query: "air m1" }),
        replies(wrong, "stock"),
        replies(wrong, "stock"),
      ],
      "Air m1 ready ga kak",
      { units: [AIR_M1, AIR_2018] },
    ).result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).not.toMatch(/dicek tim|tim kami konfirmasi/);
    expect(r?.reply).toMatch(/Air 13" M1 8\/256, 8,8jt, tinggal 2 unit/);
    expect(r?.reply).toMatch(/8,8jt/);
    expect(r?.reply).toMatch(/tinggal 2 unit/);
  });

  it("still hands over when the shelf has nothing to say", async () => {
    const wrong = "Air M2 ready kak, 13jt";
    const r = await run(
      [
        calls("search_stock", { query: "air m1" }),
        replies(wrong, "stock"),
        replies(wrong, "stock"),
      ],
      "Air m1 ready ga kak",
      { units: [] },
    ).result;
    expect(r?.handoff).toBeDefined();
  });
});

describe("a reply that only says the question back is a person's (owner, 2026-11-20)", () => {
  it("escalates instead of sending the echo", async () => {
    const r = await run(
      [
        replies(
          "Boleh minta cycle count battery health untuk Air M1 yang diatas ya kak",
          "chat",
        ),
      ],
      "Boleh minta cc battery health untuk unit air m1 yg diatas?",
    ).result;
    expect(r?.handoff).toBeDefined();
    expect(r?.reply).toMatch(/tim kami/);
  });

  it("still sends an answer that repeats a few of their words", async () => {
    const r = await run(
      [replies("Air M1 8/256 baterainya masih 92% kak", "chat")],
      "baterai air m1 berapa?",
      { units: [{ ...AIR_M1, batteryHealth: 92 }] },
    ).result;
    expect(r?.handoff).toBeUndefined();
  });
});

describe("an answer that reuses their words is not an echo (worker tests, 2026-11-20)", () => {
  it("sends 'Iya kak, buka tiap hari'", async () => {
    const r = await run(
      [replies("Iya kak, buka tiap hari", "greeting")],
      "oh iya, tokonya buka tiap hari?",
    ).result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toBe("Iya kak, buka tiap hari");
  });
});

describe("owner's test chat, 2026-11-23", () => {
  it('"okkkk" is filler — never a hand-over', async () => {
    const { isFiller } = await import("../src/rules/understand.js");
    for (const t of ["okkkk", "okk", "ok ok", "okkk kak"])
      expect(isFiller(t)).toBe(true);
  });

  it("a refused draft to a question that is not about the shelf is not answered with a stock list", async () => {
    const wrong = "Air M2 ready kak, 13jt";
    const r = await run(
      [
        calls("search_stock", { query: "macbook" }),
        replies(wrong, "stock"),
        replies(wrong, "stock"),
      ],
      "ini inter ap aibox",
      { units: [AIR_M1, AIR_2018] },
    ).result;
    expect(r?.reply).not.toMatch(/ready sekarang/);
    expect(r?.handoff?.topic).toBe("other");
  });
});
