import { describe, expect, it } from "vitest";
import {
  serviceBatches,
  serviceLocationOf,
} from "../src/lib/serviceBatches.js";
import type { BenchRow, ServiceRec } from "../src/lib/service.js";

const rec = (
  serial: string,
  openedAt: string,
  from: string,
  extra: Partial<ServiceRec> = {},
): ServiceRec => ({
  id: `svc-${serial}`,
  serial,
  fromLocationId: from,
  openedAt,
  arrivedAt: openedAt,
  fees: [],
  raisedBy: "ADJUSTMENT",
  staff: "Dina",
  ...extra,
});
const row = (r: ServiceRec, cost = 0): BenchRow => ({
  rec: r,
  serial: r.serial,
  cost,
  buy: 0,
  shippingTax: 0,
  earlierRepair: 0,
  total: 0,
  days: 0,
  arrived: true,
  closed: r.closedAt !== undefined,
});
const sent = (serial: string, at: string, to: string) => ({
  serial,
  at,
  toStatus: "SERVIS",
  locationId: to,
});

describe("serviceLocationOf", () => {
  it("reads the send event, then the unit while open, then where it came from", () => {
    const a = rec("A", "2026-11-10T03:00:00.000Z", "wh-01");
    expect(serviceLocationOf(a, [sent("A", a.openedAt, "wh-05")], [])).toBe(
      "wh-05",
    );
    expect(
      serviceLocationOf(a, [], [{ serial: "A", locationId: "wh-03" }]),
    ).toBe("wh-03");
    expect(
      serviceLocationOf(
        { ...a, closedAt: "2026-11-11T00:00:00.000Z" },
        [],
        [{ serial: "A", locationId: "wh-03" }],
      ),
    ).toBe("wh-01");
  });
});

describe("serviceBatches", () => {
  it("groups by the minute sent, where from and where to", () => {
    const t1 = "2026-11-10T03:00:10.000Z";
    const t2 = "2026-11-10T05:00:00.000Z";
    const rows = [
      row(rec("A", t1, "wh-01"), 100),
      row(rec("B", t1, "wh-01"), 50),
      row(rec("C", t1, "wh-02")),
      row(rec("D", t2, "wh-01")),
    ];
    const events = [
      sent("A", t1, "wh-05"),
      sent("B", t1, "wh-05"),
      sent("C", t1, "wh-05"),
      sent("D", t2, "wh-05"),
    ];
    const batches = serviceBatches(rows, { events, units: [] });
    expect(batches.map((b) => b.rows.map((r) => r.serial))).toEqual([
      ["A", "B"],
      ["C"],
      ["D"],
    ]);
    expect(batches[0]).toMatchObject({
      fromLocationId: "wh-01",
      toLocationId: "wh-05",
      openedAt: t1,
      cost: 150,
      closed: false,
    });
  });
});
