/**
 * Closing the book (owner ask 2026-09-24) — the rule, where a test can read
 * it. `lib/bookClose.ts` has why.
 *
 * What the screens do with it is elsewhere: Transaction History disables the
 * editor, `PaymentsModal` opens read-only, and `DebtPaymentModal` drops the
 * sale from what it offers. All three ask this file the same question.
 */
import { describe, expect, it } from "vitest";
import { booksClosedAt, endOfDay, isBookClosed } from "../src/lib/bookClose.js";

const CLOSED = { booksClosedAt: "2026-09-30T16:59:59.999Z" };

describe("booksClosedAt", () => {
  it("is undefined while the book is open", () => {
    expect(booksClosedAt(undefined)).toBeUndefined();
    expect(booksClosedAt({})).toBeUndefined();
  });

  it("reads a blank setting as open, not as 1970", () => {
    // Clearing the setting writes "", and the store spells an absent key the
    // same way. Either has to mean "open" — read as an instant it would be
    // earlier than every sale, which is the one reading that breaks nothing
    // and hides everything.
    expect(booksClosedAt({ booksClosedAt: "" })).toBeUndefined();
    expect(booksClosedAt({ booksClosedAt: "   " })).toBeUndefined();
  });
});

describe("isBookClosed", () => {
  it("locks a sale before the closing instant and leaves the next one alone", () => {
    expect(isBookClosed("2026-09-29T02:00:00.000Z", CLOSED)).toBe(true);
    expect(isBookClosed("2026-10-01T02:00:00.000Z", CLOSED)).toBe(false);
  });

  it("includes the boundary itself", () => {
    expect(isBookClosed(CLOSED.booksClosedAt, CLOSED)).toBe(true);
  });

  it("locks nothing while the book is open", () => {
    expect(isBookClosed("2020-01-01T00:00:00.000Z", {})).toBe(false);
  });

  it("locks nothing for a sale with no date", () => {
    expect(isBookClosed(undefined, CLOSED)).toBe(false);
    expect(isBookClosed("", CLOSED)).toBe(false);
  });
});

describe("endOfDay", () => {
  it("runs to the last moment of the LOCAL day", () => {
    // Somebody closing the book on the 30th means their own 30th. Taking the
    // date at face value in Jakarta would leave seven hours of it open.
    const end = new Date(endOfDay(new Date(2026, 8, 30, 9, 0, 0)));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(8);
    expect(end.getDate()).toBe(30);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("closes a day that covers every sale on it", () => {
    const settings = { booksClosedAt: endOfDay(new Date(2026, 8, 30)) };
    const lateThatDay = new Date(2026, 8, 30, 22, 30).toISOString();
    const nextMorning = new Date(2026, 9, 1, 8, 0).toISOString();
    expect(isBookClosed(lateThatDay, settings)).toBe(true);
    expect(isBookClosed(nextMorning, settings)).toBe(false);
  });
});
