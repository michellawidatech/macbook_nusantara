/**
 * Chatbot v2's three agents, end to end, with the model scripted per agent
 * and the POS answered by a fake dispatcher — no database, no network.
 *
 * The claims that matter are the ones the owner made: the Sales Advisor
 * writes the reply; Operations finds the unit and its photos; a booking is
 * proposed, read back, and only confirmed when the customer says yes — by
 * code; and nothing the v1 checks refused gets through v2.
 */

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import {
  ADVISOR_MODEL,
  OPERATIONS_MODEL,
  ROUTER_MODEL,
  readVerdict,
  runPipeline,
  type AgentCapabilities,
  type AgentClient,
  type CreateArgs,
  type PipelineInput,
  type ToolContext,
} from "../src/index.js";
import type { KnowledgeBase } from "../src/knowledge.js";

const NOW = new Date("2026-10-15T03:00:00.000Z");
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

type Block = Anthropic.ContentBlock;
const text = (t: string): Block =>
  ({ type: "text", text: t, citations: [] }) as unknown as Block;
const use = (name: string, input: Record<string, unknown>, id = name): Block =>
  ({ type: "tool_use", id, name, input }) as unknown as Block;

interface Script {
  router: string;
  ops?: Block[][];
  advisor: Block[][];
}

/** Answers by agent: the router has a JSON format, Operations has `done`. */
function scripted(s: Script) {
  const calls: { agent: string; args: CreateArgs }[] = [];
  let ops = 0;
  let adv = 0;
  const usage = { input_tokens: 1000, output_tokens: 100 };
  const create = async (args: CreateArgs) => {
    if (args.output_config?.format) {
      calls.push({ agent: "router", args });
      return { content: [text(s.router)], stop_reason: "end_turn", usage };
    }
    if (args.tools?.some((t) => t.name === "done")) {
      calls.push({ agent: "ops", args });
      const content = s.ops?.[ops++] ?? [use("done", { summary: "nothing" })];
      return { content, stop_reason: "tool_use", usage };
    }
    calls.push({ agent: "advisor", args });
    const content = s.advisor[adv++] ?? [text("baik kak")];
    return { content, stop_reason: "end_turn", usage };
  };
  return {
    client: { messages: { create } } as unknown as AgentClient,
    calls,
  };
}

const verdict = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    language: "id",
    tone: "casual",
    intent: "ask_stock",
    lead_score: 40,
    needs_operations: true,
    operations_brief: "Find MacBook Pro 16 M3 in stock with photos",
    escalate: "none",
    ...over,
  });

const MBP = {
  serial: "C02MBP16M3",
  model: "MacBook Pro 16 M3",
  variant: "18/512",
  grade: "A",
  price: "Rp 32.500.000",
};

function fakePos(answers: Record<string, unknown>) {
  const asked: { name: string; input: unknown }[] = [];
  const dispatch = async (name: string, input: unknown) => {
    asked.push({ name, input });
    return answers[name] ?? { error: "not scripted" };
  };
  return { dispatch, asked };
}

const KB: KnowledgeBase = {
  entries: [],
  byHandle: new Map(),
} as unknown as KnowledgeBase;

function input(
  client: AgentClient,
  dispatch: (n: string, i: unknown) => Promise<unknown>,
  over: Partial<PipelineInput> = {},
): PipelineInput {
  const ctx: ToolContext = {
    from: "628111000701",
    now: NOW,
    capabilities: LIVE,
    reserve: { write: {} as PrismaClient, staffId: "staff_agent" },
    profile: { write: {} as PrismaClient },
    writesUsed: new Set(),
  };
  return {
    client,
    db: {} as PrismaClient,
    ctx,
    prompt: { stable: "You are the shop.", volatile: "" },
    turns: [{ role: "user", text: "kak ada macbook pro 16 m3?" }],
    knowledge: KB,
    storeFacts: "",
    capabilities: LIVE,
    dispatch,
    personas: { router: "router persona", operations: "ops persona" },
    leadThreshold: 60,
    ...over,
  };
}

