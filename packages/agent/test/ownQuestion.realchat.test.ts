/**
 * The owner's chat of 2026-10-27 (628980092978, after /new), line by line.
 *
 *  - The bot asked what the unit was for; "Buat nyatet aja sih" and "Kuliah"
 *    BOTH went to a colleague as "Not in the answers", and the customer got
 *    "Bentar ya kak, aku cek dulu 🙏" — the fixed line a forced hand-over
 *    sends. An answer to the bot's own question is saved and answered.
 *  - "iPad mini 2021 … Mau lihat fotonya kak?" about a unit with no photos.
 *    Photos are offered only where the lookup counted some.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { converse, stockFactsOf, type ConverseInput } from "../src/converse.js";
import { knowledgeBase } from "../src/knowledge.js";
import {
  SHOP_CAPABILITIES,
  holdingMessage,
  isHoldingLine,
  offersPhotos,
  routeMessage,
  withoutPhotoOffer,
} from "../src/policy.js";
import { buildAgentPrompt } from "../src/prompt.js";
import {
  answersOwnQuestion,
  askedAboutThem,
  profileFactsOf,
  understand,
} from "../src/rules/understand.js";
import { runRules, type RulesInput } from "../src/rules/run.js";
import { reply as ruleReplies } from "../src/rules/replies.js";
import type { ToolContext } from "../src/tools.js";
import {
  calls,
  handsOver,
  noDb,
  replies,
  scriptedClient,
  type ScriptStep,
} from "./fixtures.js";

/** Tuesday 27 October 2026, 14:00 Jakarta — open. */
const NOW = new Date("2026-10-27T07:00:00.000Z");
const ASKED = "Halo kak 😊 Rencananya buat apa kak? 😊";
const KB = knowledgeBase([
  {
    id: "kb-garansi",
    question: "Garansi berapa lama kak?",
    answer: "Garansi dari kami 1 bulan ya kak 😊",
  },
]);

/** The iPad the bot offered photos of, which had none (N3TXKG3GWY). */
const IPAD = {
  serial: "N3TXKG3GWY",
  model: "iPad mini 2021",
  variant: "256GB",
  grade: "A",
  price: "Rp 7.000.000",
  left: 1,
  photos: 0,
};

function pos(answers: Record<string, unknown>) {
  const asked: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    asked,
    dispatch: async (name: string, args: unknown) => {
      asked.push({ name, args: args as Record<string, unknown> });
      return answers[name] ?? { saved: true };
    },
  };
}

function talk(
  script: readonly ScriptStep[],
  text: string,
  over: Partial<ConverseInput> = {},
  answers: Record<string, unknown> = {},
) {
  const scripted = scriptedClient(script);
  const p = pos(answers);
  const result = converse({
    client: scripted.client,
    db: noDb as unknown as PrismaClient,
    ctx: {
      from: "628980092978",
      now: NOW,
      capabilities: SHOP_CAPABILITIES,
      profile: { write: noDb as unknown as PrismaClient },
    },
    prompt: { stable: "STABLE", volatile: "VOLATILE" },
    turns: [
      { role: "assistant", text: ASKED },
      { role: "user", text },
    ],
    knowledge: KB,
    storeFacts: "Open 10.00–20.00 WIB.",
    capabilities: SHOP_CAPABILITIES,
    route: routeMessage(text, { capabilities: SHOP_CAPABILITIES }),
    dispatch: p.dispatch,
    lastReply: ASKED,
    selfAnswer: answersOwnQuestion(text, NOW, ASKED),
    ...over,
  });
  return { result, calls: scripted.calls, asked: p.asked };
}

