/**
 * A thread is never called "unknown" (owner report 2026-10-27): a placeholder
 * a model filed as the name falls back to the number.
 */
import { describe, expect, it } from "vitest";
import { threadName } from "../src/routes/chatbot/ThreadList.js";

describe("what a thread is called", () => {
  it("skips a placeholder for the number", () => {
    expect(
      threadName({ displayName: "unknown", name: "-", phone: "628980092978" }),
    ).toBe("628980092978");
    expect(
      threadName({ displayName: null, name: "N/A", phone: "628980092978" }),
    ).toBe("628980092978");
  });

  it("keeps a real name, the shop's own first", () => {
    expect(
      threadName({ displayName: "Budi", name: "budi_wa", phone: "62811" }),
    ).toBe("Budi");
    expect(
      threadName({ displayName: "unknown", name: "Rina", phone: "62811" }),
    ).toBe("Rina");
  });
});
