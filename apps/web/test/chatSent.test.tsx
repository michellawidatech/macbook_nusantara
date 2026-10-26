/**
 * What the shop sent, inside the conversation (owner ask 2026-10-23): a sent
 * photo drawn at its time (and saying so once it is no longer stored), the
 * ⋯ menu on a sent bubble — Unsend behind a confirm, Edit in a dialog — and
 * an unsent or edited item marked as such.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboxConversation,
  InboxThread,
  SentItem,
} from "../src/lib/inboxApi.js";

const PHONE = "628980092978";
const BOT_TEXT = "Ada kak, Air M2 8/256 Rp 15.500.000 😊";

const THREADS: InboxThread[] = [
  {
    phone: PHONE,
    name: "Michella",
    displayName: "Michella",
    channel: "WHATSAPP",
    lastText: "Air M2 ada?",
    lastAt: "2026-10-23T03:30:00.000Z",
    lastReply: BOT_TEXT,
    needsReply: false,
    pending: 0,
    autoReply: true,
    handoff: null,
    openActions: [],
    windowClosesAt: "2026-10-24T03:30:00.000Z",
    unread: 0,
    tags: { lead: false, reservation: false, escalation: false },
    leadScore: null,
  },
];

const sentItem = (over: Partial<SentItem>): SentItem => ({
  id: "ob1",
  kind: "WA_REPLY",
  status: "SENT",
  createdAt: "2026-10-23T03:30:10.000Z",
  sentAt: "2026-10-23T03:30:12.000Z",
  inReplyTo: "m1",
  retractedAt: null,
  editedAt: null,
  canEdit: true,
  canUnsend: true,
  ...over,
});

let conversation: InboxConversation;

function baseConversation(sent: SentItem[]): InboxConversation {
  return {
    phone: PHONE,
    name: "Michella",
    channel: "WHATSAPP",
    windowClosesAt: "2026-10-24T03:30:00.000Z",
    messages: [
      {
        id: "m1",
        waMessageId: "wamid.1",
        text: "Air M2 ada?",
        at: "2026-10-23T03:30:00.000Z",
        direction: "IN",
        status: "DIJAWAB_AGEN",
        msgType: "text",
        handoff: null,
        reply: {
          text: BOT_TEXT,
          byAgent: true,
          by: null,
          at: "2026-10-23T03:30:10.000Z",
          evaluation: null,
          outboxId: "ob1",
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
    lead: { on: false, score: null, by: null },
    reservations: [],
    sent,
  };
}

const unsendSent = vi.fn(async (_phone: string, id: string) =>
  sentItem({ id, retractedAt: "2026-10-23T03:31:00.000Z" }),
);
const editSent = vi.fn(async (_phone: string, id: string, text: string) =>
  sentItem({ id, body: text, editedAt: "2026-10-23T03:31:00.000Z" }),
);

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: THREADS }),
  getConversation: async () => conversation,
  markRead: async () => ({ ok: true as const }),
  unsendSent: (phone: string, id: string) => unsendSent(phone, id),
  editSent: (phone: string, id: string, text: string) =>
    editSent(phone, id, text),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");

vi.setConfig({ testTimeout: 90_000 });

function Harness() {
  const [picked, setPicked] = useState<string | null>(PHONE);
  return <ChatInbox picked={picked} onPick={setPicked} />;
}

const draw = () =>
  render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );

beforeEach(() => {
  unsendSent.mockClear();
  editSent.mockClear();
});

describe("a sent photo", () => {
  it("is drawn at its time, from the inbox's photo endpoint", async () => {
    conversation = baseConversation([
      sentItem({ body: BOT_TEXT }),
      sentItem({
        id: "ob2",
        kind: "WA_IMAGE",
        photoId: "ph1",
        sentAt: "2026-10-23T03:30:20.000Z",
        canEdit: false,
      }),
    ]);
    draw();
    const img = await screen.findByAltText("Photo sent");
    expect(img).toHaveAttribute("src", `/api/inbox/${PHONE}/sent/ob2/photo`);
    // After the bot's words, as it went out.
    const log = screen.getByRole("log");
    const text = within(log).getByText(BOT_TEXT);
    expect(
      text.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says so once the photo is no longer stored", async () => {
    conversation = baseConversation([
      sentItem({ body: BOT_TEXT }),
      sentItem({ id: "ob2", kind: "WA_IMAGE", photoId: "ph1" }),
    ]);
    draw();
    fireEvent.error(await screen.findByAltText("Photo sent"));
    expect(
      await screen.findByText("Photo no longer stored"),
    ).toBeInTheDocument();
  });
});

describe("the ⋯ menu on a sent bubble", () => {
  it("unsends only after the confirm", async () => {
    conversation = baseConversation([sentItem({ body: BOT_TEXT })]);
    const user = userEvent.setup();
    draw();
    const bubble = await screen.findByTestId("bot-bubble");
    await user.click(
      within(bubble).getByRole("button", { name: "Message actions" }),
    );
    await user.click(await screen.findByText("Unsend"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Unsend this message?");
    expect(unsendSent).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Unsend" }));
    await waitFor(() => expect(unsendSent).toHaveBeenCalledWith(PHONE, "ob1"));
  });

  it("edits a text in a dialog", async () => {
    conversation = baseConversation([sentItem({ body: BOT_TEXT })]);
    const user = userEvent.setup();
    draw();
    const bubble = await screen.findByTestId("bot-bubble");
    await user.click(
      within(bubble).getByRole("button", { name: "Message actions" }),
    );
    await user.click(await screen.findByText("Edit"));
    const box = await screen.findByRole("textbox", {
      name: "Edit the message",
    });
    await user.clear(box);
    await user.type(box, "Rp 14.500.000 kak");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(editSent).toHaveBeenCalledWith(PHONE, "ob1", "Rp 14.500.000 kak"),
    );
  });

  it("is not drawn when WhatsApp no longer allows either", async () => {
    conversation = baseConversation([
      sentItem({ body: BOT_TEXT, canEdit: false, canUnsend: false }),
    ]);
    draw();
    const bubble = await screen.findByTestId("bot-bubble");
    expect(
      within(bubble).queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
  });

  it("marks an unsent message instead of showing it, and an edited one", async () => {
    conversation = baseConversation([
      sentItem({
        body: BOT_TEXT,
        retractedAt: "2026-10-23T03:31:00.000Z",
        canEdit: false,
        canUnsend: false,
      }),
      sentItem({
        id: "ob3",
        body: "Berikut foto Air M2 nya ya kak",
        inReplyTo: "m1",
        sentAt: "2026-10-23T03:30:30.000Z",
        editedAt: "2026-10-23T03:32:00.000Z",
      }),
    ]);
    draw();
    const bubble = await screen.findByTestId("bot-bubble");
    expect(within(bubble).getByText("Unsent")).toBeInTheDocument();
    expect(within(bubble).queryByText(BOT_TEXT)).toBeNull();
    // A sent line no reply claimed is its own bubble, marked edited.
    const line = await screen.findByText("Berikut foto Air M2 nya ya kak");
    expect(line.parentElement).toHaveTextContent("Edited");
    // Done before the log said who: the bare word, nobody named.
    expect(line.parentElement).not.toHaveTextContent("Edited by");
    expect(within(bubble).queryByText(/Unsent by/)).toBeNull();
  });

  it("says who edited or unsent it (2026-10-27)", async () => {
    conversation = baseConversation([
      sentItem({
        body: BOT_TEXT,
        retractedAt: "2026-10-23T03:31:00.000Z",
        retractedBy: "Rina",
        canEdit: false,
        canUnsend: false,
      }),
      sentItem({
        id: "ob3",
        body: "Berikut foto Air M2 nya ya kak",
        inReplyTo: "m1",
        sentAt: "2026-10-23T03:30:30.000Z",
        editedAt: "2026-10-23T03:32:00.000Z",
        editedBy: "Budi",
      }),
    ]);
    draw();
    const bubble = await screen.findByTestId("bot-bubble");
    expect(within(bubble).getByTestId("sent-unsent")).toHaveTextContent(
      /^Unsent by Rina · /,
    );
    const line = await screen.findByText("Berikut foto Air M2 nya ya kak");
    expect(line.parentElement).toHaveTextContent(/Edited by Budi · /);
  });
});
