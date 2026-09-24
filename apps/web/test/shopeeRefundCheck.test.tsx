/**
 * "Check a Shopee file" on Returns (owner, 2026-09-21: "make it able to detect
 * excel file … to see refunds"), driven with the owner's own seller balance
 * report rows. What only the page can show: each refunded order against its
 * sale, the one still out offering to record its return — which opens the
 * ordinary form on it — and nothing written until that form is saved.
 */
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerReturnPanel } from "../src/routes/returns/CustomerReturnPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { REAL_ROWS, balanceReport, payoutRow } from "./shopeeBalanceFixture.js";

vi.setConfig({ testTimeout: 90_000 });

const REFUNDED = "SRETSHOP0001";
const BACK = "SRETSHOP0002";
const SHOPEE_SALE = "o-shp-refund-1";
const SHOPEE_CODE = "SI-2026/09-990101";
const DONE_SALE = "o-shp-refund-2";
const DONE_CODE = "SI-2026/09-990102";

/** The owner's rows, plus a refund already returned and one no sale has. */
const REPORT = balanceReport([
  ...REAL_ROWS,
  payoutRow("2026-09-20 10:00:00", "260920RECORD01", "-12000.00", "1"),
  payoutRow("2026-09-20 11:00:00", "260920NOSALE01", "-5000.00", "2"),
]);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <AntdApp>
      <MemoryRouter>
        <CustomerReturnPanel
          addOpen={open}
          onCloseAdd={() => setOpen(false)}
          onOpenAdd={() => setOpen(true)}
        />
      </MemoryRouter>
    </AntdApp>
  );
}

beforeEach(() => {
  mutate((d) => {
    const base = d.units.find(
      (u) => u.status === "TERSEDIA" && ![REFUNDED, BACK].includes(u.serial),
    )!;
    d.units = d.units.filter((u) => ![REFUNDED, BACK].includes(u.serial));
    d.returns = d.returns.filter((r) => ![REFUNDED, BACK].includes(r.serial));
    d.units.push(
      { ...base, serial: REFUNDED, status: "TERJUAL", price: 10_725_000 },
      { ...base, serial: BACK, status: "TERSEDIA", price: 4_000_000 },
    );
    d.orders = d.orders.filter(
      (o) => o.id !== SHOPEE_SALE && o.id !== DONE_SALE,
    );
    // Waiting at Shopee, carrying the order number the buyer was refunded.
    d.orders.unshift({
      id: SHOPEE_SALE,
      code: SHOPEE_CODE,
      ts: "2026-09-12T03:00:00.000Z",
      customerId: null,
      serials: [REFUNDED],
      prices: { [REFUNDED]: 10_725_000 },
      discount: 0,
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: false,
      payments: [
        {
          id: "pay-shp-refund-1",
          method: "MARKETPLACE",
          amount: 10_725_000,
          state: "PENDING",
          channel: "SHOPEE",
          at: "2026-09-12T03:00:00.000Z",
          ref: "260912RGK2YKYU",
        },
      ],
      total: 10_725_000,
    });
    // Returned already: its payment is gone, and its return names the order.
    d.orders.unshift({
      id: DONE_SALE,
      code: DONE_CODE,
      ts: "2026-09-18T03:00:00.000Z",
      customerId: null,
      serials: [BACK],
      prices: { [BACK]: 4_000_000 },
      discount: 0,
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: true,
      payments: [],
      adjustments: [
        {
          id: "adj-shp-refund-2",
          type: "RETUR",
          code: "SG-2026/09-TESTREF",
          amount: 4_000_000,
          reason: `Returned ${BACK} — Dead pixel (Shopee 260920RECORD01)`,
          at: "2026-09-19T03:00:00.000Z",
        },
      ],
      total: 4_000_000,
    });
  });
});

const checkDialog = () =>
  screen
    .getAllByRole("dialog")
    .find((d) => within(d).queryByText("Refunds in a Shopee file") !== null)!;

async function openCheck() {
  await userEvent.click(
    screen.getByRole("button", { name: /Check a Shopee file/ }),
  );
  return checkDialog();
}

describe("checking a Shopee file for refunds", () => {
  it("lists each refund against its sale, and records nothing by itself", async () => {
    render(<Harness />);
    const dialog = await openCheck();
    await userEvent.upload(
      dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(
        [REPORT],
        "my_balance_transaction_report.shopee.20260901_20260921.xlsx",
      ),
    );
    await within(dialog).findByText("260912RGK2YKYU");

    // What the file says about it: refunded, and the courier compensated.
    // (The amount is its own element, so it never wraps apart from its sign.)
    expect(dialog).toHaveTextContent("Penghasilan dari Pesanan −Rp 53.625");
    expect(dialog).toHaveTextContent("Kompensasi Jasa Kirim +Rp 10.000.000");
    // The returned one says so; the unknown one says there is no sale.
    expect(within(dialog).getByText("Return recorded")).toBeInTheDocument();
    expect(
      within(dialog).getByText("No sale carries this order number"),
    ).toBeInTheDocument();
    // An order Shopee paid for is not a refund.
    expect(within(dialog).queryByText("2609166BNSSUEK")).toBeNull();
    // Reading the file wrote nothing.
    expect(getDb().returns.some((r) => r.serial === REFUNDED)).toBe(false);

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: `Record the return of ${SHOPEE_CODE}`,
      }),
    );
    // The ordinary form, on that sale, its unit ticked.
    expect(await screen.findByText("Record a return")).toBeInTheDocument();
    expect(screen.getByLabelText(`${REFUNDED} is coming back`)).toBeChecked();

    const reason = getDb().reasons.find(
      (r) => r.activity === "RETURN_CUSTOMER" && r.active,
    )!;
    const control = screen.getByLabelText("Reason");
    fireEvent.mouseDown(control);
    fireEvent.change(control, { target: { value: reason.label } });
    const option = await vi.waitFor(() => {
      const found = Array.from(
        document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
      ).find((el) => el.getAttribute("title") === reason.label);
      if (!found) throw new Error("no reason open");
      return found;
    });
    fireEvent.click(option);
    await userEvent.click(
      screen.getByRole("button", { name: "Record return" }),
    );

    const sale = getDb().orders.find((o) => o.id === SHOPEE_SALE)!;
    // What Shopee was holding is cancelled; the RETUR keeps its number.
    expect(sale.payments).toEqual([]);
    expect(sale.adjustments?.[0]?.reason).toContain("(Shopee 260912RGK2YKYU)");
    // Received on the way in since 2026-09-23 (owner ask): no separate step.
    expect(getDb().returns.find((r) => r.serial === REFUNDED)?.status).toBe(
      "ARRIVED",
    );

    // The file is still loaded when the dialog is opened again, and the
    // refund now reads as recorded — found through its return.
    const again = await openCheck();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(within(again).getAllByText("Return recorded")).toHaveLength(2);
    expect(
      within(again).queryByRole("button", {
        name: `Record the return of ${SHOPEE_CODE}`,
      }),
    ).toBeNull();
  });

  it("says so when the file is not one it can read", async () => {
    render(<Harness />);
    const dialog = await openCheck();
    await userEvent.upload(
      dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array([1, 2, 3, 4])], "not-really.xlsx"),
    );
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  });
});
