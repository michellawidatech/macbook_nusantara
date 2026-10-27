/**
 * What the bot may answer, and what it must hand to a person — written as
 * code, not left to the prompt (owner ask 2026-09-18).
 *
 * The shop runs this app IN PARALLEL with B2Soft for now. Production holds
 * only the master data — the catalogue, the store, the warehouses, the staff —
 * so its stock and prices are not the shop's real stock and prices. The owner's
 * rule follows from that: "for stock, price, negotiation, and other questions
 * that are not in the documents, we should escalate it to human".
 *
 * A prompt can say that, and does (prompt.ts). This file makes the parts that
 * cost money not depend on the model obeying it:
 *
 *  - `routeMessage` reads the customer's message before the model does and
 *    names a hand-over the model cannot talk its way out of: a question about
 *    the stock, price or condition of a NAMED machine, a battery-health or
 *    cycle-count question (the owner answers those with a photo), a booking, a
 *    payment already made, a photo. The GENERIC versions — "apakah unitnya
 *    ready?", "ada price list?", "bisa nego?" — are left alone, because the
 *    owner wrote answers for exactly those and every one of them asks which
 *    machine; the next message, naming it, is the one handed over.
 *  - `checkReply` reads what the model wants to send and refuses a rupiah
 *    figure or an availability claim that none of the answers it cited
 *    contains. "Rp180.000" is fine in the COD answer because the owner wrote
 *    it there; "Rp7.500.000" for an Air M1 is refused because nobody did.
 *
 * Pure. Regular expressions over lower-cased text, tested line by line in
 * test/policy.test.ts with the kind of message customers actually send.
 */

/**
 * What the bot is allowed to do for itself — the switch between the 2026-09-18
 * design and the 2026-09-21 one.
 *
 * ## Why this is a switch and not an edit
 *
 * The 2026-09-18 rules exist for a reason that is still true on the day they
 * are relaxed: *while the shop runs this app in parallel with B2Soft*,
 * production holds the master data and not the real stock, so a bot answering
 * "ready kak" is reading a shelf nobody stocked. Everything that followed —
 * `routeMessage`, `CUSTOMER_TOOLS`, `PARALLEL_RULES` — follows from that one
 * fact and from nothing else.
 *
 * The owner's 2026-09-21 ask is the other side of it: *"make sure like the
 * chatbot can send pictures per unit and get detail about a unit, and the only
 * write operation is to make a reservation"*. That is a bot reading the shelf.
 * Both are right, at different moments — which is what makes it a capability
 * and not a rewrite. The day the data is the shop's data, the switch flips;
 * the day a migration is half-finished, it flips back, and nothing else in the
 * package has to move.
 *
 * Read from configuration (`apps/worker/src/config.ts`), so it is one
 * environment variable on the Mac mini rather than a deploy.
 */
export interface AgentCapabilities {
  /**
   * May the bot read the shelf — which units are in stock, their grade?
   *
   * With this off, every question about a particular unit goes to a person
   * before the model sees it, which is the whole of the 2026-09-18 design.
   * The other three switches each need this one: a price, a booking or a
   * photo is always of a unit on the shelf, and answering any of them says
   * the unit is there.
   */
  readonly stock: boolean;
  /**
   * May it quote what a unit costs? Off, the stock tools return no figure and
   * a price question goes to a person (owner ask 2026-09-29). A unit with no
   * price in the POS goes to a person even when this is on.
   */
  readonly price: boolean;
  /**
   * May it make, check, move and cancel the customer's own booking? Since
   * 2026-09-29 this is the whole booking lifecycle, not only making one.
   */
  readonly reserve: boolean;
  /** May it send the shop's own photos of a unit? */
  readonly photos: boolean;
}

/** The 2026-09-18 design: answers from the owner's sheet, hands over the rest. */
export const PARALLEL_CAPABILITIES: AgentCapabilities = {
  stock: false,
  price: false,
  reserve: false,
  photos: false,
};

