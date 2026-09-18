/**
 * The conversation loop: a few Claude tool-use round trips per customer turn,
 * ending in exactly one of two ways — an answer with its sources, or a person.
 *
 * ## The shape of a turn (2026-09-18)
 *
 * The shop runs this app in parallel with B2Soft, and production does not
 * hold the real stock or prices (policy.ts says why and what follows). So the
 * bot answers only from the owner's approved answers, the shop's own facts and
 * the catalogue, and every turn must END with a tool:
 *
 *  - `reply` — the words, and the sources they rest on (`K7`, `store`,
 *    `catalog`, or `greeting` for a hello with no facts in it);
 *  - `handoff_to_staff` — a topic, a note for the colleague, and a short line
 *    for the customer.
 *
 * `tool_choice: any` makes the model pick one of the tools every step, so a
 * free-text answer with nothing behind it cannot happen by accident. The
 * lookups (`search_knowledge`, `lookup_catalog`) run in between.
 *
 * Two checks sit outside the model, and neither trusts it:
 *
 *  - A message `routeMessage` already sent to a person (the stock or price of
 *    a named machine, a battery-health question, a booking…) is offered no
 *    `reply` tool at all: the only way to end that turn is a hand-over.
 *  - A reply is checked against what it cites (`checkReply`): no source, a
 *    source that does not exist, a rupiah figure or an availability claim the
 *    source does not contain — and the reply becomes a hand-over instead,
 *    with a fixed holding line rather than the model's words.
 *
 * The loop is dormant without a credential and fail-soft on any error: it
 * returns `null`, the caller reports why, and the inbox keeps working with a
 * human answering. A chat page that shows a stack trace when the API key
 * expires is worse than one that says "the bot is off, reply yourself".
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import type { KnowledgeBase } from "./knowledge.js";
import {
  checkHoldingMessage,
  checkReply,
  holdingMessage,
  isHandoffTopic,
  type HandoffTopic,
  type ReplyProblem,
  type Route,
} from "./policy.js";
import type { AgentPrompt } from "./prompt.js";
import { sanitiseReply } from "./sanitise.js";
import {
  dispatchTool,
  storeOpenAt,
  toolsFor,
  type ToolContext,
} from "./tools.js";

/**
 * The client, structurally.
 *
 * `apps/worker` has no `@anthropic-ai/sdk` dependency and should not grow one
 * just to name a type in a test. This is the whole surface `converse` uses, so
 * a fake is a bare object literal — the same shape the fetch stubs elsewhere
 * take, and the reason none of these tests need a module mock.
 */
export interface AgentClient {
  readonly messages: {
    create(args: CreateArgs): Promise<{
      content: Anthropic.ContentBlock[];
      stop_reason?: string | null;
    }>;
  };
}

/** What every call to the model looks like. Recorded verbatim by the tests. */
export interface CreateArgs {
  model: string;
  max_tokens: number;
  system: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
  temperature?: number;
}

/**
 * The model behind the conversation. Haiku: the facts come from the owner's
 * answers and the shop's own records, not from the model's memory, so the job
 * here is choosing the right answer, phrasing it and knowing when to hand
 * over — which the small model does well and cheaply.
 */
export const AGENT_MODEL = "claude-haiku-4-5-20251001";

/** Lookup round-trips allowed before the turn is handed to a person. */
export const MAX_STEPS = 4;

/** Room for the owner's longest answer (the app list) plus the tool wrapper. */
export const MAX_TOKENS = 1_024;

/**
 * Left at the SDK default, and named here so it stays there.
 *
 * It exists so that a later "let us make replies deterministic" edit has to
 * argue with a constant that says why not: a shop whose bot opens every
 * message identically reads as a recording, and variation is the cheapest
 * thing that stops it. The facts do not vary — they come from the sources.
 */
export const TEMPERATURE = 1.0;

