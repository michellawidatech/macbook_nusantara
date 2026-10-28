/**
 * Reading a customer's message with rules, not a model (owner, 2026-10-15:
 * "if the process can be rule based or automated, do not use AI. Use AI only
 * to do something that the rule base cannot do").
 *
 * Pure: no database, no clock of its own, no network — a test feeds it a
 * sentence and a `now`. What it cannot read with confidence it says so
 * (`intent: "other"`), and the caller decides between the knowledge base, an
 * AI fallback and a person.
 *
 * The vocabulary is how this shop's customers actually write: Indonesian chat
 * spelling ("brp", "yg", "ga", "jt"), English where they use it, and the
 * shop's own product words. Money is read by `moneyAmounts`, the same
 * reader the reply checks and the negotiation offer use.
 */

import { asksToBuy, moneyAmounts } from "../policy.js";
import { STORE_HOURS } from "../hours.js";

export type RuleIntent =
  | "greeting"
  | "thanks"
  | "confirm"
  | "decline"
  | "ask_photo"
  | "reserve"
  | "ask_price"
  | "ask_stock"
  | "browse"
  /** "ok", "siap", "hmm" with nothing open: carry on asking. */
  | "ack"
  /** Only about themselves — "buat kuliah desain", "aku mahasiswa". */
  | "tell"
  | "other";

export interface Understanding {
  readonly language: "id" | "en";
  readonly intent: RuleIntent;
  /** What to search the shelf for, in the shop's words ("macbook air m2 256"). */
  readonly query: string | null;
  readonly budgetMin: number | null;
  readonly budgetMax: number | null;
  readonly serial: string | null;
  /** The name a booking should be under, as the customer gave it. */
  readonly name: string | null;
  /** A visit time, `YYYY-MM-DDTHH:MM` in Jakarta. */
  readonly when: string | null;
  /** "yang kedua", "nomor 3": which of the units last shown (0-based). */
  readonly pick: number | null;
  readonly usage: readonly string[];
  readonly apps: readonly string[];
  readonly preferences: readonly string[];
  readonly occupation: string | null;
  /**
   * Ready to buy, asking to keep a unit (a DP) or how to pay (2026-10-27):
   * the strongest lead signal there is. `routeMessage` sends it to a person.
   */
  readonly buying: boolean;
}

