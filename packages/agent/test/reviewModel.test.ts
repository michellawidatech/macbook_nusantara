/**
 * The reviewer's model is picked on /audit (2026-11-20): only models that
 * take the reviewer's JSON format, Sonnet 5.5 when nobody chose, and effort
 * sent only where the model takes it.
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_MODEL,
  REVIEW_MODELS,
  costMicros,
  loadReviewModel,
  reviewEffort,
  reviewModelOf,
} from "../src/index.js";

const db = (value: string | null) =>
  ({
    appSetting: {
      findUnique: async () => (value === null ? null : { value }),
    },
  }) as unknown as Parameters<typeof loadReviewModel>[0];

describe("the reviewer's model", () => {
  it("keeps only a model on the list", () => {
    expect(reviewModelOf(" claude-haiku-4-5 ")).toBe("claude-haiku-4-5");
    expect(reviewModelOf("claude-sonnet-4-5")).toBeNull();
    expect(reviewModelOf(null)).toBeNull();
  });

  it("defaults to Sonnet 5.5, and falls back to it from a value off the list", async () => {
    expect(REVIEW_MODELS[0]!.id).toBe(REVIEW_MODEL);
    expect(await loadReviewModel(db(null))).toBe(REVIEW_MODEL);
    expect(await loadReviewModel(db("gpt-4"))).toBe(REVIEW_MODEL);
    expect(await loadReviewModel(db("claude-opus-4-5"))).toBe(
      "claude-opus-4-5",
    );
  });

  it("sends effort to Sonnet 5.5 and Opus 4.5, never to Haiku 4.5", () => {
    expect(reviewEffort("claude-sonnet-5-5")).toEqual({ effort: "medium" });
    expect(reviewEffort("claude-opus-4-5")).toEqual({ effort: "medium" });
    expect(reviewEffort("claude-haiku-4-5")).toEqual({});
  });

  it("prices every model on the list", () => {
    for (const m of REVIEW_MODELS)
      expect(
        costMicros({
          model: m.id,
          inputTokens: 1_000_000,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
        }),
      ).toBeGreaterThan(0);
  });
});
