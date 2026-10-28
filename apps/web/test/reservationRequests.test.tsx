/**
 * The bot's reservation requests (owner, 2026-10-27): the Requests tab on
 * /reservations, its Approve and Reject dialogs, the nav badge and the strip
 * in /chat. The requests are seeded into the demo store; the two decisions
 * are the API's (`approveRequest` / `rejectRequest`), stubbed here so the
 * test reads what the dialog SENDS — the server's own test proves what it
 * then writes.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation, InboxThread } from "../src/lib/inboxApi.js";
import { getDb, mutate } from "../src/mock/store.js";
import { softHolds } from "../src/lib/reservations.js";

vi.setConfig({ testTimeout: 90_000 });

const approveRequest = vi.fn(async (_id: string, _body: unknown) => ({
  told: true,
  windowClosed: false,
  reservation: { id: "r-new", code: "RV-2026/10-000999" },
  heldUntil: null,
}));
const rejectRequest = vi.fn(async (_id: string, _body: unknown) => ({
  told: true,
  windowClosed: false,
}));
vi.mock("../src/lib/reservationRequests.js", async (original) => ({
  ...(await original<typeof import("../src/lib/reservationRequests.js")>()),
  approveRequest: (id: string, body: unknown) => approveRequest(id, body),
  rejectRequest: (id: string, body: unknown) => rejectRequest(id, body),
}));

const PHONE = "628980097001";
const conversation: InboxConversation = {
  phone: PHONE,
  name: "Budi",
  channel: "WHATSAPP",
  windowClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
  messages: [
    {
      id: "m1",
      waMessageId: "wamid.1",
      text: "tolong di keep ya kak",
      at: new Date().toISOString(),
      direction: "IN",
      status: "DIJAWAB_AGEN",
      msgType: "text",
      handoff: null,
      reply: null,
    },
  ],
  summary: null,
  directive: null,
  handoff: null,
  autoReply: { enabled: true, by: null, at: null },
  customer: null,
  actions: [],
  profile: null,
  lead: { on: false, score: null, by: null },
  reservations: [],
  sent: [],
} as unknown as InboxConversation;
const thread = {
  phone: PHONE,
  name: "Budi",
  displayName: "Budi",
  channel: "WHATSAPP",
  lastText: "tolong di keep ya kak",
  lastAt: new Date().toISOString(),
  lastReply: null,
  needsReply: false,
  pending: 0,
  autoReply: true,
  handoff: null,
  openActions: [],
  windowClosesAt: null,
  unread: 0,
  tags: { lead: false, reservation: false, escalation: false },
  leadScore: null,
} as unknown as InboxThread;
vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: [thread] }),
  getConversation: async () => conversation,
  markRead: async () => ({ ok: true as const }),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
}));

const { ReservationsPage } =
  await import("../src/routes/reservations/ReservationsPage.js");
const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");
const { NavBadge } = await import("../src/layouts/NavBadge.js");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let serial = "";

/** A unit on sale that no hold claims — what a request would name. */
function freeUnit(): string {
  const db = getDb();
  const held = softHolds(db);
  return db.units.find((u) => u.status === "TERSEDIA" && !held.has(u.serial))!
    .serial;
}

beforeEach(async () => {
  approveRequest.mockClear();
  rejectRequest.mockClear();
  serial = freeUnit();
  const now = Date.now();
  await mutate((d) => {
    d.reservationRequests = [
      {
        id: "req-new",
        phone: "628980097002",
        custName: "Sari",
        when: new Date(now + DAY).toISOString(),
        createdAt: new Date(now - HOUR).toISOString(),
        expiresAt: new Date(now + 2 * DAY).toISOString(),
        replaced: false,
        items: [],
        dpProofAt: new Date(now - 30 * 60_000).toISOString(),
      },
      {
        id: "req-old",
        phone: PHONE,
        custName: "Budi",
        when: new Date(now + DAY).toISOString(),
        createdAt: new Date(now - 5 * HOUR).toISOString(),
        expiresAt: new Date(now + 2 * DAY).toISOString(),
        replaced: false,
        items: [{ id: "i1", serial }],
      },
      {
        id: "req-lapsed",
        phone: "628980097003",
        custName: "Tono",
        when: new Date(now - DAY).toISOString(),
        createdAt: new Date(now - 4 * DAY).toISOString(),
        expiresAt: new Date(now - DAY).toISOString(),
        replaced: false,
        items: [],
      },
      {
        id: "req-replaced",
        phone: PHONE,
        custName: "Budi",
        when: new Date(now + DAY).toISOString(),
        createdAt: new Date(now - 6 * HOUR).toISOString(),
        expiresAt: new Date(now + 2 * DAY).toISOString(),
        cancelledAt: new Date(now - 5 * HOUR).toISOString(),
        replaced: true,
        items: [],
      },
    ];
  });
});