describe("an answer to the bot's own question (owner's chat, 2026-10-27)", () => {
  it.each([
    ["Buat nyatet aja sih", { usage: "note-taking" }],
    ["Kuliah", { usage: "school" }],
    ["buat kerja", { usage: "office" }],
    ["desain", { usage: "design" }],
    ["15 jutaan", { budget_min: 15_000_000, budget_max: 15_000_000 }],
    ["yang ringan", { preferences: "light" }],
  ])("%j is an answer, read and saved by rules", (text, facts) => {
    expect(routeMessage(text, { capabilities: SHOP_CAPABILITIES })).toBeNull();
    expect(answersOwnQuestion(text, NOW, ASKED)).toBe(true);
    const u = understand(text, NOW, { proposalOpen: false, lastShown: [] });
    expect(profileFactsOf(u, text, ASKED)).toMatchObject(facts);
  });

  it("a short answer in words no table knows counts after the bot asked, and is kept as the use", () => {
    expect(answersOwnQuestion("buat bisnis online", NOW, ASKED)).toBe(true);
    expect(answersOwnQuestion("buat bisnis online", NOW, null)).toBe(false);
    const u = understand("buat bisnis online", NOW, {
      proposalOpen: false,
      lastShown: [],
    });
    expect(profileFactsOf(u, "buat bisnis online", ASKED)).toEqual({
      use_case: "buat bisnis online",
    });
  });

  it("a question, an ok or a wish to buy is not one", () => {
    expect(answersOwnQuestion("garansinya berapa lama?", NOW, ASKED)).toBe(
      false,
    );
    expect(answersOwnQuestion("ok", NOW, ASKED)).toBe(false);
    expect(answersOwnQuestion("", NOW, ASKED)).toBe(false);
    expect(answersOwnQuestion("saya ambil yang itu", NOW, ASKED)).toBe(false);
    expect(askedAboutThem("Budgetnya kira-kira berapa kak?")).toBe(true);
    expect(askedAboutThem("Siap kak 😊")).toBe(false);
    expect(askedAboutThem(null)).toBe(false);
  });

  it.each(["Buat nyatet aja sih", "Kuliah"])(
    "%j: a hand-over is sent back once, and the reply goes out",
    async (text) => {
      const t = talk(
        [
          handsOver("other", "Perlu dibalas", "Bentar ya kak, aku cek dulu 🙏"),
          replies("Oke kak 😊 Budgetnya kira-kira berapa kak?", "chat"),
        ],
        text,
      );
      const r = await t.result;
      expect(r?.handoff).toBeUndefined();
      expect(r?.reply).toBe("Oke kak 😊 Budgetnya kira-kira berapa kak?");
      // The model was told why, as the hand-over's tool result.
      const second = JSON.stringify(t.calls[1]!.messages);
      expect(second).toContain("Not a hand-over");
      // Saved by code before the model ran, whatever the model did.
      expect(t.asked[0]?.name).toBe("remember_customer");
      // And the model was told up front that this is an answer.
      expect(JSON.stringify(t.calls[0]!.messages)).toContain(
        "answering your own question",
      );
    },
  );

  it("a second hand-over still ends in a short 'noted' and a yes-question, never a person", async () => {
    const r = await talk(
      [
        handsOver("other", "Perlu dibalas", "Bentar ya kak 🙏"),
        handsOver("other", "Perlu dibalas", "Bentar ya kak 🙏"),
      ],
      "Kuliah",
    ).result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toBe(
      "Oke kak, noted 😊 Mau aku cariin yang paling pas kak?",
    );
    expect(r?.sources).toEqual(["chat"]);
    expect(r?.reply).not.toBe(holdingMessage("other", true));
  });

  it("running out of lookups does not hand it over either, and the last step is announced", async () => {
    const t = talk(
      Array.from({ length: 5 }, () => calls("search_stock", { query: "ipad" })),
      "Buat nyatet aja sih",
      {},
      { search_stock: { matched: 0, units: [] } },
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toMatch(/^Oke kak, noted/);
    expect(JSON.stringify(t.calls[3]!.messages)).toContain(
      "This is your last step",
    );
  });

  it("a reply citing a tool name instead of a source is read as the chat, not refused", async () => {
    const r = await talk(
      [
        calls("remember_customer", { usage: "kuliah" }),
        replies(
          "Siap kak, buat kuliah ya 😊 Budgetnya kira-kira berapa kak?",
          "remember_customer",
        ),
      ],
      "Kuliah",
      { selfAnswer: false },
    ).result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.sources).toEqual(["chat"]);
    // …and the chat still vouches for no figure.
    const priced = await talk(
      [
        replies("Air M2 cuma 9jt kak", "remember_customer"),
        replies("Air M2 cuma 9jt kak", "remember_customer"),
      ],
      "Kuliah",
      { selfAnswer: false },
    ).result;
    expect(priced?.handoff?.forcedBy).toBe("AMOUNT_NOT_IN_SOURCE");
  });

  it("a routed message is still a person's, whatever it says about them", async () => {
    const text = "buat kuliah, bisa nego 9jt aja?";
    const r = await talk(
      [
        handsOver(
          "negotiation",
          "Perlu jawab tawaran",
          "Aku tanyain dulu ya kak 🙏",
        ),
      ],
      text,
      { selfAnswer: true },
    ).result;
    expect(r?.handoff?.topic).toBe("negotiation");
  });
});

