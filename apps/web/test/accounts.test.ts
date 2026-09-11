/**
 * The two pots — `lib/accounts.ts`.
 *
 * The spec for the owner's 2026-09-09 ask: a balance is a cash balance and a
 * bank balance, and which one a movement lands in is decided by how the money
 * moved. What is worth pinning here is not the arithmetic — it is the
 * MAPPING, because that is the fact a future method (a new e-wallet, a second
 * bank) will be added against, and the one place a wrong answer silently
 * inflates a figure somebody reconciles against a bank statement.
 */
import { describe, it, expect } from "vitest";
import {
  ADJUSTMENT_METHOD_CODES,
  accountOfMethod,
  balancesOf,
} from "../src/lib/accounts";

describe("which pot a method belongs to", () => {
  it("puts cash in the drawer and everything bankable in the bank", () => {
    expect(accountOfMethod("TUNAI")).toBe("CASH");
    expect(accountOfMethod("COD")).toBe("CASH");
    expect(accountOfMethod("TRANSFER")).toBe("BANK");
    expect(accountOfMethod("KARTU_KREDIT")).toBe("BANK");
    expect(accountOfMethod("QRIS")).toBe("BANK");
  });

  it("banks marketplace money, because only a payout ever reaches a balance", () => {
    // Escrow never becomes a movement — a PENDING payment is filtered out
    // before it gets here — so by the time this is asked the marketplace has
    // paid out, and a payout arrives by transfer.
    expect(accountOfMethod("MARKETPLACE")).toBe("BANK");
  });

  it("places nothing it does not recognise", () => {
    // The safe direction to be wrong in: a method somebody adds in Settings is
    // reported separately rather than quietly joining one of the balances.
    expect(accountOfMethod("GOPAY")).toBeUndefined();
    expect(accountOfMethod("")).toBeUndefined();
  });

  it("offers exactly the owner's three for an adjustment", () => {
    expect([...ADJUSTMENT_METHOD_CODES]).toEqual([
      "TUNAI",
      "TRANSFER",
      "KARTU_KREDIT",
    ]);
    // And every one of them can be placed, or the balance could not count it.
    for (const code of ADJUSTMENT_METHOD_CODES) {
      expect(accountOfMethod(code)).toBeDefined();
    }
  });
});

describe("adding movements up", () => {
  it("keeps the two pots apart", () => {
    const b = balancesOf([
      { method: "TUNAI", amount: 5_000_000 },
      { method: "TRANSFER", amount: 5_000_000 },
      { method: "TUNAI", amount: -1_000_000 },
    ]);
    expect(b.cash).toBe(4_000_000);
    expect(b.bank).toBe(5_000_000);
    expect(b.total).toBe(9_000_000);
  });

  it("starts from the opening figures, each in its own pot", () => {
    const b = balancesOf([{ method: "TUNAI", amount: 250_000 }], {
      cash: 1_000_000,
      bank: 40_000_000,
    });
    expect(b.cash).toBe(1_250_000);
    expect(b.bank).toBe(40_000_000);
  });

  it("treats a missing opening figure as nothing, not as unknown", () => {
    const b = balancesOf([], { bank: 7_000_000 });
    expect(b.cash).toBe(0);
    expect(b.bank).toBe(7_000_000);
    expect(b.total).toBe(7_000_000);
  });

  it("reports what it could not place instead of dropping it", () => {
    const b = balancesOf([
      { method: "TUNAI", amount: 1_000_000 },
      { method: "GOPAY", amount: 400_000 },
    ]);
    expect(b.cash).toBe(1_000_000);
    expect(b.bank).toBe(0);
    // Deliberately NOT in the total: the total is what the shop can spend
    // from a pot it can name.
    expect(b.total).toBe(1_000_000);
    expect(b.unassigned).toBe(400_000);
  });

  it("lets a pot go negative rather than hiding an overdraft", () => {
    // A cash drawer that has paid out more than it took is a counting error
    // somebody has to see. Flooring it at zero would make the error vanish
    // and the totals stop reconciling.
    const b = balancesOf([{ method: "TUNAI", amount: -500_000 }]);
    expect(b.cash).toBe(-500_000);
  });
});
