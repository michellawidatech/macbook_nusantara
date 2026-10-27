/**
 * The rules-first bot end to end, with the POS answered by a fake dispatcher
 * and NO model: the owner's ask (2026-10-15) is that everything a rule can do
 * is done without AI, so most of these tests have no client at all.
 */

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import {
  routeMessage,
  runRules,
  type AgentCapabilities,
  type ConverseResult,
  type RulesInput,
  type ToolContext,
} from "../src/index.js";
import { knowledgeBase } from "../src/knowledge.js";

/** Thursday 15 October 2026, 10:00 Jakarta — the shop is open. */
const NOW = new Date("2026-10-15T03:00:00.000Z");
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

const MBP = {
  serial: "C02MBP16M3",
  model: "MacBook Pro 16 M3",
  variant: "18/512",
  grade: "A",
  price: "Rp 32.500.000",
};
const AIR = {
  serial: "C02AIRM2XX",
  model: "MacBook Air M2",
  variant: "8/256",
  grade: "B",
  price: "Rp 11.900.000",
};

const KB = knowledgeBase([
  {
    id: "k1",
    question: "Garansi berapa lama?",
    answer: "Garansi toko 1 bulan ya kak 😊",
  },
]);

function pos(answers: Record<string, unknown>) {
  const asked: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    asked,
    dispatch: async (name: string, args: unknown) => {
      asked.push({ name, args: args as Record<string, unknown> });
      return answers[name] ?? { error: "not scripted" };
    },
  };
}

function input(
  text: string,
  p: ReturnType<typeof pos>,
  over: Partial<RulesInput> = {},
): RulesInput {
  const ctx: ToolContext = {
    from: "628111000911",
    now: NOW,
    capabilities: LIVE,
    reserve: { write: {} as PrismaClient, staffId: "staff_agent" },
    profile: { write: {} as PrismaClient },
    writesUsed: new Set(),
  };
  return {
    db: {} as PrismaClient,
    ctx,
    text,
    knowledge: KB,
    capabilities: LIVE,
    dispatch: p.dispatch,
    route: routeMessage(text, { capabilities: LIVE }),
    known: {
      name: null,
      usage: false,
      preferences: false,
      budget: false,
      apps: false,
    },
    proposalOpen: false,
    lastShown: [],
    leadThreshold: 60,
    ...over,
  };
}

const run = (text: string, p = pos({}), over: Partial<RulesInput> = {}) =>
  runRules(input(text, p, over));

