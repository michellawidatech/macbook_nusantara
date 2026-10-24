/**
 * The tester numbers beside the chatbot's switches (owner ask 2026-10-14):
 * who may type `/new` to start their chat over. Everybody sees the list; only
 * the owner can change it.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OFF = { stock: false, price: false, reserve: false, photos: false };
let role: "OWNER" | "STAFF" = "OWNER";
const setTesters = vi.fn(async (numbers: string[]) => ({ numbers }));

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getCapabilities: async () => ({ set: OFF, effective: OFF }),
  getTesters: async () => ({ numbers: ["628980092978"] }),
  setTesters: (numbers: string[]) => setTesters(numbers),
}));
vi.mock("../src/lib/session.js", async (original) => ({
  ...(await original<typeof import("../src/lib/session.js")>()),
  useSession: () => ({ data: { role } }),
}));

const { BotSwitches } = await import("../src/routes/chatbot/BotSwitches.js");

vi.setConfig({ testTimeout: 60_000 });

async function openDialog() {
  render(
    <AntdApp>
      <BotSwitches />
    </AntdApp>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Testers (1)" }),
  );
  return screen.findByRole("dialog");
}

beforeEach(() => {
  role = "OWNER";
  setTesters.mockClear();
});

describe("the tester numbers", () => {
  it("lets the owner add a number and save the list", async () => {
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("628980092978");
    expect(dialog).toHaveTextContent(/sends \/new starts their chat over/);

    await userEvent.type(
      within(dialog).getByRole("combobox"),
      "08111000888{Enter}",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(setTesters).toHaveBeenCalledWith(["628980092978", "08111000888"]),
    );
    // The server answers with the list as stored; the button counts that.
    expect(
      await screen.findByRole("button", { name: "Testers (2)" }),
    ).toBeInTheDocument();
  });

  it("shows staff the list and does not let them change it", async () => {
    role = "STAFF";
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("628980092978");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(dialog).toHaveTextContent("Only the owner can change this.");
  });
});