describe("photos are offered only where there are some (owner's chat, 2026-10-27)", () => {
  const offer =
    "iPad mini 2021 yang ready 256GB, mulus, 7jt kak 😊 Tinggal 1 unit kami. Cocok untuk nyatet kuliah… Mau lihat fotonya kak?";

  it("the lookup's photo count reaches the facts", () => {
    const [fact] = stockFactsOf("search_stock", { units: [IPAD] });
    expect(fact).toMatchObject({ photos: 0, count: 1 });
    const [found] = stockFactsOf("find_unit_photos", {
      ...IPAD,
      photos: 3,
      photoIds: ["p1"],
    });
    expect(found?.photos).toBe(3);
  });

  it("an offer of photos about units with none goes back once, with the reason", async () => {
    const corrected =
      "iPad mini 2021 yang ready 256GB, mulus, 7jt kak 😊 Mau datang lihat langsung, kapan enaknya kak?";
    const t = talk(
      [
        calls("search_stock", { query: "ipad mini 2021" }),
        replies(offer, "stock"),
        replies(corrected, "stock"),
      ],
      "Kalau yg ipad Mini 2021 itu brp an ya",
      { selfAnswer: false },
      { search_stock: { matched: 1, units: [IPAD] } },
    );
    const r = await t.result;
    expect(r?.reply).toBe(corrected);
    expect(JSON.stringify(t.calls[2]!.messages)).toContain(
      "none of the units you found has any",
    );
  });

  it("offered again, the offer is taken out and the visit question takes its place", async () => {
    const r = await talk(
      [
        calls("search_stock", { query: "ipad mini 2021" }),
        replies(offer, "stock"),
        replies(offer, "stock"),
      ],
      "Kalau yg ipad Mini 2021 itu brp an ya",
      { selfAnswer: false },
      { search_stock: { matched: 1, units: [IPAD] } },
    ).result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).not.toMatch(/foto/i);
    expect(r?.reply).toContain("Cocok untuk nyatet kuliah…");
    expect(
      r?.reply.endsWith("Mau datang lihat langsung kak, kapan enaknya?"),
    ).toBe(true);
  });

  it("with photos, the offer stands", async () => {
    const r = await talk(
      [
        calls("search_stock", { query: "ipad mini 2021" }),
        replies(offer, "stock"),
      ],
      "Kalau yg ipad Mini 2021 itu brp an ya",
      { selfAnswer: false },
      { search_stock: { matched: 1, units: [{ ...IPAD, photos: 2 }] } },
    ).result;
    expect(r?.reply).toContain("Mau lihat fotonya kak?");
  });

  it("reads an offer, and takes only the offer out", () => {
    expect(offersPhotos("Mau lihat fotonya kak?")).toBe(true);
    expect(offersPhotos("Mau aku kirimin fotonya?")).toBe(true);
    expect(offersPhotos("aku kirim fotonya ya kak")).toBe(true);
    expect(offersPhotos("Would you like to see photos?")).toBe(true);
    expect(offersPhotos("Fotonya belum ada kak")).toBe(false);
    expect(withoutPhotoOffer("Ada kak 😊 Mau datang kapan?")).toBe(
      "Ada kak 😊 Mau datang kapan?",
    );
    expect(withoutPhotoOffer("Air M2 mulus.\n\nMau lihat fotonya kak?")).toBe(
      "Air M2 mulus.\nMau datang lihat langsung kak, kapan enaknya?",
    );
    expect(
      withoutPhotoOffer("Mau lihat fotonya kak? Atau mau datang kapan?"),
    ).toBe("Atau mau datang kapan?");
    expect(withoutPhotoOffer("Mau lihat fotonya kak?", "Q?")).toBe("Q?");
  });

  it("the prompt states the rule", () => {
    const { stable } = buildAgentPrompt({
      persona: "P",
      storeFacts: "S",
      knowledge: "K",
      corrections: [],
      now: NOW,
      openNow: true,
      capabilities: SHOP_CAPABILITIES,
    });
    expect(stable).toContain("Offer photos ONLY for a unit whose");
    expect(stable).toContain("is never a hand-over");
  });
});

