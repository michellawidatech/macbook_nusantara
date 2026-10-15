/**
 * The three chatbot v2 agents — who they are, what they cost, and the voice
 * each has until somebody edits it (docs/chatbot-v2-design.md §2).
 *
 *  - **Router / Guard** reads the customer's message and says, as JSON and in
 *    no words of its own: the language and tone, the intent, how likely they
 *    are to buy, whether the POS has to be asked anything, and whether a
 *    person must take it.
 *  - **Operations** asks the POS — stock, a serial, photos, the customer's own
 *    bookings — through the agent API, and reports facts. It never writes to
 *    the customer.
 *  - **Sales Advisor** writes the one reply the customer reads (owner, 2026-
 *    10-14), keeps the profile, and asks the next question.
 *
 * Models (owner: "cheap for writing to the POS, medium to read intent and
 * phrase for the customer"): Sonnet 5.5 at low effort for the two that read
 * and write people, Haiku 4.5 for the one that calls tools.
 *
 * A persona in the `Persona` table (one per agent, `Persona.agent`) replaces
 * the default prompt here; the rules the code depends on are NOT in a persona
 * and cannot be edited away — they are added after it.
 */

import { AGENT_MODEL } from "./converse.js";

export type AgentRole = "ROUTER" | "ADVISOR" | "OPERATIONS";
export const AGENT_ROLES: readonly AgentRole[] = [
  "ROUTER",
  "OPERATIONS",
  "ADVISOR",
];

export const ROUTER_MODEL = "claude-sonnet-5-5";
export const ADVISOR_MODEL = "claude-sonnet-5-5";
export const OPERATIONS_MODEL = AGENT_MODEL;

export interface AgentDefinition {
  readonly agent: AgentRole;
  readonly name: string;
  /** The main task, one line — fixed; the persona is what changes. */
  readonly task: string;
  readonly model: string;
  readonly defaultPrompt: string;
  /**
   * What this seat does under the rules-first pipeline (owner, 2026-10-15:
   * AI only where rules cannot answer) — where it is code, not a model.
   */
  readonly inRules: string;
}

export const AGENT_DEFINITIONS: Readonly<Record<AgentRole, AgentDefinition>> = {
  ROUTER: {
    agent: "ROUTER",
    name: "Router / Guard",
    task: "Greets, reads the language and tone, finds the intent and scores how ready the customer is to buy.",
    model: ROUTER_MODEL,
    inRules:
      "Rules, no AI: reads the intent, product, budget, serial, name and visit time from keywords.",
    defaultPrompt: [
      "You are the front desk of Macbook Nusantara, a shop in Indonesia selling new and",
      "second-hand Apple units. You do not talk to the customer. You read their latest",
      "message, with the conversation so far, and decide how the shop should handle it.",
      "",
      "A customer is a likely buyer when they name a model or a budget, ask about a specific",
      "unit, its price, photos or a visit, or say when they need it. Small talk and general",
      "questions score low. A customer who has agreed to a visit scores high.",
    ].join("\n"),
  },
  OPERATIONS: {
    agent: "OPERATIONS",
    name: "Operations",
    task: "Checks stock, prices and photos in the POS and prepares bookings.",
    model: OPERATIONS_MODEL,
    inRules:
      "No AI: the same POS lookups (stock, price, photos, bookings), called directly by code.",
    defaultPrompt: [
      "You are the shop's operations desk. You look things up in the shop's own system and",
      "report what you found. You never write to the customer, never guess, and never",
      "describe a unit the system did not return.",
    ].join("\n"),
  },
  ADVISOR: {
    agent: "ADVISOR",
    name: "Sales Advisor",
    task: "Writes every reply: asks what the customer needs, recommends, and keeps their profile.",
    model: ADVISOR_MODEL,
    inRules:
      "Templates and the owner's answers word for word. AI only for what no rule covers, and only with a key.",
    // The v1 voice (persona.ts) is the Advisor's default: it is the voice
    // customers already know.
    defaultPrompt: "",
  },
};

// --- the router's verdict ---------------------------------------------------

export const INTENTS = [
  "greeting",
  "browse",
  "ask_stock",
  "ask_price",
  "ask_photo",
  "reserve",
  "confirm",
  "decline",
  "negotiate",
  "complaint",
  "payment",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface RouterVerdict {
  readonly language: "id" | "en" | "other";
  readonly tone: "casual" | "formal";
  readonly intent: Intent;
  /** 0–100: how likely this customer is to buy. */
  readonly leadScore: number;
  readonly needsOperations: boolean;
  /** What Operations should look up, in a sentence. */
  readonly operationsBrief: string;
  /** A hand-over topic, or null when the bot may answer. */
  readonly escalate: string | null;
}

// --- what it costs -----------------------------------------------------------

/** US dollars per million tokens (2026-10). Cache writes are 1.25× input. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, cacheRead: 0.1 },
};

/**
 * What a call cost, in micro-dollars (USD × 10⁶) — tokens × $/MTok is
 * exactly that. An unknown model costs nothing rather than a guess.
 */
export function costMicros(u: {
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}): number {
  const p = PRICES[u.model];
  if (!p) return 0;
  return Math.round(
    u.inputTokens * p.in +
      u.cacheWriteTokens * p.in * 1.25 +
      u.cachedTokens * p.cacheRead +
      u.outputTokens * p.out,
  );
}