describe("a stock question through three agents", () => {
  it("routes, looks the unit up, and lets the Advisor recommend it with its price and photos", async () => {
    const pos = fakePos({
      search_stock: { units: [MBP] },
      unit_photos: { serial: MBP.serial, photoIds: ["p1", "p2"] },
    });
    const model = scripted({
      router: verdict(),
      ops: [
        [use("search_stock", { query: "macbook pro 16 m3" })],
        [use("unit_photos", { serial: MBP.serial })],
        [use("done", { summary: "One MBP 16 M3 grade A, two photos." })],
      ],
      advisor: [
        [
          use("reply", {
            message:
              "Ada kak, MacBook Pro 16 M3 18/512 grade A, harganya Rp 32.500.000. Ini fotonya ya kak 😊 Mau dipakai untuk apa kak?",
            sources: "stock",
            photos: "p1 p2 p9",
          }),
        ],
      ],
    });

    const out = await runPipeline(input(model.client, pos.dispatch));

    expect(out).not.toBeNull();
    expect(out!.handoff).toBeUndefined();
    expect(out!.reply).toContain("Rp 32.500.000");
    // The photo Operations never saw is dropped, as in v1.
    expect(out!.photos).toEqual(["p1", "p2"]);
    expect(pos.asked.map((a) => a.name)).toEqual([
      "search_stock",
      "unit_photos",
    ]);
    expect(out!.verdict.intent).toBe("ask_stock");
    expect(out!.trace.map((t) => t.agent)).toEqual([
      "ROUTER",
      "OPERATIONS",
      "OPERATIONS",
      "OPERATIONS",
      "OPERATIONS",
      "OPERATIONS",
      "ADVISOR",
    ]);
    expect(out!.costMicros).toBeGreaterThan(0);
  });

  it("uses the agreed models: Sonnet to read and write people, Haiku for the POS", async () => {
    const model = scripted({
      router: verdict(),
      ops: [[use("done", { summary: "x" })]],
      advisor: [[text("halo kak")]],
    });
    await runPipeline(input(model.client, fakePos({}).dispatch));
    const byAgent = Object.fromEntries(
      model.calls.map((c) => [c.agent, c.args.model]),
    );
    expect(byAgent).toEqual({
      router: ROUTER_MODEL,
      ops: OPERATIONS_MODEL,
      advisor: ADVISOR_MODEL,
    });
    // Sonnet 5.5 refuses a forced tool choice; the Advisor runs on auto.
    const advisor = model.calls.find((c) => c.agent === "advisor")!.args;
    expect(advisor.tool_choice).toEqual({ type: "auto" });
    expect(advisor.temperature).toBeUndefined();
  });

  it("gives the Advisor no POS tools and Operations no way to book or confirm", async () => {
    const model = scripted({
      router: verdict(),
      ops: [[use("done", { summary: "x" })]],
      advisor: [[text("halo kak")]],
    });
    await runPipeline(input(model.client, fakePos({}).dispatch));
    const ops = model.calls.find((c) => c.agent === "ops")!.args.tools!;
    const advisor = model.calls.find((c) => c.agent === "advisor")!.args.tools!;
    const names = (ts: Anthropic.Tool[]) => ts.map((t) => t.name);
    expect(names(ops)).toContain("search_stock");
    expect(names(ops)).toContain("propose_reservation");
    expect(names(ops)).not.toContain("create_reservation");
    expect(names(ops)).not.toContain("confirm_reservation");
    expect(names(advisor)).not.toContain("search_stock");
    expect(names(advisor)).not.toContain("propose_reservation");
    expect(names(advisor)).toContain("reply");
    expect(names(advisor)).toContain("remember_customer");
  });
});

