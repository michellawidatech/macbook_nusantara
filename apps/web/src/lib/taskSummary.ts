/**
 * The note a bot hand-over leaves for a person, read as an action item
 * (owner, 2026-10-27: *"Need …" — short and concise, action items*).
 *
 * The worker stores it in Indonesian — `Perlu cek harga — Air 15" M2 8/256`,
 * then the customer's words or the bot's held draft quoted on the next line
 * (packages/agent `tasks.ts`). This reads that head back into the screen's
 * language, and reads the OLD notes — `Balasan bot ditahan (CODE): "…"`,
 * `Dialihkan ke staf (rule)`, `Bot (aturan) tidak bisa menjawab: "…"` — into
 * the same wording, so a task written before the change no longer shows a
 * code to a colleague.
 *
 * The Indonesian phrases matched below are the worker's vocabulary
 * (`TASK_NEED`, `TASK_REASON`): change one there, change it here.
 * `test/taskSummary.test.ts` pins both.
 *
 * Literal `t()` calls in switches rather than tables: test/i18n.test.ts finds
 * copy by reading the source, and a table indexed by a variable hides it.
 */
import type { TFunction } from "../i18n/translate.js";

export type TaskNeed =
  | "price"
  | "stock"
  | "unit"
  | "offer"
  | "recommend"
  | "booking"
  | "payment"
  | "tradeIn"
  | "sellToShop"
  | "shipping"
  | "warranty"
  | "complaint"
  | "media"
  | "photos"
  | "reply"
  | "template"
  | "tellBooking"
  /** Sales, 2026-10-27. */
  | "closing"
  | "welcome"
  | "notify";

export type TaskReason =
  | "noSource"
  | "unknownSource"
  | "tooLong"
  | "empty"
  | "amount"
  | "availability"
  | "noAnswer"
  | "windowClosed"
  | "noText"
  | "botFailed"
  | "noPhotos"
  | "noPrice"
  | "confirmFailed"
  | "notAutomatic"
  | "notTold";

/** The stored Indonesian head, back to its job. */
const NEED_OF_HEAD: Record<string, TaskNeed> = {
  "Perlu cek harga": "price",
  "Perlu cek stok": "stock",
  "Perlu cek kondisi unit": "unit",
  "Perlu jawab tawaran": "offer",
  "Perlu pilihkan unit": "recommend",
  "Perlu urus booking": "booking",
  "Perlu cek pembayaran": "payment",
  "Perlu taksir tukar tambah": "tradeIn",
  "Perlu taksir unit pelanggan": "sellToShop",
  "Perlu cek ongkir": "shipping",
  "Perlu urus garansi": "warranty",
  "Perlu tangani keluhan": "complaint",
  "Perlu lihat kiriman pelanggan": "media",
  "Perlu kirim foto": "photos",
  "Perlu dibalas": "reply",
  "Perlu dibalas dengan template": "template",
  "Perlu kabari booking": "tellBooking",
  // The sales strategy (2026-10-27). "Perlu kabari" is its own exact head,
  // not a prefix of the booking one above: heads are matched whole.
  "Perlu closing": "closing",
  "Perlu sambut": "welcome",
  "Perlu kabari": "notify",
};

/** The stored Indonesian reason, back to its key. */
const REASON_OF_TEXT: Record<string, TaskReason> = {
  "tidak ada sumber untuk jawabannya": "noSource",
  "sumber jawabannya tidak dikenal": "unknownSource",
  "draf terlalu panjang": "tooLong",
  "draf kosong": "empty",
  "angka di draf tidak ada sumbernya": "amount",
  "stok di draf tidak ada sumbernya": "availability",
  "bot tidak punya jawabannya": "noAnswer",
  "jendela 24 jam sudah tutup": "windowClosed",
  "pesan tanpa teks": "noText",
  "bot gagal membalas, cek log worker": "botFailed",
  "belum ada fotonya": "noPhotos",
  "harga belum diisi di POS": "noPrice",
  "konfirmasi gagal": "confirmFailed",
  "belum bisa dibuat otomatis": "notAutomatic",
  "belum disampaikan ke pelanggan": "notTold",
};

export function taskNeedLabel(t: TFunction, need: TaskNeed): string {
  switch (need) {
    case "price":
      return t("task.need.price", "Need price check");
    case "stock":
      return t("task.need.stock", "Need stock check");
    case "unit":
      return t("task.need.unit", "Need unit condition check");
    case "offer":
      return t("task.need.offer", "Need answer to an offer");
    case "recommend":
      return t("task.need.recommend", "Need a unit picked");
    case "booking":
      return t("task.need.booking", "Need booking handled");
    case "payment":
      return t("task.need.payment", "Need payment check");
    case "tradeIn":
      return t("task.need.tradeIn", "Need trade-in valuation");
    case "sellToShop":
      return t("task.need.sellToShop", "Need valuation of their unit");
    case "shipping":
      return t("task.need.shipping", "Need shipping cost");
    case "warranty":
      return t("task.need.warranty", "Need warranty handled");
    case "complaint":
      return t("task.need.complaint", "Need complaint handled");
    case "media":
      return t("task.need.media", "Need to look at what they sent");
    case "photos":
      return t("task.need.photos", "Need photos sent");
    case "template":
      return t("task.need.template", "Need reply with a template");
    case "tellBooking":
      return t("task.need.tellBooking", "Need booking passed on");
    case "closing":
      return t("task.need.closing", "Need to close the sale");
    case "welcome":
      return t("task.need.welcome", "Need to welcome a visit");
    case "notify":
      return t("task.need.notify", "Need to tell them it's in stock");
    default:
      return t("task.need.reply", "Need reply");
  }
}

