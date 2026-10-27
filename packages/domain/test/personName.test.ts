import { describe, expect, it } from "vitest";
import { isPlaceholderName, realName } from "../src/personName.js";

describe("a placeholder is not a name (owner report 2026-10-27)", () => {
  it.each([
    "unknown",
    "Unknown",
    " UNKNOWN ",
    "-",
    "--",
    "n/a",
    "N/A",
    "null",
    "undefined",
    "none",
    "tidak tahu",
    "Tidak diketahui",
    "anonim",
    "Anonymous",
    "Unknown Customer",
    "customer",
    "kak",
    "?",
    "",
    "   ",
    "6289800929780",
    "+62 898-0092-978",
  ])("%j is a placeholder", (v) => {
    expect(isPlaceholderName(v)).toBe(true);
    expect(realName(v)).toBeNull();
  });

  it("null and undefined are no name", () => {
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(realName(undefined)).toBeNull();
  });

  it.each(["Budi", "Kak Budi", "Rina Wijaya", "Nana", "Ana", "Dewi S."])(
    "%j is a name",
    (v) => {
      expect(isPlaceholderName(v)).toBe(false);
      expect(realName(` ${v} `)).toBe(v);
    },
  );
});
