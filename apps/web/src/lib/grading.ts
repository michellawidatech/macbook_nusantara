/**
 * Grading: how a QC inspection becomes an A, a B or a C.
 *
 * ## What the owner asked for (2026-08-27)
 *
 * `Unit.grade` used to be a letter somebody typed with nothing behind it — the
 * seed handed grades out and QC never set one. Now the grade is the CONCLUSION
 * of an inspection: Settings holds, per product category, the criteria a
 * machine is checked against (Screen, Body, Ports…), the conditions each
 * criterion can be found in ("Like new", "Little scratch", "Yellow screen"),
 * and the combinations that add up to each grade. QC picks a condition per
 * criterion and the grade falls out — still overridable, because a rule table
 * cannot see the machine.
 *
 * ## Per CATEGORY, not per model
 *
 * A MacBook and an iPad are inspected for different things — an iPad has no
 * keyboard to test — so the configuration hangs off `CatalogModel.category`,
 * which is the same string the catalogue chips and the import screen use.
 *
 * ## How a rule reads
 *
 * A rule is one grade plus zero or more conditions, each condition naming a
 * criterion and the options that SATISFY it. Rules are checked top to bottom
 * and the first that fits wins:
 *
 * - a rule fits when every one of its conditions is met by the inspection —
 *   the chosen option for that criterion is one of the condition's options;
 * - a criterion a rule says nothing about does not constrain it;
 * - a rule with NO conditions fits every machine. That is the catch-all, and
 *   it belongs last — "A: everything like new; B: nothing worse than light
 *   marks; C: otherwise" is exactly the shape the owner described.
 *
 * An inspection that leaves a rule's criterion unanswered does not meet that
 * condition: a machine cannot be called A on a screen nobody looked at.
 *
 * Pure: no React, no store. The Settings tab edits these rows, the QC modal
 * calls `computeGrade`, and the test file reads this instead of the screens.
 *
 * ⚠️ Schema gap: prisma has none of this. It needs three tables —
 * `GradingCriterion`, `GradingOption`, `GradingRule` (+ its conditions) — on
 * the same footing as `QcDescription`: an owner decision plus a migration
 * before the API can carry it. `Unit.grade` itself already exists.
 */

/** A condition a criterion can be found in — one entry of its dropdown. */
export interface GradingOption {
  id: string;
  label: string;
}

/** One thing QC inspects on a category of machine — "Screen", "Ports". */
export interface GradingCriterion {
  id: string;
  /** Which product category this applies to. Matches `CatalogModel.category`. */
  category: string;
  name: string;
  /** Ordered best-first; the order is how the dropdown lists them. */
  options: GradingOption[];
}

/** One condition of a rule: the options that satisfy it for one criterion. */
export interface GradingCondition {
  criterionId: string;
  /** Chosen option must be one of these. Never empty — that is "no condition". */
  optionIds: string[];
}

/**
 * One line of a category's grade table, e.g. "A: Screen is like new and Ports
 * are fully functional". Array order in `MockDb.gradingRules` is evaluation
 * order.
 */
export interface GradingRule {
  id: string;
  category: string;
  /** "A" | "B" | "C" — see `GRADES`. */
  grade: string;
  conditions: GradingCondition[];
}

/**
 * The grades a rule (or an override) can conclude, best first.
 *
 * `NEW` is deliberately NOT here. It is a condition rather than an inspection
 * result — a sealed machine has nothing to inspect, so no rule may conclude it
 * and no override may pick it. The QC grid's condition toggle is the only
 * thing that writes it. See `lib/condition.ts`.
 */
export const GRADES = ["A", "B", "C"] as const;

/**
 * The antd tag colour a grade wears, wherever one is shown. A letter typed
 * before this existed falls through to the default grey, which is what an
 * unmapped Tag color renders anyway.
 *
 * `NEW` is in here as of 2026-08-28 and is not a fourth letter: it is prisma's
 * own `Grade.NEW`, and it is how this app records that a machine is sealed
 * rather than second-hand — see `lib/condition.ts`. Blue rather than a fourth
 * point on the green-to-red scale, because it is not a better A; it is a
 * different kind of answer.
 */
export const GRADE_COLOR: Record<string, string> = {
  NEW: "blue",
  A: "green",
  B: "gold",
  C: "volcano",
};

/** What the QC inspector picked: criterion id → chosen option id. */
export type GradingSelection = Record<string, string | undefined>;

export function criteriaFor(
  criteria: readonly GradingCriterion[],
  category: string,
): GradingCriterion[] {
  return criteria.filter((c) => c.category === category);
}

export function rulesFor(
  rules: readonly GradingRule[],
  category: string,
): GradingRule[] {
  return rules.filter((r) => r.category === category);
}

/** Does this inspection meet every condition of the rule? */
function fits(rule: GradingRule, selection: GradingSelection): boolean {
  return rule.conditions.every((cond) => {
    const chosen = selection[cond.criterionId];
    return chosen !== undefined && cond.optionIds.includes(chosen);
  });
}

/**
 * The grade an inspection concludes, or null when no rule fits.
 *
 * Null rather than a default letter: a category whose rules have no catch-all
 * has told us nothing about this combination, and inventing a grade would be
 * the table pretending to an opinion it does not hold. The QC modal shows the
 * gap and lets the person decide — which is also what the override is for.
 */
export function computeGrade(
  rules: readonly GradingRule[],
  category: string,
  selection: GradingSelection,
): string | null {
  for (const rule of rulesFor(rules, category)) {
    if (fits(rule, selection)) return rule.grade;
  }
  return null;
}

/**
 * An inspection said in words — "Screen: Like new · Ports: One dead port" —
 * for the note the grade leaves behind. Criteria order, skipping the
 * unanswered.
 */
export function describeSelection(
  criteria: readonly GradingCriterion[],
  category: string,
  selection: GradingSelection,
): string {
  return criteriaFor(criteria, category)
    .map((c) => {
      const chosen = c.options.find((o) => o.id === selection[c.id]);
      return chosen ? `${c.name}: ${chosen.label}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}