describe("the visit", () => {
  it("proposes, and the Advisor reads it back without claiming a booking", async () => {
    const pos = fakePos({
      propose_reservation: {
        ok: true,
        proposed: true,
        proposalId: "prop1",
        when: "2026-10-16 14:00",
        units: [MBP],
      },
    });
    const model = scripted({
      router: verdict({
        intent: "reserve",
        lead_score: 85,
        operations_brief:
          "Prepare a visit for C02MBP16M3 tomorrow 14:00 for Budi",
      }),
      ops: [
        [
          use("propose_reservation", {
            serials: MBP.serial,
            when: "2026-10-16T14:00",
            custName: "Budi",
          }),
        ],
        [use("done", { summary: "proposed" })],
      ],
      advisor: [[text("Siap kak Budi, besok 16 Okt jam 14.00 ya? Betul kak?")]],
    });
    const out = await runPipeline(input(model.client, pos.dispatch));
    expect(out!.proposed).toBe(true);
    expect(out!.bookings ?? []).toHaveLength(0);
    const note = JSON.stringify(
      model.calls.find((c) => c.agent === "advisor")!.args.messages,
    );
    expect(note).toContain("NOT booked yet");
  });

  it("books by code when the customer says yes, and announces the code", async () => {
    const pos = fakePos({
      confirm_reservation: {
        ok: true,
        code: "RV-2026/10-000123",
        when: "2026-10-16 14:00",
      },
    });
    const model = scripted({
      router: verdict({
        intent: "confirm",
        lead_score: 95,
        needs_operations: false,
      }),
      advisor: [[text("Terima kasih kak, sampai ketemu besok ya 😊")]],
    });
    const out = await runPipeline(
      input(model.client, pos.dispatch, {
        turns: [{ role: "user", text: "iya kak betul" }],
        openProposal: "MacBook Pro 16 M3, 16 Okt 14:00, Budi",
      }),
    );
    expect(pos.asked.map((a) => a.name)).toEqual(["confirm_reservation"]);
    expect(out!.reply).toContain("RV-2026/10-000123");
    expect(out!.bookings?.[0]?.code).toBe("RV-2026/10-000123");
    expect(model.calls.some((c) => c.agent === "ops")).toBe(false);
  });

  it("never confirms on anything but a yes", async () => {
    const pos = fakePos({ confirm_reservation: { ok: true, code: "RV-X" } });
    const model = scripted({
      router: verdict({ intent: "ask_price", needs_operations: false }),
      advisor: [[text("baik kak")]],
    });
    await runPipeline(
      input(model.client, pos.dispatch, { openProposal: "something" }),
    );
    expect(pos.asked).toHaveLength(0);
  });

  it("offers a visit to a likely buyer", async () => {
    const model = scripted({
      router: verdict({ lead_score: 80, needs_operations: false }),
      advisor: [[text("baik kak")]],
    });
    await runPipeline(input(model.client, fakePos({}).dispatch));
    const note = JSON.stringify(
      model.calls.find((c) => c.agent === "advisor")!.args.messages,
    );
    expect(note).toContain("arrange a visit");
  });
});

describe("what still goes to a person", () => {
  it("hands haggling to a colleague when the router says so", async () => {
    const model = scripted({
      router: verdict({
        intent: "negotiate",
        escalate: "negotiation",
        needs_operations: false,
      }),
      advisor: [
        [
          use("handoff_to_staff", {
            topic: "negotiation",
            summary: "Offers 30jt for the MBP",
            customer_message: "Baik kak, saya tanyakan ke admin dulu ya 🙏",
          }),
        ],
      ],
    });
    const out = await runPipeline(input(model.client, fakePos({}).dispatch));
    expect(out!.handoff?.topic).toBe("negotiation");
    const tools = model.calls.find((c) => c.agent === "advisor")!.args.tools!;
    expect(tools.map((t) => t.name)).not.toContain("reply");
  });

  it("refuses a price the shop's system never said", async () => {
    const model = scripted({
      router: verdict({ needs_operations: false }),
      advisor: [[text("Ada kak, harganya Rp 20.000.000 aja")]],
    });
    const out = await runPipeline(input(model.client, fakePos({}).dispatch));
    expect(out!.handoff).toBeDefined();
    expect(out!.reply).not.toContain("20.000.000");
  });

  it("carries on with a neutral reading when the router talks nonsense", async () => {
    const model = scripted({
      router: "not json",
      ops: [[use("done", { summary: "x" })]],
      advisor: [[text("halo kak")]],
    });
    const out = await runPipeline(input(model.client, fakePos({}).dispatch));
    expect(out!.verdict.intent).toBe("other");
    expect(out!.trace[0]).toMatchObject({ agent: "ROUTER", ok: false });
  });

  it("returns null — a person — when the model fails", async () => {
    const errors: unknown[] = [];
    const client = {
      messages: {
        create: async () => {
          throw new Error("401");
        },
      },
    } as unknown as AgentClient;
    const out = await runPipeline(
      input(client, fakePos({}).dispatch, { onError: (e) => errors.push(e) }),
    );
    expect(out).toBeNull();
    expect(errors).toHaveLength(1);
  });
});

describe("the router's JSON", () => {
  it("clamps the score and drops a topic it may not use", () => {
    const v = readVerdict(
      JSON.stringify({
        language: "en",
        tone: "formal",
        intent: "browse",
        lead_score: 140,
        needs_operations: false,
        operations_brief: "",
        escalate: "not-a-topic",
      }),
      "",
      LIVE,
    );
    expect(v).toMatchObject({ language: "en", leadScore: 100, escalate: null });
  });
});
