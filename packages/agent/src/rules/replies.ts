/**
 * The rule-based bot's sentences (owner, 2026-10-15). Each one says only what
 * a POS lookup returned — a template cannot invent a price or a unit, which
 * is why these replies need no `checkReply`. In the voice of the owner's own
 * answers (docs/chatbot/knowledge-2026-09-18.md): "kak", one or two emoji,
 * short. Indonesian unless the customer wrote in English.
 */

export type Lang = "id" | "en";

/** A unit as the stock lookups return it. */
export interface ShownUnit {
  readonly serial: string;
  readonly model?: string;
  readonly variant?: string;
  readonly grade?: string;
  readonly price?: string | null;
  /** Battery health %, on a 2021-or-later unit. */
  readonly batteryHealth?: number;
  /** Cycle count, on an older unit. */
  readonly cycleCount?: number;
  /** Sellable units of this variant — the only source of "tinggal 1". */
  readonly left?: number;
}

/** A counted accessory as the stock lookup returns it — no serial. */
export interface ShownAccessory {
  readonly model: string;
  readonly price?: string | null;
}

const GRADE: Record<string, { id: string; en: string }> = {
  NEW: { id: "baru (segel)", en: "new (sealed)" },
  A: { id: "grade A", en: "grade A" },
  B: { id: "grade B", en: "grade B" },
  C: { id: "grade C", en: "grade C" },
};

/** "baterai 91%" / "312 siklus" — whichever the unit's era records. */
function batteryText(u: ShownUnit, lang: Lang): string | null {
  if (typeof u.batteryHealth === "number")
    return lang === "en"
      ? `battery ${u.batteryHealth}%`
      : `baterai ${u.batteryHealth}%`;
  if (typeof u.cycleCount === "number")
    return lang === "en"
      ? `battery ${u.cycleCount} cycles`
      : `baterai ${u.cycleCount} siklus`;
  return null;
}

/**
 * One unit, the way the shop says it: name, grade, battery, price — and,
 * only when the shelf's own count says so, that it is the last one (owner,
 * 2026-10-27: honest urgency, never invented).
 */
export function unitLine(u: ShownUnit, lang: Lang, n?: number): string {
  const name = [u.model, u.variant].filter(Boolean).join(" ");
  const grade = u.grade ? (GRADE[u.grade]?.[lang] ?? `grade ${u.grade}`) : null;
  const battery = batteryText(u, lang);
  const price = u.price ? u.price : null;
  const last =
    u.left === 1
      ? lang === "en"
        ? " (only 1 left)"
        : " (tinggal 1 unit kak)"
      : "";
  return `${n !== undefined ? `${n}. ` : ""}${name}${grade ? `, ${grade}` : ""}${battery ? `, ${battery}` : ""}${price ? ` — ${price}` : ""}${last}`;
}

/** The next step a reply ends on — one small yes-question (2026-10-27). */
export type NextStep = "photos" | "visit" | "process";

