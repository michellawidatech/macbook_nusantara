/**
 * New or second — `lib/condition.ts`.
 *
 * The point of this file is that the condition is DERIVED. Nothing stores a
 * "new/second" flag, so the promises worth pinning down are the derivations:
 * which grades read as new, what each condition requires of QC, and what a
 * condition change does to the letter that was there.
 */
import { describe, expect, it } from "vitest";
import {
  canGrade,
  conditionOf,
  gradeForCondition,
  gradeRank,
  gradeText,
  isNew,
  needsDescription,
  NEW_GRADE,
  secondHandOnReturn,
} from "../src/lib/condition.js";

describe("conditionOf", () => {
  it("reads the schema's own NEW as new", () => {
    expect(conditionOf(NEW_GRADE)).toBe("NEW");
    expect(isNew("NEW")).toBe(true);
  });

  it("reads every letter as second-hand", () => {
    for (const g of ["A", "B", "C"]) expect(conditionOf(g)).toBe("SECOND");
  });

  it("reads an ungraded machine as second-hand, not as new", () => {
    // The safe default in both directions: a second-hand shop's stock is
    // second-hand, and the description gate stays on until somebody says
    // otherwise rather than switching off for a machine nobody has touched.
    expect(conditionOf(undefined)).toBe("SECOND");
    expect(conditionOf(null)).toBe("SECOND");
    expect(conditionOf("")).toBe("SECOND");
  });

  it("does not treat a lower-case new as the schema value", () => {
    // `Unit.grade` is an enum in prisma. Anything else is not a grade, and
    // guessing at it here would let a typo pass as sealed stock.
    expect(conditionOf("new")).toBe("SECOND");
  });
});

describe("what a condition requires", () => {
  it("makes a description compulsory only for a second-hand machine", () => {
    expect(needsDescription("SECOND")).toBe(true);
    expect(needsDescription("NEW")).toBe(false);
  });

  it("offers the grading checklist only for a second-hand machine", () => {
    expect(canGrade("SECOND")).toBe(true);
    expect(canGrade("NEW")).toBe(false);
  });
});

describe("gradeForCondition", () => {
  it("writes NEW when a machine is marked new", () => {
    expect(gradeForCondition("NEW", undefined)).toBe(NEW_GRADE);
    expect(gradeForCondition("NEW", "B")).toBe(NEW_GRADE);
  });

  it("clears NEW when a machine is marked second, rather than guessing a letter", () => {
    // An ungraded second-hand machine is honest; an invented A is the exact
    // unfounded letter lib/grading.ts exists to get rid of.
    expect(gradeForCondition("SECOND", NEW_GRADE)).toBeUndefined();
  });

  it("leaves an existing letter alone", () => {
    expect(gradeForCondition("SECOND", "B")).toBe("B");
    expect(gradeForCondition("SECOND", undefined)).toBeUndefined();
  });
});

describe("secondHandOnReturn", () => {
  it("flags a machine that went out sealed and is coming back", () => {
    expect(secondHandOnReturn(NEW_GRADE)).toBe(true);
  });

  it("says nothing changes for one that was already second-hand", () => {
    expect(secondHandOnReturn("A")).toBe(false);
    expect(secondHandOnReturn(undefined)).toBe(false);
  });
});

describe("gradeText", () => {
  it("writes NEW as the word the caller translated", () => {
    expect(gradeText("NEW", "New")).toBe("New");
    expect(gradeText("NEW", "Baru")).toBe("Baru");
  });

  it("leaves a letter as a letter", () => {
    expect(gradeText("A", "New")).toBe("A");
  });

  it("returns null for a machine with no grade, so a cell can say so itself", () => {
    expect(gradeText(undefined, "New")).toBeNull();
    expect(gradeText("", "New")).toBeNull();
  });
});

describe("gradeRank", () => {
  it("puts sealed stock ahead of every letter", () => {
    // The bug this replaces: ranking by character code put NEW (78) behind
    // C (67), listing a sealed machine as the worst thing on the shelf.
    expect(gradeRank(NEW_GRADE)).toBeLessThan(gradeRank("A"));
  });

  it("orders the letters best first and leaves ungraded last", () => {
    const sorted = ["C", undefined, "A", "NEW", "B"].sort(
      (a, b) => gradeRank(a) - gradeRank(b),
    );
    expect(sorted).toEqual(["NEW", "A", "B", "C", undefined]);
  });
});