describe("answered by rules, with no AI at all", () => {
  it("greets", async () => {
    const out = await run("halo kak");
    expect(out.reply).toMatch(/^Halo kak/);
    expect(out.usedAi).toBe(false);
    expect(out.costMicros).toBe(0);
  });

  it("lists what is on the shelf, with prices, and remembers what was shown", async () => {
    const p = pos({ search_stock: { matched: 1, units: [MBP] } });
    const out = await run("kak ada macbook pro 16 m3?", p);
    expect(p.asked.find((a) => a.name === "search_stock")?.args).toMatchObject({
      query: "macbook pro m3 16",
    });
    expect(out.reply).toContain(
      "MacBook Pro 16 M3 18/512, grade A — Rp 32.500.000",
    );
    expect(out.shown).toEqual([MBP.serial]);
    expect(out.handoff).toBeUndefined();
    // And asks what it is for — the profile does not say.
    expect(out.reply).toContain("dipakai untuk apa");
  });

  it("searches a budget as a ceiling and saves it as a range", async () => {
    const p = pos({
      search_stock: { matched: 2, units: [AIR] },
      remember_customer: { saved: true },
    });
    await run("budget 12-15jt buat kuliah, ada?", p);
    expect(
      p.asked.find((a) => a.name === "remember_customer")?.args,
    ).toMatchObject({
      budget_min: 12_000_000,
      budget_max: 15_000_000,
      usage: "school",
    });
    expect(p.asked.find((a) => a.name === "search_stock")?.args).toMatchObject({
      minPrice: 12_000_000,
      maxPrice: 15_000_000,
      sort: "priciest",
    });
  });

  it("prices the second unit it just showed", async () => {
    const p = pos({
      check_serial: { found: true, available: true, ...AIR },
    });
    const out = await run("yang kedua berapa kak?", p, {
      lastShown: [MBP.serial, AIR.serial],
    });
    expect(p.asked[0]).toMatchObject({
      name: "check_serial",
      args: { serial: AIR.serial },
    });
    expect(out.reply).toContain("Rp 11.900.000");
  });

  it("sends the photos of the unit just shown", async () => {
    const p = pos({
      unit_photos: {
        found: true,
        ...MBP,
        photoIds: ["p1", "p2"],
      },
    });
    const out = await run("minta fotonya kak", p, { lastShown: [MBP.serial] });
    expect(out.photos).toEqual(["p1", "p2"]);
  });

  it("asks for what a booking still needs", async () => {
    const out = await run("mau booking dong kak", pos({}), {
      lastShown: [MBP.serial],
    });
    expect(out.reply).toContain("nama untuk bookingnya");
    expect(out.reply).toContain("jam datangnya");
    expect(out.reply).not.toContain("unit yang mau dilihat");
  });

  it("proposes a visit and reads it back, booking nothing", async () => {
    const p = pos({
      propose_reservation: {
        ok: true,
        proposed: true,
        when: "2026-10-16 14:00",
        custName: "Budi",
        units: [MBP],
      },
      remember_customer: { saved: true },
    });
    const out = await run("besok jam 2 saya ke toko, atas nama Budi", p, {
      lastShown: [MBP.serial],
    });
    expect(p.asked.find((a) => a.name === "propose_reservation")?.args).toEqual(
      {
        serials: MBP.serial,
        when: "2026-10-16T14:00",
        custName: "Budi",
      },
    );
    expect(out.reply).toContain("Sudah betul kak?");
    expect(out.bookings ?? []).toHaveLength(0);
  });

  it("books on the customer's yes, by code", async () => {
    const p = pos({
      confirm_reservation: {
        ok: true,
        code: "RV-2026/10-000123",
        when: "2026-10-16 14:00",
      },
    });
    const out = await run("iya betul kak", p, { proposalOpen: true });
    expect(out.reply).toContain("RV-2026/10-000123");
    expect(out.bookings?.[0]?.code).toBe("RV-2026/10-000123");
  });

  it("answers from the owner's sheet, word for word", async () => {
    const out = await run("kak garansinya berapa lama ya?");
    // Word for word — then the bot's question about what they need.
    expect(out.reply.startsWith("Garansi toko 1 bulan ya kak 😊")).toBe(true);
    expect(out.sources).toEqual(["K1"]);
  });

  it("answers in English when the customer writes English", async () => {
    const out = await run("hello");
    expect(out.reply).toMatch(/^Hi!/);
  });
});

describe("what goes to a person", () => {
  it("haggling, as in v1, by code", async () => {
    const out = await run("kalau macbook air m2 11jt boleh?");
    expect(out.handoff?.topic).toBe("negotiation");
  });

  it("anything no rule covers, when there is no AI", async () => {
    const out = await run("kak bisa kirim ke luar kota pakai kurir apa aja?");
    expect(out.handoff?.topic).toBe("other");
    expect(out.usedAi).toBe(false);
  });
});

describe("the AI fallback", () => {
  it("is asked only what no rule could answer, and its cost is counted", async () => {
    let called = 0;
    const ai = async () => {
      called += 1;
      const result: ConverseResult = {
        reply: "Bisa kak, kami kirim pakai JNE atau SiCepat 😊",
        rawReply: "",
        toolsUsed: ["reply"],
        steps: 1,
        sources: ["K9"],
      };
      return {
        result,
        calls: [
          {
            model: "claude-haiku-5-5",
            ms: 900,
            inputTokens: 1000,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 80,
          },
        ],
      };
    };
    const shelf = await run(
      "kak ada macbook air m2?",
      pos({ search_stock: { units: [AIR] } }),
      {
        ai,
      },
    );
    expect(shelf.usedAi).toBe(false);
    expect(called).toBe(0);

    const free = await run(
      "kak bisa kirim ke luar kota pakai kurir apa aja?",
      pos({}),
      {
        ai,
      },
    );
    expect(called).toBe(1);
    expect(free.usedAi).toBe(true);
    expect(free.reply).toContain("JNE");
    expect(free.costMicros).toBeGreaterThan(0);
  });
});

