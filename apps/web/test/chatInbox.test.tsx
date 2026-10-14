/**
 * The /chat inbox after the 2026-10-15 redesign: the thread list's markers and
 * unread count, opening a thread marks it read, and every bot reply is rated
 * 👍 / 👎 — the thumbs-down asking why before it posts.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation, InboxThread } from "../src/lib/inboxApi.js";

const PHONE = "628980092978";

const THREADS: InboxThread[] = [
  {
    phone: PHONE,
    name: "Michella",
    displayName: "Michella Arlene Wijaya R.",
    channel: "WHATSAPP",
    lastText: "Ok ok",
    lastAt: "2026-10-14T03:34:00.000Z",
    lastReply: null,
    needsReply: true,
    pending: 1,
    autoReply: true,
    handoff: null,
    openActions: [],
    windowClosesAt: "2026-10-16T03:34:00.000Z",
    unread: 3,
    tags: { lead: true, reservation: true, escalation: false },
    leadScore: 72,
  },
  {
    phone: "628111000888",
    name: null,
    displayName: null,
    channel: "WHATSAPP",
    lastText: "Halo",
    lastAt: "2026-10-14T02:00:00.000Z",
    lastReply: "Halo kak",
    needsReply: false,
    pending: 0,
    autoReply: true,
    handoff: null,
    openActions: [],
    windowClosesAt: "2026-10-15T02:00:00.000Z",
    unread: 0,
    tags: { lead: false, reservation: false, escalation: true },
    leadScore: null,
  },
];

const BOT_TEXT = "Ada kak, Air M2 8/256 siap 😊";

const CONVERSATION: InboxConversation = {
  phone: PHONE,
  name: "Michella",
  channel: "WHATSAPP",
  windowClosesAt: "2026-10-16T03:34:00.000Z",
  messages: [
    {
      id: "m1",
      waMessageId: "wamid.1",
      text: "Air M2 ada?",
      at: "2026-10-14T03:30:00.000Z",
      direction: "IN",
      status: "DIJAWAB_AGEN",
      msgType: "text",
      handoff: null,
      reply: {
        text: BOT_TEXT,
        byAgent: true,
        by: null,
        at: "2026-10-14T03:30:10.000Z",
        evaluation: null,
      },
    },
    {
      id: "m2",
      waMessageId: "wamid.2",
      text: "Harganya?",
      at: "2026-10-14T03:31:00.000Z",
      direction: "IN",
      status: "DIJAWAB_STAF",
      msgType: "text",
      handoff: null,
      reply: {
        text: "Rp 9.500.000 kak",
        byAgent: false,
        by: "Ersen",
        at: "2026-10-14T03:32:00.000Z",
        evaluation: null,
      },
    },
  ],
  summary: null,
  directive: null,
  handoff: null,
  autoReply: { enabled: true, by: null, at: null },
  customer: null,
  actions: [],
  profile: null,
  lead: { on: true, score: 72, by: "BOT" },
  reservations: [],
};

const markRead = vi.fn(async (_phone: string) => ({ ok: true as const }));
const createEvaluation = vi.fn(async (body: { rating: string }) => ({
  evaluation: { id: "e1", ...body },
}));

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: THREADS }),
  getConversation: async () => CONVERSATION,
  markRead: (phone: string) => markRead(phone),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
  createEvaluation: (body: { rating: string }) => createEvaluation(body),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });

/** antd's breakpoints answer "yes" up to 1200px: the three-column layout. */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1200,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

function Harness() {
  const [picked, setPicked] = useState<string | null>(null);
  return <ChatInbox picked={picked} onPick={setPicked} />;
}

function draw() {
  return render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );
}

beforeEach(() => {
  markRead.mockClear();
  createEvaluation.mockClear();
});

