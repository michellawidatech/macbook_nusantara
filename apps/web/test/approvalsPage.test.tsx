/**
 * Financial & Report → Approvals (2026-11-13): *To approve* lists what is
 * pending and nothing else, *History* the decided ones; Approve and Reject
 * call the API, a STALE answer is said as such, and the page is the
 * approver's alone. The API is stubbed — apps/api's test proves the decision.
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
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsPage } from "../src/routes/finance/ApprovalsPage.js";
import { CanApproveContext } from "../src/hooks/useCanApprove.js";
import {
  __pollChangeRequestsInTests,
  refreshChangeRequests,
} from "../src/hooks/useChangeRequests.js";
import type { ChangeRequest } from "../src/lib/changeRequestsApi.js";

vi.setConfig({ testTimeout: 60_000 });

const request = (over: Partial<ChangeRequest>): ChangeRequest => ({
  id: "cr-1",
  code: "CR-2026/11-000001",
  kind: "EDIT",
  status: "PENDING",
  target: {
    orderId: "o-1",
    purchaseOrderId: null,
    expenseId: null,
    manualIncomeId: null,
  },
  label: "SI-2026/11-000012",
  summary: "Price of C02ABC: Rp 9.000.000 → Rp 8.500.000",
  note: "Agreed at the counter",
  requestedBy: { id: "s-kasir", name: "Rina" },
  requestedAt: "2026-11-13T02:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

const api = vi.hoisted(() => ({
  pending: [] as ChangeRequest[],
  history: [] as ChangeRequest[],
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("../src/lib/changeRequestsApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/changeRequestsApi.js")>()),
  listChangeRequests: async (status: "pending" | "history") =>
    status === "pending" ? api.pending : api.history,
  approveChangeRequest: (id: string) => api.approve(id),
  rejectChangeRequest: (id: string, reason?: string) => api.reject(id, reason),
}));

function renderPage(canApprove = true) {
  return render(
    <AntdApp>
      <CanApproveContext.Provider value={canApprove}>
        <MemoryRouter>
          <ApprovalsPage />
        </MemoryRouter>
      </CanApproveContext.Provider>
    </AntdApp>,
  );
}

beforeEach(async () => {
  __pollChangeRequestsInTests();
  api.pending = [request({})];
  api.history = [
    request({
      id: "cr-0",
      code: "CR-2026/11-000000",
      kind: "DELETE",
      status: "STALE",
      label: "Bensin — Rp 60.200",
      decidedBy: { id: "s-ersen", name: "Ersen" },
      decidedAt: "2026-11-12T09:00:00.000Z",
      decisionNote:
        "Catatan ini sudah berubah sejak permintaan dibuat — minta ulang.",
    }),
  ];
  api.approve.mockReset();
  api.reject.mockReset();
  await refreshChangeRequests();
});

describe("the approvals page", () => {
  it("lists only what is waiting, with who, what, why and the change", async () => {
    renderPage();
    expect(await screen.findByText("CR-2026/11-000001")).toBeInTheDocument();
    expect(screen.getByText("Rina")).toBeInTheDocument();
    expect(screen.getByText("SI-2026/11-000012")).toBeInTheDocument();
    expect(screen.getByText("Agreed at the counter")).toBeInTheDocument();
    expect(
      screen.getByText(/Rp 9\.000\.000 → Rp 8\.500\.000/),
    ).toBeInTheDocument();
    expect(screen.getByText("To approve (1)")).toBeInTheDocument();
    // The decided one is hidden until History is opened.
    expect(screen.queryByText("CR-2026/11-000000")).toBeNull();
  });

  it("approves, and says so when the change could no longer be applied", async () => {
    api.approve.mockImplementation(async (id: string) => {
      api.pending = [];
      return request({
        id,
        status: "STALE",
        decisionNote: "Catatan ini sudah berubah",
      });
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Approve CR-2026/11-000001" }),
    );
    const confirm = (
      await screen.findAllByText("Approve CR-2026/11-000001?")
    )[0]!.closest<HTMLElement>(".ant-modal-container")!;
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("cr-1"));
    expect(
      await screen.findByText(/was not applied: Catatan ini sudah berubah/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("CR-2026/11-000001")).toBeNull(),
    );
  });

  it("rejects with an optional reason", async () => {
    api.reject.mockImplementation(async (id: string) =>
      request({ id, status: "REJECTED" }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reject CR-2026/11-000001" }),
    );
    await userEvent.type(
      await screen.findByLabelText("Why it is rejected"),
      "The price stands",
    );
    const dialog = screen
      .getByText("Reject CR-2026/11-000001?")
      .closest<HTMLElement>(".ant-modal-container")!;
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(api.reject).toHaveBeenCalledWith("cr-1", "The price stands"),
    );
  });

  it("shows the decided ones on History, with the decision", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    expect(await screen.findByText("CR-2026/11-000000")).toBeInTheDocument();
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByText(/Ersen/)).toBeInTheDocument();
    expect(
      screen.getByText(/sudah berubah sejak permintaan/),
    ).toBeInTheDocument();
  });

  it("is the approver's alone", async () => {
    renderPage(false);
    expect(
      await screen.findByText("Approvals are for an approver"),
    ).toBeInTheDocument();
    expect(screen.queryByText("CR-2026/11-000001")).toBeNull();
  });
});
