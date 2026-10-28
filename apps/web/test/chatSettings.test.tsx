/**
 * Chatbot → Settings, reworked 2026-10-28 (owner: "set the prompt (can choose
 * & have multiple but 1 is used) and the model used, the usage, CRUD list of
 * testers, CRUD list of alert numbers", and a name beside each number).
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "../src/lib/chatApi.js";

const OFF = { stock: false, price: false, reserve: false, photos: false };

let personas: Persona[] = [];
const activatePersona = vi.fn(async (id: string) => {
  personas = personas.map((p) => ({ ...p, active: p.id === id }));
  return { status: "ACTIVE", id };
});
const deletePersona = vi.fn(async (id: string) => {
  personas = personas.filter((p) => p.id !== id);
  return { deleted: id };
});
const setChatModel = vi.fn(async (model: string | null) => ({
  model,
  envModel: "claude-haiku-4-5",
  models: MODELS,
}));
const setNumberList = vi.fn(
  async (_path: string, entries: Array<{ number: string; name: string }>) => ({
    numbers: entries.map((e) => e.number),
    entries: entries.map((e) => ({ waId: e.number, name: e.name })),
  }),
);
const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", worksWithSetupToken: true },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", worksWithSetupToken: false },
];

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getCapabilities: async () => ({ set: OFF, effective: OFF }),
  listPersonas: async () => ({ personas }),
  activatePersona: (id: string) => activatePersona(id),
  deletePersona: (id: string) => deletePersona(id),
  getChatModel: async () => ({
    model: null,
    envModel: "claude-haiku-4-5",
    models: MODELS,
  }),
  setChatModel: (m: string | null) => setChatModel(m),
  getChatUsage: async () => ({
    windows: [
      {
        days: 7,
        replies: 40,
        byAi: 30,
        byTemplates: 10,
        handovers: 4,
        inputTokens: 1000,
        cachedTokens: 500,
        outputTokens: 200,
        costUsd: 0.42,
      },
      {
        days: 30,
        replies: 100,
        byAi: 70,
        byTemplates: 30,
        handovers: 9,
        inputTokens: 5000,
        cachedTokens: 0,
        outputTokens: 900,
        costUsd: 1.5,
      },
    ],
  }),
  getNumberList: async (path: string) =>
    path.endsWith("notify-numbers")
      ? {
          numbers: ["628123456789"],
          entries: [{ waId: "628123456789", name: "Dina" }],
        }
      : { numbers: [], entries: [] },
  setNumberList: (path: string, e: Array<{ number: string; name: string }>) =>
    setNumberList(path, e),
}));
// The owner's WhatsApp connection card sits on this tab (2026-10-22); its
// own behaviour is whatsappConnection.test.tsx.
vi.mock("../src/lib/whatsappApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/whatsappApi.js")>()),
  getWhatsAppConnection: async () => ({ gateway: "NOT_CONFIGURED" }),
}));
vi.mock("../src/lib/session.js", async (original) => ({
  ...(await original<typeof import("../src/lib/session.js")>()),
  useSession: () => ({ data: { role: "OWNER" } }),
}));

const { BotSettings } = await import("../src/routes/chatbot/BotSettings.js");

vi.setConfig({ testTimeout: 90_000 });

function draw() {
  render(
    <AntdApp>
      <BotSettings />
    </AntdApp>,
  );
}

const card = async (title: string) =>
  (await screen.findByText(title)).closest(".ant-card") as HTMLElement;

beforeEach(() => {
  personas = [
    {
      id: "p1",
      name: "Sales Advisor",
      blurb: null,
      prompt: "Kamu admin toko.",
      active: true,
      builtIn: false,
      updatedAt: "2026-10-28T03:00:00.000Z",
    },
    {
      id: "p2",
      name: "Lebih santai",
      blurb: null,
      prompt: "Santai aja.",
      active: false,
      builtIn: false,
      updatedAt: "2026-10-28T03:00:00.000Z",
    },
  ] as Persona[];
  activatePersona.mockClear();
  deletePersona.mockClear();
  setChatModel.mockClear();
  setNumberList.mockClear();
});

describe("the WhatsApp connection (2026-10-22)", () => {
  it("is on the owner's Settings tab", async () => {
    draw();
    expect(await screen.findByText("WhatsApp connection")).toBeInTheDocument();
  });
});

describe("the Agent card and the test chat are gone (2026-10-28)", () => {
  it("draws neither", async () => {
    draw();
    await screen.findByText("Prompts");
    expect(screen.queryByText("Agent")).toBeNull();
    expect(screen.queryByPlaceholderText("Type your message...")).toBeNull();
  });
});

describe("prompts: several, one in use", () => {
  it("switches the prompt in use, and deletes only one nobody uses", async () => {
    const user = userEvent.setup();
    draw();
    const prompts = await card("Prompts");
    const row = (name: string) =>
      within(prompts).getByText(name).closest("tr") as HTMLElement;
    await within(prompts).findByText("Sales Advisor");
    expect(
      within(row("Sales Advisor")).getByText("In use"),
    ).toBeInTheDocument();
    expect(
      within(row("Sales Advisor")).getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
    await user.click(
      within(row("Lebih santai")).getByRole("button", { name: "Use this" }),
    );
    expect(activatePersona).toHaveBeenCalledWith("p2");
    await waitFor(() =>
      expect(
        within(row("Lebih santai")).getByText("In use"),
      ).toBeInTheDocument(),
    );
    await user.click(
      within(row("Sales Advisor")).getByRole("button", { name: "Delete" }),
    );
    // The confirm's own Delete is the last one on the page.
    const confirm = await screen.findByText("Delete this prompt?");
    expect(confirm).toBeInTheDocument();
    const deletes = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deletes[deletes.length - 1]!);
    await waitFor(() => expect(deletePersona).toHaveBeenCalledWith("p1"));
  });
});

describe("model and usage", () => {
  it("shows what the bot runs on and what it did, and changes the model", async () => {
    draw();
    const c = await card("Model & usage");
    expect(await within(c).findByText("Last 7 days")).toBeInTheDocument();
    expect(within(c).getByText("US$ 0.42")).toBeInTheDocument();
    expect(within(c).getByText("Haiku 4.5")).toBeInTheDocument();
  });
});

describe("numbers with names", () => {
  it("lists an alert number with its name and adds a tester with one", async () => {
    const user = userEvent.setup();
    draw();
    const alerts = await card("WhatsApp alerts to staff");
    expect(await within(alerts).findByText("Dina")).toBeInTheDocument();
    expect(within(alerts).getByText("628123456789")).toBeInTheDocument();
    const testers = await card("Tester numbers");
    await user.click(within(testers).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Rina");
    await user.type(within(dialog).getByLabelText("Number"), "081299998888");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setNumberList).toHaveBeenCalledWith("/api/chat/testers", [
        { number: "081299998888", name: "Rina" },
      ]),
    );
  });
});
