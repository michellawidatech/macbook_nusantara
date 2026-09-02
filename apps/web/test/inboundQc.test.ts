/**
 * The QC grid.
 *
 * These cases are the ones the placeholder design got wrong: a machine that
 * exists in the database before anyone has read a serial off it, a quantity
 * that goes up without the grid noticing, and a quantity that comes down and
 * takes somebody's graded work with it.
 */
import { describe, expect, it } from "vitest";
import {
  joinDescription,
  overQuotaSerials,
  purgePlaceholderUnits,
  qcGroups,
  qcRows,
  reslotDrafts,
  splitDescription,
} from "../src/lib/inboundQc.js";
import type { MockDb, Po, Unit, UnitEvent } from "../src/mock/seed.js";

const unit = (over: Partial<Unit> & Pick<Unit, "serial">): Unit => ({
  skuId: "sku-air",
  status: "QC",
  locationId: "wh-1",
  buy: 1_000,
  description: "",
  poId: "po-1",
  ...over,
});

const po = (items: Po["items"]): Po => ({
  id: "po-1",
  code: "PI/2608/0001",
  supplierId: "sup-1",
  invoice: "INV-1",
  date: "2026-08-26",
  locationId: "wh-1",
  items,
  payments: [],
  shippingFee: 0,
  taxFee: 0,
  discount: 0,
  status: "RECEIVED",
});

const line = (qty: number, over: Partial<Po["items"][number]> = {}) => ({
  id: `poi-${qty}-${over.skuId ?? "air"}`,
  skuId: "sku-air",
  serial: null,
  qty,
  unitCost: 1_000,
  ...over,
});

const kinds = (rows: ReturnType<typeof qcRows>) => rows.map((r) => r.kind);

describe("qcRows", () => {
  it("expects one row per machine the invoice paid for", () => {
    const rows = qcRows(po([line(3)]), []);
    expect(kinds(rows)).toEqual(["slot", "slot", "slot"]);
    // Nothing was written to get them. This is the whole change: three rows
    // waiting for a serial, and zero units claiming to be machines.
    expect(rows.every((r) => r.kind === "slot" && r.skuId === "sku-air")).toBe(
      true,
    );
  });

  it("carries the line's cost and position onto each slot", () => {
    const rows = qcRows(po([line(2, { unitCost: 4_100_000 })]), []);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "slot",
        unitCost: 4_100_000,
        ordinal: 1,
        quota: 2,
      }),
      expect.objectContaining({
        kind: "slot",
        unitCost: 4_100_000,
        ordinal: 2,
        quota: 2,
      }),
    ]);
  });

  it("puts identified machines first and keeps a row for each one still out", () => {
    const rows = qcRows(po([line(3)]), [unit({ serial: "C02-AAA" })]);
    expect(kinds(rows)).toEqual(["unit", "slot", "slot"]);
  });

  it("adds a row the moment a quantity goes up", () => {
    // The bug the old sync existed to paper over: the grid was built once, at
    // arrival, so a quantity raised afterwards had nowhere to put the machine.
    const before = qcRows(po([line(1)]), [unit({ serial: "C02-AAA" })]);
    const after = qcRows(po([line(2)]), [unit({ serial: "C02-AAA" })]);
    expect(kinds(before)).toEqual(["unit"]);
    expect(kinds(after)).toEqual(["unit", "slot"]);
  });

  it("keeps a slot's key while the slots before it fill up", () => {
    // Keys carry the half-typed serial in the page's draft state. If filling
    // one slot re-keyed the rest, whatever somebody was typing into the next
    // row would jump to a different row or vanish.
    const empty = qcRows(po([line(3)]), []);
    const partly = qcRows(po([line(3)]), [unit({ serial: "C02-AAA" })]);
    expect(empty.map((r) => r.key).slice(1)).toEqual(
      partly.slice(1).map((r) => r.key),
    );
  });

  it("expects nothing for a line the supplier never sent", () => {
    expect(
      qcRows(po([line(2), line(1, { notReceived: true })]), []),
    ).toHaveLength(2);
  });

  it("adds up two lines of the same product", () => {
    expect(qcRows(po([line(2), line(1)]), [])).toHaveLength(3);
  });

  it("ignores units belonging to another order", () => {
    const rows = qcRows(po([line(1)]), [
      unit({ serial: "C02-AAA", poId: "po-other" }),
    ]);
    expect(kinds(rows)).toEqual(["slot"]);
  });

  it("flags the surplus rather than deleting it when a quantity comes down", () => {
    // The owner's instruction: "highlight the row in red to show it instead of
    // deleting it". Twenty seconds of work with a machine in hand is not
    // something a retyped number gets to discard.
    const units = [
      unit({ serial: "C02-AAA", description: "mulus" }),
      unit({ serial: "C02-BBB", description: "scuffed lid" }),
    ];
    const rows = qcRows(po([line(1)]), units);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "unit", overQuota: false }),
      expect.objectContaining({ kind: "unit", overQuota: true }),
    ]);
    expect([...overQuotaSerials(po([line(1)]), units)]).toEqual(["C02-BBB"]);
  });

  it("keeps showing machines whose line was deleted outright", () => {
    const units = [unit({ serial: "C02-AAA" })];
    const rows = qcRows(po([]), units);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "unit", overQuota: true }),
    ]);
  });

  it("counts a never-received line's machines as unaccounted for", () => {
    const units = [unit({ serial: "C02-AAA" })];
    expect([
      ...overQuotaSerials(po([line(1, { notReceived: true })]), units),
    ]).toEqual(["C02-AAA"]);
  });
});

