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
   * May it book, check, move and cancel the customer's own VISIT? Since
   * 2026-10-27 a bot booking holds nothing (owner: *"if reservation makes the
   * stock decrease and reduce sale, it is bad"*) — it is a time to come and
   * look, and every unit stays on sale — so this defaults ON.
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
 * one off on /chat.
 *
 * Bookings are ON as well since the same day's sales strategy: the bot books
 * a VISIT and never holds a unit (`book_visit`, `createVisit`), so the reason
 * they were off — a stranger taking stock off the shelf — is gone.
 */
export const SHOP_CAPABILITIES: AgentCapabilities = {
  stock: true,
  price: true,
  reserve: true,
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
 * unrecognised) variable reads as `SHOP_CAPABILITIES` — every switch on,
 * visits included (they hold nothing). `live` is the same today, and
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
  /**
   * Ready to buy, wants a unit kept (a DP) or asks how to pay (2026-10-27):
   * a person closes the sale. Its own task kind, CLOSING.
   */
  "closing",
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

/**
 * Words that bargain. ANY of them is a person's (owner, 2026-10-27, later:
 * *"for negotiating it should be handled by human"*) — "bisa kurang kak?",
 * "ada diskon gak?", "bisa ditawar?", "harga udah net atau masih bisa nego?"
 * with nothing named included. Until then they went over only beside a unit,
 * a figure or a unit just shown, and the rest reached the model, which could
 * answer them — or discount.
 *
 * ⚠️ 2026-10-27 (owner: *"the chatbot always escalates to human for things
 * that they can actually answer"*): "murah" and "turun" are NOT here. "Ada
 * yang lebih murah?" asks for a cheaper unit, which the shelf answers;
 * "kemahalan" and "turun harga gak?" get an answer and cheaper options, not a
 * colleague. "Kurang dari 10jt" is a budget, so "kurang" counts only as a
 * request ("bisa kurang?", "kurangin").
 */
const NEGOTIATION =
  /\b(nego(in|siasi)?|(di)?kurang(in|i)|bisa\s+kurang|(di)?murahin|(di)?turunin|diskon(in)?|potongan|potong|korting|best\s*price|harga\s*pas|net\s*berapa|harga\s*net(nya)?|(di)?tawar|nawar)\b/i;

/**
 * Bargaining said outright — a request, not a question about the policy —
 * which is a negotiation with nothing else named: "nego dong", "kurangin
 * dikit", "harga pas berapa?", "best price?", "diskonin dong".
 */
const BARGAIN =
  /(?<!\b(bisa|boleh|masih|gak|ga|nggak|tidak)\s+)\bnego\s*(dong|donk|dund|ya|yah|yuk|lah|deh|kak|ka|gan|min|bos|boss|sis|bang|bro)\b|\b(di)?kurang(in|i)\s*(dikit|sedikit|lagi|dong|donk|ya|lah|deh)\b|\bharga\s*pas(nya)?\s*(berapa|brp|brapa)\b|\bbest\s*price\b|\bnet\s*(nya\s*)?berapa\b|\b(di)?murahin\b|\bdiskon(in)?\s*(dong|donk|dikit|lah|ya|deh)\b/i;

/**
 * Not a bargain, though the words are there: a budget ("kurang dari 10jt",
 * "kurang lebih"). Taken out of the text before the bargaining words are
 * read. "Ada diskon?" is no longer here (2026-10-27, later): asking for a
 * discount is negotiating, and the owner wants every one of those.
 */
const NOT_A_BARGAIN = /\bkurang\s+(dari|lebih|tau|tahu|paham|ngerti|jelas)\b/gi;

/**
 * A battery's HEALTH, which the owner answers with a photo of that machine
 * (docs/chatbot/knowledge-2026-09-18.md). Not the word "baterai" on its own:
 * "bisa ganti baterai?" is the service question the owner already answered.
 */
const BATTERY =
  /\b(bh|battery\s*health|health(nya)?|siklus(nya)?|cycle(\s*count)?)\b|\b(baterai|batre|battery)(nya)?\s*(berapa|brp|masih|sehat|bagus|normal|aman|persen)/i;

const UNIT_DETAILS =
  /\b(foto(nya)?|video(nya)?|real\s*pic(t)?|gambar(nya)?|kondisi(nya)?|minus(nya)?|mulus|lecet|serial(nya)?|garansi\s*(resmi|apple|ibox)|ibox)\b/i;

const RESERVATION = /\b(booking|book|reserve|reservasi|janji\s*datang)\b/i;

/**
 * Asking the shop to put a unit aside — keep, hold, a DP (2026-10-27). The
 * bot never holds stock, so this is a closing task for a person, whatever the
 * switches say; it states the DP rule from the settings (`dpKeepLine`), and a
 * person records the DP once the transfer is checked.
 *
 * ⚠️ HOLD INTENT only (2026-10-27, later). "Tahan" is also how a battery
 * lasts ("baterainya tahan berapa jam?") and "simpan" is what a laptop does
 * with files, so a bare "tahan"/"simpan" no longer counts: "ditahan",
 * "tahanin", "tahan dulu", "di-keep", "amankan", "mau DP" do.
 */
const KEEP =
  /\b(di-?\s?)?keep\b|\bkip(in)?\s*(dulu|ya|dong)\b|\btahan(in|kan)\b|\b(di)?tahan\s+(dulu|unit(nya)?|buat\s+(saya|aku|sy|gw)|untuk\s+(saya|aku|sy))\b|\bditahan\b|\bdi\s+tahan\b|\b(di)?amankan\b|\bamanin\b|\bhold(in)?\b|\b(simpen|simpan)(in|kan)\s*(dulu)?\b|\btitip\s+dulu\b|\b(dp|down\s*payment|uang\s*muka|tanda\s*jadi)\b/i;

/** "Cicilan tanpa DP?" asks about instalments, not about keeping a unit. */
const NOT_A_KEEP = /\btanpa\s+(dp|uang\s*muka)\b/gi;

/**
 * Committing to buy — a person closes, the bot cannot take money
 * (2026-10-27). Narrowed the same day: "mau beli macbook buat kuliah" and
 * "cara bayarnya gimana?" are a customer starting out and a question the
 * approved answers cover, and both are the bot's. What is left is taking a
 * unit ("saya ambil yang Air M2", "jadi ambil yang pertama"), a deal, and
 * asking where to send the money.
 */
const CLOSE = new RegExp(
  [
    // "saya ambil", "jadi order", "fix ambil" — not "ambil di toko", not
    // "beli macbook buat kuliah" (a first message, not a decision).
    String.raw`\b(saya|aku|sy|gw|gue|gua|kami|jadi|fix|oke|ok|okay|yaudah|ya\s+udah)\s+(jadi\s+)?(ambil|angkut|order|checkout|pesan|beli)\b(?!\s+(di|ke|sendiri|langsung|nanti|besok|macbook|laptop|mac|yang\s+(bagus|murah|cocok|mana)))`,
    String.raw`\b(ambil|beli|order|pesan|angkut|checkout)\s+(yang|yg)\s+(ini|itu|tadi|pertama|kedua|ketiga|terakhir|tsb|tersebut|[1-3])\b`,
    String.raw`\b(ok|oke|okay|siap)?\s*deal\b(?!\s*(apa|nya))`,
    String.raw`\b(minta|kirim(in|kan)?|bagi|share|info(in)?)\s+(no(mor|mer)?\.?\s*)?(rek|rekening)\b`,
    String.raw`\bnorek\b|\brek(ening)?(nya)?\s+(apa|mana|berapa|dong)\b`,
    String.raw`\btransfer\s+ke\s+(mana|rek(ening)?)\b`,
    String.raw`\bcheckout\b`,
    String.raw`\b(i'?ll|i\s+will)\s+take\s+(it|this|that|the)\b|\bi'?d\s+like\s+to\s+buy\s+(it|this|that|the)\b`,
  ].join("|"),
  "i",
);

/**
 * Taking a unit the bot just showed: "mau ambil yang Air M2", "order yang M1
 * ya", "yang pertama aja kak". Only with something shown — before that, "mau
 * beli yang M2" is a customer asking about one.
 */
const COMMIT_SHOWN =
  /\b(ambil|beli|order|pesan|angkut)\s+(yang|yg|unit)\b|\b(yang|yg)\s+(ini|itu|pertama|kedua|ketiga|tadi|[1-3])\s+(aja|saja|deh|ya\s+kak)\b/i;

/**
 * The broader wish to buy — "mau beli macbook", "how do I pay" — which is a
 * LEAD signal (`asksToBuy`, the rules bot's score) and never a hand-over.
 */
const BUY_INTENT =
  /\b(mau|jadi|saya|aku|sy|gw|gue|kami|pengen|pingin|ingin)\s+(ambil|beli|order|pesan|checkout)\b|\b(cara|gimana|bagaimana)\s+(bayar(nya)?|pembayaran(nya)?|order(nya)?|belinya|pesannya|checkoutnya)\b|\b(i\s+want\s+to\s+buy|how\s+(do|can)\s+i\s+pay)\b/i;

/**
 * Asking how to buy, or to buy online (owner, 2026-10-28): "cara belinya
 * gimana?", "bisa checkout di shopee?", "ada link tokpednya?", "beli online
 * bisa?", "order dari luar kota". The bot answers with the variant's listing
 * link (its `links`) — never a hand-over, though "checkout" is also a word
 * `CLOSE` reads. Not "cara bayarnya?" (how to pay, an approved answer) and not
 * a keep or "saya ambil".
 */
const BUY_ONLINE = new RegExp(
  [
    String.raw`\b(cara|gimana|bagaimana|gmn)\s+(cara\s+)?(beli|order|pesan|checkout|co)(nya)?\b`,
    String.raw`\b(beli|order|pesan|checkout|co)(nya)?\s+(secara\s+)?(online|lewat\s+online|via\s+online)\b`,
    String.raw`\b(beli|order|pesan|checkout|co)(nya)?\s+(di|lewat|via|ke)\s+(shopee|tokped|tokopedia|marketplace|ig|instagram)\b`,
    String.raw`\b(beli|order|pesan)\s+(dari|di)\s+luar\s+kota\b`,
    String.raw`\b(ada|minta|kirim(in|kan)?|share|bagi)\s+(link|linknya|tautan)\b`,
    String.raw`\blink\s*(nya\s+)?(shopee|tokped|tokopedia|ig|instagram|produk|beli|checkout)\b`,
    String.raw`\b(shopee|tokped|tokopedia)(nya)?\s+(ada|ada\s+gak|ada\s+ga|bisa)\b`,
    String.raw`\b(ada|jual)\s+di\s+(shopee|tokped|tokopedia)\b`,
    String.raw`\b(buy|order|purchase)\s+(it\s+)?online\b|\b(shopee|tokopedia)\s+link\b`,
  ].join("|"),
  "i",
);

/** Does this message ask how to buy, or to buy online? */
export function asksBuyOnline(text: string): boolean {
  return BUY_ONLINE.test(text);
}

/** Letting a booking go, or moving it — both are the booking switch's. */
const CANCEL_BOOKING =
  /\b(batal(in|kan)?|cancel|gak\s*jadi|ga\s*jadi|nggak\s*jadi|ngga\s*jadi|reschedule|ganti\s*(jadwal|jam|hari)|undur|majuin|mundurin)\b/i;

/** A request to SEE a unit — the photo switch's. */
const PHOTO_REQUEST =
  /\b(foto(nya)?|photo|pic(t)?|picture|gambar(nya)?|video(nya)?|real\s*pic(t)?|liat|lihat)\b/i;

/** A figure the way a price is written: "14jt", "7,5 juta", "Rp7.200.000". */
const FIGURE = String.raw`(?:rp\.?\s*)?\d[\d.,]*\s*(?:jt|juta|rb|ribu|k)?`;
/** What may follow an offer for it to be one: the end, or a particle. */
const OFFER_END = String.raw`(?=\s*(?:$|[?.!,]|kak|ka|min|gan|ya|yah|ga|gak|gk|nggak|ngga|dong|donk|deh|kah|bos|sis))`;

/**
 * A figure put forward as what the customer wants to pay: "kalau 7jt
 * boleh?", "bisa 14jt aja?", "7.200.000 deal?". Only counted with a money
 * figure beside it (routeMessage).
 *
 * ⚠️ Not "kalo yang 12 jutaan ada?" (2026-10-27): the old `kalau … \d`
 * branch read every conditional with a number in it as an offer. A figure
 * after "yang", or ending in "-an", is a price RANGE somebody is shopping in.
 */
const OFFER = new RegExp(
  [
    String.raw`${FIGURE}\s*(?:aja|aj|saja|boleh|bisa|deal)${OFFER_END}`,
    String.raw`\bbisa\s*(?:di\s*)?(?:rp\.?\s*)?\d[\d.,]*\s*(?:jt|juta|rb|ribu|k)\b`,
    String.raw`\bbisa\s*(?:di\s*)?(?:rp\.?\s*)?\d{1,3}(?:[.,]\d{3})+`,
    String.raw`\b(?:tawar|nawar)\s*${FIGURE}`,
  ].join("|"),
  "i",
);

/**
 * An offer only in the light of a unit already on the table: "kalo 14jt
 * gimana?", "14jt dapet?", "7,5 aja ya". Without a unit shown or named, the
 * same words are somebody saying what they want to spend.
 */
const OFFER_ON_UNIT = new RegExp(
  [
    String.raw`\b(?:kalau|kalo|klo|kl)\s+${FIGURE}\s*(?:gimana|gmn|dapet|dapat|dpt|oke|ok|boleh|bisa|deal)\b`,
    String.raw`${FIGURE}\s*(?:dapet|dapat|dpt)${OFFER_END}`,
    String.raw`\b\d{1,2}[.,]\d{1,2}\s*(?:aja|saja|deal|boleh|bisa)${OFFER_END}`,
  ].join("|"),
  "i",
);

/**
 * A budget, or a price range somebody is shopping in — a request to pick
 * something, never an offer on a unit: "budget 10jt", "dapet apa", "yang 12
 * jutaan", "di bawah 15jt", "sekitar 10jt".
 */
const BUDGET =
  /\b(budget|bajet|bujet|dana(nya)?|kisaran|sekitar|range|maks|max|maksimal|di\s*bawah|dibawah|di\s*atas|diatas|kurang\s+dari|under|below)\b|\b(dapa?t|dpt)\s+(apa|yang|yg|macbook|mac|laptop|unit|tipe|seri)\b|\b(yang|yg)\s+(harga(nya)?\s+)?(rp\.?\s*)?\d|\d\s*(jt|juta|rb|ribu)?\s*-?\s*an\b|\bjutaan\b|\bjtan\b/i;

/**
 * A DP the customer says they have PAID — "sudah transfer DP", "ini bukti
 * DP-nya" (2026-10-27). Staff verify the bank and record it; the bot never
 * does. Past tense or a proof, so "mau DP, transfer ke mana?" stays a keep.
 */
const DP_WORD = /\b(dp|down\s*payment|uang\s*muka|tanda\s*jadi)\b/i;
const PAID_WORD =
  /\b(sudah|udah|udh|sdh|barusan|telah)\b[^.?!\n]{0,24}\b(transfer|tf|bayar|kirim|dp)\b|\bbukti\b/i;

/** Did the customer say they paid a DP? */
export function saysDpPaid(text: string): boolean {
  return DP_WORD.test(text) && PAID_WORD.test(text);
}

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
    /**
     * The bot's previous reply showed units (`lastShownUnits`). "Bisa nego?",
     * "kalo 14jt gimana?" and "mau ambil yang M2" are about THOSE units then,
     * and a person takes them; with nothing shown they are a customer
     * starting out, and the bot answers (2026-10-27).
     */
    shown?: boolean;
  } = {},
): Route | null {
  const can = opts.capabilities ?? PARALLEL_CAPABILITIES;
  const shown = opts.shown === true;
  /*
   * A photo, a video, a voice note or a document still goes to a person, with
   * `photos` on or off. The capability is about the shop SENDING its own
   * pictures of a unit; a picture the CUSTOMER sent is a transfer slip, a
   * cracked screen or a machine they want valued, and every one of those needs
   * eyes.
   */
  const t = text.toLowerCase();
  // A DP proof, as words or as a photo captioned with them (2026-10-27).
  if (saysDpPaid(t)) return { topic: "order_payment", rule: "dp_proof" };
  if (opts.hasMedia) return { topic: "media", rule: "media" };

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
   *
   * Any bargaining word at all (2026-10-27, later), with or without a unit
   * beside it. Still not "ada yang lebih murah?", "kemahalan", "turun harga
   * gak?" or "kalo yang 12 jutaan ada?": those ask for a cheaper unit or an
   * answer, and the bot gives one.
   */
  const bargain = t.replace(NOT_A_BARGAIN, " ");
  if (BARGAIN.test(bargain) || NEGOTIATION.test(bargain))
    return { topic: "negotiation", rule: "negotiation" };
  const budget = BUDGET.test(t);
  if (!budget && money && OFFER.test(t))
    return { topic: "negotiation", rule: "offer" };
  if (!budget && (shown || product) && OFFER_ON_UNIT.test(t))
    return { topic: "negotiation", rule: "offer" };
  // Keep it for me / a DP / I'll take it / send the account: the next step
  // is a person closing the sale (2026-10-27). Not a booking — the bot never
  // holds — and not "mau beli macbook" or "cara bayarnya?", which it answers.
  // How to buy, or buying online: the bot sends the listing (2026-10-28).
  // Ahead of KEEP and CLOSE, which read "checkout" as committing.
  if (asksBuyOnline(t) && !KEEP.test(t.replace(NOT_A_KEEP, " "))) return null;
  if (KEEP.test(t.replace(NOT_A_KEEP, " ")))
    return { topic: "closing", rule: "keep" };
  if (CLOSE.test(t) || (shown && COMMIT_SHOWN.test(t)))
    return { topic: "closing", rule: "buy" };
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
  if (!can.reserve && RESERVATION.test(t))
    return { topic: "reservation", rule: "reservation" };
  // A budget with no machine named is a request to pick one out of today's
  // shelf. With `stock` the bot can do exactly that, and it is the most
  // useful thing it does.
  if (money) return { topic: "recommendation", rule: "budget" };
  return null;
}

