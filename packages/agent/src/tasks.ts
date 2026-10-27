/**
 * What a hand-over leaves a person to do, as one short action item (owner,
 * 2026-10-27: *"Need …" — short and concise, action items*).
 *
 * The summary on a `ChatAction` and on a handed-over message used to be the
 * bot talking to itself — `Balasan bot ditahan (AMOUNT_NOT_IN_SOURCE): "…"`,
 * `Dialihkan ke staf (price+product)` — which tells a colleague which check
 * fired and nothing about what to do. Now every one reads the same way:
 *
 *     Perlu cek harga — Air 15" M2 8/256
 *     "Air 15 M2 8/256 harganya berapa kak?"
 *
 * The first line is the job and what it is about; the second, when there is
 * one, is the customer's words or the bot's held draft, quoted and short.
 * Stored in Indonesian, because the shop reads Indonesian; the web reads the
 * head back into either language (apps/web lib/taskSummary.ts), so the phrases
 * below are a vocabulary the screen knows — change one here and change it
 * there.
 *
 * Pure: no database, no clock.
 */

import {
  parseAskPrice,
  type HandoffTopic,
  type ReplyProblem,
  type Route,
} from "./policy.js";
import { productLabelOf } from "./rules/understand.js";

/** The job, in the shop's words. Each is a head the web can translate. */
export const TASK_NEED = {
  price: "Perlu cek harga",
  stock: "Perlu cek stok",
  unit: "Perlu cek kondisi unit",
  offer: "Perlu jawab tawaran",
  recommend: "Perlu pilihkan unit",
  booking: "Perlu urus booking",
  payment: "Perlu cek pembayaran",
  tradeIn: "Perlu taksir tukar tambah",
  sellToShop: "Perlu taksir unit pelanggan",
  shipping: "Perlu cek ongkir",
  warranty: "Perlu urus garansi",
  complaint: "Perlu tangani keluhan",
  media: "Perlu lihat kiriman pelanggan",
  photos: "Perlu kirim foto",
  reply: "Perlu dibalas",
  template: "Perlu dibalas dengan template",
  tellBooking: "Perlu kabari booking",
  /** Ready to buy, a keep/DP, how to pay (2026-10-27). */
  closing: "Perlu closing",
  /** A reminded visit the customer confirmed: be there to meet them. */
  welcome: "Perlu sambut",
  /** A unit somebody asked to be told about is on the shelf. */
  notify: "Perlu kabari",
  /**
   * A customer says they paid a DP or sent the transfer proof (2026-10-27):
   * staff check the bank and record it on the reservation. The bot never
   * records a DP.
   */
  verifyDp: "Perlu verifikasi DP",
  /** A DP hold ran out unpaid: refund the DP or keep it (hangus). */
  decideDp: "Perlu putuskan DP",
} as const;
export type TaskNeed = keyof typeof TASK_NEED;

/** Why, when there is no unit to name. Also a vocabulary the web knows. */
export const TASK_REASON = {
  noSource: "tidak ada sumber untuk jawabannya",
  unknownSource: "sumber jawabannya tidak dikenal",
  tooLong: "draf terlalu panjang",
  empty: "draf kosong",
  amount: "angka di draf tidak ada sumbernya",
  availability: "stok di draf tidak ada sumbernya",
  noAnswer: "bot tidak punya jawabannya",
  windowClosed: "jendela 24 jam sudah tutup",
  noText: "pesan tanpa teks",
  botFailed: "bot gagal membalas, cek log worker",
  noPhotos: "belum ada fotonya",
  noPrice: "harga belum diisi di POS",
  confirmFailed: "konfirmasi gagal",
  notAutomatic: "belum bisa dibuat otomatis",
  notTold: "belum disampaikan ke pelanggan",
} as const;

/** The job a hand-over topic leaves. */
export function needOfTopic(topic: HandoffTopic): TaskNeed {
  switch (topic) {
    case "price":
      return "price";
    case "stock":
      return "stock";
    case "unit_details":
      return "unit";
    case "negotiation":
      return "offer";
    case "recommendation":
      return "recommend";
    case "reservation":
      return "booking";
    case "order_payment":
      return "payment";
    case "trade_in":
      return "tradeIn";
    case "sell_to_shop":
      return "sellToShop";
    case "shipping_quote":
      return "shipping";
    case "warranty_claim":
      return "warranty";
    case "complaint":
      return "complaint";
    case "media":
      return "media";
    case "photos":
      return "photos";
    case "closing":
      return "closing";
    default:
      return "reply";
  }
}

