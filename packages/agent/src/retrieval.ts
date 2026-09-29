/**
 * Finding the shop's approved answer for what a customer typed — the
 * "documents" half of the chatbot's retrieval (docs/chatbot-rag.md).
 *
 * The knowledge base is the owner's answer sheet (`AgentKnowledge`): a few
 * dozen question/answer pairs, written in the shop's voice. Customers do not
 * type the owner's questions. They type "co dari shopee bs ambil di toko ga
 * kak", "garansinya brp lama", "jam oprasional ka". So the match is made on a
 * NORMALISED form of both sides:
 *
 *  1. lower-case, accents and emoji and punctuation gone;
 *  2. multi-word terms joined first ("tukar tambah" → `tukartambah`,
 *     "battery health" → `baterai`), so a phrase is one token;
 *  3. chat spelling mapped to one canonical word ("brp" → `berapa`, "tokped"
 *     → `tokopedia`, "oprasional" → `operasional`);
 *  4. the particles Indonesian glues onto words taken off ("garansinya" →
 *     `garansi`, "bisakah" → `bisa`);
 *  5. the words every message carries dropped ("kak", "ya", "bisa", "ga").
 *
 * Then Okapi BM25 ranks the entries, with the question counted twice as heavily
 * as the answer — the question is what the owner expected people to ask. A
 * word the knowledge base has never seen gets one chance at a near spelling
 * (one letter off), at a discount.
 *
 * Why not embeddings: the base is tens of entries in one language, the
 * vocabulary that matters is small and known, and every decision here is a
 * line somebody can read and a test can pin. A vector store would need a
 * provider, a column type and a migration to answer the same questions with
 * less explanation. `rankKnowledge` is the seam if that ever changes.
 *
 * Pure: no database, no clock.
 */

export interface KnowledgeDoc {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface RankedDoc<T extends KnowledgeDoc = KnowledgeDoc> {
  readonly doc: T;
  readonly score: number;
  /** The query's normalised words that this entry matched. */
  readonly matched: readonly string[];
  /**
   * The share of the query's words found in the entry's QUESTION, 0 to 1.
   * Unlike the BM25 score it does not depend on how many entries there are,
   * so it still means something in a knowledge base of three.
   */
  readonly coverage: number;
}

/** Multi-word terms, joined before the text is split into words. */
const PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\btukar\s*tambah\b|\btrade\s*-?\s*in\b|\btuker\s*tambah\b/g,
    " tukartambah ",
  ],
  [/\bprice\s*-?\s*list\b|\bdaftar\s*harga\b/g, " pricelist "],
  [/\bsplit\s*-?\s*(payment|bayar|pembayaran)\b/g, " split "],
  [/\bpre\s*-?\s*order\b/g, " preorder "],
  [/\bhuman\s*error\b/g, " humanerror "],
  [/\bfull\s*-?\s*set\b/g, " fullset "],
  [/\bbatt?e?ry\s*health\b|\bbattery\s*helath\b/g, " baterai "],
  [/\bcycle\s*count\b/g, " siklus "],
  [/\bcheck\s*-?\s*out\b/g, " checkout "],
  [/\bluar\s*kota\b/g, " luarkota "],
  [/\bjam\s*(buka|operasional|oprasional|kerja|tutup)\b/g, " operasional "],
  [/\bsame\s*-?\s*day\b/g, " instan "],
  [/\bkartu\s*kredit\b|\bcredit\s*card\b/g, " cicilan "],
  [/\bspare\s*-?\s*part\b/g, " sparepart "],
  [/\bgoogle\s*maps?\b/g, " lokasi "],
  [/\bambil\s*(di|ke)\s*toko\b|\bpick\s*-?\s*up\b/g, " ambiltoko "],
];

