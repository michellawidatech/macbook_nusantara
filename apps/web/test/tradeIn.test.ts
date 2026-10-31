/**
 * `lib/tradeIn.ts` — every trade-in recorded the same way (owner 2026-10-31).
 */
import { describe, expect, it } from "vitest";
import {
  bookTradeIn,
  newTradeInPayment,
  tradeInSplit,
  withTradeInPaid,
} from "../src/lib/tradeIn.js";
import { applyReturnCredit } from "../src/lib/returns.js";
import { getDb } from "../src/mock/store.js";
import type { SalePayment } from "../src/lib/salePayments.js";

describe("tradeInSplit", () => {
  it("pays what it covers; the customer pays the rest", () => {
    expect(tradeInSplit({ billLeft: 12_500_000, credit: 2_000_000 })).toEqual({
      paid: 2_000_000,
      collect: 10_500_000,
      payout: 0,
    });
  });

  it("worth more: pays the bill and the shop pays the customer the rest", () => {
    // The owner's case: Pro 13" M1 12,5jt out, Pro 14" M5 27jt in.
    expect(tradeInSplit({ billLeft: 12_500_000, credit: 27_000_000 })).toEqual({
      paid: 12_500_000,
      collect: 0,
      payout: 14_500_000,
    });
  });

  it("counts a DP already paid", () => {
    // 12,5jt bill, 500rb DP: the trade-in meets 12jt and the shop hands back 15jt.
    expect(tradeInSplit({ billLeft: 12_000_000, credit: 27_000_000 })).toEqual({
      paid: 12_000_000,
      collect: 0,
      payout: 15_000_000,
    });
  });
});

describe("withTradeInPaid", () => {
  const cash: SalePayment = {
    id: "p1",
    method: "TUNAI",
    amount: 8_000_000,
    state: "SETTLED",
    at: "2030-01-01T00:00:00.000Z",
  };
  const make = () => newTradeInPayment("tt", "2030-01-01T00:00:00.000Z");

  it("adds one, moves it, and drops it at zero — the money untouched", () => {
    const once = withTradeInPaid([cash], 2_000_000, make);
    expect(once.map((p) => [p.method, p.amount, p.inBalance])).toEqual([
      ["TUKAR_TAMBAH", 2_000_000, false],
      ["TUNAI", 8_000_000, undefined],
    ]);
    expect(withTradeInPaid(once, 3_000_000, make)[0]!.amount).toBe(3_000_000);
    expect(withTradeInPaid(once, 0, make)).toEqual([cash]);
  });
});

describe("a return on a sale whose trade-in paid the bill", () => {
  it("hands the whole price back in money (owner answer 8a, 9)", () => {
    // 12,5jt sale paid entirely by the trade-in; the shop keeps the traded
    // unit, so returning the 12,5jt unit gives the customer 12,5jt.
    const money = applyReturnCredit({
      bill: 12_500_000,
      payments: [
        {
          ...newTradeInPayment("tt", "2030-01-01T00:00:00.000Z"),
          amount: 12_500_000,
        },
      ],
      credit: 12_500_000,
    });
    expect(money.refund).toBe(12_500_000);
    expect(money.debtCancelled).toBe(0);
  });

  it("less the restocking fee (owner answer 10)", () => {
    const money = applyReturnCredit({
      bill: 12_500_000,
      payments: [
        {
          ...newTradeInPayment("tt", "2030-01-01T00:00:00.000Z"),
          amount: 2_000_000,
        },
        {
          id: "cash",
          method: "TUNAI",
          amount: 10_500_000,
          state: "SETTLED",
          at: "2030-01-01T00:00:00.000Z",
        },
      ],
      credit: 12_500_000 - 300_000,
    });
    expect(money.refund).toBe(12_200_000);
  });
});

describe("bookTradeIn", () => {
  const ctx = (events: string[]) => ({
    code: "BP-2030/01-000001",
    at: "2030-01-01T00:00:00.000Z",
    staff: "Test",
    nextId: (p: string) => `${p}-1`,
    appendEvent: (
      d: ReturnType<typeof getDb>,
      serial: string,
      ev: { type: string; toStatus?: string },
    ) => {
      events.push(ev.type);
      const u = d.units.find((x) => x.serial === serial)!;
      if (ev.toStatus) u.status = ev.toStatus as typeof u.status;
    },
    ensureQcDescription: (_d: unknown, phrase: string) => phrase,
    receivedNote: "in",
    qcNote: "qc",
  });

  it("shelves a unit whose QC was taken, at what the shop paid", () => {
    const db = structuredClone(getDb());
    const sku = db.skus.find((s) =>
      db.categories.some(
        (c) =>
          c.tracksSerial &&
          c.name === db.models.find((m) => m.id === s.modelId)?.category,
      ),
    )!;
    const events: string[] = [];
    const serial = bookTradeIn(
      db,
      {
        id: "t1",
        label: "Pro 14",
        serial: "c6ymfxl6qw",
        value: 27_000_000,
        skuId: sku.id,
        condition: "SECOND",
        grade: "A",
        qc: { description: "Fullset", price: 30_000_000 },
      },
      ctx(events),
    );
    expect(serial).toBe("C6YMFXL6QW");
    const unit = db.units.find((u) => u.serial === "C6YMFXL6QW")!;
    expect(unit).toMatchObject({
      status: "TERSEDIA",
      buy: 27_000_000,
      price: 30_000_000,
      description: "Fullset",
      grade: "A",
      poId: null,
    });
    expect(events).toEqual(["DITERIMA", "QC_SELESAI"]);
  });

  it("leaves a second-hand unit with no description in QC", () => {
    const db = structuredClone(getDb());
    const sku = db.skus[0]!;
    const events: string[] = [];
    bookTradeIn(
      db,
      {
        id: "t2",
        label: "Air",
        serial: "TRADEQC00001",
        value: 1_000_000,
        skuId: sku.id,
        condition: "SECOND",
        grade: "B",
        qc: {},
      },
      ctx(events),
    );
    expect(db.units.find((u) => u.serial === "TRADEQC00001")!.status).toBe(
      "QC",
    );
    expect(events).toEqual(["DITERIMA"]);
  });
});