const norm = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[“”"’']/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

// --- intent words ------------------------------------------------------------

const GREETING_ONLY =
  /^\s*((halo+|hallo+|hai+|hi+|hello+|helo+|hey|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|permisi|assalamu.?alaikum|salam|p+|min|kak|gan|sis|bro|admin|mas|mbak|om)[\s,.!?]*)+$/i;
const THANKS =
  /\b(makasih|makasi|terima ?kasih|trims|thx|thanks|thank you|tq|ty|nuhun|matur nuwun)\b/i;
const CONFIRM =
  /^\s*(iya|iyaa+|ya|yaa+|yes|yup|betul|bener|benar|ok|oke|okay|okey|siap|boleh|jadi|deal|setuju|sip|mantap|fix|gas|lanjut|confirm|konfirmasi)\b/i;
const DECLINE =
  /\b(ga jadi|gak jadi|nggak jadi|enggak jadi|tidak jadi|batal|cancel|nanti dulu|ga dulu|gak dulu|no thanks|tidak usah|ga usah|gak usah)\b|^\s*(tidak|nggak|enggak|ngga|gak|ga|no)\b/i;
const PHOTO =
  /\b(foto|fotonya|poto|gambar|pict|pic|pics|picture|photo|video|vidio|liat (unit|barang)nya)\b/i;
// A VISIT, never a hold (2026-10-27): "tahan" and "keep" ask the shop to put
// a unit aside, which is a DP and a person's job (policy.ts KEEP).
const RESERVE =
  /\b(booking|book|booked|janji ?datang|janjian|reservasi|reserve|ke toko|ketoko|datang|dateng|mampir|lihat langsung|liat langsung|cek langsung|cek unit|visit|ambil di toko|ambil ke toko)\b/i;
/** A word about price itself — not "berapa", which also asks how long. */
const PRICE_WORD = /\b(harga|harganya|kisaran|price|how much|biaya)\b/i;
// Texting slang too (owner's chat 2026-10-28: "rata rata harga brpan si kak").
const PRICE =
  /\b(harga|harganya|berapa(an)?|brp(an)?|brapa(an)?|brpa|kisaran|price|how much|biaya)\b/i;
const STOCK =
  /\b(ada|ready|redi|stok|stock|stoknya|tersedia|available|jual|unit apa|masih ada)\b/i;
const BROWSE =
  /\b(rekomen|rekomendasi|rekomendasiin|saran|sarankan|cocok|bagus(nya)?|yang mana|recommend|suggest|pilihan|opsi|option)\b/i;
const BUDGET_WORDS =
  /\b(budget|bujet|budjet|dana|duit|uang|kisaran|sekitar|range|di ?bawah|dibawah|maks|max|maksimal|kurang dari|under|below|di ?atas|minimal|min)\b/i;

// --- product words -------------------------------------------------------------

const FAMILY: ReadonlyArray<[RegExp, string]> = [
  [/\b(mbp|macbook ?pro|mac ?book ?pro)\b/, "macbook pro"],
  [/\b(mba|macbook ?air|mac ?book ?air)\b/, "macbook air"],
  [/\bimac\b/, "imac"],
  [/\bmac ?mini\b/, "mac mini"],
  [/\bmac ?studio\b/, "mac studio"],
  [/\bipad\b/, "ipad"],
  [/\biphone\b/, "iphone"],
  [/\b(apple ?)?watch\b/, "watch"],
  [/\bairpods?\b/, "airpods"],
  [/\bmacbook\b/, "macbook"],
];
const BARE_FAMILY: ReadonlyArray<[RegExp, string]> = [
  [/\bair\b/, "air"],
  [/\bpro\b/, "pro"],
];
const CHIP = /\b(m[1-5])( ?(pro|max|ultra))?\b|\b(i[3579])\b/g;
// Not the RAM of "16/512" — a size is never followed by a slash.
const SIZE = /\b(11|12|13|14|15|16|24|27)( ?(inch|inci|in|"))?\b(?!\s*\/)/g;
const SPEC =
  /\b(\d{1,2}) ?\/ ?(\d{3,4}|[12] ?tb)\b|\b(\d{3,4}) ?gb\b|\b([12]) ?tb\b/g;
const YEAR = /\b(20(1[5-9]|2[0-6]))\b/g;
const SERIAL = /\b(s?[a-z0-9]{10,12})\b/gi;

/** Does a token look like an Apple serial rather than a word? */
const looksLikeSerial = (t: string) =>
  /\d/.test(t) && /[a-z]/i.test(t) && !/^m[1-5]/i.test(t) && !/gb|tb/i.test(t);

interface ProductParts {
  readonly family: string | null;
  readonly chips: readonly string[];
  readonly sizes: readonly string[];
  readonly specs: readonly string[];
  readonly years: readonly string[];
}

function productParts(t: string): ProductParts {
  let family = FAMILY.find(([re]) => re.test(t))?.[1] ?? null;
  if (!family) family = BARE_FAMILY.find(([re]) => re.test(t))?.[1] ?? null;
  const chips = [...t.matchAll(CHIP)].map(
    (m) => (m[1] ?? m[4]!) + (m[3] ? ` ${m[3]}` : ""),
  );
  // A size only means something next to a family; "16" alone is a RAM figure.
  const sizes = family ? [...t.matchAll(SIZE)].map((m) => m[1]!) : [];
  const specs = [...t.matchAll(SPEC)].map((m) =>
    m[1] && m[2]
      ? `${m[1]}/${m[2].replace(/\s/g, "")}`
      : (m[3] ?? `${m[4]}tb`)!.replace(/\s/g, ""),
  );
  const years = [...t.matchAll(YEAR)].map((m) => m[1]!);
  return { family, chips, sizes, specs, years };
}

function productQuery(t: string): string | null {
  const p = productParts(t);
  const parts = [
    ...(p.family ? [p.family] : []),
    ...p.chips,
    ...p.sizes,
    ...p.specs,
    ...p.years,
  ];
  const q = [...new Set(parts)].join(" ").trim();
  return q || null;
}

const FAMILY_LABEL: Record<string, string> = {
  "macbook pro": "MacBook Pro",
  "macbook air": "MacBook Air",
  imac: "iMac",
  "mac mini": "Mac mini",
  "mac studio": "Mac Studio",
  ipad: "iPad",
  iphone: "iPhone",
  watch: "Apple Watch",
  airpods: "AirPods",
  macbook: "MacBook",
  air: "Air",
  pro: "Pro",
};

/**
 * The unit a message names, the way the shop writes one for a colleague —
 * `Air 15" M2 8/256` — or null when it names none. For the one-line task a
 * hand-over leaves (tasks.ts); nothing is searched with it.
 */
export function productLabelOf(text: string): string | null {
  const p = productParts(norm(text));
  const chip = (c: string) =>
    c
      .replace(/^m(\d)/, "M$1")
      .replace(
        / (pro|max|ultra)$/,
        (_, w: string) => ` ${w[0]!.toUpperCase()}${w.slice(1)}`,
      );
  const spec = (s: string) =>
    /^\d{3,4}$/.test(s)
      ? `${s}GB`
      : s.replace(/(gb|tb)$/, (u) => u.toUpperCase());
  const parts = [
    ...(p.family ? [FAMILY_LABEL[p.family] ?? p.family] : []),
    ...[...new Set(p.sizes)].map((n) => `${n}"`),
    ...[...new Set(p.chips)].map(chip),
    ...[...new Set(p.specs)].map(spec),
    ...[...new Set(p.years)],
  ];
  return parts.length > 0 ? parts.join(" ") : null;
}

// --- budget ---------------------------------------------------------------------

function budgetOf(
  t: string,
  hasProductOrBudgetWord: boolean,
): { min: number | null; max: number | null } {
  // "12-15jt", "10 sampai 12 juta": the unit after the second figure is the
  // unit of both.
  const shorthand =
    /\b(\d+(?:[.,]\d+)?)\s*(?:-|–|sampai|sampe|s\/d|hingga|to)\s*(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu)\b/.exec(
      t,
    );
  if (shorthand) {
    const scale = shorthand[3]!.startsWith("j") ? 1_000_000 : 1_000;
    const a = Math.round(Number(shorthand[1]!.replace(",", ".")) * scale);
    const b = Math.round(Number(shorthand[2]!.replace(",", ".")) * scale);
    if (a > 0 && b > 0) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const figures = moneyAmounts(t).filter(
    (v) => v >= 500_000 && v < 500_000_000,
  );
  if (figures.length === 0) return { min: null, max: null };
  // Bare digits with nothing around them are a serial or a spec, not money.
  if (!hasProductOrBudgetWord && !/\b(jt|juta|rb|ribu|rp)\b/.test(t))
    return { min: null, max: null };
  if (figures.length >= 2 && /(-|sampai|sampe|s\/d|hingga|to|antara)/.test(t)) {
    const [a, b] = [Math.min(...figures), Math.max(...figures)];
    return { min: a, max: b };
  }
  const v = figures[0]!;
  if (
    /\b(di ?bawah|dibawah|maks|max|maksimal|kurang dari|under|below|<)/.test(t)
  )
    return { min: null, max: v };
  if (/\b(di ?atas|minimal|min|lebih dari|above|over)\b/.test(t))
    return { min: v, max: null };
  // "budget 15jt", "15jtan", "sekitar 15 juta": about that much.
  return { min: v, max: v };
}

// --- a visit time ------------------------------------------------------------

const DAYS: Record<string, number> = {
  minggu: 0,
  ahad: 0,
  sunday: 0,
  senin: 1,
  monday: 1,
  selasa: 2,
  tuesday: 2,
  rabu: 3,
  wednesday: 3,
  kamis: 4,
  thursday: 4,
  jumat: 5,
  "jum'at": 5,
  friday: 5,
  sabtu: 6,
  saturday: 6,
};

/** Today's date in Jakarta as [y, m, d] and its weekday. */
function jakartaParts(now: Date): {
  y: number;
  m: number;
  d: number;
  dow: number;
} {
  const local = new Date(now.getTime() + 7 * 3_600_000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A date `days` after Jakarta's today, as YYYY-MM-DD. */
function plusDays(now: Date, days: number): string {
  const { y, m, d } = jakartaParts(now);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function visitTimeOf(text: string, now: Date): string | null {
  const t = norm(text);
  const clock =
    /\b(?:jam|pukul|pkl|at)\s*(\d{1,2})(?:[.:](\d{2}))?\b(?:\s*(pagi|siang|sore|malam|pm|am))?|\b(\d{1,2})[.:](\d{2})\b/.exec(
      t,
    );
  if (!clock) return null;
  let hour = Number(clock[1] ?? clock[4]);
  const minute = Number(clock[2] ?? clock[5] ?? 0);
  const part = clock[3];
  if (
    part === "pm" ||
    part === "sore" ||
    part === "malam" ||
    (part === "siang" && hour < 11)
  )
    hour = hour < 12 ? hour + 12 : hour;
  // "jam 2" at a shop that opens at ten means the afternoon.
  if (!part && hour < STORE_HOURS.openHour && hour + 12 < STORE_HOURS.closeHour)
    hour += 12;
  if (hour > 23 || minute > 59) return null;

  let date: string | null = null;
  if (/\b(lusa)\b/.test(t)) date = plusDays(now, 2);
  else if (/\b(besok|besuk|bsk|tomorrow)\b/.test(t)) date = plusDays(now, 1);
  else if (/\b(hari ini|nanti|today|sekarang)\b/.test(t))
    date = plusDays(now, 0);
  if (!date) {
    const day = Object.keys(DAYS).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    if (day) {
      const ahead = (DAYS[day]! - jakartaParts(now).dow + 7) % 7 || 7;
      date = plusDays(now, ahead);
    }
  }
  if (!date) {
    const dm = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(t);
    if (dm) {
      const { y } = jakartaParts(now);
      const year = dm[3]
        ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3])
        : y;
      date = `${year}-${pad(Number(dm[2]))}-${pad(Number(dm[1]))}`;
    }
  }
  if (!date) date = plusDays(now, 0);
  return `${date}T${pad(hour)}:${pad(minute)}`;
}

// --- a name ---------------------------------------------------------------------

const NAME =
  /\b(?:nama(?:ku| saya| aku| gw| gue)?|atas nama|a\.?n\.?|my name is|i am|i'm|saya|aku)\s*:?\s+([a-z][a-z.']{1,20}(?: [a-z][a-z.']{1,20}){0,2})/i;
const NOT_A_NAME =
  /^(mau|ingin|pengen|pingin|cari|lagi|sudah|udah|bisa|tanya|ke|di|dari|jam|besok|lusa|hari|yang|nya|ok|oke|iya|ya|tertarik|butuh|perlu|dateng|datang|ambil|mahasiswa|kerja|pakai|pake|transfer|tf|bayar|dp|kirim|beli|order|pesan|nanti|coba)\b/i;

export function nameOf(text: string): string | null {
  // Every candidate, not the first: "saya ke toko, atas nama Budi" has a
  // "saya" that introduces a verb before the "atas nama" that names someone.
  const all = new RegExp(NAME.source, "gi");
  for (const m of text.matchAll(all)) {
    const name = m[1]!
      .split(/\s+(jam|besok|lusa|hari|ya|kak|mau|untuk|buat|ke)\b/i)[0]!
      .trim();
    if (!name || NOT_A_NAME.test(name)) continue;
    return name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
  }
  return null;
}

// --- what the customer said about themselves -------------------------------------

const APPS: ReadonlyArray<[RegExp, string]> = [
  [/\b(vs ?code|visual studio code)\b/, "VS Code"],
  [/\bxcode\b/, "Xcode"],
  [/\bandroid studio\b/, "Android Studio"],
  [/\b(photoshop|ps)\b/, "Photoshop"],
  [/\b(illustrator|ai)\b(?! (model|ml))/, "Illustrator"],
  [/\b(premiere|premier)( pro)?\b/, "Premiere Pro"],
  [/\b(after ?effects?|ae)\b/, "After Effects"],
  [/\blightroom\b/, "Lightroom"],
  [/\bfigma\b/, "Figma"],
  [/\bcanva\b/, "Canva"],
  [/\bfinal ?cut( pro)?\b/, "Final Cut Pro"],
  [/\bdavinci( resolve)?\b/, "DaVinci Resolve"],
  [/\bcap ?cut\b/, "CapCut"],
  [/\blogic( pro)?\b/, "Logic Pro"],
  [/\bfl ?studio\b/, "FL Studio"],
  [/\bablet?on\b/, "Ableton"],
  [/\b(autocad|auto cad)\b/, "AutoCAD"],
  [/\bsketchup\b/, "SketchUp"],
  [/\bblender\b/, "Blender"],
  [/\bunity\b/, "Unity"],
  [/\bunreal\b/, "Unreal Engine"],
  [/\b(excel|ms excel)\b/, "Excel"],
  [/\b(word|ms word)\b/, "Word"],
  [/\b(powerpoint|ppt)\b/, "PowerPoint"],
  [/\b(docker)\b/, "Docker"],
  [/\b(spss)\b/, "SPSS"],
  [/\b(matlab)\b/, "MATLAB"],
  [/\b(zoom|teams|google meet)\b/, "Video calls"],
];

const USAGE: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(coding|ngoding|programming|program|programmer|developer|dev|koding|ngoding)\b/,
    "programming",
  ],
  [/\b(design|desain|desainer|designer|ui ?ux|grafis)\b/, "design"],
  [
    /\b(edit(ing)? video|video editing|ngedit video|editing|youtube|konten|content)\b/,
    "video editing",
  ],
  [/\b(foto(grafi)?|photography|edit foto)\b/, "photo editing"],
  [/\b(musik|music|produksi musik|recording)\b/, "music"],
  [
    /\b(kuliah|kampus|skripsi|tugas|sekolah|belajar|study|college|school|mahasiswa|mahasiswi|mhs|pelajar|siswa)\b/,
    "school",
  ],
  [/\b(kantor|kerja|office|admin|ngetik|laporan|presentasi)\b/, "office"],
  // "Buat nyatet aja sih" (owner's chat, 2026-10-27) was read as nothing.
  [
    /\b(nyatet|nyatat|catat|nyatet2|catatan|mencatat|notes?|note ?taking|nulis|menulis)\b/,
    "note-taking",
  ],
  [
    /\b(browsing|nonton|streaming|netflix|sosmed|sosial media|social media|sehari-?hari|daily)\b/,
    "everyday use",
  ],
  [/\b(gaming|game|main game)\b/, "gaming"],
  [
    /\b(machine learning|deep learning|ml|ai model|data science|training model)\b/,
    "data science / ML",
  ],
  [/\b(arsitek|architecture|3d|render(ing)?)\b/, "3D / architecture"],
];

const PREFERENCES: ReadonlyArray<[RegExp, string]> = [
  [/\b(baru|new|segel|sealed|bnib)\b/, "new"],
  [/\b(second|bekas|seken|preloved|used)\b/, "second-hand"],
  [/\b(ringan|enteng|light|tipis)\b/, "light"],
  [/\b(13|13\.3|13,3) ?(inch|inci|")\b/, "13 inch"],
  [/\b(14|14\.2) ?(inch|inci|")\b/, "14 inch"],
  [/\b(15|15\.3) ?(inch|inci|")\b/, "15 inch"],
  [/\b(16|16\.2) ?(inch|inci|")\b/, "16 inch"],
  [/\b(silver|perak)\b/, "silver"],
  [/\b(space ?gr[ae]y|abu)\b/, "space grey"],
  [/\b(midnight|hitam|black)\b/, "midnight"],
  [/\b(starlight|gold|emas)\b/, "starlight/gold"],
  [/\b(baterai|batre|battery) (bagus|awet|sehat|tahan lama)\b/, "good battery"],
  [/\b(garansi|warranty)\b/, "warranty"],
];

const OCCUPATION: ReadonlyArray<[RegExp, string]> = [
  [/\b(mahasiswa|mahasiswi|mhs|anak kuliah|kuliah)\b/, "student (university)"],
  [/\b(pelajar|siswa|anak sma|anak smk|sma|smk)\b/, "student (school)"],
  [/\b(programmer|developer|software engineer|dev)\b/, "programmer"],
  [/\b(desainer|designer)\b/, "designer"],
  [
    /\b(editor|videografer|videographer|content creator|youtuber|konten kreator)\b/,
    "content creator",
  ],
  [/\b(fotografer|photographer)\b/, "photographer"],
  [/\b(guru|dosen|teacher|lecturer)\b/, "teacher"],
  [/\b(karyawan|kerja kantoran|pegawai|office worker)\b/, "office worker"],
  [/\b(arsitek|architect)\b/, "architect"],
];

const collect = (t: string, table: ReadonlyArray<[RegExp, string]>) => [
  ...new Set(table.filter(([re]) => re.test(t)).map(([, v]) => v)),
];

const PICK =
  /\b(?:yang|yg|nomor|no\.?|nomer|#)\s*(pertama|kedua|ketiga|1|2|3)\b|\b(first|second|third) one\b/i;
const PICK_WORDS: Record<string, number> = {
  pertama: 0,
  "1": 0,
  first: 0,
  kedua: 1,
  "2": 1,
  second: 1,
  ketiga: 2,
  "3": 2,
  third: 2,
};

const QUESTION =
  /\?|\b(berapa(an)?|brp(an)?|brapa(an)?|brpa|kisaran|apa|apakah|bisa|gimana|gmn|bagaimana|kapan|dimana|di mana|kenapa|mengapa|how|what|when|where|why|can|does|do you|is it)\b/i;

const EN =
  /\b(do you|is there|how much|i want|i need|please|price|available|can i|what|which|hello|hi there|thanks|thank you)\b/i;
const ID =
  /\b(ada|berapa|kak|min|mau|ya|yg|yang|gak|ga|nggak|bisa|dong|nya|kah|apa|aku|saya)\b/i;

/** Does the message ask something ("?", "berapa", "bisa", "gimana"…)? */
export function isQuestion(text: string): boolean {
  return QUESTION.test(norm(text));
}

/** A plain yes: "iya", "boleh", "mau kak", "ok" (2026-10-27). */
export function saysYes(text: string): boolean {
  const t = norm(text);
  return (
    (CONFIRM.test(t) || /^\s*(mau|boleh|bisa|please|sure)\b/i.test(t)) &&
    !DECLINE.test(t.replace(CONFIRM, ""))
  );
}

/** A plain no: "ga usah", "nanti dulu", "tidak jadi" (2026-10-27). */
export function saysNo(text: string): boolean {
  return DECLINE.test(norm(text));
}

export function understand(
  text: string,
  now: Date,
  ctx: {
    readonly proposalOpen: boolean;
    readonly lastShown: readonly string[];
  },
): Understanding {
  const t = norm(text);
  const language = EN.test(t) && !ID.test(t) ? "en" : "id";
  const query = productQuery(t);
  const budgetWord = BUDGET_WORDS.test(t);
  // "15 jutaan", "12 juta-an": about that much (2026-10-27 — read as nothing
  // before, so a budget given in answer to the bot's question was lost).
  const { min, max } = budgetOf(
    t.replace(/(\d)\s*(?:jt|juta)\s*-?\s*an\b/g, "$1 juta"),
    Boolean(query) || budgetWord,
  );
  const serials = [...t.matchAll(SERIAL)]
    .map((m) => m[1]!.toUpperCase())
    .filter(looksLikeSerial);
  const serial = serials[0] ?? null;
  const pickM = PICK.exec(t);
  const pick = pickM
    ? (PICK_WORDS[(pickM[1] ?? pickM[2] ?? "").toLowerCase()] ?? null)
    : null;
  const when = visitTimeOf(t, now);
  const name = nameOf(text);

  let intent: RuleIntent = "other";
  if (
    ctx.proposalOpen &&
    CONFIRM.test(t) &&
    !DECLINE.test(t.replace(CONFIRM, ""))
  )
    intent = "confirm";
  else if (ctx.proposalOpen && DECLINE.test(t)) intent = "decline";
  else if (PHOTO.test(t)) intent = "ask_photo";
  else if (
    RESERVE.test(t) ||
    (when !== null &&
      (name !== null || ctx.lastShown.length > 0) &&
      !PRICE.test(t))
  )
    intent = "reserve";
  else if (
    PRICE.test(t) &&
    (query || serial || pick !== null || ctx.lastShown.length > 0)
  )
    intent = "ask_price";
  else if (BROWSE.test(t) || min !== null || max !== null)
    intent = query ? "ask_stock" : "browse";
  // "rata-rata harganya berapa?" — a price question about nothing in
  // particular (2026-10-28): answered with the shelf's range, never read as
  // an answer to the bot's own question.
  else if (PRICE_WORD.test(t) && QUESTION.test(t)) intent = "ask_price";
  else if (
    (STOCK.test(t) && (query || serial)) ||
    (query && t.trim().split(" ").length <= 6)
  )
    intent = "ask_stock";
  else if (GREETING_ONLY.test(t.trim())) intent = "greeting";
  else if (THANKS.test(t) && t.trim().split(" ").length <= 6) intent = "thanks";
  else if (CONFIRM.test(t) && t.trim().split(" ").length <= 4) intent = "ack";

  const usage = collect(t, USAGE);
  const apps = collect(t, APPS);
  const preferences = collect(t, PREFERENCES);
  const occupation = collect(t, OCCUPATION)[0] ?? null;
  // Nothing else asked, but they told us about themselves: that is an answer
  // to the bot's question, not a question for a person.
  // A QUESTION that mentions one ("garansinya berapa lama?") is still a
  // question — its facts are saved, and the knowledge base or a person
  // answers it.
  if (
    intent === "other" &&
    !QUESTION.test(t) &&
    (usage.length || apps.length || preferences.length || occupation || name)
  )
    intent = "tell";

  return {
    language,
    intent,
    query,
    budgetMin: min,
    budgetMax: max,
    serial,
    name,
    when,
    pick,
    usage,
    apps,
    preferences,
    occupation,
    buying: asksToBuy(text),
  };
}

// --- an answer to the bot's own question ---------------------------------------

/**
 * The bot's own discovery questions (replies.ts `QUESTIONS`, and the AI's
 * versions of them): what it is for, the budget, new or second, the screen,
 * the apps.
 */
const ASKED_ABOUT_THEM =
  /\b(buat apa|untuk apa|dipakai buat|dipake buat|dipakai untuk|keperluan|kebutuhan(nya)?|budget(nya)?|bajet|kisaran|baru atau second|ukuran layar|layar 13|aplikasi(nya)?|use it for|budget|spend|preferences?|screen size|which apps)\b/i;

/** Did the bot's last reply ask about the customer's needs? */
export function askedAboutThem(lastReply: string | null | undefined): boolean {
  const r = lastReply ?? "";
  return r.includes("?") && ASKED_ABOUT_THEM.test(r);
}

/**
 * Is this message only the customer telling the bot about themselves — what
 * it is for, a budget, what they like — typically in answer to the bot's own
 * question (owner report 2026-10-27: "Buat nyatet aja sih" and "Kuliah" were
 * both handed to a colleague as "Not in the answers")? Such a message is
 * saved and answered — a recommendation or the next question — and is never a
 * hand-over.
 *
 * A QUESTION is not one ("garansinya berapa lama?"), whatever it mentions.
 * Pure.
 */
export function answersOwnQuestion(
  text: string,
  now: Date,
  lastReply: string | null = null,
): boolean {
  const t = norm(text);
  if (t.trim() === "" || QUESTION.test(t)) return false;
  const u = understand(text, now, { proposalOpen: false, lastShown: [] });
  if (u.buying) return false;
  if (u.intent === "tell") return true;
  // A budget on its own: "15 jutaan", "di bawah 12jt".
  if (
    u.intent === "browse" &&
    !u.query &&
    (u.budgetMin !== null || u.budgetMax !== null)
  )
    return true;
  // A short answer right after the bot asked about them, in words no table
  // here knows ("buat bisnis online").
  return (
    u.intent === "other" &&
    askedAboutThem(lastReply) &&
    t.trim().split(" ").length <= 8
  );
}

/**
 * What a message says about the customer, as `remember_customer`'s
 * arguments — the rules bot's reading, shared with the AI path so an answer
 * to the bot's question is saved by code whatever the model does with it.
 * `lastReply` lets a short answer to "buat apa?" in words no table knows be
 * kept as the use case itself.
 */
export function profileFactsOf(
  u: Understanding,
  text?: string,
  lastReply: string | null = null,
): Record<string, string | number> {
  const facts: Record<string, string | number> = {};
  if (u.name) facts["name"] = u.name;
  if (u.budgetMin !== null) facts["budget_min"] = u.budgetMin;
  if (u.budgetMax !== null) facts["budget_max"] = u.budgetMax;
  if (u.usage.length) facts["usage"] = u.usage.join(", ");
  if (u.apps.length) facts["apps"] = u.apps.join(", ");
  if (u.preferences.length) facts["preferences"] = u.preferences.join(", ");
  if (u.occupation) {
    facts["occupation"] = u.occupation;
    // An estimate, and labelled one on the screen: a student is a student.
    if (u.occupation === "student (university)")
      facts["age_estimate"] = "18-24";
    if (u.occupation === "student (school)") facts["age_estimate"] = "15-18";
  }
  const said = text?.replace(/\s+/g, " ").trim() ?? "";
  if (
    Object.keys(facts).length === 0 &&
    said !== "" &&
    u.intent === "other" &&
    !QUESTION.test(norm(said)) &&
    /\b(buat apa|untuk apa|dipakai|dipake|keperluan|kebutuhan|use it for)\b/i.test(
      lastReply ?? "",
    )
  )
    facts["use_case"] = said.slice(0, 160);
  return facts;
}
