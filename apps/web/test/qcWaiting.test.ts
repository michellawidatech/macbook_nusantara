/**
 * Waiting for QC (owner ask 2026-10-26): every unit the bench still has to
 * grade, across every invoice — so a unit on the shelf finds its invoice, and
 * an invoice finds its units, without opening each one.
 */
import { describe, expect, it } from "vitest";
import {
  qcWaitingByPo,
  qcWaitingCount,
  qcWaitingRows,
  type QcWaitingStore,
} from "../src/lib/qcWaiting.js";
import type { Po, PoItem, Unit, UnitEvent } from "../src/mock/seed.js";

const AIR = "sku-air";
const CABLE = "sku-cable";

/** 26 October 2026, mid-morning, local time. */
const NOW = new Date(2026, 9, 26, 10, 0, 0).getTime();

const unit = (over: Partial<Unit> & Pick<Unit, "serial">): Unit => ({
  skuId: AIR,
  status: "QC",
  locationId: "wh-1",
  buy: 10_000_000,
  description: "",
  poId: "po-1",
  ...over,
});

const piece = (id: string, over: Partial<PoItem> = {}): PoItem => ({
  id,
  skuId: AIR,
  serial: null,
  qty: 1,
  unitCost: 10_000_000,
  ...over,
});

const po = (over: Partial<Po> & Pick<Po, "id" | "code">): Po => ({
  supplierId: "sup-1",
  invoice: "INV-77",
  date: "2026-10-20",
  locationId: "wh-1",
  items: [],
  payments: [],
  fees: [],
  discount: 0,
  status: "RECEIVED",
  ...over,
});

const event = (
  serial: string,
  type: string,
  at: string,
  toStatus = "QC",
): UnitEvent => ({
  id: `${serial}-${type}-${at}`,
  serial,
  seq: 0,
  type,
  at,
  fromStatus: "",
  toStatus,
  locationId: "wh-1",
  staff: "Ersen",
});

function store(over: Partial<QcWaitingStore> = {}): QcWaitingStore {
  return {
    units: [],
    pos: [],
    events: [],
    skus: [
      {
        id: AIR,
        modelId: "m-air",
        code: 'AIR 13" M2 8/256',
        name: 'MacBook Air 13" M2',
        variantLabel: "8GB / 256GB",
      },
      {
        id: CABLE,
        modelId: "m-cable",
        code: "USB-C 2M",
        name: "USB-C cable",
        variantLabel: "2m",
      },
    ],
    models: [
      { id: "m-air", category: "MacBook Air" },
      { id: "m-cable", category: "Accessories" },
    ],
    categories: [
      { name: "MacBook Air", tracksSerial: true },
      { name: "Accessories", tracksSerial: false },
    ],
    suppliers: [{ id: "sup-1", name: "Apel Segar" }],
    ...over,
  };
}

