/**
 * An invoice's expenses, spread over its machines — owner ask 2026-09-15:
 * *"Shipping fee and tax fee should be divided across all units evenly for the
 * COGS and margin calculation."* Since 2026-09-18 only the expenses marked to
 * join the machines' cost are spread (`PoFee.inCogs`).
 *
 * The split is defined on the invoice's ROWS (each line expanded by its
 * quantity), and a serial only decides which row a unit stands in. See
 * `lib/landedCost.ts` for the three rules these pin down.
 */
import { describe, expect, it } from "vitest";
import {
  invoiceCharges,
  invoiceRows,
  machinesOnInvoice,
  poRowShares,
  shippingTaxShareOf,
  shippingTaxShares,
  type LandedCostSources,
} from "../src/lib/landedCost.js";
import type { Po, PoFee, PoItem, Unit, UnitEvent } from "../src/mock/seed.js";

const line = (id: string, over: Partial<PoItem> = {}): PoItem => ({
  id,
  skuId: "sku-air",
  serial: null,
  qty: 1,
  unitCost: 8_000_000,
  ...over,
});

/**
 * An invoice. `shippingFee` and `taxFee` are shorthand for the two expenses
 * every invoice had before expenses were a list — both in COGS.
 */
const invoice = ({
  shippingFee = 0,
  taxFee = 0,
  ...over
}: Partial<Po> & { shippingFee?: number; taxFee?: number } = {}): Po => ({
  id: "po-1",
  code: "PI-001",
  supplierId: "sup-1",
  invoice: "INV-1",
  date: "2026-09-01",
  locationId: "wh-1",
  items: [line("r1")],
  payments: [],
  fees: [
    ...(shippingFee > 0 ? [expense("f-ship", "SHIPPING", shippingFee)] : []),
    ...(taxFee > 0 ? [expense("f-tax", "TAX", taxFee)] : []),
  ],
  discount: 0,
  status: "RECEIVED",
  ...over,
});

function expense(
  id: string,
  kind: PoFee["kind"],
  amount: number,
  inCogs = true,
): PoFee {
  return { id, kind, label: "", amount, inCogs };
}

