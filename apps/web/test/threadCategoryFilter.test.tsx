/**
 * The thread list's category chips (owner, 2026-11-16): each waiting chat
 * carries what it waits for as a coloured tag with words, and a chip above
 * the list, "All" first, narrows the list to one category.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { InboxThread } from "../src/lib/inboxApi.js";
import { ThreadList } from "../src/routes/chatbot/ThreadList.js";

const thread = (
  phone: string,
  name: string,
  over: Partial<InboxThread> = {},
): InboxThread => ({
  phone,
  name,
  displayName: name,
  channel: "WHATSAPP",
  lastText: "halo",
  lastAt: "2026-11-16T06:50:00.000Z",
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
  ...over,
});
const handoff = (topic: string) => ({
  topic,
  summary: null,
  forcedBy: "route",
  at: "2026-11-16T06:50:00.000Z",
});

const THREADS = [
  thread("62811", "Ani", { handoff: handoff("video_call"), needsReply: true }),
  thread("62812", "Budi", {
    handoff: handoff("warranty_claim"),
    needsReply: true,
  }),
  thread("62813", "Citra", {
    handoff: handoff("video_call"),
    needsReply: true,
  }),
  thread("62814", "Dedi"),
];

describe("the category filter", () => {
  it("tags each waiting chat and narrows the list to one category", async () => {
    const user = userEvent.setup();
    render(
      <ThreadList
        threads={THREADS}
        active={null}
        loading={false}
        onPick={() => {}}
      />,
    );
    const group = screen.getByRole("group", {
      name: "Filter chats by category",
    });
    const chips = within(group);
    expect(chips.getByText(/All/)).toHaveTextContent("All (4)");
    expect(chips.getByText(/Video call request/)).toHaveTextContent(
      "Video call request (2)",
    );
    expect(chips.getByText(/Complaint \/ service/)).toHaveTextContent(
      "Complaint / service (1)",
    );
    // A tag with words on each waiting row, none on the quiet one.
    const row = (name: string) => screen.getByRole("button", { name });
    expect(
      within(row("Ani")).getByText("Video call request"),
    ).toBeInTheDocument();
    expect(
      within(row("Budi")).getByText("Complaint / service"),
    ).toBeInTheDocument();
    expect(row("Dedi").querySelector("[data-category]")).toBeNull();

    await user.click(chips.getByText(/Video call request/));
    expect(screen.queryByRole("button", { name: "Budi" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dedi" })).toBeNull();
    expect(row("Ani")).toBeInTheDocument();
    expect(row("Citra")).toBeInTheDocument();

    await user.click(chips.getByText(/All/));
    expect(row("Dedi")).toBeInTheDocument();
  });
});
