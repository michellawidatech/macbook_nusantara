/**
 * Edit and delete approvals in the browser (2026-11-13): a person who cannot
 * approve gets *Request edit* / *Request delete* where an approver gets Edit
 * and Delete; the request is the normal dialog, whose Save reads *Send
 * request* and asks why; and what it sends is the changeset the edit WOULD
 * commit, while the store on screen does not move.
 *
 * The API is stubbed (`lib/changeRequestsApi.js`) so the test reads what the
 * dialog SENDS; apps/api's own test proves what Approve then commits. Each
 * sent changeset is put to `approvalNeeded` — the server's rule — to show it
 * is exactly the change an approver is needed for.
 */
import { App as AntdApp } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalNeeded } from "@nusantara/store";
import { TransactionsPage } from "../src/routes/finance/TransactionsPage.js";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { CanApproveContext } from "../src/hooks/useCanApprove.js";
import { getDb, mutate, proposeChange } from "../src/mock/store.js";
import type { NewChangeRequest } from "../src/lib/changeRequestsApi.js";
import type { Order } from "../src/mock/seed.js";
import { pressPageAction } from "./pageActions.js";
import { saleDeletionBlock } from "../src/lib/saleDeletion.js";

vi.setConfig({ testTimeout: 90_000 });

const sent = vi.hoisted(() => ({ requests: [] as NewChangeRequest[] }));

vi.mock("../src/lib/changeRequestsApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/changeRequestsApi.js")>()),
  listChangeRequests: async () => [],
  createChangeRequest: async (body: NewChangeRequest) => {
    sent.requests.push(body);
    return {
      id: `cr-${sent.requests.length}`,
      code: "CR-2026/11-000001",
      kind: body.kind,
      status: "PENDING",
      target: {
        orderId: body.target.orderId ?? null,
        purchaseOrderId: body.target.purchaseOrderId ?? null,
        expenseId: body.target.expenseId ?? null,
        manualIncomeId: body.target.manualIncomeId ?? null,
      },
      label: body.label,
      summary: body.summary,
      note: body.note,
      requestedBy: { id: "s1", name: "Kasir" },
      requestedAt: new Date().toISOString(),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    };
  },
}));

function desktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: /min-width/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

function shell(children: ReactNode, canApprove: boolean, path = "/") {
  return render(
    <AntdApp>
      <CanApproveContext.Provider value={canApprove}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </CanApproveContext.Provider>
    </AntdApp>,
  );
}

const SALE = "o-cr-1";
const CODE = "SI-2026/11-990001";

function addSale(): Order {
  const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
  const sale: Order = {
    id: SALE,
    code: CODE,
    // The newest sale, so it is the first row of the list.
    ts: new Date(Date.now() + 60_000).toISOString(),
    customerId: null,
    serials: [serial],
    prices: { [serial]: 2_000_000 },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    settled: true,
    payments: [
      {
        id: "pay-cr-1",
        method: "TUNAI",
        amount: 2_000_000,
        state: "SETTLED",
        at: new Date().toISOString(),
      },
    ],
    total: 2_000_000,
  };
  mutate((d) => {
    d.orders.unshift(sale);
  });
  return sale;
}

beforeEach(() => {
  sent.requests.length = 0;
  mutate((d) => {
    d.orders = d.orders.filter((o) => o.id !== SALE);
    d.expenses = d.expenses.filter((e) => e.id !== "e-cr-1");
  });
});

/**
 * A dialog by its title. Not `findByRole("dialog", { name })`: antd's ids
 * under the test runner leave some modals' accessible name unresolved.
 */
async function dialogTitled(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, {
    selector: ".ant-modal-title, .ant-modal-title *",
  });
  return heading.closest<HTMLElement>('[role="dialog"]')!;
}

/** Open the ⋯ on a row and press one of its entries. */
async function requestFromMenu(what: RegExp, entry: string) {
  const menu = (await screen.findAllByRole("button", { name: what }))[0]!;
  fireEvent.click(menu);
  fireEvent.click(await screen.findByText(entry));
}

describe("Transaction History", () => {
  it("gives an approver Edit and Delete, as before", async () => {
    addSale();
    shell(<TransactionsPage />, true);
    expect(
      (await screen.findAllByRole("button", { name: `Edit ${CODE}` })).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", {
        name: `Ask an approver about ${CODE}`,
      }),
    ).toBeNull();
  });

  it("asks to delete a sale, with why, and leaves it where it is", async () => {
    // A seed sale Delete would take — the newest one nothing stands on.
    const target = [...getDb().orders]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .find((o) => saleDeletionBlock(getDb(), o) === undefined)!;
    shell(<TransactionsPage />, false);
    expect(
      screen.queryByRole("button", { name: `Delete ${target.code}` }),
    ).toBeNull();
    await requestFromMenu(
      new RegExp(`Ask an approver about ${target.code}`),
      "Request delete",
    );
    const dialog = await dialogTitled(`Ask to delete ${target.code}`);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    expect(
      await within(dialog).findByText("Say why — the approver reads this."),
    ).toBeInTheDocument();
    expect(sent.requests).toHaveLength(0);

    await userEvent.type(
      within(dialog).getByLabelText("Why this change is needed"),
      "Rung up twice",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    await waitFor(() => expect(sent.requests).toHaveLength(1));
    const req = sent.requests[0]!;
    expect(req).toMatchObject({
      kind: "DELETE",
      target: { orderId: target.id },
      label: target.code,
      note: "Rung up twice",
    });
    expect(req.summary).toContain(target.code);
    expect(approvalNeeded(req.changeset)).toMatchObject({
      reason: "SALE_REMOVED",
      key: target.id,
    });
    // Nothing moved on screen: the approver's Approve is what deletes it.
    expect(getDb().orders.some((o) => o.id === target.id)).toBe(true);
  });

  it("asks to edit a sale through the same dialog, whose Save is Send request", async () => {
    const sale = addSale();
    desktop();
    shell(<TransactionsPage />, false);
    await requestFromMenu(
      new RegExp(`Ask an approver about ${CODE}`),
      "Request edit",
    );
    const dialog = await dialogTitled(`Edit transaction — ${CODE}`);
    const price = within(dialog).getAllByLabelText("Price")[0]!;
    await userEvent.clear(price);
    await userEvent.type(price, "1800000");
    fireEvent.blur(price);
    await userEvent.type(
      within(dialog).getByLabelText("Why this change is needed"),
      "Agreed 1.8jt at the counter",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    await waitFor(() => expect(sent.requests).toHaveLength(1));
    const req = sent.requests[0]!;
    expect(req).toMatchObject({ kind: "EDIT", target: { orderId: SALE } });
    expect(req.summary).toMatch(/Price of .*1\.800\.000/);
    expect(approvalNeeded(req.changeset)).toMatchObject({
      reason: "SALE_EDITED",
    });
    expect(getDb().orders.find((o) => o.id === SALE)!.prices).toEqual(
      sale.prices,
    );
  });
});