/**
 * Wants to buy — keeping a unit, taking one, or just "mau beli macbook" and
 * "cara bayarnya?" (2026-10-27). A LEAD signal for the rules bot's score; the
 * hand-over is `routeMessage`'s narrower reading.
 */
export function asksToBuy(text: string): boolean {
  const t = text.toLowerCase();
  return (
    KEEP.test(t.replace(NOT_A_KEEP, " ")) || CLOSE.test(t) || BUY_INTENT.test(t)
  );
}

/** Whether a message names a specific machine. Exported for the prompt hint. */
export function mentionsProduct(text: string): boolean {
  return PRODUCT.test(text.toLowerCase());
}

// --- what the bot may send ---------------------------------------------------

/**
 * Every rupiah figure in a text, as whole rupiah in digits, with where it sits.
 *
 * "Rp180.000", "180.000", "180rb", "7,5jt", "7.5 juta", "11,925jt" and a bare
 * "7500000" all count — the short forms are how the bot writes a price since
 * 2026-10-27, and each is read as exactly that figure. The bare run of digits is new (2026-09-29): before it, a reply
 * writing a price without separators was never checked at all.
 */
function amountSpans(
  text: string,
): Array<{ value: string; start: number; end: number }> {
  const out: Array<{ value: string; start: number; end: number }> = [];
  const pattern =
    /(?:rp\.?\s*)?(\d+(?:[.,]\d{1,3})?)\s*(jt|juta|jtan|rb|ribu|k)\b|rp\.?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)|(\d{1,3}(?:[.,]\d{3})+)|\b(\d{6,})\b/gi;
  for (const m of text.matchAll(pattern)) {
    let value: number;
    if (m[1] !== undefined) {
      const unit = (m[2] ?? "").toLowerCase();
      const scale = unit.startsWith("j") ? 1_000_000 : 1_000;
      // "11,925jt" is a decimal; "1.500rb" groups thousands.
      const digits =
        !unit.startsWith("j") && /[.,]\d{3}$/.test(m[1])
          ? m[1].replace(/[.,]/g, "")
          : m[1].replace(",", ".");
      value = Math.round(Number(digits) * scale);
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
  /**
   * How many sellable units of this variant the shelf holds, when the lookup
   * counted them (`left`, 2026-10-27). The only thing that may say "tinggal
   * 1 unit".
   */
  readonly count?: number;
  /**
   * The variant's own marketplace listings, when the lookup returned them
   * (2026-10-28). A reply may send these links and no others.
   */
  readonly links?: readonly string[];
  /**
   * How many of the shop's own photos the unit has, when the lookup counted
   * them (2026-10-27). "Mau lihat fotonya?" may be offered only where one of
   * the units has some (`offersPhotos`, converse.ts).
   */
  readonly photos?: number;
}

/**
 * A reply offering to SHOW photos: "Mau lihat fotonya kak?", "aku kirimin
 * fotonya ya", "Want to see photos?". Not "fotonya belum ada" — saying there
 * are none is not an offer.
 */
const PHOTO_OFFER =
  /\b(mau|boleh|perlu|pengen|ingin)\s+(aku\s+|saya\s+|kami\s+)?(lihat|liat|dikirim(in|kan)?|kirim(in|kan)?)\s+(foto|poto|gambar|video)(-?nya)?\b|\b(aku|saya|kami)\s+(kirim(in|kan)?|share)\s+(foto|poto|gambar)(-?nya)?\b|\b(see|send)\s+(you\s+)?(some\s+|the\s+)?(photos?|pictures?|pics?)\b/i;

/** Does this sentence offer to show the customer photos? */
export function offersPhotos(text: string): boolean {
  return PHOTO_OFFER.test(text);
}

/**
 * Take an offer of photos out of a reply whose units have none (2026-10-27:
 * "Mau lihat fotonya kak?" about an iPad nobody had photographed). The
 * sentence goes, and when no question is left the visit question takes its
 * place — the next rung of the same ladder. Pure; returns the text unchanged
 * when nothing in it offers photos.
 */
export function withoutPhotoOffer(
  message: string,
  visitQuestion = "Mau datang lihat langsung kak, kapan enaknya?",
): string {
  if (!offersPhotos(message)) return message;
  const kept = message
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?…])\s+/)
        .filter((sentence) => !offersPhotos(sentence))
        .join(" "),
    )
    .filter(
      (line, i, all) =>
        line.trim() !== "" || (i > 0 && all[i - 1]!.trim() !== ""),
    )
    .join("\n")
    .trim();
  return kept.includes("?")
    ? kept
    : `${kept}${kept ? "\n" : ""}${visitQuestion}`;
}