/** Every switch on: the bot reads the shelf, quotes, books and sends photos. */
export const LIVE_CAPABILITIES: AgentCapabilities = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
};

/**
 * What an unpressed switch means since 2026-10-27 (owner: *"the stocks,
 * prices, conditions are already synced with the POS so it should be fine for
 * the chatbot to make the POS data as a source of truth"*). The parallel
 * operation with B2Soft that made the cautious reading the right default is
 * over: the shelf in this database is the shop's shelf. So the bot reads
 * stock, quotes prices and sends the shop's photos unless the owner switched
 * one off on /chat. Bookings stay off until somebody switches them on — a
 * booking is a WRITE, and holding a unit for a stranger is the owner's call.
 */
export const SHOP_CAPABILITIES: AgentCapabilities = {
  stock: true,
  price: true,
  reserve: false,
  photos: true,
};

/**
 * What the switches actually allow once their dependency is applied: price,
 * bookings and photos are all about a unit on the shelf, so with Stock off
 * they are off whatever they say. Stored as set, read through this — so
 * turning Stock back on restores what somebody chose for the other three.
 */
export function effectiveCapabilities(c: AgentCapabilities): AgentCapabilities {
  return {
    stock: c.stock,
    price: c.stock && c.price,
    reserve: c.stock && c.reserve,
    photos: c.stock && c.photos,
  };
}

/**
 * Read the capability out of an environment.
 *
 * Since 2026-09-29 this is the FALLBACK: the four switches on /chat are
 * `AppSetting` rows (`CAPABILITY_SETTING_KEYS`), and a switch nobody has ever
 * pressed falls back to this.
 *
 * Since 2026-10-27 the POS is the bot's source of truth, so an unset (or
 * unrecognised) variable reads as `SHOP_CAPABILITIES` — stock, price and
 * photos on, bookings off. `live` still turns bookings on as well, and
 * `parallel` is the way back to the 2026-09-18 design should the shelf in
 * this database ever stop being the shop's real one (a half-finished
 * migration, a restore). Either way a switch the owner pressed wins.
 */
export function agentCapabilities(
  env: Record<string, string | undefined>,
): AgentCapabilities {
  const v = env["AGENT_CAPABILITIES"]?.trim().toLowerCase();
  if (v === "live") return LIVE_CAPABILITIES;
  if (v === "parallel") return PARALLEL_CAPABILITIES;
  return SHOP_CAPABILITIES;
}

/** The `AppSetting` key behind each switch on /chat. */
export const CAPABILITY_SETTING_KEYS: Readonly<
  Record<keyof AgentCapabilities, string>
> = {
  stock: "chatbot.stock",
  price: "chatbot.price",
  reserve: "chatbot.reservation",
  photos: "chatbot.photos",
};

/**
 * The switches as stored, over the environment's fallback.
 *
 * A row reads `"true"` or `"false"`; anything else — and a key with no row —
 * falls back to `fallback`, so a shop that has never opened the switches
 * keeps behaving exactly as its environment file says.
 */
export function capabilitiesFromSettings(
  rows: ReadonlyArray<{ readonly key: string; readonly value: string }>,
  fallback: AgentCapabilities,
): AgentCapabilities {
  const byKey = new Map(rows.map((r) => [r.key, r.value.trim().toLowerCase()]));
  const read = (k: keyof AgentCapabilities): boolean => {
    const v = byKey.get(CAPABILITY_SETTING_KEYS[k]);
    return v === "true" ? true : v === "false" ? false : fallback[k];
  };
  return {
    stock: read("stock"),
    price: read("price"),
    reserve: read("reserve"),
    photos: read("photos"),
  };
}

/** Why a conversation went to a person. Stored on the message for the inbox. */
export const HANDOFF_TOPICS = [
  "stock",
  "price",
  "negotiation",
  "unit_details",
  "recommendation",
  "reservation",
  "order_payment",
  "trade_in",
  "sell_to_shop",
  "shipping_quote",
  "warranty_claim",
  "complaint",
  "media",
  "photos",
  "human",
  "other",
] as const;
export type HandoffTopic = (typeof HANDOFF_TOPICS)[number];

