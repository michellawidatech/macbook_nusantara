/**
 * A list of questions in one bubble, answered per question (owner,
 * 2026-11-16):
 *
 *     Hi, aku mau tanya ya:          1. ada air m1?
 *     1. ada air m1?           →     Ada kak, Air M1 mulus 8,9jt
 *     2. garansinya berapa lama?
 *                                    2. garansinya berapa lama?
 *                                    Untuk garansinya aku tanyain dulu ya kak 🙏
 *
 * Each question is answered on its own — by the rules or by the AI, with its
 * own routing, so the one a person must take gets the holding line under it
 * and a task, and the others are still answered — and the answers are put
 * back together here. Done in code rather than asked of the model: a format
 * a model is asked for is a format it keeps most of the time.
 *
 * Pure: no database, no clock.
 */
import type { ConverseHandoff, ConverseResult } from "./converse.js";
import { plainText } from "./sanitise.js";

export interface QuestionItem {
  /** "1." for a numbered item, "-" for a bullet. */
  readonly label: string;
  readonly text: string;
}

export interface QuestionList {
  /** What came before the list ("Hi, aku mau tanya ya:"), or null. */
  readonly intro: string | null;
  readonly items: readonly QuestionItem[];
}

/** More than this is a message, not a list of questions: answered whole. */
export const MAX_LIST_ITEMS = 6;

/** "1. …", "1) …", "1 - …", "1: …" — a dot needs a space after it ("11.9jt"). */
const NUMBERED = /^(\d{1,2})(?:[.)]\s+|\)|\s*[-:]\s+)\s*(\S.*)$/;
const BULLET = /^[-•*·]\s+(\S.*)$/;
/** An inline item: "… 1. ada air m1? 2. garansinya …". */
const INLINE = /(?:^|\s)(\d)[.)]\s+/g;

/** The questions a message lists, or null when it is not a list of two or more. */
export function questionItems(text: string): QuestionList | null {
  return linesList(text) ?? inlineList(text);
}

function linesList(text: string): QuestionList | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const intro: string[] = [];
  const items: Array<{ label: string; text: string; n: number | null }> = [];
  for (const line of lines) {
    const num = NUMBERED.exec(line);
    const bullet = num ? null : BULLET.exec(line);
    if (num) {
      items.push({
        label: `${Number(num[1])}.`,
        text: num[2]!.trim(),
        n: Number(num[1]),
      });
    } else if (bullet) {
      items.push({ label: "-", text: bullet[1]!.trim(), n: null });
    } else if (items.length === 0) {
      intro.push(line);
    } else {
      // A line under an item continues it.
      const last = items[items.length - 1]!;
      items[items.length - 1] = { ...last, text: `${last.text} ${line}` };
    }
  }
  if (items.length < 2 || items.length > MAX_LIST_ITEMS) return null;
  const numbered = items.every((i) => i.n !== null);
  const bullets = items.every((i) => i.n === null);
  if (!numbered && !bullets) return null;
  if (numbered && !items.every((i, k) => i.n === k + 1)) return null;
  return {
    intro: intro.length ? intro.join(" ") : null,
    items: items.map(({ label, text }) => ({ label, text })),
  };
}

function inlineList(text: string): QuestionList | null {
  const one = text.replace(/\s+/g, " ").trim();
  const marks = [...one.matchAll(INLINE)].map((m) => ({
    n: Number(m[1]),
    start: (m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0),
    end: (m.index ?? 0) + m[0].length,
  }));
  // The run 1, 2, 3 … from the first "1.".
  const first = marks.findIndex((m) => m.n === 1);
  if (first < 0) return null;
  const run = [marks[first]!];
  for (const m of marks.slice(first + 1))
    if (m.n === run.length + 1) run.push(m);
  if (run.length < 2 || run.length > MAX_LIST_ITEMS) return null;
  const items = run.map((m, k) => ({
    label: `${m.n}.`,
    text: one.slice(m.end, run[k + 1]?.start ?? one.length).trim(),
  }));
  if (items.some((i) => i.text === "")) return null;
  const intro = one.slice(0, run[0]!.start).trim();
  return { intro: intro || null, items };
}

/**
 * The answers put back under their questions: the question repeated, its
 * answer under it, a blank line between items. A blank line inside one answer
 * would read as the next item, so it closes up; a line two answers share —
 * the closing "Gimana kak?" — is said once, under the last.
 */