const drawPage = () =>
  render(
    <AntdApp>
      <MemoryRouter initialEntries={["/reservations"]}>
        <Routes>
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/chat" element={<div>the chat page</div>} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );

async function openRequests(user: ReturnType<typeof userEvent.setup>) {
  drawPage();
  await user.click(await screen.findByRole("tab", { name: /Requests/ }));
}

describe("the Requests tab", () => {
  it("counts what waits, and lists the oldest pending first and the lapsed last", async () => {
    const user = userEvent.setup();
    drawPage();
    const tab = await screen.findByRole("tab", { name: /Requests/ });
    expect(within(tab).getByText("2")).toBeInTheDocument();
    await user.click(tab);
    // The visible tab panel: the Reservations tab stays mounted, hidden.
    const panel = screen.getByRole("tabpanel");
    const text = panel.textContent ?? "";
    const budi = text.indexOf("Budi");
    const sari = text.indexOf("Sari");
    const tono = text.indexOf("Tono");
    expect(budi).toBeGreaterThan(-1);
    expect(budi).toBeLessThan(sari);
    expect(sari).toBeLessThan(tono);
    const inPanel = within(panel);
    expect(inPanel.getByText("Waiting for DP")).toBeInTheDocument();
    expect(inPanel.getByText("DP proof sent")).toBeInTheDocument();
    expect(inPanel.getByText("Expired")).toBeInTheDocument();
    // The request a newer one replaced is not listed twice.
    expect(inPanel.getAllByText("Budi")).toHaveLength(1);
    // Two pending rows can be decided; the lapsed one only opened.
    expect(inPanel.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
    expect(inPanel.getAllByRole("button", { name: /Open chat/ })).toHaveLength(
      3,
    );
  });

  it("approves without a DP: the units it asked for, its time, and the line the customer gets", async () => {
    const user = userEvent.setup();
    await openRequests(user);
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve reservation — Budi");
    expect(dialog).toHaveTextContent(serial);
    // The owner's template (2026-10-28), with the name and where the shop is.
    expect(within(dialog).getByTestId("request-preview")).toHaveTextContent(
      /^Okeyy kak noted, kak Budi nanti akan kita siapkan .+ nya yaa untuk .+\. Toko kita ada di Ruko Sorrento Place/,
    );
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveRequest).toHaveBeenCalledTimes(1));
    const [id, body] = approveRequest.mock.calls[0]!;
    expect(id).toBe("req-old");
    expect(body).toMatchObject({ serials: [serial], dp: null, tell: true });
  });

  it("approves with the DP received: the rule's amount, the method and the hold in the message", async () => {
    const user = userEvent.setup();
    await openRequests(user);
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "DP received" }),
    );
    // The template is the whole message: no DP line (owner, 2026-10-28).
    expect(within(dialog).getByTestId("request-preview")).not.toHaveTextContent(
      "DP",
    );
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveRequest).toHaveBeenCalledTimes(1));
    expect(approveRequest.mock.calls[0]![1]).toMatchObject({
      dp: { amount: "500000", method: "TRANSFER" },
    });
  });

  it("rejects only with a reason, and shows the customer's line with it", async () => {
    const user = userEvent.setup();
    await openRequests(user);
    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(
      await within(dialog).findByText("Say why, in a few words."),
    ).toBeInTheDocument();
    expect(rejectRequest).not.toHaveBeenCalled();
    await user.type(
      within(dialog).getByRole("textbox"),
      "Unitnya sudah terjual.",
    );
    expect(within(dialog).getByTestId("request-preview")).toHaveTextContent(
      "Maaf kak, untuk reservasinya belum bisa kami proses ya 🙏 Unitnya sudah terjual.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(rejectRequest).toHaveBeenCalledTimes(1));
    expect(rejectRequest.mock.calls[0]).toEqual([
      "req-old",
      { reason: "Unitnya sudah terjual.", tell: true },
    ]);
  });

  it("opens the chat the request came from", async () => {
    const user = userEvent.setup();
    await openRequests(user);
    await user.click(screen.getAllByRole("button", { name: /Open chat/ })[0]!);
    expect(await screen.findByText("the chat page")).toBeInTheDocument();
  });
});

describe("the nav leaf", () => {
  it("carries the count of requests waiting on a person", () => {
    render(<NavBadge kind="reservationRequests" />);
    const badge = document.querySelector(
      '[data-nav-badge="reservationRequests"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("2");
  });
});

describe("the strip in /chat", () => {
  it("shows the thread's waiting request with the same Approve and Reject", async () => {
    const user = userEvent.setup();
    render(
      <AntdApp>
        <MemoryRouter>
          <ChatInbox picked={PHONE} onPick={() => undefined} />
        </MemoryRouter>
      </AntdApp>,
    );
    const strip = await screen.findByTestId("request-strip");
    expect(strip).toHaveTextContent("Reservation request");
    expect(strip).toHaveTextContent("Waiting for DP");
    await user.click(within(strip).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve reservation — Budi");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveRequest).toHaveBeenCalledTimes(1));
    expect(approveRequest.mock.calls[0]![0]).toBe("req-old");
  });
});
