import { describe, expect, it } from "vitest";
import { buildSeed, type Unit } from "../src/mock/seed.js";
import { batchProblems, normaliseSerial } from "../src/lib/adjustmentBatch.js";

const db = buildSeed();
const unitOf = (serial: string) =>
  db.units.find((u) => u.serial === normaliseSerial(serial));
const label = (s: string) => s;
/** The nth seeded unit in a status, so a test can name two distinct units. */
const pick = (status: Unit["status"], nth = 0) => {
  const u = db.units.filter((x) => x.status === status)[nth];
  if (!u) throw new Error(`seed has no ${status} unit #${nth}`);
  return u.serial;
};

const check = (
  kind: "IN" | "OUT",
  lines: { serial: string; skuId?: string; batteryHealth?: number }[],
  reason = "Internal Use",
) => batchProblems({ kind, reason, lines }, unitOf, label);

describe("batchProblems", () => {
  it("passes a batch of held units going out", () => {
    expect(
      check("OUT", [
        { serial: pick("TERSEDIA") },
        { serial: pick("TERSEDIA", 1) },
        // A unit on hold can be taken out — the page releases the hold in the
        // same write.
        { serial: pick("DIRESERVASI") },
      ]),
    ).toEqual([]);
  });

  it("insists on a reason and on at least one line", () => {
    expect(check("OUT", [{ serial: pick("TERSEDIA") }], "  ")).toContain(
      "Pick or type a reason for this batch.",
    );
    expect(check("OUT", [])).toContain("Add at least one unit.");
  });

  it("catches the same serial twice, however it was typed", () => {
    const s = pick("TERSEDIA");
    const errs = check("OUT", [
      { serial: s },
      { serial: ` ${s.toLowerCase()} ` },
    ]);
    expect(errs).toContain(`${s} is on this batch twice.`);
  });

  it("an unknown serial can go in with a product, never out", () => {
    expect(check("OUT", [{ serial: "C02NOTHERE0001" }])[0]).toMatch(
      /only be adjusted in/,
    );
    expect(check("IN", [{ serial: "C02NOTHERE0001" }])[0]).toMatch(
      /choose its product and specs/,
    );
    expect(
      check("IN", [{ serial: "C02NOTHERE0001", skuId: db.skus[0]!.id }]),
    ).toEqual([]);
  });

  it("refuses to adjust a unit that is still in QC, in either direction", () => {
    // This used to be the schema's price CHECK talking: a QC unit had no
    // price, so moving it anywhere wrote a row the real database rejected.
    // The CHECK went with the per-unit price on 2026-08-27 and the refusal
    // stayed, because the reason underneath it did — a machine still being
    // graded belongs to Stock In, and adjusting it from here would take it
    // out of the hands of the person holding it.
    const qc = pick("QC");
    for (const kind of ["IN", "OUT"] as const) {
      expect(check(kind, [{ serial: qc }])[0]).toMatch(/still in QC/);
    }
  });

  it("will not put in what is already in stock, or take out what is gone", () => {
    expect(check("IN", [{ serial: pick("TERSEDIA") }])[0]).toMatch(
      /already in stock/,
    );
    expect(check("IN", [{ serial: pick("DIRESERVASI") }])[0]).toMatch(
      /already in stock/,
    );
    expect(check("OUT", [{ serial: pick("TERJUAL") }])[0]).toMatch(
      /nothing to take out/,
    );
  });

  it("lets a sold or lost unit come back in", () => {
    // The mirror of the rule above, and the case it exists for: a unit written
    // off and then found is exactly what an IN adjustment is for.
    expect(check("IN", [{ serial: pick("RETUR_SUPPLIER") }])).toEqual([]);
  });

  it("takes any battery health a battery can actually read", () => {
    const held = () => pick("TERSEDIA");
    expect(check("OUT", [{ serial: held(), batteryHealth: 0 }])).toEqual([]);
    expect(check("OUT", [{ serial: held(), batteryHealth: 91 }])).toEqual([]);
    expect(check("OUT", [{ serial: held(), batteryHealth: 100 }])).toEqual([]);
    // Nobody read one off the machine, which is a state of the field.
    expect(check("OUT", [{ serial: held() }])).toEqual([]);
  });

  it("refuses a reading above 100, which is where the cycle count used to fit", () => {
    // The input allowed 10,000 until 2026-08-26 — the bound from when this was
    // a cycle count. 150% is a stray digit, and it would have been written onto
    // the unit, the adjustment and the timeline note.
    const s = pick("TERSEDIA");
    expect(check("OUT", [{ serial: s, batteryHealth: 150 }])).toContain(
      `${s} has a battery health of 150% — a reading is 0 to 100.`,
    );
  });

  it("says so even when the line is wrong in another way too", () => {
    // The reading is checked before the unit is looked at, so it is not lost
    // behind whichever problem the reader is told about first.
    const errs = check("OUT", [
      { serial: "C02NOTHERE0003", batteryHealth: 250 },
    ]);
    expect(errs).toHaveLength(2);
    expect(errs.some((e) => /battery health of 250%/.test(e))).toBe(true);
    expect(errs.some((e) => /only be adjusted in/.test(e))).toBe(true);
  });

  it("reports every bad line, not just the first", () => {
    const errs = check("OUT", [
      { serial: pick("TERJUAL") },
      { serial: "C02NOTHERE0002" },
      { serial: "" },
    ]);
    expect(errs).toHaveLength(3);
  });
});
