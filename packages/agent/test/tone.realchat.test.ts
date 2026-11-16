/**
 * A tester's chat from production, the week of 2026-11-16, replayed through
 * the rules bot and the worker's last step (voice.ts) — the owner's verdict on
 * it: *"full stops … rude … too demanding … it keeps repeating itself,
 * especially when the store is not open it always says staff will check and
 * the user has to wait. Instead of that, ask the user and guide them to keep
 * chatting."*
 *
 * Each case names the customer's line; the comment under it is what the bot
 * sent before this change.
 */

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import {
  CLOSED_LINE,
  finishReply,
  routeMessage,
  runRules,
  type AgentCapabilities,
  type EarlierReply,
  type RulesInput,
  type ToolContext,
} from "../src/index.js";
import { knowledgeBase } from "../src/knowledge.js";

/** Monday 16 November 2026, 23:30 Jakarta — the shop closed at 20:00. */
const NIGHT = new Date("2026-11-16T16:30:00.000Z");
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

const AIR2014 = {
  serial: "C02AIR2014",
  model: 'MacBook Air 13" 2014',
  variant: "4/128",
  grade: "A",
  price: "Rp 2.300.000",
  cycleCount: 201,
  left: 1,
  photos: 2,
};

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
    from: "628111000977",
    now: NIGHT,
    capabilities: LIVE,
    reserve: { write: {} as PrismaClient, staffId: "staff_agent" },
    profile: { write: {} as PrismaClient },
    writesUsed: new Set(),
  };
  return {
    db: {} as PrismaClient,
    ctx,
    text,
    knowledge: knowledgeBase([]),
    capabilities: LIVE,
    dispatch: p.dispatch,
    route: routeMessage(text, { capabilities: LIVE, shown: true }),
    known: {
      name: null,
      usage: false,
      preferences: false,
      budget: false,
      apps: false,
    },
    proposalOpen: false,
    lastShown: [AIR2014.serial],
    leadThreshold: 60,
    ...over,
  };
}

/** The rules bot, then the worker's last step against what was sent before. */
async function turn(
  text: string,
  earlier: EarlierReply[],
  p = pos({}),
  over: Partial<RulesInput> = {},
) {
  const out = await runRules(
    input(text, p, {
      lastReply: earlier[0]?.text ?? null,
      recentReplies: earlier.slice(0, 6).map((e) => e.text),
      ...over,
    }),
  );
  const sent = finishReply(out.reply, {
    first: earlier.length === 0,
    earlier,
    customerText: text,
    now: NIGHT,
  });
  return { out, sent };
}

const questionsIn = (s: string) => (s.match(/\?/g) ?? []).length;