describe("the rules bot (no credential)", () => {
  const ctx: ToolContext = {
    from: "628980092978",
    now: NOW,
    capabilities: SHOP_CAPABILITIES,
    profile: { write: {} as PrismaClient },
    writesUsed: new Set(),
  };
  const base = (
    text: string,
    p: ReturnType<typeof pos>,
    over: Partial<RulesInput> = {},
  ): RulesInput => ({
    db: {} as PrismaClient,
    ctx,
    text,
    knowledge: KB,
    capabilities: SHOP_CAPABILITIES,
    dispatch: p.dispatch,
    route: routeMessage(text, { capabilities: SHOP_CAPABILITIES }),
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
    lastReply: ASKED,
    ...over,
  });

  it.each(["Buat nyatet aja sih", "Kuliah", "buat bisnis online"])(
    "%j is saved and answered, never handed over",
    async (text) => {
      const p = pos({});
      const out = await runRules(base(text, p));
      expect(out.handoff).toBeUndefined();
      expect(out.reply).toMatch(/^Oke kak, noted 😊/);
      expect(p.asked[0]?.name).toBe("remember_customer");
    },
  );

  it.each(["wkwk", "oh gitu", "lagi liat-liat aja"])(
    "small talk %j keeps the conversation going — no knowledge-base match is no reason for a person",
    async (text) => {
      const out = await runRules(base(text, pos({}), { lastReply: null }));
      expect(out.handoff).toBeUndefined();
      expect(out.reply).toMatch(/\?/);
    },
  );

  it("a question nothing can answer, with no AI, still goes to a person", async () => {
    const out = await runRules(
      base("bisa bayar pakai crypto?", pos({}), { lastReply: null }),
    );
    expect(out.handoff?.topic).toBe("other");
  });

  it("ends a recommendation on the visit, not the photos, when the units have none", async () => {
    const p = pos({ search_stock: { matched: 1, units: [IPAD] } });
    const out = await runRules(base("ada ipad mini 2021?", p));
    expect(out.reply).not.toMatch(/foto/i);
    expect(
      out.reply.endsWith("Mau datang lihat langsung, kapan enaknya kak?"),
    ).toBe(true);
    const pictured = pos({
      search_stock: { matched: 1, units: [{ ...IPAD, photos: 2 }] },
    });
    const out2 = await runRules(base("ada ipad mini 2021?", pictured));
    expect(out2.reply.endsWith("Mau lihat fotonya kak?")).toBe(true);
  });
});

describe("the bot's own hand-over lines are recognisable (labelled Bot on /chat)", () => {
  it("every fixed line, open or shut, and the DP line", () => {
    expect(isHoldingLine("Bentar ya kak, aku cek dulu 🙏")).toBe(true);
    expect(isHoldingLine(holdingMessage("price", false))).toBe(true);
    expect(isHoldingLine(holdingMessage("closing", true, "keep"))).toBe(true);
    expect(
      isHoldingLine(holdingMessage("order_payment", true, "dp_proof")),
    ).toBe(true);
    expect(isHoldingLine(ruleReplies.passedOnToo("id"))).toBe(true);
    expect(isHoldingLine(ruleReplies.passedOnToo("en"))).toBe(true);
    expect(isHoldingLine("Oke kak, aku cek dulu ya")).toBe(false);
    expect(isHoldingLine("")).toBe(false);
    expect(isHoldingLine(null)).toBe(false);
  });
});
