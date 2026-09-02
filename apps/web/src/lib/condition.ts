/**
 * New or second — the two conditions a machine can be in (owner ask
 * 2026-08-28).
 *
 * ## It rides on `Unit.grade`, and that is not a shortcut
 *
 * The owner put it as one sentence: *"if it's new, the grade is new, however
 * if used, show the grade A/B"*. So the two facts are not two facts. A machine
 * is either sealed — in which case there is nothing to inspect and `NEW` is
 * the whole answer — or it is second-hand, in which case the answer is the
 * letter an inspection concluded. One column says both, and prisma has already
 * had the value for it since migration
 * `20260824004737_grade_new_for_sealed_stock` — whose name says what it
 * was added for:
 *
 * ```prisma
 * enum Grade { A  B  C  NEW }
 * ```
 *
 * `GRADE_LADDER` in the seed has been handing `NEW` out to sealed accessories
 * all along. This module is the meaning of that value written down, so the six
 * screens that show a grade stop each having their own opinion about it.
 *
 * The alternative was a `Unit.condition` column beside the grade, and it would
 * have been a column that can disagree with itself: a row saying SECOND with a
 * grade of NEW is a contradiction the database would have to be trusted not to
 * write. CLAUDE.md's rule — never invent schema — points the same way. **No
 * migration is needed for any of this.**
 *
 * ## What the condition decides
 *
 * | | description | grading |
 * |---|---|---|
 * | **Second** | required before QC accepts it | offered, optional |
 * | **New** | optional | not offered — there is nothing to inspect |
 *
 * That is the owner's rule, and `needsDescription` / `canGrade` are it. The
 * QC grid, the accept gate and the group counters all read those two rather
 * than testing the letter themselves.
 *
 * ## The one-way door
 *
 * A new machine that is sold and comes back is second-hand — it has been
 * somebody's. `CustomerReturnPanel` regrades it on arrival, which is nothing
 * more than writing a letter over the `NEW`, and this module's derivation
 * means the whole app reads the change the moment it lands. See
 * `secondHandOnReturn`.
 *
 * Pure: no React, no store. `test/condition.test.ts` is where the promises
 * above are checked.
 */

/** The shop's two conditions. */
export type UnitCondition = "NEW" | "SECOND";

/**
 * Both of them, in the order a control offers them.
 *
 * Second first, because it is what almost everything in this shop is — the
 * sealed machine is the exception, and a list that leads with the exception
 * puts the wrong default under the first click.
 *
 * The words are not here. Every screen writes its own translation call at the
 * call site, the way `gradeText` explains: the i18n sweep reads the source for
 * a key-and-English pair, so a label defined in a module constant is a label
 * the Indonesian check cannot see. (This paragraph deliberately does not spell
 * one out — the sweep would read the example as a real call site.)
 */
export const CONDITIONS: readonly UnitCondition[] = ["SECOND", "NEW"];

/**
 * The grade value that means "sealed". Prisma's `Grade.NEW`, quoted once here
 * so no screen spells it itself.
 */
export const NEW_GRADE = "NEW";

/**
 * What condition a stored grade puts a machine in.
 *
 * Everything that is not `NEW` is second-hand, **including an ungraded
 * machine**. That is the right default for a second-hand shop and it is also
 * the safe one: a machine nobody has said anything about is not a machine to
 * advertise as sealed, and the description gate stays on until somebody
 * deliberately says otherwise.
 */
export function conditionOf(grade: string | undefined | null): UnitCondition {
  return grade === NEW_GRADE ? "NEW" : "SECOND";
}

/** True when the machine is sealed stock. */
export function isNew(grade: string | undefined | null): boolean {
  return conditionOf(grade) === "NEW";
}

/**
 * Must QC write a description before this machine can be accepted?
 *
 * Only for a second-hand one. A sealed machine's condition is its condition —
 * "Mulus, fullset dus" is a sentence about a box nobody has opened — whereas a
 * used one that reaches the shelf with nothing written about it is one nobody
 * can list or answer a question about later. That gate predates this file; all
 * that changed is which machines it applies to.
 */
export function needsDescription(condition: UnitCondition): boolean {
  return condition === "SECOND";
}

/**
 * Is the grading checklist available on this machine?
 *
 * No, when it is new: there is no screen to look at and no case to mark, so a
 * checklist would be a form asking about a machine nobody has opened. The QC
 * grid hides the button rather than disabling it — a control that can never
 * apply is not a control.
 */
export function canGrade(condition: UnitCondition): boolean {
  return condition === "SECOND";
}

/**
 * The letter a machine carries into a condition change.
 *
 * Switching to New writes `NEW` over whatever was there. Switching to Second
 * clears the grade rather than guessing a letter — an ungraded second-hand
 * machine is an honest state (the grid says "—" and offers the checklist), and
 * inventing an `A` for a machine nobody has inspected is exactly the
 * unfounded letter `lib/grading.ts` was written to get rid of.
 *
 * Returns `undefined` for "no grade", which is what `Unit.grade` holds when a
 * machine has not been inspected.
 */
export function gradeForCondition(
  condition: UnitCondition,
  current: string | undefined,
): string | undefined {
  if (condition === "NEW") return NEW_GRADE;
  return current === NEW_GRADE ? undefined : current;
}

/**
 * A machine coming back from a customer is second-hand, whatever it went out
 * as (owner ask 2026-08-28).
 *
 * Sealed is a claim about a box, and the box has been opened. So the return
 * desk regrades: this says whether the machine that is coming back needs that
 * conversation to be a *change* rather than a formality — which is what the
 * return panel uses to explain itself to the person at the counter.
 */
export function secondHandOnReturn(grade: string | undefined): boolean {
  return isNew(grade);
}

/**
 * How a grade is written on screen.
 *
 * `NEW` is stored in the schema's shouting case and is a word, not a letter,
 * so it is the one value that reads wrong shown raw beside an `A` and a `B`.
 * The letters are letters and are returned untouched.
 *
 * Not translated here on purpose — the caller passes `t("grade.new", "New")`
 * so the string reaches the i18n sweep at its call site, the way every other
 * user-facing word in this app does.
 */
export function gradeText(
  grade: string | undefined | null,
  newWord: string,
): string | null {
  if (grade == null || grade === "") return null;
  return grade === NEW_GRADE ? newWord : grade;
}

/**
 * Sort order for a grade: best first, `NEW` ahead of every letter, ungraded
 * last.
 *
 * Explicit rather than `charCodeAt`, which is what this used to be and which
 * put `NEW` (78) behind `C` (67) — a sealed machine listed as the worst thing
 * on the shelf.
 */
export function gradeRank(grade: string | undefined | null): number {
  if (grade === NEW_GRADE) return 0;
  if (grade === "A") return 1;
  if (grade === "B") return 2;
  if (grade === "C") return 3;
  return 99;
}
