/**
 * `/inbound`, the list — owner brief 2026-09-19: Order | Supplier | Date |
 * Payment status | Total price | Total paid | actions, the unpaid amount under
 * a partly paid invoice, and *Add payment* / *Delete* on every row.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundPage } from "../src/routes/inbound/InboundPage.js";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

const ORDER = "po-5";

function renderList() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/inbound"]}>
        <Routes>
          <Route path="/inbound" element={<InboundPage />} />
          <Route path="/inbound/:poId" element={<InboundDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

const code = () => getDb().pos.find((p) => p.id === ORDER)!.code;

beforeEach(() => {
  // One invoice of Rp4.100.000 × 2, half of it paid, open for payments.
  mutate((d) => {
    const po = d.pos.find((p) => p.id === ORDER)!;
    delete po.closedAt;
    po.items = [
      {
        id: "poi-l1",
        skuId: "m-pro13-2016-v1",
        serial: null,
        qty: 1,
        unitCost: 4_100_000,
      },
      {
        id: "poi-l2",
        skuId: "m-pro13-2016-v1",
        serial: null,
        qty: 1,
        unitCost: 4_100_000,
      },
    ];
    po.fees = [];
    po.payments = [
      { id: "pp-l1", method: "TRANSFER", amount: 3_000_000, at: "x" },
    ];
    d.units = d.units.filter((u) => u.poId !== ORDER);
  });
});

describe("the Inbound list", () => {
  it("says what a partly paid invoice still owes, under its status", () => {
    renderList();
    // A table row on a desktop, a card on a phone — `test/setup.ts` makes
    // every test a phone unless it says otherwise.
    const row = screen
      .getByText(code())
      .closest("tr, .ant-card") as HTMLElement;
    expect(within(row).getByText("Partially paid")).toBeInTheDocument();
    expect(within(row).getByText("Rp 5.200.000 unpaid")).toBeInTheDocument();
    expect(within(row).getByText("Rp 8.200.000")).toBeInTheDocument();
    expect(within(row).getByText("Rp 3.000.000")).toBeInTheDocument();
  });

  it("opens the order with its payment dialog from Add payment", async () => {
    renderList();
    await userEvent.click(
      screen.getByRole("button", { name: `Add a payment to ${code()}` }),
    );
    expect(await screen.findByText("Record a payment")).toBeInTheDocument();
  });

  it("will not add a payment to a closed invoice", () => {
    mutate((d) => {
      d.pos.find((p) => p.id === ORDER)!.closedAt = "2026-09-19T00:00:00.000Z";
    });
    renderList();
    expect(
      screen.getByRole("button", { name: `Add a payment to ${code()}` }),
    ).toBeDisabled();
  });

  it("asks before deleting, from the row's own button", async () => {
    renderList();
    await userEvent.click(
      screen.getByRole("button", { name: `Delete ${code()}` }),
    );
    expect(await screen.findAllByText(`Delete ${code()}?`)).not.toHaveLength(0);
    // The row did not open the order behind the button.
    expect(screen.queryByText("Record a payment")).toBeNull();
  });
});

/**
 * Waiting for QC (owner ask 2026-10-26): every unit the bench still owes a
 * grade, across every invoice, above the list — search a product to find its
 * invoices, an invoice to find its units.
 */
