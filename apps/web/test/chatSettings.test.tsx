/**
 * The chatbot's Settings tab (2026-10-15): the agent with its persona and the
 * simulator — which sends the whole conversation so far and prints what each
 * answer cost. ONE agent and nothing to choose since 2026-10-21: no pipeline
 * picker, no lead threshold.
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
const simulate = vi.fn(
  async (_turns: unknown, _lastShown?: unknown): Promise<SimulationResult> =>
    RESULT,
);
let pipeline: "rules" | "v1" | "v2" = "v1";

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  getCapabilities: async () => ({ set: OFF, effective: OFF }),
  getTesters: async () => ({ numbers: [] }),
  getChatSettings: async () => ({ pipeline, leadThreshold: 60 }),
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
  pipeline = "v1";
  saveAgentPrompt.mockClear();
  simulate.mockClear();
});

describe("the agent", () => {
  it("lists the one agent, and offers nothing to choose", async () => {
    draw();
    expect(
      await screen.findByText("Writes every reply to the customer."),
    ).toBeInTheDocument();
    // Router and Operations belong to the dormant three-agent bot.
    expect(
      screen.queryByText("Reads each message and decides who answers."),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Persona of / }),
    ).toHaveLength(1);
    // No pipeline picker and no lead threshold (owner, 2026-10-21).
    expect(screen.queryByText("Single agent (v1)")).not.toBeInTheDocument();
    expect(screen.queryByText("Three agents (v2)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lead threshold")).not.toBeInTheDocument();
  });

  it("opens the persona in a dialog and saves an edit", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(
      await screen.findByRole("button", { name: "Persona of Sales Advisor" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Edited");
    const box = within(dialog).getByRole("textbox", { name: "Persona prompt" });
    expect(box).toHaveValue("You are the shop's advisor.");

    await user.type(box, " Be brief.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveAgentPrompt).toHaveBeenCalledWith(
        "ADVISOR",
        "You are the shop's advisor. Be brief.",
      ),
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

describe("without a credential the rules answer (2026-10-21)", () => {
  it("shows the agent's rules job, and when no AI was used", async () => {
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
      await screen.findByText("Templates; AI only for what no rule covers."),
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
