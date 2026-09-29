/**
 * One supplier's account: invoices, deposits, and old debt.
 * Owner ask 2026-09-08 — see `lib/supplierLedger.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  allocatedOf,
  allocationProblems,
  remainingOf,
  spreadOldestFirst,
  suggestedAllocation,
  supplierAccount,
  supplierHistory,
  type HistoryInvoice,
  type LedgerInvoice,
  type SupplierDeposit,
} from "../src/lib/supplierLedger.js";

const deposit = (over: Partial<SupplierDeposit> = {}): SupplierDeposit => ({
  id: "d1",
  supplierId: "sup-1",
  amount: 30_000_000,
  method: "TRANSFER",
  at: "2026-09-01T03:00:00.000Z",
  staff: "Michella",
  allocations: [],
  ...over,
});

const inv = (over: Partial<LedgerInvoice> = {}): LedgerInvoice => ({
  id: "po-1",
  supplierId: "sup-1",
  date: "2026-09-01",
  total: 20_000_000,
  paid: 0,
  ...over,
});

describe("a deposit's balance", () => {
  it("is what is left after the allocations", () => {
    const d = deposit({
      allocations: [
        { id: "a1", poId: "po-1", amount: 18_000_000, at: "x", staff: "M" },
      ],
    });
    expect(allocatedOf(d)).toBe(18_000_000);
    expect(remainingOf(d)).toBe(12_000_000);
  });

  it("never reads as the supplier owing the shop money", () => {
    // A negative balance would be a completely different situation, and not
    // one this figure should ever claim.
    const d = deposit({
      amount: 1_000_000,
      allocations: [
        { id: "a1", poId: "po-1", amount: 9_000_000, at: "x", staff: "M" },
      ],
    });
    expect(remainingOf(d)).toBe(0);
  });
});

describe("supplierAccount", () => {
  it("adds the invoices up and takes the deposits off", () => {
    const a = supplierAccount(
      "sup-1",
      [
        inv({ id: "po-1", total: 20_000_000, paid: 5_000_000 }),
        inv({ id: "po-2", total: 10_000_000, paid: 10_000_000 }),
      ],
      [deposit({ amount: 4_000_000 })],
    );
    expect(a.invoiced).toBe(30_000_000);
    expect(a.paid).toBe(15_000_000);
    expect(a.owedOnInvoices).toBe(15_000_000);
    expect(a.unallocated).toBe(4_000_000);
    // What a transfer today would have to be.
    expect(a.netOwed).toBe(11_000_000);
    expect(a.openInvoices).toBe(1);
  });

  it("owes nothing beyond its invoices", () => {
    // `Supplier.openingBalance` went on 2026-09-24 — *"we don't track it
    // anymore"* — so a supplier with no open invoice is owed nothing, whatever
    // B2Soft used to say about them.
    const a = supplierAccount("sup-1", [inv({ total: 0, paid: 0 })], []);
    expect(a.owed).toBe(0);
    expect(a.owedOnInvoices).toBe(0);
  });

  it("shows a supplier holding too much as being in credit", () => {
    const a = supplierAccount(
      "sup-1",
      [inv({ total: 5_000_000, paid: 5_000_000 })],
      [deposit({ amount: 8_000_000 })],
    );
    expect(a.netOwed).toBe(0);
    expect(a.credit).toBe(8_000_000);
  });

  it("ignores drafts and closed invoices", () => {
    const a = supplierAccount(
      "sup-1",
      [inv({ id: "po-1", total: 9_000_000, ignore: true })],
      [],
    );
    expect(a.invoiced).toBe(0);
    expect(a.owed).toBe(0);
  });

  it("never counts another supplier's invoices or deposits", () => {
    const a = supplierAccount(
      "sup-1",
      [inv({ supplierId: "sup-2", total: 9_000_000 })],
      [deposit({ supplierId: "sup-2" })],
    );
    expect(a.invoiced).toBe(0);
    expect(a.unallocated).toBe(0);
  });

  it("reports the oldest unpaid invoice", () => {
    const a = supplierAccount(
      "sup-1",
      [
        inv({ id: "po-1", date: "2026-08-01", total: 5_000_000 }),
        inv({ id: "po-2", date: "2026-09-01", total: 5_000_000 }),
      ],
      [],
    );
    expect(a.oldestUnpaidAt).toBe("2026-08-01");
  });
});

describe("allocationProblems", () => {
  it("refuses more than the deposit holds", () => {
    // Otherwise the allocation creates money.
    expect(
      allocationProblems({
        amount: 5_000_000,
        depositRemaining: 3_000_000,
        invoiceOutstanding: 9_000_000,
      }),
    ).toHaveLength(1);
  });

  it("refuses more than the invoice owes", () => {
    // Otherwise the invoice is overpaid and the excess is invisible: the shop
    // thinks it has used the deposit when part of it is still there.
    expect(
      allocationProblems({
        amount: 5_000_000,
        depositRemaining: 9_000_000,
        invoiceOutstanding: 3_000_000,
      }),
    ).toHaveLength(1);
  });

  it("refuses nothing at all", () => {
    expect(
      allocationProblems({
        amount: 0,
        depositRemaining: 9_000_000,
        invoiceOutstanding: 9_000_000,
      }),
    ).toHaveLength(1);
  });

  it("lets a good allocation through", () => {
    expect(
      allocationProblems({
        amount: 3_000_000,
        depositRemaining: 9_000_000,
        invoiceOutstanding: 3_000_000,
      }),
    ).toEqual([]);
  });
});

describe("suggestedAllocation", () => {
  it("offers the smaller of the two, which can never be a mistake", () => {
    expect(suggestedAllocation(9_000_000, 3_000_000)).toBe(3_000_000);
    expect(suggestedAllocation(2_000_000, 3_000_000)).toBe(2_000_000);
    expect(suggestedAllocation(0, 3_000_000)).toBe(0);
  });
});

describe("spreadOldestFirst", () => {
  it("fills the oldest invoices until the money runs out", () => {
    // The shop's rule, not the arithmetic's: an invoice six weeks outstanding
    // is the one the supplier telephones about.
    const plan = spreadOldestFirst(12_000_000, [
      { id: "po-new", date: "2026-09-05", outstanding: 8_000_000 },
      { id: "po-old", date: "2026-08-01", outstanding: 9_000_000 },
    ]);
    expect(plan).toEqual([
      { poId: "po-old", amount: 9_000_000 },
      { poId: "po-new", amount: 3_000_000 },
    ]);
  });

  it("never allocates more than an invoice owes", () => {
    const plan = spreadOldestFirst(50_000_000, [
      { id: "po-1", date: "2026-08-01", outstanding: 2_000_000 },
    ]);
    expect(plan).toEqual([{ poId: "po-1", amount: 2_000_000 }]);
  });

  it("skips a settled invoice and answers nothing when there is nothing to pay", () => {
    expect(
      spreadOldestFirst(5_000_000, [
        { id: "po-1", date: "2026-08-01", outstanding: 0 },
      ]),
    ).toEqual([]);
    expect(spreadOldestFirst(0, [])).toEqual([]);
  });
});

/**
 * The whole account, not the deposits — owner ask 2026-09-09.
 *
 * What is worth pinning is the SIGNS and what is left out: an allocation moves
 * no money, and a payment funded by a deposit is not a second time the shop
 * paid. Getting either wrong makes the history say the shop spent twice what
 * it did, which is the failure that would send somebody to the bank statement.
 */