export type ReplyProblem =
  | "EMPTY"
  | "NO_SOURCE"
  | "UNKNOWN_SOURCE"
  | "AMOUNT_NOT_IN_SOURCE"
  | "AVAILABILITY_NOT_IN_SOURCE"
  | "DISCOUNT_OFFERED"
  | "LINK_INVENTED"
  | "TOO_LONG";

/**
 * A reply that offers to bargain (owner, 2026-10-27: *"for negotiating it
 * should be handled by human"*): "bisa kurang", "masih bisa nego", "aku kasih
 * diskon", "ada harga khusus", "best price", "bisa dikurangin". The bot never
 * negotiates and never offers or promises a discount — a lower price is the
 * owner's to give — so such a draft is refused whatever it cites. The approved
 * answer about "harga net" ends on "best price khusus", which is exactly why
 * the source does not vouch for it.
 *
 * Saying NO is not an offer: "harganya sudah net, belum bisa nego" and "tidak
 * ada diskon" pass (`NEGATED_BEFORE`). Nor is the hand-over line "Untuk nego
 * harganya aku tanyain ke owner dulu" — "nego" counts only after a "bisa".
 */
const DISCOUNT_OFFER =
  /\b(?:bisa|boleh|dapat|dapet|dpt)\s+(?:aku\s+|kami\s+|saya\s+)?(?:di\s*)?(?:nego\w*|kurang(?!\s+(?:dari|lebih))\w*|potong\w*|turun\w*|tawar\w*|murah(?:in|kan)|diskon\w*)|\bharga\s+(?:khusus|spesial|special|teman|temen|nego|miring)\b|\bbest\s*price\b|\b(?:diskon|potongan|korting|cashback)\w*|\b(?:di)?(?:kurangin|kurangi|turunin|turunkan|murahin|murahkan|diskonin)\b/gi;