describe("purgePlaceholderUnits", () => {
  const event = (serial: string): UnitEvent => ({
    id: `ev-${serial}`,
    serial,
    seq: 1,
    type: "DITERIMA",
    at: "2026-08-26T02:00:00.000Z",
    fromStatus: "QC",
    toStatus: "QC",
    locationId: "wh-1",
    staff: "Michella",
  });

  it("deletes a left-over placeholder, row and ledger together", () => {
    const d = {
      units: [unit({ serial: "TBD-000001-1" }), unit({ serial: "C02-AAA" })],
      events: [event("TBD-000001-1"), event("C02-AAA")],
    } as unknown as MockDb;

    expect(purgePlaceholderUnits(d)).toBe(1);
    expect(d.units.map((u) => u.serial)).toEqual(["C02-AAA"]);
    // The events go too. They are not history: nothing ever happened to a
    // machine nobody had held.
    expect(d.events.map((e) => e.serial)).toEqual(["C02-AAA"]);
  });

  it("leaves a store that never had one alone", () => {
    const d = {
      units: [unit({ serial: "C02-AAA" })],
      events: [event("C02-AAA")],
    } as unknown as MockDb;
    expect(purgePlaceholderUnits(d)).toBe(0);
    expect(d.units).toHaveLength(1);
  });
});

describe("reslotDrafts", () => {
  /** The rows for one product, with `held` of its `quota` already identified. */
  const grid = (held: number, quota: number) =>
    qcRows(
      po([line(quota)]),
      Array.from({ length: held }, (_, i) => unit({ serial: `S${i}` })),
    );

  it("leaves the rows below alone when the first empty one is filled", () => {
    // The ordinary case — a scan lands on the first row still waiting — and
    // the one the keys already got right: filling `slot:…:0` removes exactly
    // the key that disappears, so nothing else has to move.
    const before = grid(0, 3);
    const after = grid(1, 3);
    const out = reslotDrafts(
      { "slot:sku-air:1": "dent kiri", "slot:sku-air:2": "fullset dus" },
      before,
      after,
      "slot:sku-air:0",
    );
    expect(out).toEqual({
      "slot:sku-air:1": "dent kiri",
      "slot:sku-air:2": "fullset dus",
    });
  });

  it("carries a draft along when a row further down is filled first", () => {
    // The bug this function exists for. Filling ANY slot removes the FIRST
    // key from the list, so text typed into the rows above the one that was
    // filled would land a row higher than the machine it describes — the dent
    // on the wrong laptop, silently.
    const before = grid(0, 3);
    const after = grid(1, 3);
    const out = reslotDrafts(
      { "slot:sku-air:0": "dent kiri", "slot:sku-air:1": "layar garis" },
      before,
      after,
      // The third row got its serial first.
      "slot:sku-air:2",
    );
    expect(out).toEqual({
      "slot:sku-air:1": "dent kiri",
      "slot:sku-air:2": "layar garis",
    });
  });

  it("drops what was on the row that became a unit", () => {
    // Its description and battery reading have gone onto the unit by now —
    // `identify` carries them — so a copy left in the draft map would paint
    // itself back over whatever the next row holds.
    const out = reslotDrafts(
      { "slot:sku-air:0": "mulus" },
      grid(0, 2),
      grid(1, 2),
      "slot:sku-air:0",
    );
    expect(out).toEqual({});
  });

  it("never moves a draft that belongs to a unit row", () => {
    // Those are keyed by serial, which does not renumber.
    const out = reslotDrafts(
      { "unit:S0": "already graded", "slot:sku-air:1": "waiting" },
      grid(1, 3),
      grid(2, 3),
      "slot:sku-air:1",
    );
    expect(out["unit:S0"]).toBe("already graded");
  });
});

