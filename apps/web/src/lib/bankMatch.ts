/**
 * Matching a month of the bank's e-statement against the POS's bank
 * movements (owner ask 2026-10-27, answer 3B: "every line";
 * docs/superpowers/specs/2026-10-27-reconciliation-design.md).
 *
 * Every amount here is SIGNED whole rupiah — a credit (money in) positive, a
 * debit negative — on both sides, so "the same amount" also means "the same
 * direction". The statement's sen are not carried (`lib/bankStatement.ts`):
 * a line matches when the rupiah agree.
 *
 * ## The rules, in the order they run
 *
 * Each line and each POS movement is used at most once; a pass only sees what
 * the passes before it left.
 *
 * 1. **EXACT** — same amount, same day.
 * 2. **DATE_SHIFT** — same amount within ±3 days, nearest first. A transfer
 *    made on the 31st posts on the 1st (its line says "TANGGAL :dd/mm").
 *
 * Both of those are matches: written at once. What follows are SUGGESTIONS,
 * each with its reason, accepted or rejected by a person:
 *
 * 3. **SPLIT** — one bank line is 2–6 POS movements of the same day ±1 whose
 *    sum is the line's: a marketplace payout of several sales, a supplier paid
 *    in parts on one transfer.
 * 4. **MERGE** — several bank lines (2–6, same day ±1) are one POS movement:
 *    a cash deposit made in several CDM slips (SETORAN VIA CDM).
 * 5. **TYPO** — same day ±1, the amounts differ in one digit or by two
 *    neighbouring digits swapped: the POS was typed wrong; correct it to the
 *    bank's figure.
 * 6. **DEDUCTION** — the bank RECEIVED less than the POS recorded, by at most
 *    5%, within ±3 days: a fee was kept on the way. Record it as an expense.
 * 7. **Bank-only** — a line nothing explains: suggest adding it, with a
 *    category guessed from its words (`guessCategory`).
 * 8. **POS-only** — a movement the bank never saw: somebody should open it.
 *
 * Exact sums before near amounts: a set of movements adding to the rupiah is
 * stronger evidence than a figure one keystroke away.
 *
 * Pure: no React, no store. `test/bankMatch.test.ts` is the spec.
 */
import dayjs from "dayjs";

/** A statement line, reduced to what matching needs. */
export interface BankLine {
  readonly id: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Signed whole rupiah. */
  readonly amount: number;
  readonly description: string;
}

/** A POS bank movement, reduced to what matching needs. */
export interface PosMovement {
  /** Stable key — `refKey` of the record behind it. */
  readonly key: string;
  /** The local day it happened. */
  readonly date: string;
  /** Signed whole rupiah. */
  readonly amount: number;
}

export type MatchReason =
  | "EXACT"
  | "DATE_SHIFT"
  | "TYPO"
  | "DEDUCTION"
  | "SPLIT"
  | "MERGE"
  | "ADDED"
  | "MANUAL";

/** The reasons a suggestion can carry — the ones a person decides. */
export type SuggestionReason = "TYPO" | "DEDUCTION" | "SPLIT" | "MERGE";

/** Lines and movements that belong together, and why. */
export interface Pairing {
  readonly reason: MatchReason;
  readonly lineIds: readonly string[];
  readonly movementKeys: readonly string[];
}

export interface Suggestion extends Pairing {
  readonly reason: SuggestionReason;
  /** TYPO: what the POS amount should be corrected to (signed). */
  readonly correctTo?: number;
  /** DEDUCTION: the fee to record as an expense (positive). */
  readonly fee?: number;
}

/** What a bank-only line probably is — the adjustment dialog's own answers. */
export interface CategoryGuess {
  readonly direction: "INCOME" | "EXPENSE" | "MOVE";
  /** An `IncomeReason`, an `ExpenseKind`, or `BANK_TO_CASH` / `CASH_TO_BANK`. */
  readonly reason: string;
}

export interface BankOnly {
  readonly lineId: string;
  readonly guess?: CategoryGuess;
}

export interface MatchResult {
  readonly matched: readonly Pairing[];
  readonly suggestions: readonly Suggestion[];
  readonly bankOnly: readonly BankOnly[];
  /** Keys of movements nothing on the statement accounts for. */
  readonly posOnly: readonly string[];
}