/** "tidak", "belum", "gak" … just before an offer word turns it into a no. */
const NEGATED_BEFORE =
  /\b(?:tidak|tdk|gak|ga|gk|nggak|ngga|enggak|engga|ndak|belum|blm|bukan|tanpa)\b[^.?!\n]{0,12}$/i;

/** Does the reply offer a discount or invite a bargain? */
export function offersDiscount(message: string): boolean {
  for (const m of message.matchAll(DISCOUNT_OFFER)) {
    const before = message.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
    if (!NEGATED_BEFORE.test(before)) return true;
  }
  return false;
}

/**
 * "Tinggal 1 unit", "sisa 2", "only one left": a count of what is left
 * (2026-10-27, honest urgency). Captures the number.
 */
const SCARCITY =
  /\b(?:tinggal|sisa|cuma|hanya|tersisa|only)\s+(\d+|satu|dua|tiga|one|two|three)\s*(?:unit|pcs|biji|lagi|left)?\b|\blast\s+one\b/gi;
const NUMBER_WORD: Record<string, number> = {
  satu: 1,
  one: 1,
  dua: 2,
  two: 2,
  tiga: 3,
  three: 3,
};

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
/** A web address in a reply, without the punctuation that ends its sentence. */
const LINK_RE = /https?:\/\/\S+/gi;