describe("always asking what the customer needs (owner, 2026-10-15)", () => {
  const nothingKnown = {
    name: null,
    usage: false,
    preferences: false,
    budget: false,
    apps: false,
  };

  it("ends every reply with a question while the use is unknown", async () => {
    for (const text of [
      "halo kak",
      "makasih kak",
      "kak garansinya berapa lama ya?",
    ]) {
      const out = await run(text);
      expect(out.reply).toContain("rencananya dipakai untuk apa kak?");
    }
  });

  it("asks about preferences next, then budget, then apps", async () => {
    const out1 = await run("halo kak", pos({}), {
      known: { ...nothingKnown, usage: true },
    });
    expect(out1.reply).toContain("mau yang baru atau second");
    const out2 = await run("halo kak", pos({}), {
      known: { ...nothingKnown, usage: true, preferences: true },
    });
    expect(out2.reply).toContain("Budgetnya kira-kira");
    const out3 = await run("halo kak", pos({}), {
      known: { ...nothingKnown, usage: true, preferences: true, budget: true },
    });
    expect(out3.reply).toContain("aplikasi khusus");
  });

  it("stops asking once it knows", async () => {
    const out = await run("halo kak", pos({}), {
      known: {
        name: "Budi",
        usage: true,
        preferences: true,
        budget: true,
        apps: true,
      },
    });
    expect(out.reply).not.toContain("?\n");
    expect(out.reply).toBe(
      "Halo kak 😊 Selamat datang di Macbook Nusantara. Lagi cari unit apa kak?",
    );
  });

  it("counts what the customer says in the same message", async () => {
    const out = await run("halo kak, buat kuliah desain");
    expect(out.reply).not.toContain("dipakai untuk apa");
    expect(out.reply).toContain("mau yang baru atau second");
  });

  it("asks a skipped question a second way rather than repeating it", async () => {
    const first = await run("halo kak");
    const again = await run("ok kak", pos({}), { lastReply: first.reply });
    expect(again.reply).not.toContain("rencananya dipakai untuk apa kak?");
    expect(again.reply).toContain("kebutuhannya lebih ke apa kak");
  });

  it("asks nothing extra on a hand-over or a booking read-back", async () => {
    const handed = await run("kalau macbook air m2 11jt boleh?");
    expect(handed.reply).not.toContain("dipakai untuk apa");
    const proposal = await run(
      "besok jam 2 saya ke toko, atas nama Budi",
      pos({
        propose_reservation: {
          ok: true,
          proposed: true,
          when: "2026-10-16 14:00",
          custName: "Budi",
          units: [MBP],
        },
        remember_customer: { saved: true },
      }),
      { lastShown: [MBP.serial] },
    );
    expect(proposal.reply).not.toContain("dipakai untuk apa");
  });
});

