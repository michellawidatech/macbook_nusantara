/**
 * Chatbot → Settings → Instagram (2026-11-16): the owner's card. It shows the
 * connection (account, token expiry with a warning, the last delivery from
 * Meta, the Human Agent switch), and saves the comment auto-reply — grey
 * until something changed, refusing a switched-on auto-reply with no public
 * reply. Staff do not see it.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InstagramConnection,
  InstagramSettings,
} from "../src/lib/instagramApi.js";

vi.setConfig({ testTimeout: 90_000 });

const NOW = new Date("2026-11-16T03:00:00.000Z");

const CONNECTION: InstagramConnection = {
  connected: true,
  account: {
    igUserId: "17841400000000001",
    username: "macbooknusantara",
    name: "Macbook Nusantara",
    accountType: "BUSINESS",
    checkedAt: "2026-11-16T02:00:00.000Z",
    lastError: null,
    tokenRefreshedAt: "2026-11-10T02:00:00.000Z",
    tokenExpiresAt: "2026-11-21T02:00:00.000Z",
  },
  lastEventAt: null,
  senders: 12,
  humanAgent: false,
};

const SETTINGS: InstagramSettings = {
  autoReply: false,
  replyTemplate: "Cek DM ya kak",
  dmTemplate: "Halo kak, terima kasih sudah komen",
  updatedAt: null,
};

const getConnection = vi.fn(async () => CONNECTION);
const getSettings = vi.fn(async () => SETTINGS);
const saveSettings = vi.fn(
  async (
    body: Pick<InstagramSettings, "autoReply" | "replyTemplate" | "dmTemplate">,
  ): Promise<InstagramSettings> => ({
    ...body,
    updatedAt: "2026-11-16T03:01:00.000Z",
  }),
);

vi.mock("../src/lib/instagramApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/instagramApi.js")>()),
  getInstagramConnection: () => getConnection(),
  getInstagramSettings: () => getSettings(),
  saveInstagramSettings: (
    b: Pick<InstagramSettings, "autoReply" | "replyTemplate" | "dmTemplate">,
  ) => saveSettings(b),
}));

let role = "OWNER";
vi.mock("../src/lib/session.js", async (original) => ({
  ...(await original<typeof import("../src/lib/session.js")>()),
  useSession: () => ({ data: { role } }),
}));
// The rest of the Settings tab, kept quiet.
const OFF = { stock: false, price: false, reserve: false, photos: false };
vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getCapabilities: async () => ({ set: OFF, effective: OFF }),
  listPersonas: async () => ({ personas: [] }),
  getChatModel: async () => ({ model: null, envModel: null, models: [] }),
  getChatUsage: async () => ({ windows: [] }),
  getNumberList: async () => ({ numbers: [], entries: [] }),
}));
vi.mock("../src/lib/whatsappApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/whatsappApi.js")>()),
  getWhatsAppConnection: async () => ({ gateway: "NOT_CONFIGURED" }),
}));

const { InstagramCard } =
  await import("../src/routes/chatbot/InstagramCard.js");
const { BotSettings } = await import("../src/routes/chatbot/BotSettings.js");

function drawCard() {
  return render(
    <AntdApp>
      <InstagramCard now={() => NOW} />
    </AntdApp>,
  );
}

beforeEach(() => {
  role = "OWNER";
  getConnection.mockClear();
  getSettings.mockClear();
  saveSettings.mockClear();
});

describe("the Instagram card", () => {
  it("shows the account, a token about to expire and no delivery yet", async () => {
    drawCard();
    expect(
      await screen.findByText("@macbooknusantara (Macbook Nusantara)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("BUSINESS")).toBeInTheDocument();
    // Just under five days left: under ten, so it warns.
    expect(screen.getByTestId("ig-token-warning")).toHaveTextContent(
      "4 day(s) left",
    );
    expect(screen.getByText("No delivery from Meta yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Off: replies stop 24 hours after the customer's last message",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/first top-level comment on a post, once/),
    ).toBeInTheDocument();
  });

  it("warns when nobody knows when the token expires", async () => {
    getConnection.mockResolvedValueOnce({
      ...CONNECTION,
      account: { ...CONNECTION.account!, tokenExpiresAt: null },
    });
    drawCard();
    expect(await screen.findByTestId("ig-token-warning")).toHaveTextContent(
      "Expiry not known yet",
    );
  });

  it("saves the auto-reply, grey until something changed", async () => {
    const user = userEvent.setup();
    drawCard();
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.click(
      screen.getByRole("switch", { name: "Auto-reply to comments" }),
    );
    expect(save).toBeEnabled();
    const dm = screen.getByRole("textbox", { name: "Private DM" });
    await user.clear(dm);
    await user.type(dm, "Halo kak, cek DM ya");
    await user.click(save);

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledWith({
      autoReply: true,
      replyTemplate: "Cek DM ya kak",
      dmTemplate: "Halo kak, cek DM ya",
    });
    // Saved: nothing changed against what is stored now. (The name is
    // matched loosely: jsdom leaves antd's loading icon mid-motion.)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save$/ })).toBeDisabled(),
    );
  });

  it("refuses an auto-reply with no public reply", async () => {
    const user = userEvent.setup();
    drawCard();
    await screen.findByRole("button", { name: "Save" });
    await user.click(
      screen.getByRole("switch", { name: "Auto-reply to comments" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Public reply" }));
    expect(
      screen.getByText("Write the public reply, or switch auto-reply off."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("on the Settings tab", () => {
  it("is drawn for the owner", async () => {
    render(
      <AntdApp>
        <BotSettings />
      </AntdApp>,
    );
    const title = await screen.findByText("Comment auto-reply");
    expect(title.closest(".ant-card")).not.toBeNull();
    expect(getConnection).toHaveBeenCalled();
  });

  it("is hidden from staff", async () => {
    role = "STAFF";
    render(
      <AntdApp>
        <BotSettings />
      </AntdApp>,
    );
    // The rest of the tab has drawn.
    expect(await screen.findByText("Tester numbers")).toBeInTheDocument();
    expect(screen.queryByText("Comment auto-reply")).toBeNull();
    expect(getConnection).not.toHaveBeenCalled();
    expect(within(document.body).queryByText("Token expires")).toBeNull();
  });
});
