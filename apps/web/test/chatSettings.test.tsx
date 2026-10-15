/**
 * The chatbot's Settings tab (2026-10-15): the three agents with their
 * personas, the pipeline and lead threshold, and the simulator — which sends
 * the whole conversation so far and prints what each answer cost.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/lib/api.js";
import type { AgentPersona, SimulationResult } from "../src/lib/chatApi.js";

const OFF = { stock: false, price: false, reserve: false, photos: false };
const AGENTS: AgentPersona[] = [
  {
    agent: "ROUTER",
    name: "Router / Guard",
    task: "Reads each message and decides who answers.",
    model: "claude-sonnet-5-5",
    prompt: "You are the router.",
    isDefault: true,
    updatedAt: null,
    inRules: "Rules, no AI: reads the intent from keywords.",
  },
  {
    agent: "ADVISOR",
    name: "Sales Advisor",
    task: "Writes every reply to the customer.",
    model: "claude-sonnet-5-5",
    prompt: "You are the shop's advisor.",
    isDefault: false,
    updatedAt: "2026-10-14T00:00:00.000Z",
    inRules: "Templates; AI only for what no rule covers.",
  },
  {
    agent: "OPERATIONS",
    name: "Operations",
    task: "Reads stock, prices and bookings from the POS.",
    model: "claude-haiku-4-5",
    prompt: "You call the POS.",
    isDefault: true,
    updatedAt: null,
    inRules: "No AI: direct POS lookups.",
  },
];

const RESULT: SimulationResult = {
  reply: "Halo kak! Ada yang bisa dibantu? 😊",
  handoff: null,
  photos: ["ph-1"],
  router: {
    language: "id",
    tone: "casual",
    intent: "greeting",
    leadScore: 10,
    escalate: null,
  },
  steps: [
    {
      agent: "ROUTER",
      model: "claude-sonnet-5-5",
      tool: null,
      ok: true,
      ms: 900,
      inputTokens: 1000,
      outputTokens: 50,
    },
    {
      agent: "OPERATIONS",
      model: "claude-haiku-4-5",
      tool: "find_units",
      ok: true,
      ms: 400,
      inputTokens: 500,
      outputTokens: 20,
    },
  ],
  costMicros: 4200,
  latencyMs: 2300,
  pipeline: "v2",
  shown: [],
  usedAi: true,
};

const saveAgentPrompt = vi.fn(async (agent: string, prompt: string) => ({
  agent: { ...AGENTS[0]!, agent, prompt, isDefault: false },
}));
const setChatSettings = vi.fn(async (body: object) => ({
  pipeline: "v2",
  leadThreshold: 60,
  ...body,
}));
const simulate = vi.fn(
  async (_turns: unknown, _lastShown?: unknown): Promise<SimulationResult> =>
    RESULT,
);
let pipeline: "rules" | "v1" | "v2" = "v2";

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getCapabilities: async () => ({ set: OFF, effective: OFF }),
  getTesters: async () => ({ numbers: [] }),
  getChatSettings: async () => ({ pipeline, leadThreshold: 60 }),
  setChatSettings: (body: object) => setChatSettings(body),
  listAgents: async () => ({ agents: AGENTS }),
  saveAgentPrompt: (a: string, p: string) => saveAgentPrompt(a, p),
  resetAgentPrompt: async () => ({ agent: AGENTS[1] }),
  simulate: (turns: unknown, lastShown?: unknown) => simulate(turns, lastShown),
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

beforeEach(() => {
  pipeline = "v2";
  saveAgentPrompt.mockClear();
  setChatSettings.mockClear();
  simulate.mockClear();
});

describe("the agents", () => {
  it("lists the three agents with their task and model", async () => {
    draw();
    for (const a of AGENTS) {
      expect(await screen.findByText(a.task)).toBeInTheDocument();
    }
    expect(screen.getByText("claude-haiku-4-5")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Persona of / }),
    ).toHaveLength(3);
  });

  it("opens a persona in a dialog and saves an edit", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(
      await screen.findByRole("button", { name: "Persona of Router / Guard" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Default");
    // Nothing to reset while it is still the default.
    expect(
      within(dialog).getByRole("button", { name: "Reset to default" }),
    ).toBeDisabled();
    const box = within(dialog).getByRole("textbox", { name: "Persona prompt" });
    expect(box).toHaveValue("You are the router.");

    await user.type(box, " Be brief.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveAgentPrompt).toHaveBeenCalledWith(
        "ROUTER",
        "You are the router. Be brief.",
      ),
    );
  });

  it("switches the pipeline", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByText("Single agent (v1)"));
    await waitFor(() =>
      expect(setChatSettings).toHaveBeenCalledWith({ pipeline: "v1" }),
    );
  });
});

describe("the simulator", () => {
  it("sends the conversation and shows what the answer cost", async () => {
    const user = userEvent.setup();
    draw();
    const box = await screen.findByRole("textbox", { name: "Your message" });
    await user.type(box, "Halo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Halo kak! Ada yang bisa dibantu? 😊"),
    ).toBeInTheDocument();
    expect(simulate).toHaveBeenCalledWith([{ role: "user", text: "Halo" }], []);
    const bubble = screen.getByTestId("sim-bot-bubble");
    expect(bubble).toHaveTextContent("AI cost: $0.0042");
    expect(bubble).toHaveTextContent("2.3 s");
    expect(bubble).toHaveTextContent("Would attach photos: ph-1");

    // The steps are folded shut until asked for.
    expect(bubble).not.toHaveTextContent("find_units");
    await user.click(within(bubble).getByRole("button", { name: /2 steps/ }));
    expect(bubble).toHaveTextContent(
      "Operations · claude-haiku-4-5 · find_units · 400 ms",
    );

    // The second message carries the first exchange with it.
    await user.type(box, "Air M2 ada?{Enter}");
    await waitFor(() =>
      expect(simulate).toHaveBeenLastCalledWith(
        [
          { role: "user", text: "Halo" },
          { role: "assistant", text: RESULT.reply },
          { role: "user", text: "Air M2 ada?" },
        ],
        [],
      ),
    );

    // Start over clears it.
    await user.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() =>
      expect(screen.queryByTestId("sim-bot-bubble")).not.toBeInTheDocument(),
    );
  });

  it("says the bot has no credential on a 503", async () => {
    simulate.mockRejectedValueOnce(
      new ApiRequestError(503, {
        code: "AGEN_NONAKTIF",
        message: "Agen tidak aktif.",
      }),
    );
    const user = userEvent.setup();
    draw();
    await user.type(
      await screen.findByRole("textbox", { name: "Your message" }),
      "Halo{Enter}",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no Claude credential",
    );
  });
});

describe("rules first (owner, 2026-10-15: AI only where rules cannot answer)", () => {
  it("shows the rules choice, each agent's rules job, and when no AI was used", async () => {
    pipeline = "rules";
    simulate.mockImplementation(async () => ({
      ...RESULT,
      reply:
        "Ada kak 😊 Ini yang ready:\n1. MacBook Air M2 8/256, grade A — Rp 11.900.000",
      photos: [],
      costMicros: 0,
      pipeline: "rules",
      shown: ["SER1"],
      usedAi: false,
    }));
    const user = userEvent.setup();
    draw();

    expect(
      await screen.findByText("Rules first (AI only as fallback)"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Rules, no AI: reads the intent from keywords."),
    ).toBeInTheDocument();

    const box = await screen.findByRole("textbox", { name: "Your message" });
    await user.type(box, "ada air m2?{Enter}");
    const bubble = await screen.findByTestId("sim-bot-bubble");
    expect(bubble).toHaveTextContent("No AI used");
    expect(bubble).not.toHaveTextContent("AI cost");

    // The next message carries what the bot showed, so "yang pertama" works.
    await user.type(box, "yang pertama berapa?{Enter}");
    await waitFor(() =>
      expect(simulate).toHaveBeenLastCalledWith(expect.any(Array), ["SER1"]),
    );
    simulate.mockImplementation(async () => RESULT);
  });
});
