/**
 * The rule table that turns a QC inspection into a grade — `lib/grading.ts`.
 *
 * What matters here is the SEMANTICS the Settings screen promises: rules are
 * checked top to bottom, the first that fits wins, an unanswered criterion
 * never satisfies a condition, and a rule with no conditions is the catch-all.
 * The screens render what these functions return; this file is where the
 * promises are written down.
 */
import { describe, expect, it } from "vitest";
import {
  computeGrade,
  criteriaFor,
  describeSelection,
  type GradingCriterion,
  type GradingRule,
} from "../src/lib/grading.js";

const CRITERIA: GradingCriterion[] = [
  {
    id: "screen",
    category: "MacBook Pro",
    name: "Screen",
    options: [
      { id: "screen-new", label: "Like new" },
      { id: "screen-scratch", label: "Little scratch" },
      { id: "screen-yellow", label: "Yellow screen" },
    ],
  },
  {
    id: "ports",
    category: "MacBook Pro",
    name: "Ports",
    options: [
      { id: "ports-full", label: "Fully functional" },
      { id: "ports-partial", label: "Partly working" },
    ],
  },
];

const RULES: GradingRule[] = [
  {
    id: "a",
    category: "MacBook Pro",
    grade: "A",
    conditions: [
      { criterionId: "screen", optionIds: ["screen-new"] },
      { criterionId: "ports", optionIds: ["ports-full"] },
    ],
  },
  {
    id: "b",
    category: "MacBook Pro",
    grade: "B",
    conditions: [
      { criterionId: "screen", optionIds: ["screen-new", "screen-scratch"] },
    ],
  },
  { id: "c", category: "MacBook Pro", grade: "C", conditions: [] },
];

describe("computeGrade", () => {
  it("concludes A when every condition of the first rule is met", () => {
    expect(
      computeGrade(RULES, "MacBook Pro", {
        screen: "screen-new",
        ports: "ports-full",
      }),
    ).toBe("A");
  });

  it("falls to the next rule when one condition fails", () => {
    // A little scratch takes A off the table; B tolerates it and says
    // nothing about ports, so ports do not constrain it.
    expect(
      computeGrade(RULES, "MacBook Pro", {
        screen: "screen-scratch",
        ports: "ports-partial",
      }),
    ).toBe("B");
  });

  it("lands on the catch-all when nothing better fits", () => {
    expect(
      computeGrade(RULES, "MacBook Pro", { screen: "screen-yellow" }),
    ).toBe("C");
  });

  it("does not grade A on a screen nobody looked at", () => {
    // Ports alone would satisfy A's ports condition, but the screen is
    // unanswered — a machine cannot be called A on an unchecked criterion.
    // Nothing else fits either except the catch-all.
    expect(computeGrade(RULES, "MacBook Pro", { ports: "ports-full" })).toBe(
      "C",
    );
  });

  it("returns null when no rule fits — no invented default", () => {
    const noCatchAll = RULES.filter((r) => r.conditions.length > 0);
    expect(
      computeGrade(noCatchAll, "MacBook Pro", { screen: "screen-yellow" }),
    ).toBeNull();
  });

  it("only reads the rules of the asked-for category", () => {
    expect(computeGrade(RULES, "iPad", { screen: "screen-new" })).toBeNull();
  });

  it("first fit wins — order is the tie-break, not the grade letter", () => {
    // A catch-all placed FIRST shadows everything below it. That is the
    // behaviour the Settings screen warns about, so it is pinned here.
    const shadowed: GradingRule[] = [RULES[2]!, RULES[0]!];
    expect(
      computeGrade(shadowed, "MacBook Pro", {
        screen: "screen-new",
        ports: "ports-full",
      }),
    ).toBe("C");
  });
});

describe("criteriaFor", () => {
  it("filters to the category", () => {
    expect(criteriaFor(CRITERIA, "MacBook Pro")).toHaveLength(2);
    expect(criteriaFor(CRITERIA, "iPad")).toHaveLength(0);
  });
});

describe("describeSelection", () => {
  it("says the inspection in words, skipping the unanswered", () => {
    expect(
      describeSelection(CRITERIA, "MacBook Pro", { screen: "screen-scratch" }),
    ).toBe("Screen: Little scratch");
  });

  it("is empty when nothing was answered", () => {
    expect(describeSelection(CRITERIA, "MacBook Pro", {})).toBe("");
  });
});
