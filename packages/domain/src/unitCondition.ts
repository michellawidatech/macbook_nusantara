/**
 * What the bot may say about one unit, and in what order it offers a shelf
 * (owner, 2026-10-28).
 *
 * Three readings, each a rule rather than a model's judgement, so the AI and
 * the rules bot cannot disagree about them:
 *
 *  - `splitCondition` — the QC description is phrases joined by ", ". A
 *    functional fault or a missing item is said UPFRONT, because a customer
 *    who finds a lined screen at the counter has been misled; a cosmetic mark
 *    is said only when asked, because volunteering every hairline scratch
 *    talks a customer out of a good unit. A phrase nobody listed — a
 *    free-typed one included — is a mark.
 *  - `servicedState` — "belum pernah servis" is a promise, so it is made only
 *    when QC said so AND no service visit since contradicts it. Blank at QC is
 *    unknown, and unknown says nothing.
 *  - `offerLadder` — the cheapest unit first: lowest grade, then lowest price,
 *    then one line per other grade. Leading with the dearest unit priced the
 *    shop out of the chat before the customer had seen what fits.
 *
 * Pure.
 */

/** Functional faults and missing items — said upfront. Everything else is a mark. */
export const UNIT_FAULT_PHRASES: readonly string[] = [
  "Layar ada garis",
  "Keyboard aus",
  "Engsel longgar",
  "Baterai lemah",
  "Tanpa charger",
  "Unit only",
];

const FAULT_KEYS = new Set(UNIT_FAULT_PHRASES.map((p) => p.toLowerCase()));

/** The description's phrases, split by code into faults and marks, in order. */
export function splitCondition(description: string | null | undefined): {
  faults: string[];
  marks: string[];
} {
  const faults: string[] = [];
  const marks: string[] = [];
  for (const raw of (description ?? "").split(",")) {
    const phrase = raw.trim();
    if (!phrase) continue;
    (FAULT_KEYS.has(phrase.toLowerCase()) ? faults : marks).push(phrase);
  }
  return { faults, marks };
}

export type ServicedState = "never" | "yes";

/**
 * A visit outranks QC's answer: a unit sent to the bench after QC said
 * "never opened" has been opened.
 */
export function servicedState(input: {
  neverServiced: boolean | null | undefined;
  visits: number;
}): ServicedState | undefined {
  if (input.visits > 0) return "yes";
  if (input.neverServiced === false) return "yes";
  if (input.neverServiced === true) return "never";
  return undefined;
}

/** Lowest grade first. A grade not on it (or none) ranks after NEW. */
export const GRADE_LADDER = ["C", "B", "A", "NEW"] as const;

export interface LadderUnit {
  serial: string;
  grade?: string | null;
  price: bigint | null;
  skuId: string;
}

const gradeOf = (u: LadderUnit): string => u.grade ?? "";

function rank(grade: string): number {
  const i = (GRADE_LADDER as readonly string[]).indexOf(grade);
  return i < 0 ? GRADE_LADDER.length : i;
}

/** Plain code-point order — not `localeCompare`, which differs by machine. */
const cmp = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** Ladder order, then grade name, so two unknown grades order the same way every time. */
function byGrade(a: string, b: string): number {
  return rank(a) - rank(b) || cmp(a, b);
}

/** Cheapest first; an unpriced unit last; the serial breaks a tie. */
function byPrice(a: LadderUnit, b: LadderUnit): number {
  if (a.price !== b.price) {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price < b.price ? -1 : 1;
  }
  return cmp(a.serial, b.serial);
}

/**
 * The offer for one variant: `lead` is the unit to recommend, `grades` one
 * line per OTHER grade on the shelf (its cheapest unit, `from` that unit's
 * price, `count` how many of that grade), in ladder order — so the model
 * reads the order instead of sorting.
 */
export function offerLadder<T extends LadderUnit>(
  units: readonly T[],
  skuId: string,
): {
  lead: T | null;
  grades: Array<{ grade: string; from: bigint | null; count: number; unit: T }>;
} {
  const groups = new Map<string, T[]>();
  for (const unit of units) {
    if (unit.skuId !== skuId) continue;
    const g = gradeOf(unit);
    const list = groups.get(g);
    if (list) list.push(unit);
    else groups.set(g, [unit]);
  }
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => byGrade(a, b))
    .map(([grade, list]) => {
      const unit = [...list].sort(byPrice)[0]!;
      return { grade, from: unit.price, count: list.length, unit };
    });
  return {
    lead: ordered[0]?.unit ?? null,
    grades: ordered.slice(1),
  };
}
