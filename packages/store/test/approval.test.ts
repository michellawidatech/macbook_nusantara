/**
 * Which changesets need an approver (2026-11-13) — `approvalNeeded`, the one
 * rule the API's commit gate and the browser both read. Rows are written in
 * wire form, as `/api/store/commit` receives them.
 */
import { describe, expect, it } from "vitest";
import { approvalNeeded, type Changeset } from "../src/index.js";

type Wire = Record<string, unknown>;

const edit = (collection: string, base: Wire, next: Wire): Changeset =>
  ({
    collections: {
      [collection]: { rows: [{ key: String(base["id"]), base, next }] },
    },
    singletons: {},
  }) as unknown as Changeset;

const removal = (collection: string, base: Wire): Changeset =>
  ({
    collections: {
      [collection]: { rows: [{ key: String(base["id"]), base }] },
    },
    singletons: {},
  }) as unknown as Changeset;

const insert = (collection: string, next: Wire): Changeset =>
  ({
    collections: {
      [collection]: { rows: [{ key: String(next["id"]), next }] },
    },
    singletons: {},
  }) as unknown as Changeset;

const SALE: Wire = {
  id: "o-1",
  code: "SI-2026/11-000001",
  ts: "2026-11-10T03:00:00.000Z",
  customerId: "c-1",
  serials: ["C02AAA", "C02BBB"],
  prices: { C02AAA: "9000000", C02BBB: "7000000" },
  lines: [{ id: "ol-1", skuId: "sku-cable", qty: 2, price: "150000" }],
  discount: "0",
  source: "OFFLINE",
  payMethod: "TUNAI",
  settled: false,
  payments: [
    {
      id: "p-1",
      method: "TUNAI",
      amount: "10000000",
      state: "SETTLED",
      at: "2026-11-10T03:00:00.000Z",
    },
    {
      id: "p-2",
      method: "TUNAI",
      amount: "6300000",
      state: "DUE",
      at: "2026-11-10T03:00:00.000Z",
    },
  ],
  tradeIns: [{ id: "ti-1", label: "Old Air", value: "2000000" }],
  total: "16300000",
};

describe("a sale", () => {
  it("passes a new sale", () => {
    expect(approvalNeeded(insert("orders", SALE))).toBeUndefined();
  });

  it("needs an approver to remove one", () => {
    expect(approvalNeeded(removal("orders", SALE))).toMatchObject({
      reason: "SALE_REMOVED",
      key: "o-1",
    });
  });

  it.each([
    ["the date", { ts: "2026-11-09T03:00:00.000Z" }],
    ["the channel", { source: "SHOPEE" }],
    ["the customer", { customerId: "c-2" }],
    ["the discount", { discount: "50000" }],
    ["the charges", { fees: [{ id: "f-1", label: "Delivery", amount: "1" }] }],
    ["a unit's price", { prices: { C02AAA: "8500000", C02BBB: "7000000" } }],
    ["a unit taken off", { serials: ["C02AAA"] }],
    [
      "a counted line's quantity",
      { lines: [{ id: "ol-1", skuId: "sku-cable", qty: 1, price: "150000" }] },
    ],
    [
      "a counted line's price",
      { lines: [{ id: "ol-1", skuId: "sku-cable", qty: 2, price: "1" }] },
    ],
    ["a counted line removed", { lines: [] }],
    [
      "a trade-in's value",
      { tradeIns: [{ id: "ti-1", label: "Old Air", value: "1" }] },
    ],
    ["a trade-in removed", { tradeIns: [] }],
  ])("needs an approver to change %s", (_what, patch) => {
    expect(
      approvalNeeded(edit("orders", SALE, { ...SALE, ...patch })),
    ).toMatchObject({ reason: "SALE_EDITED" });
  });

  it("passes payments, refunds and return adjustments — a debt payment, a payout, a return", () => {
    const next: Wire = {
      ...SALE,
      settled: true,
      payments: [
        // A payout lands: PENDING → SETTLED, its reference corrected.
        { ...(SALE["payments"] as Wire[])[0], ref: "260912RGK2YKYU" },
        // The debt shrinks and a SETTLED payment records it.
        { ...(SALE["payments"] as Wire[])[1], amount: "300000" },
        {
          id: "p-3",
          method: "TRANSFER",
          amount: "6000000",
          state: "SETTLED",
          at: "2026-11-12T03:00:00.000Z",
        },
      ],
      refunds: [
        {
          id: "r-1",
          method: "TUNAI",
          amount: "500000",
          at: "2026-11-12T03:00:00.000Z",
        },
      ],
      adjustments: [
        {
          id: "a-1",
          type: "RETUR",
          amount: "7000000",
          reason: "x",
          at: "2026-11-12T03:00:00.000Z",
        },
      ],
      lines: [
        {
          id: "ol-1",
          skuId: "sku-cable",
          qty: 2,
          price: "150000",
          returnedQty: 1,
        },
      ],
      grossTotal: "16300000",
      netReceived: "16000000",
    };
    expect(approvalNeeded(edit("orders", SALE, next))).toBeUndefined();
  });

  it("passes units and lines ADDED by an exchange", () => {
    const next: Wire = {
      ...SALE,
      serials: [...(SALE["serials"] as string[]), "C02CCC"],
      prices: { ...(SALE["prices"] as Wire), C02CCC: "12000000" },
      listPrices: { C02CCC: "12500000" },
      lines: [
        ...(SALE["lines"] as Wire[]),
        { id: "ol-2", skuId: "sku-mouse", qty: 1, price: "200000" },
      ],
      total: "28500000",
    };
    expect(approvalNeeded(edit("orders", SALE, next))).toBeUndefined();
  });
});

