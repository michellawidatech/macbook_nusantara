/**
 * One serial field, two kinds of hand, two kinds of unit — the owner's rules of
 * 2026-09-21. See the table in `lib/serialInput.ts`:
 *
 * | | sealed (`NEW`) | second-hand (A/B/C) |
 * |---|---|---|
 * | scanned | `S` + 10–12, `I`/`O` → `1`/`0`, the `S` dropped | as read |
 * | typed | 10–12, `I`/`O` → `1`/`0` | as read |
 *
 * and a serial read before its unit has a grade is not judged at all.
 */
import { describe, expect, it } from "vitest";
import {
  readSerialInput,
  resolveSerialQuery,
  serialConditionOf,
  serialMatchesQuery,
  serialNamedBy,
} from "../src/lib/serialInput.js";

/** What is printed on the case: the serial. */
const SERIAL = "C02740137JKM";
/** Apple's barcode of it: the marker, then the serial. */
const BARCODE = `S${SERIAL}`;

const sealed = (raw: string, scanned: boolean) =>
  readSerialInput(raw, { scanned, condition: "NEW" });
const second = (raw: string, scanned: boolean) =>
  readSerialInput(raw, { scanned, condition: "SECOND" });

describe("a sealed unit, scanned", () => {
  it("takes the S off Apple's barcode and files the serial", () => {
    const r = sealed(BARCODE, true);
    expect(r).toMatchObject({
      ok: true,
      serial: SERIAL,
      source: "scan",
      unmarked: true,
    });
  });

  it("puts no supplier code on it (owner, 2026-09-21)", () => {
    const r = sealed(BARCODE, true);
    expect(r.ok && r.serial).toBe(SERIAL);
  });

  it("refuses a read with no S — the wrong barcode on the box", () => {
    const r = sealed(SERIAL, true);
    expect(r).toMatchObject({ ok: false, reason: "no-marker", source: "scan" });
  });

  it("reads I and O as 1 and 0", () => {
    const r = sealed("SC0274O137JKM", true);
    expect(r).toMatchObject({ ok: true, serial: SERIAL, corrected: true });
  });

  it("refuses a read too short or too long to be one label", () => {
    expect(sealed("SW80X9", true)).toMatchObject({ reason: "length" });
    expect(sealed(`${BARCODE}${BARCODE}`, true)).toMatchObject({
      reason: "length",
    });
  });
});

describe("a sealed unit, typed", () => {
  it("files ten to twelve as they are", () => {
    expect(sealed(SERIAL, false)).toMatchObject({
      ok: true,
      serial: SERIAL,
      source: "typed",
      unmarked: false,
    });
    expect(sealed("DQXFPXWCK7", false)).toMatchObject({
      ok: true,
      serial: "DQXFPXWCK7",
    });
  });

  it("reads I and O as 1 and 0 (owner answer)", () => {
    expect(sealed("CO274O137JKM", false)).toMatchObject({
      ok: true,
      serial: SERIAL,
      corrected: true,
    });
  });

  it("drops the S of a whole barcode typed in, or a scanner too slow to spot", () => {
    expect(sealed(BARCODE, false)).toMatchObject({ ok: true, serial: SERIAL });
  });

  it("refuses a length no serial has", () => {
    expect(sealed("W80", false)).toMatchObject({ ok: false, reason: "length" });
    expect(sealed("C02740137JKMXYZ", false)).toMatchObject({
      ok: false,
      reason: "length",
    });
  });

  it("refuses punctuation", () => {
    expect(sealed("C02-40137JKM", false)).toMatchObject({
      ok: false,
      reason: "charset",
    });
  });
});

