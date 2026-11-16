/**
 * The last step every bot reply takes before it is sent (owner, 2026-11-16):
 *
 * *"The shop still answers with full stops which is rude, and it is too
 * demanding. It keeps repeating itself, especially when the store is not open
 * … If we have a bunch of questions and we know nothing, just say ONCE that we
 * don't know the answer yet, instead of one by one … Don't repeat yourself
 * unless the user asks for it."*
 *
 * So `finishReply`, in this order:
 *
 *  1. the emoji rule (one, only in the chat's first reply — 2026-11-09);
 *  2. the shop's punctuation (`casualPunctuation`): no full stop ends a line;
 *  3. no repetition, sentence by sentence, against what the shop already sent
 *     in this conversation:
 *       - the recommendation closer ("Gimana kakk? Kakak juga bisa lihat
 *         unitnya langsung di toko kita") at most ONCE per conversation;
 *       - the closed-shop line once per closed period;
 *       - "Untuk X nanti tim kami konfirmasi ya kak" once per subject — said
 *         again, it becomes "Soal X masih dicek tim kami ya kak", and after
 *         that nothing; several in one reply are ONE line naming them all;
 *       - any other sentence that (nearly) repeats one of the last six
 *         replies, or an earlier sentence of this same reply, goes — unless
 *         the customer asked for it again ("tadi berapa?", "ulang dong"), and
 *         a figure is kept when they are asking a question;
 *  4. when nothing is left, a short line no recent reply used.
 *
 * Deterministic and pure: the earlier replies and the clock are passed in.
 */

import { casualPunctuation } from "@nusantara/domain";
import { closedSince } from "./hours.js";
import { SAFETY_LINES, isHoldingLine } from "./policy.js";
import { applyEmojiRule, detectLanguage } from "./sanitise.js";

/** A reply the shop sent earlier in this conversation. */
export interface EarlierReply {
  readonly text: string;
  /** When it was sent; unknown is read as "recently". */
  readonly at?: Date | null;
}

/** How many of the newest replies a sentence may not repeat. */
export const RECENT_REPLIES = 6;

/** A sentence this short ("Siap kak") is an acknowledgement, not a repeat. */
const MIN_WORDS = 3;

