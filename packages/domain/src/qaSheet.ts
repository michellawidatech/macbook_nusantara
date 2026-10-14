/**
 * The shop's answer sheet as a spreadsheet — one column of questions, one of
 * answers (owner ask 2026-10-14: *"it is better if we use excel / csv file
 * that will have 1 column for questions and 1 column for answer"*).
 *
 * The `Q:` / `A:` document of 2026-09-18 (qaText.ts) was a paste; this is a
 * file somebody keeps. That changes what an upload means: the sheet is the
 * source of truth, so the dialog that reads it offers to UPDATE an answer the
 * file has changed rather than skipping a question it already knows.
 *
 * Pure, like its neighbour: the browser reads an .xlsx into rows with its own
 * reader and a .csv with `parseCsv` below, and both hand the rows to
 * `qaFromRows`.
 *
 * The rules:
 *
 *  - Column A is the question and column B the answer, UNLESS the first row
 *    names them ("Question"/"Pertanyaan" and "Answer"/"Jawaban", in either
 *    order and any two columns) — then those are the columns and that row is
 *    not an answer.
 *  - A row with neither is skipped. A question with no answer is reported and
 *    not imported: a question with no approved answer is not knowledge.
 *  - The same question twice keeps the FIRST and reports the rest. Two answers
 *    to one question is the owner's decision to make, in the sheet.
 */
import { questionKey, type QaPair } from "./qaText.js";

export interface QaSheet {
  readonly pairs: readonly QaPair[];
  /** Questions whose answer cell was empty. */
  readonly unanswered: readonly string[];
  /** Questions that appeared again further down, and were not taken. */
  readonly repeated: readonly string[];
}

type Row = ReadonlyArray<unknown>;

const QUESTION_HEADER = /^(q|questions?|pertanyaan)$/i;
const ANSWER_HEADER = /^(a|answers?|jawaban)$/i;

/** A cell as text: numbers and booleans as written, an empty cell as "". */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\r\n?/g, "\n").trim();
}

/** The two columns a header row names, or null when it is not a header. */
function headerColumns(row: Row): { q: number; a: number } | null {
  const cells = row.map(cellText);
  const q = cells.findIndex((c) => QUESTION_HEADER.test(c));
  const a = cells.findIndex((c) => ANSWER_HEADER.test(c));
  return q >= 0 && a >= 0 ? { q, a } : null;
}

export function qaFromRows(rows: ReadonlyArray<Row>): QaSheet {
  const first = rows.findIndex((r) => r.some((c) => cellText(c) !== ""));
  if (first < 0) return { pairs: [], unanswered: [], repeated: [] };

  const header = headerColumns(rows[first]!);
  const { q, a } = header ?? { q: 0, a: 1 };
  const body = rows.slice(header ? first + 1 : first);

  const pairs: QaPair[] = [];
  const unanswered: string[] = [];
  const repeated: string[] = [];
  const seen = new Set<string>();
  for (const row of body) {
    const question = cellText(row[q]);
    const answer = cellText(row[a]);
    if (question === "") continue;
    if (answer === "") {
      unanswered.push(question);
      continue;
    }
    const key = questionKey(question);
    if (seen.has(key)) {
      repeated.push(question);
      continue;
    }
    seen.add(key);
    pairs.push({ question, answer });
  }
  return { pairs, unanswered, repeated };
}

/**
 * Which character separates this file's columns.
 *
 * Excel writes a CSV with the list separator of the machine it runs on, and
 * on a computer set to Indonesian that is a semicolon — so "comma-separated"
 * is a name, not a promise. Counted on the first line, outside quotes; a tie
 * goes to the comma.
 */
function delimiterOf(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "\n") break;
    else if (!quoted && ch in counts) counts[ch]! += 1;
  }
  return counts[";"]! > counts[","]! && counts[";"]! >= counts["\t"]!
    ? ";"
    : counts["\t"]! > counts[","]!
      ? "\t"
      : ",";
}

/**
 * A CSV file as rows of cells (RFC 4180, plus what Excel actually writes).
 *
 * A quoted cell may hold the separator, a line break and a doubled quote —
 * which an answer of several lines does, every time. A leading byte-order
 * mark is dropped; Excel puts one on every UTF-8 file it saves.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
