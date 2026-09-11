/**
 * A machine at a repairer: where it goes, what it costs, and how that cost
 * reaches the margin. Owner ask 2026-09-08 — see `lib/service.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  benchRows,
  costOfUnit,
  editFee,
  openVisit,
  serviceCostOf,
  serviceLocationOf,
  splitBench,
  visitCost,
  type ServiceRec,
} from "../src/lib/service.js";

const visit = (over: Partial<ServiceRec>): ServiceRec => ({
  id: "v1",
  serial: "SC02740137JKM",
  fromLocationId: "wh-1",
  openedAt: "2026-09-01T03:00:00.000Z",
  fees: [],
  raisedBy: "QC",
  staff: "Michella",
  ...over,
});

const fee = (amount: number, kind: ServiceRec["fees"][number]["kind"] = "LABOUR") => ({
  id: `f-${amount}`,
  kind,
  amount,
  at: "2026-09-02T03:00:00.000Z",
  staff: "Michella",
});

describe("visitCost", () => {
  it("adds every charge on the visit", () => {
    expect(
      visitCost(visit({ fees: [fee(500_000), fee(120_000, "PART")] })),
    ).toBe(620_000);
  });

  it("refuses a negative charge rather than netting it", () => {
    // Money coming back is a credit and is its own document — the same rule a
    // marketplace fee follows.
    expect(visitCost(visit({ fees: [fee(500_000), fee(-100_000)] }))).toBe(
      500_000,
    );
  });
});

describe("serviceCostOf", () => {
  const records = [
    visit({ id: "v1", fees: [fee(500_000)], closedAt: "2026-09-03" }),
    visit({ id: "v2", fees: [fee(300_000)] }),
    visit({ id: "v3", serial: "OTHER", fees: [fee(9_000_000)] }),
  ];

  it("counts every visit of one machine, closed and open", () => {
    // Open ones included: a machine on the bench with parts already billed has
    // cost the shop that money whether or not anybody pressed "finished".
    expect(serviceCostOf("SC02740137JKM", records)).toBe(800_000);
  });

  it("never counts another machine's repair", () => {
    expect(serviceCostOf("NOBODY", records)).toBe(0);
  });
});

describe("costOfUnit", () => {
  it("is what the shop paid plus what it has spent repairing", () => {
    // The number every margin is computed against since 2026-09-08. A machine
    // bought at Rp4jt and repaired for Rp800k is a Rp4.8jt machine, and
    // selling it at Rp4.5jt is a loss the till has to be able to show.
    const unit = { serial: "SC02740137JKM", buy: 4_000_000 };
    expect(costOfUnit(unit, [visit({ fees: [fee(800_000)] })])).toBe(
      4_800_000,
    );
  });

  it("leaves an unrepaired machine exactly as it was", () => {
    expect(costOfUnit({ serial: "X", buy: 4_000_000 }, [])).toBe(4_000_000);
  });
});

describe("openVisit", () => {
  it("finds the visit a machine is on right now", () => {
    const closed = visit({ id: "v1", closedAt: "2026-09-03" });
    const open = visit({ id: "v2" });
    expect(openVisit("SC02740137JKM", [closed, open])?.id).toBe("v2");
    expect(openVisit("SC02740137JKM", [closed])).toBeUndefined();
  });
});

describe("serviceLocationOf", () => {
  it("finds the bench by KIND, not by id", () => {
    // `wh-4` is this shop's service location and the next shop's will not be.
    expect(
      serviceLocationOf([
        { id: "wh-1", kind: "TOKO" },
        { id: "wh-9", kind: "SERVIS" },
      ]),
    ).toBe("wh-9");
  });

  it("answers undefined for a shop with no bench", () => {
    // The callers then leave the machine where it is, which is exactly what
    // happened before this feature existed.
    expect(serviceLocationOf([{ id: "wh-1", kind: "TOKO" }])).toBeUndefined();
  });
});

describe("benchRows", () => {
  const now = Date.parse("2026-09-08T03:00:00.000Z");

  it("shows open visits only, longest away first", () => {
    const rows = benchRows(
      [
        visit({ id: "v1", openedAt: "2026-09-06T03:00:00.000Z" }),
        visit({ id: "v2", serial: "B", openedAt: "2026-09-01T03:00:00.000Z" }),
        visit({ id: "v3", serial: "C", closedAt: "2026-09-07" }),
      ],
      () => 4_000_000,
      now,
    );
    expect(rows.map((r) => r.rec.id)).toEqual(["v2", "v1"]);
    expect(rows[0]!.days).toBe(7);
    expect(rows[1]!.days).toBe(2);
  });

  it("reports what each machine will have to sell above", () => {
    const rows = benchRows(
      [visit({ fees: [fee(800_000)] })],
      () => 4_000_000,
      now,
    );
    expect(rows[0]).toMatchObject({
      buy: 4_000_000,
      cost: 800_000,
      total: 4_800_000,
    });
  });

  it("never reports a negative age", () => {
    // A clock skew must not say a machine has been away for minus a day.
    const rows = benchRows(
      [visit({ openedAt: "2026-09-20T03:00:00.000Z" })],
      () => 0,
      now,
    );
    expect(rows[0]!.days).toBe(0);
  });
});

/**
 * On the way, and there — owner ask 2026-09-09.
 *
 * The distinction the bench is opened to make every morning: which of the
 * machines that were sent has actually turned up. Before this, sending one put
 * it in warehouse 4 the instant somebody pressed a button, so the bench had a
 * list of machines it could not find.
 */
