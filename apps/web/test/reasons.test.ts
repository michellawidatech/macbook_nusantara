/**
 * The no-orphan-data rule for reasons.
 *
 * The owner's requirement, in their words: "It is important to make sure the
 * reasons are inputted into the settings before it is on stock adjustment table
 * to avoid orphan data." That ordering is what `ensureReason` exists to
 * guarantee, and this is the test that says so — a UI click proves one path,
 * this proves the rule.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed, type MockDb } from "../src/mock/seed.js";
import { ensureReason, reasonLabel } from "../src/mock/store.js";

let db: MockDb;

beforeEach(() => {
  db = buildSeed();
});

describe("ensureReason", () => {
  it("returns the existing row for a seeded reason instead of duplicating it", () => {
    const before = db.reasons.length;
    const id = ensureReason(db, "ADJUSTMENT", "Internal Use");
    expect(id).toBe("rsn-adj-internal");
    expect(db.reasons.length).toBe(before);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    const before = db.reasons.length;
    expect(ensureReason(db, "ADJUSTMENT", "  internal use ")).toBe(
      "rsn-adj-internal",
    );
    expect(db.reasons.length).toBe(before);
  });

  it("creates the reason when it is new, and returns an id that resolves", () => {
    const id = ensureReason(db, "ADJUSTMENT", "Loaned to a customer");
    const created = db.reasons.find((r) => r.id === id);
    expect(created).toMatchObject({
      activity: "ADJUSTMENT",
      label: "Loaned to a customer",
      active: true,
    });
    expect(reasonLabel(db, id)).toBe("Loaned to a customer");
  });

  it("keeps the same label separate per activity", () => {
    // "Other" is a legitimate reason on two different lists, and they are not
    // the same row — switching it off for supplier returns must not switch it
    // off for customer returns.
    const supplier = ensureReason(db, "RETURN_SUPPLIER", "Other");
    const customer = ensureReason(db, "RETURN_CUSTOMER", "Other");
    expect(supplier).not.toBe(customer);
  });

  it("switches a deactivated reason back on when it is used again", () => {
    const reason = db.reasons.find((r) => r.id === "rsn-adj-service")!;
    reason.active = false;
    ensureReason(db, "ADJUSTMENT", "On Service");
    expect(db.reasons.find((r) => r.id === "rsn-adj-service")!.active).toBe(
      true,
    );
  });

  it("writes nothing for an empty label", () => {
    const before = db.reasons.length;
    expect(ensureReason(db, "ADJUSTMENT", "   ")).toBe("");
    expect(db.reasons.length).toBe(before);
  });

  it("has the reason on the settings list before any adjustment can point at it", () => {
    // The ordering the owner asked for, asserted as a sequence: resolve the
    // reason, and only then write the row that references it. At no point does
    // an adjustment name a reason the settings list has not got.
    const reasonId = ensureReason(db, "ADJUSTMENT", "Sent to the photographer");
    expect(db.reasons.some((r) => r.id === reasonId)).toBe(true);

    db.adjustments.unshift({
      id: "adj-test",
      serial: db.units[0]!.serial,
      description: "For the catalogue shoot",
      reasonId,
      at: new Date().toISOString(),
      staff: "Michella",
    });

    // Every adjustment resolves to a real reason — no orphans.
    for (const a of db.adjustments) {
      expect(db.reasons.some((r) => r.id === a.reasonId)).toBe(true);
    }
  });
});
