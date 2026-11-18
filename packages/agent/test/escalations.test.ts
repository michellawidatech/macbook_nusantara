/**
 * The owner's three asks of 2026-11-16:
 *
 *  1. Photos only on request — a recommendation no longer sends them.
 *  2. A person takes exactly these: asking for an admin, negotiation and
 *     closing (as before), a video or phone call, a unit's defects and more
 *     detailed photos once photos were sent, a delivery cost, and anything
 *     about servicing, warranty, complaints or a past purchase. Warranty
 *     REVERSES the approved-answer rule: it goes to a person now.
 *  3. A numbered list of questions is answered per question: the question
 *     repeated, its answer under it, a blank line between them.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { converse, type ConverseInput } from "../src/converse.js";
import { knowledgeBase } from "../src/knowledge.js";
import {
  SHOP_CAPABILITIES,
  askedForAddress,
  asksDeliveryCost,
  asksForPhotos,
  deliveryFigureUnvouched,
  holdingMessage,
  isHoldingLine,
  routeMessage,
  type AgentCapabilities,
} from "../src/policy.js";
import {
  formatItemAnswers,
  mergeItemResults,
  questionItems,
} from "../src/questionList.js";
import { routeSummary } from "../src/tasks.js";
import {
  runRules,
  type ConverseResult,
  type RulesInput,
  type ToolContext,
} from "../src/index.js";
import {
  calls,
  handsOver,
  noDb,
  replies,
  scriptedClient,
  type ScriptStep,
} from "./fixtures.js";

type RouteOpts = {
  photosSent?: boolean;
  shown?: boolean;
  deliveryContext?: boolean;
};
const route = (text: string, opts: RouteOpts = {}) =>
  routeMessage(text, { capabilities: SHOP_CAPABILITIES, ...opts });
const topic = (text: string, opts: RouteOpts = {}) =>
  route(text, opts)?.topic ?? null;

describe("who a person takes (owner, 2026-11-16)", () => {
  it.each([
    "mau chat sama admin",
    "bisa sambung ke admin?",
    "sambungin ke admin dong kak",
    "minta nomor admin",
    "cs nya mana",
    "cs nya mana kak?",
    "adminnya mana ya",
    // The UAT guide's phrasings (2026-11-16), "Chat admin" the sheet's own.
    "Chat admin",
    "hubungi admin",
    "admin dong",
    "mau ngobrol sama orangnya",
    "kak mau ngobrol sama admin aja",
    "bisa hubungi CS nya?",
    "ini bot ya? mau sama orang beneran",
  ])("asking for an admin: %j", (text) => {
    expect(topic(text)).toBe("human");
  });

  it.each([
    ["bisa vc?", "video_call"],
    ["bisa video call kak?", "video_call"],
    ["vc aja kak biar jelas", "video_call"],
    ["minta videonya dong", "video_call"],
    ["ada video unitnya?", "video_call"],
    ["bisa telpon?", "video_call"],
    ["call aja kak", "video_call"],
    ["vc", "video_call"],
    ["bisa video call?", "video_call"],
    ["minta video unitnya", "video_call"],
    ["telp aja", "video_call"],
    ["boleh vc kak buat liat unitnya?", "video_call"],
    ["bisa telpon kak?", "video_call"],
  ] as const)("a video or phone call: %j", (text, expected) => {
    expect(topic(text)).toBe(expected);
  });

  it.each([
    "laptop buat edit video",
    "bisa buat video editing?",
    "kalau buat render video kuat ga kak?",
    "aku youtuber, sering bikin video",
  ])("video as a USE is not a call: %j", (text) => {
    expect(topic(text)).not.toBe("video_call");
  });

  it.each([
    "minus nya apa aja?",
    "minusnya apa kak?",
    "ada lecet ga kak?",
    "ada dent?",
    "kekurangannya apa kak?",
    "body ada baret gak?",
    "layarnya ada minus ga",
    "ada whitespot / dent ga kak?",
    "Kalo fungsi nya semua aman normal kak? Atau ada minus lain?",
  ])("a unit's defects: %j", (text) => {
    expect(route(text)).toMatchObject({
      topic: "unit_details",
      rule: "defect",
    });
  });

  it.each(["ada yang mulus?", "yang tanpa minus ada kak?"])(
    "shopping for a clean unit stays the bot's: %j",
    (text) => {
      expect(topic(text)).toBeNull();
    },
  );

  it.each([
    "fotonya kurang jelas kak",
    "minta foto detail bagian keyboard",
    "bisa zoom bagian engsel?",
    "foto lebih detail dong",
    "minta foto lagi kak",
    "boleh minta foto semua sisinya?",
    "mau minta foto kiri kanan depan belakang nya jg kak",
    "minta foto screenshot cc dan bh nya dong",
    "fotoin bagian engselnya dong",
  ])("more detailed photos once photos were sent: %j", (text) => {
    expect(route(text, { photosSent: true })).toMatchObject({
      topic: "unit_details",
      rule: "photo_detail",
    });
  });

  it("asks for photos before any were sent are the bot's: it sends them", () => {
    expect(topic("minta foto detail bagian keyboard")).toBeNull();
    expect(topic("ada fotonya?")).toBeNull();
  });

  // Owner, 2026-11-16 (follow-up): a delivery cost is the bot's — general
  // info, "the team estimates it", and a request for the address. The
  // address itself is what goes to a person.
  it.each([
    "ongkir ke surabaya brp?",
    "kirim ke medan berapa?",
    "bisa cod? biayanya berapa",
    "ongkos kirim ke bandung?",
    "berapa ongkirnya kak",
    "ongkir ke bandung brp kak?",
    "kirim ke surabaya kena berapa?",
    "kalo cod ke bekasi biayanya brp?",
    "Kalo cod ke bandung berapa kak?",
  ])("a delivery cost question is the bot's: %j", (text) => {
    expect(topic(text)).toBeNull();
    expect(asksDeliveryCost(text)).toBe(true);
  });

  it.each([
    "Jl. Melati No 12, Kebayoran Baru, Jaksel",
    "kirim ke Bekasi Timur",
    "ini alamatku: Perum Griya Asri Blok C3 no 7, Cibinong",
    "https://maps.app.goo.gl/AbCdEf123",
    "kode pos 40115",
    "Kec. Coblong, Kota Bandung",
    "Jalan Kaliurang km 5, Sleman",
    "aku sharelok ya kak",
  ])("an address once delivery is the subject goes to a person: %j", (text) => {
    expect(route(text, { deliveryContext: true })).toEqual({
      topic: "shipping_quote",
      rule: "address",
    });
  });

  it("a message that asks about sending carries its own context", () => {
    expect(topic("kirim ke Bekasi Timur bisa kak?")).toBe("shipping_quote");
    expect(topic("ongkir ke Jl. Melati No 12 Jaksel brp?")).toBe(
      "shipping_quote",
    );
  });

  it("a WhatsApp location after the bot asked for the address goes to a person", () => {
    expect(
      routeMessage("(the customer sent a location)", {
        capabilities: SHOP_CAPABILITIES,
        hasLocation: true,
        deliveryContext: true,
      })?.rule,
    ).toBe("address");
  });

  it.each([
    "aku tinggal di Bekasi Timur kak",
    "kantorku di Jl. Sudirman",
    "kak lokasi toko dimana?",
    "Bisa sharelok kak?",
    "bisa kirim ke luar kota pakai kurir apa aja?",
  ])("a place in small talk is not an escalation: %j", (text) => {
    expect(topic(text)).toBeNull();
  });

  it.each([
    "kak lokasi toko dimana?",
    "alamatnya di mana kak?",
    "ok kak",
    "besok aja",
  ])("not an address even after the bot asked: %j", (text) => {
    expect(topic(text, { deliveryContext: true })).toBeNull();
  });

  it("knows when its own last reply asked for the address", () => {
    expect(
      askedForAddress(
        "Untuk ongkirnya nanti tim kami yang hitungkan ya kak. Boleh kirim alamat lengkapnya kak (kecamatan/kota)?",
      ),
    ).toBe(true);
    expect(
      askedForAddress(
        "Alamat toko kami di Jl. Kemang Raya no 5. Ada yang bisa aku bantu?",
      ),
    ).toBe(false);
    expect(askedForAddress(null)).toBe(false);
  });

  it("refuses a delivery figure no approved answer gives", () => {
    const kb = [
      "Cod bisa ga kak?\nBisa kak, COD Jabodetabek ada biaya Rp180.000",
    ];
    expect(
      deliveryFigureUnvouched("Ongkir ke Bandung sekitar 50rb kak", kb),
    ).toBe(true);
    expect(
      deliveryFigureUnvouched("COD Jabodetabek biayanya Rp180.000 ya kak", kb),
    ).toBe(false);
    // A shelf price beside "bisa dikirim" is vouched by the shelf.
    expect(
      deliveryFigureUnvouched("Air M1 8,9jt, bisa dikirim juga kak", [
        "8900000",
      ]),
    ).toBe(false);
    // A unit's price beside no delivery word is not a delivery figure.
    expect(deliveryFigureUnvouched("Air M1 mulus 8,9jt kak", kb)).toBe(false);
  });

  it.each([
    "bisa kirim ke luar kota?",
    "bisa cod?",
    // The approved COD answer (Rp180.000 Jabodetabek) is left to the bot —
    // an open question for the owner, not changed here.
    "Ini bisa cod ga kak?",
    "pengiriman berapa lama kak?",
  ])("how delivery works, with no cost asked, stays the bot's: %j", (text) => {
    expect(topic(text)).toBeNull();
  });

  it.each([
    ["garansinya berapa lama?", "warranty_claim"],
    ["garansi berapa lama?", "warranty_claim"],
    ["ada garansi?", "warranty_claim"],
    ["kalau rusak gimana?", "warranty_claim"],
    ["tt-nya berapa lama garansinya?", "warranty_claim"],
    ["ganti baterai berapa?", "service"],
    ["bisa servis macbook di sini?", "service"],
    ["unit ini pernah diservis?", "service"],
    ["unitnya pernah servis?", "service"],
    ["unit yang saya beli kemarin bisa upgrade ssd?", "service"],
    ["pembelian saya minggu lalu belum dapat charger", "service"],
    ["unit yang saya beli kemarin keyboardnya rusak", "complaint"],
    ["Ada garansi nya kak?", "warranty_claim"],
    ["Garansi nya meliputi apa aja kak yang bisa di claim?", "warranty_claim"],
    ["human error itu apa aja kak?", "warranty_claim"],
    ["bisa service ga kak?", "service"],
    ["Kalo disini bisa service kak?", "service"],
    ["unit yang aku beli kemarin garansinya sampai kapan ya", "service"],
    ["minggu lalu aku beli disini, chargernya ketinggalan kak", "service"],
    ["kecewa banget kak, unitnya ga sesuai foto", "complaint"],
  ] as const)("service, warranty, past purchases: %j", (text, expected) => {
    expect(topic(text)).toBe(expected);
  });

  it("a buyer saying they buy here is not a past purchase", () => {
    expect(topic("aku beli disini aja deh, ada air m2?")).not.toBe("service");
  });

  it("the price list and budget questions stay the bot's", () => {
    expect(topic("Boleh minta pricelist nya kak?")).toBeNull();
    expect(topic("budget 10jt dapet apa ya")).not.toBe("shipping_quote");
    expect(topic("ada yang lebih murah?")).toBeNull();
    expect(topic("cara bayarnya gimana kak?")).toBeNull();
    expect(topic("kak lokasi toko dimana?")).toBeNull();
  });

  it("negotiation and closing still go to a person", () => {
    expect(topic("bisa nego kak?")).toBe("negotiation");
    expect(topic("saya ambil yang Air M2", { shown: true })).toBe("closing");
  });
});

describe("what the customer hears, and the task it leaves", () => {
  it("says it will connect them when they ask for an admin", () => {
    expect(holdingMessage("human", true)).toBe(
      "Oke kak, aku sambungkan ke admin ya 🙏",
    );
  });

  it("each new case has its own line, recognised as the bot's", () => {
    const lines = [
      holdingMessage("video_call", true, "video_call"),
      holdingMessage("video_call", true, "phone"),
      holdingMessage("video_call", true, "video"),
      holdingMessage("unit_details", true, "defect"),
      holdingMessage("unit_details", true, "photo_detail"),
      holdingMessage("warranty_claim", true, "warranty"),
      holdingMessage("service", true, "service"),
      holdingMessage("service", true, "past_purchase"),
      holdingMessage("shipping_quote", true, "address"),
    ];
    expect(new Set(lines).size).toBe(lines.length);
    for (const l of lines) {
      expect(isHoldingLine(l)).toBe(true);
      // The bot never mentions an admin unless asked for one.
      expect(l).not.toMatch(/admin/i);
    }
    expect(holdingMessage("warranty_claim", true, "warranty")).not.toMatch(
      /maaf/i,
    );
  });

  it("the task names the job", () => {
    const sum = (text: string) => {
      const r = route(text, { photosSent: true })!;
      return routeSummary(r, text).split("\n")[0];
    };
    expect(sum("bisa vc?")).toBe("Perlu atur video call");
    expect(sum("ganti baterai berapa?")).toBe("Perlu urus servis");
    expect(sum("unit yang saya beli kemarin bisa upgrade ssd?")).toBe(
      "Perlu cek pembelian lalu",
    );
    expect(sum("minta foto detail bagian keyboard")).toBe(
      "Perlu kirim foto detail",
    );
    expect(sum("garansinya berapa lama?")).toBe("Perlu urus garansi");
    expect(sum("kirim ke Bekasi Timur")).toMatch(/^Perlu cek ongkir/);
  });
});

describe("photos only on request (owner, 2026-11-16)", () => {
  it.each([
    "minta foto",
    "ada fotonya?",
    "fotonya dong",
    "lihat foto unitnya",
    "pic nya ada?",
    "real pic kak",
    "boleh minta gambarnya?",
  ])("%j asks for photos", (text) => {
    expect(asksForPhotos(text)).toBe(true);
  });

  it.each([
    "ada air m2?",
    "harganya berapa",
    "minta videonya",
    "mau lihat langsung ke toko",
  ])("%j does not", (text) => {
    expect(asksForPhotos(text)).toBe(false);
  });
});

// --- the rules bot -----------------------------------------------------------

const NOW = new Date("2026-10-15T03:00:00.000Z");
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;
const AIR = {
  serial: "C02AIRM1XX",
  model: "MacBook Air M1",
  variant: "8/256",
  grade: "B",
  price: "Rp 8.900.000",
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

function rulesInput(
  text: string,
  p: ReturnType<typeof pos>,
  over: Partial<RulesInput> = {},
): RulesInput {
  const ctx: ToolContext = {
    from: "628111000916",
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
    knowledge: knowledgeBase([
      {
        id: "k1",
        question: "Garansi berapa lama?",
        answer: "Garansi toko 1 bulan ya kak 😊",
      },
    ]),
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

describe("the rules bot", () => {
  it("recommends without sending photos", async () => {
    const p = pos({
      search_stock: { matched: 1, units: [AIR] },
      unit_photos: { found: true, ...AIR, photoIds: ["p1", "p2"] },
    });
    const out = await runRules(rulesInput("ada air m1?", p));
    expect(out.reply).toContain("Air M1");
    expect(out.photos).toBeUndefined();
    expect(p.asked.map((a) => a.name)).not.toContain("unit_photos");
  });

  it("sends them when asked", async () => {
    const p = pos({
      unit_photos: { found: true, ...AIR, photoIds: ["p1", "p2"] },
    });
    const out = await runRules(
      rulesInput("minta fotonya dong", p, { lastShown: [AIR.serial] }),
    );
    expect(out.photos).toEqual(["p1", "p2"]);
  });

  it("sends no photos for words that do not ask for photos", async () => {
    const p = pos({
      unit_photos: { found: true, ...AIR, photoIds: ["p1", "p2"] },
    });
    const out = await runRules(
      rulesInput("boleh liat unitnya kak?", p, { lastShown: [AIR.serial] }),
    );
    expect(out.photos).toBeUndefined();
    expect(p.asked.map((a) => a.name)).not.toContain("unit_photos");
  });

  it("hands a warranty question to a person instead of the approved answer", async () => {
    const out = await runRules(
      rulesInput("garansinya berapa lama kak?", pos({})),
    );
    expect(out.handoff?.topic).toBe("warranty_claim");
    // Said once, and no question tacked on (owner, 2026-11-18 — REVERSES
    // the 2026-11-16 "one light question").
    expect(out.reply).toBe("Untuk garansinya nanti tim kami konfirmasi ya kak");
  });

  it("answers a numbered list per question, and names what the team confirms once, at the end (2026-11-16)", async () => {
    const p = pos({ search_stock: { matched: 1, units: [AIR] } });
    const out = await runRules(
      rulesInput(
        "Hi, aku mau tanya ya:\n1. ada air m1?\n2. garansinya berapa lama?",
        p,
        { route: null },
      ),
    );
    const [first, second] = out.reply.split("\n\n");
    expect(first).toMatch(/^1\. ada air m1\?\n/);
    expect(first).toContain("8,9jt");
    // An item whose whole answer is "the team confirms" is not repeated
    // under its number: it is the one line under the answered ones.
    expect(second).toBe("Untuk garansinya nanti tim kami konfirmasi ya kak");
    expect(out.handoff?.topic).toBe("warranty_claim");
    expect(out.reply.split("\n\n")).toHaveLength(2);
  });

  it("answers the rest of a burst before handing over the part a person takes", async () => {
    const p = pos({ search_stock: { matched: 1, units: [AIR] } });
    const text = "ada air m1?\nbisa vc kak?";
    const out = await runRules(rulesInput(text, p));
    expect(out.handoff?.topic).toBe("video_call");
    expect(out.reply).toContain("8,9jt");
    expect(out.reply).toContain(
      "Untuk video call-nya nanti tim kami atur ya kak",
    );
  });

  it("answers a delivery cost generally, says the team estimates it, and asks the address", async () => {
    const out = await runRules(rulesInput("ongkir ke surabaya brp?", pos({})));
    expect(out.handoff).toBeUndefined();
    expect(out.reply).toMatch(/tim kami yang hitung/);
    expect(out.reply).toMatch(/alamat/);
    expect(out.reply).not.toMatch(/\d+\s*(rb|ribu|k|jt)|rp/i);
    expect(askedForAddress(out.reply)).toBe(true);
  });

  it("gives the approved COD answer as the general part", async () => {
    const out = await runRules(
      rulesInput("kalo cod ke bekasi biayanya brp?", pos({}), {
        knowledge: knowledgeBase([
          {
            id: "k1",
            question: "COD bisa ga kak?",
            answer: "Bisa kak, COD area Jabodetabek ada biaya Rp180.000 ya kak",
          },
        ]),
      }),
    );
    expect(out.handoff).toBeUndefined();
    expect(out.reply).toContain("COD area Jabodetabek ada biaya Rp180.000");
    expect(out.reply).toMatch(/alamat/);
  });

  it("hands the address over once the bot asked for it", async () => {
    const asked =
      "Untuk ongkirnya nanti tim kami yang hitungkan ya kak. Boleh kirim alamat lengkapnya kak (kecamatan/kota)?";
    const text = "Jl. Melati No 12, Kebayoran Baru, Jaksel";
    const out = await runRules(
      rulesInput(text, pos({}), {
        lastReply: asked,
        route: routeMessage(text, {
          capabilities: LIVE,
          deliveryContext: true,
        }),
      }),
    );
    expect(out.handoff?.topic).toBe("shipping_quote");
    expect(out.reply).toBe(
      "Siap kak, alamatnya aku teruskan ke tim untuk dihitung ongkirnya ya 🙏",
    );
  });
});

// --- lists, pure ----------------------------------------------------------------

describe("a numbered list of questions", () => {
  it.each([
    "Hi, aku mau tanya ya:\n1. ada air m1?\n2. garansinya berapa lama?",
    "1) ada air m1?\n2) garansinya berapa lama?",
    "1 - ada air m1?\n2 - garansinya berapa lama?",
    "- ada air m1?\n- garansinya berapa lama?",
    "• ada air m1?\n• garansinya berapa lama?",
    "mau tanya 1. ada air m1? 2. garansinya berapa lama?",
  ])("is read from %j", (text) => {
    const list = questionItems(text);
    expect(list?.items.map((i) => i.text)).toEqual([
      "ada air m1?",
      "garansinya berapa lama?",
    ]);
  });

  it.each([
    "ada air m1?",
    "air m1 8/256 berapa?",
    "harganya 11.9jt ya kak",
    "1. ada air m1?",
    "kirim ke jl. merdeka 2. jakarta",
  ])("is not read from %j", (text) => {
    expect(questionItems(text)).toBeNull();
  });

  it("is answered question, answer, blank line", () => {
    const list = questionItems("1. ada air m1?\n2. garansinya berapa lama?")!;
    expect(
      formatItemAnswers(list, [
        "Ada kak, Air M1 8,9jt\n\nGimana kakk?",
        "Untuk garansinya aku tanyain dulu ya kak",
      ]),
    ).toBe(
      "1. ada air m1?\nAda kak, Air M1 8,9jt\nGimana kakk?\n\n2. garansinya berapa lama?\nUntuk garansinya aku tanyain dulu ya kak",
    );
  });

  it("a closing line two answers share is said once, at the end", () => {
    const list = questionItems("1. ada air m1?\n2. ada air m2?")!;
    expect(
      formatItemAnswers(list, [
        "Air M1 8,9jt\nGimana kakk?",
        "Air M2 11jt\nGimana kakk?",
      ]),
    ).toBe(
      "1. ada air m1?\nAir M1 8,9jt\n\n2. ada air m2?\nAir M2 11jt\nGimana kakk?",
    );
  });

  it("merges the answers: photos, sources, the first hand-over and the others", () => {
    const list = questionItems(
      "1. ada air m1?\n2. ongkir ke medan?\n3. bisa vc?",
    )!;
    const results: ConverseResult[] = [
      {
        reply: "Ada kak",
        rawReply: "Ada kak",
        toolsUsed: ["search_stock"],
        steps: 1,
        sources: ["stock"],
        shown: ["S1"],
      },
      {
        reply: "Ongkirnya aku cekin dulu ya kak",
        rawReply: "",
        toolsUsed: [],
        steps: 1,
        sources: [],
        handoff: { topic: "shipping_quote", summary: "Perlu cek ongkir" },
      },
      {
        reply: "Siap kak",
        rawReply: "",
        toolsUsed: [],
        steps: 1,
        sources: [],
        handoff: { topic: "video_call", summary: "Perlu atur video call" },
      },
    ];
    const m = mergeItemResults(list, results);
    expect(m.reply.split("\n\n")).toHaveLength(3);
    expect(m.sources).toEqual(["stock"]);
    expect(m.shown).toEqual(["S1"]);
    expect(m.handoff?.topic).toBe("shipping_quote");
    expect(m.extraHandoffs?.map((h) => h.topic)).toEqual(["video_call"]);
    expect(m.toolsUsed).toEqual(["search_stock"]);
  });
});

// --- the AI path ---------------------------------------------------------------

const SHELF_AIR = { ...AIR, left: 2 };

function talk(
  script: readonly ScriptStep[],
  text: string,
  answers: Record<string, unknown> = {},
  over: Partial<ConverseInput> = {},
) {
  const scripted = scriptedClient(script);
  const result = converse({
    client: scripted.client,
    db: noDb as unknown as PrismaClient,
    ctx: { from: "628111", now: NOW, capabilities: SHOP_CAPABILITIES },
    prompt: { stable: "S", volatile: "V" },
    turns: [{ role: "user", text }],
    knowledge: knowledgeBase([]),
    storeFacts: "Buka 10.00-20.00",
    capabilities: SHOP_CAPABILITIES,
    route: null,
    dispatch: async (name) => answers[name] ?? { error: "not scripted" },
    ...over,
  });
  return { result, calls: scripted.calls };
}

describe("the AI agent", () => {
  const shelf = {
    search_stock: { matched: 1, units: [SHELF_AIR] },
    unit_photos: { found: true, serial: AIR.serial, photoIds: ["p1", "p2"] },
  };

  it("does not send photos nobody asked for, and is told so once", async () => {
    const t = talk(
      [
        calls("search_stock", { query: "air m1" }),
        calls("unit_photos", { serial: AIR.serial }),
        calls("reply", {
          message: "Ada kak, Air M1 8,9jt",
          sources: "stock",
          photos: "p1,p2",
        }),
        calls("reply", { message: "Ada kak, Air M1 8,9jt", sources: "stock" }),
      ],
      "ada air m1?",
      shelf,
    );
    const r = await t.result;
    expect(r?.photos).toBeUndefined();
    expect(JSON.stringify(t.calls[3]!.messages.at(-1))).toContain(
      "did not ask for photos",
    );
  });

  it("drops them on a second try that still sends them", async () => {
    const r = await talk(
      [
        calls("search_stock", { query: "air m1" }),
        calls("unit_photos", { serial: AIR.serial }),
        calls("reply", {
          message: "Ada kak, Air M1 8,9jt",
          sources: "stock",
          photos: "p1",
        }),
        calls("reply", {
          message: "Ada kak, Air M1 8,9jt",
          sources: "stock",
          photos: "p1",
        }),
      ],
      "ada air m1?",
      shelf,
    ).result;
    expect(r?.photos).toBeUndefined();
    expect(r?.handoff).toBeUndefined();
  });

  it("sends them when the customer asked", async () => {
    const r = await talk(
      [
        calls("unit_photos", { serial: AIR.serial }),
        calls("reply", {
          message: "Ini fotonya kak",
          sources: "chat",
          photos: "p1,p2",
        }),
      ],
      "minta fotonya dong",
      shelf,
    ).result;
    expect(r?.photos).toEqual(["p1", "p2"]);
  });

  it("never brings up an admin on its own", async () => {
    const t = talk(
      [
        replies("Boleh kak, nanti admin kami bantu ya", "chat"),
        replies("Boleh kak, ada yang mau ditanyain lagi?", "chat"),
      ],
      "oke kak",
    );
    const r = await t.result;
    expect(r?.reply).not.toMatch(/admin/i);
    expect(JSON.stringify(t.calls[1]!.messages.at(-1))).toContain("admin");
  });

  it("takes an admin out of a hand-over line that is not about one", async () => {
    const r = await talk(
      [
        handsOver(
          "video_call",
          "Perlu atur video call",
          "Nanti admin kami atur video call-nya ya kak",
        ),
      ],
      "bisa vc kak?",
      {},
      {
        route: routeMessage("bisa vc kak?", {
          capabilities: SHOP_CAPABILITIES,
        }),
      },
    ).result;
    expect(r?.handoff?.topic).toBe("video_call");
    expect(r?.reply).toBe("Untuk video call-nya nanti tim kami atur ya kak");
  });

  it("sends back a delivery figure it made up, and drops it on the second try", async () => {
    const t = talk(
      [
        replies("Ongkir ke Bandung sekitar 50rb kak", "chat"),
        replies(
          "Untuk ongkirnya nanti tim kami yang hitungkan ya kak. Boleh kirim alamat lengkapnya kak?",
          "chat",
        ),
      ],
      "ongkir ke bandung brp kak?",
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).not.toMatch(/50rb/);
    expect(JSON.stringify(t.calls[1]!.messages.at(-1))).toContain("delivery");
  });

  it("accepts the new hand-overs without pushing them back", async () => {
    const t = talk(
      [
        handsOver(
          "video_call",
          "Perlu atur video call",
          "Siap kak, untuk video call-nya aku atur dulu ya",
        ),
      ],
      "bisa lihat unitnya live?",
    );
    const r = await t.result;
    expect(r?.handoff?.topic).toBe("video_call");
    expect(t.calls).toHaveLength(1);
  });
});
