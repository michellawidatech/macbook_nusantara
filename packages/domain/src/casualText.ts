/**
 * The shop's punctuation on WhatsApp (owner, 2026-11-16): *"the shop still
 * answers with full stops which is rude"*. Nobody ends a chat line with a full
 * stop in casual Indonesian; a line that does reads as cold, or as written by
 * a form. So every text the bot sends goes through this on its way out:
 *
 *  - a full stop that ENDS a line goes ("…ya kak." → "…ya kak");
 *  - a full stop that ends a sentence in the MIDDLE of a line becomes a line
 *    break, so the next sentence starts its own line and the first one still
 *    ends bare ("Siap kak. Mau aku cariin?" → "Siap kak\nMau aku cariin?");
 *  - a comma left dangling at the end of a line goes too.
 *
 * And what it leaves alone, because those dots are not sentence ends: the
 * separators inside a number ("8.500.000", "jam 10.00"), a decimal ("2.5"),
 * an ellipsis ("hmm..."), a URL, an abbreviation ("Jl. Sudirman", "No. 5",
 * "a.n. Budi") and a single-letter initial ("A. Rahman"). A question mark is
 * never touched: a question has to look like one.
 *
 * Pure, so the worker, the follow-ups and the approval message share it.
 */

/** Words written with a dot that do not end a sentence. Lower case. */
const ABBREVIATIONS = new Set([
  "jl",
  "jln",
  "no",
  "gg",
  "rt",
  "rw",
  "kel",
  "kec",
  "kab",
  "kota",
  "prov",
  "dll",
  "dsb",
  "dst",
  "rp",
  "st",
  "bpk",
  "ibu",
  "sdr",
  "an",
  "pt",
  "cv",
  "tbk",
  "mr",
  "mrs",
  "ms",
  "dr",
  "ir",
  "hj",
  "vs",
  "etc",
  "approx",
  "tel",
  "telp",
  "hp",
  "wa",
]);

/**
 * May the full stop after this word end a sentence? Not after an
 * abbreviation, an initial, or the dots of a URL or a dotted abbreviation
 * like "a.n" (the word itself carries a dot).
 */
function endsSentence(word: string): boolean {
  if (/https?:\/\/|www\./i.test(word)) return false;
  const bare = word.replace(/^[("'“‘]+/, "");
  if (bare.includes(".") && !/^\d[\d.,]*$/.test(bare)) return false;
  if (/^\p{L}$/u.test(bare)) return false;
  return !ABBREVIATIONS.has(bare.toLowerCase());
}

/** One line, its sentences on lines of their own, none ending in a stop. */
function casualLine(line: string): string {
  const words = line.trim().split(/[ \t]+/);
  const out: string[] = [];
  let current: string[] = [];
  for (const [i, raw] of words.entries()) {
    const next = words[i + 1];
    const stop =
      next !== undefined &&
      /[^.]\.$/.test(raw) &&
      /^[\p{Lu}\p{N}"'“‘(]/u.test(next) &&
      // "1. Ini garansi gk ya" is a list's number, not a sentence.
      !(i === 0 && /^\d{1,2}\.$/.test(raw)) &&
      endsSentence(raw.slice(0, -1));
    current.push(stop ? raw.slice(0, -1) : raw);
    if (stop) {
      out.push(current.join(" "));
      current = [];
    }
  }
  out.push(current.join(" "));
  return out.map(dropFinalStop).join("\n");
}

/** "…ya kak." → "…ya kak"; "hmm..." stays; a dangling comma goes. */
function dropFinalStop(line: string): string {
  const t = line.trimEnd();
  if (/\.\.$/.test(t)) return t;
  return t.replace(/[.,]$/, "").trimEnd();
}

/** The bot's text with the shop's punctuation — see the module docblock. */
export function casualPunctuation(text: string | null | undefined): string {
  return (text ?? "")
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : casualLine(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
