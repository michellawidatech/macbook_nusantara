/**
 * The rule-based bot's sentences (owner, 2026-10-15). Each one says only what
 * a POS lookup returned — a template cannot invent a price or a unit, which
 * is why these replies need no `checkReply`. In the voice of a shop admin on
 * WhatsApp (2026-10-27): "kak", "aku", one emoji, one or two short lines.
 * Indonesian unless the customer wrote in English.
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
  /** The shop's own photos of it — sent with a recommendation when there are some. */
  readonly photos?: number;
  /**
   * QC's description, split (2026-10-28): faults are said upfront, marks only
   * when the customer asks about the condition.
   */
  readonly condition?: {
    readonly faults: readonly string[];
    readonly marks: readonly string[];
  };
  /** "never" → "belum pernah servis"; "yes" is said only when asked. */
  readonly serviced?: "never" | "yes";
  /** The variant's listings — sent only when they ask how to buy online. */
  readonly links?: {
    readonly shopee?: string;
    readonly tokopedia?: string;
    readonly instagram?: string;
  };
  /** How many of this grade, on an `otherGrades` row. */
  readonly count?: number;
}

/** Which marketplace a message names, if any. */
export type Platform = "shopee" | "tokopedia" | "instagram";

/** A counted accessory as the stock lookup returns it — no serial. */
export interface ShownAccessory {
  readonly model: string;
  readonly price?: string | null;
}

/**
 * The condition, as a person says it (2026-10-27: "mulus", not "grade A").
 * The grade is still what decides it; only the words changed.
 */
const CONDITION: Record<string, { id: string; en: string }> = {
  NEW: { id: "baru segel", en: "brand new, sealed" },
  A: { id: "mulus", en: "like new" },
  B: { id: "ada lecet tipis", en: "light marks" },
  C: { id: "ada bekas pemakaian", en: "visible wear" },
};

/** "baterai 91%" / "baterai 312 siklus" — whichever the unit's era records. */
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
 * A price the way people text it: Rp 11.900.000 → "11,9jt", Rp 850.000 →
 * "850rb" — and only when that is EXACT. Rp 11.925.000 stays as it is: a
 * rounded price is a different price (`checkReply` reads "11,9jt" as
 * 11.900.000 exactly).
 */
export function shortPrice(price: string): string {
  const n = Number(price.replace(/\D/g, ""));
  if (!Number.isFinite(n) || n <= 0) return price;
  if (n >= 1_000_000 && n % 10_000 === 0) {
    const jt = n / 1_000_000;
    return `${String(jt).replace(".", ",")}jt`;
  }
  if (n < 1_000_000 && n % 1_000 === 0) return `${n / 1_000}rb`;
  return price.replace(/\s+/g, "");
}

/** "MacBook Air M2" → "Air M2": the name people actually say. */
function shortName(model: string | undefined): string {
  return (model ?? "").replace(/^MacBook\s+/i, "").trim();
}

/**
 * One unit, the way somebody at the counter says it: the short name, the
 * condition in words, the battery, the price — and, only when the shelf's own
 * count says so, that it is the last one (owner, 2026-10-27: honest urgency,
 * never invented). The RAM/SSD only with `variant: true` — when two units
 * side by side differ by it — because a spec line reads like a brochure.
 */
export function unitLine(
  u: ShownUnit,
  lang: Lang,
  n?: number,
  opts: { readonly variant?: boolean; readonly facts?: boolean } = {},
): string {
  const name = [
    shortName(u.model) || u.model,
    opts.variant === false ? null : u.variant,
  ]
    .filter(Boolean)
    .join(" ");
  const condition = u.grade
    ? (CONDITION[u.grade]?.[lang] ?? `grade ${u.grade}`)
    : null;
  const battery = batteryText(u, lang);
  const price = u.price ? shortPrice(u.price) : null;
  const last =
    u.left === 1
      ? lang === "en"
        ? " (only 1 left)"
        : " (tinggal 1 unit kak)"
      : "";
  // What QC wrote that the customer must hear before buying (2026-10-28):
  // a fault, and that it has never been serviced. Only on a recommendation
  // or a price — a booking read-back is not the place.
  const facts = opts.facts
    ? [
        ...(u.condition?.faults ?? []).map((f) => f.toLowerCase()),
        u.serviced === "never"
          ? lang === "en"
            ? "never serviced"
            : "belum pernah servis"
          : null,
      ].filter(Boolean)
    : [];
  return `${n !== undefined ? `${n}. ` : ""}${name}${condition ? ` ${condition}` : ""}${battery ? `, ${battery}` : ""}${facts.length ? `, ${facts.join(", ")}` : ""}${price ? `, ${price}` : ""}${last}`;
}

