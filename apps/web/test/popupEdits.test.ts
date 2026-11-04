/**
 * The unit popup's held answers (2026-11-04, after review): per-field edits on
 * units that already have a serial, laid over the store until Done.
 */
import { describe, expect, it } from "vitest";
import {
  applyUnitEdit,
  changedSerials,
  parsePopupEdits,
  withEdits,
} from "../src/lib/popupEdits.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb, Unit } from "../src/mock/seed.js";

const fresh = (): MockDb => structuredClone(getDb());
const qc = (d: MockDb): Unit => d.units.find((u) => u.status === "QC")!;

describe("popup edits", () => {
  it("lays the edits over the store without touching it", () => {
    const d = fresh();
    const u = qc(d);
    const view = withEdits(d, {
      [u.serial]: { grade: "B", description: ["Mulus"] },
    });
    const shown = view.units.find((x) => x.serial === u.serial)!;
    expect(shown).toMatchObject({ grade: "B", description: "Mulus" });
    expect(d.units.find((x) => x.serial === u.serial)!.grade).toBe(u.grade);
  });

  it("counts an edit that nets to what is stored as no change", () => {
    const d = fresh();
    const u = qc(d);
    expect(
      changedSerials(d, { [u.serial]: { grade: u.grade ?? null } }),
    ).toEqual([]);
    expect(changedSerials(d, { [u.serial]: { grade: "C" } })).toEqual([
      u.serial,
    ]);
  });

  it("empties a price or a never-serviced answer with null", () => {
    const u = { ...qc(fresh()), price: 5_000_000, neverServiced: true } as Unit;
    applyUnitEdit(u, { price: null, neverServiced: null });
    expect(u.price).toBeUndefined();
    expect(u.neverServiced).toBeUndefined();
  });

  it("drops a kept edit whose unit has gone or left QC", () => {
    const d = fresh();
    const inQc = qc(d);
    const shelved = d.units.find((x) => x.status === "TERSEDIA")!;
    const kept = parsePopupEdits(
      {
        [inQc.serial]: { grade: "A" },
        [shelved.serial]: { grade: "A" },
        NOPE: { grade: "A" },
      },
      d.units,
    );
    expect(Object.keys(kept)).toEqual([inQc.serial]);
    expect(parsePopupEdits("junk", d.units)).toEqual({});
  });
});
