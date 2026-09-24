/**
 * `/inbound`, the list — owner brief 2026-09-19: Order | Supplier | Date |
 * Payment status | Total price | Total paid | actions, the unpaid amount under
 * a partly paid invoice, and *Add payment* / *Delete* on every row.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
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
