/**
 * Instagram DMs in the Chat inbox (2026-11-16): a WhatsApp | Instagram switch
 * above the list, the Instagram list from `?channel=instagram`, a thread
 * called by its @username and never by its `ig:` key, the reply box saying
 * when only a person may reply or nobody can, and a thread opened from a link
 * landing on the Instagram inbox by itself.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboxChannel,
  InboxConversation,
  InboxThread,
} from "../src/lib/inboxApi.js";

const IG = "ig:17841400000000444";

const base = {
  lastReply: null,
  needsReply: false,
  pending: 0,
  autoReply: true,
  handoff: null,
  openActions: [],
  unread: 0,
  tags: { lead: false, reservation: false, escalation: false },
  leadScore: null,
};

const WA_THREADS: InboxThread[] = [
  {
    ...base,
    phone: "628980092978",
    name: "Michella",
    displayName: "Michella",
    channel: "WHATSAPP",
    lastText: "Halo",
    lastAt: "2026-11-16T03:00:00.000Z",
    windowClosesAt: "2026-11-17T03:00:00.000Z",
  },
];

const IG_THREADS: InboxThread[] = [
  {
    ...base,
    phone: IG,
    name: "Budi Santoso",
    displayName: "Budi Santoso",
    username: "budi.mac",
    channel: "INSTAGRAM",
    humanAgentOnly: false,
    lastText: "Air M2 masih ada?",
    lastAt: "2026-11-16T04:00:00.000Z",
    windowClosesAt: null,
  },
  {
    ...base,
    phone: "ig:17841400000000555",
    name: null,
    displayName: null,
    username: null,
    channel: "INSTAGRAM",
    humanAgentOnly: false,
    lastText: "Halo",
    lastAt: "2026-11-16T02:00:00.000Z",
    windowClosesAt: "2026-11-17T02:00:00.000Z",
  },
];

let conversation: InboxConversation;
const igConversation = (
  over: Partial<InboxConversation> = {},
): InboxConversation => ({
  phone: IG,
  name: "Budi Santoso",
  channel: "INSTAGRAM",
  username: "budi.mac",
  windowClosesAt: null,
  humanAgentOnly: false,
  messages: [
    {
      id: "m1",
      waMessageId: "mid.1",
      text: "Air M2 masih ada?",
      at: "2026-11-16T04:00:00.000Z",
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
  ...over,
});

const listThreads = vi.fn(async (channel: InboxChannel = "whatsapp") => ({
  threads: channel === "instagram" ? IG_THREADS : WA_THREADS,
}));
const getConversation = vi.fn(async (_phone: string) => conversation);

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: (channel?: InboxChannel) => listThreads(channel),
  getConversation: (phone: string) => getConversation(phone),
  markRead: async () => ({ ok: true as const }),
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  agentStatus: async () => ({ enabled: true, mode: "api-key" }),
  getWaitingChats: async () => ({
    count: 3,
    oldest: IG,
    instagram: 2,
    comments: 0,
  }),
}));

const { ChatInbox } = await import("../src/routes/chatbot/ChatPage.js");
const { pictureProblem, INSTAGRAM_PICTURE_TYPES } =
  await import("../src/routes/chatbot/SendPictureModal.js");

vi.setConfig({ testTimeout: 90_000 });

function Harness({ initial = null }: { initial?: string | null }) {
  const [picked, setPicked] = useState<string | null>(initial);
  return <ChatInbox picked={picked} onPick={setPicked} isOwner />;
}

function draw(initial: string | null = null) {
  return render(
    <AntdApp>
      <Harness initial={initial} />
    </AntdApp>,
  );
}

const channelGroup = () => screen.getByRole("group", { name: "Channel" });

beforeEach(() => {
  listThreads.mockClear();
  getConversation.mockClear();
  conversation = igConversation();
});

describe("the WhatsApp | Instagram switch", () => {
  it("lists WhatsApp first, then Instagram's threads by their @username", async () => {
    const user = userEvent.setup();
    draw();
    expect(
      await screen.findByRole("button", { name: "Michella" }),
    ).toBeInTheDocument();
    expect(listThreads).toHaveBeenCalledWith("whatsapp");

    await user.click(within(channelGroup()).getByText("Instagram"));
    const row = await screen.findByRole("button", { name: "@budi.mac" });
    await waitFor(() => expect(listThreads).toHaveBeenCalledWith("instagram"));
    // The name under the handle; the ig: key is never shown as a number.
    expect(row).toHaveTextContent("Budi Santoso");
    expect(screen.queryByText(/ig:1784/)).toBeNull();
    // No username, no name: "Instagram user".
    expect(
      screen.getByRole("button", { name: "Instagram user" }),
    ).toBeInTheDocument();
    // The WhatsApp thread is gone from this list.
    expect(screen.queryByRole("button", { name: "Michella" })).toBeNull();
  });

  it("shows how many Instagram chats wait on a person", async () => {
    draw();
    expect(
      await within(channelGroup()).findByLabelText(
        "2 Instagram chat(s) need a reply",
      ),
    ).toBeInTheDocument();
  });

  it("opens an ig: thread from a link in the Instagram inbox", async () => {
    draw(IG);
    await waitFor(() => expect(listThreads).toHaveBeenCalledWith("instagram"));
    expect(listThreads).not.toHaveBeenCalledWith("whatsapp");
    await waitFor(() => expect(getConversation).toHaveBeenCalledWith(IG));
    const log = await screen.findByRole("log", { name: "Messages" });
    expect(log).toHaveTextContent("Air M2 masih ada?");
  });
});

describe("the Instagram reply box", () => {
  it("says nobody can reply until the customer writes again", async () => {
    conversation = igConversation({ windowClosesAt: null });
    draw(IG);
    expect(
      await screen.findByText(
        "Instagram's reply window has closed. Nobody can reply until the customer writes again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeDisabled();
  });

  it("says only a person may reply, and until when, past 24 hours", async () => {
    conversation = igConversation({
      windowClosesAt: "2026-11-22T04:00:00.000Z",
      humanAgentOnly: true,
    });
    draw(IG);
    expect(
      await screen.findByText(/Past 24 hours: only a person may reply, until/),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeEnabled();
  });

  it("deletes an Instagram thread once its @username is typed back", async () => {
    const user = userEvent.setup();
    conversation = igConversation({
      windowClosesAt: "2026-11-17T04:00:00.000Z",
    });
    draw(IG);
    await screen.findByRole("log", { name: "Messages" });
    await user.click(screen.getByRole("button", { name: "Chat actions" }));
    await user.click(await screen.findByText("Delete conversation"));
    const ok = await screen.findByRole("button", {
      name: "Delete conversation",
    });
    expect(ok).toBeDisabled();
    const box = screen.getByRole("textbox", {
      name: "Type the customer's number to confirm",
    });
    await user.type(box, "6281234567890");
    expect(ok).toBeDisabled();
    await user.clear(box);
    await user.type(box, `@${conversation.username}`);
    expect(ok).toBeEnabled();
  });
});

describe("a picture for an Instagram thread", () => {
  it("is a JPG or PNG — never a WebP", () => {
    const webp = { type: "image/webp", size: 1000 };
    expect(pictureProblem(webp)).toBeNull();
    expect(pictureProblem(webp, INSTAGRAM_PICTURE_TYPES)).toBe("TYPE");
    expect(
      pictureProblem(
        { type: "image/png", size: 1000 },
        INSTAGRAM_PICTURE_TYPES,
      ),
    ).toBeNull();
  });
});