describe("splitDescription / joinDescription", () => {
  it("reads a stored description as the facts it is made of", () => {
    // "Mulus, fullset dus, charger original" is three facts about one machine,
    // and the shop had already been typing them with commas between. The
    // column does not change — the screen just stops pretending it is prose.
    expect(splitDescription("Mulus, fullset dus, charger original")).toEqual([
      "Mulus",
      "fullset dus",
      "charger original",
    ]);
  });

  it("drops the empties a hand-typed list leaves behind", () => {
    expect(splitDescription(" Mulus ,, ,fullset dus,")).toEqual([
      "Mulus",
      "fullset dus",
    ]);
    expect(splitDescription("")).toEqual([]);
    expect(splitDescription("   ")).toEqual([]);
  });

  it("keeps one copy of a phrase chosen twice", () => {
    // Case-insensitively, for the same reason `ensureQcDescription` is: two
    // spellings of one phrase are one phrase. The first spelling wins, because
    // it is the one already on the machine.
    expect(splitDescription("Mulus, mulus, MULUS")).toEqual(["Mulus"]);
  });

  it("round-trips", () => {
    expect(joinDescription(["Mulus", "Fullset dus"])).toBe(
      "Mulus, Fullset dus",
    );
    expect(splitDescription(joinDescription(["A", "B"]))).toEqual(["A", "B"]);
    expect(joinDescription([])).toBe("");
  });
});

describe("qcGroups", () => {
  it("says what each product still owes, so the heading can", () => {
    // The whole point of grouping: one flat table had nowhere to say "this
    // product expects three machines and two of them are graded", so the
    // person filling it in had to read every row and count.
    const groups = qcGroups(po([line(3), line(1, { skuId: "sku-pro" })]), [
      unit({ serial: "S1", description: "Mulus" }),
      unit({ serial: "S2" }),
    ]);

    expect(groups).toHaveLength(2);
    const air = groups[0]!;
    expect(air.skuId).toBe("sku-air");
    expect(air.quota).toBe(3);
    expect(air.identified).toBe(2);
    expect(air.waiting).toBe(1);
    // S2 has a serial and nothing else: it cannot be accepted yet.
    expect(air.needDescription).toBe(1);
    expect(air.settled).toBe(0);
    expect(air.rows).toHaveLength(3);
  });

  it("counts a machine that has left QC as settled, not outstanding", () => {
    const groups = qcGroups(po([line(2)]), [
      unit({ serial: "S1", status: "TERSEDIA", description: "Mulus" }),
      unit({ serial: "S2", status: "RETUR_SUPPLIER" }),
    ]);
    const g = groups[0]!;
    expect(g.settled).toBe(2);
    // A returned machine is finished with, not a machine missing a
    // description — the gate only applies while it is still on the bench.
    expect(g.needDescription).toBe(0);
    expect(g.waiting).toBe(0);
    expect(g.quota).toBe(2);
  });

  it("still gives a heading to a product whose line has gone", () => {
    // Its machines are over quota rather than deleted, and a group with no
    // heading is a group whose rows have nowhere to appear.
    const groups = qcGroups(po([]), [unit({ serial: "S1" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.quota).toBe(0);
    expect(groups[0]!.overQuota).toBe(1);
    expect(groups[0]!.identified).toBe(1);
  });
});
