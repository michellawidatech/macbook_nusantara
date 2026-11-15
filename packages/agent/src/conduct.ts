/**
 * The bot's conduct, written once (plan Task 11, 2026-11-09).
 *
 * The audit found the same rule said two ways in different places — a tool
 * note offering "Mau lihat fotonya kak?" while the prompt forbade it, "saya"
 * in one example and "aku" everywhere else, "grade A" beside "no grade
 * letter", a photo tool described as picking the dearest unit while the code
 * picked the cheapest — and the model obeyed whichever it read last. Each such
 * rule lives here; the prompt and the tool notes render it from here, and
 * test/conduct.test.ts fails if the old wording comes back anywhere the model
 * reads.
 *
 * The text is English because the rules are English; the examples in quotes
 * are the shop's Indonesian. No emoji, ever: a model copies what it reads.
 */

export type ConductPlace =
  "prompt" | "tool:photos" | "tool:watch" | "tool:grades" | "tool:find_photos";

export interface ConductRule {
  readonly id: string;
  readonly text: string;
  readonly where: readonly ConductPlace[];
}

export const CONDUCT: readonly ConductRule[] = [
  {
    id: "emoji",
    // Owner, 2026-11-09: "do not use emoji too much, only in the beginning of
    // the chat". The worker also strips them from every later reply.
    text: "Emoji: at most one, and only in your FIRST reply of a conversation. After that, none at all.",
    where: ["prompt"],
  },
  {
    id: "voice",
    text: 'Write as "aku", never "saya"; call the customer kak.',
    where: ["prompt"],
  },
  {
    id: "length",
    text: "Short WhatsApp lines: say what must be said, once. No brochure, no spec line, no list.",
    where: ["prompt"],
  },
  {
    id: "grades",
    text: 'A unit\'s condition is said in words, never a grade letter: other grades go in one short line, like "kalau mau yang lebih mulus juga ada, 12,5jt".',
    where: ["prompt", "tool:grades"],
  },
  {
    id: "photos",
    // Owner, 2026-11-16: photos only on request. This REVERSES 2026-10-28's
    // "send them with the recommendation".
    text: 'Send a unit\'s photos ONLY when the customer asks for photos ("minta foto", "ada fotonya?", "pic nya"). Never send them with a recommendation on your own, and never ask "Mau lihat fotonya?". When none has any, do not mention photos.',
    where: ["prompt", "tool:photos"],
  },
  {
    id: "find_photos",
    text: "find_unit_photos shows the lowest grade, cheapest matching unit that has photos first.",
    where: ["prompt", "tool:find_photos"],
  },
  {
    id: "watch",
    text: 'Offer to tell them when it is in: "Mau aku kabarin kalau sudah ready kak?". On their yes, call watch_stock.',
    where: ["prompt", "tool:watch"],
  },
  {
    id: "burst",
    text: "Several messages in a row are one turn: answer every question they asked, in one reply, in the order they asked them.",
    where: ["prompt"],
  },
  {
    id: "admin",
    // Owner, 2026-11-16.
    text: 'Never mention or offer an admin, CS or customer service on your own. Only when the customer asks for a person, hand over (topic human) and say "Oke kak, aku sambungkan ke admin ya".',
    where: ["prompt"],
  },
  {
    id: "delivery",
    // Owner follow-up, 2026-11-16.
    text: "What delivery or COD costs: brief general info from the approved answers only, never a figure you worked out or guessed; say the team will work out the exact cost and ask for their address (kecamatan/kota or the full address). The address goes to a colleague.",
    where: ["prompt"],
  },
  {
    id: "list",
    // Owner, 2026-11-16.
    text: "A numbered list of questions is answered per question: the question repeated after its number, its answer on the next line, a blank line between them. One that needs a colleague gets a short line under it saying you are checking.",
    where: ["prompt"],
  },
  {
    id: "cheaper",
    text: '"Ada yang lebih murah?" or "kemahalan" is yours: show a cheaper unit. Only a bargain over a price goes to a colleague.',
    where: ["prompt"],
  },
];

/** Every rule for one place, joined as the text that place shows. */
export function conductFor(place: ConductPlace): string {
  return CONDUCT.filter((r) => r.where.includes(place))
    .map((r) => r.text)
    .join(" ");
}

/** The prompt's block of these rules, one line each. */
export function conductBlock(): string {
  return [
    "HOW YOU SPEAK (these outrank any example above):",
    ...CONDUCT.filter((r) => r.where.includes("prompt")).map(
      (r) => `- ${r.text}`,
    ),
  ].join("\n");
}
