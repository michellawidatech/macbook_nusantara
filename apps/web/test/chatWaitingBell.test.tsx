/**
 * "🔔 3 chats need a reply" on every page (owner, 2026-10-28): nothing at
 * zero, and a press opens the chat that has waited longest. NEW Instagram
 * comments count too (2026-11-16): in the words, in the Chatbot leaf's badge,
 * and with only comments waiting a press opens the Comments tab.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

type Waiting = {
  count: number;
  oldest: string | null;
  instagram?: number;
  comments?: number;
};
const getWaitingChats = vi.fn(async (): Promise<Waiting> => ({
  count: 3,
  oldest: "628111000001",
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getWaitingChats: () => getWaitingChats(),
}));

const { ChatWaitingBell } = await import("../src/layouts/ChatWaitingBell.js");
const { NavBadge } = await import("../src/layouts/NavBadge.js");

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function draw() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/stock/inventory"]}>
        <ChatWaitingBell />
        <NavBadge kind="chatWaiting" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

describe("the chats-waiting notice", () => {
  it("says how many wait and opens the oldest", async () => {
    const view = draw();
    const bell = await screen.findByTestId("chat-waiting-bell");
    expect(bell).toHaveTextContent("3 chat(s) need a reply");
    await userEvent.click(bell);
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/chat?phone=628111000001",
    );
    view.unmount();
  });

  it("adds the comments to the words and to the Chatbot badge", async () => {
    getWaitingChats.mockResolvedValue({
      count: 2,
      oldest: "ig:17841400000000444",
      instagram: 1,
      comments: 1,
    });
    const view = draw();
    const bell = await screen.findByTestId("chat-waiting-bell");
    expect(bell).toHaveTextContent("2 chat(s) and 1 comment(s) need a reply");
    const badge = document.querySelector('[data-nav-badge="chatWaiting"]');
    expect(badge).toHaveTextContent("3");
    // The oldest chat is an Instagram DM: its key, encoded.
    await userEvent.click(bell);
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/chat?phone=ig%3A17841400000000444",
    );
    view.unmount();
  });

  it("opens the Comments tab when only comments wait", async () => {
    getWaitingChats.mockResolvedValue({
      count: 0,
      oldest: null,
      instagram: 0,
      comments: 2,
    });
    draw();
    const bell = await screen.findByTestId("chat-waiting-bell");
    expect(bell).toHaveTextContent("2 comment(s) need a reply");
    await userEvent.click(bell);
    expect(screen.getByTestId("where")).toHaveTextContent("/chat?tab=comments");
  });
});