describe("recent chats", () => {
  it("marks each thread with its tags and unread count", async () => {
    draw();
    const row = await screen.findByRole("button", {
      name: "Michella Arlene Wijaya R.",
    });
    expect(row).toHaveTextContent(PHONE);
    expect(within(row).getByLabelText("Lead")).toBeInTheDocument();
    expect(within(row).getByLabelText("Has a reservation")).toBeInTheDocument();
    expect(within(row).queryByLabelText("Needs a person")).toBeNull();
    expect(within(row).getByLabelText("3 unread")).toHaveTextContent("3");

    // No name at all: the number stands in, and nothing unread is drawn.
    const other = screen.getByRole("button", { name: "628111000888" });
    expect(within(other).getByLabelText("Needs a person")).toBeInTheDocument();
    expect(within(other).queryByLabelText(/unread/)).toBeNull();
  });

  it("marks a thread read when it is opened", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(
      await screen.findByRole("button", { name: "Michella Arlene Wijaya R." }),
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(PHONE));
  });
});

describe("rating a bot reply", () => {
  async function openThread() {
    const user = userEvent.setup();
    draw();
    await user.click(
      await screen.findByRole("button", { name: "Michella Arlene Wijaya R." }),
    );
    const bubble = await screen.findByTestId("bot-bubble");
    return { user, bubble };
  }

  it("rates only the bot's replies, not a colleague's", async () => {
    await openThread();
    expect(screen.getAllByRole("button", { name: "Bad reply" })).toHaveLength(
      1,
    );
    expect(screen.getByText("Ersen")).toBeInTheDocument();
  });

  it("records a thumbs-up at once", async () => {
    const { user, bubble } = await openThread();
    await user.click(
      within(bubble).getByRole("button", { name: "Good reply" }),
    );
    await waitFor(() =>
      expect(createEvaluation).toHaveBeenCalledWith({
        messageId: "m1",
        rating: "GOOD",
      }),
    );
  });

  it("asks why on a thumbs-down, then posts the reason and the better answer", async () => {
    const { user, bubble } = await openThread();
    await user.click(within(bubble).getByRole("button", { name: "Bad reply" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("What was wrong with this reply?");

    const better = within(dialog).getByRole("textbox", {
      name: "Better answer (optional)",
    });
    // Prefilled with what the bot sent.
    expect(better).toHaveValue(BOT_TEXT);

    await user.click(within(dialog).getByRole("combobox", { name: "Reason" }));
    await user.click(await screen.findByTitle("Wrong fact"));
    await user.clear(better);
    await user.type(better, "Air M2 sudah terjual kak, ada Air M3");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "unit sold",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createEvaluation).toHaveBeenCalledWith({
        messageId: "m1",
        rating: "BAD",
        reason: "WRONG_FACT",
        note: "unit sold",
        corrected: "Air M2 sudah terjual kak, ada Air M3",
      }),
    );
  });

  it("will not post a thumbs-down without a reason", async () => {
    const { user, bubble } = await openThread();
    await user.click(within(bubble).getByRole("button", { name: "Bad reply" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("Pick a reason."),
    ).toBeInTheDocument();
    expect(createEvaluation).not.toHaveBeenCalled();
  });
});

describe("on a desktop", () => {
  it("draws the list, the conversation and the profile side by side", async () => {
    useDesktopViewport();
    draw();
    // Lands on the thread that is waiting, and reads it.
    expect(await screen.findByTestId("bot-bubble")).toHaveTextContent(BOT_TEXT);
    expect(
      screen.getByRole("button", { name: "Michella Arlene Wijaya R." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Customer profile")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Mark as a lead" }),
    ).toBeChecked();
    // No back arrow and no profile button: everything is already on screen.
    expect(
      screen.queryByRole("button", { name: "Back to chats" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(PHONE));
  });
});

describe("on a phone", () => {
  it("shows one column at a time, with the profile behind a button", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(
      await screen.findByRole("button", { name: "Michella Arlene Wijaya R." }),
    );
    await screen.findByTestId("bot-bubble");
    expect(
      screen.queryByRole("button", { name: "628111000888" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Customer profile" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Bot score 72");
    await user.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(
      await screen.findByRole("button", { name: "628111000888" }),
    ).toBeInTheDocument();
  });
});
