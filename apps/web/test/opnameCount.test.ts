/**
 * The stock take's one table — `lib/opnameCount.ts` (owner brief 2026-09-19:
 * *"Show all the unit early, move upward & show status & green/red"*).
 *
 * Two promises are checked here, because both fail quietly. The ORDER: a
 * counter who scans a unit and has to go looking for its row has lost the
 * thing the brief asked for, and nothing would throw. And the ANSWER: a unit
 * filed elsewhere read as "not in system" would be offered to be taken into
 * stock — a second record for a laptop the shop already owns.
 */
import { describe, expect, it } from "vitest";
import {
  countRows,
  recordScan,
  removeScan,
  restoreScans,
  scanStatus,
} from "../src/lib/opnameCount.js";

/** A1–A3 are on the shelf being counted; B9 is a real unit filed elsewhere. */
const KNOWN = new Set(["A1", "A2", "A3", "B9"]);
const isKnown = (serial: string) => KNOWN.has(serial);
const EXPECTED = ["A1", "A2", "A3"];

describe("scanStatus", () => {
  it("is found for a serial the count expects", () => {
    expect(scanStatus("A2", new Set(EXPECTED), isKnown)).toBe("FOUND");
  });

  it("tells a unit filed elsewhere from one nobody has heard of", () => {
    // The two need different work: one needs moving, the other booking in.
    expect(scanStatus("B9", new Set(EXPECTED), isKnown)).toBe("ELSEWHERE");
    expect(scanStatus("ZZ", new Set(EXPECTED), isKnown)).toBe("UNREGISTERED");
  });
});

describe("countRows", () => {
  it("lists every expected unit before anything is scanned", () => {
    expect(countRows([], EXPECTED, isKnown)).toEqual([
      { serial: "A1", status: "NOT_SCANNED" },
      { serial: "A2", status: "NOT_SCANNED" },
      { serial: "A3", status: "NOT_SCANNED" },
    ]);
  });

  it("puts what was scanned on top, the latest first", () => {
    // Scanned oldest-first: A2, then an unknown serial, then B9.
    expect(countRows(["A2", "ZZ", "B9"], EXPECTED, isKnown)).toEqual([
      { serial: "B9", status: "ELSEWHERE" },
      { serial: "ZZ", status: "UNREGISTERED" },
      { serial: "A2", status: "FOUND" },
      { serial: "A1", status: "NOT_SCANNED" },
      { serial: "A3", status: "NOT_SCANNED" },
    ]);
  });

  it("leaves the not-scanned block in the order it was handed", () => {
    // Shelf order is the page's business; this must not re-sort it.
    const rows = countRows([], ["A3", "A1", "A2"], isKnown);
    expect(rows.map((r) => r.serial)).toEqual(["A3", "A1", "A2"]);
  });

  it("keeps a scan the scope no longer expects, as belonging elsewhere", () => {
    // Narrowing a scope mid-count must not lose evidence somebody read off a
    // unit. A3 was counted, and then the scope stopped covering it.
    expect(countRows(["A3"], ["A1"], isKnown)).toEqual([
      { serial: "A3", status: "ELSEWHERE" },
      { serial: "A1", status: "NOT_SCANNED" },
    ]);
  });

  it("draws a serial once, however an older draft stored it", () => {
    // Two rows for one serial would be two rows with one React key.
    const rows = countRows(["A1", "A2", "A1"], EXPECTED, isKnown);
    expect(rows.filter((r) => r.serial === "A1")).toHaveLength(1);
    expect(rows[0]).toEqual({ serial: "A1", status: "FOUND" });
  });
});

describe("recordScan", () => {
  it("adds a new serial as the latest", () => {
    expect(recordScan(["A1"], "A2")).toEqual(["A1", "A2"]);
  });

  it("moves a serial scanned again to the end, so it counts once", () => {
    expect(recordScan(["A1", "A2", "A3"], "A1")).toEqual(["A2", "A3", "A1"]);
  });

  it("hands back the same list when the serial is already the latest", () => {
    // Re-reading the label just scanned is not a change to the draft, and a
    // new array would set the autosave off for nothing.
    const scanned = ["A1", "A2"];
    expect(recordScan(scanned, "A2")).toBe(scanned);
  });
});

describe("restoreScans", () => {
  it("reads a saved draft back from BOTH of its lists", () => {
    // Reading `counted` alone lost every unexpected serial on a reload — and
    // the next autosave then lost the take-into-stock decision on it.
    expect(restoreScans(["A1", "A2"], ["ZZ", "B9"])).toEqual([
      "A1",
      "A2",
      "ZZ",
      "B9",
    ]);
  });

  it("puts the unexpected ones last, so they reopen on top", () => {
    const rows = countRows(restoreScans(["A1"], ["ZZ"]), EXPECTED, isKnown);
    expect(rows[0]).toEqual({ serial: "ZZ", status: "UNREGISTERED" });
  });

  it("reads a serial on both lists once, and a record with neither as empty", () => {
    expect(restoreScans(["ZZ"], ["ZZ"])).toEqual(["ZZ"]);
    expect(restoreScans(undefined, undefined)).toEqual([]);
  });
});

describe("removeScan", () => {
  it("takes one read back and keeps the rest in order", () => {
    expect(removeScan(["A1", "A2", "A3"], "A2")).toEqual(["A1", "A3"]);
  });

  it("hands back the same list for a serial that was never scanned", () => {
    const scanned = ["A1"];
    expect(removeScan(scanned, "ZZ")).toBe(scanned);
  });
});
