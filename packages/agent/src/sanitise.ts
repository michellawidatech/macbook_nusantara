/**
 * The shop's voice, enforced rather than requested.
 *
 * `DEFAULT_PERSONA` already says "never use bold, bullets, headings, or the
 * characters — ; ! ( )". A persona is a request, and a small model honours it
 * most of the time. Most of the time is not a guarantee, and the one reply in
 * thirty that arrives as a markdown bullet list is the one that makes a shop
 * look like a bot. So the rule holds because the text is rewritten on the way
 * out, not because the model was asked nicely.
 *
 * This runs inside `converse`, not in the worker, so both callers get the
 * guarantee without either having to remember: the worker's unattended reply
 * and the Chat page's staff draft are formatted identically, and a staff member
 * previewing a draft sees exactly what would be sent.
 *
 * `detectLanguage` is the other half of the voice. The shop's customers write
 * Indonesian, English, and a running mix of the two, and a reply that comes
 * back in the wrong one reads as a machine. Telling the model to mirror works
 * better when the prompt also states what it is looking at — and, unlike an
 * instruction, a detector is inspectable when a reply comes back wrong.
 *
 * Both are pure. No model call, no database, no clock.
 */

/** At most this many emoji survive a reply. A person is not a sticker pack. */
export const MAX_EMOJI = 1;

/**
 * Drop the full stop, or the stranded comma, a line ends on.
 *
 * Nobody types a full stop at the end of a WhatsApp line, and a reply that does
 * reads as written rather than typed. The persona asks for this too, and this
 * is what makes it hold: the same "asked nicely, then enforced" pair as every
 * other rule in this file.
 *
 * The comma is the same rule's own mess. Told not to end on a full stop, the
 * model reaches for a comma instead and leaves the line dangling: "atau justru
 * smartphone aja udah cukup,". Removing the stop without removing that would
 * have traded one tell for a worse one.
 *
 * Two things it deliberately leaves alone. A run of dots is an ellipsis, which
 * is somebody trailing off and is exactly how people do type. And a question
 * mark is untouched, because a question still has to look like one.
 *
 * Safe on money because only the LAST character goes: "harganya 15.770.000."
 * loses the sentence's full stop and keeps the number's separators.
 */
function dropFinalPunctuation(line: string): string {
  return line.replace(/(?<!\.)[.,]$/, "");
}

/**
 * Rewrite a model's reply into something a shop admin would have typed.
 *
 * Order matters: markdown structure comes off before punctuation is repaired,
 * or a stripped bullet leaves a comma stranded at the start of a line.
 */
export function stripFormatting(text: string): string {
  if (!text) return "";

  let out = text;

  // Fenced code and inline backticks. A model that quotes a tool's JSON must
  // not send it to a customer.
  out = out.replace(/```[\s\S]*?```/g, " ");
  out = out.replace(/`([^`]*)`/g, "$1");

  // Headings, block quotes, list markers — line-leading, so a hyphenated word
  // mid-sentence is untouched.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  out = out.replace(/^[ \t]*>[ \t]?/gm, "");
  out = out.replace(/^[ \t]*[-*•·][ \t]+/gm, "");
  out = out.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");

  // Bold and italics. Longest marker first, or "**x**" leaves stray asterisks.
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // The characters the persona forbids. An em-dash becomes a comma because
  // deleting it runs two clauses together; "kak — harganya" must not become
  // "kak harganya".
  out = out.replace(/\s*[—–―]\s*/g, ", ");
  out = out.replace(/\s+-\s+/g, ", ");
  out = out.replace(/\s*;\s*/g, ", ");
  out = out.replace(/\s*!+/g, ".");

  // Parentheses lose the brackets and keep the words: "MacBook Air (M2)" is a
  // real product name written the way a person would type it without them.
  out = out.replace(/[()]/g, "");

  out = capEmoji(out);

  // Tidy what the rewrites left behind.
  out = out.replace(/,\s*([,.])/g, "$1");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+([,.?])/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out
    .split("\n")
    .map((line) => dropFinalPunctuation(line.trim()))
    .join("\n");

  return dropFinalPunctuation(out.trim());
}

/** True when a reply still carries anything the persona forbids. */
export function hasForbiddenFormatting(text: string): boolean {
  return (
    /[—–―;!]/.test(text) ||
    /[()]/.test(text) ||
    /\*\*|__|`/.test(text) ||
    /^[ \t]*([-*•·]|\d+[.)]|#{1,6})[ \t]+/m.test(text)
  );
}

/** Keep at most `MAX_EMOJI`, first ones win. */
function capEmoji(text: string): string {
  const emoji = /\p{Extended_Pictographic}/gu;
  let seen = 0;
  return text.replace(emoji, (m) => {
    seen += 1;
    return seen <= MAX_EMOJI ? m : "";
  });
}

// --- language --------------------------------------------------------------

export type Language = "id" | "en" | "mix";

/**
 * Words that only an Indonesian speaker writes. Deliberately function words
 * and shop slang rather than nouns — nouns are where the two languages overlap.
 */
const ID_WORDS = new Set([
  "ada", "ga", "gak", "nggak", "tidak", "yang", "dan", "atau", "kak", "mas",
  "mbak", "bang", "saya", "aku", "kamu", "mau", "bisa", "berapa", "harga",
  "harganya", "gimana", "bagaimana", "kalau", "kalo", "aja", "saja", "dulu",
  "udah", "sudah", "belum", "masih", "juga", "buat", "untuk", "dengan", "dari",
  "ini", "itu", "nya", "sih", "dong", "ya", "iya", "nanti", "besok", "bisa",
  "punya", "cari", "beli", "jual", "tanya", "lagi", "banget", "murah", "mahal",
  "warna", "berapa", "kapan", "dimana", "di", "ke", "pakai", "pake", "kuliah",
]);

/**
 * Words that only an English speaker writes. Shop loanwords are deliberately
 * absent — "ready", "fullset", "nego", "cod" and "stock" are how Indonesians
 * write, and counting them as English would flip a whole thread on one message.
 */
const EN_WORDS = new Set([
  "the", "is", "are", "do", "does", "you", "have", "still", "what", "when",
  "where", "how", "much", "can", "could", "would", "please", "thanks", "want",
  "looking", "for", "any", "there", "this", "that", "with", "and", "or", "but",
  "it", "its", "im", "i", "my", "me", "we", "they", "about", "price", "buy",
  "sell", "available", "in", "of", "to", "a", "an", "if", "not", "yes", "no",
]);

/**
 * Which language a customer is writing in.
 *
 * Product names are deliberately not a signal. "MacBook Air M2" is English
 * everywhere on earth, and reading it as one would answer a Jakarta customer
 * in English because they named the thing they want to buy.
 *
 * With no signal at all the answer is Indonesian: the shop is in Jakarta, and
 * that is the safer default.
 */
export function detectLanguage(text: string): Language {
  const words = (text ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z']+/)
    .filter((w) => w.length > 0);

  let id = 0;
  let en = 0;
  for (const w of words) {
    if (ID_WORDS.has(w)) id += 1;
    else if (EN_WORDS.has(w)) en += 1;
  }

  if (id === 0 && en === 0) return "id";
  if (id > 0 && en > 0) return "mix";
  return en > 0 ? "en" : "id";
}