export function isHandoffTopic(v: unknown): v is HandoffTopic {
  return (
    typeof v === "string" && (HANDOFF_TOPICS as readonly string[]).includes(v)
  );
}

// --- what a message is about -----------------------------------------------

/**
 * A specific machine. Deliberately NOT the bare word "macbook": "apakah
 * macbook-nya ready?" is the generic question the owner answered, while "air
 * m1 ready?" names a machine somebody has to go and look at.
 */
const PRODUCT = new RegExp(
  [
    String.raw`\bm[1-5](\s*(pro|max|ultra))?\b`, // Apple silicon
    String.raw`\bi[3579]\b`, // Intel Core
    String.raw`\bintel\b`,
    String.raw`\b(macbook\s*)?air\b`,
    String.raw`\bmacbook\s*pro\b`,
    String.raw`\bmb[ap]\b`, // MBA / MBP
    String.raw`\bimac\b`,
    String.raw`\bmac\s*(mini|studio|pro)\b`,
    String.raw`\b(ipad|iphone|airpods|apple\s*watch)\b`,
    String.raw`\b20(1[0-9]|2[0-9])\b`, // a model year
    String.raw`\b(13|14|15|16)\s*(inch|inchi|in|")`,
    String.raw`\b\d{1,2}\s*/\s*(128|256|512|1|2|4|8)\s*(gb|tb)?\b`, // 8/256
    String.raw`\b(128|256|512)\s*gb\b`,
    String.raw`\b(8|16|18|24|32|36|48|64|96)\s*gb\b`,
    String.raw`\b[1248]\s*tb\b`,
    String.raw`\btouch\s*bar\b`,
    String.raw`\bretina\b`,
  ].join("|"),
  "i",
);

const STOCK =
  /\b(ready|redi|stok|stock|tersedia|available|kosong|habis|sisa|inden)\b|\bmasih\s*ada\b|\bada\s*(ga|gak|nggak|ngga|tidak|kah)\b|\badakah\b/i;

const MONEY =
  /\brp\.?\s*\d|\b\d+([.,]\d{3})+\b|\b\d+(\s*|-)(jt|juta|jtan|rb|ribu|k)\b|\bjutaan\b/i;

const PRICE_WORD = /\b(harga(nya)?|hrg|price|budget|bajet|dana(nya)?)\b/i;
/**
 * "Berapa" asks for a price only when nothing else is being counted: "air m1
 * berapa?" is a price, "air m1 ram-nya berapa?" is a specification the
 * catalogue answers.
 */
const HOW_MUCH = /\b(berapa(an)?|brp)\b/i;
const COUNTED =
  /\b(ram|ssd|storage|memori|memory|penyimpanan|chip|prosesor|processor|layar|tahun|inch|inci|gb|tb|core|gpu|cpu|lama|hari|jam|persen)\b/i;
const asksPrice = (t: string) =>
  PRICE_WORD.test(t) || (HOW_MUCH.test(t) && !COUNTED.test(t));

const NEGOTIATION =
  /\b(nego|negosiasi|kurang(in|i)?|diskon|potongan|potong|korting|murah(in|an)?|turun(in)?|best\s*price|harga\s*pas|net\s*berapa)\b/i;

/**
 * A battery's HEALTH, which the owner answers with a photo of that machine
 * (docs/chatbot/knowledge-2026-09-18.md). Not the word "baterai" on its own:
 * "bisa ganti baterai?" is the service question the owner already answered.
 */
const BATTERY =
  /\b(bh|battery\s*health|health(nya)?|siklus(nya)?|cycle(\s*count)?)\b|\b(baterai|batre|battery)(nya)?\s*(berapa|brp|masih|sehat|bagus|normal|aman|persen)/i;

