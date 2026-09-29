/**
 * One payment spread over a party's unpaid documents, oldest first.
 *
 * ## The owner's ask (2026-09-22)
 *
 * > *"Imagine we put 10mil and have 5 bills (5mil, 2mil, 4mil, 2mil, 1mil in
 * > this order), it means that the system will automatically select the 5 mil
 * > paid in full, 2 mil paid in full, then 4 mil paid only 3mil, and the rest
 * > is not paid yet … if the amount is not filled yet, the row is still
 * > selectable and it will auto calculate the amount of money … later if the
 * > user edit the auto-calculated number, it will auto-deduct the amount per
 * > transaction on the newest transaction."*
 *
 * Asked how a changed number moves the rows, the owner answered: **only the
 * total is typed**, and the rows follow it. Lowering the total empties the
 * newest bill first; raising it fills the next-oldest.
 *
 * ## The one model that answers every case
 *
 * Three pieces of state, and the rows are derived from them every render:
 *
 * - `amount` — the figure typed, or `null` while nobody has typed one;
 * - `picked` — rows somebody ticked by hand;
 * - `skipped` — rows somebody UNticked by hand.
 *
 * With no amount, a picked row is paid in full and the amount box shows the
 * sum — the "auto calculate" half of the ask. With an amount, the money goes
 * to the picked rows first, oldest first, so the newest of them is the one a
 * smaller figure cuts; then what is left spills over every row nobody
 * skipped, oldest first — the "automatically select from the oldest" half.
 * Typing the amount first is simply the case where nothing was picked.
 *
 * `skipped` exists because a spill-filled row was never picked: without it,
 * unticking one would do nothing, since the next render would spill straight
 * back into it.
 *
 * Pure: no React, no store. `test/allocatePayment.test.ts` is the spec.
 */

/** One document that can take money. Rows are passed OLDEST first. */
export interface AllocatableRow {
  readonly key: string;
  /** What is still owed on it. */
  readonly owed: number;
}

export interface AllocationState {
  /** The amount typed, or `null` while nobody has typed one. */
  readonly amount: number | null;
  /** Rows ticked by hand. */
  readonly picked: readonly string[];
  /** Rows unticked by hand — kept out of the spill. */
  readonly skipped: readonly string[];
}

export const EMPTY_ALLOCATION: AllocationState = {
  amount: null,
  picked: [],
  skipped: [],
};

/** Green, yellow, or nothing (owner ask). */
export type AllocationStatus = "FULL" | "PARTIAL" | "NONE";

export interface AllocationLine {
  readonly key: string;
  readonly owed: number;
  readonly paid: number;
  readonly status: AllocationStatus;
  /**
   * What the row's checkbox shows: it takes money, or somebody ticked it.
   *
   * A picked row the money did not reach stays ticked. Unticking it
   * silently would make the click that ticked it look as if it had done
   * nothing, and raising the amount brings the money back to it.
   */
  readonly ticked: boolean;
}

export interface Allocation {
  readonly lines: readonly AllocationLine[];
  /** What the amount box shows: the typed figure, or Σ owed of what is picked. */
  readonly amount: number;
  /** True while nobody has typed an amount, so the box shows the picked rows' sum. */
  readonly auto: boolean;
  /** Σ paid over every row. */
  readonly allocated: number;
  /** Money beyond every row the fill may reach. */
  readonly leftover: number;
  /** How many rows take money. */
  readonly count: number;
}

export function allocate(
  rows: readonly AllocatableRow[],
  state: AllocationState,
): Allocation {
  const picked = new Set(state.picked);
  const skipped = new Set(state.skipped);
  const paid = new Map<string, number>();

  let amount: number;
  let left: number;
  if (state.amount === null) {
    for (const r of rows) if (picked.has(r.key)) paid.set(r.key, owedOf(r));
    amount = [...paid.values()].reduce((n, v) => n + v, 0);
    left = 0;
  } else {
    amount = Math.max(0, Math.round(state.amount));
    left = amount;
    const fill = (r: AllocatableRow) => {
      const take = Math.min(owedOf(r), left);
      if (take > 0) paid.set(r.key, take);
      left -= take;
    };
    for (const r of rows) if (picked.has(r.key)) fill(r);
    for (const r of rows) {
      if (picked.has(r.key) || skipped.has(r.key)) continue;
      fill(r);
    }
  }

  const lines = rows.map((r): AllocationLine => {
    const p = paid.get(r.key) ?? 0;
    const owed = owedOf(r);
    return {
      key: r.key,
      owed,
      paid: p,
      status: p <= 0 ? "NONE" : p >= owed ? "FULL" : "PARTIAL",
      ticked: p > 0 || picked.has(r.key),
    };
  });
  const allocated = lines.reduce((n, l) => n + l.paid, 0);
  return {
    lines,
    amount,
    auto: state.amount === null,
    allocated,
    leftover: Math.max(0, left),
    count: lines.filter((l) => l.paid > 0).length,
  };
}

/**
 * A click on a row's checkbox.
 *
 * Against the ROW AS DRAWN: a row the spill ticked is unticked by being
 * skipped, and a row the person ticks is picked, whatever it was before.
 */
export function toggleRow(
  state: AllocationState,
  current: Allocation,
  key: string,
): AllocationState {
  const line = current.lines.find((l) => l.key === key);
  if (!line) return state;
  const picked = state.picked.filter((k) => k !== key);
  const skipped = state.skipped.filter((k) => k !== key);
  return line.ticked
    ? { ...state, picked, skipped: [...skipped, key] }
    : { ...state, picked: [...picked, key], skipped };
}

/** The amount box changed. Empty is `null`: back to adding up the ticks. */
export function setAmount(
  state: AllocationState,
  amount: number | null,
): AllocationState {
  return { ...state, amount };
}

/** Never negative: a row that owes nothing takes nothing. */
function owedOf(r: AllocatableRow): number {
  return Math.max(0, Math.round(r.owed));
}
