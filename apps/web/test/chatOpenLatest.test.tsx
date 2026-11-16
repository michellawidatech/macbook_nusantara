/**
 * /chat opens on the newest request waiting for a person, and lands on it
 * (owner, 2026-11-16: "if the chat is escalated, it should automatically open
 * up to the latest request").
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Handoff,
  InboxConversation,
  InboxMessage,
  InboxThread,
} from "../src/lib/inboxApi.js";
import {
  newestWaitingThread,
  waitingForPersonAt,
} from "../src/lib/chatOpen.js";

const handoff = (at: string): Handoff => ({
  topic: "price",
  summary: null,
  forcedBy: null,
  at,
});

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

/** Newest activity, but the bot's to answer — not waiting for a person. */
const BUSY = thread("628100000001", "Busy Bot", {
  lastAt: "2026-11-16T09:00:00.000Z",
  needsReply: true,
  pending: 1,
});
/** Handed over first. */
const OLDER = thread("628100000002", "Older Handover", {
  lastAt: "2026-11-16T08:30:00.000Z",
  needsReply: true,
  pending: 1,
  handoff: handoff("2026-11-16T05:00:00.000Z"),
});
/** Handed over last — the one to open on. */
const NEWEST = thread("628100000003", "Newest Handover", {
  lastAt: "2026-11-16T07:00:00.000Z",
  needsReply: true,
  pending: 1,
  handoff: handoff("2026-11-16T07:00:00.000Z"),
});
/** Bot off, waiting since before NEWEST. */
const BOT_OFF = thread("628100000004", "Bot Off", {
  lastAt: "2026-11-16T06:00:00.000Z",
  needsReply: true,
  pending: 1,
  autoReply: false,
});

const message = (
  id: string,
  at: string,
  status: InboxMessage["status"],
  answered = false,
): InboxMessage => ({
  id,
  waMessageId: `wamid.${id}`,
  text: `text ${id}`,
  at,
  direction: "IN",
  status,
  msgType: "text",
  handoff: status === "PERLU_STAF" ? handoff(at) : null,
  reply: answered
    ? {
        text: `answer ${id}`,
        byAgent: true,
        by: null,
        at,
        evaluation: null,
      }
    : null,
});

function conversationOf(phone: string): InboxConversation {
  return {
    phone,
    name: "Customer",
    channel: "WHATSAPP",
    windowClosesAt: "2026-11-17T01:00:00.000Z",
    messages: [
      message("m1", "2026-11-16T05:00:00.000Z", "PERLU_STAF"),
      message("m2", "2026-11-16T05:10:00.000Z", "DIJAWAB_AGEN", true),
      message("m3", "2026-11-16T07:00:00.000Z", "PERLU_STAF"),
      message("m4", "2026-11-16T07:05:00.000Z", "DIJAWAB_AGEN", true),
    ],
    summary: null,
    directive: null,
    handoff: handoff("2026-11-16T07:00:00.000Z"),
    autoReply: { enabled: true, by: null, at: null },
    customer: null,
    actions: [],
    profile: null,
    lead: { on: false, score: null, by: null },
    reservations: [],
  } as InboxConversation;
}

let threads: InboxThread[] = [];
const getConversation = vi.fn(async (phone: string) => conversationOf(phone));

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads }),
  getConversation: (phone: string) => getConversation(phone),
  markRead: async () => ({ ok: true as const }),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });

/** Generous: the full suite runs this beside sixty other rendered files. */
const WAIT = { timeout: 15_000 };

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

function Harness({ initial = null }: { initial?: string | null }) {
  const [picked, setPicked] = useState<string | null>(initial);
  return <ChatInbox picked={picked} onPick={setPicked} />;
}

const draw = (initial: string | null = null) =>
  render(
    <AntdApp>
      <Harness initial={initial} />
    </AntdApp>,
  );

const scrollIntoView = vi.fn();
const original = Element.prototype.scrollIntoView;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  getConversation.mockClear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe("which chat is waiting longest-or-newest", () => {
  it("reads a hand-over or a bot-off chat, never one the bot is answering", () => {
    expect(waitingForPersonAt(BUSY)).toBeNull();
    expect(waitingForPersonAt(OLDER)).toBe("2026-11-16T05:00:00.000Z");
    expect(waitingForPersonAt(BOT_OFF)).toBe("2026-11-16T06:00:00.000Z");
    expect(newestWaitingThread([BUSY, OLDER, BOT_OFF, NEWEST])).toBe(NEWEST);
    expect(newestWaitingThread([BUSY])).toBeUndefined();
  });
});

describe("opening /chat", () => {
  it("opens on the chat with the newest request waiting for a person", async () => {
    useDesktopViewport();
    threads = [OLDER, BUSY, BOT_OFF, NEWEST];
    draw();
    await waitFor(
      () => expect(getConversation).toHaveBeenCalledWith(NEWEST.phone),
      WAIT,
    );
    expect(getConversation).not.toHaveBeenCalledWith(OLDER.phone);
    // ...and on its latest waiting message.
    const log = await screen.findByRole("log", { name: "Messages" }, WAIT);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), WAIT);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      within(log)
        .getByText("text m3")
        .closest("[data-waiting='true']") as HTMLElement,
    );
  });

  it("keeps a thread picked by hand when the list refreshes", async () => {
    useDesktopViewport();
    threads = [OLDER, BUSY, NEWEST];
    const user = userEvent.setup();
    draw();
    await waitFor(
      () => expect(getConversation).toHaveBeenCalledWith(NEWEST.phone),
      WAIT,
    );
    await user.click(screen.getByRole("button", { name: /Busy Bot/ }));
    await waitFor(
      () => expect(getConversation).toHaveBeenLastCalledWith(BUSY.phone),
      WAIT,
    );
    // A newer hand-over arrives; the view stays where the person put it.
    threads = [
      { ...OLDER, handoff: handoff("2026-11-16T10:00:00.000Z") },
      BUSY,
      NEWEST,
    ];
    await new Promise((r) => setTimeout(r, 5_500));
    expect(getConversation).toHaveBeenLastCalledWith(BUSY.phone);
  });

  it("with nothing waiting, a phone still opens on the list", async () => {
    threads = [BUSY];
    draw();
    expect(
      await screen.findByRole("button", { name: /Busy Bot/ }, WAIT),
    ).toBeInTheDocument();
    // Give the auto-pick a chance to (wrongly) open it.
    await new Promise((r) => setTimeout(r, 50));
    expect(getConversation).not.toHaveBeenCalled();
  });
});

describe("a chat opened from a link", () => {
  it("scrolls to the latest waiting message and emphasises it", async () => {
    threads = [OLDER, NEWEST];
    // /chat?phone=… — the sidebar notice, a staff WhatsApp alert.
    draw(OLDER.phone);
    const log = await screen.findByRole("log", { name: "Messages" }, WAIT);
    const latest = within(log)
      .getByText("text m3")
      .closest("[data-waiting='true']") as HTMLElement;
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1), WAIT);
    expect(scrollIntoView.mock.contexts[0]).toBe(latest);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    // The older waiting message is outlined too, but is not where it lands.
    expect(
      within(log).getByText("text m1").closest("[data-waiting='true']"),
    ).not.toBe(latest);
    await waitFor(
      () => expect(latest).toHaveAttribute("data-flash", "true"),
      WAIT,
    );
  });
});
