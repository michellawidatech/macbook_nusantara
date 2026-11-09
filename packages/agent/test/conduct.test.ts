/**
 * One rulebook (plan Task 11, 2026-11-09). The rules the audit found said
 * two ways — a tool note offering "Mau lihat fotonya kak?" while the prompt
 * forbade it, "saya" beside "aku", "grade A" beside "no grade letter", a
 * photo tool that "picks the most expensive" while the code picked the
 * cheapest — are written once, in conduct.ts, and everything the model
 * reads is checked here for the old wording.
 *
 * And the owner's rule of 2026-11-09: emoji only at the beginning of the
 * chat. A model copies what it reads, so the rules carry no emoji either.
 */
import { describe, expect, it } from "vitest";
import { CONDUCT, conductFor } from "../src/conduct.js";
import {
  DEFAULT_PERSONA,
  SHOP_CAPABILITIES,
  buildAgentPrompt,
  toolsFor,
  type ToolContext,
} from "../src/index.js";
import { OTHER_GRADES_NOTE, PHOTOS_NOTE, WATCH_NOTE } from "../src/tools.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const OLD_WORDING = [
  /offer to show photos/i,
  /grade [ABC] juga/i,
  /\bMau saya\b/,
  /most expensive/i,
  /Three short WhatsApp sentences/i,
  /kapan enaknya/i,
];

const prompt = buildAgentPrompt({
  persona: DEFAULT_PERSONA,
  capabilities: { ...SHOP_CAPABILITIES, reserve: true },
  storeFacts: "Buka 10.00-20.00",
  knowledge: "",
  corrections: [],
  now: new Date("2026-11-09T04:00:00.000Z"),
  openNow: true,
}).stable;
const ctx = {
  from: "62811",
  now: new Date(),
  capabilities: SHOP_CAPABILITIES,
  profile: { write: {} },
} as unknown as ToolContext;
const tools = toolsFor(ctx, {
  capabilities: { ...SHOP_CAPABILITIES, reserve: true },
  proposals: true,
})
  .map((t) => `${t.name}: ${t.description}`)
  .join("\n");
const notes = [OTHER_GRADES_NOTE, PHOTOS_NOTE, WATCH_NOTE].join("\n");

describe("one rulebook", () => {
  it("has the emoji rule and every prompt rule reaches the prompt", () => {
    expect(CONDUCT.map((r) => r.id)).toContain("emoji");
    for (const rule of CONDUCT.filter((r) => r.where.includes("prompt")))
      expect(prompt, rule.id).toContain(rule.text);
  });

  it.each(OLD_WORDING.map((re) => [re]))(
    "nothing the model reads still says %s",
    (re) => {
      expect(prompt).not.toMatch(re);
      expect(tools).not.toMatch(re);
      expect(notes).not.toMatch(re);
    },
  );

  it("the rules and the notes carry no emoji for the model to copy", () => {
    expect(prompt).not.toMatch(EMOJI);
    expect(notes).not.toMatch(EMOJI);
  });

  it("the tool notes are the rulebook's words", () => {
    expect(WATCH_NOTE).toContain(conductFor("tool:watch"));
    expect(PHOTOS_NOTE).toContain(conductFor("tool:photos"));
    expect(OTHER_GRADES_NOTE).toContain(conductFor("tool:grades"));
  });
});

describe("a burst of questions is one reply to all of them (2026-11-09, Task 13)", () => {
  it("the prompt says to answer every question they asked", () => {
    expect(prompt).toMatch(/every question/i);
  });
});
