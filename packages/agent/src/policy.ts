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
  opts: { hasMedia?: boolean } = {},
): Route | null {
  if (opts.hasMedia) return { topic: "media", rule: "media" };

  const t = text.toLowerCase();
  const product = PRODUCT.test(t);
  const money = MONEY.test(t);

  if (ORDER_PAYMENT.test(t))
    return { topic: "order_payment", rule: "order_payment" };
  if (BATTERY.test(t)) return { topic: "unit_details", rule: "battery" };
  if (NEGOTIATION.test(t) && (product || money))
    return { topic: "negotiation", rule: "negotiation+product" };
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
  if (RESERVATION.test(t)) return { topic: "reservation", rule: "reservation" };
  // A budget with no machine named is a request to pick one out of today's
  // shelf, which nobody here can see.
  if (money) return { topic: "recommendation", rule: "budget" };
  return null;
}

/** Whether a message names a specific machine. Exported for the prompt hint. */
export function mentionsProduct(text: string): boolean {
  return PRODUCT.test(text.toLowerCase());
}

// --- what the bot may send ---------------------------------------------------

/** Every rupiah figure in a text, digits only, so "Rp180.000" and "180.000" agree. */
function amounts(text: string): string[] {
  const out: string[] = [];
  const pattern =
    /rp\.?\s*(\d[\d.,]*)|(\d{1,3}(?:[.,]\d{3})+)|(\d+)\s*(jt|juta|rb|ribu|k)\b/gi;
  for (const m of text.matchAll(pattern)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/[.,]/g, "");
    const unit = (m[4] ?? "").toLowerCase();
    const scale =
      unit === "jt" || unit === "juta"
        ? 1_000_000
        : unit === "rb" || unit === "ribu" || unit === "k"
          ? 1_000
          : 1;
    if (raw !== "") out.push(String(Number(raw) * scale));
  }
  return out;
}

/** Words that tell a customer a machine is there to be bought. */
const AVAILABILITY =
  /\b(ready|tersedia|masih\s*ada|stok(nya)?\s*(ada|masih)|ada\s*stok|in\s*stock|available)\b/i;

export type ReplyProblem =
  | "EMPTY"
  | "NO_SOURCE"
  | "UNKNOWN_SOURCE"
  | "AMOUNT_NOT_IN_SOURCE"
  | "AVAILABILITY_NOT_IN_SOURCE"
  | "TOO_LONG";

/** Longest message the bot may send. A WhatsApp reply, not a brochure. */
export const MAX_REPLY_CHARS = 1_500;

/**
 * Check a reply before it is sent.
 *
 * `sourceTexts` is the text of every source the model cited that exists — an
 * approved answer, the shop's facts, the catalogue — and `unknownSources`
 * counts citations that named nothing. A greeting cites `greeting`, which
 * brings no text with it: such a reply may carry no figure and no claim.
 */
export function checkReply(input: {
  readonly message: string;
  readonly sourceCount: number;
  readonly unknownSources: number;
  readonly sourceTexts: readonly string[];
}): ReplyProblem | null {
  const message = input.message.trim();
  if (message === "") return "EMPTY";
  if (message.length > MAX_REPLY_CHARS) return "TOO_LONG";
  if (input.unknownSources > 0) return "UNKNOWN_SOURCE";
  if (input.sourceCount === 0) return "NO_SOURCE";

  const allowed = new Set(input.sourceTexts.flatMap(amounts));
  if (amounts(message).some((a) => !allowed.has(a)))
    return "AMOUNT_NOT_IN_SOURCE";

  if (
    AVAILABILITY.test(message) &&
    !input.sourceTexts.some((s) => AVAILABILITY.test(s))
  )
    return "AVAILABILITY_NOT_IN_SOURCE";
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
    default:
      return `Baik kak, kami bantu teruskan ke admin ya 😊 ${when}`;
  }
}