export const reply = {
  greeting(lang: Lang): string {
    return lang === "en"
      ? "Hi! 😊 Welcome to Macbook Nusantara. Which unit are you looking for?"
      : "Halo kak 😊 Selamat datang di Macbook Nusantara. Lagi cari unit apa kak?";
  },

  thanks(lang: Lang): string {
    return lang === "en"
      ? "You're welcome! 😊 Let us know if there's anything else."
      : "Sama-sama kak 😊 Kalau ada yang mau ditanyakan lagi, kabari aja ya.";
  },

  /** An acknowledgement ("ok kak"): carry on — the question follows. */
  ack(lang: Lang): string {
    return lang === "en" ? "Sure 😊" : "Siap kak 😊";
  },

  /** They told us about themselves; the next question follows. */
  noted(lang: Lang): string {
    return lang === "en"
      ? "Got it, thanks for letting me know 😊"
      : "Siap kak, terima kasih infonya 😊";
  },

  /** Nothing left to ask: offer to pick something out. */
  offerSearch(lang: Lang): string {
    return lang === "en"
      ? "Shall I pick out the units that suit you?"
      : "Mau saya carikan unit yang paling cocok untuk kakak?";
  },

  stockList(units: readonly ShownUnit[], matched: number, lang: Lang): string {
    const lines = units.map((u, i) => unitLine(u, lang, i + 1)).join("\n");
    const more = matched > units.length ? matched - units.length : 0;
    if (lang === "en")
      return (
        `Yes, we have these 😊\n${lines}` +
        (more > 0
          ? `\nAnd ${more} more — tell me what you need and I'll narrow it down.`
          : "")
      );
    return (
      `Ada kak 😊 Ini yang ready:\n${lines}` +
      (more > 0
        ? `\nMasih ada ${more} unit lain ya kak, bisa saya pilihkan sesuai kebutuhan.`
        : "")
    );
  },

  /**
   * Three, not a list (owner, 2026-10-27): the best fit, a cheaper one and
   * ONE step up — each a unit the lookup returned, with its price, grade and
   * battery. Any of the last two may be absent.
   */
  recommend(
    r: {
      readonly best: ShownUnit;
      readonly cheaper: ShownUnit | null;
      readonly stepUp: ShownUnit | null;
    },
    lang: Lang,
  ): string {
    const lines =
      lang === "en"
        ? [
            `Yes 😊 The best fit for you:\n${unitLine(r.best, lang)}`,
            r.cheaper ? `To spend less: ${unitLine(r.cheaper, lang)}` : null,
            r.stepUp
              ? `For a bit more room: ${unitLine(r.stepUp, lang)}`
              : null,
          ]
        : [
            `Ada kak 😊 Yang paling pas buat kakak:\n${unitLine(r.best, lang)}`,
            r.cheaper
              ? `Kalau mau lebih hemat: ${unitLine(r.cheaper, lang)}`
              : null,
            r.stepUp
              ? `Kalau mau lebih lega: ${unitLine(r.stepUp, lang)}`
              : null,
          ];
    return lines.filter(Boolean).join("\n");
  },

  /**
   * The one small yes-question every recommendation ends on (2026-10-27):
   * see it, come and see it, or let us get it moving.
   */
  nextStep(step: NextStep, lang: Lang): string {
    switch (step) {
      case "photos":
        return lang === "en"
          ? "Would you like to see photos?"
          : "Mau lihat fotonya kak?";
      case "visit":
        return lang === "en"
          ? "Would you like to come and see it in person? When suits you?"
          : "Mau datang lihat langsung, kapan enaknya kak?";
      default:
        return lang === "en"
          ? "Shall I help you get it processed?"
          : "Mau saya bantu proses kak?";
    }
  },

  /** Out of stock: offer to tell them when it is in (2026-10-27). */
  offerWatch(lang: Lang): string {
    return lang === "en"
      ? "Shall I let you know when it's in?"
      : "Mau saya kabari kalau sudah ready kak?";
  },

  watchSaved(lang: Lang): string {
    return lang === "en"
      ? "Will do 😊 We'll message you right here once it's in."
      : "Siap kak 😊 Nanti kami kabari di chat ini kalau sudah ready ya.";
  },

  /** They said yes to the reminder: the visit stands. */
  visitKept(when: string, lang: Lang): string {
    return lang === "en"
      ? `Great 😊 See you ${when}!`
      : `Siap kak 😊 Kami tunggu kedatangannya ${when} ya 🙏`;
  },

  /** They cannot come: the visit is closed, and another day is asked for. */
  visitCancelled(lang: Lang): string {
    return lang === "en"
      ? "No problem 😊 Would another day suit you better?"
      : "Siap kak, gak apa-apa 😊 Kalau mau datang di hari lain, enaknya hari apa kak?";
  },

  visitMoved(when: string, lang: Lang): string {
    return lang === "en"
      ? `Done 😊 Your visit is moved to ${when}. See you then!`
      : `Siap kak 😊 Jadwal datangnya kami pindah ke ${when} ya. Kami tunggu 🙏`;
  },

  /** Out of stock, said plainly, with no question after it. */
  outOfStock(lang: Lang): string {
    return lang === "en"
      ? "Sorry, we don't have that one right now 🙏"
      : "Mohon maaf kak, untuk unit itu sedang kosong 🙏";
  },

  noStock(lang: Lang): string {
    return lang === "en"
      ? "Sorry, we don't have that one right now 🙏 Would you like a similar unit instead?"
      : "Mohon maaf kak, untuk unit itu sedang kosong 🙏 Mau saya carikan alternatif yang mirip?";
  },

  /**
   * Out of stock, and what is closest that is not (owner, 2026-10-27: "if
   * the stock is 0, the system should upsell / cross sell items"). Only what
   * the lookup returned, like every line here.
   */
  alternatives(units: readonly ShownUnit[], lang: Lang): string {
    const lines = units.map((u, i) => unitLine(u, lang, i + 1)).join("\n");
    return lang === "en"
      ? `Sorry, that one isn't in stock right now 🙏 The closest we have ready:\n${lines}`
      : `Mohon maaf kak, untuk unit itu sedang kosong 🙏 Yang paling mirip dan ready:\n${lines}`;
  },

  /** One option above the main pick — offered, never pushed. */
  stepUp(u: ShownUnit, lang: Lang): string {
    return lang === "en"
      ? `If you'd like a bit more room, there's also ${unitLine(u, lang)} 😊`
      : `Kalau mau lebih lega, ada juga ${unitLine(u, lang)} 😊`;
  },

  /** A fitting accessory on the shelf, mentioned once. */
  accessory(a: ShownAccessory, lang: Lang): string {
    const what = `${a.model}${a.price ? ` — ${a.price}` : ""}`;
    return lang === "en"
      ? `We also have ${what} if you need one.`
      : `Kalau perlu, ada juga ${what} ya kak.`;
  },

  whichUnit(lang: Lang): string {
    return lang === "en"
      ? "Sure 😊 Which unit do you mean? You can send the model (e.g. MacBook Air M2 8/256)."
      : "Siap kak 😊 Unit yang mana ya? Boleh sebutkan tipenya (misal MacBook Air M2 8/256).";
  },

  price(u: ShownUnit, lang: Lang): string {
    return lang === "en"
      ? `${unitLine(u, lang)} 😊`
      : `Untuk ${unitLine(u, lang)} ya kak 😊`;
  },

  photos(u: ShownUnit | null, lang: Lang): string {
    const what = u ? unitLine(u, lang) : null;
    return lang === "en"
      ? `Here are the photos${what ? ` of ${what}` : ""} 😊`
      : `Ini foto unitnya ya kak${what ? ` (${what})` : ""} 😊`;
  },

  noPhotos(lang: Lang): string {
    return lang === "en"
      ? "We don't have photos of that unit yet 🙏 A colleague will send some shortly."
      : "Foto unit itu belum tersedia kak 🙏 Admin kami siapkan dan kirim segera ya.";
  },

  askForVisit(
    missing: { name: boolean; when: boolean; unit: boolean },
    lang: Lang,
  ): string {
    const need: string[] = [];
    if (lang === "en") {
      if (missing.unit) need.push("which unit you'd like to see");
      if (missing.name) need.push("the name for the booking");
      if (missing.when)
        need.push("the day and time you'll come (we're open 10.00–20.00)");
      return `Sure, you're welcome to come and see it 😊 Please tell me ${need.join(", ")}.`;
    }
    if (missing.unit) need.push("unit yang mau dilihat");
    if (missing.name) need.push("nama untuk bookingnya");
    if (missing.when)
      need.push("hari dan jam datangnya (toko buka 10.00–20.00 WIB)");
    return `Bisa kak, silakan datang lihat langsung ke toko 😊 Boleh info ${need.join(", ")}?`;
  },

  proposal(
    p: {
      readonly units: readonly ShownUnit[];
      readonly when: string;
      readonly custName: string;
    },
    lang: Lang,
  ): string {
    const units = p.units.map((u, i) =>
      unitLine(u, lang, p.units.length > 1 ? i + 1 : undefined),
    );
    const [date, time] = p.when.split(" ");
    const see = units.length ? `${units.join("\n")}\n` : "";
    if (lang === "en")
      return (
        `Let me confirm 😊\n${see}Visit: ${date} at ${time}\nName: ${p.custName}\n` +
        "Is that right? Reply yes and I'll book it."
      );
    return (
      `Saya konfirmasi dulu ya kak 😊\n${see}Jadwal datang: ${date} jam ${time} WIB\n` +
      `Atas nama: ${p.custName}\nSudah betul kak? Balas "iya" nanti langsung saya catat.`
    );
  },

  booked(
    b: {
      readonly code: string;
      readonly when?: string;
      readonly heldUntil?: string;
    },
    lang: Lang,
  ): string {
    return lang === "en"
      ? `Booked 😊 Your visit code is ${b.code}${b.when ? ` for ${b.when}` : ""}. ` +
          `See you at the shop!`
      : `Sudah kami catat ya kak 😊 Kode booking: ${b.code}${b.when ? `, jadwal datang ${b.when} WIB` : ""}. ` +
          "Sampai ketemu di toko ya kak 🙏";
  },

  bookingFailed(lang: Lang): string {
    return lang === "en"
      ? "Sorry, I couldn't complete the booking 🙏 A colleague will confirm it with you shortly."
      : "Mohon maaf kak, bookingnya belum berhasil 🙏 Admin kami bantu konfirmasi segera ya.";
  },

  declined(lang: Lang): string {
    return lang === "en"
      ? "No problem 😊 Let me know if you'd like to see another unit."
      : "Siap kak, gak apa-apa 😊 Kalau mau lihat unit lain, kabari aja ya.";
  },

  /**
   * The bot always asks what the customer needs until it knows (owner,
   * 2026-10-15: "the goal of the bot is to always ask about what the user
   * wants/needs … if they have not figured out the preferences, usage, they
   * need to always ask"). The first thing the profile lacks, in this order;
   * the second phrasing when the last reply already asked it the first way,
   * so a customer who skipped the question is not sent the same words twice.
   */
  nextQuestion(
    lacks: {
      usage: boolean;
      preferences: boolean;
      budget: boolean;
      apps: boolean;
    },
    lang: Lang,
    lastReply: string | null = null,
  ): string | null {
    // Briefly (owner, 2026-10-27): usage, then budget — and nothing once
    // there is enough to recommend, which the caller decides.
    const key = (["usage", "budget"] as const).find((k) => lacks[k]);
    if (!key) return null;
    const [first, second] = QUESTIONS[key][lang];
    return lastReply?.includes(first) ? second : first;
  },

  /**
   * The customer nudges ("kak?") while a question of theirs is with a
   * colleague (2026-10-27): say once what the team is still on, then carry
   * on. Said only when the bot's previous reply did not already promise it.
   */
  stillWaiting(topics: readonly string[], lang: Lang): string {
    const what = [
      ...new Set(topics.map((t) => WAITING_ON[t] ?? WAITING_ON["other"]!)),
    ]
      .map((w) => w[lang])
      .join(lang === "en" ? " and " : " dan ");
    return lang === "en"
      ? `Our team is still on ${what} — they'll reply right here 🙏`
      : `Untuk ${what} tadi masih dicek tim kami ya kak, nanti dibalas di chat ini 🙏`;
  },

  /**
   * Another question for a colleague while one is already waiting and the
   * customer has been told so: a short line, not the same promise again.
   */
  passedOnToo(lang: Lang): string {
    return lang === "en"
      ? "Noted, I've passed that on to our team as well 🙏"
      : "Siap kak, yang ini juga sudah kami teruskan ke tim kami ya 🙏";
  },

  offerVisit(lang: Lang): string {
    return lang === "en"
      ? "If you'd like to see it in person, I can book a visit — just send your name and a time 😊"
      : "Kalau mau lihat langsung unitnya di toko, bisa saya bookingkan kak — cukup kabari nama dan jam datangnya ya 😊";
  },
};