export interface ConverseTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ConverseInput {
  readonly client: AgentClient;
  readonly db: PrismaClient;
  /**
   * Who is talking and what this caller may do. The sender's identity lives
   * here rather than in any tool's arguments, so nothing a customer writes can
   * retarget a lookup.
   */
  readonly ctx: ToolContext;
  /** `buildAgentPrompt`'s two parts: the cached one, then the per-turn one. */
  readonly prompt: AgentPrompt;
  /** The thread so far, oldest first. The last turn is the customer's. */
  readonly turns: readonly ConverseTurn[];
  /** The pass's approved answers, so a cited `K7` resolves and is checked. */
  readonly knowledge: KnowledgeBase;
  /** The shop facts text the prompt carries, so a `store` citation is checked. */
  readonly storeFacts: string;
  /** Set when policy.ts routed this message to a person before the model saw it. */
  readonly route?: Route | null;
  /** A note for the model beside the customer's latest message — the likeliest answers. */
  readonly hint?: string;
  /**
   * Called with whatever the SDK threw before this loop gives up.
   *
   * The loop still fails soft — the caller gets `null` and the inbox keeps
   * working — but "fail soft" and "fail silently" are not the same thing. A
   * 401 from an expired token and a 429 from a rate limit would otherwise
   * produce the identical blank screen.
   */
  readonly onError?: (err: unknown) => void;
}

export interface ConverseHandoff {
  readonly topic: HandoffTopic;
  /** For the colleague, from the model or from the refusal that forced it. */
  readonly summary: string;
  /** Why the code, not the model, handed it over — for the log. */
  readonly forcedBy?: "route" | ReplyProblem | "no_terminal_tool";
}

export interface ConverseResult {
  /** Sanitised — exactly what will be sent. */
  readonly reply: string;
  /** What the model wrote before sanitising, or the fixed line that replaced it. */
  readonly rawReply: string;
  /** Which tools ran, in order. Surfaced in the UI so staff can see the grounding. */
  readonly toolsUsed: string[];
  readonly steps: number;
  /** What the answer rests on: approved-answer handles, `store`, `catalog`, `greeting`. */
  readonly sources: string[];
  /** Set when the turn ended with a person. The caller stamps PERLU_STAF. */
  readonly handoff?: ConverseHandoff;
}

const TERMINAL = new Set(["reply", "handoff_to_staff"]);

/** One short line, trimmed, for the colleague's note. */
const note = (v: unknown, fallback: string): string => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, 240);
};

