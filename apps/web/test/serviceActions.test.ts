/**
 * Sending a unit to service, paying for a repair, and taking either back
 * (owner asks 2026-10-26) — `lib/serviceActions.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  chargeExpense,
  dayClosed,
  feePayment,
  planChargeDeletion,
  planSendToService,
  planVisitDeletion,
  sendToServiceBlock,
  type SendInput,
} from "../src/lib/serviceActions.js";
import { withStockOnHand } from "../src/lib/stock.js";
import type { ServiceRec } from "../src/lib/service.js";
import type { Expense, UnitEvent } from "../src/mock/seed.js";

const SERIAL = "C02740137JK";
const OPENED = "2026-10-20T03:00:00.000Z";
const CHARGED = "2026-10-21T04:00:00.000Z";

let n = 0;
const nextId = (p: string) => `${p}-${++n}`;

const send = (over: Partial<SendInput> = {}): SendInput => ({
  unit: { serial: SERIAL, locationId: "wh-1" },
  dest: "wh-1",
  raisedBy: "ADJUSTMENT",
  at: OPENED,
  staff: "Dina",
  words: {
    shipLabel: "Courier to service",
    quoteLabel: "Quoted when sent",
    eventNote: "Sent to service",
  },
  nextId,
  ...over,
});

const ev = (
  over: Partial<UnitEvent> & Pick<UnitEvent, "id" | "seq">,
): UnitEvent => ({
  serial: SERIAL,
  type: "DICATAT",
  at: OPENED,
  fromStatus: "TERSEDIA",
  toStatus: "TERSEDIA",
  locationId: "wh-1",
  staff: "Dina",
  ...over,
});

const visit = (over: Partial<ServiceRec> = {}): ServiceRec => ({
  id: "svc-1",
  serial: SERIAL,
  fromLocationId: "wh-1",
  openedAt: OPENED,
  arrivedAt: OPENED,
  fees: [
    {
      id: "sf-1",
      kind: "LABOUR",
      label: "Keyboard",
      amount: 800_000,
      at: CHARGED,
      staff: "Dina",
    },
  ],
  raisedBy: "ADJUSTMENT",
  staff: "Dina",
  ...over,
});

/** Received, accepted, sent, then a charge's note. */
const history = (): UnitEvent[] => [
  ev({
    id: "e1",
    seq: 1,
    type: "DITERIMA",
    at: "2026-10-01T03:00:00.000Z",
    fromStatus: "-",
    toStatus: "QC",
  }),
  ev({
    id: "e2",
    seq: 2,
    type: "QC_SELESAI",
    at: "2026-10-02T03:00:00.000Z",
    fromStatus: "QC",
    toStatus: "TERSEDIA",
  }),
  ev({ id: "e3", seq: 3, at: OPENED, toStatus: "SERVIS", locationId: "wh-3" }),
  ev({
    id: "e4",
    seq: 4,
    at: CHARGED,
    fromStatus: "SERVIS",
    toStatus: "SERVIS",
    locationId: "wh-3",
    note: "Service charge Rp 800.000 — Keyboard",
  }),
];

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: "exp-1",
  kind: "UNIT",
  amount: 800_000,
  date: "2026-10-21",
  method: "TRANSFER",
  serviceFeeId: "sf-1",
  ...over,
});

describe("sendToServiceBlock", () => {
  it("lets a unit in QC or on the shelf go, and nothing else", () => {
    expect(sendToServiceBlock("QC")).toBeUndefined();
    expect(sendToServiceBlock("TERSEDIA")).toBeUndefined();
    // A held unit belongs to a customer until the hold is released.
    expect(sendToServiceBlock("DIRESERVASI")).toBe("HELD");
    expect(sendToServiceBlock("SERVIS")).toBe("AT_SERVICE");
    expect(sendToServiceBlock("TERJUAL")).toBe("NOT_IN_STOCK");
    expect(sendToServiceBlock("HILANG")).toBe("NOT_IN_STOCK");
  });
});