export function linksIn(message: string): string[] {
  return (message.match(LINK_RE) ?? []).map((u) =>
    u.replace(/[.,!?;:)\]}'"]+$/, ""),
  );
}

/**
 * A link the reply sends that no lookup returned and no source quotes
 * (owner, 2026-10-28). A made-up Shopee address is a customer paying a
 * stranger, so it is refused like an invented price.
 */
function inventsLink(
  message: string,
  input: {
    readonly sourceTexts: readonly string[];
    readonly stockFacts?: readonly StockFact[];
  },
): boolean {
  const known = new Set((input.stockFacts ?? []).flatMap((f) => f.links ?? []));
  return linksIn(message).some(
    (url) => !known.has(url) && !input.sourceTexts.some((t) => t.includes(url)),
  );
}

export function checkReply(input: {
  readonly message: string;
  readonly sourceCount: number;
  readonly unknownSources: number;
  readonly sourceTexts: readonly string[];
  readonly stockFacts?: readonly StockFact[];
}): ReplyProblem | null {
  const raw = input.message.trim();
  if (raw === "") return "EMPTY";
  if (raw.length > MAX_REPLY_CHARS) return "TOO_LONG";
  if (input.unknownSources > 0) return "UNKNOWN_SOURCE";
  if (input.sourceCount === 0) return "NO_SOURCE";
  if (offersDiscount(raw)) return "DISCOUNT_OFFERED";
  if (inventsLink(raw, input)) return "LINK_INVENTED";
  // A link is vouched for above; its digits (".../976133661/…") are not a
  // price and its words are not a claim, so the rest reads the reply without it.
  const message = raw.replace(LINK_RE, " ");

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

  // "Tinggal 1 unit kak" — urgency, and only ever the shelf's own count
  // (2026-10-27). The units the sentence names (all of this turn's when it
  // names none) must ALL have exactly that many left; anything less certain
  // is an invented scarcity, which is the one kind of urgency the owner
  // ruled out.
  for (const sentence of sentences(message)) {
    for (const m of sentence.matchAll(SCARCITY)) {
      const raw = (m[1] ?? "1").toLowerCase();
      const n = NUMBER_WORD[raw] ?? Number(raw);
      const tokens = modelTokens(sentence);
      let named = tokens.length
        ? available.filter((f) => covers(f, tokens))
        : available;
      // "Air M2 8/256 tinggal 1": the configuration narrows it further.
      const specs = [
        ...sentence.matchAll(/\b(\d{1,2})\s*\/\s*(\d{3,4})\b/g),
      ].map((x) => `${x[1]}/${x[2]}`);
      if (specs.length) {
        const bySpec = named.filter((f) =>
          specs.some((sp) =>
            f.label.replace(/\s+/g, "").replace(/gb/gi, "").includes(sp),
          ),
        );
        if (bySpec.length) named = bySpec;
      }
      if (named.length === 0 || !named.every((f) => f.count === n))
        return "AVAILABILITY_NOT_IN_SOURCE";
    }
  }
  return null;
}

