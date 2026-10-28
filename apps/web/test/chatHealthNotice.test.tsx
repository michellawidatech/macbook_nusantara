/**
 * "Chatbot has a problem" on every page (owner, 2026-10-28): drawn only while
 * the server's health check finds one, naming what it found.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getChatHealth: async () => ({
    ok: false,
    problems: [{ code: "BOT_STALE", minutes: 9 }],
    checkedAt: "2026-10-28T03:00:00.000Z",
  }),
}));

const { ChatHealthNotice } = await import("../src/layouts/ChatHealthNotice.js");

describe("the chatbot health notice", () => {
  it("says the chatbot has a problem, and why", async () => {
    render(
      <AntdApp>
        <MemoryRouter>
          <ChatHealthNotice />
        </MemoryRouter>
      </AntdApp>,
    );
    const notice = await screen.findByTestId("chat-health-notice");
    expect(notice).toHaveTextContent("Chatbot has a problem");
    expect(notice).toHaveAttribute(
      "aria-label",
      "Chatbot has a problem: A customer has waited 9 min for the bot",
    );
  });
});
