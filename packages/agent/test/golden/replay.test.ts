/**
 * The replay suite (docs/superpowers/plans/2026-11-06-chatbot-repair.md,
 * Task 1). Every case in `cases.ts` runs here; a case carrying a `finding`
 * is expected to fail until its fix lands, so the suite is green today and
 * each fix turns its cases into ordinary tests.
 *
 * The tally at the end is the baseline the fixes are measured against.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import * as agent from "../../src/index.js";
import * as reader from "../../src/rules/understand.js";
import {
  SHOP_CAPABILITIES,
  checkReply,
  knowledgeBase,
  routeMessage,
  runRules,
  type AgentCapabilities,
  type RulesInput,
  type RulesResult,
  type ToolContext,
} from "../../src/index.js";
import { CASES, type GoldenCase } from "./cases.js";
import { shelfDispatch } from "./shelf.js";

/** Thursday 29 October 2026, 11:00 Jakarta: the shop is open. */
const NOW = new Date("2026-10-29T04:00:00.000Z");
const LIVE: AgentCapabilities = { ...SHOP_CAPABILITIES, reserve: true };

const KB = knowledgeBase([
  { id: "k1", question: "Garansi berapa lama kak?", answer: "Garansi dari kami 1 bulan ya kak 😊 Terhitung sejak unit diterima." },
  { id: "k2", question: "Jam operasional kak?", answer: "Jam operasional: 10.00 – 20.00 WIB" },
]);

function rulesInput(text: string, dispatch: RulesInput["dispatch"], over: Partial<RulesInput>): RulesInput {
  const ctx: ToolContext = {
    from: "628111000999",
    now: NOW,
    capabilities: LIVE,
    reserve: { write: {} as PrismaClient, staffId: "staff_agent" },
    profile: { write: {} as PrismaClient },
    writesUsed: new Set(),
  };
  return {
    db: {} as PrismaClient,
    ctx,
    text,
    knowledge: KB,
    capabilities: LIVE,
    dispatch,
    route: routeMessage(text, { capabilities: LIVE }),
    known: { name: null, usage: false, preferences: false, budget: false, apps: false },
    proposalOpen: false,
    lastShown: [],
    leadThreshold: 60,
    ...over,
  };
}

/** Plays every turn through the rules bot, carrying what the worker carries. */
async function replayRules(c: GoldenCase) {
  const pos = shelfDispatch();
  let out: RulesResult | null = null;
  for (const t of c.turns) {
    pos.asked.length = 0;
    out = await runRules(
      rulesInput(t.customer, pos.dispatch, {
        lastShown: out?.shown ?? [],
        lastReply: out?.reply ?? null,
      }),
    );
  }
  return { out: out!, asked: pos.asked };
}

const last = (c: GoldenCase) => c.turns[c.turns.length - 1]!;

async function check(c: GoldenCase): Promise<void> {
  const e = c.expect;
  const line = last(c);
  switch (e.kind) {
    case "routed": {
      const r = routeMessage(line.customer, { capabilities: SHOP_CAPABILITIES, shown: e.shown ?? false });
      expect(r?.topic ?? null).toBe(e.topic);
      return;
    }
    case "checked": {
      expect(line.draft, `${c.id} needs a draft`).toBeDefined();
      const problem = checkReply({
        message: line.draft!,
        sourceCount: e.sources?.length ?? 0,
        unknownSources: 0,
        sourceTexts: e.sources ?? [],
        ...(e.facts ? { stockFacts: e.facts } : {}),
        // What the customer wrote, as converse passes it (2026-11-09).
        customerTexts: c.turns.map((t) => t.customer),
      });
      expect(problem).toBe(e.problem);
      return;
    }
    case "read": {
      const fn =
        e.fn === "queryOf"
          ? (t: string) => reader.understand(t, NOW, { proposalOpen: false, lastShown: [] }).query
          : ((agent as Record<string, unknown>)[e.fn] ?? (reader as Record<string, unknown>)[e.fn]);
      expect(typeof fn, `${e.fn} is exported`).toBe("function");
      expect((fn as (s: string) => string | null)(line.customer)).toBe(e.value);
      return;
    }
    case "answered": {
      const { out, asked } = await replayRules(c);
      for (const re of e.mustSay ?? []) expect(out.reply).toMatch(re);
      for (const re of e.mustNotSay ?? []) expect(out.reply).not.toMatch(re);
      if (e.asked) {
        const hit = asked.filter((a) => a.name === e.asked!.name);
        expect(hit.length, `${c.id} asked ${e.asked.name}`).toBeGreaterThan(0);
        expect(hit[0]!.args).toMatchObject(e.asked.args);
      }
      if (e.answeredItself) expect(out.handoff).toBeUndefined();
      return;
    }
  }
}

const tally = { pass: 0, knownWrong: 0 };

describe("replay: the rated 27–29 Oct chats", () => {
  for (const c of CASES) {
    const name = `${c.id}${c.finding ? ` [${c.finding}]` : ""}: ${last(c).customer.slice(0, 60)}`;
    // GOLDEN_STRICT=1 runs the known-wrong cases as ordinary tests, to read
    // why each one fails.
    if (c.finding && !process.env["GOLDEN_STRICT"]) {
      it.fails(name, async () => {
        tally.knownWrong += 1;
        await check(c);
      });
    } else {
      it(name, async () => {
        await check(c);
        tally.pass += 1;
      });
    }
  }
  afterAll(() => {
    console.log(`golden: ${tally.pass} right, ${tally.knownWrong} known wrong, of ${CASES.length}`);
  });
});
