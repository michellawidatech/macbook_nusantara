/**
 * "No approved answer matches … Otherwise hand over" rode on almost every
 * message (audit round 2, A2), and the search_knowledge and reply tool
 * descriptions said the same. With the shelf live that contradicts the
 * prompt's own rule — never hand over just because no answer matches — and
 * was behind most of the 27–29 Oct "Bentar ya kak" replies.
 */
import { describe, expect, it } from "vitest";
import {
  SHOP_CAPABILITIES,
  knowledgeBase,
  matchesNote,
  toolsFor,
  type ToolContext,
} from "../src/index.js";

const KB = knowledgeBase([
  { id: "k1", question: "Garansi berapa lama?", answer: "1 bulan ya kak" },
]);
const ctx = {
  from: "62811",
  now: new Date(),
  capabilities: SHOP_CAPABILITIES,
} as unknown as ToolContext;

describe("no approved answer matches (2026-11-06, H1)", () => {
  it("with the shelf live, says to answer from the shelf or the chat, not to hand over", () => {
    const note = matchesNote(KB, [], { live: true });
    expect(note).not.toMatch(/hand over/i);
    expect(note).toMatch(/answer from the shelf or the chat/i);
  });

  it("without the shelf, the cautious wording stays", () => {
    expect(matchesNote(KB, [])).toMatch(/hand over/i);
  });

  it("neither tool description sends an unmatched question to a colleague", () => {
    const tools = toolsFor(ctx, { capabilities: SHOP_CAPABILITIES });
    for (const name of ["search_knowledge", "reply"]) {
      const d = tools.find((t) => t.name === name)?.description ?? "";
      expect(d, name).not.toMatch(
        /a colleague must|use handoff_to_staff (instead|rather)/i,
      );
    }
  });
});
