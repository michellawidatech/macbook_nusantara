/** The six Inbound tabs' membership (spec 2026-11-04 §3). */
import { describe, expect, it } from "vitest";
import { inboundTabs } from "../src/lib/inboundTabs.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const NOW = Date.parse("2026-11-04T05:00:00.000Z");
const fresh = (): MockDb => structuredClone(getDb());
const lastSeq = (d: MockDb, serial: string) =>
  Math.max(0, ...d.events.filter((e) => e.serial === serial).map((e) => e.seq));

describe("inboundTabs", () => {
  it("puts an invoice with an unready unit in QC on Needs QC, and a ready one on Ready", () => {
    const d = fresh();
    const qc = d.units.filter((u) => u.status === "QC" && u.poId);
    expect(qc.length).toBeGreaterThan(1);
    const [notReady, ready] = qc as [(typeof qc)[number], (typeof qc)[number]];
    notReady.grade = "A";
    notReady.description = "";
    ready.grade = "A";
    ready.description = "Mulus";
    const tabs = inboundTabs(d, NOW);
    expect(tabs.NEEDS_QC).toContain(notReady.poId);
    expect(tabs.READY.map((r) => r.serial)).toContain(ready.serial);
    expect(tabs.READY.map((r) => r.serial)).not.toContain(notReady.serial);
  });

  it("lists a unit back from service on its own tab, with the visit's note and charges", () => {
    const d = fresh();
    const u = d.units.find((x) => x.status === "QC" && x.poId)!;
    u.grade = "A";
    u.description = "Mulus";
    const at = "2026-11-03T03:00:00.000Z";
    d.services.push({
      id: "v-back",
      serial: u.serial,
      fromLocationId: u.locationId,
      openedAt: "2026-11-01T03:00:00.000Z",
      closedAt: at,
      toLocationId: u.locationId,
      fees: [{ id: "f1", kind: "LABOUR", amount: 250_000, at, staff: "x" }],
      note: "Ganti keyboard",
      raisedBy: "QC",
      staff: "x",
    });
    d.events.push({
      serial: u.serial,
      seq: lastSeq(d, u.serial) + 1,
      type: "DICATAT",
      at,
      toStatus: "QC",
    } as never);
    const tabs = inboundTabs(d, NOW);
    const row = tabs.BACK_FROM_SERVICE.find((r) => r.serial === u.serial)!;
    expect(row.visit).toMatchObject({
      id: "v-back",
      note: "Ganti keyboard",
      charges: 250_000,
    });
    // …and nowhere else, though it is complete.
    expect(tabs.READY.map((r) => r.serial)).not.toContain(u.serial);
  });

  it("counts every unit in QC in exactly one tab", () => {
    const d = fresh();
    const tabs = inboundTabs(d, NOW);
    const back = new Set(tabs.BACK_FROM_SERVICE.map((r) => r.serial));
    const ready = new Set(tabs.READY.map((r) => r.serial));
    // A unit on no invoice is OrphanQcCard's, unless it came back from service.
    for (const u of d.units.filter(
      (x) => x.status === "QC" && (x.poId || back.has(x.serial)),
    )) {
      const inNeeds =
        u.poId !== null &&
        u.poId !== undefined &&
        tabs.NEEDS_QC.includes(u.poId) &&
        !ready.has(u.serial) &&
        !back.has(u.serial);
      const homes = [back.has(u.serial), ready.has(u.serial), inNeeds].filter(
        Boolean,
      ).length;
      expect({ serial: u.serial, homes }).toEqual({
        serial: u.serial,
        homes: 1,
      });
    }
  });

  it("files a paid, accepted invoice under All only, and a closed one under Closed", () => {
    const d = fresh();
    const po = d.pos.find((p) => p.status === "RECEIVED")!;
    for (const u of d.units.filter((x) => x.poId === po.id))
      u.status = "TERSEDIA";
    po.items = po.items.map((i) => ({ ...i, serial: i.serial ?? "X" }));
    const total =
      po.items.reduce((n, i) => n + i.qty * i.unitCost, 0) +
      po.fees.reduce((n, f) => n + f.amount, 0) -
      po.discount;
    po.payments = [
      { id: "pp", method: "TUNAI", amount: total, at: "2026-11-01" } as never,
    ];
    let tabs = inboundTabs(d, NOW);
    expect(tabs.ALL).toContain(po.id);
    expect(tabs.NEEDS_QC).not.toContain(po.id);
    expect(tabs.UNPAID).not.toContain(po.id);
    po.closedAt = "2026-11-02T00:00:00.000Z";
    tabs = inboundTabs(d, NOW);
    expect(tabs.CLOSED).toContain(po.id);
  });

  it("lists an arrived invoice that still owes money under Arrived, not paid", () => {
    const d = fresh();
    const po = d.pos.find((p) => p.status === "RECEIVED")!;
    po.payments = [];
    delete po.closedAt;
    expect(inboundTabs(d, NOW).UNPAID).toContain(po.id);
  });
});

describe("the Add photo tab", () => {
  it("lists every unit the shop holds with a serial and no photo, and drops it once it has one", () => {
    const d = fresh();
    const held = d.units.find((u) => u.status === "TERSEDIA")!;
    d.unitNotes = d.unitNotes.filter((n) => n.serial !== held.serial);
    const sold = d.units.find((u) => u.status === "TERJUAL")!;
    let tabs = inboundTabs(d, NOW);
    expect(tabs.NO_PHOTO.map((r) => r.serial)).toContain(held.serial);
    expect(tabs.NO_PHOTO.map((r) => r.serial)).not.toContain(sold.serial);
    d.unitNotes.push({
      id: "n-photo",
      serial: held.serial,
      tag: "QC",
      text: "",
      at: "2026-11-04T00:00:00.000Z",
      staff: "x",
      photos: [{ id: "p1", url: "/x.jpg", sortOrder: 0 }],
    } as never);
    tabs = inboundTabs(d, NOW);
    expect(tabs.NO_PHOTO.map((r) => r.serial)).not.toContain(held.serial);
  });
});
