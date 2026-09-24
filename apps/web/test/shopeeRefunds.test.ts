/**
 * Refunds in a Shopee file (owner, 2026-09-21: "make it able to detect excel
 * file … to see refunds"), read from the owner's own seller balance report —
 * its real rows are `REAL_ROWS` — and from the order export beside it.
 */
import { describe, expect, it } from "vitest";
import {
  balanceRefunds,
  isRefundLine,
  returnNamesOrder,
  saleOfRefund,
  scanShopeeRefunds,
} from "../src/lib/shopeeRefunds.js";
import { detectIncomeLayout, incomeLines } from "../src/lib/shopeeIncome.js";
import { readXlsx } from "../src/lib/xlsxRead.js";
import {
  DONE,
  IN,
  INCOME,
  REAL_ROWS,
  balanceReport,
  num,
  payoutRow,
} from "./shopeeBalanceFixture.js";
import { workbook } from "./xlsxFixture.js";

describe("the seller balance report", () => {
  it("finds the order the buyer was refunded, compensation and all", async () => {
    const scan = scanShopeeRefunds(await readXlsx(balanceReport(REAL_ROWS)));
    expect(scan.kind).toBe("BALANCE");
    expect(scan.orders).toBe(3);
    expect(scan.refunds).toEqual([
      {
        orderNo: "260912RGK2YKYU",
        // Its own payout first — the row that says "refunded" — although the
        // courier's compensation comes before it in the file.
        parts: [
          { label: INCOME, amount: -53_625, payout: true },
          {
            label: "Kompensasi Jasa Kirim",
            amount: 10_000_000,
            payout: false,
          },
        ],
        rows: [21, 22],
      },
    ]);
  });

  it("judges by the order's own payout, never by what it netted", async () => {
    const sheets = await readXlsx(balanceReport(REAL_ROWS));
    const lines = incomeLines(sheets[0]!, detectIncomeLayout(sheets)!);
    const refunded = lines.find((l) => l.orderNo === "260912RGK2YKYU")!;
    // Net +9.946.375 — a payout by any reading of the total.
    expect(refunded.payout).toBe(9_946_375);
    expect(isRefundLine(refunded)).toBe(true);
    expect(lines.filter(isRefundLine)).toHaveLength(1);
  });

  it("does not call a compensation on its own a refund", () => {
    expect(
      balanceRefunds([
        {
          orderNo: "260901COMPONLY",
          payout: 150_000,
          parts: [
            { label: "Kompensasi Jasa Kirim", amount: 150_000, payout: false },
          ],
          rows: [30],
        },
        {
          orderNo: "260901ZEROPAID",
          payout: 0,
          parts: [{ label: INCOME, amount: 0, payout: true }],
          rows: [31],
        },
      ]).map((r) => r.orderNo),
    ).toEqual(["260901ZEROPAID"]);
  });

  it("says so when nothing in the file was refunded", async () => {
    const scan = scanShopeeRefunds(
      await readXlsx(
        balanceReport([
          payoutRow("2026-09-19 01:55:24", "2609153FVWW6NY", "4796900.00", "1"),
          [
            "2026-09-19 02:00:00",
            INCOME,
            `${INCOME} #2609166VUDCU4M`,
            "2609166VUDCU4M",
            IN,
            num("6313750.00"),
            DONE,
            num("2"),
          ],
        ]),
      ),
    );
    expect(scan).toMatchObject({ kind: "BALANCE", orders: 2, refunds: [] });
  });
});

