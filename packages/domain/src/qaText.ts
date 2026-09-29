/**
 * The shop's answer sheets, read as question/answer pairs (owner ask
 * 2026-09-18: "I have compiled lists of questions").
 *
 * The owner writes these in a document, one pair after another:
 *
 *     Q: Cod bisa ga kak ?
 *     A: Bisa kak 😊 Untuk COD area jabodetabek ...
 *     Kalau kakak berkenan, boleh info lokasi pengiriman ...
 *
 * and pastes the lot into the chatbot's knowledge base. This is the reading of
 * that text, pure so the paste dialog on /chat and the server's `knowledge`
 * CLI split it identically.
 *
 * The rules, and nothing cleverer:
 *
 *  - A line starting `Q:` (or `Pertanyaan:`) opens a pair; `A:` (or
 *    `Jawaban:`) starts its answer. Case and the spaces around the colon do
 *    not matter — "q :" and "Q:" are the same key on a phone.
 *  - Every other line belongs to whatever came last: a note under a question
 *    stays with the question, a second paragraph stays with the answer.
 *  - Lines before the first `Q:` are a heading ("Lists of Questions:") and
 *    are dropped. A question that never got an answer is dropped too, and
 *    reported, because a question with no approved answer is not knowledge.
 *
 * It does not guess at a document's mistakes. A stray fragment typed into the
 * middle of an answer stays in that answer, and the paste dialog shows every
 * pair for a person to correct before anything is saved — a parser that
 * "fixed" the owner's words would be deciding what the bot says.
 */

export interface QaPair {
  readonly question: string;
  readonly answer: string;
}

export interface QaParse {
  readonly pairs: readonly QaPair[];
  /** Questions that had no `A:` line, in order, so the dialog can say so. */
  readonly unanswered: readonly string[];
}

const QUESTION = /^\s*(?:q|pertanyaan)\s*[:.]\s?/i;
const ANSWER = /^\s*(?:a|jawaban)\s*[:.]\s?/i;

/** Trim each line's right edge, drop blank lines at either end, keep the rest. */
function tidy(lines: readonly string[]): string {
  const trimmed = lines.map((l) => l.replace(/\s+$/u, ""));
  while (trimmed.length > 0 && trimmed[0]!.trim() === "") trimmed.shift();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === "")
    trimmed.pop();
  return trimmed.map((l) => l.trimStart()).join("\n");
}

export function parseQaText(text: string): QaParse {
  const pairs: QaPair[] = [];
  const unanswered: string[] = [];
  let question: string[] | null = null;
  let answer: string[] | null = null;

  const close = () => {
    if (question === null) return;
    const q = tidy(question);
    const a = answer === null ? "" : tidy(answer);
    if (q !== "" && a !== "") pairs.push({ question: q, answer: a });
    else if (q !== "") unanswered.push(q);
    question = null;
    answer = null;
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (QUESTION.test(line)) {
      close();
      question = [line.replace(QUESTION, "")];
    } else if (question !== null && answer === null && ANSWER.test(line)) {
      answer = [line.replace(ANSWER, "")];
    } else if (answer !== null) {
      answer.push(line);
    } else if (question !== null) {
      question.push(line);
    }
  }
  close();
  return { pairs, unanswered };
}

/**
 * The comparison key for "is this question already in the knowledge base?" —
 * case, spacing, punctuation and emoji do not make a question new.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