describe("supplierHistory", () => {
  const invoice = (over: Partial<HistoryInvoice> = {}): HistoryInvoice => ({
    id: "po-1",
    code: "PI-2026/09-000001",
    supplierId: "sup-1",
    date: "2026-09-02",
    total: 20_000_000,
    paid: 0,
    payments: [],
    ...over,
  });

  it("carries invoices, payments, deposits and old debt in one list", () => {
    const rows = supplierHistory(
      "sup-1",
      [
        invoice({
          invoiceNo: "INV/2026/IX/041",
          paid: 5_000_000,
          payments: [
            {
              id: "pp1",
              at: "2026-09-04",
              amount: 5_000_000,
              method: "TRANSFER",
            },
          ],
        }),
      ],
      [deposit({ at: "2026-09-03" })],
    );
    expect(rows.map((r) => r.kind)).toEqual(["PAYMENT", "DEPOSIT", "INVOICE"]);
    // Newest first — this list is read from the top.
    expect(rows[0]!.at).toBe("2026-09-04");
    // The supplier's own number rides along, for the telephone call.
    expect(rows.find((r) => r.kind === "INVOICE")!.note).toBe(
      "INV/2026/IX/041",
    );
  });

  it("signs a charge and a payment opposite ways", () => {
    const rows = supplierHistory("sup-1", [invoice()], [deposit()]);
    expect(rows.find((r) => r.kind === "INVOICE")!.direction).toBe("CHARGE");
    expect(rows.find((r) => r.kind === "DEPOSIT")!.direction).toBe("PAYMENT");
  });

  it("does not count a deposit-funded payment as money leaving twice", () => {
    // The rupiah left on the day of the deposit. The invoice being marked paid
    // is a label on money already gone, which is what NEUTRAL says.
    const rows = supplierHistory(
      "sup-1",
      [
        invoice({
          paid: 8_000_000,
          payments: [
            {
              id: "pp1",
              at: "2026-09-05",
              amount: 8_000_000,
              method: "TRANSFER",
              fromDepositId: "d1",
            },
          ],
        }),
      ],
      [
        deposit({
          allocations: [
            {
              id: "a1",
              poId: "po-1",
              amount: 8_000_000,
              at: "2026-09-05",
              staff: "Michella",
            },
          ],
        }),
      ],
    );
    expect(rows.filter((r) => r.kind === "PAYMENT")).toHaveLength(0);
    const alloc = rows.find((r) => r.kind === "ALLOCATION")!;
    expect(alloc.direction).toBe("NEUTRAL");
    expect(alloc.poId).toBe("po-1");
    // And the deposit itself is still the one time money moved.
    expect(
      rows.filter((r) => r.direction === "PAYMENT").map((r) => r.amount),
    ).toEqual([30_000_000]);
  });

  it("leaves another supplier's paperwork out", () => {
    const rows = supplierHistory(
      "sup-1",
      [invoice({ id: "po-2", supplierId: "sup-2" })],
      [deposit({ id: "d2", supplierId: "sup-2" })],
    );
    expect(rows).toEqual([]);
  });

  it("has no row for a debt from before this app", () => {
    // `Supplier.openingBalance` and its OPENING row went on 2026-09-24. The
    // account is its invoices, its payments and its deposits.
    const rows = supplierHistory("sup-1", [invoice()], []);
    expect(rows.every((r) => r.kind !== ("OPENING" as never))).toBe(true);
  });
});