describe("out of stock, and one step up (owner, 2026-10-27)", () => {
  const M1 = {
    serial: "C02AIRM1XX",
    model: "MacBook Air M1",
    variant: "8/256",
    grade: "A",
    price: "Rp 8.000.000",
  };
  const AIR16 = {
    serial: "C02AIRM216",
    model: "MacBook Air M2",
    variant: "16/512",
    grade: "A",
    price: "Rp 14.000.000",
  };

  it("offers the closest units in stock instead of stopping at 'kosong'", async () => {
    const p = pos({
      search_stock: {
        matched: 0,
        units: [],
        alternatives: [AIR, M1],
        accessory: { model: "Charger MacBook Air 30W", price: "Rp 450.000" },
      },
    });
    const out = await run("air m3 16/512 ready kak?", p);
    expect(out.reply).toContain("sedang kosong");
    expect(out.reply).toContain("Yang paling mirip dan ready");
    expect(out.reply).toContain(
      "1. MacBook Air M2 8/256, grade B — Rp 11.900.000",
    );
    expect(out.reply).toContain(
      "2. MacBook Air M1 8/256, grade A — Rp 8.000.000",
    );
    expect(out.reply).toContain("Charger MacBook Air 30W — Rp 450.000");
    expect(out.sources).toEqual(["stock"]);
    expect(out.shown).toEqual([AIR.serial, M1.serial]);
    expect(out.handoff).toBeUndefined();
  });

  it("still says so plainly when nothing close is in stock", async () => {
    const p = pos({ search_stock: { matched: 0, units: [] } });
    const out = await run("air m3 16/512 ready kak?", p);
    expect(out.reply).toContain("sedang kosong");
  });

  it("offers one step up after the main pick, as an option", async () => {
    const p = pos({
      search_stock: { matched: 1, units: [AIR], stepUp: AIR16 },
    });
    const out = await run("air m2 8/256 ada kak?", p);
    const list = out.reply.indexOf("MacBook Air M2 8/256");
    const up = out.reply.indexOf(
      "Kalau mau lebih lega, ada juga MacBook Air M2 16/512, grade A — Rp 14.000.000",
    );
    expect(list).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(list);
    // The step up can be picked like any unit shown: "yang kedua".
    expect(out.shown).toEqual([AIR.serial, AIR16.serial]);
  });

  it("offers a step up from the alternatives too", async () => {
    const p = pos({
      search_stock: {
        matched: 0,
        units: [],
        alternatives: [AIR],
        stepUp: AIR16,
      },
    });
    const out = await run("air m3 ada kak?", p);
    expect(out.reply).toContain("Kalau mau lebih lega, ada juga");
  });
});

describe("a hand-over no longer silences the chat (owner, 2026-10-27)", () => {
  const waiting = [{ topic: "negotiation" as const, text: "kalau 7jt boleh?" }];
  const holding =
    "Siap kak 😊 Untuk stok, harga, dan kondisi unit terbarunya kami cekkan dulu ya. Admin kami segera balas di chat ini ya kak 🙏";

  it("answers a newer question that needs no person", async () => {
    const p = pos({ search_stock: { matched: 1, units: [AIR] } });
    const out = await run("kalau air m2 ada?", p, {
      waiting,
      lastReply: holding,
    });
    expect(out.handoff).toBeUndefined();
    expect(out.reply).toContain("MacBook Air M2 8/256");
  });

  it("tells a nudge once that the team is on it — and not twice", async () => {
    const first = await run("kak?", pos({}), {
      waiting,
      lastReply: "Ada kak 😊 Ini yang ready: …",
    });
    expect(first.reply).toContain(
      "Untuk tawarannya tadi masih dicek tim kami ya kak",
    );
    expect(first.handoff).toBeUndefined();
    // The bot's previous reply already promised it: carry on instead.
    const again = await run("kak?", pos({}), { waiting, lastReply: holding });
    expect(again.reply).not.toContain("masih dicek");
    expect(again.reply).not.toContain("Selamat datang");
  });

  it("does not welcome a customer mid-conversation", async () => {
    const out = await run("halo kak", pos({}), {
      waiting,
      lastReply: "Ada kak 😊",
    });
    expect(out.reply).not.toContain("Selamat datang");
  });

  it("hands a second question for a person over without repeating the promise", async () => {
    const out = await run("air m2 bisa nego ga kak?", pos({}), {
      waiting,
      lastReply: holding,
    });
    expect(out.handoff?.topic).toBe("negotiation");
    expect(out.reply).toBe(
      "Siap kak, yang ini juga sudah kami teruskan ke tim kami ya 🙏",
    );
  });

  it("leaves a short action item, not a code", async () => {
    const out = await run("air m2 bisa nego ga kak?", pos({}));
    expect(out.handoff?.summary).toBe(
      'Perlu jawab tawaran — Air M2\n"air m2 bisa nego ga kak?"',
    );
  });
});
