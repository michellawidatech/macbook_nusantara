/**
 * A picture from this device (owner ask 2026-10-27): the 📎 offers it beside
 * a unit's QC photos; the dialog refuses anything but a JPG, PNG or WebP of at
 * most 5 MB before a byte is uploaded, previews what it will send, and sends
 * it with an optional caption. A sent one is drawn with its caption and the
 * name of who sent it, and can be unsent like any other photo.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboxConversation,
  InboxThread,
  SentItem,
} from "../src/lib/inboxApi.js";
import { pictureProblem } from "../src/routes/chatbot/SendPictureModal.js";

const PHONE = "628980092978";

const THREADS: InboxThread[] = [
  {
    phone: PHONE,
    name: "Michella",
    displayName: "Michella",
    channel: "WHATSAPP",
    lastText: "ada fotonya?",
    lastAt: "2026-10-27T03:30:00.000Z",
    lastReply: null,
    needsReply: false,
    pending: 0,
    autoReply: true,
    handoff: null,
    openActions: [],
    windowClosesAt: "2099-10-28T03:30:00.000Z",
    unread: 0,
    tags: { lead: false, reservation: false, escalation: false },
    leadScore: null,
  },
];

function conversationWith(sent: SentItem[]): InboxConversation {
  return {
    phone: PHONE,
    name: "Michella",
    channel: "WHATSAPP",
    windowClosesAt: "2099-10-28T03:30:00.000Z",
    messages: [
      {
        id: "m1",
        waMessageId: "wamid.1",
        text: "ada fotonya?",
        at: "2026-10-27T03:30:00.000Z",
        direction: "IN",
        status: "DIJAWAB_STAF",
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
    sent,
  };
}

let conversation: InboxConversation;
const sendPicture = vi.fn(
  async (_phone: string, _image: string, _caption?: string) => ({}),
);

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  listThreads: async () => ({ threads: THREADS }),
  getConversation: async () => conversation,
  markRead: async () => ({ ok: true as const }),
  sendPicture: (phone: string, image: string, caption?: string) =>
    sendPicture(phone, image, caption),
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Attach" }));
  await user.click(await screen.findByText("Send a picture from this device"));
  return screen.findByRole("dialog", {
    name: "Send a picture from this device",
  });
}

beforeEach(() => {
  sendPicture.mockClear();
  conversation = conversationWith([]);
});

describe("sending a picture from this device", () => {
  it("previews it and sends it with its caption", async () => {
    const user = userEvent.setup();
    draw();
    const dialog = await openDialog(user);
    const send = within(dialog).getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    await user.upload(
      within(dialog).getByLabelText("Choose a picture"),
      new File([PNG], "lid.png", { type: "image/png" }),
    );
    const preview = await within(dialog).findByAltText("Picture to send");
    expect(preview.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Caption" }),
      "Ini lecetnya kak",
    );
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendPicture).toHaveBeenCalledTimes(1));
    const [phone, image, caption] = sendPicture.mock.calls[0]!;
    expect(phone).toBe(PHONE);
    expect(image).toBe(preview.getAttribute("src"));
    expect(caption).toBe("Ini lecetnya kak");
  });

  it("refuses a file that is not a JPG, PNG or WebP, in words", async () => {
    const user = userEvent.setup({ applyAccept: false });
    draw();
    const dialog = await openDialog(user);
    await user.upload(
      within(dialog).getByLabelText("Choose a picture"),
      new File(["GIF89a"], "a.gif", { type: "image/gif" }),
    );
    expect(
      await within(dialog).findByText(
        "Only a JPG, PNG or WebP picture can be sent.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByAltText("Picture to send")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendPicture).not.toHaveBeenCalled();
  });

  it("refuses one over 5 MB", async () => {
    const user = userEvent.setup();
    draw();
    const dialog = await openDialog(user);
    const big = new File([PNG], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 });
    await user.upload(within(dialog).getByLabelText("Choose a picture"), big);
    expect(
      await within(dialog).findByText(
        "The picture is larger than 5 MB. Pick a smaller one.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("knows the rules without a dialog", () => {
    expect(pictureProblem({ type: "image/webp", size: 10 })).toBeNull();
    expect(pictureProblem({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBe(
      null,
    );
    expect(pictureProblem({ type: "image/heic", size: 10 })).toBe("TYPE");
    expect(pictureProblem({ type: "image/png", size: 0 })).toBe("EMPTY");
  });
});

describe("a picture that was sent", () => {
  it("names who sent it, carries its caption, and can be unsent", async () => {
    conversation = conversationWith([
      {
        id: "ob9",
        kind: "WA_IMAGE",
        status: "SENT",
        createdAt: "2026-10-27T03:31:00.000Z",
        sentAt: "2026-10-27T03:31:02.000Z",
        chatMediaId: "cm1",
        caption: "Ini lecetnya kak",
        sentBy: "Dina",
        inReplyTo: "m1",
        retractedAt: null,
        editedAt: null,
        canEdit: false,
        canUnsend: true,
      },
    ]);
    const user = userEvent.setup();
    draw();
    const img = await screen.findByAltText("Photo sent");
    expect(img).toHaveAttribute("src", `/api/inbox/${PHONE}/sent/ob9/photo`);
    const log = screen.getByRole("log");
    expect(within(log).getByText("Sent by Dina")).toBeInTheDocument();
    expect(within(log).getByText("Ini lecetnya kak")).toBeInTheDocument();
    await user.click(
      within(log).getByRole("button", { name: "Message actions" }),
    );
    expect(await screen.findByText("Unsend")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).toBeNull();
  });
});
