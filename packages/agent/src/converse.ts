/**
 * The conversation loop: one Claude tool-use round trip per turn, up to a cap.
 *
 * Claude reads the thread, calls the whitelisted tools in `tools.ts` to ground
 * every fact about stock and price, and writes the reply itself. There is no
 * template layer and no "reword this draft" step — a state machine that picks a
 * canned answer cannot hold a conversation, which is what the previous build
 * learned the expensive way.
 *
 * The loop is dormant without a credential and fail-soft on any error: it
 * returns `null`, the route reports why, and the inbox keeps working with a
 * human answering. A chat page that shows a stack trace when the API key
 * expires is worse than one that says "the bot is off, reply yourself".
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import { stripFormatting } from "./sanitise.js";
import { dispatchTool, toolsFor, type ToolContext } from "./tools.js";

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
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  temperature?: number;
}

/**
 * The model behind the conversation. Haiku: the facts come from tools, not from
 * the model's memory, so the job here is phrasing and judgement about what to
 * ask next — which the small model does well and cheaply.
 */
export const AGENT_MODEL = "claude-haiku-4-5-20251001";

/** Tool round-trips allowed before we answer with whatever we have. */
export const MAX_STEPS = 5;

export const MAX_TOKENS = 700;

/**
 * Left at the SDK default, and named here so it stays there.
 *
 * This changes nothing today. It exists so that a later "let us make replies
 * deterministic" edit has to argue with a constant that says why not: a shop
 * whose bot opens every message identically reads as a recording, and variation
 * is the cheapest thing that stops it.
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
   * retarget a lookup or a booking.
   */
  readonly ctx: ToolContext;
  readonly systemPrompt: string;
  /** The thread so far, oldest first. */
  readonly turns: readonly ConverseTurn[];
  /**
   * Called with whatever the SDK threw before this loop gives up.
   *
   * The loop still fails soft — the caller gets `null` and the inbox keeps
   * working — but "fail soft" and "fail silently" are not the same thing, and
   * this used to be the second. A 401 from an expired token and a 429 from a
   * rate limit produced the identical blank screen, which made a
   * misconfigured credential undiagnosable from anywhere but a debugger.
   */
  readonly onError?: (err: unknown) => void;
}

export interface ConverseResult {
  /** Sanitised — exactly what will be sent. */
  readonly reply: string;
  /**
   * What the model actually wrote, before the formatting rules were applied.
   * Kept so a drifting prompt is visible in the log rather than silently
   * corrected forever.
   */
  readonly rawReply: string;
  /** Which tools ran, in order. Surfaced in the UI so staff can see the grounding. */
  readonly toolsUsed: string[];
  readonly steps: number;
  /** Set when the model asked for a person. The caller stamps PERLU_STAF. */
  readonly handoff?: { readonly topic: string };
}

/** Join the text blocks of an assistant message into one string. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function converse(
  input: ConverseInput,
): Promise<ConverseResult | null> {
  const { client, db, ctx, systemPrompt, turns, onError } = input;
  if (turns.length === 0) return null;

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.text,
  }));
  const toolsUsed: string[] = [];
  const tools = toolsFor(ctx);
  let handoff: { topic: string } | undefined;

  /**
   * Text the model wrote in an earlier step, alongside a tool call.
   *
   * The model often opens with a line to the customer and asks for a tool in
   * the same message. That line is a real reply, and the loop used to throw it
   * away: only the LAST response was read for text. Which was survivable right
   * up until the observation that the API sometimes answers a tool result with
   * an empty content array and `stop_reason: end_turn` — the model considers
   * itself to have already spoken. Roughly two turns in five did that when
   * asked to recommend something inside a budget.
   *
   * The result was silent and expensive: no text in the last step meant a null
   * reply, which the worker reads as "the agent failed" and stamps PERLU_STAF.
   * A customer who got a perfectly good sentence out of the model was queued
   * for a human instead. Keeping what it already said costs one array.
   */
  const said: string[] = [];

  /**
   * An empty answer is a failure, not a reply. Sanitising can also empty a
   * message that was nothing but formatting, and sending that is worse than
   * handing the thread to a person.
   *
   * `said` is the fallback rather than the primary: the last step is where the
   * model answers having seen the tool results, so it wins whenever it exists.
   */
  const finish = (raw: string, steps: number): ConverseResult | null => {
    const chosen = raw || said[said.length - 1] || "";
    const reply = stripFormatting(chosen);
    return reply
      ? { reply, rawReply: chosen, toolsUsed, steps, ...(handoff ? { handoff } : {}) }
      : null;
  };

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        tools,
        messages,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const spoken = textOf(response.content);
      if (spoken) said.push(spoken);

      if (toolUses.length === 0) return finish(spoken, step);

      messages.push({ role: "assistant", content: response.content });

      // Every tool the model asked for, run in parallel — they are independent
      // reads, and running them in sequence just adds latency to the reply.
      const results = await Promise.all(
        toolUses.map(async (use) => {
          toolsUsed.push(use.name);
          const output = await dispatchTool(db, use.name, use.input, ctx);
          if (
            use.name === "handoff_to_staff" &&
            output &&
            typeof output === "object" &&
            "handoff" in output
          ) {
            handoff = { topic: String((output as { topic?: unknown }).topic ?? "other") };
          }
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            // The replacer is belt and braces behind `toolJson`: a raw BigInt
            // here throws, and the throw is caught below as a model failure,
            // which escalates a live thread. Two guards, because the failure
            // mode is invisible.
            content: JSON.stringify(output, (_k, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    // Out of steps. Ask for a plain answer with no further tools rather than
    // returning nothing — the model usually has enough by now.
    const final = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: `${systemPrompt}\n\nAnswer now with what you already know. Do not call any more tools.`,
      messages,
    });
    return finish(textOf(final.content), MAX_STEPS);
  } catch (err) {
    // Swallowed as far as the CUSTOMER is concerned — they get a human reply,
    // not a stack trace. The detail goes to the route's logger, which is the
    // only place anybody can find out that the token expired.
    onError?.(err);
    return null;
  }
}