/**
 * The two follow-ups the worker sends by itself, once (owner's wording,
 * 2026-10-27). `{unit}` is the unit or model discussed, "unitnya" if none.
 */
export const followUps = {
  visitReminder(unit: string | null): string {
    return `Halo kak 😊 apakah kakak jadi datang ke toko kami untuk lihat ${unit?.trim() || "unitnya"}? Kami tunggu ya kedatangannya 🙏`;
  },
  leadNudge(unit: string): string {
    return `Halo kak 😊 ${unit} yang kemarin kakak tanyakan masih ready ya. Kalau mau lihat langsung atau ada yang mau ditanyakan, kabari kami aja kak 🙏`;
  },
  /**
   * A day before a DP hold runs out (2026-10-27), once, in the visit
   * reminder's tone. `until` is the day as the shop says it ("Senin, 3 Nov").
   */
  dpReminder(unit: string | null, until: string): string {
    return `Halo kak 😊 unit ${unit?.trim() || "kakak"} masih kami tahan sampai ${until} ya. Kalau mau dilunasi atau datang ambil, kabari kami aja kak 🙏`;
  },
  /** The unit they asked about is gone (never why); the closest in stock, once. */
  leadNudgeAlternative(unit: string, alternative: string): string {
    return `Halo kak 😊 ${unit} yang kemarin kakak tanyakan sedang kosong, tapi ada ${alternative} yang mirip dan ready ya. Kalau mau lihat langsung atau ada yang mau ditanyakan, kabari kami aja kak 🙏`;
  },
};

