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
});
