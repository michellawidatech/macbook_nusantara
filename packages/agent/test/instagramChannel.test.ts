/**
 * The bot's half of Instagram (2026-11-16): an `ig:` thread key is never a
 * phone, so nothing keyed by phone can be reached through it, and the staff
 * alert names the channel and the @username.
 */
import { describe, expect, it } from "vitest";
import { phoneForms, staffAlertText, toE164 } from "../src/index.js";

describe("an Instagram thread key is not a phone", () => {
  it("finds nobody by phone", () => {
    expect(phoneForms("ig:17841400000000001")).toEqual([]);
    expect(phoneForms("6281234567890")).toEqual([
      "6281234567890",
      "+6281234567890",
    ]);
    expect(phoneForms("  ")).toEqual([]);
  });

  it("cannot be written as a phone", () => {
    expect(() => toE164("ig:17841400000000001")).toThrow();
    expect(toE164("6281234567890")).toBe("+6281234567890");
  });
});

describe("the staff alert", () => {
  const base = {
    customerText: "Air M2 bisa nego?",
    summary: "Perlu jawab nego — Air M2\nlain",
    baseUrl: "https://pos.test",
  };

  it("reads exactly as before for WhatsApp", () => {
    expect(
      staffAlertText({ ...base, phone: "6281234567890", name: "Budi" }),
    ).toBe(
      [
        "🔔 Perlu dibalas — Budi (6281234567890)",
        '"Air M2 bisa nego?"',
        "Perlu jawab nego — Air M2",
        "Buka: https://pos.test/chat?phone=6281234567890",
      ].join("\n"),
    );
  });

  it("names Instagram and the @username, with the key encoded in the link", () => {
    expect(
      staffAlertText({
        ...base,
        phone: "ig:17841400000000001",
        name: "Budi",
        username: "budi.mac",
      }),
    ).toBe(
      [
        "🔔 Perlu dibalas (Instagram) — @budi.mac · Budi",
        '"Air M2 bisa nego?"',
        "Perlu jawab nego — Air M2",
        "Buka: https://pos.test/chat?phone=ig%3A17841400000000001",
      ].join("\n"),
    );
    expect(
      staffAlertText({ ...base, phone: "ig:17841400000000001", name: null }),
    ).toContain("— Instagram");
  });

  it("sends a comment to the Comments tab", () => {
    const text = staffAlertText({
      ...base,
      phone: "17841400000000002",
      name: null,
      username: "sari",
      comment: true,
    });
    expect(text).toContain("(komentar Instagram) — @sari");
    expect(text).toContain("https://pos.test/chat?tab=comments");
  });
});