/** Chat spelling → the one word the knowledge base uses. */
const CANONICAL: Readonly<Record<string, string>> = {
  gak: "tidak",
  ga: "tidak",
  nggak: "tidak",
  ngga: "tidak",
  enggak: "tidak",
  engga: "tidak",
  gk: "tidak",
  tdk: "tidak",
  nda: "tidak",
  ndak: "tidak",
  bs: "bisa",
  bsa: "bisa",
  bisaa: "bisa",
  brp: "berapa",
  brapa: "berapa",
  brpa: "berapa",
  yg: "yang",
  dgn: "dengan",
  dg: "dengan",
  utk: "untuk",
  tp: "tapi",
  kalo: "kalau",
  klo: "kalau",
  kl: "kalau",
  gmn: "gimana",
  gmna: "gimana",
  bagaimana: "gimana",
  apk: "aplikasi",
  app: "aplikasi",
  apps: "aplikasi",
  software: "aplikasi",
  install: "instal",
  instalasi: "instal",
  installin: "instal",
  instalin: "instal",
  tokped: "tokopedia",
  toped: "tokopedia",
  co: "checkout",
  ongkos: "ongkir",
  cicil: "cicilan",
  nyicil: "cicilan",
  kredit: "cicilan",
  tenor: "cicilan",
  angsuran: "cicilan",
  paylater: "cicilan",
  warranty: "garansi",
  servis: "service",
  perbaikan: "service",
  benerin: "service",
  reparasi: "service",
  aksesori: "aksesoris",
  accessories: "aksesoris",
  accessory: "aksesoris",
  free: "gratis",
  bonus: "gratis",
  alamat: "lokasi",
  maps: "lokasi",
  map: "lokasi",
  dimana: "lokasi",
  share: "lokasi",
  buka: "operasional",
  oprasional: "operasional",
  operational: "operasional",
  pengiriman: "kirim",
  dikirim: "kirim",
  ngirim: "kirim",
  ekspedisi: "kirim",
  shipping: "kirim",
  jne: "kirim",
  jnt: "kirim",
  sicepat: "kirim",
  anteraja: "kirim",
  paket: "kirim",
  instant: "instan",
  gosend: "instan",
  grabexpress: "instan",
  lalamove: "instan",
  gojek: "kurir",
  grab: "kurir",
  driver: "kurir",
  insurance: "asuransi",
  lost: "hilang",
  kelengkapan: "kelengkapan",
  lengkap: "kelengkapan",
  dus: "box",
  dusbox: "box",
  kotak: "box",
  cas: "charger",
  casan: "charger",
  adaptor: "charger",
  lecet: "minus",
  dent: "minus",
  cacat: "minus",
  kekurangan: "minus",
  baret: "minus",
  penyok: "minus",
  part: "sparepart",
  parts: "sparepart",
  tt: "tukartambah",
  tradein: "tukartambah",
  po: "preorder",
  inden: "preorder",
  negosiasi: "nego",
  nett: "net",
  splitpayment: "split",
  stock: "stok",
  redi: "ready",
  price: "harga",
  hrg: "harga",
  bh: "baterai",
  battery: "baterai",
  batre: "baterai",
  batere: "baterai",
  batterai: "baterai",
  siklus: "siklus",
  cycle: "siklus",
  jabodetabek: "jabodetabek",
  jakarta: "jabodetabek",
};

/** Words that carry no signal: address, particles, and what every question says. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "kak",
  "ka",
  "kakak",
  "kk",
  "min",
  "gan",
  "sis",
  "bang",
  "bro",
  "om",
  "mas",
  "mbak",
  "mba",
  "bu",
  "pak",
  "ya",
  "yah",
  "yaa",
  "yak",
  "dong",
  "deh",
  "sih",
  "nih",
  "tuh",
  "aja",
  "saja",
  "ini",
  "itu",
  "yang",
  "dan",
  "atau",
  "di",
  "ke",
  "dari",
  "ada",
  "apa",
  "apakah",
  "bisa",
  "tidak",
  "untuk",
  "buat",
  "mau",
  "saya",
  "aku",
  "gw",
  "gue",
  "sy",
  "kita",
  "kami",
  "kalau",
  "gimana",
  "juga",
  "jg",
  "udah",
  "sudah",
  "sdh",
  "belum",
  "blm",
  "lagi",
  "dengan",
  "sama",
  "oke",
  "ok",
  "halo",
  "hallo",
  "hai",
  "hi",
  "permisi",
  "selamat",
  "pagi",
  "siang",
  "sore",
  "malam",
  "terima",
  "kasih",
  "makasih",
  "thanks",
  "thx",
  "the",
  "is",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "do",
  "you",
  "can",
  "i",
  "my",
  "it",
  "in",
  "tanya",
  "nanya",
  "mo",
  "tau",
  "tahu",
  "boleh",
  "kah",
  "lah",
  "pun",
  "nya",
  "gitu",
  "begitu",
  "seperti",
  "kayak",
  "kaya",
  "macbook",
  "mac",
  "laptop",
  "unit",
  "unitnya",
  "toko",
  "kan",
  "tapi",
  "karena",
  "biar",
  "bgt",
  "banget",
]);

/** Glued-on particles, longest first. Only taken off a word that stays long. */
const SUFFIXES = ["nya", "kah", "lah", "pun"] as const;

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * A message as the ranker reads it: normalised words, in order, repeats kept.
 * Exported for the tests and for `policy.ts`, which reads the same words.
 */
export function searchWords(text: string): string[] {
  let t = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Anything that is not a letter or a digit separates words — emoji,
    // punctuation, the "?" customers put after a space.
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  for (const [pattern, word] of PHRASES) t = t.replace(pattern, word);

  const out: string[] = [];
  for (const raw of t.split(/\s+/)) {
    if (raw === "") continue;
    const mapped = CANONICAL[raw] ?? CANONICAL[stem(raw)] ?? stem(raw);
    if (mapped.length < 2 || STOPWORDS.has(mapped) || STOPWORDS.has(raw))
      continue;
    out.push(mapped);
  }
  return out;
}

