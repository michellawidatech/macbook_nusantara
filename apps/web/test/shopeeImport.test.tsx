/**
 * The Shopee upload on Pending Payment, driven with the seller balance report
 * (owner ask 2026-09-21: *"the user will upload this and then it will
 * automatically edit like how much will we receive … if there is
 * discrepancies that are not mentioned in the rule just add like Biaya
 * lainnya"*).
 *
 * What only the page can show: that the upload reaches the same writer a
 * hand-typed withdrawal does, that what lands is Shopee's own figure with
 * deduction lines closing on it, and that the unusual order is left for a
 * person rather than recorded behind their back.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceivablesPage } from "../src/routes/finance/ReceivablesPage.js";
import { settlementTotals } from "../src/lib/marketplace.js";
import { paymentsOf } from "../src/lib/salePayments.js";
import { getDb, mutate } from "../src/mock/store.js";
import { REAL_ROWS, balanceReport, payoutRow } from "./shopeeBalanceFixture.js";

vi.setConfig({ testTimeout: 90_000 });

/** Three Shopee sales waiting, carrying real order numbers from the report. */
const SALES = [
  // Paid 4.796.900: the rates explain 392.500 of what Shopee kept, and the
  // 110.600 left over is Biaya Lainnya.
  {
    id: "o-shp-1",
    code: "SI-SHP-001",
    amount: 5_300_000,
    ref: "2609153FVWW6NY",
  },
  // A return the courier compensated: −53.625 and Rp10.000.000.
  {
    id: "o-shp-2",
    code: "SI-SHP-002",
    amount: 10_725_000,
    ref: "260912RGK2YKYU",
  },
  // Paid exactly what the rates say — no leftover line at all.
  {
    id: "o-shp-3",
    code: "SI-SHP-003",
    amount: 6_800_000,
    ref: "2609166VUDCU4M",
  },
  // Waiting, and not in this file: Shopee has not released it yet.
  {
    id: "o-shp-4",
    code: "SI-SHP-004",
    amount: 7_000_000,
    ref: "2609200NOTYET1",
  },
] as const;

const REPORT = balanceReport([
  ...REAL_ROWS,
  payoutRow(
    "2026-09-19 01:55:24",
    "2609153FVWW6NY",
    "4796900.00",
    "28383294.00",
  ),
  payoutRow(
    "2026-09-19 03:22:34",
    "2609166VUDCU4M",
    "6313750.00",
    "34697044.00",
  ),
]);