export function taskReasonLabel(t: TFunction, reason: TaskReason): string {
  switch (reason) {
    case "noSource":
      return t("task.reason.noSource", "no source for the answer");
    case "unknownSource":
      return t(
        "task.reason.unknownSource",
        "the answer cites an unknown source",
      );
    case "tooLong":
      return t("task.reason.tooLong", "draft too long");
    case "empty":
      return t("task.reason.empty", "empty draft");
    case "amount":
      return t("task.reason.amount", "a figure in the draft has no source");
    case "availability":
      return t("task.reason.availability", "stock in the draft has no source");
    case "noAnswer":
      return t("task.reason.noAnswer", "the bot has no answer");
    case "windowClosed":
      return t("task.reason.windowClosed", "the 24-hour window has closed");
    case "noText":
      return t("task.reason.noText", "a message with no text");
    case "botFailed":
      return t(
        "task.reason.botFailed",
        "the bot failed to reply, check the worker log",
      );
    case "noPhotos":
      return t("task.reason.noPhotos", "no photos yet");
    case "noPrice":
      return t("task.reason.noPrice", "no price in the POS");
    case "confirmFailed":
      return t("task.reason.confirmFailed", "confirmation failed");
    case "notAutomatic":
      return t("task.reason.notAutomatic", "could not be made automatically");
    default:
      return t("task.reason.notTold", "the customer has not been told");
  }
}

/** The job a hand-over topic implies (packages/agent `needOfTopic`). */
export function needOfTopic(topic: string): TaskNeed {
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
    case "visit":
      return "welcome";
    case "restock":
      return "notify";
    default:
      return "reply";
  }
}

/** A refused draft's code, as the job and the reason (old notes). */
function heldCode(code: string): { need: TaskNeed; reason: TaskReason } {
  switch (code) {
    case "AMOUNT_NOT_IN_SOURCE":
      return { need: "price", reason: "amount" };
    case "AVAILABILITY_NOT_IN_SOURCE":
      return { need: "stock", reason: "availability" };
    case "UNKNOWN_SOURCE":
      return { need: "reply", reason: "unknownSource" };
    case "TOO_LONG":
      return { need: "reply", reason: "tooLong" };
    case "EMPTY":
      return { need: "reply", reason: "empty" };
    default:
      return { need: "reply", reason: "noSource" };
  }
}

/** What the panel draws: the action item, and what it quotes under it. */
export interface TaskSummaryLines {
  readonly head: string;
  /** The customer's words or the held draft, without its quotes. */
  readonly quote: string | null;
  /** Any further line the note carried (a model's own note, a booking). */
  readonly rest: readonly string[];
}

const unquote = (s: string | undefined | null): string | null => {
  const v = (s ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  return v === "" ? null : v;
};

/** A stored detail, with a known reason at its end translated. */
function detailText(t: TFunction, detail: string): string {
  const whole = REASON_OF_TEXT[detail];
  if (whole) return taskReasonLabel(t, whole);
  const cut = detail.lastIndexOf(", ");
  if (cut > 0) {
    const reason = REASON_OF_TEXT[detail.slice(cut + 2)];
    if (reason) return `${detail.slice(0, cut)}, ${taskReasonLabel(t, reason)}`;
  }
  return detail;
}

/**
 * Read a stored note into the screen's language. `topic` is the hand-over
 * topic it was left under, which is what an old routed note's job is.
 */
export function taskSummaryLines(
  t: TFunction,
  summary: string,
  topic: string,
): TaskSummaryLines {
  const text = summary.trim();

  // Old: a draft the checks refused, named by its code.
  const held = /^Balasan bot ditahan \(([A-Z_]+)\):?\s*(.*)$/s.exec(text);
  if (held) {
    const { need, reason } = heldCode(held[1]!);
    return {
      head: `${taskNeedLabel(t, need)} — ${taskReasonLabel(t, reason)}`,
      quote: unquote(held[2]),
      rest: [],
    };
  }
  // Old: a message the code sent to a person, named by its rule.
  const routed = /^Dialihkan ke staf \([^)]*\)\.?:?\s*(.*)$/s.exec(text);
  if (routed) {
    return {
      head: taskNeedLabel(t, needOfTopic(topic)),
      quote: unquote(routed[1]),
      rest: [],
    };
  }
  // Old: what the rules bot could not answer.
  const rules = /^Bot \(aturan\) tidak bisa menjawab:?\s*(.*)$/s.exec(text);
  if (rules || text === "Bot tidak menemukan jawaban yang disetujui.") {
    return {
      head: `${taskNeedLabel(t, "reply")} — ${taskReasonLabel(t, "noAnswer")}`,
      quote: unquote(rules?.[1]),
      rest: [],
    };
  }

  // New: "Perlu … — detail", then the quote, then anything else.
  const [first = "", ...more] = text.split("\n");
  const dash = first.indexOf(" — ");
  const headText = dash >= 0 ? first.slice(0, dash) : first;
  const need = NEED_OF_HEAD[headText];
  if (!need) return { head: text, quote: null, rest: [] };
  const detail = dash >= 0 ? first.slice(dash + 3).trim() : "";
  const quoted = more[0] && /^".*"$/s.test(more[0].trim()) ? more[0] : null;
  return {
    head: detail
      ? `${taskNeedLabel(t, need)} — ${detailText(t, detail)}`
      : taskNeedLabel(t, need),
    quote: unquote(quoted),
    rest: (quoted ? more.slice(1) : more).filter((l) => l.trim() !== ""),
  };
}
