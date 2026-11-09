/**
 * The bot compares the reply it stored with its own templates ("did I just
 * ask the usage question?", "is this my holding line?"). Since 2026-11-09 the
 * stored reply has its emoji stripped (applyEmojiRule) while the templates
 * keep theirs — so every such comparison reads both sides without emoji
 * (final review, 2026-11-09).
 */
import { describe, expect, it } from "vitest";
import { applyEmojiRule, holdingMessage, isHoldingLine, ruleReplies as reply } from "../src/index.js";
import { askedAboutNeeds } from "../src/rules/replies.js";

const stored = (s: string) => applyEmojiRule(s, false);

describe("a stripped reply is still recognised as the template it came from", () => {
  it("a holding line", () => {
    expect(isHoldingLine(stored(holdingMessage("negotiation", true)))).toBe(true);
    expect(isHoldingLine(stored(holdingMessage("other", true)))).toBe(true);
  });

  it("the needs question, so it is not asked twice the same way", () => {
    const lacks = { usage: true, preferences: true, budget: true, apps: true };
    const first = reply.nextQuestion(lacks, "id", null)!;
    expect(askedAboutNeeds(stored(first))).toBe(true);
    expect(reply.nextQuestion(lacks, "id", stored(first))).not.toBe(first);
  });

  it("the second hello", () => {
    const first = reply.helloAgain("id", null);
    expect(reply.helloAgain("id", stored(first))).not.toBe(first);
  });
});