const unit = (serial: string, over: Partial<Unit> = {}): Unit => ({
  serial,
  skuId: "sku-air",
  status: "QC",
  locationId: "wh-1",
  buy: 8_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

/** A unit's intake, `hour` o'clock on one day — the order units claim rows in. */
const intake = (serial: string, hour: number): UnitEvent => ({
  id: `ev-${serial}`,
  serial,
  seq: 1,
  type: "DITERIMA",
  at: `2026-09-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
  fromStatus: "-",
  toStatus: "QC",
  locationId: "wh-1",
  staff: "Michella",
});

const store = (over: Partial<LandedCostSources>): LandedCostSources => ({
  pos: [],
  units: [],
  events: [],
  ...over,
});

const total = (shares: ReadonlyMap<string, number>) =>
  [...shares.values()].reduce((n, x) => n + x, 0);

describe("invoiceCharges", () => {
  it("is shipping plus tax, and not what the supplier knocked off", () => {
    // The discount was negotiated off the goods. The forwarder and the tax
    // office were paid in full, so their line says what they were paid.
    expect(
      invoiceCharges(
        invoice({ shippingFee: 300_000, taxFee: 100_000, discount: 250_000 }),
      ),
    ).toBe(400_000);
  });

  it("leaves out an expense kept out of the machines' cost", () => {
    // Owner ask 2026-09-18: "we should be able to add if we want to divide it
    // to COGS per unit or not".
    expect(
      invoiceCharges(
        invoice({
          fees: [
            expense("f1", "SHIPPING", 300_000),
            expense("f2", "CUSTOMS", 120_000),
            expense("f3", "OTHER", 80_000, false),
          ],
        }),
      ),
    ).toBe(420_000);
  });

  it("moves every machine's share when an expense changes sides", () => {
    const withCrate = (inCogs: boolean) =>
      invoice({
        items: [line("r1"), line("r2")],
        fees: [
          expense("f1", "SHIPPING", 100_000),
          expense("f2", "OTHER", 60_000, inCogs),
        ],
      });
    expect([...poRowShares(withCrate(true)).values()]).toEqual([
      80_000, 80_000,
    ]);
    expect([...poRowShares(withCrate(false)).values()]).toEqual([
      50_000, 50_000,
    ]);
  });
});

describe("poRowShares — before any serial exists", () => {
  it("gives every row an even share, whatever its machine cost", () => {
    // A courier charges by the box. Rp100.001 over three rows is 33.333,67:
    // in whole rupiah the first two rows carry the leftover, and nothing is
    // lost.
    const po = invoice({
      shippingFee: 100_000,
      taxFee: 1,
      items: [
        line("r1", { unitCost: 4_000_000 }),
        line("r2", { unitCost: 20_000_000 }),
        line("r3", { unitCost: 9_000_000 }),
      ],
    });
    expect([...poRowShares(po)]).toEqual([
      ["r1#0", 33_334],
      ["r2#0", 33_334],
      ["r3#0", 33_333],
    ]);
  });

  it("expands a line by its quantity and leaves out a line that never arrived", () => {
    const po = invoice({
      shippingFee: 300_000,
      items: [
        line("l1", { qty: 2 }),
        line("l2", { qty: 3, notReceived: true }),
        line("l3"),
      ],
    });
    expect(invoiceRows(po).map((r) => r.key)).toEqual(["l1#0", "l1#1", "l3#0"]);
    expect([...poRowShares(po).values()]).toEqual([100_000, 100_000, 100_000]);
  });

  it("counts a quantity-tracked accessory's boxes, though no unit carries them", () => {
    // Five sleeves shared the parcel with the Air, so six positions share it.
    const po = invoice({
      shippingFee: 600_000,
      items: [
        line("sleeves", { skuId: "sku-sleeve", qty: 5, unitCost: 150_000 }),
        line("r1", { serial: "SAIR00000001" }),
      ],
    });
    expect(poRowShares(po).size).toBe(6);
    expect(
      shippingTaxShares(
        store({ pos: [po], units: [unit("SAIR00000001")] }),
      ).get("SAIR00000001"),
    ).toBe(100_000);
  });
});

describe("which row a machine stands in", () => {
  it("takes the row that carries its serial, whenever it arrived", () => {
    // Received A, B, C — which is also serial order — and standing in rows
    // 3, 2, 1. Only the row decides.
    const po = invoice({
      shippingFee: 100_000,
      taxFee: 1,
      items: [
        line("r1", { serial: "SCCC0000001" }),
        line("r2", { serial: "SBBB0000001" }),
        line("r3", { serial: "SAAA0000001" }),
      ],
    });
    const units = [
      unit("SAAA0000001"),
      unit("SBBB0000001"),
      unit("SCCC0000001"),
    ];
    const shares = shippingTaxShares(
      store({
        pos: [po],
        units,
        events: [
          intake("SAAA0000001", 3),
          intake("SBBB0000001", 4),
          intake("SCCC0000001", 5),
        ],
      }),
    );
    const rows = poRowShares(po, units);
    expect(shares.get("SCCC0000001")).toBe(rows.get("r1#0"));
    expect(shares.get("SAAA0000001")).toBe(rows.get("r3#0"));
    expect(shares.get("SAAA0000001")).toBe(33_333);
  });

  it("takes the next free piece of its own product when no row names it", () => {
    // Rp100.000 over three is 33.334 + 33.333 + 33.333. The Pro arrived first
    // and still takes the Pro's row; of the two Airs, the one received first
    // takes the Air line's first piece, though its serial sorts second.
    const po = invoice({
      shippingFee: 100_000,
      items: [line("airs", { qty: 2 }), line("pro", { skuId: "sku-pro" })],
    });
    const shares = shippingTaxShares(
      store({
        pos: [po],
        units: [
          unit("SAAA0000001"),
          unit("SBBB0000001"),
          unit("SPRO0000001", { skuId: "sku-pro" }),
        ],
        events: [
          intake("SPRO0000001", 3),
          intake("SBBB0000001", 4),
          intake("SAAA0000001", 5),
        ],
      }),
    );
    expect(shares.get("SBBB0000001")).toBe(33_334);
    expect(shares.get("SAAA0000001")).toBe(33_333);
    expect(shares.get("SPRO0000001")).toBe(33_333);
  });

  it("never takes a row that names another machine", () => {
    const po = invoice({
      shippingFee: 100_001,
      items: [line("r1", { serial: "SXXX0000001" }), line("r2")],
    });
    // r1 carries the leftover rupiah; an unnamed Air stands in r2.
    expect(
      shippingTaxShares(store({ pos: [po], units: [unit("SYYY0000001")] })).get(
        "SYYY0000001",
      ),
    ).toBe(50_000);
    expect(poRowShares(po).get("r1#0")).toBe(50_001);
  });

  it("puts machines beyond every row after the last one, in intake order", () => {
    // Two rows, four Airs: four positions. Rp100.003 leaves three leftover
    // rupiah for positions 1–3, so the third machine received carries one and
    // the fourth does not, whatever their serials say.
    const po = invoice({
      shippingFee: 100_003,
      items: [line("airs", { qty: 2 })],
    });
    const units = [
      unit("SAAA0000001"),
      unit("SBBB0000001"),
      unit("SZZZ0000001"),
      unit("SCCC0000001"),
    ];
    const shares = shippingTaxShares(
      store({
        pos: [po],
        units,
        events: [
          intake("SAAA0000001", 3),
          intake("SBBB0000001", 4),
          intake("SZZZ0000001", 5),
          intake("SCCC0000001", 6),
        ],
      }),
    );
    expect(shares.get("SZZZ0000001")).toBe(25_001);
    expect(shares.get("SCCC0000001")).toBe(25_000);
    expect(total(shares)).toBe(100_003);
    // And the rows are quoted the thinner share the extra machines make.
    expect(machinesOnInvoice(po, units)).toBe(4);
    expect([...poRowShares(po, units).values()]).toEqual([25_001, 25_001]);
  });

  it("gives a machine whose product has no row a position of its own", () => {
    // The rows are Airs and the machine is a Pro. It does not take an Air's
    // row, and the rows share with it rather than quoting a share the unit
    // cannot also be quoted.
    const po = invoice({
      shippingFee: 300_000,
      items: [line("airs", { qty: 2 })],
    });
    const units = [unit("SPRO0000001", { skuId: "sku-pro" })];
    expect(machinesOnInvoice(po, units)).toBe(3);
    expect(
      shippingTaxShares(store({ pos: [po], units })).get("SPRO0000001"),
    ).toBe(100_000);
    expect([...poRowShares(po, units).values()]).toEqual([100_000, 100_000]);
  });
});

describe("entering a serial later", () => {
  it("changes nobody's share on a row-per-machine invoice", () => {
    const rows = [line("r1"), line("r2"), line("r3")];
    const po = invoice({ shippingFee: 100_000, taxFee: 1, items: rows });
    const quoted = poRowShares(po);

    // r2 is identified as SBBB…, then r3 as SAAA…, which sorts first.
    const named = invoice({
      shippingFee: 100_000,
      taxFee: 1,
      items: [
        rows[0]!,
        { ...rows[1]!, serial: "SBBB0000001" },
        { ...rows[2]!, serial: "SAAA0000001" },
      ],
    });
    const units = [unit("SBBB0000001"), unit("SAAA0000001")];
    const shares = shippingTaxShares(
      store({
        pos: [named],
        units,
        events: [intake("SBBB0000001", 3), intake("SAAA0000001", 4)],
      }),
    );
    expect(poRowShares(named, units)).toEqual(quoted);
    expect(shares.get("SBBB0000001")).toBe(quoted.get("r2#0"));
    expect(shares.get("SAAA0000001")).toBe(quoted.get("r3#0"));
  });

  it("changes nobody's share as the machines of a quantity line are registered", () => {
    // Rp100.000 over three pieces is 33.334 + 33.333 + 33.333.
    const po = invoice({
      shippingFee: 100_000,
      items: [line("airs", { qty: 3 })],
    });
    const first = [unit("SBBB0000001"), unit("SCCC0000001")];
    const firstIn = [intake("SBBB0000001", 3), intake("SCCC0000001", 4)];
    const before = shippingTaxShares(
      store({ pos: [po], units: first, events: firstIn }),
    );
    expect(before.get("SBBB0000001")).toBe(33_334);
    // The third piece's share is on the invoice and not yet on a machine.
    expect(total(before)).toBe(66_667);

    // A serial that sorts FIRST and arrived LAST takes the last piece.
    const after = shippingTaxShares(
      store({
        pos: [po],
        units: [...first, unit("SAAA0000001")],
        events: [...firstIn, intake("SAAA0000001", 5)],
      }),
    );
    expect(after.get("SBBB0000001")).toBe(33_334);
    expect(after.get("SCCC0000001")).toBe(33_333);
    expect(after.get("SAAA0000001")).toBe(33_333);
    expect(total(after)).toBe(100_000);
  });
});

describe("a machine with no invoice", () => {
  it("carries nothing", () => {
    // A trade-in or a stock-take find: no forwarder, no tax office. And an
    // invoice the store does not hold has nothing to spread.
    const s = store({
      pos: [invoice({ shippingFee: 300_000 })],
      units: [
        unit("STRADEIN0001", { poId: null }),
        unit("SGONE0000001", { poId: "po-missing" }),
      ],
    });
    expect(shippingTaxShares(s).size).toBe(0);
    expect(shippingTaxShareOf({ serial: "STRADEIN0001", poId: null }, s)).toBe(
      0,
    );
    expect(
      shippingTaxShareOf({ serial: "SGONE0000001", poId: "po-missing" }, s),
    ).toBe(0);
  });
});

describe("shippingTaxShareOf", () => {
  it("answers one machine exactly as the whole-store pass does", () => {
    const s = store({
      pos: [
        invoice({
          shippingFee: 100_000,
          taxFee: 1,
          items: [
            line("airs", { qty: 2 }),
            line("r3", { serial: "SCCC0000001" }),
          ],
        }),
        invoice({ id: "po-2", shippingFee: 50_000, items: [line("r1")] }),
      ],
      units: [
        unit("SAAA0000001"),
        unit("SBBB0000001"),
        unit("SCCC0000001"),
        unit("SDDD0000001", { poId: "po-2" }),
        unit("STRADEIN0001", { poId: null }),
      ],
      events: [intake("SBBB0000001", 3), intake("SAAA0000001", 4)],
    });
    const all = shippingTaxShares(s);
    for (const u of s.units) {
      expect(shippingTaxShareOf(u, s)).toBe(all.get(u.serial) ?? 0);
    }
    expect(all.get("SDDD0000001")).toBe(50_000);
  });
});
