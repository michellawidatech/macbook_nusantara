/**
 * The conversation header's ⋯ (owner asks 2026-10-27): *Clear chat* for
 * anybody, behind a confirm; *Delete conversation* for the owner only, behind
 * a dialog that wants the number typed back. Either way the thread leaves the
 * list and the selection moves off it.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation, InboxThread } from "../src/lib/inboxApi.js";

const PHONE = "628980092978";
const OTHER = "628111000888";

const thread = (phone: string, name: string): InboxThread => ({
  phone,
  name,
  displayName: name,
  channel: "WHATSAPP",
  lastText: "halo",
  lastAt: "2026-10-27T03:30:00.000Z",
  lastReply: "halo kak",
  needsReply: false,
  pending: 0,
  autoReply: true,
  handoff: null,
  openActions: [],
  windowClosesAt: "2026-10-28T03:30:00.000Z",
  unread: 0,
  tags: { lead: false, reservation: false, escalation: false },
  leadScore: null,
});

const conversationOf = (phone: string, name: string): InboxConversation => ({
  phone,
  name,
  channel: "WHATSAPP",
  windowClosesAt: "2026-10-28T03:30:00.000Z",
  messages: [
    {
      id: `m.${phone}`,
      waMessageId: `wamid.${phone}`,
      text: `halo dari ${name}`,
      at: "2026-10-27T03:30:00.000Z",
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
});

/** What the server lists; a clear or delete takes the thread off it. */
let listed: InboxThread[] = [];
const clearConversation = vi.fn(async (phone: string) => {
  listed = listed.filter((th) => th.phone !== phone);
  return { clearedAt: "2026-10-27T03:40:00.000Z", closed: 0 };
});
const deleteConversation = vi.fn(async (phone: string, _confirm: string) => {
  listed = listed.filter((th) => th.phone !== phone);
  return { deleted: 12 };
});

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: listed }),
  getConversation: async (phone: string) =>
    conversationOf(phone, phone === PHONE ? "Ayu" : "Budi"),
  markRead: async () => ({ ok: true as const }),
  clearConversation: (phone: string) => clearConversation(phone),
  deleteConversation: (phone: string, confirm: string) =>
    deleteConversation(phone, confirm),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });

let picks: Array<string | null> = [];
function Harness({ isOwner }: { isOwner: boolean }) {
  const [picked, setPicked] = useState<string | null>(PHONE);
  return (
    <ChatInbox
      picked={picked}
      onPick={(p) => {
        picks.push(p);
        setPicked(p);
      }}
      isOwner={isOwner}
    />
  );
}

const draw = (isOwner = false) =>
  render(
    <AntdApp>
      <Harness isOwner={isOwner} />
    </AntdApp>,
  );

beforeEach(() => {
  listed = [thread(PHONE, "Ayu"), thread(OTHER, "Budi")];
  picks = [];
  clearConversation.mockClear();
  deleteConversation.mockClear();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("halo dari Ayu");
  await user.click(screen.getByRole("button", { name: "Chat actions" }));
}

describe("Clear chat", () => {
  it("asks first, then hides the chat and moves off it", async () => {
    const user = userEvent.setup();
    draw();
    await openMenu(user);
    expect(screen.queryByText("Delete conversation")).toBeNull();
    await user.click(await screen.findByText("Clear chat"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Clear this chat?");
    expect(dialog).toHaveTextContent(
      "it forgets the conversation, the lead and what it learned",
    );
    expect(clearConversation).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Clear chat" }),
    );
    await waitFor(() => expect(clearConversation).toHaveBeenCalledWith(PHONE));
    expect(picks).toContain(null);
    // Off the cleared chat (a phone — every test is — goes back to the
    // list), and the cleared one is off the list.
    await waitFor(() => expect(screen.queryByText("Ayu")).toBeNull());
    expect(screen.queryByText("halo dari Ayu")).toBeNull();
    expect(await screen.findByText("Budi")).toBeInTheDocument();
  });

  it("does nothing when the confirm is cancelled", async () => {
    const user = userEvent.setup();
    draw();
    await openMenu(user);
    await user.click(await screen.findByText("Clear chat"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(clearConversation).not.toHaveBeenCalled();
    expect(screen.getByText("halo dari Ayu")).toBeInTheDocument();
  });
});

describe("Delete conversation", () => {
  it("is the owner's, and wants the number typed back", async () => {
    const user = userEvent.setup();
    draw(true);
    await openMenu(user);
    await user.click(await screen.findByText("Delete conversation"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete this conversation for good?");
    expect(dialog).toHaveTextContent("ratings");
    const ok = within(dialog).getByRole("button", {
      name: "Delete conversation",
    });
    expect(ok).toBeDisabled();
    const box = within(dialog).getByRole("textbox", {
      name: "Type the customer's number to confirm",
    });
    await user.type(box, "628111");
    expect(ok).toBeDisabled();
    await user.clear(box);
    await user.type(box, PHONE);
    expect(ok).toBeEnabled();
    await user.click(ok);
    await waitFor(() =>
      expect(deleteConversation).toHaveBeenCalledWith(PHONE, PHONE),
    );
    await waitFor(() => expect(screen.queryByText("Ayu")).toBeNull());
    expect(await screen.findByText("Budi")).toBeInTheDocument();
  });
});
