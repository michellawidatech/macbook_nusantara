/**
 * A long chat opens on its newest page and loads older messages on demand
 * (owner, 2026-11-23: "no need limit but you can do a lazy loading for the
 * oldest chat") — after a 210-message test chat lost its newest ten.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboxConversation,
  InboxMessage,
  InboxThread,
} from "../src/lib/inboxApi.js";

function thread(
  phone: string,
  name: string,
  over: Partial<InboxThread> = {},
): InboxThread {
  return {
    phone,
    name,
    displayName: name,
    channel: "WHATSAPP",
    lastText: "Halo",
    lastAt: "2026-11-16T01:00:00.000Z",
    lastReply: null,
    needsReply: false,
    pending: 0,
    autoReply: true,
    handoff: null,
    openActions: [],
    windowClosesAt: "2026-11-17T01:00:00.000Z",
    unread: 0,
    tags: { lead: false, reservation: false, escalation: false },
    leadScore: null,
    ...over,
  };
}

const ONE = thread("628100000009", "Long Chat");

const message = (n: number): InboxMessage => ({
  id: `m${n}`,
  waMessageId: `wamid.m${n}`,
  text: `pesan ${n}`,
  at: new Date(Date.UTC(2026, 10, 16, 1, 0, n)).toISOString(),
  direction: "IN",
  status: "DIJAWAB_AGEN",
  msgType: "text",
  handoff: null,
  reply: null,
});

/** 150 messages in the thread; the server returns the newest `limit`. */
const TOTAL = 150;
function conversationOf(phone: string, limit: number): InboxConversation {
  const first = Math.max(0, TOTAL - limit);
  return {
    phone,
    name: "Customer",
    channel: "WHATSAPP",
    windowClosesAt: "2026-11-17T01:00:00.000Z",
    hasOlder: first > 0,
    messages: Array.from({ length: TOTAL - first }, (_, i) =>
      message(first + i),
    ),
    summary: null,
    directive: null,
    handoff: null,
    autoReply: { enabled: true, by: null, at: null },
    customer: null,
    actions: [],
    profile: null,
    lead: { on: false, score: null, by: null },
    reservations: [],
  } as InboxConversation;
}

const getConversation = vi.fn(
  async (phone: string, _signal?: AbortSignal, limit = 60) =>
    conversationOf(phone, limit),
);

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: [ONE] }),
  getConversation: (phone: string, signal?: AbortSignal, limit?: number) =>
    getConversation(phone, signal, limit),
  markRead: async () => ({ ok: true as const }),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });
const WAIT = { timeout: 15_000 };

function Harness() {
  const [picked, setPicked] = useState<string | null>(ONE.phone);
  return <ChatInbox picked={picked} onPick={setPicked} />;
}

beforeEach(() => getConversation.mockClear());

describe("a long chat", () => {
  it("opens on the newest page, and the top row loads the page before it", async () => {
    render(
      <AntdApp>
        <Harness />
      </AntdApp>,
    );
    const log = await screen.findByRole("log", { name: "Messages" }, WAIT);
    await within(log).findByText("pesan 149", {}, WAIT);
    expect(within(log).getByText("pesan 90")).toBeTruthy();
    expect(within(log).queryByText("pesan 89")).toBeNull();
    expect(getConversation).toHaveBeenCalledWith(
      ONE.phone,
      expect.anything(),
      60,
    );

    await userEvent.click(
      within(log).getByRole("button", { name: /Load older messages/ }),
    );
    await within(log).findByText("pesan 30", {}, WAIT);
    expect(within(log).queryByText("pesan 29")).toBeNull();
    // The newest are still there: an older page is added, never swapped in.
    expect(within(log).getByText("pesan 149")).toBeTruthy();

    await userEvent.click(
      within(log).getByRole("button", { name: /Load older messages/ }),
    );
    await within(log).findByText("pesan 0", {}, WAIT);
    // The start of the thread: nothing older to offer.
    await waitFor(
      () =>
        expect(
          within(log).queryByRole("button", { name: /Load older messages/ }),
        ).toBeNull(),
      WAIT,
    );
  });
});