describe("Waiting for QC", () => {
  const SERIAL = "C02QCWAIT01";
  const INVOICE = "INV-QCFIND-77";

  /** po-5 arrived: one line scanned and still in QC, one not scanned yet. */
  beforeEach(() => {
    mutate((d) => {
      const po = d.pos.find((p) => p.id === ORDER)!;
      po.status = "RECEIVED";
      po.invoice = INVOICE;
      delete po.noInvoice;
      po.items[0]!.serial = SERIAL;
      d.units.push({
        serial: SERIAL,
        skuId: "m-pro13-2016-v1",
        status: "QC",
        locationId: po.locationId,
        buy: 4_100_000,
        description: "",
        poId: ORDER,
      });
    });
  });

  const waitingCard = () =>
    screen
      .getByText(/^Waiting for QC \(\d+\)$/)
      .closest(".ant-card") as HTMLElement;

  /** The group row's button: one product of one invoice (2026-10-31). */
  const groupName = () => new RegExp(`^QC .* on ${code()}$`);

  it("lists one row per product of an invoice, with its Qty", () => {
    renderList();
    const card = waitingCard();
    // The unit in QC and the slot nobody has scanned are one product.
    const rows = within(card).getAllByRole("button", { name: groupName() });
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("2")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("1 no serial")).toBeInTheDocument();
    expect(within(card).getAllByText(INVOICE).length).toBeGreaterThan(0);
  });

  it("finds an invoice's units by the supplier's invoice number", async () => {
    renderList();
    const card = waitingCard();
    await userEvent.type(
      within(card).getByPlaceholderText(
        "Search product, SKU code, serial, order or invoice number",
      ),
      INVOICE,
    );
    expect(
      await within(card).findAllByRole("button", { name: groupName() }),
    ).toHaveLength(1);
    expect(
      within(card).queryAllByRole("button", { name: /^QC .* on / }),
    ).toHaveLength(1);
  });

  it("finds a unit by its serial, and opens its units for QC in place", async () => {
    renderList();
    const card = waitingCard();
    await userEvent.type(
      within(card).getByPlaceholderText(
        "Search product, SKU code, serial, order or invoice number",
      ),
      SERIAL,
    );
    await waitFor(() =>
      expect(
        within(card).queryAllByRole("button", { name: /^QC .* on / }),
      ).toHaveLength(1),
    );
    await userEvent.click(
      within(card).getByRole("button", { name: /^QC 2 × / }),
    );
    // The two units' popup, over the list — not the invoice page.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue(SERIAL)).toBeInTheDocument();
    // Both of the product's waiting units: the scanned one and the slot.
    expect(
      within(dialog).getByText("2 unit(s) · " + code()),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Waiting for QC/)).toBeInTheDocument();
  });

  it("counts each invoice's units to QC, and searches the invoice number", async () => {
    renderList();
    const list = screen
      .getByPlaceholderText("Search order, supplier or invoice number")
      .closest(".ant-card") as HTMLElement;
    await userEvent.type(
      within(list).getByPlaceholderText(
        "Search order, supplier or invoice number",
      ),
      INVOICE,
    );
    const rows = await within(list).findAllByRole("button", {
      name: /^Open PI-/,
    });
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("To QC")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("2")).toBeInTheDocument();
  });

  it("is not drawn when nothing waits", () => {
    mutate((d) => {
      d.units = d.units.filter((u) => u.status !== "QC" || u.poId === null);
      for (const po of d.pos) {
        if (po.status === "RECEIVED") po.status = "ORDERED";
      }
    });
    renderList();
    expect(screen.queryByText(/^Waiting for QC/)).toBeNull();
  });
});

/**
 * Inbound → Trade-in (owner ask 2026-10-31): the units bought across the
 * counter on a sale, which are on no invoice and never in Waiting for QC.
 */
describe("the Trade-in tab", () => {
  it("lists a unit a sale took in, with its QC and what the shop paid", async () => {
    mutate((d) => {
      d.units.push({
        serial: "C6YMFXL6QW",
        skuId: "m-pro13-2016-v1",
        status: "TERSEDIA",
        locationId: d.myWarehouseId,
        buy: 27_000_000,
        price: 30_000_000,
        grade: "A",
        description: "Fullset",
        poId: null,
      });
      d.orders.unshift({
        id: "o-tradein-tab",
        code: "SI-TRADEIN-TAB",
        ts: new Date().toISOString(),
        customerId: null,
        serials: [],
        prices: {},
        discount: 0,
        source: "OFFLINE",
        payMethod: "TRANSFER",
        payments: [],
        settled: true,
        tradeIns: [
          {
            id: "t-tab",
            label: "Pro 14",
            serial: "C6YMFXL6QW",
            value: 27_000_000,
            skuId: "m-pro13-2016-v1",
          },
        ],
        total: 0,
      });
    });
    renderList();
    await userEvent.click(
      screen.getByRole("tab", { name: /^Trade-in \(\d+\)$/ }),
    );
    const panel = await screen.findByRole("tabpanel");
    expect(
      await within(panel).findByText("SI-TRADEIN-TAB"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("C6YMFXL6QW")).toBeInTheDocument();
    expect(within(panel).getByText("Fullset")).toBeInTheDocument();
    expect(within(panel).getByText("Rp 27.000.000")).toBeInTheDocument();
    // Not an invoice, so not on the bench's list either.
    expect(
      screen.queryByText("C6YMFXL6QW", { selector: ".ant-card-head *" }),
    ).toBeNull();
  });
});