/** How far a posting may lag, in days, for an exact amount. */
export const DATE_SHIFT_DAYS = 3;
/** How far apart a suggestion's two sides may be, in days. */
export const NEAR_DAYS = 1;
/** The largest deduction read as a fee, as a share of the POS amount. */
export const DEDUCTION_SHARE = 0.05;
/** The most pieces a SPLIT or a MERGE adds up. */
export const MAX_PARTS = 6;
/** How many candidates a SPLIT or MERGE search looks at, nearest first. */
const MAX_CANDIDATES = 24;
/** How many steps one subset search may take before it gives up. */
const SEARCH_BUDGET = 50_000;

const daysApart = (a: string, b: string): number =>
  Math.abs(dayjs(a).diff(dayjs(b), "day"));

/**
 * Two amounts one keystroke apart: same number of digits and one digit
 * different, or two neighbouring digits swapped. Compared on the digits of
 * the absolute values; the signs must already agree.
 */
export function isTypo(a: number, b: number): boolean {
  if (a === b) return false;
  const x = String(Math.abs(a));
  const y = String(Math.abs(b));
  if (x.length !== y.length) return false;
  const diff: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff.push(i);
  if (diff.length === 1) return true;
  if (diff.length === 2 && diff[1] === diff[0]! + 1) {
    const i = diff[0]!;
    return x[i] === y[i + 1] && x[i + 1] === y[i];
  }
  return false;
}

/**
 * The words on a bank-only line that say what it is (owner spec 2026-10-27).
 * Most specific first: "PAJAK BUNGA" contains "BUNGA".
 */
export function guessCategory(
  description: string,
  amount: number,
): CategoryGuess | undefined {
  const d = description.toUpperCase();
  const credit = amount > 0;
  if (d.includes("PAJAK BUNGA"))
    return { direction: "EXPENSE", reason: "BUNGA" };
  if (/BIAYA\s+ADM/.test(d)) return { direction: "EXPENSE", reason: "BUNGA" };
  if (d.includes("BUNGA"))
    return credit
      ? { direction: "INCOME", reason: "BUNGA" }
      : { direction: "EXPENSE", reason: "BUNGA" };
  if (d.includes("GAJI") && !credit)
    return { direction: "EXPENSE", reason: "PAYROLL" };
  if (/SETOR(AN)?\b.*(CDM|TUNAI)|\bCDM\b/.test(d) && credit)
    return { direction: "MOVE", reason: "CASH_TO_BANK" };
  if (/TARIK\s+TUNAI/.test(d) && !credit)
    return { direction: "MOVE", reason: "BANK_TO_CASH" };
  return undefined;
}

/**
 * A set of 2–`MAX_PARTS` amounts adding to `target`, as indexes, or
 * undefined. Every amount shares the target's sign; searched largest first so
 * a hopeless branch is cut as soon as it overshoots.
 */
function subsetSum(
  amounts: readonly number[],
  target: number,
): number[] | undefined {
  const goal = Math.abs(target);
  const order = amounts
    .map((a, i) => ({ a: Math.abs(a), i }))
    .filter((x) => x.a > 0 && x.a < goal)
    .sort((p, q) => q.a - p.a || p.i - q.i);
  // Suffix sums: what is still reachable from position k on.
  const rest: number[] = new Array(order.length + 1).fill(0);
  for (let k = order.length - 1; k >= 0; k--)
    rest[k] = rest[k + 1]! + order[k]!.a;
  let steps = 0;
  const picked: number[] = [];
  const walk = (k: number, left: number): boolean => {
    if (left === 0) return picked.length >= 2;
    if (picked.length === MAX_PARTS || k >= order.length) return false;
    if (rest[k]! < left || ++steps > SEARCH_BUDGET) return false;
    for (let j = k; j < order.length; j++) {
      const v = order[j]!.a;
      if (v > left) continue;
      picked.push(order[j]!.i);
      if (walk(j + 1, left - v)) return true;
      picked.pop();
      if (steps > SEARCH_BUDGET) return false;
    }
    return false;
  };
  return walk(0, goal) ? [...picked] : undefined;
}

const sameSign = (a: number, b: number) => a > 0 === b > 0;

/**
 * Match the statement's lines against the POS's movements. `lines` are the
 * ones still unmatched, in statement order; `movements` the ones no match
 * names yet, oldest first. Deterministic: the same input gives the same
 * answer, so a re-run proposes what the last one did.
 */