describe("the order export", () => {
  const exportOf = (rows: (string | number)[][]) =>
    workbook([
      {
        name: "orders",
        rows: [
          [
            "No. Pesanan",
            "Status Pesanan",
            "Status Pembatalan/ Pengembalian",
            "No. Resi",
            "Nama Produk",
            "Jumlah",
            "Returned quantity",
            "Total Pembayaran",
          ],
          ...rows,
        ],
      },
    ]);

  it("marks an approved return, or a returned quantity, and not a refusal", async () => {
    const scan = scanShopeeRefunds(
      await readXlsx(
        exportOf([
          [
            "260912RGK2YKYU",
            "Selesai",
            "Permintaan Disetujui",
            "SPXID1",
            "MacBook Air",
            "1",
            "1",
            10_725_000,
          ],
          ["2609166VUDCU4M", "Selesai", "", "SPXID2", "MacBook", "1", "0", 1],
          [
            "260913AAAA0001",
            "Selesai",
            "Permintaan Ditolak",
            "SPXID3",
            "Magic Mouse",
            "1",
            "0",
            1,
          ],
          // One order, two product rows: the second came back.
          ["260914BBBB0002", "Selesai", "", "SPXID4", "Mouse", "1", "0", 1],
          ["260914BBBB0002", "Selesai", "", "SPXID4", "Hub", "2", "1", 1],
        ]),
      ),
    );
    expect(scan.kind).toBe("ORDER_EXPORT");
    expect(scan.orders).toBe(4);
    expect(scan.refunds).toEqual([
      {
        orderNo: "260912RGK2YKYU",
        parts: [],
        status: "Permintaan Disetujui",
        returnedQty: 1,
        rows: [2],
      },
      { orderNo: "260914BBBB0002", parts: [], returnedQty: 1, rows: [5, 6] },
    ]);
  });

  it("is no Shopee file at all without an order number", async () => {
    const scan = scanShopeeRefunds(
      await readXlsx(
        workbook([
          {
            name: "x",
            rows: [
              ["Nama", "Harga"],
              ["Mouse", 1],
            ],
          },
        ]),
      ),
    );
    expect(scan).toEqual({ kind: "OTHER", refunds: [], orders: 0 });
  });
});

describe("the sale a refund is", () => {
  const order = (
    id: string,
    ts: string,
    extra: {
      payments?: { ref?: string }[];
      adjustments?: { type: string; reason: string }[];
    },
  ) => ({ id, ts, ...extra });

  it("is the sale whose payment carries the number, however it was typed", () => {
    const orders = [
      order("o1", "2026-09-10T00:00:00.000Z", { payments: [{}] }),
      order("o2", "2026-09-12T00:00:00.000Z", {
        payments: [{ ref: " 260912rgk2 ykyu" }],
      }),
    ];
    expect(saleOfRefund("260912RGK2YKYU", orders)).toMatchObject({
      order: { id: "o2" },
      via: "PAYMENT",
    });
  });

  it("is found through its return once the payment has gone", () => {
    const orders = [
      order("o1", "2026-09-12T00:00:00.000Z", {
        payments: [],
        adjustments: [
          {
            type: "RETUR",
            reason: "Returned SC02AA — Dead pixel (Shopee 260912RGK2YKYU)",
          },
        ],
      }),
    ];
    expect(saleOfRefund("260912RGK2YKYU", orders)).toMatchObject({
      order: { id: "o1" },
      via: "ADJUSTMENT",
    });
    expect(saleOfRefund("2609166BNSSUEK", orders)).toBeUndefined();
  });

  it("takes the older sale when an exchange left the number on two", () => {
    const orders = [
      order("o-new", "2026-09-15T00:00:00.000Z", {
        payments: [{ ref: "260912RGK2YKYU" }],
      }),
      order("o-old", "2026-09-12T00:00:00.000Z", {
        payments: [{ ref: "260912RGK2YKYU" }],
      }),
    ];
    expect(saleOfRefund("260912RGK2YKYU", orders)?.order.id).toBe("o-old");
  });

  it("knows a return is recorded while the payment still carries the number", () => {
    // Part of the order returned, or an exchange at the counter: units are
    // still out and Shopee is still holding money, so only the RETUR's own
    // words can say the refund is on the books.
    const sale = order("o1", "2026-09-12T00:00:00.000Z", {
      payments: [{ ref: "260912RGK2YKYU" }],
      adjustments: [
        {
          type: "RETUR",
          reason:
            "Returned SC02AA — Changed their mind (Shopee 260912RGK2YKYU)",
        },
      ],
    });
    expect(returnNamesOrder(sale, "260912rgk2ykyu")).toBe(true);
    expect(returnNamesOrder(sale, "2609166BNSSUEK")).toBe(false);
    expect(
      returnNamesOrder(
        order("o2", "2026-09-12T00:00:00.000Z", { adjustments: [] }),
        "260912RGK2YKYU",
      ),
    ).toBe(false);
  });
});
