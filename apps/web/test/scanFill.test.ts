/**
 * Stock In's auto-advance: where each scanned serial lands on a grid of rows
 * that are waiting for one.
 */
import { describe, expect, it } from "vitest";
import { planSerialFill, type FillRow } from "../src/lib/scanFill.js";

/** A PO for three units books three placeholder rows to be filled at QC. */
const pending = (): FillRow[] => [
  { key: "TBD-001", shown: "" },
  { key: "TBD-002", shown: "" },
  { key: "TBD-003", shown: "" },
];

const nothingKnown = () => false;

describe("planSerialFill", () => {
  it("fills the first row still waiting", () => {
    expect(planSerialFill("SM39K90HGPN", pending(), nothingKnown)).toEqual({
      kind: "fill",
      rowKey: "TBD-001",
    });
  });

  it("advances down the grid as rows fill up", () => {
    const rows = pending();
    const scanned = ["SM39K90HGPN", "C02ZZ111AAA", "C02ZZ222BBB"];
    const landed: string[] = [];

    for (const serial of scanned) {
      const plan = planSerialFill(serial, rows, nothingKnown);
      expect(plan.kind).toBe("fill");
      if (plan.kind !== "fill") return;
      landed.push(plan.rowKey);
      // Stand in for the draft edit the page makes.
      const row = rows.find((r) => r.key === plan.rowKey);
      if (row) rows[rows.indexOf(row)] = { ...row, shown: serial };
    }

    expect(landed).toEqual(["TBD-001", "TBD-002", "TBD-003"]);
    expect(rows.map((r) => r.shown)).toEqual(scanned);
  });

  it("skips rows a person already typed into", () => {
    const rows: FillRow[] = [
      { key: "TBD-001", shown: "TYPED-BY-HAND" },
      { key: "TBD-002", shown: "" },
    ];
    expect(planSerialFill("SM39K90HGPN", rows, nothingKnown)).toEqual({
      kind: "fill",
      rowKey: "TBD-002",
    });
  });

  it("flags a double scan at the row that already has it, not on submit", () => {
    const rows: FillRow[] = [
      { key: "TBD-001", shown: "SM39K90HGPN" },
      { key: "TBD-002", shown: "" },
    ];
    expect(planSerialFill("SM39K90HGPN", rows, nothingKnown)).toEqual({
      kind: "duplicate",
      rowKey: "TBD-001",
    });
  });

  it("refuses a serial the system already carries", () => {
    const known = (s: string) => s === "SM39K90HGPN";
    expect(planSerialFill("SM39K90HGPN", pending(), known)).toEqual({
      kind: "exists",
    });
  });

  it("says so rather than dropping the scan when the grid is full", () => {
    const rows: FillRow[] = [{ key: "TBD-001", shown: "C02ZZ111AAA" }];
    expect(planSerialFill("SM39K90HGPN", rows, nothingKnown)).toEqual({
      kind: "full",
    });
  });

  it("treats a unit that already carries its own serial as filled", () => {
    // Not every QC row is a placeholder: a single-qty PO line can arrive with
    // its serial already recorded, and a scan must not overwrite it.
    const rows: FillRow[] = [
      { key: "C027402603PN", shown: "C027402603PN" },
      { key: "TBD-002", shown: "" },
    ];
    expect(planSerialFill("SM39K90HGPN", rows, nothingKnown)).toEqual({
      kind: "fill",
      rowKey: "TBD-002",
    });
  });
});