const UNIT_DETAILS =
  /\b(foto(nya)?|video(nya)?|real\s*pic(t)?|gambar(nya)?|kondisi(nya)?|minus(nya)?|mulus|lecet|serial(nya)?|garansi\s*(resmi|apple|ibox)|ibox)\b/i;

const RESERVATION =
  /\b(booking|book|keep|tahan|hold|reserve|reservasi|simpan(in|kan)?|titip|dp)\b/i;

/** Letting a booking go, or moving it — both are the booking switch's. */
const CANCEL_BOOKING =
  /\b(batal(in|kan)?|cancel|gak\s*jadi|ga\s*jadi|nggak\s*jadi|ngga\s*jadi|reschedule|ganti\s*(jadwal|jam|hari)|undur|majuin|mundurin)\b/i;

/** A request to SEE a unit — the photo switch's. */
const PHOTO_REQUEST =
  /\b(foto(nya)?|photo|pic(t)?|picture|gambar(nya)?|video(nya)?|real\s*pic(t)?|liat|lihat)\b/i;

/**
 * A figure put forward as what the customer wants to pay: "kalau 7jt boleh?",
 * "7,5 aja ya", "bisa 7.200.000?". Only counted as negotiation with a money
 * figure beside it (routeMessage).
 */
const OFFER =
  /\b(kalau|kalo|klo)\b[^?]*\d|\d[\d.,]*\s*(jt|juta|rb|ribu|k)?\s*(aja|saja|boleh|bisa|deal)\b|\bbisa\s*(di\s*)?\d|\b(tawar|nawar)\b/i;

/** A budget is a request to pick something, not an offer on a unit. */
const BUDGET = /\b(budget|bajet|dana(nya)?)\b|\bdapa?t\s+apa\b/i;

const ORDER_PAYMENT =
  /\b(sudah|udah|udh|sdh)\s*(transfer|tf|bayar|kirim\s*bukti)|\bbukti\s*(transfer|tf|bayar|pembayaran)\b|\b(no\.?\s*)?resi\b|\btracking\b|\blacak\b|\bpesanan\s*(saya|aku|sy)\b|\binvoice\b/i;

/**
 * A question about what a model IS — its chip, memory, storage, screen, year,
 * or how two compare — which the catalogue can answer without a shelf.
 */
const SPEC =
  /\b(ram|ssd|storage|memori|memory|penyimpanan|chip|prosesor|processor|layar|tahun|inch|inci|core|gpu|cpu|spek|spesifikasi|spec|specs|varian|konfigurasi|bedanya|beda|perbedaan|vs|versus)\b/i;

export interface Route {
  readonly topic: HandoffTopic;
  /** For the log and the staff summary: which rule fired. */
  readonly rule: string;
}

/**
 * The hand-over the message itself demands, or null when the model may try.
 *
 * `hasMedia`: the batch carried a photo, video, voice note or document.
 * Somebody sent the shop a picture of a machine, a transfer slip or a
 * damaged screen, and every one of those needs eyes.
 */