describe("the tester's chat, 2026-11-16", () => {
  it('"Mau beli macbook yg recommend apa ya" — recommends, no full stops', async () => {
    const { sent } = await turn(
      "Mau beli macbook yg recommend apa ya",
      [
        {
          text: "Halo kak 😊 Selamat datang di Macbook Nusantara\nAda yang bisa aku bantu kak?",
        },
      ],
      pos({ search_stock: { matched: 1, units: [AIR2014] } }),
      { lastShown: [] },
    );
    expect(sent).toContain('Air 13" 2014');
    expect(sent).toContain("Gimana kakk? Kakak juga bisa lihat unitnya");
    expect(sent).not.toMatch(/\.$/m);
  });

  it('"Yg ramah di kantong dong kk aku budgetnya gk banyak" — shows the cheapest and asks gently, once', async () => {
    // Before: "Yang mana kak? Sebutin aja tipenya, misal Air M2 😊
    // Budgetnya kira-kira berapa kak?"
    const p = pos({ search_stock: { matched: 1, units: [AIR2014] } });
    const { out, sent } = await turn(
      "Yg ramah di kantong dong kk aku budgetnya gk banyak",
      [
        {
          text: 'Yang paling terjangkau Air 13" 2014 mulus, 2,3jt\n\nGimana kakk? Kakak juga bisa lihat unitnya langsung di toko kita',
        },
      ],
      p,
    );
    expect(out.handoff).toBeUndefined();
    expect(p.asked.find((a) => a.name === "search_stock")?.args).toMatchObject({
      sort: "cheapest",
    });
    expect(sent).not.toMatch(/sebutin aja tipenya/i);
    expect(sent).toContain("Yang paling terjangkau");
    expect(sent).toContain(
      "Kalau boleh tau, budgetnya kira-kira di kisaran berapa kak?",
    );
    expect(questionsIn(sent)).toBe(1);
    // The closer went out last time: not again.
    expect(sent).not.toContain("Gimana kakk");
  });

  it("a list of questions at night: the known one answered, the rest named ONCE, the closed line once", async () => {
    // Before: "1. … Untuk garansinya aku tanyain dulu ya kak. Toko lagi tutup,
    // nanti aku kabari pas buka jam 10.00 ya. 2. …" — the closed line per item.
    const text =
      "Tp aku ada beberapa pertanyaan\n1. Ini garansi gk ya, kalau garansi berapa lama\n2. Ongkirnya ke bekasi berapa kak\n3. Kalau mau video call bisa?";
    const { out, sent } = await turn(text, [
      { text: 'Yang paling terjangkau Air 13" 2014 mulus, 2,3jt' },
    ]);
    expect(out.handoff?.topic).toBe("warranty_claim");
    expect(sent).toContain("2. Ongkirnya ke bekasi berapa kak");
    expect(sent).toContain("Boleh kirim alamat lengkapnya kak");
    expect(sent).not.toContain("1. Ini garansi");
    expect(sent).toContain(
      "Untuk garansi dan video call-nya nanti tim kami konfirmasi dulu ya kak",
    );
    expect(sent.split(CLOSED_LINE).length - 1).toBe(1);
    expect(sent).not.toMatch(/aku tanyain dulu|nanti aku kabari|\.$/m);
  });

  it('"Oh ok ini kk ada fotonya gak ya" — the photos, and not the closer again', async () => {
    // Before: "Ini fotonya kak Gimana kakk? Kakak juga bisa lihat unitnya
    // langsung di toko kita" — the closer for the third time.
    const p = pos({
      unit_photos: { found: true, ...AIR2014, photoIds: ["ph1", "ph2"] },
    });
    const { out, sent } = await turn(
      "Oh ok ini kk ada fotonya gak ya",
      [
        { text: "Siap kak" },
        {
          text: 'Yang paling terjangkau Air 13" 2014 mulus, 2,3jt\n\nGimana kakk? Kakak juga bisa lihat unitnya langsung di toko kita',
        },
      ],
      p,
    );
    expect(out.photos).toEqual(["ph1", "ph2"]);
    expect(sent).toMatch(/^Ini fotonya kak/);
    expect(sent).not.toContain("Gimana kakk");
  });

  it('"Ada defectnya/minusnya apa aja" — the team confirms, once; no wait, no second closed line, and the chat goes on', async () => {
    // Before: "Bentar ya kak, kondisi unitnya aku cekin langsung dulu. Toko
    // lagi tutup, nanti aku kabari pas buka jam 10.00 ya."
    const { out, sent } = await turn("Ada defectnya/minusnya apa aja", [
      { text: "Ini fotonya kak" },
      {
        text: `2. Ongkirnya ke bekasi berapa kak\nUntuk ongkirnya tergantung alamat\n\nUntuk garansinya nanti tim kami konfirmasi ya kak\n${CLOSED_LINE}`,
        at: new Date("2026-11-16T15:00:00.000Z"),
      },
    ]);
    expect(out.handoff?.topic).toBe("unit_details");
    expect(sent).toBe(
      "Untuk detail minus unitnya nanti tim kami konfirmasi ya kak\n\nOh iya kak, rencananya laptopnya mau dipakai buat apa?",
    );
  });

  it('"Hmm" — room to ask, not "Siap kak" and not the same offer again', async () => {
    // Before: "Siap kak. Mau aku cariin yang paling pas kak?"
    const { out, sent } = await turn(
      "Hmm",
      [
        {
          text: "Untuk detail minus unitnya nanti tim kami konfirmasi ya kak\n\nOh iya kak, rencananya laptopnya mau dipakai buat apa?",
        },
      ],
      pos({}),
      {
        waiting: [
          { topic: "unit_details", text: "Ada defectnya/minusnya apa aja" },
        ],
      },
    );
    expect(out.handoff).toBeUndefined();
    expect(sent).toBe(
      "Santai aja kak\nKalau ada yang masih bikin ragu, tanyain aja ya",
    );
  });

  it('"Ok" after a hand-over — no holding line, no second hand-over', async () => {
    // Before: "Bentar ya kak, aku cek dulu. Toko lagi tutup, nanti aku
    // kabari pas buka jam 10.00 ya."
    const earlier = [
      {
        text: "Santai aja kak\nKalau ada yang masih bikin ragu, tanyain aja ya",
      },
      {
        text: "Untuk detail minus unitnya nanti tim kami konfirmasi ya kak\n\nOh iya kak, rencananya laptopnya mau dipakai buat apa?",
      },
    ];
    const { out, sent } = await turn("Ok", earlier, pos({}), {
      waiting: [
        { topic: "unit_details", text: "Ada defectnya/minusnya apa aja" },
      ],
    });
    expect(out.handoff).toBeUndefined();
    expect(sent).not.toMatch(/bentar|aku cek|tutup|kabari/i);
    // Usage was asked a moment ago: the next need, said once.
    expect(sent).toBe(
      "Siap kak\n\nOh iya kak, budgetnya kira-kira di kisaran berapa?",
    );
  });
});