describe("a second-hand unit — taken as read, scanned or typed", () => {
  it("keeps a scanned barcode whole, S and all", () => {
    expect(second(BARCODE, true)).toMatchObject({ ok: true, serial: BARCODE });
  });

  it("keeps a scan with no S", () => {
    expect(second(SERIAL, true)).toMatchObject({ ok: true, serial: SERIAL });
  });

  it("maps no letter and checks no length", () => {
    expect(second("SC0274O137JKM", true)).toMatchObject({
      ok: true,
      serial: "SC0274O137JKM",
      corrected: false,
    });
    expect(second("W80", false)).toMatchObject({ ok: true, serial: "W80" });
    expect(second("4H629LL0A0GCN-9", false)).toMatchObject({
      ok: true,
      serial: "4H629LL0A0GCN-9",
    });
  });

  it("only trims and upper-cases", () => {
    expect(second("  c02 740137jkm ", false)).toMatchObject({
      ok: true,
      serial: SERIAL,
    });
  });

  it("still needs something to be there", () => {
    expect(second("  ", false)).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("the serial waits for the grade (owner answer, 2026-09-21)", () => {
  it("does not judge a serial whose unit has no condition yet", () => {
    const r = readSerialInput(BARCODE, { scanned: true, condition: undefined });
    expect(r).toMatchObject({
      ok: false,
      reason: "needs-grade",
      source: "scan",
      input: BARCODE,
    });
  });

  it("reads a grade as a condition", () => {
    expect(serialConditionOf("NEW")).toBe("NEW");
    expect(serialConditionOf("A")).toBe("SECOND");
    expect(serialConditionOf("C")).toBe("SECOND");
    expect(serialConditionOf(undefined)).toBeUndefined();
    expect(serialConditionOf("")).toBeUndefined();
  });

  it("files the same text differently once the grade is known", () => {
    // Held as it arrived, judged when the grade is picked.
    expect(sealed(BARCODE, true)).toMatchObject({ serial: SERIAL });
    expect(second(BARCODE, true)).toMatchObject({ serial: BARCODE });
  });
});

describe("resolveSerialQuery — a search box validates nothing", () => {
  /** A unit filed under the new rule, one filed with its S, one second-hand. */
  const known = ["DQXFPXWCK7", "SC02740137JKM", "W80-OLD"];

  it("hands back a serial the store already holds, untouched", () => {
    expect(resolveSerialQuery("W80-OLD", known)).toBe("W80-OLD");
    expect(resolveSerialQuery("sc02740137jkm", known)).toBe("SC02740137JKM");
  });

  it("finds a sealed unit from Apple's barcode", () => {
    expect(resolveSerialQuery("SDQXFPXWCK7", known)).toBe("DQXFPXWCK7");
  });

  it("finds a unit filed with its S from the number on the case", () => {
    expect(resolveSerialQuery(SERIAL, known)).toBe("SC02740137JKM");
  });

  it("finds a unit through a misread I or O", () => {
    expect(resolveSerialQuery("SC0274O137JKM", known)).toBe("SC02740137JKM");
    expect(resolveSerialQuery("C0274O137JKM", known)).toBe("SC02740137JKM");
  });

  it("still reads a 2026-09-01 store sticker back to its unit", () => {
    expect(resolveSerialQuery(`AS${BARCODE}`, known)).toBe("SC02740137JKM");
  });

  it("hands an unknown query straight back, so the caller can say 'not found'", () => {
    expect(resolveSerialQuery("SC02999999QQ", known)).toBe("SC02999999QQ");
    expect(resolveSerialQuery("", known)).toBe("");
  });

  it("refuses nothing, however it looks", () => {
    expect(resolveSerialQuery("??", known)).toBe("??");
  });
});

describe("serialNamedBy — a box that acts the moment it has a serial", () => {
  const known = ["C02740137JK", "C02740137JKM", "DQXFPXWCK7"];

  it("names a serial once it is typed whole", () => {
    expect(serialNamedBy("DQXFPXWCK7", known)).toBe("DQXFPXWCK7");
    expect(serialNamedBy("SDQXFPXWCK7", known)).toBe("DQXFPXWCK7");
  });

  it("waits while a longer stored serial could still be meant", () => {
    // Typing C02740137JKM passes through C02740137JK on the way.
    expect(serialNamedBy("C02740137JK", known)).toBeNull();
    expect(serialNamedBy("C02740137JKM", known)).toBe("C02740137JKM");
  });

  it("names nothing on a product name or a partial serial", () => {
    expect(serialNamedBy("C0274", known)).toBeNull();
    expect(serialNamedBy("MacBook Air", known)).toBeNull();
    expect(serialNamedBy("", known)).toBeNull();
  });
});

describe("serialMatchesQuery — the till's chooser narrows as somebody types", () => {
  it("matches part of a serial, in any case, and everything when empty", () => {
    expect(serialMatchesQuery("0137j", SERIAL)).toBe(true);
    expect(serialMatchesQuery("  ", SERIAL)).toBe(true);
    expect(serialMatchesQuery("9999", SERIAL)).toBe(false);
  });

  it("finds the unit from its barcode and from a misread I or O", () => {
    expect(serialMatchesQuery(BARCODE, SERIAL)).toBe(true);
    expect(serialMatchesQuery("C0274O137", SERIAL)).toBe(true);
  });
});
