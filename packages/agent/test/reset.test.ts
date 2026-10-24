import { describe, expect, it } from "vitest";
import {
  MAX_TESTERS,
  formatTesters,
  isResetCommand,
  parseTesters,
  toWaId,
} from "../src/index.js";

describe("isResetCommand", () => {
  it("is the bare command, whatever the case and the spaces round it", () => {
    for (const text of ["/new", " /new ", "/NEW", "/New\n"]) {
      expect(isResetCommand(text)).toBe(true);
    }
  });

  it("is not a sentence that happens to contain it", () => {
    for (const text of [
      "/new chat",
      "ketik /new ya",
      "new",
      "/newer",
      "",
      null,
    ]) {
      expect(isResetCommand(text)).toBe(false);
    }
  });
});

describe("toWaId", () => {
  it("reads a number the way people write one", () => {
    expect(toWaId("08980092978")).toBe("628980092978");
    expect(toWaId("+62 898-0092-978")).toBe("628980092978");
    expect(toWaId("628980092978")).toBe("628980092978");
  });

  it("refuses what is not a phone number", () => {
    expect(toWaId("ersen")).toBeNull();
    expect(toWaId("12345")).toBeNull();
    expect(toWaId("1".repeat(16))).toBeNull();
  });
});

describe("the stored tester list", () => {
  it("round-trips, once per number", () => {
    const stored = formatTesters([
      "08980092978",
      "628980092978",
      "628111000888",
    ]);
    expect(stored).toBe("628980092978,628111000888");
    expect(parseTesters(stored)).toEqual(["628980092978", "628111000888"]);
  });

  it("drops a bad entry and reads an unset row as nobody", () => {
    expect(parseTesters("628980092978,,oops")).toEqual(["628980092978"]);
    expect(parseTesters(null)).toEqual([]);
  });

  it("is capped, because a long list is a customer list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `6281100000${10 + i}`);
    expect(parseTesters(many.join(","))).toHaveLength(MAX_TESTERS);
  });
});
