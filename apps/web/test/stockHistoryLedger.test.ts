/**
 * Stock Movement History recaps every movement, not only adjustments (owner
 * report 2026-11-04: "the service from 1 warehouse to another is not
 * recorded, it only recorded the transfer stock").
 */
import { describe, expect, it } from "vitest";
import { ledgerMovementRows } from "../src/lib/stockHistory.js";
import type { MockDb, UnitEvent } from "../src/mock/seed.js";

const ev = (over: Partial<UnitEvent>): UnitEvent => ({
  id: `e${Math.random()}`,
  serial: "S1",
  seq: 1,
  type: "DICATAT",
  at: "2026-11-01T03:00:00.000Z",
  fromStatus: "TERSEDIA",
  toStatus: "TERSEDIA",
  locationId: "wh-1",
  staff: "Dina",
  ...over,
});

const store = (events: UnitEvent[], extra: Partial<MockDb> = {}) =>
  ({ events, adjustments: [], stockMoves: [], ...extra }) as unknown as MockDb;

describe("ledgerMovementRows", () => {
  it("lists a service trip out and back with the warehouses", () => {
    const rows = ledgerMovementRows(
      store([
        ev({
          seq: 1,
          type: "DITERIMA",
          fromStatus: "-",
          toStatus: "QC",
          at: "2026-11-01T01:00:00.000Z",
        }),
        ev({
          seq: 2,
          type: "QC_SELESAI",
          fromStatus: "QC",
          toStatus: "TERSEDIA",
          at: "2026-11-01T02:00:00.000Z",
        }),
        ev({
          seq: 3,
          toStatus: "SERVIS",
          locationId: "wh-3",
          at: "2026-11-02T00:00:00.000Z",
          note: "Sent to service",
        }),
        ev({
          seq: 4,
          fromStatus: "SERVIS",
          toStatus: "QC",
          locationId: "wh-1",
          at: "2026-11-03T00:00:00.000Z",
        }),
      ]),
    );
    expect(
      rows.map((r) => [r.movement, r.kind, r.fromLocationId, r.toLocationId]),
    ).toEqual([
      ["RECEIVED", "IN", undefined, "wh-1"],
      ["TO_SERVICE", "OUT", "wh-1", "wh-3"],
      ["FROM_SERVICE", "IN", "wh-3", "wh-1"],
    ]);
  });

  it("lists a sale and a customer return, and leaves QC accepted out", () => {
    const rows = ledgerMovementRows(
      store([
        ev({
          seq: 1,
          type: "QC_SELESAI",
          fromStatus: "QC",
          toStatus: "TERSEDIA",
        }),
        ev({
          seq: 2,
          type: "TERJUAL",
          toStatus: "TERJUAL",
          at: "2026-11-02T00:00:00.000Z",
        }),
        ev({
          seq: 3,
          type: "RETUR_PELANGGAN",
          fromStatus: "TERJUAL",
          toStatus: "TERSEDIA",
          at: "2026-11-03T00:00:00.000Z",
        }),
      ]),
    );
    expect(rows.map((r) => r.movement)).toEqual(["SOLD", "CUSTOMER_RETURN"]);
  });

  it("does not repeat a move a stock adjustment already lists", () => {
    const at = "2026-11-02T00:00:00.000Z";
    const rows = ledgerMovementRows(
      store(
        [
          ev({ seq: 1 }),
          ev({ seq: 2, type: "KOREKSI", locationId: "wh-2", at }),
        ],
        {
          adjustments: [
            {
              id: "a1",
              serial: "S1",
              at,
              kind: "OUT",
              reasonId: "r",
              description: "",
              staff: "x",
              batchId: "b",
            },
          ],
        } as never,
      ),
    );
    expect(rows).toEqual([]);
  });

  it("lists a counted product's arrival and sale", () => {
    const rows = ledgerMovementRows(
      store([], {
        stockMoves: [
          {
            id: "m1",
            skuId: "k",
            locationId: "wh-1",
            qty: 5,
            cost: 1,
            type: "MASUK",
            at: "2026-11-01T00:00:00.000Z",
            staff: "x",
          },
          {
            id: "m2",
            skuId: "k",
            locationId: "wh-1",
            qty: -1,
            cost: 1,
            type: "TERJUAL",
            at: "2026-11-02T00:00:00.000Z",
            staff: "x",
          },
        ],
      } as never),
    );
    expect(rows.map((r) => [r.movement, r.kind, r.counted?.qty])).toEqual([
      ["RECEIVED", "IN", 5],
      ["SOLD", "OUT", 1],
    ]);
  });
});

describe("one word for one movement (owner, 2026-11-04)", () => {
  it("names an accessory put back by a sale's correction as a sale correction", () => {
    const rows = ledgerMovementRows(
      store([], {
        stockMoves: [
          {
            id: "m3",
            skuId: "k",
            locationId: "wh-1",
            qty: 1,
            cost: 1,
            type: "KOREKSI",
            orderId: "o-1",
            at: "2026-11-02T00:00:00.000Z",
            staff: "x",
          },
          {
            id: "m4",
            skuId: "k",
            locationId: "wh-1",
            qty: 1,
            cost: 1,
            type: "KOREKSI",
            at: "2026-11-02T00:00:00.000Z",
            staff: "x",
          },
        ],
      } as never),
    );
    expect(rows.map((r) => r.movement)).toEqual([
      "SALE_CORRECTED",
      "CORRECTION",
    ]);
  });
});