/** Longest quote kept under the head. A reminder, not the transcript. */
export const TASK_QUOTE_CHARS = 120;

/** Text on one line, clipped with an ellipsis. */
export function clipQuote(text: string, max = TASK_QUOTE_CHARS): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * `Perlu X — detail` and, on its own line, the quote. Either part may be
 * absent; the head never is.
 */
export function taskNote(
  need: TaskNeed,
  detail?: string | null,
  quote?: string | null,
): string {
  const head = detail?.trim()
    ? `${TASK_NEED[need]} — ${detail.trim()}`
    : TASK_NEED[need];
  const q = quote?.trim() ? clipQuote(quote) : "";
  return q ? `${head}\n"${q}"` : head;
}

/** The unit a text names, as the task line writes it. */
export const unitSubject = (text: string | null | undefined): string | null =>
  text ? productLabelOf(text) : null;

/**
 * A message the code sent to a person before the bot answered it: the job its
 * topic implies, the unit it names, and the customer's words.
 */
export function routedTask(topic: HandoffTopic, customerText: string): string {
  return taskNote(needOfTopic(topic), unitSubject(customerText), customerText);
}

/**
 * The task a ROUTED message leaves: `routedTask`, except a DP the customer
 * says they paid (2026-10-27), which is `Perlu verifikasi DP — …` with the
 * amount and unit their words name.
 */
export function routeSummary(
  route: Pick<Route, "topic" | "rule">,
  customerText: string,
  name: string | null = null,
): string {
  if (route.rule === "dp_proof")
    return dpVerifyTask({
      name,
      amount: parseAskPrice(customerText),
      unit: unitSubject(customerText),
      text: customerText,
    });
  return routedTask(route.topic, customerText);
}

/**
 * A draft `checkReply` refused: the job the refusal implies — a figure
 * nothing vouched for is a price to check, a "ready" nothing vouched for is
 * stock to check — the unit, and the held draft quoted under it.
 */
export function heldReplyTask(
  problem: ReplyProblem,
  draft: string,
  customerText: string | null | undefined,
): { topic: HandoffTopic; summary: string } {
  const unit = unitSubject(customerText) ?? unitSubject(draft);
  switch (problem) {
    case "AMOUNT_NOT_IN_SOURCE":
      return {
        topic: "price",
        summary: taskNote("price", unit ?? TASK_REASON.amount, draft),
      };
    case "AVAILABILITY_NOT_IN_SOURCE":
      return {
        topic: "stock",
        summary: taskNote("stock", unit ?? TASK_REASON.availability, draft),
      };
    case "TOO_LONG":
      return {
        topic: "other",
        summary: taskNote("reply", TASK_REASON.tooLong, draft),
      };
    case "EMPTY":
      return {
        topic: "other",
        summary: taskNote("reply", TASK_REASON.empty, customerText),
      };
    case "UNKNOWN_SOURCE":
      return {
        topic: "other",
        summary: taskNote("reply", TASK_REASON.unknownSource, draft),
      };
    case "NO_SOURCE":
      return {
        topic: "other",
        summary: taskNote("reply", TASK_REASON.noSource, draft),
      };
  }
}

/**
 * A question this thread handed to a person that nobody has dealt with yet
 * (an OPEN `ChatAction`). Since 2026-10-27 a hand-over no longer silences the
 * thread: the bot answers the customer's newer messages and is told about
 * these so it neither answers nor contradicts them.
 */
export interface WaitingTask {
  readonly topic: HandoffTopic;
  /** The customer's words that raised it, when kept. */
  readonly text: string | null;
}

/**
 * Has the bot's previous reply already told the customer a colleague will
 * answer? Every holding line says what "aku" is checking ("aku cekin dulu",
 * "aku tanyain ke owner dulu" — policy.ts `holdingMessage`, 2026-10-27) and
 * the still-waiting line says "tim kami" (rules/replies.ts); older replies
 * said "admin kami", which is still read. So the second nudge is not answered
 * with the same promise again.
 */
export function saidColleagueWillReply(
  lastReply: string | null | undefined,
): boolean {
  return /\b(admin|tim)\s+kami\b|\bcolleague\b|\bour team\b|\baku\s+(cek(in)?|cari(in)?|tanya(in|kan)|pastikan|siap(in|kan)|lihat|bantu\s+(cek|atur|proses))\b[^.?!\n]*\bdulu\b|\baku\s+teruskan\b|\baku\s+kabari\b|\baku\s+bantu\s+(cek|atur)\s+langsung\b|\bI'?ll\s+(check|ask)\b/i.test(
    lastReply ?? "",
  );
}

