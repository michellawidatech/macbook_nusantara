/**
 * "🔔 3 chats need a reply" on every page (owner, 2026-10-28): nothing at
 * zero, and a press opens the chat that has waited longest.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const getWaitingChats = vi.fn(async () => ({
  count: 3,
  oldest: "628111000001",
}));
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getWaitingChats: () => getWaitingChats(),
}));

const { ChatWaitingBell } = await import("../src/layouts/ChatWaitingBell.js");

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

describe("the chats-waiting notice", () => {
  it("says how many wait and opens the oldest", async () => {
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/stock/inventory"]}>
          <ChatWaitingBell />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AntdApp>,
    );
    const bell = await screen.findByTestId("chat-waiting-bell");
    expect(bell).toHaveTextContent("3 chat(s) need a reply");
    await userEvent.click(bell);
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/chat?phone=628111000001",
    );
  });
});