export function matchStatement(
  lines: readonly BankLine[],
  movements: readonly PosMovement[],
): MatchResult {
  const lineLeft = new Map(lines.map((l) => [l.id, l]));
  const moveLeft = new Map(movements.map((m) => [m.key, m]));
  const matched: Pairing[] = [];
  const suggestions: Suggestion[] = [];

  const take = (lineIds: string[], keys: string[]) => {
    for (const id of lineIds) lineLeft.delete(id);
    for (const k of keys) moveLeft.delete(k);
  };

  // 1–2. The same amount: the same day, then the nearest within the lag.
  for (const shift of [0, DATE_SHIFT_DAYS] as const) {
    for (const l of lines) {
      if (!lineLeft.has(l.id)) continue;
      let best: PosMovement | undefined;
      let bestGap = Infinity;
      for (const m of moveLeft.values()) {
        if (m.amount !== l.amount) continue;
        const gap = daysApart(l.date, m.date);
        if (gap > shift) continue;
        // The bank posting AFTER the POS is the usual lag; prefer it on a tie.
        const score = gap * 2 + (m.date > l.date ? 1 : 0);
        if (score < bestGap) {
          best = m;
          bestGap = score;
        }
      }
      if (best !== undefined) {
        matched.push({
          reason: best.date === l.date ? "EXACT" : "DATE_SHIFT",
          lineIds: [l.id],
          movementKeys: [best.key],
        });
        take([l.id], [best.key]);
      }
    }
  }

  // 3. One line, several movements.
  for (const l of lines) {
    if (!lineLeft.has(l.id)) continue;
    const near = [...moveLeft.values()]
      .filter(
        (m) =>
          sameSign(m.amount, l.amount) &&
          daysApart(m.date, l.date) <= NEAR_DAYS,
      )
      .sort((a, b) => daysApart(a.date, l.date) - daysApart(b.date, l.date))
      .slice(0, MAX_CANDIDATES);
    const hit = subsetSum(
      near.map((m) => m.amount),
      l.amount,
    );
    if (hit === undefined) continue;
    const keys = hit.map((i) => near[i]!.key);
    suggestions.push({ reason: "SPLIT", lineIds: [l.id], movementKeys: keys });
    take([l.id], keys);
  }

  // 4. Several lines, one movement.
  for (const m of movements) {
    if (!moveLeft.has(m.key)) continue;
    const near = lines
      .filter(
        (l) =>
          lineLeft.has(l.id) &&
          sameSign(l.amount, m.amount) &&
          daysApart(l.date, m.date) <= NEAR_DAYS,
      )
      .slice(0, MAX_CANDIDATES);
    const hit = subsetSum(
      near.map((l) => l.amount),
      m.amount,
    );
    if (hit === undefined) continue;
    const ids = hit.map((i) => near[i]!.id).sort();
    const ordered = lines.filter((l) => ids.includes(l.id)).map((l) => l.id);
    suggestions.push({
      reason: "MERGE",
      lineIds: ordered,
      movementKeys: [m.key],
    });
    take(ordered, [m.key]);
  }

  // 5. One keystroke apart.
  for (const l of lines) {
    if (!lineLeft.has(l.id)) continue;
    const m = [...moveLeft.values()].find(
      (x) =>
        sameSign(x.amount, l.amount) &&
        daysApart(x.date, l.date) <= NEAR_DAYS &&
        isTypo(x.amount, l.amount),
    );
    if (m === undefined) continue;
    suggestions.push({
      reason: "TYPO",
      lineIds: [l.id],
      movementKeys: [m.key],
      correctTo: l.amount,
    });
    take([l.id], [m.key]);
  }

  // 6. The bank got less than the POS says, by a fee's worth.
  for (const l of lines) {
    if (!lineLeft.has(l.id) || l.amount <= 0) continue;
    let best: PosMovement | undefined;
    for (const m of moveLeft.values()) {
      if (m.amount <= l.amount) continue;
      if (m.amount - l.amount > m.amount * DEDUCTION_SHARE) continue;
      if (daysApart(m.date, l.date) > DATE_SHIFT_DAYS) continue;
      if (best === undefined || m.amount - l.amount < best.amount - l.amount)
        best = m;
    }
    if (best === undefined) continue;
    suggestions.push({
      reason: "DEDUCTION",
      lineIds: [l.id],
      movementKeys: [best.key],
      fee: best.amount - l.amount,
    });
    take([l.id], [best.key]);
  }

  const bankOnly: BankOnly[] = lines
    .filter((l) => lineLeft.has(l.id))
    .map((l) => {
      const guess = guessCategory(l.description, l.amount);
      return guess === undefined ? { lineId: l.id } : { lineId: l.id, guess };
    });
  const posOnly = movements
    .filter((m) => moveLeft.has(m.key))
    .map((m) => m.key);
  return { matched, suggestions, bankOnly, posOnly };
}