describe("qcWaitingRows", () => {
  it("lists a unit in QC with its product, invoice, supplier and arrival", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-1",
            code: "PI-2026/10-000001",
            items: [piece("l1", { serial: "C02AAA" })],
          }),
        ],
        units: [unit({ serial: "C02AAA" })],
        events: [event("C02AAA", "DITERIMA", "2026-10-22T03:00:00.000Z")],
      }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "UNIT",
      serial: "C02AAA",
      skuId: AIR,
      product: 'MacBook Air 13" M2',
      variant: "8GB / 256GB",
      skuCode: 'AIR 13" M2 8/256',
      poId: "po-1",
      poCode: "PI-2026/10-000001",
      invoice: "INV-77",
      supplier: "Apel Segar",
      arrivedAt: "2026-10-22T03:00:00.000Z",
      days: 4,
    });
  });

  it("lists an invoice slot nobody has scanned, dated by the invoice", () => {
    const rows = qcWaitingRows(
      store({
        pos: [po({ id: "po-1", code: "PI-1", items: [piece("l1")] })],
      }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "SLOT",
      serial: null,
      product: 'MacBook Air 13" M2',
      poCode: "PI-1",
      arrivedAt: "2026-10-20",
      days: 6,
    });
  });

  it("leaves out what is not waiting on the bench", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-1",
            code: "PI-1",
            items: [
              // Graded and on the shelf.
              piece("l1", { serial: "SHELF1" }),
              // Billed and never sent.
              piece("l2", { notReceived: true }),
              // A counted product: a quantity, never a unit.
              piece("l3", { skuId: CABLE, qty: 5, unitCost: 50_000 }),
              // Nobody has said what it is yet.
              piece("l4", { skuId: "" }),
            ],
          }),
          // Boxes not here yet: nothing to grade.
          po({
            id: "po-2",
            code: "PI-2",
            status: "ORDERED",
            items: [piece("l5")],
          }),
          po({
            id: "po-3",
            code: "PI-3",
            status: "DRAFT",
            items: [piece("l6")],
          }),
        ],
        units: [
          unit({ serial: "SHELF1", status: "TERSEDIA" }),
          // In QC with no invoice — OrphanQcCard's, not this list's.
          unit({ serial: "FOUND1", poId: null }),
        ],
      }),
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("counts from the last time a unit went back into QC", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-1",
            code: "PI-1",
            items: [piece("l1", { serial: "C02BBB" })],
          }),
        ],
        units: [unit({ serial: "C02BBB" })],
        events: [
          event("C02BBB", "DITERIMA", "2026-10-01T03:00:00.000Z"),
          event("C02BBB", "QC_SELESAI", "2026-10-02T03:00:00.000Z", "TERSEDIA"),
          event("C02BBB", "QC_DIBUKA", "2026-10-25T03:00:00.000Z"),
        ],
      }),
      NOW,
    );
    expect(rows[0]).toMatchObject({
      arrivedAt: "2026-10-01T03:00:00.000Z",
      days: 1,
    });
  });

  it("says when an invoice has no supplier number", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-1",
            code: "PI-1",
            noInvoice: true,
            items: [piece("l1")],
          }),
        ],
      }),
      NOW,
    );
    expect(rows[0]!.invoice).toBeNull();
  });

  it("puts the longest wait first", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-new",
            code: "PI-NEW",
            date: "2026-10-25",
            items: [piece("n1")],
          }),
          po({
            id: "po-old",
            code: "PI-OLD",
            date: "2026-10-01",
            items: [piece("o1")],
          }),
        ],
      }),
      NOW,
    );
    expect(rows.map((r) => r.poCode)).toEqual(["PI-OLD", "PI-NEW"]);
    expect(rows.map((r) => r.days)).toEqual([25, 1]);
  });

  it("never reports a negative wait", () => {
    const rows = qcWaitingRows(
      store({
        pos: [
          po({
            id: "po-1",
            code: "PI-1",
            date: "2026-10-30",
            items: [piece("l1")],
          }),
        ],
      }),
      NOW,
    );
    expect(rows[0]!.days).toBe(0);
  });
});

describe("qcWaitingByPo / qcWaitingCount", () => {
  it("counts units and slots per invoice, and in all", () => {
    const s = store({
      pos: [
        po({
          id: "po-1",
          code: "PI-1",
          items: [piece("a", { serial: "C02CCC" }), piece("b")],
        }),
        po({ id: "po-2", code: "PI-2", items: [piece("c")] }),
        po({ id: "po-3", code: "PI-3", items: [] }),
      ],
      units: [unit({ serial: "C02CCC" })],
    });
    const byPo = qcWaitingByPo(qcWaitingRows(s, NOW));
    expect(byPo.get("po-1")).toBe(2);
    expect(byPo.get("po-2")).toBe(1);
    expect(byPo.get("po-3")).toBeUndefined();
    expect(qcWaitingCount(s)).toBe(3);
  });
});