export function routeMessage(
  text: string,
  opts: {
    hasMedia?: boolean;
    /** What the bot may do for itself. Defaults to the 2026-09-18 design. */
    capabilities?: AgentCapabilities;
  } = {},
): Route | null {
  const can = opts.capabilities ?? PARALLEL_CAPABILITIES;
  /*
   * A photo, a video, a voice note or a document still goes to a person, with
   * `photos` on or off. The capability is about the shop SENDING its own
   * pictures of a unit; a picture the CUSTOMER sent is a transfer slip, a
   * cracked screen or a machine they want valued, and every one of those needs
   * eyes.
   */
  if (opts.hasMedia) return { topic: "media", rule: "media" };

  const t = text.toLowerCase();
  const product = PRODUCT.test(t);
  const money = MONEY.test(t);

  if (ORDER_PAYMENT.test(t))
    return { topic: "order_payment", rule: "order_payment" };
  /*
   * Negotiation goes to a person whatever the bot can read, and that is a
   * decision rather than an oversight: a discount is the owner's to give, and
   * a bot that has the price in front of it is a bot one message away from
   * discounting it. An OFFER counts as negotiating even without the word
   * "nego": "kalau 7jt boleh?" names a figure the customer wants to pay.
   */
  if (NEGOTIATION.test(t) && (product || money))
    return { topic: "negotiation", rule: "negotiation+product" };
  if (OFFER.test(t) && money && !BUDGET.test(t))
    return { topic: "negotiation", rule: "offer" };
  if (can.stock) {
    // The shelf is readable; each of the other switches still decides its
    // own kind of question (owner ask 2026-09-29).
    if (!can.price && (asksPrice(t) || money))
      return { topic: "price", rule: "price_off" };
    if (!can.photos && PHOTO_REQUEST.test(t))
      return { topic: "photos", rule: "photos_off" };
    if (!can.reserve && (RESERVATION.test(t) || CANCEL_BOOKING.test(t)))
      return { topic: "reservation", rule: "reservation_off" };
    return null;
  }
  if (!can.stock) {
    if (BATTERY.test(t)) return { topic: "unit_details", rule: "battery" };
    if (product) {
      if (asksPrice(t)) return { topic: "price", rule: "price+product" };
      if (UNIT_DETAILS.test(t))
        return { topic: "unit_details", rule: "details+product" };
      if (STOCK.test(t)) return { topic: "stock", rule: "stock+product" };
      // "air m2 ram-nya berapa?" is about the model, and the catalogue answers
      // it. Anything else about a named machine — "ada m2?", "yang i5 aja",
      // "air m1 8/256" in answer to "tipe apa, kak?" — is a question about the
      // shelf.
      if (!SPEC.test(t)) return { topic: "stock", rule: "product" };
    }
  }
  if (!can.reserve && RESERVATION.test(t))
    return { topic: "reservation", rule: "reservation" };
  // A budget with no machine named is a request to pick one out of today's
  // shelf. With `stock` the bot can do exactly that, and it is the most
  // useful thing it does.
  if (!can.stock && money) return { topic: "recommendation", rule: "budget" };
  return null;
}

/** Whether a message names a specific machine. Exported for the prompt hint. */
export function mentionsProduct(text: string): boolean {
  return PRODUCT.test(text.toLowerCase());
}

// --- what the bot may send ---------------------------------------------------

/**
 * Every rupiah figure in a text, as whole rupiah in digits, with where it sits.
 *
 * "Rp180.000", "180.000", "180rb", "7,5jt", "7.5 juta" and a bare "7500000"
 * all count. The bare run of digits is new (2026-09-29): before it, a reply
 * writing a price without separators was never checked at all.
 */
function amountSpans(
  text: string,
): Array<{ value: string; start: number; end: number }> {
  const out: Array<{ value: string; start: number; end: number }> = [];
  const pattern =
    /(?:rp\.?\s*)?(\d+(?:[.,]\d{1,2})?)\s*(jt|juta|jtan|rb|ribu|k)\b|rp\.?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)|(\d{1,3}(?:[.,]\d{3})+)|\b(\d{6,})\b/gi;
  for (const m of text.matchAll(pattern)) {
    let value: number;
    if (m[1] !== undefined) {
      const unit = (m[2] ?? "").toLowerCase();
      const scale = unit.startsWith("j") ? 1_000_000 : 1_000;
      value = Math.round(Number(m[1].replace(",", ".")) * scale);
    } else {
      value = Number((m[3] ?? m[4] ?? m[5] ?? "").replace(/[.,]/g, ""));
    }
    if (!Number.isFinite(value) || value <= 0) continue;
    const start = m.index ?? 0;
    out.push({ value: String(value), start, end: start + m[0].length });
  }
  return out;
}

const amounts = (text: string): string[] =>
  amountSpans(text).map((a) => a.value);

/**
 * Every rupiah figure in a text, in order, as whole rupiah — the same reading
 * `checkReply` and `parseAskPrice` use, for the rule-based reader (rules/).
 */
