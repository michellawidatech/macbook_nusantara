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
  // The list tests read the All invoices tab; the tab tests clear this.
  localStorage.setItem("nusantara.draft.inbound.tab", JSON.stringify("ALL"));
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
 * The six tabs (owner revision 2026-11-04): Needs QC, Arrived not paid, All
 * and Closed list invoices; Back from service and Ready to accept list serials.
 * Needs QC is the default.
 */
describe("the Inbound tabs", () => {
  const SERIAL = "C02QCWAIT01";
  const INVOICE = "INV-QCFIND-77";

  /** po-5 arrived: one line scanned and still in QC, one not scanned yet. */
  beforeEach(() => {
    localStorage.clear();
    mutate((d) => {
      const po = d.pos.find((p) => p.id === ORDER)!;
      po.status = "RECEIVED";
      po.invoice = INVOICE;
      delete po.noInvoice;
      po.items[0]!.serial = SERIAL;
      d.units = d.units.filter((u) => u.serial !== SERIAL);
      d.events = d.events.filter((e) => e.serial !== SERIAL);
      d.services = d.services.filter((v) => v.serial !== SERIAL);
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

  const panel = () => screen.getByRole("tabpanel");

  it("opens on Needs QC, one row per invoice with its To QC count", async () => {
    renderList();
    expect(
      screen.getByRole("tab", { name: /^Needs QC \(\d+\)$/ }),
    ).toHaveAttribute("aria-selected", "true");
    const rows = within(panel()).getAllByRole("button", { name: /^Open PI-/ });
    const mine = rows.find((r) => within(r).queryByText(code()))!;
    expect(within(mine).getByText("2")).toBeInTheDocument();
  });

  it("opens an invoice's waiting units for QC in place", async () => {
    renderList();
    await userEvent.click(
      within(panel()).getByRole("button", {
        name: `QC the units of ${code()}`,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue(SERIAL)).toBeInTheDocument();
  });

  it("finds an invoice by the supplier's number", async () => {
    renderList();
    await userEvent.type(
      within(panel()).getByPlaceholderText(
        "Search order, supplier or invoice number",
      ),
      INVOICE,
    );
    expect(
      await within(panel()).findAllByRole("button", { name: /^Open PI-/ }),
    ).toHaveLength(1);
  });

  it("lists a complete unit on Ready to accept, and Accept all shelves it", async () => {
    mutate((d) => {
      const u = d.units.find((x) => x.serial === SERIAL)!;
      u.grade = "A";
      u.description = "Mulus";
    });
    renderList();
    await userEvent.click(
      screen.getByRole("tab", { name: /^Ready to accept/ }),
    );
    expect(within(panel()).getByText(SERIAL)).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: /Accept all \(1\)/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept them" }),
    );
    await waitFor(() =>
      expect(getDb().units.find((u) => u.serial === SERIAL)!.status).toBe(
        "TERSEDIA",
      ),
    );
  });

  it("lists a unit back from service with its charges, and takes one more", async () => {
    const at = "2026-11-03T03:00:00.000Z";
    mutate((d) => {
      d.services.push({
        id: "v-back",
        serial: SERIAL,
        fromLocationId: "wh-1",
        openedAt: "2026-11-01T03:00:00.000Z",
        closedAt: at,
        toLocationId: "wh-1",
        fees: [{ id: "f1", kind: "LABOUR", amount: 250_000, at, staff: "x" }],
        note: "Ganti keyboard",
        raisedBy: "QC",
        staff: "x",
      });
      d.events.push({
        serial: SERIAL,
        seq: 99,
        type: "DICATAT",
        at,
        toStatus: "QC",
      } as never);
    });
    renderList();
    await userEvent.click(
      screen.getByRole("tab", { name: /^Back from service/ }),
    );
    expect(within(panel()).getByText("Ganti keyboard")).toBeInTheDocument();
    await userEvent.click(
      within(panel()).getByRole("button", {
        name: `Add a charge to ${SERIAL}`,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Amount"), "50000");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record it" }),
    );
    await waitFor(() =>
      expect(
        getDb()
          .services.find((v) => v.id === "v-back")!
          .fees.map((f) => f.amount),
      ).toEqual([250_000, 50_000]),
    );
  });

  it("lists a closed invoice under Closed, and remembers the tab", async () => {
    mutate((d) => {
      d.pos.find((p) => p.id === ORDER)!.closedAt = "2026-11-02T00:00:00.000Z";
    });
    const { unmount } = renderList();
    await userEvent.click(screen.getByRole("tab", { name: /^Closed/ }));
    expect(within(panel()).getByText(code())).toBeInTheDocument();
    unmount();
    renderList();
    expect(screen.getByRole("tab", { name: /^Closed/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