/** Whether units shown together need their RAM/SSD to tell them apart. */
function variantsMatter(units: ReadonlyArray<ShownUnit | null>): boolean {
  const names = units
    .filter((u): u is ShownUnit => u !== null)
    .map((u) => shortName(u.model));
  return new Set(names).size < names.length;
}

/** The next step a reply ends on — one small yes-question (2026-10-27). */
export type NextStep = "photos" | "visit" | "process";

/**
 * Rewritten 2026-10-27 (owner: *"the reply so bad, not like human"*): short
 * lines a shop admin would text, "aku" for the person typing, condition words
 * instead of grade letters, prices as "11,9jt". Every fact is still only what
 * a lookup returned.
 */
export const reply = {
  greeting(lang: Lang): string {
    return lang === "en"
      ? "Hi 😊 Welcome to Macbook Nusantara."
      : "Halo kak 😊 Selamat datang di Macbook Nusantara.";
  },

  /**
   * After a welcome, the one question a hello gets (owner, 2026-10-28: *"always
   * asks what can they help with, not this, too demanding"*) — never what the
   * laptop is for before they have said they want one.
   */
  offerHelp(lang: Lang): string {
    return lang === "en"
      ? "How can I help? 😊"
      : "Ada yang bisa aku bantu kak?";
  },

  /** A second "hi" in the same chat: no second welcome, a different line. */
  helloAgain(lang: Lang, lastReply: string | null): string {
    const first =
      lang === "en"
        ? "Yes 😊 How can I help?"
        : "Iya kak 😊 Ada yang bisa aku bantu?";
    const second =
      lang === "en"
        ? "Hi again 😊 Anything I can help you find?"
        : "Iya kak, ada yang mau ditanyain? 😊";
    return (lastReply ?? "").includes(first) ? second : first;
  },

  thanks(lang: Lang): string {
    return lang === "en" ? "You're welcome 😊" : "Sama-sama kak 😊";
  },

  /** An acknowledgement ("ok kak"): carry on — the question follows. */
  ack(lang: Lang): string {
    return lang === "en" ? "Sure 😊" : "Siap kak 😊";
  },

  /** They told us about themselves; the next question follows. */
  noted(lang: Lang): string {
    return lang === "en" ? "Got it, thanks 😊" : "Okee kak, noted 😊";
  },

  /** Nothing left to ask: offer to pick something out. */
  offerSearch(lang: Lang): string {
    return lang === "en"
      ? "Shall I pick out the ones that suit you?"
      : "Mau aku cariin yang paling pas kak?";
  },

  stockList(units: readonly ShownUnit[], matched: number, lang: Lang): string {
    const variant = { variant: variantsMatter(units) };
    const lines = units
      .map((u, i) => unitLine(u, lang, i + 1, variant))
      .join("\n");
    const more = matched > units.length ? matched - units.length : 0;
    if (lang === "en")
      return (
        `Yes, we have these 😊\n${lines}` +
        (more > 0 ? `\nAnd ${more} more if none of these fit.` : "")
      );
    return (
      `Ada kak 😊\n${lines}` +
      (more > 0 ? `\nMasih ada ${more} lagi kalau belum ada yang pas.` : "")
    );
  },

  /**
   * One first (owner, 2026-10-27): the best fit, then at most a cheaper one
   * and ONE step up — each a unit the lookup returned. Any of the last two
   * may be absent.
   */
  /**
   * The offer (owner, 2026-10-28): the cheapest unit of the lowest grade
   * first, the other grades of it in one line, then one step up — never a
   * list, never a push.
   */
  recommend(
    r: {
      readonly best: ShownUnit;
      readonly otherGrades: readonly ShownUnit[];
      readonly stepUp: ShownUnit | null;
    },
    lang: Lang,
  ): string {
    const v = { variant: variantsMatter([r.best, r.stepUp]), facts: true };
    const others = r.otherGrades
      .map((g) => {
        const words = g.grade
          ? (CONDITION[g.grade]?.[lang] ?? `grade ${g.grade}`)
          : null;
        const price = g.price ? shortPrice(g.price) : null;
        return [words, price].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const list = (xs: readonly string[], and: string) =>
      xs.length <= 1
        ? (xs[0] ?? "")
        : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`;
    const lines =
      lang === "en"
        ? [
            `The most affordable fit is the ${unitLine(r.best, lang, undefined, v)} 😊`,
            others.length
              ? `In other conditions there's also ${list(others, "and")}.`
              : null,
            r.stepUp
              ? `For a bit more room: ${unitLine(r.stepUp, lang, undefined, v)}.`
              : null,
          ]
        : [
            `Yang paling pas buat kakak ${unitLine(r.best, lang, undefined, v)} 😊`,
            others.length
              ? `Kalau mau kondisi lain, ada juga yang ${list(others, "dan yang")} kak.`
              : null,
            r.stepUp
              ? `Kalau mau lebih lega, ada juga ${unitLine(r.stepUp, lang, undefined, v)}.`
              : null,
          ];
    return lines.filter(Boolean).join("\n");
  },

  /**
   * After a recommendation or its photos (owner, 2026-10-28): no "mau lihat
   * fotonya?", no "kapan mau datang?" — leave room, and say the door is open.
   */
  afterOffer(lang: Lang): string {
    return lang === "en"
      ? "What do you think? You're also welcome to see it at our shop 😊"
      : "Gimana kakk? Kakak juga bisa lihat unitnya langsung di toko kita 😊";
  },

  /** "Mau keep unit ini dong kak": first, when they plan to come. */
  keepWhen(missing: { name: boolean; unit: boolean }, lang: Lang): string {
    if (lang === "en")
      return (
        "Sure 😊 When are you planning to come by?" +
        (missing.unit ? " And which unit is it?" : "") +
        (missing.name ? " And whose name shall I put it under?" : "")
      );
    return (
      "Siapp kak 😊 rencananya mau ke toko kapan kak?" +
      (missing.unit ? " Sekalian unit yang mana ya." : "") +
      (missing.name ? " Sekalian atas nama siapa ya." : "")
    );
  },

  /** After the DP rule: the one question that moves a keep on. */
  dpAsk(lang: Lang): string {
    return lang === "en"
      ? "Would you like to pay the DP now?"
      : "Mau DP sekarang kak?";
  },

  /**
   * How to buy, or to buy online (2026-10-28): the shop's own ways, and the
   * variant's listing — the platform they named, else every one it has.
   */
  buyOnline(
    links: ShownUnit["links"],
    asked: Platform | null,
    lang: Lang,
  ): string {
    const NAMES: Record<Platform, string> = {
      shopee: "Shopee",
      tokopedia: "Tokopedia",
      instagram: "Instagram",
    };
    const all = (Object.keys(NAMES) as Platform[]).filter((p) => links?.[p]);
    const pick = asked && links?.[asked] ? [asked] : all;
    if (pick.length === 0)
      return lang === "en"
        ? "You can order it straight through this WhatsApp chat 😊"
        : "Bisa order langsung lewat WA ini aja kak 😊";
    const lines = pick.map((p) =>
      pick.length === 1 ? links![p]! : `${NAMES[p]}: ${links![p]!}`,
    );
    const head =
      pick.length === 1
        ? lang === "en"
          ? `Sure 😊 Here's the ${NAMES[pick[0]!]} link:`
          : `Bisa kak 😊 Ini link ${NAMES[pick[0]!]}-nya:`
        : lang === "en"
          ? "Sure 😊 Here are the links:"
          : "Bisa kak 😊 Ini linknya:";
    const tail =
      lang === "en"
        ? "Or order it straight through this chat, or come to the shop 😊"
        : "Bisa juga order lewat WA ini atau datang langsung ke toko ya kak 😊";
    return `${head}\n${lines.join("\n")}\n${tail}`;
  },

  /**
   * Asked about the condition (2026-10-28): everything QC wrote — marks and
   * what is in the box included — and the servicing either way.
   */
  conditionDetail(u: ShownUnit, lang: Lang): string {
    const words = [
      ...(u.condition?.faults ?? []),
      ...(u.condition?.marks ?? []),
    ].map((w) => w.toLowerCase());
    const serviced =
      u.serviced === "never"
        ? lang === "en"
          ? "never serviced"
          : "belum pernah servis"
        : u.serviced === "yes"
          ? lang === "en"
            ? "it has been serviced"
            : "sudah pernah servis"
          : null;
    const all = [...words, ...(serviced ? [serviced] : [])];
    const name = unitLine(u, lang, undefined, { variant: false });
    if (all.length === 0)
      return lang === "en"
        ? `The ${name} 😊 Nothing else was noted at QC.`
        : `${name} kak 😊 Gak ada catatan lain dari QC.`;
    return lang === "en"
      ? `The ${name}: ${all.join(", ")} 😊`
      : `${name}: ${all.join(", ")} kak 😊`;
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
          ? "Want to come and see it? When suits you?"
          : "Mau datang lihat langsung, kapan enaknya kak?";
      default:
        return lang === "en"
          ? "Shall I help you get it sorted?"
          : "Mau aku bantu proses kak?";
    }
  },

  /** Out of stock: offer to tell them when it is in (2026-10-27). */
  offerWatch(lang: Lang): string {
    return lang === "en"
      ? "Shall I let you know when it's in?"
      : "Mau aku kabarin kalau sudah ready kak?";
  },

  watchSaved(lang: Lang): string {
    return lang === "en"
      ? "Will do 😊 I'll message you here once it's in."
      : "Siap kak 😊 Nanti aku kabarin di sini kalau sudah ready.";
  },

  /** They said yes to the reminder: the visit stands. */
  visitKept(when: string, lang: Lang): string {
    return lang === "en"
      ? `Great 😊 See you ${when}.`
      : `Siap kak 😊 Ditunggu ${when} ya 🙏`;
  },

  /** They cannot come: the visit is closed, and another day is asked for. */
  visitCancelled(lang: Lang): string {
    return lang === "en"
      ? "No problem 😊 Would another day suit you better?"
      : "Oke kak, gak apa-apa 😊 Enaknya hari apa kak?";
  },

  visitMoved(when: string, lang: Lang): string {
    return lang === "en"
      ? `Done 😊 Moved to ${when}. See you then.`
      : `Siap kak 😊 Jadwalnya aku pindah ke ${when} ya, ditunggu 🙏`;
  },

  /** Out of stock, said plainly, with no question after it. */
  outOfStock(lang: Lang): string {
    return lang === "en"
      ? "Sorry, that one's not in stock right now 🙏"
      : "Yah, yang itu lagi kosong kak 🙏";
  },

  noStock(lang: Lang): string {
    return lang === "en"
      ? "Sorry, that one's not in stock right now 🙏 Want me to find something similar?"
      : "Yah, yang itu lagi kosong kak 🙏 Mau aku cariin yang mirip?";
  },

  /**
   * Out of stock, and what is closest that is not (owner, 2026-10-27: "if
   * the stock is 0, the system should upsell / cross sell items"). Only what
   * the lookup returned, like every line here — one first, one more at most.
   */
  alternatives(units: readonly ShownUnit[], lang: Lang): string {
    const [first, second] = units;
    const v = { variant: variantsMatter([first ?? null, second ?? null]) };
    if (!first) return reply.outOfStock(lang);
    return lang === "en"
      ? `That one's not in stock right now 🙏 The closest we have is the ${unitLine(first, lang, undefined, v)}.` +
          (second ? `\nOr the ${unitLine(second, lang, undefined, v)}.` : "")
      : `Yang itu lagi kosong kak 🙏 Yang paling mirip ada ${unitLine(first, lang, undefined, v)}.` +
          (second ? `\nAtau ${unitLine(second, lang, undefined, v)}.` : "");
  },

  /** One option above the main pick — offered, never pushed. */
  stepUp(u: ShownUnit, lang: Lang): string {
    return lang === "en"
      ? `If you'd like a bit more room, there's also the ${unitLine(u, lang)} 😊`
      : `Kalau mau lebih lega, ada juga ${unitLine(u, lang)} 😊`;
  },

  /** A fitting accessory on the shelf, mentioned once. */
  accessory(a: ShownAccessory, lang: Lang): string {
    const what = `${a.model}${a.price ? ` ${shortPrice(a.price)}` : ""}`;
    return lang === "en"
      ? `We also have a ${what} if you need one.`
      : `Kalau perlu, ada ${what} juga kak.`;
  },

  whichUnit(lang: Lang): string {
    return lang === "en"
      ? "Which one do you mean? Just send the model, like Air M2 😊"
      : "Yang mana kak? Sebutin aja tipenya, misal Air M2 😊";
  },

  price(u: ShownUnit, lang: Lang): string {
    return lang === "en"
      ? `That's the ${unitLine(u, lang, undefined, { facts: true })} 😊`
      : `Yang ini ${unitLine(u, lang, undefined, { facts: true })} kak 😊`;
  },

  photos(u: ShownUnit | null, lang: Lang): string {
    const what = u ? unitLine(u, lang, undefined, { facts: true }) : null;
    return lang === "en"
      ? `Here are the photos${what ? `, ${what}` : ""} 😊`
      : `Ini fotonya kak${what ? `, ${what}` : ""} 😊`;
  },

  noPhotos(lang: Lang): string {
    return lang === "en"
      ? "No photos of that one yet 🙏 I'll take some and send them."
      : "Fotonya belum ada kak, aku fotoin dulu ya 🙏";
  },

  askForVisit(
    missing: { name: boolean; when: boolean; unit: boolean },
    lang: Lang,
  ): string {
    const need: string[] = [];
    if (lang === "en") {
      if (missing.unit) need.push("which one you'd like to see");
      if (missing.name) need.push("your name");
      if (missing.when) need.push("the day and time (we're open 10.00–20.00)");
      return `Sure, come and see it 😊 Just send ${need.join(", ")}.`;
    }
    if (missing.unit) need.push("unit yang mau dilihat");
    if (missing.name) need.push("atas nama siapa");
    if (missing.when)
      need.push("mau datang hari apa jam berapa (buka 10.00–20.00)");
    return `Boleh banget kak 😊 Kabarin ${need.join(", ")} ya.`;
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
        `Let me confirm 😊\n${see}${date} at ${time}, under ${p.custName}.\n` +
        "Is that right? Reply yes and I'll book it."
      );
    return (
      `Aku konfirmasi ya kak 😊\n${see}${date} jam ${time} WIB, atas nama ${p.custName}.\n` +
      `Sudah betul? Balas "iya" nanti langsung aku catat.`
    );
  },

  /**
   * A reservation REQUEST filed (2026-10-27): noted, and a person confirms —
   * never "booked", never "held".
   */
  requestNoted(
    r: {
      readonly units: readonly ShownUnit[];
      readonly when: string;
      readonly custName: string;
    },
    lang: Lang,
  ): string {
    const units = r.units.map((u, i) =>
      unitLine(u, lang, r.units.length > 1 ? i + 1 : undefined),
    );
    const [date, time] = r.when.split(" ");
    const what = units.length ? `${units.join("\n")}\n` : "";
    if (lang === "en")
      return (
        `Noted 😊\n${what}${date} at ${time}, under ${r.custName}.\n` +
        "Our team will confirm it shortly 🙏"
      );
    return (
      `Siap kak, aku catat ya 😊\n${what}${date} jam ${time} WIB, atas nama ${r.custName}.\n` +
      "Nanti tim kami konfirmasi ya 🙏"
    );
  },

  /** A request is already waiting on the team: nothing to confirm by chat. */
  requestPending(lang: Lang): string {
    return lang === "en"
      ? "It's noted 😊 Our team will confirm it shortly 🙏"
      : "Sudah aku catat ya kak 😊 Tinggal tunggu konfirmasi dari tim kami 🙏";
  },

  /** What a keep still needs before it can be filed. */
  askForKeep(
    missing: { unit: boolean; name: boolean; when: boolean },
    lang: Lang,
  ): string {
    const need: string[] = [];
    if (lang === "en") {
      if (missing.unit) need.push("which unit");
      if (missing.name) need.push("your name");
      if (missing.when) need.push("when you'll come or pay");
      return `Sure 😊 Just send ${need.join(", ")}.`;
    }
    if (missing.unit) need.push("unit yang mana");
    if (missing.name) need.push("atas nama siapa");
    if (missing.when) need.push("mau datang / transfer hari apa jam berapa");
    return `Bisa kak 😊 Kabarin ${need.join(", ")} ya.`;
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
      ? `Booked 😊 Your code is ${b.code}${b.when ? `, ${b.when}` : ""}. See you at the shop.`
      : `Sip, sudah aku catat ya kak 😊 Kode booking ${b.code}${b.when ? `, ${b.when} WIB` : ""}. ` +
          "Sampai ketemu di toko 🙏";
  },

  bookingFailed(lang: Lang): string {
    return lang === "en"
      ? "Sorry, the booking didn't go through 🙏 Let me check it."
      : "Maaf kak, bookingnya belum masuk 🙏 Aku cek dulu ya.";
  },

  declined(lang: Lang): string {
    return lang === "en"
      ? "No problem 😊 Let me know if you'd like to see another."
      : "Oke kak, gak apa-apa 😊 Kalau mau lihat yang lain, kabarin aja ya.";
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
   * colleague (2026-10-27): say once what is still being checked, then carry
   * on. Said only when the bot's previous reply did not already promise it.
   */
  stillWaiting(topics: readonly string[], lang: Lang): string {
    const what = [
      ...new Set(topics.map((t) => WAITING_ON[t] ?? WAITING_ON["other"]!)),
    ]
      .map((w) => w[lang])
      .join(lang === "en" ? " and " : " sama ");
    return lang === "en"
      ? `Still checking ${what} — I'll get back to you here 🙏`
      : `Soal ${what} masih aku cekin ya kak, nanti aku kabari di sini 🙏`;
  },

  /**
   * Another question for a colleague while one is already waiting and the
   * customer has been told so: a short line, not the same promise again.
   */
  passedOnToo(lang: Lang): string {
    return lang === "en"
      ? "Noted, I'll check that one too 🙏"
      : "Siap kak, yang ini sekalian aku tanyain ya 🙏";
  },

  offerVisit(lang: Lang): string {
    return lang === "en"
      ? "If you'd like to see it in person, send your name and a time and I'll book it 😊"
      : "Kalau mau lihat langsung di toko, kabarin aja nama sama jam datangnya ya kak, nanti aku bookingin 😊";
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
      "Rencananya buat apa kak? 😊",
      "Biar aku pilihin yang pas, lebih sering dipakai buat apa kak? Kuliah, kerja, desain, coding, atau edit video?",
    ],
    en: [
      "What will you mainly use it for?",
      "So I can pick the right one — is it for study, office work, design, coding or video editing?",
    ],
  },
  preferences: {
    id: [
      "Ada maunya yang baru atau second kak, atau ukuran layar tertentu?",
      "Lebih suka layar 13 atau yang lebih besar kak?",
    ],
    en: [
      "Any preferences? For example new or second-hand, screen size, colour, or RAM/storage?",
      "Would you prefer new or second-hand, and which screen size?",
    ],
  },
  budget: {
    id: [
      "Budgetnya kira-kira berapa kak?",
      "Kalau budget maksimalnya kira-kira berapa kak?",
    ],
    en: [
      "Roughly what budget do you have in mind?",
      "What's the most you'd like to spend?",
    ],
  },
  apps: {
    id: [
      "Aplikasinya yang sering dipakai apa aja kak?",
      "Biasanya buka aplikasi apa aja kak?",
    ],
    en: [
      "Any specific apps you'll run on it?",
      "Which apps will you use most?",
    ],
  },
};

/**
 * Did this reply ask about the customer's needs? Then their next "ok" or
 * "hmm" is part of that conversation, and the next question may follow it.
 */
export function askedAboutNeeds(text: string | null | undefined): boolean {
  if (!text) return false;
  return Object.values(QUESTIONS).some((byLang) =>
    Object.values(byLang).some((ways) => ways.some((q) => text.includes(q))),
  );
}
