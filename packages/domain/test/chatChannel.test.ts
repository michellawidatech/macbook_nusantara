import { describe, expect, it } from "vitest";
import {
  IG_HUMAN_AGENT_MS,
  IG_PRIVATE_REPLY_MS,
  IG_TEXT_MAX_BYTES,
  utf8Length,
  IG_WINDOW_MS,
  IMAGE_KINDS,
  REPLY_KINDS,
  channelOf,
  commentStatusAfterUnhide,
  igPrivateReplyOpen,
  igReplyMode,
  igReplyModeClosesAt,
  igThreadKey,
  igsidOf,
  isIgThread,
  isThreadKey,
  outboxKindFor,
  splitForInstagram,
} from "../src/chatChannel.js";

const H = 60 * 60 * 1000;

describe("the thread key carries the channel", () => {
  it("prefixes an IGSID and reads it back", () => {
    expect(igThreadKey("17841400000000001")).toBe("ig:17841400000000001");
    expect(igsidOf("ig:17841400000000001")).toBe("17841400000000001");
    expect(isIgThread("ig:17841400000000001")).toBe(true);
    expect(channelOf("ig:17841400000000001")).toBe("INSTAGRAM");
  });

  it("leaves a WhatsApp number alone", () => {
    expect(igsidOf("6281234567890")).toBeNull();
    expect(isIgThread("6281234567890")).toBe(false);
    expect(channelOf("6281234567890")).toBe("WHATSAPP");
  });

  it("refuses an IGSID that is not digits", () => {
    expect(() => igThreadKey("abc")).toThrow();
    expect(() => igThreadKey("")).toThrow();
    expect(() => igThreadKey("ig:123456")).toThrow();
  });

  it("accepts exactly the two shapes a route may take", () => {
    expect(isThreadKey("6281234567890")).toBe(true);
    expect(isThreadKey("ig:17841400000000001")).toBe(true);
    expect(isThreadKey("ig:")).toBe(false);
    expect(isThreadKey("ig:12a")).toBe(false);
    expect(isThreadKey("+6281234567890")).toBe(false);
    expect(isThreadKey("12345")).toBe(false);
  });
});

describe("the outbox kind follows the recipient", () => {
  it("turns a reply and an image to an IG thread into the IG kinds", () => {
    expect(outboxKindFor("WA_REPLY", "ig:123456")).toBe("IG_DM");
    expect(outboxKindFor("WA_IMAGE", "ig:123456")).toBe("IG_IMAGE");
  });

  it("changes nothing for a WhatsApp number or another kind", () => {
    expect(outboxKindFor("WA_REPLY", "6281234567890")).toBe("WA_REPLY");
    expect(outboxKindFor("WA_IMAGE", "6281234567890")).toBe("WA_IMAGE");
    expect(outboxKindFor("WA_REPLY", undefined)).toBe("WA_REPLY");
    expect(outboxKindFor("IG_REPLY", "ig:123456")).toBe("IG_REPLY");
    expect(outboxKindFor("ALERT", "ig:123456")).toBe("ALERT");
  });

  it("lists both channels' kinds for a reader", () => {
    expect(REPLY_KINDS).toEqual(["WA_REPLY", "IG_DM"]);
    expect(IMAGE_KINDS).toEqual(["WA_IMAGE", "IG_IMAGE"]);
  });
});

