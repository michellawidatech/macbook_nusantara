/**
 * What a hand-over looks like on /chat since 2026-10-15 (owner: "do not
 * display [the pop-up], instead just highlight the unanswered chat (add a
 * shadow / outline, not a popup modal)"): no dialog and no task strip — the
 * message waiting on a person is outlined, with one caption saying why, and
 * Mark handled sits in the conversation header while something waits.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboxConversation,
  InboxMessage,
  InboxThread,
} from "../src/lib/inboxApi.js";

const PHONE = "628980093001";

const THREAD: InboxThread = {
  phone: PHONE,
  name: "Budi",
  displayName: "Budi",
  channel: "WHATSAPP",
  lastText: "budget maks 16jt, yg paling bagus apa?",
  lastAt: "2026-10-15T06:50:00.000Z",
  lastReply: null,
  needsReply: true,
  pending: 1,
  autoReply: true,
  handoff: null,
  openActions: [],
  windowClosesAt: "2026-10-16T06:50:00.000Z",
  unread: 0,
  tags: { lead: false, reservation: false, escalation: true },
  leadScore: null,
};

const answered: InboxMessage = {
  id: "m1",
  waMessageId: "wamid.1",
  text: "halo kak",
  at: "2026-10-15T06:40:00.000Z",
  direction: "IN",
  status: "DIJAWAB_AGEN",
  msgType: "text",
  handoff: null,
  reply: {
    text: "Halo kak 😊",
    byAgent: true,
    by: null,
    at: "2026-10-15T06:40:10.000Z",
    evaluation: null,
  },
};

const handedOver: InboxMessage = {
  id: "m2",
  waMessageId: "wamid.2",
  text: "budget maks 16jt, yg paling bagus apa?",
  at: "2026-10-15T06:50:00.000Z",
  direction: "IN",
  status: "PERLU_STAF",
  msgType: "text",
  handoff: {
    topic: "price",
    summary: "Balasan bot ditahan (AMOUNT_NOT_IN_SOURCE)",
    forcedBy: "AMOUNT_NOT_IN_SOURCE",
    at: "2026-10-15T06:50:20.000Z",
  },
  reply: {
    text: "Siap kak 😊 Admin kami segera balas di chat ini ya kak 🙏",
    byAgent: true,
    by: null,
    at: "2026-10-15T06:50:20.000Z",
    evaluation: null,
  },
};

const base: InboxConversation = {
  phone: PHONE,
  name: "Budi",
  channel: "WHATSAPP",
  windowClosesAt: "2026-10-16T06:50:00.000Z",
  messages: [answered, handedOver],
  summary: null,
  directive: null,
  handoff: handedOver.handoff,
  autoReply: { enabled: true, by: null, at: null },
  customer: null,
  actions: [],
  profile: null,
  lead: { on: false, score: null, by: null },
  reservations: [],
};

let conversation: InboxConversation = base;
const markHandled = vi.fn(async (_phone: string) => ({ closed: 1 }));

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: [THREAD] }),
  getConversation: async () => conversation,
  markRead: async () => ({ ok: true as const }),
  markHandled: (phone: string) => markHandled(phone),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: false, mode: "none" }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });

function Harness() {
  const [picked, setPicked] = useState<string | null>(PHONE);
  return <ChatInbox picked={picked} onPick={setPicked} />;
}

async function draw() {
  render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );
  await screen.findByText(handedOver.text!);
}

/** The bubble that holds a customer's words. */
const bubbleOf = (text: string) =>
  screen.getByText(text).closest("[style*='border-radius']") as HTMLElement;

beforeEach(() => {
  conversation = base;
  markHandled.mockClear();
});

describe("a chat the bot handed to a person", () => {
  it("opens no dialog", async () => {
    await draw();
    // Give any effect the chance it used to take.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Mark done")).toBeNull();
  });

  it("outlines the waiting message and says why, and only that one", async () => {
    await draw();
    const waiting = bubbleOf(handedOver.text!);
    expect(waiting).toHaveAttribute("data-waiting", "true");
    expect(waiting).toHaveTextContent("Needs your reply · Price");
    expect(waiting.style.outline).toContain("2px solid");
    expect(bubbleOf(answered.text!)).not.toHaveAttribute("data-waiting");
  });

  it("puts Mark handled in the header", async () => {
    const user = userEvent.setup();
    await draw();
    await user.click(screen.getByRole("button", { name: "Mark handled" }));
    await waitFor(() => expect(markHandled).toHaveBeenCalledWith(PHONE));
  });
});

describe("a chat nothing waits on", () => {
  it("outlines nothing and offers no Mark handled", async () => {
    conversation = {
      ...base,
      handoff: null,
      messages: [answered, { ...handedOver, status: "DIJAWAB_STAF" }],
    };
    await draw();
    expect(document.querySelector("[data-waiting]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark handled" })).toBeNull();
  });
});

describe("a new message", () => {
  const fresh: InboxMessage = {
    ...handedOver,
    status: "BARU",
    handoff: null,
    reply: null,
  };

  it("is not outlined while the bot is about to answer it", async () => {
    conversation = { ...base, handoff: null, messages: [answered, fresh] };
    await draw();
    expect(bubbleOf(fresh.text!)).not.toHaveAttribute("data-waiting");
  });

  it("is outlined when the bot is off for this chat", async () => {
    conversation = {
      ...base,
      handoff: null,
      autoReply: { enabled: false, by: "Ersen", at: null },
      messages: [answered, fresh],
    };
    await draw();
    const waiting = bubbleOf(fresh.text!);
    expect(waiting).toHaveAttribute("data-waiting", "true");
    expect(waiting).toHaveTextContent("Needs your reply");
  });
});