/** One-letter-off, for "oprasional"-shaped typos the table did not list. */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** BM25's two knobs, at the values the literature settled on. */
const K1 = 1.2;
const B = 0.75;
/** The question says what the entry is FOR, so it counts twice. */
const QUESTION_WEIGHT = 2;
/** A near-spelling match is worth less than the real word. */
const FUZZY_WEIGHT = 0.6;

interface Indexed<T> {
  readonly doc: T;
  readonly tf: ReadonlyMap<string, number>;
  readonly question: ReadonlySet<string>;
  readonly length: number;
}

export interface KnowledgeIndex<T extends KnowledgeDoc = KnowledgeDoc> {
  readonly docs: readonly T[];
  rank(query: string, limit?: number): Array<RankedDoc<T>>;
}

/**
 * Build the index once per pass; rank many messages against it.
 *
 * Entries are few enough that "index" means a term-frequency map per entry
 * and a document frequency per word — built in well under a millisecond.
 */
export function indexKnowledge<T extends KnowledgeDoc>(
  docs: readonly T[],
): KnowledgeIndex<T> {
  const indexed: Array<Indexed<T>> = docs.map((doc) => {
    const tf = new Map<string, number>();
    const add = (word: string, weight: number) =>
      tf.set(word, (tf.get(word) ?? 0) + weight);
    const question = searchWords(doc.question);
    for (const w of question) add(w, QUESTION_WEIGHT);
    for (const w of searchWords(doc.answer)) add(w, 1);
    let length = 0;
    for (const n of tf.values()) length += n;
    return { doc, tf, question: new Set(question), length };
  });

  const df = new Map<string, number>();
  for (const entry of indexed)
    for (const word of entry.tf.keys()) df.set(word, (df.get(word) ?? 0) + 1);
  const vocabulary = [...df.keys()];
  const n = indexed.length;
  const avgLength =
    n === 0 ? 1 : indexed.reduce((s, e) => s + e.length, 0) / n || 1;
  const idf = (word: string) => {
    const d = df.get(word) ?? 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };

  /** A query word, or the one vocabulary word a letter away from it. */
  const resolve = (word: string): { term: string; weight: number } | null => {
    if (df.has(word)) return { term: word, weight: 1 };
    if (word.length < 5) return null;
    const near = vocabulary.filter((v) => v.length >= 4 && withinOne(word, v));
    return near.length === 1 ? { term: near[0]!, weight: FUZZY_WEIGHT } : null;
  };

  return {
    docs,
    rank(query, limit = 5) {
      const words = new Set(searchWords(query));
      const terms = new Map<string, number>();
      for (const w of words) {
        const hit = resolve(w);
        if (hit)
          terms.set(hit.term, Math.max(terms.get(hit.term) ?? 0, hit.weight));
      }
      if (terms.size === 0) return [];

      const scored: Array<RankedDoc<T>> = [];
      for (const entry of indexed) {
        let score = 0;
        const matched: string[] = [];
        for (const [term, weight] of terms) {
          const f = entry.tf.get(term);
          if (f === undefined) continue;
          const norm = f * (K1 + 1);
          const denom = f + K1 * (1 - B + (B * entry.length) / avgLength);
          score += weight * idf(term) * (norm / denom);
          matched.push(term);
        }
        if (score > 0) {
          const inQuestion = matched.filter((m) =>
            entry.question.has(m),
          ).length;
          scored.push({
            doc: entry.doc,
            score,
            matched,
            coverage: inQuestion / words.size,
          });
        }
      }
      scored.sort(
        (a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id),
      );
      return scored.slice(0, limit);
    },
  };
}

/**
 * A match good enough to put in front of the model as "this is probably the
 * answer". Tuned on the owner's sheet (test/retrieval.test.ts): every question
 * asked in chat spelling scored 3.5 or more for its own entry, while an
 * unrelated question sharing one filler word ("bayar pakai crypto") scored
 * about 1.5.
 */
export const STRONG_MATCH = 3;

/** How much of a message its entry's question must cover to count on its own. */
export const STRONG_COVERAGE = 0.6;

/**
 * Whether a match is good enough to put in front of the model as "this is
 * probably the answer": a high BM25 score in a base big enough for scores to
 * mean something, or most of the customer's words in the entry's question in
 * a base of any size.
 */
export function isStrongMatch(r: { score: number; coverage: number }): boolean {
  return r.score >= STRONG_MATCH || r.coverage >= STRONG_COVERAGE;
}