export function moneyAmounts(text: string): number[] {
  return amountSpans(text.toLowerCase()).map((a) => Number(a.value));
}

/**
 * The figure a customer is offering, in whole rupiah, or null.
 *
 * The largest figure a person would plausibly pay for a unit — at least
 * Rp100.000 — because "7,5jt aja, kirim 2 hari ya" names one price and one
 * number that is not money. Read by code, never by the model: the offer on a
 * negotiation is what a staff member acts on, and a model asked to extract it
 * will sometimes round it (owner ask 2026-09-29).
 */
export function parseAskPrice(text: string): bigint | null {
  const values = amountSpans(text.toLowerCase())
    .map((a) => Number(a.value))
    .filter((v) => v >= 100_000 && v < 1_000_000_000);
  if (values.length === 0) return null;
  return BigInt(Math.max(...values));
}

/**
 * The words that name WHICH unit: a chip, a family, a year. Two sentences
 * that name different ones are about different units — which is what the
 * price and availability checks below compare.
 */
const MODEL_TOKEN =
  /\b(m[1-5]|i[3579]|20[0-3]\d|air|pro|max|mini|imac|ipad|iphone|watch|airpods|studio|ultra)\b/gi;

export function modelTokens(text: string): string[] {
  return [
    ...new Set([...text.toLowerCase().matchAll(MODEL_TOKEN)].map((m) => m[1]!)),
  ];
}

/** Words that tell a customer a unit is there to be bought. */
const AVAILABILITY =
  /\b(ready|redi|tersedia|masih\s*ada|stok(nya)?\s*(ada|masih)|ada\s*stok|in\s*stock|available)\b|\b(unit|stok)(nya)?\s+(masih\s+)?ada\b|\bbisa\s+(langsung\s+)?(diambil|dikirim|dibeli)\b/i;

/**
 * "Ada", except where it introduces what a MODEL comes in — "ada varian
 * 8/256", "ada pilihan warna" — which is the catalogue talking, not the shelf.
 */
const ADA_ON_SHELF =
  /\bada\b(?!\s+(varian|pilihan|konfigurasi|versi|warna|ukuran|yang|model|tipe|beberapa|juga\s+varian))/i;

/**
 * Does this sentence tell somebody a unit is there? "Ada" alone is how an
 * Indonesian says yes to anything ("bisa COD?" — "ada kak"), so it only
 * counts when the sentence names a unit: "Ada kak Air M3 16/512 nya".
 */
function claimsAvailability(sentence: string): boolean {
  return (
    AVAILABILITY.test(sentence) ||
    (ADA_ON_SHELF.test(sentence) && modelTokens(sentence).length > 0)
  );
}

/**
 * Words saying a unit is NOT there. A sentence that says what is gone and
 * then what is ready — "Air M3-nya lagi kosong kak, yang ready Air M2" — is
 * the out-of-stock reply the owner asked for (2026-10-27), and only the part
 * from the availability word on is a claim about the shelf.
 */
const OUT_OF_STOCK =
  /\b(kosong|habis|sold\s*out|out\s*of\s*stock|not\s*in\s*stock|tidak\s*ada|belum\s*ada|gak\s*ada|ga\s*ada|nggak\s*ada)\b/i;

/**
 * The words after the last "kosong" in a clause: "Air M3 kosong, yang ready
 * Air M2 Rp11.000.000" prices the M2, not the M3.
 */
function afterOutOfStock(clause: string): string {
  let end = -1;
  for (const m of clause.matchAll(new RegExp(OUT_OF_STOCK.source, "gi")))
    end = (m.index ?? 0) + m[0].length;
  return end < 0 ? clause : clause.slice(end);
}

/** Where the availability claim in a sentence starts. */
function claimStart(sentence: string): number {
  const at = [AVAILABILITY.exec(sentence), ADA_ON_SHELF.exec(sentence)]
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m.index);
  return at.length ? Math.min(...at) : 0;
}

