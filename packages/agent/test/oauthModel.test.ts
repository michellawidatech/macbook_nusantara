/**
 * The owner runs the bot on an OAuth token only (2026-10-22). That token
 * answers on Haiku 4.5 and is a 429 on Haiku 5.5, and Haiku 4.5 refuses the
 * effort parameter — both halves are pinned here.
 */
import { describe, expect, it } from "vitest";
import { OAUTH_MODEL, readAnthropicEnv } from "../src/anthropic.js";
import { AGENT_MODEL, EFFORT, effortConfig } from "../src/converse.js";

describe("an OAuth token's model", () => {
  it("defaults the reply and the summary to OAUTH_MODEL", () => {
    const env = readAnthropicEnv({ ANTHROPIC_AUTH_TOKEN: "sk-ant-oat01-x" });
    expect(env.model).toBe(OAUTH_MODEL);
    expect(env.summaryModel).toBe(OAUTH_MODEL);
  });

  it("still lets CHATBOT_MODEL choose", () => {
    const env = readAnthropicEnv({
      ANTHROPIC_AUTH_TOKEN: "sk-ant-oat01-x",
      CHATBOT_MODEL: "claude-haiku-5-5",
    });
    expect(env.model).toBe("claude-haiku-5-5");
    expect(env.summaryModel).toBe(OAUTH_MODEL);
  });

  it("leaves an API key on the package default", () => {
    const env = readAnthropicEnv({
      ANTHROPIC_API_KEY: "sk-ant-api03-x",
      ANTHROPIC_AUTH_TOKEN: "sk-ant-oat01-x",
    });
    expect(env.model).toBeUndefined();
    expect(env.summaryModel).toBeUndefined();
  });
});

describe("effortConfig", () => {
  it("sends effort to the 5 family", () => {
    expect(effortConfig(AGENT_MODEL)).toEqual({
      output_config: { effort: EFFORT },
    });
    expect(effortConfig("claude-sonnet-5-5")).toHaveProperty("output_config");
  });

  it("sends nothing to Haiku 4.5, which answers it with a 400", () => {
    expect(effortConfig(OAUTH_MODEL)).toEqual({});
    expect(effortConfig("claude-haiku-4-5-20251001")).toEqual({});
  });
});
