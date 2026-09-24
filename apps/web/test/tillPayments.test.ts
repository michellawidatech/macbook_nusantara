import { describe, expect, it } from "vitest";
import {
  needsPaymentRef,
  partsForChannel,
  refMissing,
  saleRefNeeded,
  tillPayments,
  tillProblems,
  tillRows,
  toggleTillMethod,
  type TillPart,
} from "../src/lib/tillPayments.js";
import { isSettled, saleBalance } from "../src/lib/salePayments.js";

const AT = "2026-09-19T03:00:00.000Z";

function ids() {
  let n = 0;
  return () => `p${++n}`;
}

describe("the rows the till shows (owner revision 2026-09-19)", () => {
  it("puts the whole bill on a lone method, paid in full", () => {
    const { rows, paid, owed } = tillRows(10_000_000, [{ method: "TUNAI" }]);
    expect(rows).toEqual([
      {
        method: "TUNAI",
        split: 10_000_000,
        paid: 10_000_000,
        owed: 0,
        splitEditable: false,
        paidEditable: true,
      },
    ]);
    expect(paid).toBe(10_000_000);
    expect(owed).toBe(0);
  });

  it("gives the last method whatever the others leave", () => {
    // The owner's own example: 5jt cash and 5jt more on Tokopedia.
    const { rows } = tillRows(10_000_000, [
      { method: "TUNAI", split: 5_000_000 },
      { method: "TOKOPEDIA" },
    ]);
    expect(rows.map((r) => [r.method, r.split, r.splitEditable])).toEqual([
      ["TUNAI", 5_000_000, true],
      ["TOKOPEDIA", 5_000_000, false],
    ]);
  });

  it("records a partial payment as a debt on that part", () => {
    const { rows, owed } = tillRows(10_000_000, [
      { method: "TRANSFER", paid: 3_000_000 },
    ]);
    expect(rows[0]).toMatchObject({ paid: 3_000_000, owed: 7_000_000 });
    expect(owed).toBe(7_000_000);
  });

  it("says by how much the typed splits overshoot the bill", () => {
    const { splitOver, rows } = tillRows(10_000_000, [
      { method: "TUNAI", split: 12_000_000 },
      { method: "TRANSFER" },
    ]);
    expect(splitOver).toBe(2_000_000);
    expect(rows[1]!.split).toBe(0);
  });
});

describe("only cash and transfer have an actual paid (owner, 2026-09-21)", () => {
  it("pays a marketplace part in full, whatever the part says", () => {
    const { rows, owed } = tillRows(10_000_000, [
      // A `paid` that somehow reached a Shopee part is ignored, not honoured:
      // the customer paid Shopee at its own checkout before the shop saw the
      // order, so a shortfall there is not a thing that can have happened.
      { method: "SHOPEE", paid: 3_000_000 },
    ]);
    expect(rows[0]).toMatchObject({
      paid: 10_000_000,
      owed: 0,
      paidEditable: false,
    });
    expect(owed).toBe(0);
  });

  it("does not report PAID_OVER on a marketplace part", () => {
    expect(
      tillProblems({
        total: 10_000_000,
        source: "SHOPEE",
        parts: [{ method: "SHOPEE", paid: 99_000_000 }],
        ref: "241019ABCDEF",
      }),
    ).toEqual([]);
  });

  it("still lets a cash part be paid in part", () => {
    const { rows } = tillRows(10_000_000, [
      { method: "SHOPEE", split: 6_000_000 },
      { method: "TUNAI", paid: 1_000_000 },
    ]);
    expect(rows.map((r) => [r.method, r.paid, r.owed, r.paidEditable])).toEqual(
      [
        ["SHOPEE", 6_000_000, 0, false],
        ["TUNAI", 1_000_000, 3_000_000, true],
      ],
    );
  });

  it("writes one PENDING payment for a marketplace part and never a debt", () => {
    const payments = tillPayments({
      total: 10_000_000,
      parts: [{ method: "TOKOPEDIA", paid: 1 }],
      at: AT,
      ref: "TKP-1",
      newId: ids(),
    });
    expect(payments).toEqual([
      {
        id: "p1",
        method: "MARKETPLACE",
        at: AT,
        ref: "TKP-1",
        amount: 10_000_000,
        state: "PENDING",
        channel: "TOKOPEDIA",
      },
    ]);
  });
});