export async function converse(
  input: ConverseInput,
): Promise<ConverseResult | null> {
  const { client, db, ctx, prompt, turns, knowledge, route, onError } = input;
  if (turns.length === 0) return null;

  const system: Anthropic.TextBlockParam[] = [
    // The cache breakpoint: tools, then this block, are read back at a tenth
    // of the price on every turn after the first — the persona, the rules and
    // all of the owner's answers. The volatile part comes after it.
    { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
    ...(prompt.volatile
      ? [{ type: "text" as const, text: prompt.volatile }]
      : []),
  ];

  const last = turns.length - 1;
  const routedNote = route
    ? `This message must go to a colleague (${route.topic.replace("_", " ")}). ` +
      "Do not answer it with reply. Use handoff_to_staff: first answer anything an approved " +
      "answer covers, then say warmly that a colleague will check and reply in this chat."
    : "";
  const shopNote = [routedNote, input.hint ?? ""].filter(Boolean).join("\n\n");
  const messages: Anthropic.MessageParam[] = turns.map((t, i) =>
    i === last && t.role === "user" && shopNote
      ? {
          role: "user",
          content: [
            { type: "text", text: t.text },
            // A separate block, fenced: the customer's words and the shop's
            // note must never read as one voice.
            { type: "text", text: `<shop_note>\n${shopNote}\n</shop_note>` },
          ],
        }
      : { role: t.role, content: t.text },
  );

  const toolsUsed: string[] = [];
  const tools = toolsFor(ctx, { handoffOnly: route != null });
  const catalogResults: string[] = [];
  const open = storeOpenAt(ctx.now);

  /** The code handing over, in the shop's fixed words. */
  const forced = (
    topic: HandoffTopic,
    summary: string,
    forcedBy: ConverseHandoff["forcedBy"],
    steps: number,
  ): ConverseResult => {
    const line = holdingMessage(topic, open);
    return {
      reply: line,
      rawReply: line,
      toolsUsed,
      steps,
      sources: [],
      handoff: { topic, summary, forcedBy },
    };
  };

  const handOver = (
    args: Record<string, unknown>,
    steps: number,
  ): ConverseResult => {
    const topic = isHandoffTopic(args["topic"])
      ? args["topic"]
      : (route?.topic ?? "other");
    const summary = note(args["summary"], "Pelanggan perlu dibantu staf.");
    const raw =
      typeof args["customer_message"] === "string"
        ? args["customer_message"]
        : "";
    const message = sanitiseReply(raw);
    if (checkHoldingMessage(message) !== null) {
      // An empty line, or one carrying a figure or a stock promise: the
      // customer gets the shop's fixed words instead of the model's.
      const line = holdingMessage(topic, open);
      return {
        reply: line,
        rawReply: raw || line,
        toolsUsed,
        steps,
        sources: [],
        handoff: { topic, summary },
      };
    }
    return {
      reply: message,
      rawReply: raw,
      toolsUsed,
      steps,
      sources: [],
      handoff: { topic, summary },
    };
  };

  const answer = (
    args: Record<string, unknown>,
    steps: number,
  ): ConverseResult => {
    const raw = typeof args["message"] === "string" ? args["message"] : "";
    const message = sanitiseReply(raw);
    const cited = String(args["sources"] ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const texts: string[] = [];
    let unknown = 0;
    const sources: string[] = [];
    for (const c of cited) {
      const handle = c.toUpperCase();
      const entry = knowledge.byHandle.get(handle);
      if (entry) {
        texts.push(`${entry.question}\n${entry.answer}`);
        sources.push(handle);
      } else if (c.toLowerCase() === "store") {
        texts.push(input.storeFacts);
        sources.push("store");
      } else if (c.toLowerCase() === "catalog" && catalogResults.length > 0) {
        texts.push(...catalogResults);
        sources.push("catalog");
      } else if (c.toLowerCase() === "greeting") {
        sources.push("greeting");
      } else {
        unknown += 1;
      }
    }
    const problem = checkReply({
      message,
      sourceCount: sources.length,
      unknownSources: unknown,
      sourceTexts: texts,
    });
    if (problem !== null) {
      return forced(
        "other",
        `Balasan bot ditahan (${problem}): "${message.slice(0, 160)}"`,
        problem,
        steps,
      );
    }
    return { reply: message, rawReply: raw, toolsUsed, steps, sources };
  };

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system,
        tools,
        tool_choice: { type: "any" },
        messages,
      });

      const uses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (uses.length === 0) break;

      // A hand-over wins over a reply sent in the same breath: when the model
      // is of two minds, the person is the safe one.
      const terminal =
        uses.find((u) => u.name === "handoff_to_staff") ??
        uses.find((u) => u.name === "reply");
      if (terminal) {
        toolsUsed.push(terminal.name);
        const args =
          terminal.input && typeof terminal.input === "object"
            ? (terminal.input as Record<string, unknown>)
            : {};
        if (terminal.name === "handoff_to_staff") return handOver(args, step);
        // A routed turn was never offered `reply`. The API would not produce
        // one, but the rule is not allowed to rest on that.
        if (route)
          return forced(
            route.topic,
            `Dialihkan ke staf (${route.rule}).`,
            "route",
            step,
          );
        return answer(args, step);
      }

      messages.push({ role: "assistant", content: response.content });
      // Independent reads, run together.
      const results = await Promise.all(
        uses.map(async (use) => {
          toolsUsed.push(use.name);
          const output = TERMINAL.has(use.name)
            ? { error: "not available" }
            : await dispatchTool(db, use.name, use.input, {
                ...ctx,
                knowledge,
              });
          const content = JSON.stringify(output, (_k, v) =>
            typeof v === "bigint" ? v.toString() : v,
          );
          if (use.name === "lookup_catalog") catalogResults.push(content);
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content,
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    // Out of steps, or the model ended without choosing: a person it is.
    return forced(
      route?.topic ?? "other",
      route
        ? `Dialihkan ke staf (${route.rule}).`
        : "Bot tidak menemukan jawaban yang disetujui.",
      "no_terminal_tool",
      MAX_STEPS,
    );
  } catch (err) {
    // Swallowed as far as the CUSTOMER is concerned — they get a human reply,
    // not a stack trace. The detail goes to the caller's logger, which is the
    // only place anybody can find out that the token expired.
    onError?.(err);
    return null;
  }
}