/**
 * A hand-over message is held to the strictest version of the same rule: it
 * cites nothing, so it may carry no figure and promise no stock.
 */
export function checkHoldingMessage(
  message: string,
  /**
   * Texts whose figures the line may repeat — the DP rule from the shop's
   * own settings (2026-10-27), a vouched source like an approved answer.
   */
  vouched: readonly string[] = [],
): ReplyProblem | null {
  return checkReply({
    message,
    sourceCount: 1,
    unknownSources: 0,
    sourceTexts: vouched,
  });
}

/** The DP rule as the bot says it — `sales.dpAmount` / `sales.dpDays`. */
export interface DpTerms {
  readonly amount: number;
  readonly days: number;
}

/** Rp500.000 for seven days — the owner's rule while nobody changed it. */
export const DEFAULT_DP_TERMS: DpTerms = { amount: 500_000, days: 7 };

/**
 * What the bot says when asked to keep a unit (owner, 2026-10-27): the DP and
 * how long it holds, from the settings, and that a person checks the
 * transfer. *"Untuk amankan unitnya bisa DP Rp 500rb kak, unit kami tahan 7
 * hari. Setelah transfer, kirim buktinya ya, tim kami cek dulu 🙏"*
 */
export function dpKeepLine(terms: DpTerms = DEFAULT_DP_TERMS): string {
  const n = terms.amount;
  const amount =
    n >= 1_000_000
      ? `Rp ${String(Math.round(n / 100_000) / 10).replace(".", ",")}jt`
      : `Rp ${Math.round(n / 1_000)}rb`;
  return `Untuk amankan unitnya bisa DP ${amount} kak, unit kami tahan ${terms.days} hari. Setelah transfer, kirim buktinya ya, tim kami cek dulu 🙏`;
}

