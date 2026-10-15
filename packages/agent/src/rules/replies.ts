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
}

const GRADE: Record<string, { id: string; en: string }> = {
  NEW: { id: "baru (segel)", en: "new (sealed)" },
  A: { id: "grade A", en: "grade A" },
  B: { id: "grade B", en: "grade B" },
  C: { id: "grade C", en: "grade C" },
};

export function unitLine(u: ShownUnit, lang: Lang, n?: number): string {
  const name = [u.model, u.variant].filter(Boolean).join(" ");
  const grade = u.grade ? (GRADE[u.grade]?.[lang] ?? `grade ${u.grade}`) : null;
  const price = u.price ? u.price : null;
  return `${n !== undefined ? `${n}. ` : ""}${name}${grade ? `, ${grade}` : ""}${price ? ` — ${price}` : ""}`;
}

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

  noStock(lang: Lang): string {
    return lang === "en"
      ? "Sorry, we don't have that one right now 🙏 Would you like a similar unit instead?"
      : "Mohon maaf kak, untuk unit itu sedang kosong 🙏 Mau saya carikan alternatif yang mirip?";
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
      return `Sure, we can hold it for your visit 😊 Please tell me ${need.join(", ")}.`;
    }
    if (missing.unit) need.push("unit yang mau dilihat");
    if (missing.name) need.push("nama untuk bookingnya");
    if (missing.when)
      need.push("hari dan jam datangnya (toko buka 10.00–20.00 WIB)");
    return `Bisa kak, kami tahankan unitnya untuk kakak lihat langsung 😊 Boleh info ${need.join(", ")}?`;
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
    if (lang === "en")
      return (
        `Let me confirm 😊\n${units.join("\n")}\nVisit: ${date} at ${time}\nName: ${p.custName}\n` +
        "Is that right? Reply yes and I'll book it."
      );
    return (
      `Saya konfirmasi dulu ya kak 😊\n${units.join("\n")}\nJadwal datang: ${date} jam ${time} WIB\n` +
      `Atas nama: ${p.custName}\nSudah betul kak? Balas "iya" nanti langsung saya bookingkan.`
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
      ? `Booked 😊 Your booking code is ${b.code}${b.when ? ` for ${b.when}` : ""}. ` +
          `See you at the shop!`
      : `Sudah kami bookingkan ya kak 😊 Kode booking: ${b.code}${b.when ? `, jadwal ${b.when} WIB` : ""}. ` +
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

  /** One curious question, chosen by what the profile still lacks. */
  nextQuestion(
    lacks: { usage: boolean; budget: boolean; apps: boolean },
    lang: Lang,
  ): string | null {
    if (lacks.usage)
      return lang === "en"
        ? "What will you mainly use it for?"
        : "Kalau boleh tahu, rencananya dipakai untuk apa kak?";
    if (lacks.budget)
      return lang === "en"
        ? "Roughly what budget do you have in mind?"
        : "Budgetnya kira-kira di kisaran berapa kak?";
    if (lacks.apps)
      return lang === "en"
        ? "Any specific apps you'll run on it?"
        : "Ada aplikasi khusus yang bakal sering dipakai kak?";
    return null;
  },

  offerVisit(lang: Lang): string {
    return lang === "en"
      ? "If you'd like to see it in person, I can book a visit — just send your name and a time 😊"
      : "Kalau mau lihat langsung unitnya di toko, bisa saya bookingkan kak — cukup kabari nama dan jam datangnya ya 😊";
  },
};