/** "Rp9.500.000" → "Rp 9,5jt": how the shop writes a price on a task line. */
export function shortRupiah(value: string | number | bigint | null): string {
  const n =
    typeof value === "string"
      ? Number(value.replace(/\D/g, ""))
      : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) {
    const jt = Math.round(n / 100_000) / 10;
    return `Rp ${String(jt).replace(".", ",")}jt`;
  }
  return `Rp ${Math.round(n / 1_000)}rb`;
}

/**
 * The closing task (owner, 2026-10-27): who, what they want to do, the unit
 * and its price, and when — `Perlu closing — Budi siap ambil Air M2 8/256
 * Rp 9,5jt, mau COD Sabtu` — with the customer's words under it.
 */
export function closingTask(c: {
  readonly name: string | null;
  /** `keep` asked to put it aside / a DP; `buy` is ready to take it. */
  readonly wants: "keep" | "buy";
  readonly unit: string | null;
  readonly price?: string | number | bigint | null;
  /** "mau COD Sabtu" — what else they said about how, already short. */
  readonly how?: string | null;
  readonly text: string;
}): string {
  const who = c.name?.trim() || "Pelanggan";
  const verb = c.wants === "keep" ? "minta unit di-keep (DP)" : "siap ambil";
  const price = c.price != null ? shortRupiah(c.price) : "";
  const detail = [
    `${who} ${verb}`,
    c.unit?.trim() ? c.unit.trim() : null,
    price || null,
  ]
    .filter(Boolean)
    .join(" ");
  return taskNote(
    "closing",
    c.how?.trim() ? `${detail}, ${c.how.trim()}` : detail,
    c.text,
  );
}

/** `Perlu sambut — Budi datang Sabtu 14.00 lihat Air M2`. */
export function welcomeTask(c: {
  readonly name: string | null;
  /** "Sabtu 14.00" */
  readonly when: string;
  readonly unit: string | null;
}): string {
  const who = c.name?.trim() || "Pelanggan";
  return taskNote(
    "welcome",
    `${who} datang ${c.when}${c.unit?.trim() ? ` lihat ${c.unit.trim()}` : ""}`,
  );
}

/** `Perlu kabari — Air M3 16/512 sudah ready, Budi minta dikabari`. */
export function notifyTask(c: {
  readonly name: string | null;
  readonly unit: string;
}): string {
  const who = c.name?.trim() || "pelanggan";
  return taskNote("notify", `${c.unit} sudah ready, ${who} minta dikabari`);
}

/**
 * `Perlu verifikasi DP — Budi kirim bukti transfer Rp 500rb untuk Air M2
 * 8/256` (2026-10-27). The amount and unit are what the conversation said;
 * either may be missing.
 */
export function dpVerifyTask(c: {
  readonly name: string | null;
  readonly amount?: string | number | bigint | null;
  readonly unit: string | null;
  readonly text: string;
}): string {
  const who = c.name?.trim() || "Pelanggan";
  const amount = c.amount != null ? shortRupiah(c.amount) : "";
  const detail = [
    `${who} kirim bukti transfer`,
    amount || null,
    c.unit?.trim() ? `untuk ${c.unit.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return taskNote("verifyDp", detail, c.text);
}

/**
 * `Perlu putuskan DP — Budi tidak melunasi Air M2, DP Rp 500rb: kembalikan
 * atau hangus?` (2026-10-27) — left when a DP hold runs out unpaid.
 */
export function dpDecisionTask(c: {
  readonly name: string | null;
  readonly unit: string | null;
  readonly amount: string | number | bigint;
}): string {
  const who = c.name?.trim() || "Pelanggan";
  return taskNote(
    "decideDp",
    `${who} tidak melunasi ${c.unit?.trim() || "unitnya"}, DP ${shortRupiah(c.amount)}: kembalikan atau hangus?`,
  );
}

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const BULAN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/** A day as the shop writes it — "Senin, 3 Nov", Jakarta time. */
export function jakartaDayLabel(at: Date): string {
  const local = new Date(at.getTime() + 7 * 3_600_000);
  return `${HARI[local.getUTCDay()]}, ${local.getUTCDate()} ${BULAN[local.getUTCMonth()]}`;
}

/** A visit as the shop writes it — "Sabtu 14.00", Jakarta time. */
export function jakartaVisitLabel(at: Date): string {
  const local = new Date(at.getTime() + 7 * 3_600_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${HARI[local.getUTCDay()]} ${hh}.${mm}`;
}