// --- what the customer hears when a person takes over -----------------------

/**
 * The fallback hand-over lines, used when the model's own is refused or the
 * model is not reachable — and the rules bot's every hand-over.
 *
 * Rewritten 2026-10-27 (owner: *"saying that the admin will answer … the
 * reply so bad, not like human"*). The bot IS the shop's admin on WhatsApp,
 * so "Admin kami segera balas di chat ini" was the admin promising that the
 * admin would reply. Each line now says what is being checked and with whom,
 * the way it would be said at the counter — "Untuk nego harganya aku
 * tanyain ke owner dulu ya kak 🙏" — and the bot carries on answering
 * anything else meanwhile (`waitingTasks`). Outside opening hours the line
 * says when, because "bentar ya" at midnight is a promise nobody keeps.
 */
export function holdingMessage(
  topic: HandoffTopic,
  open: boolean,
  /** `routeMessage`'s rule, where the line depends on it (closing). */
  rule?: string,
  /** The DP rule for a keep (2026-10-27); the owner's default when absent. */
  dp?: DpTerms,
): string {
  // The owner's own default rule for a keep (2026-10-27): the DP and its
  // days come from the shop's settings, and a person checks the transfer.
  if (topic === "closing" && rule === "keep") return dpKeepLine(dp);
  const line =
    topic === "order_payment" && rule === "dp_proof"
      ? "Makasih kak, bukti DP-nya aku cek dulu ya 🙏"
      : HOLDING_LINE[topic];
  return open
    ? line
    : `${line} Toko lagi tutup, nanti aku kabari pas buka jam 10.00 ya.`;
}

