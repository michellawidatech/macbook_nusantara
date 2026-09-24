/**
 * Utang and piutang — what the shop owes and what it is owed.
 *
 * The rule this file exists to pin is the one that is easy to get wrong:
 * money a MARKETPLACE is holding is not a debt, in either direction. See
 * `lib/payableReceivable.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  payableGroups,
  receivableGroups,
  totalOwed,
} from "../src/lib/payableReceivable.js";
import type { Po } from "../src/mock/seed.js";
import type { ReceivableSale } from "../src/lib/payableReceivable.js";
const SUPPLIERS = [
  { id: "sup-1", name: "CV Apel Segar" },
  { id: "sup-2", name: "PT Buah Digital", openingBalance: 5_000_000 },
];
function po(over: Partial<Po> & Pick<Po, "id" | "code">): Po {
  return {
    supplierId: "sup-1",
    invoice: "",
    date: "2026-09-01T00:00:00.000Z",
    locationId: "wh-1",
    items: [],
    payments: [],
    fees: [],
    discount: 0,
    status: "RECEIVED",
    ...over,
  } as Po;
}
const LINE = (unitCost: number, qty = 1) => ({
  id: `poi-${unitCost}-${qty}`,
  skuId: "m-air-m2-v1",
  serial: null,
  qty,
  unitCost,
});
describe("payable — what the shop owes suppliers", () => {
  it("groups unpaid invoices under their supplier, biggest debt first", () => {
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          date: "2026-09-02T00:00:00.000Z",
        }),
        po({
          id: "po-2",
          code: "PI-2",
          items: [LINE(4_000_000)],
          date: "2026-09-01T00:00:00.000Z",
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      supplierId: "sup-1",
      supplierName: "CV Apel Segar",
      owed: 14_000_000,
      // The oldest unpaid invoice is the one they telephone about.
      oldestAt: "2026-09-01T00:00:00.000Z",
    });
    expect(groups[0]!.rows.map((r) => r.code)).toEqual(["PI-2", "PI-1"]);
  });
  it("leaves out a fully paid invoice", () => {
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          payments: [
            {
              id: "pp-1",
              amount: 10_000_000,
              method: "TRANSFER",
              at: "2026-09-03T00:00:00.000Z",
              appliedTo: "ORDER",
            },
          ],
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups).toEqual([]);
  });
  it("counts a part payment as the remainder, not the whole invoice", () => {
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          payments: [
            {
              id: "pp-1",
              amount: 4_000_000,
              method: "TUNAI",
              at: "2026-09-03T00:00:00.000Z",
              appliedTo: "ORDER",
            },
          ],
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups[0]).toMatchObject({ owed: 6_000_000 });
    expect(groups[0]!.rows[0]).toMatchObject({
      total: 10_000_000,
      paid: 4_000_000,
      owed: 6_000_000,
    });
  });
  it("leaves a DRAFT out — nobody has agreed to it", () => {
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          status: "DRAFT",
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups).toEqual([]);
  });
  it("keeps a CLOSED invoice that still owes money", () => {
    // Closing says "nothing more will be recorded here", never "this is paid"
    // — and an invoice closed with the ongkir outstanding is exactly the row
    // this page exists to surface.
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          closedAt: "2026-09-05T00:00:00.000Z",
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups[0]).toMatchObject({ owed: 10_000_000 });
  });
  it("carries a supplier's debt from before this app", () => {
    const groups = payableGroups([], SUPPLIERS);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ supplierId: "sup-2", owed: 5_000_000 });
    // No invoice, so no date — deliberately not a fake purchase order.
    expect(groups[0]!.oldestAt).toBeUndefined();
    expect(groups[0]!.rows[0]).toMatchObject({ opening: true, code: "" });
  });
  it("adds the invoice's expenses to what is owed", () => {
    const groups = payableGroups(
      [
        po({
          id: "po-1",
          code: "PI-1",
          items: [LINE(10_000_000)],
          fees: [
            {
              id: "fee-1",
              kind: "SHIPPING",
              label: "JNE Cargo",
              amount: 500_000,
              inCogs: true,
            },
          ],
        }),
      ],
      [SUPPLIERS[0]!],
    );
    expect(groups[0]).toMatchObject({ owed: 10_500_000 });
  });
});
function sale(over: Partial<ReceivableSale> & Pick<ReceivableSale, "id">) {
  return {
    code: `SI-${over.id}`,
    customerId: "cus-1",
    total: 10_000_000,
    payMethod: "TUNAI",
    settled: false,
    source: "OFFLINE",
    ts: "2026-09-10T00:00:00.000Z",
    ...over,
  } as ReceivableSale;
}
const CUSTOMERS = [
  { id: "cus-1", name: "Budi", phone: "0811" },
  { id: "cus-2", name: "Sari", phone: "0822", openingBalance: 2_000_000 },
];
describe("receivable — what customers owe the shop", () => {
  it("counts what is left of a part-paid cash sale", () => {
    const groups = receivableGroups(
      [
        sale({
          id: "o1",
          payments: [
            {
              id: "p1",
              method: "TUNAI",
              amount: 4_000_000,
              state: "SETTLED",
              at: "2026-09-10T00:00:00.000Z",
            },
            {
              id: "p2",
              method: "TUNAI",
              amount: 6_000_000,
              state: "DUE",
              at: "2026-09-10T00:00:00.000Z",
              dueAt: "2026-09-25T00:00:00.000Z",
            },
          ],
        }),
      ],
      [CUSTOMERS[0]!],
      "Walk-in",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      customerName: "Budi",
      owed: 6_000_000,
      nextDueAt: "2026-09-25T00:00:00.000Z",
    });
    expect(groups[0]!.rows[0]).toMatchObject({
      total: 10_000_000,
      received: 4_000_000,
      owed: 6_000_000,
    });
  });
  it("does NOT count money a marketplace is holding", () => {
    /*
     * The rule the whole screen turns on. The customer has paid Shopee in
     * full; the shop is waiting on a payout, which is a different table on a
     * different screen and is nobody's debt.
     */
    const groups = receivableGroups(
      [
        sale({
          id: "o1",
          source: "SHOPEE",
          payments: [
            {
              id: "p1",
              method: "MARKETPLACE",
              amount: 10_000_000,
              state: "PENDING",
              channel: "SHOPEE",
              at: "2026-09-10T00:00:00.000Z",
            },
          ],
        }),
      ],
      [CUSTOMERS[0]!],
      "Walk-in",
    );
    expect(groups).toEqual([]);
  });
  it("counts the cash half of a split with Shopee, and only that", () => {
    const groups = receivableGroups(
      [
        sale({
          id: "o1",
          source: "SHOPEE",
          payments: [
            {
              id: "p1",
              method: "MARKETPLACE",
              amount: 6_000_000,
              state: "PENDING",
              channel: "SHOPEE",
              at: "2026-09-10T00:00:00.000Z",
            },
            {
              id: "p2",
              method: "TUNAI",
              amount: 4_000_000,
              state: "DUE",
              at: "2026-09-10T00:00:00.000Z",
            },
          ],
        }),
      ],
      [CUSTOMERS[0]!],
      "Walk-in",
    );
    expect(groups[0]).toMatchObject({ owed: 4_000_000 });
  });
  it("puts every walk-in debt under one heading", () => {
    // There is nobody to telephone, and inventing a name would put a row on a
    // call list that resolves to no number.
    const groups = receivableGroups(
      [
        sale({ id: "o1", customerId: null }),
        sale({ id: "o2", customerId: null }),
      ],
      [],
      "Walk-in customers",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      customerId: "walk-in",
      customerName: "Walk-in customers",
      owed: 20_000_000,
    });
  });
  it("flags a customer whose promise date has passed, and sorts them first", () => {
    const now = Date.parse("2026-09-30T00:00:00.000Z");
    const groups = receivableGroups(
      [
        sale({
          id: "o1",
          customerId: "cus-1",
          total: 1_000_000,
          payments: [
            {
              id: "p1",
              method: "TUNAI",
              amount: 1_000_000,
              state: "DUE",
              at: "2026-09-10T00:00:00.000Z",
              dueAt: "2026-09-20T00:00:00.000Z",
            },
          ],
        }),
        sale({ id: "o2", customerId: "cus-3", total: 9_000_000 }),
      ],
      [...CUSTOMERS, { id: "cus-3", name: "Tono", phone: "" }],
      "Walk-in",
      now,
    );
    // Budi owes less and is overdue, so Budi is at the top: this is a call
    // list before it is a report.
    expect(groups.map((g) => [g.customerName, g.overdue])).toEqual([
      ["Budi", true],
      ["Tono", false],
      ["Sari", false],
    ]);
  });
  it("carries a customer's debt from before this app", () => {
    const groups = receivableGroups([], CUSTOMERS, "Walk-in");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ customerName: "Sari", owed: 2_000_000 });
    expect(groups[0]!.rows[0]!.opening).toBe(true);
  });
});
describe("totalOwed", () => {
  it("adds a list of groups up", () => {
    expect(totalOwed([{ owed: 3 }, { owed: 4 }])).toBe(7);
    expect(totalOwed([])).toBe(0);
  });
});
