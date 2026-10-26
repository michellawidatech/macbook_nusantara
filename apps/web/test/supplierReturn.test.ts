/**
 * A supplier return carries its money (owner 2026-10-26, spec §3, rule C):
 * the credit first comes off what the unit's invoice still has unpaid, and
 * the rest is a refund received now or awaited.
 */
import { describe, expect, it } from "vitest";
import {
  awaitingRefund,
  invoiceOwedOf,
  planSupplierReturnMoney,
  refundReceivedOf,
  returnMoney,
  splitCredit,
  supplierReturnBlock,
  withdrawSupplierReturnMoney,
} from "../src/lib/supplierReturn.js";
import { poTotals } from "../src/lib/inbound.js";
import { payableGroups } from "../src/lib/payableReceivable.js";
import type { ManualIncome, Po, PoPayment } from "../src/mock/seed.js";

/** An invoice of two units at Rp5jt each, no expenses, no discount. */
function invoice(payments: PoPayment[] = []): Po {
  return {
    id: "po-x",
    code: "PI-2026/10-000001",
    supplierId: "sup-1",
    invoice: "INV-1",
    date: "2026-10-01",
    locationId: "wh-1",
    items: [
      { id: "i1", skuId: "s", serial: "A", qty: 1, unitCost: 5_000_000 },
      { id: "i2", skuId: "s", serial: "B", qty: 1, unitCost: 5_000_000 },
    ],
    fees: [],
    payments,
    discount: 0,
    status: "RECEIVED",
  } as unknown as Po;
}

const paid = (amount: number): PoPayment => ({
  id: `pay-${amount}`,
  method: "TRANSFER",
  amount,
  at: "2026-10-02T03:00:00.000Z",
});

describe("splitCredit — rule C", () => {
  it("takes an unpaid invoice's balance first", () => {
    expect(splitCredit(5_000_000, 10_000_000)).toEqual({
      credit: 5_000_000,
      owed: 10_000_000,
      applied: 5_000_000,
      refund: 0,
    });
  });

  it("is all refund when the invoice is fully paid", () => {
    expect(splitCredit(5_000_000, 0)).toMatchObject({
      applied: 0,
      refund: 5_000_000,
    });
  });

  it("splits when the credit is more than the invoice still owes", () => {
    expect(splitCredit(5_000_000, 2_000_000)).toMatchObject({
      applied: 2_000_000,
      refund: 3_000_000,
    });
  });

  it("writes nothing for a credit of zero", () => {
    expect(splitCredit(0, 2_000_000)).toMatchObject({ applied: 0, refund: 0 });
  });

  it("never goes negative", () => {
    expect(splitCredit(-5, -1)).toMatchObject({
      credit: 0,
      applied: 0,
      refund: 0,
    });
  });
});

describe("invoiceOwedOf", () => {
  it("is what the goods still owe — nothing without an invoice", () => {
    expect(invoiceOwedOf(undefined)).toBe(0);
    expect(invoiceOwedOf(invoice())).toBe(10_000_000);
    expect(invoiceOwedOf(invoice([paid(4_000_000)]))).toBe(6_000_000);
    expect(invoiceOwedOf(invoice([paid(10_000_000)]))).toBe(0);
  });
});

describe("planSupplierReturnMoney", () => {
  const base = {
    returnId: "r_1",
    at: "2026-10-26T03:00:00.000Z",
    date: "2026-10-26",
    paymentId: "pp_1",
    incomeId: "inc_1",
    note: "Supplier refund — CV Apel",
  };

  it("on an unpaid invoice writes the credit as a RETUR_SUPPLIER payment and no income", () => {
    const plan = planSupplierReturnMoney({
      ...base,
      credit: 5_000_000,
      po: invoice(),
      refundInto: "TRANSFER",
    });
    expect(plan.payment).toEqual({
      poId: "po-x",
      payment: {
        id: "pp_1",
        method: "RETUR_SUPPLIER",
        amount: 5_000_000,
        at: base.at,
        appliedTo: "ORDER",
        inBalance: false,
        returnId: "r_1",
      },
    });
    expect(plan.income).toBeUndefined();
    expect(plan.received).toBe(0);
  });

  it("on a partly paid invoice splits into a credit and a refund received", () => {
    const plan = planSupplierReturnMoney({
      ...base,
      credit: 5_000_000,
      po: invoice([paid(8_000_000)]),
      refundInto: "TUNAI",
    });
    expect(plan.payment?.payment.amount).toBe(2_000_000);
    expect(plan.income).toEqual({
      id: "inc_1",
      reason: "REFUND",
      amount: 3_000_000,
      date: "2026-10-26",
      method: "TUNAI",
      returnId: "r_1",
      note: base.note,
      createdAt: base.at,
    });
    expect(plan.received).toBe(3_000_000);
  });

  it("awaits a refund the supplier has not paid", () => {
    const plan = planSupplierReturnMoney({
      ...base,
      credit: 5_000_000,
      po: invoice([paid(10_000_000)]),
      refundInto: "AWAITED",
    });
    expect(plan.payment).toBeUndefined();
    expect(plan.income).toBeUndefined();
    expect(plan.split.refund).toBe(5_000_000);
  });

  it("without an invoice everything is refund", () => {
    const plan = planSupplierReturnMoney({
      ...base,
      credit: 1_500_000,
      po: undefined,
      refundInto: "TRANSFER_LUAR",
    });
    expect(plan.payment).toBeUndefined();
    expect(plan.income).toMatchObject({
      amount: 1_500_000,
      method: "TRANSFER_LUAR",
    });
  });

  it("the credit counts as paid on the invoice — Payable drops by it", () => {
    const po = invoice([paid(3_000_000)]);
    const plan = planSupplierReturnMoney({
      ...base,
      credit: 5_000_000,
      po,
      refundInto: "AWAITED",
    });
    const after = {
      ...po,
      payments: [...po.payments, plan.payment!.payment],
    };
    expect(poTotals(after).outstanding).toBe(2_000_000);
    expect(poTotals(after).goods.owed).toBe(2_000_000);
    const owed = (po: Po) =>
      payableGroups([po], [{ id: "sup-1", name: "CV Apel" }])
        .flatMap((g) => g.rows)
        .reduce((n, r) => n + r.owed, 0);
    expect(owed(po)).toBe(7_000_000);
    expect(owed(after)).toBe(2_000_000);
  });
});

