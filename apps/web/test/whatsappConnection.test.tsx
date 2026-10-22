/**
 * Chatbot → Settings → WhatsApp connection (2026-10-22): the linked device
 * that is the shop's number. One session, a permanent warning, a QR that
 * turns into "Connected" by polling, and a confirm in front of Disconnect.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/lib/api.js";
import type { WhatsAppConnection as Conn } from "../src/lib/whatsappApi.js";

const LIMIT = { max: 3, windowMinutes: 60, remaining: 2, resetAt: null };
const CONNECTED: Conn = {
  gateway: "OK",
  state: "CONNECTED",
  number: "+628111222333",
  since: "2026-10-22T03:00:00.000Z",
  limit: LIMIT,
};
const DISCONNECTED: Conn = {
  gateway: "OK",
  state: "DISCONNECTED",
  limit: LIMIT,
};
const WAITING: Conn = {
  gateway: "OK",
  state: "WAITING_FOR_SCAN",
  qr: "data:image/png;base64,QRDATA",
  limit: LIMIT,
};

const getConn = vi.fn<() => Promise<Conn>>();
const link = vi.fn<() => Promise<Conn>>();
const logout = vi.fn<() => Promise<Conn>>();

vi.mock("../src/lib/whatsappApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/whatsappApi.js")>()),
  getWhatsAppConnection: () => getConn(),
  linkWhatsApp: () => link(),
  logoutWhatsApp: () => logout(),
}));

const { WhatsAppConnection, POLL_MS } =
  await import("../src/routes/chatbot/WhatsAppConnection.js");

vi.setConfig({ testTimeout: 90_000 });

function draw() {
  render(
    <AntdApp>
      <WhatsAppConnection />
    </AntdApp>,
  );
}

beforeEach(() => {
  getConn.mockReset();
  link.mockReset();
  logout.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the WhatsApp connection card", () => {
  it("warns, every time, that the connection is unofficial", async () => {
    getConn.mockResolvedValue(CONNECTED);
    draw();
    expect(
      await screen.findByText(/WhatsApp can ban the number/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Do not link and unlink repeatedly/)).toBeTruthy();
    expect(screen.getByText(/about 14 days/)).toBeTruthy();
    expect(screen.getByText(/dedicated number/)).toBeTruthy();
  });

  it("shows the linked number and refuses a second link while connected", async () => {
    getConn.mockResolvedValue(CONNECTED);
    draw();
    expect(await screen.findByText("+628111222333")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link WhatsApp" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(
      screen.getByText("2 of 3 link attempts left this hour"),
    ).toBeInTheDocument();
  });

  it("links: shows the QR, and polls until the phone has scanned it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getConn.mockResolvedValueOnce(DISCONNECTED);
    link.mockResolvedValueOnce(WAITING);
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    draw();
    const button = await screen.findByRole("button", {
      name: "Link WhatsApp",
    });
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    await user.click(button);

    const qr = await screen.findByAltText("QR code to link WhatsApp");
    expect(qr).toHaveAttribute("src", WAITING.qr);
    expect(link).toHaveBeenCalledTimes(1);
    // The name carries antd's leaving "loading" icon for a frame or two.
    expect(
      screen.getByRole("button", { name: /Link WhatsApp/ }),
    ).toBeDisabled();

    getConn.mockResolvedValue(CONNECTED);
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByAltText("QR code to link WhatsApp")).toBeNull();
  });

  it("says why linking was refused — the hourly limit", async () => {
    getConn.mockResolvedValue(DISCONNECTED);
    link.mockRejectedValueOnce(
      new ApiRequestError(429, {
        code: "TERLALU_BANYAK",
        message: "Terlalu sering menautkan WhatsApp. Coba lagi dalam 30 menit.",
      }),
    );
    draw();
    await userEvent.click(
      await screen.findByRole("button", { name: "Link WhatsApp" }),
    );
    expect(
      await screen.findByText(/Coba lagi dalam 30 menit/),
    ).toBeInTheDocument();
  });

  it("disconnects only after the confirm", async () => {
    getConn.mockResolvedValue(CONNECTED);
    logout.mockResolvedValueOnce(DISCONNECTED);
    draw();
    await userEvent.click(
      await screen.findByRole("button", { name: "Disconnect" }),
    );
    expect(
      (await screen.findAllByText("Disconnect WhatsApp?")).length,
    ).toBeGreaterThan(0);
    expect(logout).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "Disconnect" });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("says plainly when the gateway is not running", async () => {
    getConn.mockResolvedValue({ gateway: "UNREACHABLE" });
    draw();
    expect(
      await screen.findByText(
        "The WhatsApp gateway is not running on the server.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link WhatsApp" })).toBeNull();
  });

  it("explains a session the phone ended", async () => {
    getConn.mockResolvedValue({ ...DISCONNECTED, lastError: "LOGGED_OUT" });
    draw();
    expect(
      await screen.findByText(/The device was removed from the phone/),
    ).toBeInTheDocument();
  });
});