export function formatItemAnswers(
  list: QuestionList,
  answers: readonly string[],
): string {
  const lines = answers.map((a) =>
    (a ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const kept = lines.map((own, k) =>
    own.filter(
      (line) =>
        !lines
          .slice(k + 1)
          .some((later) => later.some((l) => plainText(l) === plainText(line))),
    ),
  );
  return list.items
    .map((item, k) =>
      [`${item.label} ${item.text}`, ...(kept[k] ?? [])].join("\n"),
    )
    .join("\n\n");
}

/** A merged turn: one hand-over on the row, and any others beside it. */
export type MergedResult<R extends ConverseResult> = R & {
  /** Hand-overs after the first, each its own task (2026-11-16). */
  readonly extraHandoffs?: readonly ConverseHandoff[];
};

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * One turn out of the answers to each question. The first hand-over is the
 * row's; the others ride beside it. Fields only the rules bot carries — the
 * trace, the cost, the lead verdict, the conversation state — are combined
 * when present.
 */
export function mergeItemResults<R extends ConverseResult>(
  list: QuestionList,
  results: readonly R[],
): MergedResult<R> {
  return combineResults(
    results,
    formatItemAnswers(
      list,
      results.map((r) => r.reply),
    ),
  );
}

/** Several answers as one turn, under the reply given (`mergeItemResults`). */
export function combineResults<R extends ConverseResult>(
  results: readonly R[],
  reply: string,
): MergedResult<R> {
  const handoffs = results
    .map((r) => r.handoff)
    .filter((h): h is ConverseHandoff => h !== undefined);
  const photos = unique(results.flatMap((r) => r.photos ?? []));
  const shown = unique(results.flatMap((r) => r.shown ?? []));
  const bookings = results.flatMap((r) => r.bookings ?? []);
  const merged: Record<string, unknown> = {
    ...results[0],
    reply,
    rawReply: reply,
    toolsUsed: results.flatMap((r) => r.toolsUsed),
    steps: results.reduce((n, r) => n + r.steps, 0),
    sources: unique(results.flatMap((r) => r.sources)),
  };
  delete merged["photos"];
  delete merged["shown"];
  delete merged["bookings"];
  delete merged["handoff"];
  if (photos.length) merged["photos"] = photos;
  if (shown.length) merged["shown"] = shown;
  if (bookings.length) merged["bookings"] = bookings;
  if (handoffs[0]) merged["handoff"] = handoffs[0];
  if (handoffs.length > 1) merged["extraHandoffs"] = handoffs.slice(1);

  // What the rules bot adds to a turn.
  const any = results as ReadonlyArray<Record<string, unknown>>;
  if (any.some((r) => Array.isArray(r["trace"])))
    merged["trace"] = any.flatMap((r) =>
      Array.isArray(r["trace"]) ? (r["trace"] as unknown[]) : [],
    );
  if (any.some((r) => typeof r["costMicros"] === "number"))
    merged["costMicros"] = any.reduce(
      (n, r) => n + (typeof r["costMicros"] === "number" ? r["costMicros"] : 0),
      0,
    );
  if (any.some((r) => typeof r["latencyMs"] === "number"))
    merged["latencyMs"] = Math.max(
      ...any.map((r) =>
        typeof r["latencyMs"] === "number" ? r["latencyMs"] : 0,
      ),
    );
  if (any.some((r) => typeof r["usedAi"] === "boolean"))
    merged["usedAi"] = any.some((r) => r["usedAi"] === true);
  const verdicts = any
    .map(
      (r) =>
        r["verdict"] as
          { leadScore: number; escalate: string | null } | undefined,
    )
    .filter(
      (v): v is { leadScore: number; escalate: string | null } =>
        v !== undefined,
    );
  if (verdicts.length)
    merged["verdict"] = {
      ...verdicts[0],
      leadScore: Math.max(...verdicts.map((v) => v.leadScore)),
      escalate: handoffs[0]?.topic ?? null,
    };
  for (const key of ["state", "watch", "task"]) {
    const last = [...any].reverse().find((r) => r[key] !== undefined);
    delete merged[key];
    if (last) merged[key] = last[key];
  }
  return merged as MergedResult<R>;
}

/**
 * What the AI is told when it answers one question of a list: the whole list
 * for context, and that only this one is its to answer.
 */
export function itemFocusNote(list: QuestionList, index: number): string {
  const item = list.items[index]!;
  return (
    `Their message is a list of ${list.items.length} questions, each answered separately and ` +
    `put back together under its own number:\n${list.items
      .map((i) => `${i.label} ${i.text}`)
      .join("\n")}\n` +
    `Answer ONLY ${item.label} "${item.text}" — not the others, no greeting, no closing ` +
    "question, and do not repeat the question: it is printed above your answer."
  );
}