describe("planSendToService", () => {
  it("leaves a unit serviced where it stands, and asks no courier", () => {
    const plan = planSendToService(send({ shippingFee: 50_000 }));
    expect(plan.travelling).toBe(false);
    expect(plan.event).toEqual({
      type: "DICATAT",
      toStatus: "SERVIS",
      note: "Sent to service",
      at: OPENED,
    });
    // A courier between a warehouse and itself is no charge at all.
    expect(plan.visit.fees).toEqual([]);
    expect(plan.visit).toMatchObject({
      fromLocationId: "wh-1",
      openedAt: OPENED,
      arrivedAt: OPENED,
      raisedBy: "ADJUSTMENT",
    });
  });

  it("moves a unit sent elsewhere, from where it set out", () => {
    const plan = planSendToService(
      send({ dest: "wh-3", shippingFee: 50_000, quote: 0 }),
    );
    expect(plan.travelling).toBe(true);
    expect(plan.event.toLocationId).toBe("wh-3");
    expect(plan.visit.fromLocationId).toBe("wh-1");
    expect(plan.visit.fees.map((f) => [f.kind, f.amount, f.at])).toEqual([
      ["SHIPPING", 50_000, OPENED],
    ]);
  });

  it("writes an expense for each charge already paid, and none for one owed", () => {
    const plan = planSendToService(
      send({
        dest: "wh-3",
        shippingFee: 50_000,
        shippingPaid: "TUNAI",
        quote: 800_000,
        quotePaid: "UNPAID",
        poId: "po-1",
        raisedBy: "QC",
      }),
    );
    const [ship, quote] = plan.visit.fees;
    expect(ship).toMatchObject({ kind: "SHIPPING", paid: true });
    expect(quote).toMatchObject({ kind: "LABOUR", amount: 800_000 });
    expect(quote!.paid).toBeUndefined();
    expect(plan.expenses).toEqual([
      expect.objectContaining({
        kind: "UNIT",
        amount: 50_000,
        method: "TUNAI",
        serviceFeeId: ship!.id,
        note: `${SERIAL} · Courier to service`,
      }),
    ]);
    expect(plan.visit.poId).toBe("po-1");
  });
});

describe("a charge's money", () => {
  it("is paid by the expense naming it, or by the server's word when the expense is not sent", () => {
    const fee = visit().fees[0]!;
    expect(feePayment(fee, [expense()])).toEqual({
      paid: true,
      expense: expense(),
    });
    // An account without finance access holds no expenses at all.
    expect(feePayment({ ...fee, paid: true }, [])).toEqual({ paid: true });
    expect(feePayment(fee, [])).toEqual({ paid: false });
  });

  it("files the expense on the day it was paid, under the serial and the charge", () => {
    expect(
      chargeExpense({
        id: "exp-9",
        serial: SERIAL,
        fee: { id: "sf-9", kind: "PART", amount: 300_000 },
        method: "TRANSFER_LUAR",
        day: "2026-10-22",
        createdAt: "2026-10-22T05:00:00.000Z",
      }),
    ).toEqual({
      id: "exp-9",
      kind: "UNIT",
      amount: 300_000,
      date: "2026-10-22",
      method: "TRANSFER_LUAR",
      note: `${SERIAL} · Part`,
      serviceFeeId: "sf-9",
      createdAt: "2026-10-22T05:00:00.000Z",
    });
  });
});

describe("planChargeDeletion", () => {
  const src = (over: object = {}) => ({
    events: history(),
    expenses: [expense()],
    settings: {},
    ...over,
  });

  it("takes the charge's timeline line and its expense", () => {
    expect(planChargeDeletion(src(), visit(), "sf-1")).toEqual({
      eventIds: ["e4"],
      expenseIds: ["exp-1"],
    });
  });

  it("never takes the send row for a charge recorded with it", () => {
    // The charges a send records share its instant and have no line of their own.
    const rec = visit({
      fees: [{ ...visit().fees[0]!, id: "sf-0", at: OPENED }],
    });
    expect(planChargeDeletion(src(), rec, "sf-0").eventIds).toEqual([]);
  });

  it("is refused inside a closed book", () => {
    const plan = planChargeDeletion(
      src({ settings: { booksClosedAt: "2026-10-31T16:59:59.999Z" } }),
      visit(),
      "sf-1",
    );
    expect(plan.block).toBe("BOOKS_CLOSED");
  });
});

