/**
 * The audit's score (owner, 2026-11-23: "how many percent we get good,
 * detail it / break it down"): conversations good / could be better / bad,
 * bot replies flagged, and each category's flags and reach.
 */
import { describe, expect, it } from "vitest";
import { reviewScore, type ScoreWindow } from "../src/index.js";

const flag = (
  category: ScoreWindow["flags"][number]["category"],
  severity: "BAD" | "IMPROVE",
  messageId: string | null = "m1",
) => ({ category, severity, messageId });

describe("the review score", () => {
  it("splits conversations into good, could be better and bad", () => {
    const s = reviewScore([
      { flags: [], botReplies: 4 },
      { flags: [], botReplies: 2 },
      { flags: [flag("TONE", "IMPROVE")], botReplies: 3 },
      {
        flags: [flag("WRONG_FACT", "BAD", "a"), flag("TONE", "IMPROVE", "b")],
        botReplies: 5,
      },
    ]);
    expect(s).toMatchObject({ chats: 4, good: 2, couldBeBetter: 1, bad: 1 });
    expect(s.botReplies).toBe(14);
    // m1 in one window, a and b in another.
    expect(s.flaggedReplies).toBe(3);
  });

  it("counts a category's flags, bad ones and the conversations it reaches", () => {
    const s = reviewScore([
      {
        flags: [flag("TONE", "IMPROVE", "a"), flag("TONE", "BAD", "b")],
        botReplies: 3,
      },
      { flags: [flag("TONE", "IMPROVE")], botReplies: 1 },
    ]);
    expect(s.byCategory.find((c) => c.category === "TONE")).toEqual({
      category: "TONE",
      flags: 3,
      bad: 1,
      chats: 2,
    });
    expect(s.byCategory.find((c) => c.category === "OTHER")!.flags).toBe(0);
  });

  it("never reports more flagged replies than a window had, and is all zeros for nothing", () => {
    expect(
      reviewScore([
        {
          flags: [flag("TONE", "BAD", "a"), flag("TONE", "BAD", "b")],
          botReplies: 1,
        },
      ]).flaggedReplies,
    ).toBe(1);
    expect(reviewScore([])).toMatchObject({ chats: 0, good: 0, botReplies: 0 });
  });
});
