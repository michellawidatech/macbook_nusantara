/**
 * What a chat waiting for a person is waiting for (owner, 2026-11-16), read
 * off the bot's hand-over topics and, failing one, the task's kind.
 */
import { describe, expect, it } from "vitest";
import { makeT } from "../src/i18n/translate.js";
import {
  CATEGORY_ORDER,
  categoryCounts,
  categoryLabel,
  categoryOfKind,
  categoryOfTopic,
  isWaitingForPerson,
  threadCategories,
} from "../src/lib/chatCategory.js";

type Fields = Parameters<typeof threadCategories>[0];
const quiet: Fields = {
  handoff: null,
  openActions: [],
  needsReply: false,
  autoReply: true,
};
const handed = (topic: string, also: string[] = []): Fields => ({
  ...quiet,
  handoff: { topic, summary: null, forcedBy: null, at: null, also },
});

describe("a hand-over topic as a category", () => {
  it.each([
    ["unit_details", "photoDefect"],
    ["photos", "photoDefect"],
    ["complaint", "complaintService"],
    ["warranty_claim", "complaintService"],
    ["service", "complaintService"],
    ["video_call", "videoCall"],
    ["shipping_quote", "delivery"],
    ["negotiation", "negotiation"],
    ["closing", "closing"],
    ["human", "admin"],
    ["reservation", "booking"],
    ["visit", "booking"],
    ["price", "priceStock"],
    ["recommendation", "priceStock"],
    ["order_payment", "payment"],
    ["trade_in", "tradeIn"],
    ["sell_to_shop", "tradeIn"],
    ["media", "media"],
    ["other", "other"],
    ["something_new", "other"],
  ] as const)("%s → %s", (topic, category) => {
    expect(categoryOfTopic(topic)).toBe(category);
  });

  it("an old row with no topic is Other", () => {
    expect(categoryOfTopic(null)).toBe("other");
    expect(categoryOfTopic(undefined)).toBe("other");
  });

  it("a task's kind fills in when no topic says anything", () => {
    expect(categoryOfKind("NEGOTIATION")).toBe("negotiation");
    expect(categoryOfKind("PHOTOS")).toBe("photoDefect");
    expect(categoryOfKind("OTHER")).toBe("other");
  });
});

describe("a thread's categories", () => {
  it("are empty when nobody is needed", () => {
    expect(isWaitingForPerson(quiet)).toBe(false);
    expect(threadCategories(quiet)).toEqual([]);
    // Waiting on the BOT is not waiting on a person.
    expect(threadCategories({ ...quiet, needsReply: true })).toEqual([]);
  });

  it("read the hand-over, the other topics of a list, and the open tasks", () => {
    expect(
      threadCategories({
        ...handed("negotiation", ["shipping_quote"]),
        openActions: ["OTHER"],
        openTopics: ["video_call"],
      }),
    ).toEqual(["videoCall", "delivery", "negotiation"]);
  });

  it("fall back to the task's kind, then to Other", () => {
    expect(threadCategories({ ...quiet, openActions: ["CLOSING"] })).toEqual([
      "closing",
    ]);
    // The bot switched off for this chat, a message waiting.
    expect(
      threadCategories({ ...quiet, needsReply: true, autoReply: false }),
    ).toEqual(["other"]);
  });

  it("are counted once per chat", () => {
    const counts = categoryCounts([
      handed("video_call"),
      handed("video_call", ["video_call"]),
      handed("warranty_claim"),
      quiet,
    ]);
    expect(counts.get("videoCall")).toBe(2);
    expect(counts.get("complaintService")).toBe(1);
    expect(counts.has("other")).toBe(false);
  });

  it("every category has words in both languages", () => {
    const en = makeT("en");
    const id = makeT("id");
    for (const c of CATEGORY_ORDER) {
      expect(categoryLabel(en, c)).not.toBe("");
      expect(categoryLabel(id, c)).not.toBe(categoryLabel(en, c));
    }
    expect(categoryLabel(en, "videoCall")).toBe("Video call request");
    expect(categoryLabel(id, "delivery")).toBe("Estimasi ongkir");
  });
});