/**
 * One unit or one model a stock lookup returned THIS turn, as a fact rather
 * than as text (2026-09-29). The old check searched the lookup's JSON for the
 * word "available" — which `{"available": false}` contains.
 */
export interface StockFact {
  /** How the shop names it: "MacBook Air M1 8/256". */
  readonly label: string;
  /** Sellable right now. */
  readonly available: boolean;
  /** Whole rupiah, digits only — the unit's price, or a model's range ends. */
  readonly prices: readonly string[];
}

export type ReplyProblem =
  | "EMPTY"
  | "NO_SOURCE"
  | "UNKNOWN_SOURCE"
  | "AMOUNT_NOT_IN_SOURCE"
  | "AVAILABILITY_NOT_IN_SOURCE"
  | "TOO_LONG";

/** Longest message the bot may send. A WhatsApp reply, not a brochure. */
export const MAX_REPLY_CHARS = 1_500;

/** Sentence boundaries that leave "Rp7.500.000" whole. */
const sentences = (text: string): string[] =>
  text
    .split(/(?<=[!?\n])|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Where the sentence holding `pos` begins. A dot counts only before a space. */
function clauseStart(text: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i -= 1) {
    const c = text[i];
    if (c === "\n" || c === "!" || c === "?") return i + 1;
    if (c === "." && /\s/.test(text[i + 1] ?? "")) return i + 1;
  }
  return 0;
}

const covers = (fact: StockFact, tokens: readonly string[]) => {
  const own = new Set(modelTokens(fact.label));
  return tokens.every((t) => own.has(t));
};

/**
 * Check a reply before it is sent.
 *
 * `sourceTexts` is the text of every non-stock source the model cited — an
 * approved answer, the shop's facts, the catalogue — and `unknownSources`
 * counts citations that named nothing. A greeting cites `greeting`, which
 * brings no text with it: such a reply may carry no figure and no claim.
 *
 * `stockFacts` is what the stock lookups returned this turn, present only
 * when the reply cites `stock`. Against them, since 2026-09-29:
 *
 *  - a price must be the price of an AVAILABLE unit, and of a unit the words
 *    beside it name — the Air M2's price is refused in a sentence about the
 *    Air M1, although both came back from one search;
 *  - "ready" (or "ada" beside a named unit) needs an available unit of what
 *    the sentence names. An approved answer can still say "ready" about
 *    nothing in particular, as the owner's generic answers do, but never
 *    about a model — only the shelf can.
 */
export function checkReply(input: {
  readonly message: string;
  readonly sourceCount: number;
  readonly unknownSources: number;
  readonly sourceTexts: readonly string[];
  readonly stockFacts?: readonly StockFact[];
}): ReplyProblem | null {
  const message = input.message.trim();
  if (message === "") return "EMPTY";
  if (message.length > MAX_REPLY_CHARS) return "TOO_LONG";
  if (input.unknownSources > 0) return "UNKNOWN_SOURCE";
  if (input.sourceCount === 0) return "NO_SOURCE";

  const available = (input.stockFacts ?? []).filter((f) => f.available);
  const allowed = new Set(input.sourceTexts.flatMap(amounts));

  const spans = amountSpans(message);
  for (let i = 0; i < spans.length; i += 1) {
    const a = spans[i]!;
    if (allowed.has(a.value)) continue;
    const priced = available.filter((f) => f.prices.includes(a.value));
    if (priced.length === 0) return "AMOUNT_NOT_IN_SOURCE";
    // Which unit the words beside the figure name: the clause before it, or
    // failing that the clause after ("Rp7.500.000 untuk Air M1").
    const sentenceStart = Math.max(
      clauseStart(message, a.start),
      i > 0 ? spans[i - 1]!.end : 0,
    );
    let tokens = modelTokens(
      afterOutOfStock(message.slice(sentenceStart, a.start)),
    );
    if (tokens.length === 0) {
      const after = message.slice(a.end, spans[i + 1]?.start ?? message.length);
      tokens = modelTokens(after.split(/[.!?\n]/)[0] ?? "");
    }
    if (!priced.some((f) => covers(f, tokens))) return "AMOUNT_NOT_IN_SOURCE";
  }

  const vouched = input.sourceTexts.some((s) => AVAILABILITY.test(s));
  const onShelf = new Set(available.flatMap((f) => modelTokens(f.label)));
  for (const sentence of sentences(message)) {
    if (!claimsAvailability(sentence)) continue;
    const tokens = modelTokens(
      OUT_OF_STOCK.test(sentence)
        ? sentence.slice(claimStart(sentence))
        : sentence,
    );
    if (tokens.length === 0) {
      if (vouched || available.length > 0) continue;
      return "AVAILABILITY_NOT_IN_SOURCE";
    }
    // A named unit: only the shelf can say it is there.
    if (available.length === 0 || !tokens.every((t) => onShelf.has(t)))
      return "AVAILABILITY_NOT_IN_SOURCE";
  }
  return null;
}

