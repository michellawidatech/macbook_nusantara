/**
 * The knowledge base as one conversation pass sees it: the owner's approved
 * answers, each with a short handle the model cites (`K1`, `K2`…), an index to
 * rank them, and the block of the prompt that carries them.
 *
 * ## Why the whole base rides in the prompt, and retrieval still runs
 *
 * The owner's sheet is thirty-one answers — about five thousand tokens. That
 * fits in the prompt with room to spare, and sits in the CACHED part of it
 * (prompt.ts), so every turn after the first reads it at a tenth of the price.
 * A model that can see every answer does not miss one because a customer
 * spelled "oprasional" in a way the ranker had not met.
 *
 * Retrieval still runs on every message, for three jobs the prompt cannot do:
 * it names the likeliest answers for THIS message beside the message (a hint,
 * not a filter), it backs the `search_knowledge` tool, and it takes over
 * entirely once the base outgrows `PROMPT_BUDGET_CHARS` — past that the prompt
 * carries only the best matches, and the base can grow to hundreds of answers
 * without the prompt growing with it.
 *
 * Handles follow a fixed order (created, then id), so the same answer is the
 * same handle in every call of one pass and a cited `K7` always resolves.
 */

import type { PrismaClient } from "@nusantara/db";
import {
  indexKnowledge,
  isStrongMatch,
  type KnowledgeIndex,
  type RankedDoc,
} from "./retrieval.js";

export interface ApprovedAnswer {
  /** The handle the model cites, e.g. `K7`. */
  readonly handle: string;
  /** The `AgentKnowledge` row. */
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface KnowledgeBase {
  readonly entries: readonly ApprovedAnswer[];
  readonly byHandle: ReadonlyMap<string, ApprovedAnswer>;
  readonly index: KnowledgeIndex<ApprovedAnswer & { id: string }>;
  /** True when every entry is in the prompt; false once the base outgrew it. */
  readonly complete: boolean;
}

/**
 * How much answer text the prompt carries whole. The owner's sheet is about a
 * third of this. Past it, the prompt carries the best matches per message.
 */
export const PROMPT_BUDGET_CHARS = 40_000;

/** How many matches ride beside a message when the base is too big to carry. */
export const MATCHES_WHEN_PARTIAL = 12;

export function knowledgeBase(
  rows: ReadonlyArray<{ id: string; question: string; answer: string }>,
): KnowledgeBase {
  const entries = rows.map((r, i) => ({
    handle: `K${i + 1}`,
    id: r.id,
    question: r.question.trim(),
    answer: r.answer.trim(),
  }));
  const size = entries.reduce(
    (n, e) => n + e.question.length + e.answer.length,
    0,
  );
  // The index ranks by the handle, so a ranked result is already citable.
  const index = indexKnowledge(entries.map((e) => ({ ...e, id: e.handle })));
  return {
    entries,
    byHandle: new Map(entries.map((e) => [e.handle, e])),
    index,
    complete: size <= PROMPT_BUDGET_CHARS,
  };
}

/** Every active answer, in handle order. One query per pass, not per thread. */
export async function loadKnowledgeBase(
  db: PrismaClient,
): Promise<KnowledgeBase> {
  const rows = await db.agentKnowledge.findMany({
    where: { active: true },
    select: { id: true, question: true, answer: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return knowledgeBase(rows);
}

function render(e: ApprovedAnswer): string {
  return `[${e.handle}] Q: ${e.question}\nA: ${e.answer}`;
}

/**
 * The block of the system prompt that carries the base — every entry when it
 * fits, none when it does not (the per-message matches carry them instead).
 */
export function knowledgeBlock(kb: KnowledgeBase): string {
  if (kb.entries.length === 0) {
    return [
      "APPROVED ANSWERS",
      "",
      "The shop has not written any approved answers yet. Everything that is not a greeting",
      "or one of the shop facts above goes to a colleague.",
    ].join("\n");
  }
  if (!kb.complete) {
    return [
      "APPROVED ANSWERS",
      "",
      "The shop's approved answers are too many to list here. The best matches for each",
      "message are shown beside it, and search_knowledge finds more. Cite them by their",
      "handle, like K12.",
    ].join("\n");
  }
  return [
    "APPROVED ANSWERS",
    "",
    "Written by the shop's owner. They are the ONLY things you may tell a customer about how",
    "the shop works. Cite each one you use by its handle.",
    "",
    kb.entries.map(render).join("\n\n"),
  ].join("\n");
}

/**
 * What rides beside the customer's message: the likeliest answers by keyword
 * match. A hint to look at, never permission to stretch one to fit.
 */
export function matchesFor(
  kb: KnowledgeBase,
  text: string,
): Array<RankedDoc<ApprovedAnswer>> {
  const limit = kb.complete ? 3 : MATCHES_WHEN_PARTIAL;
  return kb.index.rank(text, limit).map((r) => ({
    ...r,
    doc: kb.byHandle.get(r.doc.id)!,
  }));
}

export function matchesNote(
  kb: KnowledgeBase,
  matches: ReadonlyArray<RankedDoc<ApprovedAnswer>>,
): string {
  if (matches.length === 0 || !isStrongMatch(matches[0]!)) {
    return (
      "No approved answer matches this message by keyword. Answer only if one of the " +
      "approved answers clearly covers it, or it is only a greeting or thanks. Otherwise " +
      "hand over."
    );
  }
  const handles = matches.map((m) => m.doc.handle).join(", ");
  const body = kb.complete
    ? ""
    : `\n\n${matches.map((m) => render(m.doc)).join("\n\n")}`;
  return `Likeliest approved answers for this message, best first: ${handles}. Use one only if it really answers what was asked.${body}`;
}