/** The words of a sentence, for comparing: no emoji, no punctuation, no "kakk". */
export function sentenceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(\p{L})\1+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The same sentence, or near enough that a reader would call it a repeat. */
export function nearlySame(a: string, b: string): boolean {
  const x = sentenceKey(a);
  const y = sentenceKey(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  if (xs.size < 4 || ys.size < 4) return false;
  let shared = 0;
  for (const w of xs) if (ys.has(w)) shared += 1;
  return shared / (xs.size + ys.size - shared) >= 0.75;
}

/** A reply cut into its sentences: lines, then "?"-ended pieces of a line. */
export function sentencesOf(text: string): string[] {
  return casualPunctuation(text)
    .split("\n")
    .flatMap((line) => line.split(/(?<=\?)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A list's question line, as `formatItemAnswers` writes it. */
const LIST_LINE = /^(\d{1,2}\.|-)\s/;

// --- the sentences that are said once --------------------------------------

/**
 * The recommendation closer (2026-10-28), by half — "Gimana kakk?" and
 * "Kakak juga bisa lihat unitnya langsung di toko kita" — in both languages.
 * Each half is said once per conversation (owner, 2026-11-16).
 */
function closerHalf(s: string): "ask" | "visit" | null {
  const k = sentenceKey(s);
  if (/^gimana kak$/.test(k) || /^what do you think$/.test(k)) return "ask";
  if (
    /\bkakak juga bisa (lihat|liat|mampir)\b.*\btoko\b/.test(k) ||
    /\balso welcome to see it\b/.test(k)
  )
    return "visit";
  return null;
}

/** "Tokonya lagi tutup kak…" — and the line before 2026-11-16. */
export function isClosedLine(s: string): boolean {
  return /\btoko(nya)? (lagi|sedang|sudah) tutup\b/.test(sentenceKey(s));
}

/** `Untuk {subject} nanti tim kami {verb} ya kak` → its subjects. */
const CONFIRM =
  /^untuk (.+?) nanti (?:tim kami|aku) (?:konfirmasi|cek|bantu|siapin|atur|hitungkan|tanyain)\b/i;

/** The subjects of a confirm line, normalised ("garansinya" → "garansi"). */
export function confirmSubjects(s: string): string[] | null {
  const m = CONFIRM.exec(s.trim());
  if (!m) return null;
  return m[1]!
    .split(/\s*,\s*|\s+dan\s+/)
    .map((x) => x.trim().replace(/nya$/i, ""))
    .filter(Boolean);
}

/** "Soal garansinya masih dicek tim kami ya kak" — a confirm line said again. */
function stillChecking(subjects: readonly string[]): string {
  return `Soal ${joinSubjects(subjects)} masih dicek tim kami ya kak`;
}

const isStillChecking = (s: string) =>
  /^soal .+ masih (dicek|aku cekin)\b/.test(sentenceKey(s));

/** "garansi", "ongkir" → "garansi dan ongkirnya". */
export function joinSubjects(subjects: readonly string[]): string {
  const xs = [...new Set(subjects)];
  const tail = xs[xs.length - 1]!;
  const last = /\bini$|nya$/.test(tail) ? tail : `${tail}nya`;
  if (xs.length === 1) return last;
  return `${xs
    .slice(0, -2)
    .map((x) => `${x}, `)
    .join("")}${xs[xs.length - 2]} dan ${last}`;
}

/** ONE line for everything this reply hands to the team (2026-11-16). */
export function confirmLine(subjects: readonly string[]): string {
  return `Untuk ${joinSubjects(subjects)} nanti tim kami konfirmasi dulu ya kak`;
}

/** Did they ask to hear it again? Then nothing is held back as a repeat. */
const ASKS_REPEAT =
  /\b(ulang(in|i)?|sekali lagi|tadi (apa|berapa|brp|gimana|yang mana)|yang tadi|kayak tadi|lagi dong|repeat|again|once more)\b/i;
/** A question of theirs: a figure in the answer may be said again. */
const QUESTION =
  /\?|\b(berapa(an)?|brp(an)?|brapa|apa|apakah|gimana|gmn|bagaimana|kapan|dimana|mana|how|what|which)\b/i;

// --- the fallback -----------------------------------------------------------

const FALLBACK: Record<"id" | "en", readonly string[]> = {
  id: [
    "Siap kak",
    "Oke kak, kalau ada yang mau ditanyain lagi kabarin aja ya",
    "Iya kak, aku standby di sini ya",
    "Sip kak",
  ],
  en: ["Sure", "Okay, just let me know if there's anything else", "Got it"],
};

/** The first line of `options` no recent reply already has. */
function freshLine(
  options: readonly string[],
  recent: readonly string[],
): string | null {
  const said = recent.flatMap(sentencesOf);
  return (
    options.find(
      (o) => !sentencesOf(o).some((s) => said.some((r) => nearlySame(s, r))),
    ) ?? null
  );
}

// --- the pass ---------------------------------------------------------------

export interface FinishInput {
  /** Is this the conversation's first reply? (the emoji rule) */
  readonly first: boolean;
  /** What the shop sent earlier in this conversation, NEWEST first. */
  readonly earlier?: readonly EarlierReply[];
  /** The customer's message this reply answers. */
  readonly customerText?: string;
  /** Now, for the closed period. */
  readonly now?: Date;
}

/** The reply as it is sent — see the module docblock. */
export function finishReply(text: string, input: FinishInput): string {
  const earlier = input.earlier ?? [];
  const recent = earlier.slice(0, RECENT_REPLIES).map((e) => e.text);
  const recentSentences = recent.flatMap(sentencesOf);
  const allSentences = earlier.flatMap((e) => sentencesOf(e.text));
  const customer = input.customerText ?? "";
  const repeatAsked = ASKS_REPEAT.test(customer);
  const asking = QUESTION.test(customer);
  const closedFrom = input.now ? closedSince(input.now) : null;
  const closedBefore = earlier.some(
    (e) =>
      (!closedFrom || !e.at || e.at >= closedFrom) &&
      sentencesOf(e.text).some(isClosedLine),
  );
  /** Every subject a confirm line (or its "still checking") already named. */
  const confirmedBefore = new Set(
    allSentences.flatMap((s) => confirmSubjects(s) ?? []),
  );

  const emojied = applyEmojiRule(text, input.first);
  const lines = casualPunctuation(emojied).split("\n");
  const kept: string[][] = [];
  const thisReply: string[] = [];
  const subjects: string[] = [];
  /** Where the merged confirm line goes: the last confirm line's place. */
  let confirmAt: { line: number; index: number } | null = null;
  const closerSaid = new Set(allSentences.map(closerHalf).filter(Boolean));
  let closedSaid = closedBefore;
  /** "Soal X masih dicek…" lines written this reply. */
  const agains: string[] = [];

  for (const line of lines) {
    const out: string[] = [];
    kept.push(out);
    if (line.trim() === "") continue;
    // The customer's own question, repeated above its answer: never a repeat.
    if (LIST_LINE.test(line)) {
      out.push(line);
      continue;
    }
    for (const sentence of line.split(/(?<=\?)\s+/)) {
      const s = sentence.trim();
      if (!s) continue;
      const half = closerHalf(s);
      if (half) {
        if (closerSaid.has(half) && !repeatAsked) continue;
        closerSaid.add(half);
        out.push(s);
        thisReply.push(s);
        continue;
      }
      if (isClosedLine(s)) {
        if (closedSaid) continue;
        closedSaid = true;
        out.push(s);
        thisReply.push(s);
        continue;
      }
      const confirm = confirmSubjects(s);
      if (confirm) {
        const fresh = confirm.filter(
          (x) =>
            !subjects.includes(x) && (repeatAsked || !confirmedBefore.has(x)),
        );
        if (fresh.length > 0) {
          subjects.push(...fresh);
          confirmAt = { line: kept.length - 1, index: out.length };
          out.push(s);
          thisReply.push(s);
          continue;
        }
        if (confirm.every((x) => subjects.includes(x))) continue;
        // Said before: once more in other words, then not again — and not
        // at all beside something new for the team, which is what the
        // customer is hearing about now.
        const again = stillChecking(confirm);
        if (
          recentSentences.some(
            (r) => nearlySame(r, again) || isStillChecking(r),
          )
        )
          continue;
        out.push(again);
        thisReply.push(again);
        agains.push(again);
        continue;
      }
      const words = sentenceKey(s).split(" ").length;
      if (words >= MIN_WORDS) {
        if (thisReply.some((t) => nearlySame(t, s))) continue;
        const fact = /\d|https?:\/\//.test(s);
        const repeat =
          !repeatAsked &&
          !(fact && asking) &&
          recentSentences.some((r) => nearlySame(r, s));
        if (repeat) continue;
      }
      out.push(s);
      thisReply.push(s);
    }
  }

  if (subjects.length > 0)
    for (const out of kept)
      for (let i = out.length - 1; i >= 0; i -= 1)
        if (agains.includes(out[i]!)) out.splice(i, 1);

  // Several things for the team in one reply: one line naming them all, where
  // the last of them stood (2026-11-16).
  if (subjects.length > 1 && confirmAt) {
    const at = confirmAt;
    for (const out of kept)
      for (let i = out.length - 1; i >= 0; i -= 1)
        if (confirmSubjects(out[i]!)) out.splice(i, 1);
    const target = kept[at.line]!;
    target.splice(Math.min(at.index, target.length), 0, confirmLine(subjects));
  }

  const body = kept
    .map((sentences) => sentences.join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body !== "" && !/^(\s|\p{Extended_Pictographic})*$/u.test(body))
    return casualPunctuation(body);
  const lang = detectLanguage(customer) === "en" ? "en" : "id";
  return casualPunctuation(
    applyEmojiRule(
      freshLine(FALLBACK[lang], recent) ?? FALLBACK[lang][0]!,
      input.first,
    ),
  );
}

/**
 * The "never silent" line (2026-10-27) — never the same one twice in a row
 * (owner, 2026-11-16). When the bot's previous reply was itself a holding
 * line, the customer gets a light question that carries the chat on instead
 * of a second "bentar ya".
 */
export function safetyLine(earlier: readonly EarlierReply[] = []): string {
  const recent = earlier.slice(0, RECENT_REPLIES).map((e) => e.text);
  const last = recent[0] ?? "";
  const lastWasHolding =
    isHoldingLine(last) ||
    sentencesOf(last).some((s) => SAFETY_LINES.some((l) => nearlySame(s, l))) ||
    sentencesOf(last).some((s) => confirmSubjects(s) !== null);
  const carryOn = [
    "Sambil aku cek, boleh tau kakak lagi cari unit buat kebutuhan apa?",
    "Pesannya sudah aku terima ya kak, kalau ada yang mau ditanyain lagi kabarin aja",
  ];
  return (
    freshLine(
      lastWasHolding ? carryOn : [...SAFETY_LINES, ...carryOn],
      recent,
    ) ?? carryOn[carryOn.length - 1]!
  );
}
