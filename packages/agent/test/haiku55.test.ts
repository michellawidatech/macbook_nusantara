/**
 * The request the loop makes on Claude Haiku 5.5 (owner, 2026-10-22), and the
 * response shapes that model can send back. Haiku 5.5 refuses a non-default
 * temperature, thinks by default (so a response can START with a thinking
 * block, and those blocks must go back unmodified beside the tool results),
 * and counts thinking toward max_tokens.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import {
  AGENT_MODEL,
  EFFORT,
  MAX_TOKENS,
  converse,
  type AgentClient,
  type CreateArgs,
} from "../src/converse.js";
import { costMicros } from "../src/agents.js";
import { readAnthropicEnv } from "../src/anthropic.js";
import { summarize, SUMMARY_MAX_CHARS } from "../src/summarize.js";
import { knowledgeBase } from "../src/knowledge.js";
import { noDb } from "./fixtures.js";

const NOW = new Date("2026-08-21T07:15:00.000Z");
const KB = knowledgeBase([
  {
    id: "kb-cod",
    question: "Cod bisa ga kak?",
    answer:
      "Bisa kak, COD Jabodetabek ada biaya transportasi Rp180.000 ya kak.",
  },
]);

const thinking = (sig: string) =>
  ({
    type: "thinking",
    thinking: "",
    signature: sig,
  }) as Anthropic.ContentBlock;
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input }) as Anthropic.ContentBlock;

function fake(responses: Anthropic.ContentBlock[][]): {
  client: AgentClient;
  made: CreateArgs[];
} {
  const made: CreateArgs[] = [];
  return {
    made,
    client: {
      messages: {
        async create(args) {
          // A deep copy, so a later push into `messages` cannot rewrite
          // what this call was sent.
          made.push(JSON.parse(JSON.stringify(args)) as CreateArgs);
          const content = responses[made.length - 1];
          if (!content) throw new Error("called more often than scripted");
          return { content, stop_reason: "tool_use" };
        },
      },
    },
  };
}

const input = (client: AgentClient) => ({
  client,
  db: noDb as unknown as PrismaClient,
  ctx: { from: "628123", now: NOW },
  prompt: { stable: "STABLE", volatile: "VOLATILE" },
  turns: [{ role: "user" as const, text: "cod bisa ga kak" }],
  knowledge: KB,
  storeFacts: "Open 10-20.",
});

describe("the request on Haiku 5.5", () => {
  it("names claude-haiku-5-5, forces a tool, thinks low, and sends no temperature", async () => {
    const { client, made } = fake([
      [
        toolUse("t1", "reply", {
          message:
            "Bisa kak, COD Jabodetabek ada biaya transportasi Rp180.000 ya kak.",
          sources: "K1",
        }),
      ],
    ]);
    const r = await converse(input(client));
    expect(r?.sources).toEqual(["K1"]);
    expect(AGENT_MODEL).toBe("claude-haiku-5-5");
    const call = made[0]!;
    expect(call.model).toBe("claude-haiku-5-5");
    expect(call.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBeGreaterThanOrEqual(4_096);
    expect(call.tool_choice).toEqual({ type: "any" });
    expect(call.output_config).toEqual({ effort: EFFORT });
    expect(EFFORT).toBe("low");
    expect("temperature" in call).toBe(false);
    expect("top_p" in call).toBe(false);
    expect("thinking" in call).toBe(false);
    // No prefill: the conversation the model is asked to continue ends with
    // the customer, never with words put in the model's mouth.
    expect(call.messages.at(-1)!.role).toBe("user");
  });

  it("takes a model from the caller (CHATBOT_MODEL)", async () => {
    const { client, made } = fake([
      [toolUse("t1", "handoff_to_staff", { topic: "other", summary: "x" })],
    ]);
    await converse({ ...input(client), model: "claude-sonnet-5-5" });
    expect(made[0]!.model).toBe("claude-sonnet-5-5");
    expect(
      readAnthropicEnv({
        CHATBOT_MODEL: " claude-x ",
        CHATBOT_SUMMARY_MODEL: "claude-y",
      }),
    ).toMatchObject({ model: "claude-x", summaryModel: "claude-y" });
    expect(readAnthropicEnv({}).model).toBeUndefined();
  });
});

describe("a response that starts with thinking", () => {
  it("reads the tool by type and passes the thinking back unmodified", async () => {
    const first = [
      thinking("sig-1"),
      toolUse("t1", "search_knowledge", { query: "cod" }),
    ];
    const { client, made } = fake([
      first,
      [
        thinking("sig-2"),
        toolUse("t2", "reply", {
          message:
            "Bisa kak, COD Jabodetabek ada biaya transportasi Rp180.000 ya kak.",
          sources: "K1",
        }),
      ],
    ]);
    const r = await converse(input(client));
    expect(r?.handoff).toBeUndefined();
    expect(r?.toolsUsed).toEqual(["search_knowledge", "reply"]);
    const second = made[1]!.messages;
    // The assistant turn is the response's content exactly — thinking first,
    // signature intact — followed by the user turn of tool results.
    expect(second.at(-2)).toEqual({
      role: "assistant",
      content: JSON.parse(JSON.stringify(first)),
    });
    const results = second.at(-1)!.content as Array<{ type: string }>;
    expect(results.every((b) => b.type === "tool_result")).toBe(true);
  });

  it("hands a refusal to a person rather than sending an empty message", async () => {
    const made: CreateArgs[] = [];
    const client: AgentClient = {
      messages: {
        async create(args) {
          made.push(args);
          return { content: [], stop_reason: "refusal" };
        },
      },
    };
    const r = await converse(input(client));
    expect(made).toHaveLength(1);
    expect(r?.handoff?.forcedBy).toBe("no_terminal_tool");
    expect(r?.reply.trim()).not.toBe("");
  });
});

describe("the summariser on Haiku 5.5", () => {
  it("reads the note past a leading thinking block, thinks low, and keeps 1,500 chars", async () => {
    const made: CreateArgs[] = [];
    const client: AgentClient = {
      messages: {
        async create(args) {
          made.push(args);
          return {
            content: [
              thinking("s"),
              {
                type: "text",
                text: "Budi, budget 15jt, Air M2 quoted Rp12.500.000.",
              } as Anthropic.ContentBlock,
            ],
          };
        },
      },
    };
    const out = await summarize({
      client,
      model: "claude-haiku-5-5",
      previous: "Budi wants an Air.",
      turns: [{ text: "berapa air m2?", replyText: "Rp12.500.000 kak" }],
    });
    expect(out).toMatch(/^Budi, budget 15jt, Air M2 quoted Rp12\.500\.000/);
    expect(made[0]!.model).toBe("claude-haiku-5-5");
    expect(made[0]!.output_config).toEqual({ effort: "low" });
    expect("temperature" in made[0]!).toBe(false);
    expect(SUMMARY_MAX_CHARS).toBe(1_500);
  });
});

describe("what a Haiku 5.5 turn costs", () => {
  it("prices $0.10 / $0.50 per MTok, cache reads 0.1x and writes 1.25x", () => {
    // 1M of each, in micro-dollars.
    const M = 1_000_000;
    const base = {
      model: "claude-haiku-5-5",
      inputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    };
    expect(costMicros({ ...base, inputTokens: 50_000 })).toBe(5_000);
    expect(costMicros({ ...base, outputTokens: M })).toBe(500_000);
    expect(costMicros({ ...base, cachedTokens: 50_000 })).toBe(500);
    expect(costMicros({ ...base, cacheWriteTokens: 40_000 })).toBe(5_000);
    // A prompt over 100K tokens moves the whole call to the long card.
    expect(
      costMicros({ ...base, inputTokens: 200_000, outputTokens: 1_000 }),
    ).toBe(200_000 * 0.5 + 1_000 * 2.5);
  });
});