describe("Instagram's messaging window", () => {
  const last = new Date("2026-11-16T10:00:00Z");
  const at = (ms: number) => new Date(last.getTime() + ms);

  it("is a normal reply inside 24 hours", () => {
    expect(igReplyMode(last, at(0))).toBe("RESPONSE");
    expect(igReplyMode(last, at(IG_WINDOW_MS - 1))).toBe("RESPONSE");
    expect(igReplyModeClosesAt(last, "RESPONSE")).toEqual(at(IG_WINDOW_MS));
  });

  it("is a person's reply, tagged, up to seven days", () => {
    expect(igReplyMode(last, at(IG_WINDOW_MS))).toBe("HUMAN_AGENT");
    expect(igReplyMode(last, at(IG_HUMAN_AGENT_MS - 1))).toBe("HUMAN_AGENT");
    expect(igReplyModeClosesAt(last, "HUMAN_AGENT")).toEqual(
      at(IG_HUMAN_AGENT_MS),
    );
  });

  it("is closed after that, and closed with no inbound message", () => {
    expect(igReplyMode(last, at(IG_HUMAN_AGENT_MS))).toBe("CLOSED");
    expect(igReplyMode(null, at(0))).toBe("CLOSED");
    expect(igReplyModeClosesAt(last, "CLOSED")).toBeNull();
    expect(igReplyModeClosesAt(null, "RESPONSE")).toBeNull();
  });

  it("treats a timestamp from the future as just now", () => {
    expect(igReplyMode(at(2 * H), last)).toBe("RESPONSE");
  });
});

describe("a private reply to a comment", () => {
  const ts = new Date("2026-11-10T00:00:00Z");
  it("is open for seven days, once", () => {
    expect(igPrivateReplyOpen(ts, null, ts)).toBe(true);
    expect(
      igPrivateReplyOpen(
        ts,
        null,
        new Date(ts.getTime() + IG_PRIVATE_REPLY_MS - 1),
      ),
    ).toBe(true);
    expect(
      igPrivateReplyOpen(
        ts,
        null,
        new Date(ts.getTime() + IG_PRIVATE_REPLY_MS),
      ),
    ).toBe(false);
    expect(igPrivateReplyOpen(ts, ts, ts)).toBe(false);
  });
});

describe("a comment's status once it is shown again", () => {
  it("is what was done to it, the DM first", () => {
    expect(
      commentStatusAfterUnhide({ replyText: "x", dmSentAt: new Date() }),
    ).toBe("DMED");
    expect(commentStatusAfterUnhide({ replyText: "x", dmSentAt: null })).toBe(
      "REPLIED",
    );
    expect(commentStatusAfterUnhide({ replyText: null, dmSentAt: null })).toBe(
      "NEW",
    );
  });
});

describe("a long reply split for Instagram", () => {
  it("leaves a short one whole and trims it", () => {
    expect(splitForInstagram("  halo kak  ")).toEqual(["halo kak"]);
    expect(splitForInstagram("   ")).toEqual([]);
  });

  it("splits at a paragraph, then a line, then a sentence, then a word", () => {
    const para = `${"a".repeat(600)}\n\n${"b".repeat(600)}`;
    expect(splitForInstagram(para)).toEqual(["a".repeat(600), "b".repeat(600)]);
    const line = `${"a".repeat(600)}\n${"b".repeat(600)}`;
    expect(splitForInstagram(line)).toEqual(["a".repeat(600), "b".repeat(600)]);
    const sentence = `${"a ".repeat(300).trim()}. ${"b ".repeat(300).trim()}.`;
    const parts = splitForInstagram(sentence);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.endsWith(".")).toBe(true);
    const words = "kata ".repeat(400).trim();
    for (const p of splitForInstagram(words)) {
      expect(utf8Length(p)).toBeLessThanOrEqual(IG_TEXT_MAX_BYTES);
      expect(p.startsWith(" ")).toBe(false);
    }
  });

  it("cuts a run with no space at the limit", () => {
    const parts = splitForInstagram("x".repeat(IG_TEXT_MAX_BYTES * 2 + 5));
    expect(parts.map((p) => p.length)).toEqual([
      IG_TEXT_MAX_BYTES,
      IG_TEXT_MAX_BYTES,
      5,
    ]);
  });

  it("measures UTF-8 bytes and never cuts an emoji in half", () => {
    expect(utf8Length("😊")).toBe(4);
    const parts = splitForInstagram("😊".repeat(251));
    expect(parts).toHaveLength(2);
    expect([...parts[0]!]).toHaveLength(250);
    expect(parts[1]).toBe("😊");
  });
});