describe("what a return is owed, and what has come in", () => {
  const rec = {
    id: "r_1",
    status: "DONE" as const,
    expectedCredit: 5_000_000,
  };
  const credit: PoPayment = {
    id: "pp_1",
    method: "RETUR_SUPPLIER",
    amount: 2_000_000,
    at: "2026-10-26T03:00:00.000Z",
    inBalance: false,
    returnId: "r_1",
  };
  const income = (amount: number, id = "inc_1"): ManualIncome => ({
    id,
    reason: "REFUND",
    amount,
    date: "2026-10-26",
    method: "TRANSFER",
    returnId: "r_1",
  });

  it("awaiting = credit − applied − received", () => {
    expect(awaitingRefund(5_000_000, 2_000_000, 1_000_000)).toBe(2_000_000);
    expect(awaitingRefund(5_000_000, 5_000_000, 0)).toBe(0);
    expect(awaitingRefund(5_000_000, 0, 9_000_000)).toBe(0);
  });

  it("reads the credit off the invoices and the refund off the incomes", () => {
    const m = returnMoney(rec, [invoice([credit])], [income(1_000_000)]);
    expect(m).toMatchObject({
      credit: 5_000_000,
      applied: 2_000_000,
      received: 1_000_000,
      awaiting: 2_000_000,
    });
    expect(m.invoices).toEqual([
      { poId: "po-x", code: "PI-2026/10-000001", amount: 2_000_000 },
    ]);
  });

  it("falls back to the server's figure when this account is sent no incomes", () => {
    expect(refundReceivedOf({ ...rec, refundReceived: 3_000_000 }, [])).toBe(
      3_000_000,
    );
    // Incomes it can see win: they are the rows themselves.
    expect(
      refundReceivedOf({ ...rec, refundReceived: 3_000_000 }, [
        income(1_000_000),
      ]),
    ).toBe(1_000_000);
  });

  it("a withdrawn return awaits nothing", () => {
    const m = returnMoney({ ...rec, status: "CANCELLED" }, [invoice()], []);
    expect(m.awaiting).toBe(0);
  });
});

describe("withdrawing a return's money", () => {
  it("takes the credit off the invoice and leaves every other payment", () => {
    const keep = paid(1_000_000);
    const d = {
      pos: [
        invoice([
          keep,
          {
            id: "pp_1",
            method: "RETUR_SUPPLIER",
            amount: 2_000_000,
            at: "2026-10-26T03:00:00.000Z",
            inBalance: false,
            returnId: "r_1",
          },
        ]),
      ],
    };
    expect(withdrawSupplierReturnMoney(d, "r_1")).toBe(2_000_000);
    expect(d.pos[0]!.payments).toEqual([keep]);
    expect(withdrawSupplierReturnMoney(d, "r_1")).toBe(0);
  });
});

describe("supplierReturnBlock", () => {
  it("allows QC, in stock and at service; not held, not sold", () => {
    expect(supplierReturnBlock("QC")).toBeUndefined();
    expect(supplierReturnBlock("TERSEDIA")).toBeUndefined();
    expect(supplierReturnBlock("SERVIS")).toBeUndefined();
    expect(supplierReturnBlock("DIRESERVASI")).toBe("HELD");
    expect(supplierReturnBlock("TERJUAL")).toBe("NOT_IN_STOCK");
    expect(supplierReturnBlock("RETUR_SUPPLIER")).toBe("NOT_IN_STOCK");
  });
});
