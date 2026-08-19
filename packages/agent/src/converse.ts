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
import { ANTHROPIC_TOOLS, dispatchTool } from "./tools.js";

/**
 * The model behind the conversation. Haiku: the facts come from tools, not from
 * the model's memory, so the job here is phrasing and judgement about what to
 * ask next — which the small model does well and cheaply.
 */
export const AGENT_MODEL = "claude-haiku-4-5-20251001";

/** Tool round-trips allowed before we answer with whatever we have. */
export const MAX_STEPS = 5;

export const MAX_TOKENS = 700;

export interface ConverseTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ConverseInput {
  readonly client: Anthropic;
  readonly db: PrismaClient;
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
  readonly reply: string;
  /** Which tools ran, in order. Surfaced in the UI so staff can see the grounding. */
  readonly toolsUsed: string[];
  readonly steps: number;
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
  const { client, db, systemPrompt, turns, onError } = input;
  if (turns.length === 0) return null;

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.text,
  }));
  const toolsUsed: string[] = [];

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: ANTHROPIC_TOOLS,
        messages,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        const reply = textOf(response.content);
        // An empty final answer is a failure, not a reply. Better to hand the
        // thread to a human than to send a blank WhatsApp message.
        return reply ? { reply, toolsUsed, steps: step } : null;
      }

      messages.push({ role: "assistant", content: response.content });

      // Every tool the model asked for, run in parallel — they are independent
      // reads, and running them in sequence just adds latency to the reply.
      const results = await Promise.all(
        toolUses.map(async (use) => {
          toolsUsed.push(use.name);
          const output = await dispatchTool(db, use.name, use.input);
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: JSON.stringify(output),
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
      system: `${systemPrompt}\n\nAnswer now with what you already know. Do not call any more tools.`,
      messages,
    });
    const reply = textOf(final.content);
    return reply ? { reply, toolsUsed, steps: MAX_STEPS } : null;
  } catch (err) {
    // Swallowed as far as the CUSTOMER is concerned — they get a human reply,
    // not a stack trace. The detail goes to the route's logger, which is the
    // only place anybody can find out that the token expired.
    onError?.(err);
    return null;
  }
}
