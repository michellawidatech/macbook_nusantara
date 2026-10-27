/**
 * Closing the book — RETIRED 2026-10-27 (owner: *"Remove the close book
 * button in the transaction history, it will be the reconcile basically."*).
 * `lib/bookClose.ts` has why.
 *
 * The rule now is that there is no lock: a `booksClosedAt` a shop stored
 * before the retirement still loads, and is ignored. Reconciliation flags a
 * reconciled period that is later edited instead of refusing the edit.
 */
import { describe, expect, it } from "vitest";
import {
  booksClosedAt,
  isBookClosed,
  isSaleLocked,
} from "../src/lib/bookClose.js";

/** What a shop that closed September before 2026-10-27 still has stored. */
const STORED = { booksClosedAt: "2026-09-30T16:59:59.999Z" };

describe("the retired book close", () => {
  it("reads every setting as open, a stored close included", () => {
    expect(booksClosedAt(undefined)).toBeUndefined();
    expect(booksClosedAt({})).toBeUndefined();
    expect(booksClosedAt({ booksClosedAt: "" })).toBeUndefined();
    expect(booksClosedAt(STORED)).toBeUndefined();
  });

  it("locks no date, even one inside the old closed period", () => {
    expect(isBookClosed("2026-09-29T02:00:00.000Z", STORED)).toBe(false);
    expect(isBookClosed(STORED.booksClosedAt, STORED)).toBe(false);
    expect(isBookClosed("2020-01-01T00:00:00.000Z", STORED)).toBe(false);
  });

  it("locks no sale, even a settled one inside the old closed period", () => {
    const sale = {
      ts: "2026-09-12T03:00:00.000Z",
      total: 5_000_000,
      settled: true,
      payments: [
        {
          id: "p1",
          method: "TUNAI",
          amount: 5_000_000,
          state: "SETTLED" as const,
          at: "2026-09-12T03:00:00.000Z",
        },
      ],
    } as unknown as Parameters<typeof isSaleLocked>[0];
    expect(isSaleLocked(sale, STORED)).toBe(false);
  });
});