const PO: Wire = {
  id: "po-1",
  code: "PI-2026/11-000001",
  supplierId: "sup-1",
  invoice: "INV-9",
  date: "2026-11-01",
  locationId: "wh-01",
  status: "RECEIVED",
  discount: "0",
  items: [
    // An older invoice written as a quantity, with a line discount.
    {
      id: "i-1",
      skuId: "sku-air",
      serial: null,
      qty: 3,
      unitCost: "5000000",
      discount: "300000",
    },
    {
      id: "i-2",
      skuId: "sku-pro",
      serial: "C02PRO",
      qty: 1,
      unitCost: "9000000",
    },
  ],
  fees: [
    { id: "f-1", kind: "SHIPPING", label: "", amount: "150000", inCogs: true },
  ],
  payments: [
    {
      id: "pp-1",
      method: "TRANSFER",
      amount: "5000000",
      at: "2026-11-02T03:00:00.000Z",
    },
    {
      id: "pp-2",
      method: "RETUR_SUPPLIER",
      amount: "9000000",
      at: "2026-11-03T03:00:00.000Z",
      returnId: "ret-1",
    },
    {
      id: "pp-3",
      method: "TRANSFER",
      amount: "1000000",
      at: "2026-11-03T03:00:00.000Z",
      fromDepositId: "dep-1",
    },
  ],
};

const items = (...xs: Wire[]) => ({ ...PO, items: xs });