/**
 * A hand-over message is held to the strictest version of the same rule: it
 * cites nothing, so it may carry no figure and promise no stock.
 */
export function checkHoldingMessage(message: string): ReplyProblem | null {
  return checkReply({
    message,
    sourceCount: 1,
    unknownSources: 0,
    sourceTexts: [],
  });
}

// --- what the customer hears when a person takes over -----------------------

/**
 * The fallback hand-over lines, used when the model's own is refused or the
 * model is not reachable. In the owner's voice (docs/chatbot/knowledge-…md):
 * warm, "kak", one emoji or two, and a promise only of a reply.
 */
export function holdingMessage(topic: HandoffTopic, open: boolean): string {
  const when = open
    ? "Admin kami segera balas di chat ini ya kak 🙏"
    : "Admin kami akan balas saat jam operasional (10.00–20.00 WIB) ya kak 🙏";
  switch (topic) {
    case "stock":
    case "price":
    case "negotiation":
    case "unit_details":
    case "recommendation":
      return `Siap kak 😊 Untuk stok, harga, dan kondisi unit terbarunya kami cekkan dulu ya. ${when}`;
    case "reservation":
      return `Siap kak 😊 Untuk booking unit kami bantu proses langsung ya. ${when}`;
    case "order_payment":
      return `Terima kasih kak 🙏 Kami cek dulu ya. ${when}`;
    case "trade_in":
    case "sell_to_shop":
      return `Siap kak 😊 Untuk estimasi harganya kami cek dulu unitnya ya. ${when}`;
    case "complaint":
    case "warranty_claim":
      return `Mohon maaf atas kendalanya kak 🙏 Tim kami bantu cek ya. ${when}`;
    case "media":
      return `Terima kasih kak, sudah kami terima 🙏 ${when}`;
    case "photos":
      return `Siap kak 😊 Foto unitnya kami siapkan dulu ya. ${when}`;
    default:
      return `Baik kak, kami bantu teruskan ke admin ya 😊 ${when}`;
  }
}

// --- what a person is left to do ---------------------------------------------

/** `ChatActionKind` in the schema, spelled here so this file stays Prisma-free. */
export type ChatActionKind =
  "NEGOTIATION" | "PRICE" | "STOCK" | "RESERVATION" | "PHOTOS" | "OTHER";

/**
 * The action item a hand-over leaves behind (owner ask 2026-09-29). Coarser
 * than the topic on purpose: one open task per kind per chat, so a customer
 * who asks the price three ways is one PRICE task, not three.
 */
export function actionKindOf(topic: HandoffTopic): ChatActionKind {
  switch (topic) {
    case "negotiation":
      return "NEGOTIATION";
    case "price":
      return "PRICE";
    case "stock":
    case "unit_details":
    case "recommendation":
      return "STOCK";
    case "reservation":
      return "RESERVATION";
    case "photos":
      return "PHOTOS";
    default:
      return "OTHER";
  }
}