describe("planVisitDeletion", () => {
  const src = (over: object = {}) => ({
    events: history(),
    expenses: [expense()],
    settings: {},
    unitStatus: "SERVIS" as const,
    ...over,
  });

  it("takes the send row and the charge rows, newest first, and the expenses", () => {
    expect(planVisitDeletion(src(), visit())).toEqual({
      eventIds: ["e4", "e3"],
      sendEventFound: true,
      expenseIds: ["exp-1"],
    });
  });

  it("takes a correction of a charge as the visit's own", () => {
    const events = [
      ...history(),
      ev({
        id: "e5",
        seq: 5,
        at: "2026-10-22T03:00:00.000Z",
        fromStatus: "SERVIS",
        toStatus: "SERVIS",
        note: "Service charge corrected Rp 800.000 → Rp 650.000 — Keyboard",
      }),
    ];
    const plan = planVisitDeletion(src({ events }), visit());
    expect(plan.block).toBeUndefined();
    expect(plan.eventIds).toEqual(["e5", "e4", "e3"]);
  });

  it("takes the back-in-stock row of a closed visit", () => {
    const closedAt = "2026-10-23T03:00:00.000Z";
    const events = [
      ...history(),
      ev({
        id: "e5",
        seq: 5,
        at: closedAt,
        fromStatus: "SERVIS",
        toStatus: "TERSEDIA",
      }),
    ];
    const plan = planVisitDeletion(
      src({ events, unitStatus: "TERSEDIA" }),
      visit({ closedAt, toLocationId: "wh-1" }),
    );
    expect(plan.block).toBeUndefined();
    expect(plan.eventIds).toEqual(["e5", "e4", "e3"]);
  });

  it("is refused once the unit has moved on", () => {
    const closedAt = "2026-10-23T03:00:00.000Z";
    const events = [
      ...history(),
      ev({
        id: "e5",
        seq: 5,
        at: closedAt,
        fromStatus: "SERVIS",
        toStatus: "TERSEDIA",
      }),
      ev({
        id: "e6",
        seq: 6,
        type: "TERJUAL",
        at: "2026-10-24T03:00:00.000Z",
        toStatus: "TERJUAL",
      }),
    ];
    expect(
      planVisitDeletion(
        src({ events, unitStatus: "TERJUAL" }),
        visit({ closedAt }),
      ).block,
    ).toBe("MOVED_ON");
    // An open visit whose unit is somehow no longer at service, likewise.
    expect(
      planVisitDeletion(src({ unitStatus: "TERSEDIA" }), visit()).block,
    ).toBe("MOVED_ON");
    // And an unrelated row written while it was away.
    const noted = [
      ...history(),
      ev({
        id: "e5",
        seq: 5,
        at: "2026-10-22T03:00:00.000Z",
        fromStatus: "SERVIS",
        toStatus: "SERVIS",
        note: "Price 9.000.000",
      }),
    ];
    expect(planVisitDeletion(src({ events: noted }), visit()).block).toBe(
      "MOVED_ON",
    );
  });

  it("is refused inside a closed book", () => {
    expect(
      planVisitDeletion(
        src({ settings: { booksClosedAt: "2026-10-31T16:59:59.999Z" } }),
        visit(),
      ).block,
    ).toBe("BOOKS_CLOSED");
  });

  it("says so, and guesses nothing, when the send row cannot be found", () => {
    // An older build stamped the visit and its event a few milliseconds apart.
    const events = history().map((e) =>
      e.id === "e3" ? { ...e, at: "2026-10-20T03:00:00.004Z" } : e,
    );
    const plan = planVisitDeletion(src({ events }), visit());
    expect(plan.block).toBeUndefined();
    expect(plan.sendEventFound).toBe(false);
    expect(plan.eventIds).toEqual(["e4"]);
  });
});

describe("the closed book, by day", () => {
  it("closes a day on or before the closing day, and not the day after", () => {
    const settings = { booksClosedAt: "2026-10-31T16:59:59.999Z" };
    expect(dayClosed("2026-10-15", settings)).toBe(true);
    expect(dayClosed("2026-11-01", settings)).toBe(false);
    expect(dayClosed("2026-10-15", {})).toBe(false);
  });
});

describe("withStockOnHand", () => {
  const skus = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const moves = [
    { skuId: "a", locationId: "wh-1", qty: 3 },
    { skuId: "b", locationId: "wh-2", qty: 2 },
    { skuId: "b", locationId: "wh-2", qty: -2 },
    { skuId: "c", locationId: "wh-2", qty: 1 },
  ];
  it("offers only variants with pieces to take, at a warehouse when one is named", () => {
    expect(withStockOnHand(skus, moves).map((s) => s.id)).toEqual(["a", "c"]);
    expect(withStockOnHand(skus, moves, "wh-2").map((s) => s.id)).toEqual([
      "c",
    ]);
  });
});
