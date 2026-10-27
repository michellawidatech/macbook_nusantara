/**
 * The finance scope is by collection (`FINANCE_COLLECTIONS`), so a new money
 * collection is withheld by joining that list. Reconciliation (2026-10-27)
 * is the case pinned here: its rows say what the bank and the drawer hold.
 */
import { describe, expect, it } from "vitest";
import { FINANCE_COLLECTIONS } from "@nusantara/store";
import {
  assertFinanceWritable,
  scopeDelta,
  scopeSnapshot,
} from "../src/auth/financeScope.js";

const without = { canViewFinance: false };
const withAccess = { canViewFinance: true };

describe("finance scope — reconciliation (2026-10-27)", () => {
  it("lists both reconciliation collections as finance", () => {
    expect(FINANCE_COLLECTIONS.has("reconciliations")).toBe(true);
    expect(FINANCE_COLLECTIONS.has("statementLines")).toBe(true);
  });

  it("empties them in a snapshot and strips them from a delta", () => {
    const db = {
      reconciliations: [{ id: "r" }],
      statementLines: [{ id: "l" }],
      units: [{ serial: "s" }],
    };
    expect(scopeSnapshot(without, db)).toEqual({
      reconciliations: [],
      statementLines: [],
      units: [{ serial: "s" }],
    });
    expect(scopeSnapshot(withAccess, db)).toBe(db);
    const delta = {
      rows: { reconciliations: [{ id: "r" }], statementLines: [{ id: "l" }] },
      removed: { statementLines: ["l0"] },
      order: {},
    };
    expect(scopeDelta(without, delta)).toEqual({
      rows: {},
      removed: {},
      order: {},
    });
  });

  it("refuses an edit or a removal from an account without access", () => {
    const edit = {
      collections: {
        reconciliations: {
          rows: [{ key: "r", base: { id: "r" }, next: { id: "r" } }],
        },
      },
    };
    expect(() => assertFinanceWritable(without, edit)).toThrow(
      /akses keuangan/,
    );
    const removal = {
      collections: {
        statementLines: { rows: [{ key: "l", base: { id: "l" } }] },
      },
    };
    expect(() => assertFinanceWritable(without, removal)).toThrow(
      /akses keuangan/,
    );
    expect(() => assertFinanceWritable(withAccess, edit)).not.toThrow();
  });

  it("withholds and refuses a month's asides with it (owner-approved 2026-10-27)", () => {
    // An aside is nested on its reconciliation, so the collection's scope is
    // its scope: no separate list to forget.
    const rec = {
      id: "r",
      asides: [{ id: "ra-1", paymentId: "p", note: "Owner's account" }],
    };
    expect(
      scopeSnapshot(without, { reconciliations: [rec], units: [] }),
    ).toEqual({ reconciliations: [], units: [] });
    const withdraw = {
      collections: {
        reconciliations: {
          rows: [
            {
              key: "r",
              base: rec,
              next: {
                ...rec,
                asides: [{ ...rec.asides[0], withdrawnAt: "2026-10-27" }],
              },
            },
          ],
        },
      },
    };
    expect(() => assertFinanceWritable(without, withdraw)).toThrow(
      /akses keuangan/,
    );
    expect(() => assertFinanceWritable(withAccess, withdraw)).not.toThrow();
  });
});