describe("Income & Expense", () => {
  it("asks to delete a typed adjustment", async () => {
    mutate((d) => {
      d.expenses.unshift({
        id: "e-cr-1",
        kind: "OPERATIONAL",
        amount: 60_200,
        date: new Date().toISOString().slice(0, 10),
        method: "TUNAI",
        note: "Bensin motor",
        createdAt: new Date().toISOString(),
      });
    });
    shell(<IncomeExpensePage />, false);
    await requestFromMenu(
      /Ask an approver about .*Bensin motor/,
      "Request delete",
    );
    const dialog = await dialogTitled("Ask to delete this adjustment");
    await userEvent.type(
      within(dialog).getByLabelText("Why this change is needed"),
      "Entered twice",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    await waitFor(() => expect(sent.requests).toHaveLength(1));
    expect(sent.requests[0]).toMatchObject({
      kind: "DELETE",
      target: { expenseId: "e-cr-1" },
    });
    expect(approvalNeeded(sent.requests[0]!.changeset)).toMatchObject({
      reason: "ADJUSTMENT_EDITED",
      collection: "expenses",
    });
    expect(getDb().expenses.some((e) => e.id === "e-cr-1")).toBe(true);
  });
});

describe("an inbound invoice's money", () => {
  const ORDER = "po-5";
  const renderOrder = (canApprove: boolean) => {
    desktop();
    return shell(
      <Routes>
        <Route path="/inbound/:poId" element={<InboundDetailPage />} />
      </Routes>,
      canApprove,
      `/inbound/${ORDER}`,
    );
  };

  it("keeps a priced line's price read-only for a non-approver, and asks instead", async () => {
    renderOrder(false);
    await screen.findByLabelText("Supplier");
    pressPageAction(/Edit invoice/);
    // QC and the facts open as usual …
    await waitFor(() =>
      expect(screen.getByLabelText("Supplier")).toBeEnabled(),
    );
    // … but the money on a priced line does not.
    expect(screen.queryAllByLabelText(/^Unit price of /)).toHaveLength(0);

    const before = structuredClone(getDb().pos.find((p) => p.id === ORDER)!);
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`Ask an approver about ${before.code}`),
      }),
    );
    fireEvent.click(await screen.findByText("Request edit"));
    const dialog = await dialogTitled(
      `Ask to change the money on ${before.code}`,
    );
    const cost = within(dialog).getAllByLabelText(/^Unit price of /)[0]!;
    await userEvent.clear(cost);
    await userEvent.type(cost, "3300000");
    await userEvent.type(
      within(dialog).getByLabelText("Why this change is needed"),
      "Supplier's credit note",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );
    await waitFor(() => expect(sent.requests).toHaveLength(1));
    const req = sent.requests[0]!;
    expect(req).toMatchObject({
      kind: "EDIT",
      target: { purchaseOrderId: ORDER },
    });
    expect(req.summary).toMatch(/3\.400\.000 → 1 × Rp\s?3\.300\.000/);
    expect(approvalNeeded(req.changeset)).toMatchObject({
      reason: "INVOICE_PRICES",
      key: ORDER,
    });
    expect(getDb().pos.find((p) => p.id === ORDER)!.items).toEqual(
      before.items,
    );
  });

  it("leaves an approver's boxes as they were", async () => {
    renderOrder(true);
    await screen.findByLabelText("Supplier");
    pressPageAction(/Edit invoice/);
    expect(
      (await screen.findAllByLabelText(/^Unit price of /)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Ask an approver about/ }),
    ).toBeNull();
  });
});

describe("proposeChange", () => {
  it("computes the change without making it, and nothing for no change", () => {
    const was = getDb();
    const change = proposeChange((d) => {
      d.expenses.unshift({
        id: "e-cr-propose",
        kind: "OPERATIONAL",
        amount: 1,
        date: "2026-11-13",
        method: "TUNAI",
      });
    });
    expect(change?.changeset.collections.expenses?.rows[0]).toMatchObject({
      key: "e-cr-propose",
      next: { amount: "1" },
    });
    expect(getDb()).toBe(was);
    expect(getDb().expenses.some((e) => e.id === "e-cr-propose")).toBe(false);
    expect(proposeChange(() => {})).toBeNull();
  });
});