/** What a colleague is still checking, by hand-over topic. */
const WAITING_ON: Record<string, Record<Lang, string>> = {
  price: { id: "harganya", en: "the price" },
  stock: { id: "unitnya", en: "the unit" },
  unit_details: { id: "kondisi unitnya", en: "the unit's condition" },
  recommendation: { id: "pilihan unitnya", en: "the pick for you" },
  negotiation: { id: "tawarannya", en: "your offer" },
  reservation: { id: "bookingnya", en: "the booking" },
  order_payment: { id: "pembayarannya", en: "your payment" },
  trade_in: { id: "taksirannya", en: "the valuation" },
  sell_to_shop: { id: "taksirannya", en: "the valuation" },
  shipping_quote: { id: "ongkirnya", en: "the shipping cost" },
  warranty_claim: { id: "kendalanya", en: "the issue" },
  complaint: { id: "kendalanya", en: "the issue" },
  media: { id: "kiriman kakak", en: "what you sent" },
  photos: { id: "fotonya", en: "the photos" },
  other: { id: "pertanyaan kakak", en: "your question" },
};

/** What the bot asks to learn a customer's needs, two ways each. */
const QUESTIONS: Record<
  "usage" | "preferences" | "budget" | "apps",
  Record<Lang, readonly [string, string]>