beforeEach(() => {
  mutate((d) => {
    d.orders = d.orders.filter(
      (o) =>
        !SALES.some((s) => s.id === o.id) &&
        !paymentsOf(o).some(
          (p) => p.state === "PENDING" && (p.channel ?? o.source) === "SHOPEE",
        ),
    );
    d.settlements = [];
    d.settlementLog = [];
    for (const s of SALES) {
      d.orders.push({
        id: s.id,
        code: s.code,
        ts: "2026-09-15T03:00:00.000Z",
        customerId: null,
        serials: [],
        prices: {},
        discount: 0,
        source: "SHOPEE",
        payMethod: "MARKETPLACE",
        settled: false,
        payments: [
          {
            id: `pay-${s.id}`,
            method: "MARKETPLACE",
            amount: s.amount,
            state: "PENDING",
            channel: "SHOPEE",
            at: "2026-09-15T03:00:00.000Z",
            ref: s.ref,
          },
        ],
        total: s.amount,
      });
    }
  });
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

const uploadDialog = () =>
  screen
    .getAllByRole("dialog")
    .find((d) => within(d).queryByText("Upload a Shopee report") !== null)!;

async function upload() {
  render(
    <AntdApp>
      <MemoryRouter>
        <ReceivablesPage />
      </MemoryRouter>
    </AntdApp>,
  );
  await settle();
  await userEvent.click(
    screen.getByRole("button", { name: /Upload a Shopee report/ }),
  );
  await settle();
  const input =
    uploadDialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(
    input,
    new File(
      [REPORT],
      "my_balance_transaction_report.shopee.20260901_20260921.xlsx",
    ),
  );
  // The dialog's OWN header — "Reference number" is a column on the page
  // behind it too since 2026-09-23, so waiting on that would resolve before
  // the file had been read.
  await within(uploadDialog()).findAllByText("Order nominal");
  return uploadDialog();
}

const rowOf = (dialog: HTMLElement, code: string) =>
  within(dialog).getByText(code).closest("tr")!;

describe("uploading the seller balance report", () => {
  it("lists every waiting sale, the mismatches yellow and on top", async () => {
    // Owner revision 2026-09-21: "show all the transaction in the POS that are
    // pending from shopee … if it does not match, highlight it as yellow row
    // … surfaced at the top".
    const dialog = await upload();
    const rows = within(dialog)
      .getAllByRole("row")
      .filter((r) => r.querySelector("td") !== null);
    expect(
      rows.map((r) => within(r).getByText(/^SI-SHP-/).textContent),
    ).toEqual(["SI-SHP-001", "SI-SHP-002", "SI-SHP-003", "SI-SHP-004"]);
    expect(
      rows.map((r) => r.classList.contains("shopee-row-mismatch")),
    ).toEqual([true, true, false, false]);

    // Order nominal → receivable, the arrow carrying what Shopee kept, and
    // the leftover named under the receivable.
    const plain = rowOf(dialog, "SI-SHP-001");
    expect(within(plain).getByText("Rp 5.300.000")).toBeTruthy();
    expect(within(plain).getByText("−Rp 503.100")).toBeTruthy();
    expect(within(plain).getByText("Rp 4.796.900")).toBeTruthy();
    expect(within(plain).getByText("Biaya Lainnya Rp 110.600")).toBeTruthy();

    // The compensation is in the list, explained, and NOT ticked.
    const odd = rowOf(dialog, "SI-SHP-002");
    expect(within(odd).getByText("More than a plain payout")).toBeTruthy();
    expect(
      (within(odd).getByRole("checkbox") as HTMLInputElement).checked,
    ).toBe(false);

    // A sale the file does not mention is listed, dimmed, and cannot be ticked.
    const absent = rowOf(dialog, "SI-SHP-004");
    expect(absent.classList.contains("shopee-row-absent")).toBe(true);
    expect(within(absent).getByText("Not in this file")).toBeTruthy();
    expect(
      (within(absent).getByRole("checkbox") as HTMLInputElement).disabled,
    ).toBe(true);

    // The file's other rows are named, and none of them is recorded.
    expect(
      within(dialog).getByText(/Isi Ulang Saldo Iklan\/Koin Penjual ×2/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/2609166BNSSUEK/)).toBeTruthy();
  });

  it("opens the deduction behind the ⓘ, each line with its rate", async () => {
    const dialog = await upload();
    await userEvent.click(
      within(rowOf(dialog, "SI-SHP-001")).getByRole("button", {
        name: "Deduction detail for 2609153FVWW6NY",
      }),
    );
    const detail = await screen.findByText("Deduction detail");
    const pop = detail.closest(".ant-popover")! as HTMLElement;
    expect(within(pop).getByText("· 5.25%")).toBeTruthy();
    expect(within(pop).getByText("Rp 278.250")).toBeTruthy();
    expect(within(pop).getByText("Biaya Lainnya")).toBeTruthy();
    expect(within(pop).getByText("Rp 503.100")).toBeTruthy();
  });

  it("records Shopee's figure, with lines that close on it", async () => {
    const dialog = await upload();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record 2 payout(s)" }),
    );
    await settle();

    const written = getDb().settlements;
    expect(written.map((s) => s.orderId).sort()).toEqual([
      "o-shp-1",
      "o-shp-3",
    ]);
    const plain = written.find((s) => s.orderId === "o-shp-1")!;
    expect(plain.received).toBe(4_796_900);
    expect(plain.fees.map((f) => [f.label, f.amount])).toEqual([
      ["Biaya Administrasi", 278_250],
      ["Biaya Proses Pesanan", 1_250],
      ["Biaya Gratis Ongkir XTRA", 26_500],
      ["Biaya Promo XTRA", 60_000],
      ["Premi", 26_500],
      ["Biaya Lainnya", 110_600],
    ]);
    // The deductions dialog computes what landed from the lines, so they
    // must agree with Shopee's figure or the first correction rewrites it.
    expect(
      settlementTotals({ gross: plain.gross, fees: plain.fees }).expected,
    ).toBe(plain.received);
    expect(
      written.find((s) => s.orderId === "o-shp-3")!.fees.map((f) => f.label),
    ).not.toContain("Biaya Lainnya");

    // The payments moved; the compensated sale is still waiting.
    const state = (id: string) =>
      paymentsOf(getDb().orders.find((o) => o.id === id)!)[0]!.state;
    expect(state("o-shp-1")).toBe("SETTLED");
    expect(state("o-shp-2")).toBe("PENDING");
  });
});