describe("picking and unpicking chips", () => {
  it("keeps the first method's amount when a second is added", () => {
    const one: TillPart[] = [{ method: "TUNAI" }];
    const two = toggleTillMethod(10_000_000, one, "TRANSFER");
    expect(two).toEqual([
      { method: "TUNAI", split: 10_000_000 },
      { method: "TRANSFER" },
    ]);
    // …so typing a smaller split into Cash hands Transfer the rest.
    const typed = [{ ...two[0]!, split: 4_000_000 }, two[1]!];
    expect(tillRows(10_000_000, typed).rows[1]!.split).toBe(6_000_000);
  });

  it("drops an unpicked method, and the new last one takes the rest", () => {
    const parts: TillPart[] = [
      { method: "TUNAI", split: 4_000_000 },
      { method: "TRANSFER" },
    ];
    const left = toggleTillMethod(10_000_000, parts, "TRANSFER");
    expect(tillRows(10_000_000, left).rows[0]!.split).toBe(10_000_000);
  });
});

describe("what the sale writes", () => {
  it("writes one settled payment for cash paid in full", () => {
    const payments = tillPayments({
      total: 10_000_000,
      parts: [{ method: "TUNAI" }],
      at: AT,
      newId: ids(),
    });
    expect(payments).toEqual([
      {
        id: "p1",
        method: "TUNAI",
        amount: 10_000_000,
        state: "SETTLED",
        at: AT,
      },
    ]);
    expect(isSettled(10_000_000, payments)).toBe(true);
  });

  it("writes a marketplace part as money the marketplace holds", () => {
    const payments = tillPayments({
      total: 10_000_000,
      parts: [{ method: "TUNAI", split: 5_000_000 }, { method: "SHOPEE" }],
      at: AT,
      ref: " 240919ABCD ",
      newId: ids(),
    });
    expect(payments).toEqual([
      {
        id: "p1",
        method: "TUNAI",
        amount: 5_000_000,
        state: "SETTLED",
        at: AT,
        ref: "240919ABCD",
      },
      {
        id: "p2",
        method: "MARKETPLACE",
        amount: 5_000_000,
        state: "PENDING",
        channel: "SHOPEE",
        at: AT,
        ref: "240919ABCD",
      },
    ]);
    // Paid, but not the shop's yet — pending is not a customer debt.
    const balance = saleBalance(10_000_000, payments);
    expect(balance.customerOwes).toBe(0);
    expect(balance.pending).toBe(5_000_000);
  });

  it("writes what is still owed as a debt with its due date", () => {
    const payments = tillPayments({
      total: 10_000_000,
      parts: [{ method: "TRANSFER", paid: 3_000_000 }],
      at: AT,
      dueAt: "2026-10-01T00:00:00.000Z",
      newId: ids(),
    });
    expect(payments.map((p) => [p.state, p.amount, p.dueAt])).toEqual([
      ["SETTLED", 3_000_000, undefined],
      ["DUE", 7_000_000, "2026-10-01T00:00:00.000Z"],
    ]);
    expect(saleBalance(10_000_000, payments).customerOwes).toBe(7_000_000);
  });

  it("writes nothing when a trade-in covers the whole bill", () => {
    expect(
      tillPayments({
        total: 0,
        parts: [{ method: "TUNAI" }],
        at: AT,
        newId: ids(),
      }),
    ).toEqual([]);
  });
});

describe("what stops a sale being recorded", () => {
  it("wants a method whenever there is something to pay", () => {
    expect(
      tillProblems({ total: 10, source: "OFFLINE", parts: [], ref: "" }),
    ).toEqual(["NO_METHOD"]);
    expect(
      tillProblems({ total: 0, source: "OFFLINE", parts: [], ref: "" }),
    ).toEqual([]);
  });

  it("refuses splits that overshoot and a paid figure above its split", () => {
    expect(
      tillProblems({
        total: 10_000_000,
        source: "OFFLINE",
        parts: [{ method: "TUNAI", split: 11_000_000 }, { method: "TRANSFER" }],
        ref: "",
      }),
    ).toEqual(["SPLIT_OVER"]);
    expect(
      tillProblems({
        total: 10_000_000,
        source: "OFFLINE",
        parts: [{ method: "TUNAI", paid: 11_000_000 }],
        ref: "",
      }),
    ).toEqual(["PAID_OVER"]);
  });

  it("wants the payment reference on a marketplace sale", () => {
    // By channel — TikTok has no chip, and still owes its order number.
    expect(needsPaymentRef("TIKTOK", [{ method: "TRANSFER" }])).toBe(true);
    // By method — a walk-in paying half through Tokopedia.
    expect(needsPaymentRef("OFFLINE", [{ method: "TOKOPEDIA" }])).toBe(true);
    expect(needsPaymentRef("OFFLINE", [{ method: "TUNAI" }])).toBe(false);
    expect(
      tillProblems({
        total: 1,
        source: "SHOPEE",
        parts: [{ method: "SHOPEE" }],
        ref: "  ",
      }),
    ).toEqual(["NO_REF"]);
  });
});

