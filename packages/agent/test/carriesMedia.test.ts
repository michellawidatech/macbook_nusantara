import { describe, expect, it } from "vitest";
import { carriesMedia } from "../src/policy.js";

/**
 * 2026-11-05: a customer's plain questions were handed over as "Photo or
 * file" — the worker counted every message that is not text as media, and the
 * gateway forwards reactions, stickers, locations and contacts too.
 */
describe("carriesMedia", () => {
  it("is a photo, video, voice note or document", () => {
    for (const t of ["image", "video", "audio", "document"])
      expect(carriesMedia([{ msgType: "text" }, { msgType: t }])).toBe(true);
  });
  it("is not a reaction, sticker, location or contact", () => {
    for (const t of [
      "reaction",
      "sticker",
      "location",
      "contacts",
      "unsupported",
    ])
      expect(carriesMedia([{ msgType: "text" }, { msgType: t }])).toBe(false);
  });
  it("is not plain text", () => {
    expect(carriesMedia([{ msgType: "text" }])).toBe(false);
  });
});
