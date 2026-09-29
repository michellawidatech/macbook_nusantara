/**
 * What one allocated payment becomes on the document it settles — an invoice,
 * a sale, a debt from before this app (owner ask 2026-09-22). The dialog that
 * uses these is `routes/finance/DebtPaymentModal.tsx`.
 */
import { describe, expect, it } from "vitest";
import {
  invoicePaymentParts,
  openingOwed,
  openingPayment,
  salePaymentsAfter,
  type PaymentBase,
} from "../src/lib/debtPayments.js";
import { poTotals } from "../src/lib/inbound.js";
import {
  customerDebtOf,
  payableGroups,
  receivableGroups,
} from "../src/lib/payableReceivable.js";
import { orderBalance } from "../src/lib/salePayments.js";
import type { Order, Po } from "../src/mock/seed.js";

const BASE: PaymentBase = {
  method: "TRANSFER",
  at: "2026-09-22T03:00:00.000Z",
  inBalance: true,
};
const ids = () => {
  let n = 0;
  return () => `pp-new-${++n}`;
};

function po(over: Partial<Po> = {}): Po {
  return {
    id: "po-1",
    code: "PI-1",
    supplierId: "sup-1",
    invoice: "",
    date: "2026-09-01T00:00:00.000Z",
    locationId: "wh-1",
    items: [
      {
        id: "poi-1",
        skuId: "m-air-m2-v1",
        serial: null,
        qty: 1,
        unitCost: 8_000_000,
      },
    ],
    payments: [],
    fees: [
      {
        id: "fee-ship",
        kind: "SHIPPING",
        label: "JNE",
        amount: 150_000,
        inCogs: true,
      },
      { id: "fee-tax", kind: "TAX", label: "", amount: 50_000, inCogs: true },
    ],
    discount: 0,
    status: "RECEIVED",
    ...over,
  } as Po;
}

function sale(over: Partial<Order> = {}): Order {
  return {
    id: "o-1",
    code: "SI-1",
    ts: "2026-09-10T02:00:00.000Z",
    customerId: "c-1",
    serials: [],
    prices: {},
    total: 10_000_000,
    payMethod: "TUNAI",
    settled: false,
    source: "WALK_IN",
    ...over,
  } as Order;
}

describe("invoicePaymentParts", () => {
  it("pays the goods first, then each expense by name", () => {
    const parts = invoicePaymentParts(po(), 8_100_000, BASE, ids());
    expect(parts.map((p) => [p.amount, p.appliedTo, p.feeId])).toEqual([
      [8_000_000, "ORDER", undefined],
      [100_000, "SHIPPING", "fee-ship"],
    ]);
  });

  it("settles the invoice exactly when paid its outstanding figure", () => {
    const invoice = po();
    const parts = invoicePaymentParts(invoice, 8_200_000, BASE, ids());
    const after = poTotals({ ...invoice, payments: parts });
    expect(after.outstanding).toBe(0);
    expect(after.feeStandings.every((s) => s.owed === 0)).toBe(true);
  });

  it("never writes more than the invoice owes", () => {
    const parts = invoicePaymentParts(po(), 50_000_000, BASE, ids());
    expect(parts.reduce((n, p) => n + p.amount, 0)).toBe(8_200_000);
  });

  it("carries the balance switch only when it is off", () => {
    const on = invoicePaymentParts(po(), 1_000, BASE, ids());
    const off = invoicePaymentParts(
      po(),
      1_000,
      { ...BASE, inBalance: false },
      ids(),
    );
    expect("inBalance" in on[0]!).toBe(false);
    expect(off[0]!.inBalance).toBe(false);
  });
});