describe("a channel picks its own chip", () => {
  it("picks Shopee for a Shopee sale and Tokopedia for a Tokopedia one", () => {
    expect(partsForChannel("SHOPEE", "OFFLINE", [{ method: "TUNAI" }])).toEqual(
      [{ method: "SHOPEE" }],
    );
    expect(
      partsForChannel("TOKOPEDIA", "SHOPEE", [{ method: "SHOPEE" }]),
    ).toEqual([{ method: "TOKOPEDIA" }]);
  });

  it("puts cash back when leaving a marketplace, unless the split was arranged by hand", () => {
    expect(
      partsForChannel("OFFLINE", "SHOPEE", [{ method: "SHOPEE" }]),
    ).toEqual([{ method: "TUNAI" }]);
    const arranged: TillPart[] = [
      { method: "TUNAI", split: 1 },
      { method: "SHOPEE" },
    ];
    expect(partsForChannel("OFFLINE", "SHOPEE", arranged)).toBe(arranged);
  });

  it("leaves the payment alone for TikTok, which has no chip", () => {
    const parts: TillPart[] = [{ method: "TRANSFER" }];
    expect(partsForChannel("TIKTOK", "OFFLINE", parts)).toBe(parts);
  });
});

describe("one order number per marketplace part (owner revision 2026-09-21)", () => {
  it("writes each marketplace part's own number on its own payment", () => {
    // "If the user choose 1 shopee 1 tokopedia, then have 2 reference number".
    const payments = tillPayments({
      total: 10_000_000,
      parts: [
        { method: "SHOPEE", split: 4_000_000, ref: " 2609SHP01 " },
        { method: "TOKOPEDIA", ref: "INV/TKP/01" },
      ],
      at: AT,
      newId: ids(),
    });
    expect(payments.map((p) => [p.channel, p.amount, p.ref])).toEqual([
      ["SHOPEE", 4_000_000, "2609SHP01"],
      ["TOKOPEDIA", 6_000_000, "INV/TKP/01"],
    ]);
  });

  it("gives a cash part no number of its own", () => {
    const payments = tillPayments({
      total: 10_000_000,
      parts: [
        { method: "TUNAI", split: 3_000_000 },
        { method: "SHOPEE", ref: "2609SHP02" },
      ],
      at: AT,
      newId: ids(),
    });
    expect(payments.map((p) => [p.method, p.ref])).toEqual([
      ["TUNAI", undefined],
      ["MARKETPLACE", "2609SHP02"],
    ]);
  });

  it("wants a number on every marketplace part, and only there", () => {
    const parts: TillPart[] = [
      { method: "SHOPEE", split: 4_000_000, ref: "2609SHP03" },
      { method: "TOKOPEDIA" },
    ];
    expect(parts.map(refMissing)).toEqual([false, true]);
    expect(refMissing({ method: "TUNAI" })).toBe(false);
    expect(
      tillProblems({ total: 10_000_000, source: "OFFLINE", parts, ref: "" }),
    ).toEqual(["NO_REF"]);
  });

  it("asks the SALE for a number only when no part can carry one", () => {
    // TikTok has no chip; a Shopee sale taken in cash has no Shopee part.
    expect(saleRefNeeded("TIKTOK", [{ method: "TRANSFER" }])).toBe(true);
    expect(saleRefNeeded("SHOPEE", [{ method: "TUNAI" }])).toBe(true);
    expect(saleRefNeeded("SHOPEE", [{ method: "SHOPEE" }])).toBe(false);
    expect(saleRefNeeded("OFFLINE", [{ method: "TUNAI" }])).toBe(false);
    expect(
      tillProblems({
        total: 1,
        source: "TIKTOK",
        parts: [{ method: "TRANSFER" }],
        ref: "",
      }),
    ).toEqual(["NO_REF"]);
    const [payment] = tillPayments({
      total: 5_000_000,
      parts: [{ method: "TRANSFER" }],
      at: AT,
      ref: "TT-0001",
      newId: ids(),
    });
    expect(payment!.ref).toBe("TT-0001");
  });

  it("keeps the number typed for a platform when its channel is picked again", () => {
    expect(
      partsForChannel("SHOPEE", "OFFLINE", [
        { method: "TUNAI", split: 1 },
        { method: "SHOPEE", ref: "2609SHP04" },
      ]),
    ).toEqual([{ method: "SHOPEE", ref: "2609SHP04" }]);
  });
});