describe("a purchase invoice", () => {
  it("passes a new invoice, and any edit of a draft", () => {
    expect(approvalNeeded(insert("pos", PO))).toBeUndefined();
    const draft = { ...PO, status: "DRAFT" };
    expect(
      approvalNeeded(
        edit("pos", draft, { ...draft, discount: "9", items: [] }),
      ),
    ).toBeUndefined();
    expect(approvalNeeded(removal("pos", draft))).toBeUndefined();
  });

  it("needs an approver to cancel one", () => {
    expect(approvalNeeded(removal("pos", PO))).toMatchObject({
      reason: "INVOICE_CANCELLED",
    });
  });

  it("passes the first touch: three pieces with new ids and the discount spread", () => {
    const next = items(
      {
        id: "i-1",
        skuId: "sku-air",
        serial: "C02A1",
        qty: 1,
        unitCost: "5000000",
        discount: "100000",
      },
      {
        id: "n-2",
        skuId: "sku-air",
        serial: null,
        qty: 1,
        unitCost: "5000000",
        discount: "100000",
      },
      {
        id: "n-3",
        skuId: "sku-air",
        serial: null,
        qty: 1,
        unitCost: "5000000",
        discount: "100000",
        notReceived: true,
      },
      (PO["items"] as Wire[])[1]!,
    );
    expect(approvalNeeded(edit("pos", PO, next))).toBeUndefined();
  });

  it("passes more pieces at a price, a product corrected, and a new line priced", () => {
    const next = items(
      {
        id: "i-1",
        skuId: "sku-air-m2",
        serial: null,
        qty: 4,
        unitCost: "5000000",
        discount: "300000",
      },
      (PO["items"] as Wire[])[1]!,
      {
        id: "i-9",
        skuId: "sku-mini",
        serial: null,
        qty: 1,
        unitCost: "4000000",
      },
    );
    expect(approvalNeeded(edit("pos", PO, next))).toBeUndefined();
    // A piece nobody priced yet — entering it, not correcting it.
    const unpriced = items(...(PO["items"] as Wire[]), {
      id: "i-9",
      skuId: "sku-mini",
      serial: null,
      qty: 1,
      unitCost: "0",
    });
    expect(
      approvalNeeded(
        edit(
          "pos",
          unpriced,
          items(...(PO["items"] as Wire[]), {
            id: "i-9",
            skuId: "sku-mini",
            serial: null,
            qty: 1,
            unitCost: "4000000",
          }),
        ),
      ),
    ).toBeUndefined();
    expect(
      approvalNeeded(edit("pos", unpriced, items(...(PO["items"] as Wire[])))),
    ).toBeUndefined();
  });

  it.each([
    [
      "a unit price",
      items(
        { ...(PO["items"] as Wire[])[0], unitCost: "4900000" },
        (PO["items"] as Wire[])[1]!,
      ),
    ],
    [
      "a line discount",
      items(
        { ...(PO["items"] as Wire[])[0], discount: "0" },
        (PO["items"] as Wire[])[1]!,
      ),
    ],
    [
      "fewer pieces",
      items(
        { ...(PO["items"] as Wire[])[0], qty: 2 },
        (PO["items"] as Wire[])[1]!,
      ),
    ],
    ["a piece removed", items((PO["items"] as Wire[])[0]!)],
    ["the order discount", { ...PO, discount: "100000" }],
  ])("needs an approver to change %s", (_what, next) => {
    expect(approvalNeeded(edit("pos", PO, next))).toMatchObject({
      reason: "INVOICE_PRICES",
    });
  });

  it("needs an approver to change or remove an expense, not to add one or rename it", () => {
    const fee = (PO["fees"] as Wire[])[0]!;
    expect(
      approvalNeeded(
        edit("pos", PO, { ...PO, fees: [{ ...fee, amount: "1" }] }),
      ),
    ).toMatchObject({ reason: "INVOICE_EXPENSE" });
    expect(approvalNeeded(edit("pos", PO, { ...PO, fees: [] }))).toMatchObject({
      reason: "INVOICE_EXPENSE",
    });
    expect(
      approvalNeeded(
        edit("pos", PO, {
          ...PO,
          fees: [
            { ...fee, label: "Courier", inCogs: false },
            {
              id: "f-2",
              kind: "TAX",
              label: "",
              amount: "50000",
              inCogs: true,
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("needs an approver to change or remove a payment, not to add one", () => {
    const [p1, p2, p3] = PO["payments"] as Wire[];
    expect(
      approvalNeeded(
        edit("pos", PO, { ...PO, payments: [{ ...p1, amount: "1" }, p2, p3] }),
      ),
    ).toMatchObject({ reason: "INVOICE_PAYMENT" });
    expect(
      approvalNeeded(edit("pos", PO, { ...PO, payments: [p2, p3] })),
    ).toMatchObject({ reason: "INVOICE_PAYMENT" });
    expect(
      approvalNeeded(
        edit("pos", PO, {
          ...PO,
          payments: [
            p1,
            p2,
            p3,
            {
              id: "pp-9",
              method: "TUNAI",
              amount: "1",
              at: "2026-11-04T03:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("passes a supplier return's credit and a deposit's allocation", () => {
    const [p1, , p3] = PO["payments"] as Wire[];
    expect(
      approvalNeeded(
        edit("pos", PO, { ...PO, payments: [p1, { ...p3, amount: "500000" }] }),
      ),
    ).toBeUndefined();
  });
});

describe("Income & Expense", () => {
  const expense: Wire = {
    id: "e-1",
    kind: "OPERATIONAL",
    amount: "60200",
    date: "2026-11-10",
    method: "TUNAI",
  };
  const income: Wire = {
    id: "in-1",
    reason: "SALES",
    amount: "100000",
    date: "2026-11-10",
    method: "TUNAI",
  };

  it("passes a new adjustment", () => {
    expect(approvalNeeded(insert("expenses", expense))).toBeUndefined();
    expect(approvalNeeded(insert("incomes", income))).toBeUndefined();
  });

  it("needs an approver to edit or delete one", () => {
    expect(
      approvalNeeded(edit("expenses", expense, { ...expense, amount: "1" })),
    ).toMatchObject({ reason: "ADJUSTMENT_EDITED", collection: "expenses" });
    expect(approvalNeeded(removal("expenses", expense))).toMatchObject({
      reason: "ADJUSTMENT_EDITED",
    });
    expect(
      approvalNeeded(edit("incomes", income, { ...income, note: "x" })),
    ).toMatchObject({ reason: "ADJUSTMENT_EDITED", collection: "incomes" });
    expect(approvalNeeded(removal("incomes", income))).toMatchObject({
      reason: "ADJUSTMENT_EDITED",
    });
  });

  it("passes the expense a service charge owns", () => {
    const charge = { ...expense, kind: "UNIT", serviceFeeId: "fee-1" };
    expect(approvalNeeded(removal("expenses", charge))).toBeUndefined();
    expect(
      approvalNeeded(edit("expenses", charge, { ...charge, amount: "1" })),
    ).toBeUndefined();
  });
});

it("passes what it does not recognise, for the commit to refuse in its own words", () => {
  expect(approvalNeeded(null)).toBeUndefined();
  expect(approvalNeeded({ collections: "x" })).toBeUndefined();
  expect(
    approvalNeeded({ collections: { orders: { rows: [1, { key: 2 }] } } }),
  ).toBeUndefined();
});