describe("salePaymentsAfter", () => {
  const promised = sale({
    payments: [
      {
        id: "p-cash",
        method: "TUNAI",
        amount: 4_000_000,
        state: "SETTLED",
        at: "2026-09-10T02:00:00.000Z",
      },
      {
        id: "p-due",
        method: "TUNAI",
        amount: 6_000_000,
        state: "DUE",
        at: "2026-09-10T02:00:00.000Z",
        dueAt: "2026-09-30T00:00:00.000Z",
      },
    ],
  });

  it("takes a part payment off the promise and records it as settled", () => {
    const next = salePaymentsAfter(promised, 2_500_000, BASE, "p-new");
    const o = { ...promised, payments: next };
    expect(customerDebtOf(o)).toBe(3_500_000);
    expect(next.find((p) => p.id === "p-due")?.amount).toBe(3_500_000);
    expect(next.at(-1)).toMatchObject({
      id: "p-new",
      amount: 2_500_000,
      state: "SETTLED",
      method: "TRANSFER",
    });
  });

  it("removes the promise when it is paid in full", () => {
    const next = salePaymentsAfter(promised, 6_000_000, BASE, "p-new");
    expect(next.some((p) => p.id === "p-due")).toBe(false);
    expect(orderBalance({ ...promised, payments: next }).fullySettled).toBe(
      true,
    );
  });

  it("pays off an old sale that only ever had a method and a flag", () => {
    // `legacyPayments` reads it as ONE pending payment on a walk-in channel —
    // which is a person's debt, not a marketplace's money.
    const old = sale();
    expect(customerDebtOf(old)).toBe(10_000_000);
    const next = salePaymentsAfter(old, 4_000_000, BASE, "p-new");
    expect(customerDebtOf({ ...old, payments: next })).toBe(6_000_000);
  });

  it("covers a gap nobody accounted for", () => {
    const gap = sale({
      payments: [
        {
          id: "p-cash",
          method: "TUNAI",
          amount: 7_000_000,
          state: "SETTLED",
          at: "2026-09-10T02:00:00.000Z",
        },
      ],
    });
    expect(customerDebtOf(gap)).toBe(3_000_000);
    const next = salePaymentsAfter(gap, 3_000_000, BASE, "p-new");
    expect(customerDebtOf({ ...gap, payments: next })).toBe(0);
  });

  it("never touches money a marketplace is holding", () => {
    const shopee = sale({
      source: "SHOPEE",
      payments: [
        {
          id: "p-shopee",
          method: "MARKETPLACE",
          amount: 6_000_000,
          state: "PENDING",
          channel: "SHOPEE",
          at: "2026-09-10T02:00:00.000Z",
        },
        {
          id: "p-due",
          method: "TUNAI",
          amount: 4_000_000,
          state: "DUE",
          at: "2026-09-10T02:00:00.000Z",
        },
      ],
    });
    const next = salePaymentsAfter(shopee, 4_000_000, BASE, "p-new");
    expect(next.find((p) => p.id === "p-shopee")?.amount).toBe(6_000_000);
    expect(customerDebtOf({ ...shopee, payments: next })).toBe(0);
  });

  it("marks the payment out of the balance when the switch is off", () => {
    const next = salePaymentsAfter(
      promised,
      1_000,
      { ...BASE, inBalance: false },
      "p-new",
    );
    expect(next.at(-1)?.inBalance).toBe(false);
  });
});

describe("opening balances", () => {
  it("is what was owed less what has been paid off it", () => {
    const party = {
      openingBalance: 7_500_000,
      openingPayments: [openingPayment(2_000_000, BASE, "op-1")],
    };
    expect(openingOwed(party)).toBe(5_500_000);
    expect(openingOwed({ ...party, openingBalance: 1_000_000 })).toBe(0);
  });

  it("has no old-debt row on Payable at all", () => {
    // `Supplier.openingBalance` went on 2026-09-24 (*"we don't track it
    // anymore"*), so a supplier with no open invoice is on no list.
    expect(payableGroups([], [{ id: "sup-1", name: "CV Apel Segar" }])).toEqual(
      [],
    );
  });

  it("drops the old-debt row from Receivable once it is paid off", () => {
    const groups = receivableGroups(
      [],
      [
        {
          id: "c-1",
          name: "Budi",
          openingBalance: 1_000_000,
          openingPayments: [openingPayment(1_000_000, BASE, "op-1")],
        },
      ],
      "Walk-in",
    );
    expect(groups).toEqual([]);
  });
});