describe("splitBench", () => {
  it("keeps what has arrived apart from what is on its way", () => {
    const rows = benchRows(
      [
        visit({ id: "v1" }),
        visit({ id: "v2", serial: "B", arrivedAt: "2026-09-02T03:00:00.000Z" }),
      ],
      () => 0,
    );
    const { expected, onBench } = splitBench(rows);
    expect(expected.map((r) => r.rec.id)).toEqual(["v1"]);
    expect(onBench.map((r) => r.rec.id)).toEqual(["v2"]);
  });

  it("counts a visit that needed no journey as already there", () => {
    // A machine graded at the bench itself, or one a repairer collects: there
    // is nothing to sign for, so nothing should be waiting on a confirmation.
    const rows = benchRows(
      [visit({ arrivedAt: "2026-09-01T03:00:00.000Z" })],
      () => 0,
    );
    expect(splitBench(rows).expected).toHaveLength(0);
  });
});

/**
 * Correcting a charge — *"not only add but also reduce"* (owner, 2026-09-09).
 */
describe("editFee", () => {
  it("rewrites the charge it names and leaves the others alone", () => {
    const rec = visit({ fees: [fee(900_000), fee(120_000, "PART")] });
    const next = editFee(rec, "f-900000", { amount: 650_000 });
    expect(visitCost(next)).toBe(770_000);
    expect(next.fees[1]).toEqual(rec.fees[1]);
  });

  it("takes a kind and a label as well as an amount", () => {
    const rec = visit({ fees: [fee(500_000)] });
    const next = editFee(rec, "f-500000", {
      kind: "SHIPPING",
      label: "Ongkir balik",
    });
    expect(next.fees[0]).toMatchObject({
      kind: "SHIPPING",
      label: "Ongkir balik",
      // Untouched, because the patch did not name it.
      amount: 500_000,
    });
  });

  it("lets a charge be cancelled by taking it to zero", () => {
    // The way a charge is withdrawn, since nothing here is hard-deleted: the
    // row stays and says "quoted, and not paid".
    const rec = visit({ fees: [fee(900_000)] });
    expect(visitCost(editFee(rec, "f-900000", { amount: 0 }))).toBe(0);
  });

  it("refuses a negative charge rather than netting it off", () => {
    // Money coming back from a repairer is a credit and is its own document.
    const rec = visit({ fees: [fee(900_000)] });
    expect(editFee(rec, "f-900000", { amount: -50_000 }).fees[0]!.amount).toBe(0);
  });

  it("does nothing at all when the id is not on the visit", () => {
    const rec = visit({ fees: [fee(900_000)] });
    expect(editFee(rec, "nope", { amount: 1 }).fees).toEqual(rec.fees);
  });
});