/** One short line per topic, as the shop admin says it (2026-10-27). */
const HOLDING_LINE: Readonly<Record<HandoffTopic, string>> = {
  stock: "Bentar ya kak, unitnya aku cekin langsung dulu 🙏",
  unit_details: "Bentar ya kak, unitnya aku cekin langsung dulu 🙏",
  recommendation: "Bentar ya kak, aku cariin yang pas dulu 🙏",
  price: "Untuk harganya aku tanyain dulu ya kak 🙏",
  negotiation: "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
  reservation: "Jadwalnya aku bantu atur dulu ya kak 🙏",
  order_payment: "Makasih kak, buktinya aku cek dulu ya 🙏",
  trade_in: "Untuk taksiran harganya aku tanyain ke owner dulu ya kak 🙏",
  sell_to_shop: "Untuk taksiran harganya aku tanyain ke owner dulu ya kak 🙏",
  shipping_quote: "Ongkirnya aku cekin dulu ya kak 🙏",
  warranty_claim: "Waduh, maaf ya kak 🙏 Aku bantu cek dulu ya.",
  complaint: "Waduh, maaf ya kak 🙏 Aku bantu cek dulu ya.",
  media: "Sudah aku terima ya kak, aku lihat dulu 🙏",
  photos: "Fotonya aku siapin dulu ya kak 🙏",
  closing: "Siap kak, aku bantu prosesnya ya 🙏",
  human: "Siap kak, aku teruskan ke owner ya 🙏",
  other: "Bentar ya kak, aku cek dulu 🙏",
};

/**
 * Is this one of the bot's own fixed hand-over lines (`holdingMessage`, the
 * DP line, the closed-shop suffix)? /chat labels a reply by who wrote it, and
 * a hand-over row that staff later closed carries a staff id although the bot
 * wrote the line (2026-10-27: "Bentar ya kak, aku cek dulu 🙏" read as Staff).
 */
export function isHoldingLine(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t === "") return false;
  const lines = new Set<string>([
    ...Object.values(HOLDING_LINE),
    "Makasih kak, bukti DP-nya aku cek dulu ya 🙏",
    // rules/replies.ts `passedOnToo` — the short line once a customer was told.
    "Siap kak, yang ini sekalian aku tanyain ya 🙏",
    "Noted, I'll check that one too 🙏",
  ]);
  const base = t.replace(CLOSED_SUFFIX, "").trim();
  return (
    lines.has(base) ||
    /^Untuk amankan unitnya bisa DP Rp .+ tim kami cek dulu 🙏$/.test(base)
  );
}

const CLOSED_SUFFIX =
  / Toko lagi tutup, nanti aku kabari pas buka jam 10\.00 ya\.$/;

// --- what a person is left to do ---------------------------------------------

/** `ChatActionKind` in the schema, spelled here so this file stays Prisma-free. */
export type ChatActionKind =
  | "NEGOTIATION"
  | "PRICE"
  | "STOCK"
  | "RESERVATION"
  | "PHOTOS"
  | "OTHER"
  | "CLOSING";

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
    case "closing":
      return "CLOSING";
    default:
      return "OTHER";
  }
}
