import { describe, expect, it } from "vitest";
import {
  MAX_TESTERS,
  formatTesters,
  isResetCommand,
  laterOf,
  parseTesters,
  summarySince,
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

describe("where a thread starts over — /new or a staff Clear chat", () => {
  const early = new Date("2026-10-27T01:00:00Z");
  const late = new Date("2026-10-27T02:00:00Z");

  it("is the later of the two, and either alone", () => {
    expect(laterOf(early, late)).toBe(late);
    expect(laterOf(late, early)).toBe(late);
    expect(laterOf(null, early)).toBe(early);
    expect(laterOf(early, null)).toBe(early);
    expect(laterOf(null, null)).toBeNull();
  });

  it("drops a summary that stops at or before it", () => {
    const note = (coveredThroughAt: Date | null) => ({
      summary: "Pelanggan mencari Air M1.",
      coveredThroughAt,
    });
    expect(summarySince(note(early), late)).toBeNull();
    expect(summarySince(note(late), late)).toBeNull();
    expect(summarySince(note(null), late)).toBeNull();
    expect(summarySince(note(late), early)).toBe("Pelanggan mencari Air M1.");
    expect(summarySince(note(early), null)).toBe("Pelanggan mencari Air M1.");
    expect(summarySince({ summary: null, coveredThroughAt: late }, null)).toBe(
      null,
    );
    expect(summarySince(null, null)).toBeNull();
  });
});

describe("numbers with names (2026-10-28)", () => {
  it("reads number:name entries, and a bare number as before", async () => {
    const { parseNumberEntries, formatNumberEntries, parseTesters } =
      await import("../src/reset.js");
    const stored = "628123456789:Dina,0812-0000-111,628123456789:Dupe";
    expect(parseNumberEntries(stored)).toEqual([
      { waId: "628123456789", name: "Dina" },
      { waId: "628120000111", name: "" },
    ]);
    // A name with digits never leaks into the number.
    expect(parseTesters("628123456789:Staff 2")).toEqual(["628123456789"]);
    expect(
      formatNumberEntries([
        { waId: "628123456789", name: "Dina, owner: HP" },
        { waId: "628120000111", name: "" },
      ]),
    ).toBe("628123456789:Dina owner HP,628120000111");
  });
});