> = {
  usage: {
    id: [
      "Kalau boleh tahu, rencananya dipakai untuk apa kak?",
      "Biar saya bantu pilihkan yang pas, kebutuhannya lebih ke apa kak — kuliah, kerja kantor, desain, coding, atau editing video?",
    ],
    en: [
      "What will you mainly use it for?",
      "So I can pick the right one — is it for study, office work, design, coding or video editing?",
    ],
  },
  preferences: {
    id: [
      "Ada preferensi khusus kak? Misalnya mau yang baru atau second, ukuran layar, warna, atau RAM/SSD-nya?",
      "Untuk unitnya, kakak lebih suka yang baru atau second, dan ukuran layar berapa inch kak?",
    ],
    en: [
      "Any preferences? For example new or second-hand, screen size, colour, or RAM/storage?",
      "Would you prefer new or second-hand, and which screen size?",
    ],
  },
  budget: {
    id: [
      "Budgetnya kira-kira di kisaran berapa kak?",
      "Supaya rekomendasinya pas, budget maksimalnya berapa ya kak?",
    ],
    en: [
      "Roughly what budget do you have in mind?",
      "What's the most you'd like to spend?",
    ],
  },
  apps: {
    id: [
      "Ada aplikasi khusus yang bakal sering dipakai kak?",
      "Aplikasi apa saja yang paling sering kakak pakai sehari-hari?",
    ],
    en: [
      "Any specific apps you'll run on it?",
      "Which apps will you use most?",
    ],
  },
};
