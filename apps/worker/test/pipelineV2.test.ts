/**
 * Chatbot v2 in the worker, as production runs it: logged in as
 * nusantara_agent, Settings switched to the three agents, against a real
 * database. The model is scripted per agent; everything else is real — the
 * tools, the proposal, the hold, the trace and the lead.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import {
  PIPELINE_SETTING_KEY,
  type AgentCapabilities,
  type AgentClient,
  type CreateArgs,
} from "@nusantara/agent";
import { draftPass } from "../src/draft.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => URL.replace("//nusantara@", `//${role}@`);

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
/** Thursday 20 August 2026, 10:00 Jakarta. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const AGENT_STAFF = "staff_agent";
const FROM = "628111000901";
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

let owner: PrismaClient;
let agent: PrismaClient;

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: URL } } });
  agent = new PrismaClient({
    datasources: { db: { url: asRole("nusantara_agent") } },
  });
});

afterAll(async () => {
  // The shared test database must not stay on v2: every other worker suite
  // drafts on whatever pipeline the setting names.
  await owner.appSetting.deleteMany({ where: { key: PIPELINE_SETTING_KEY } });
  await owner.$disconnect();
  await agent.$disconnect();
});

beforeEach(async () => {
  await truncateAll(owner);
  await owner.staff.create({
    data: {
      id: AGENT_STAFF,
      username: "agent",
      name: "Agen WhatsApp",
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await owner.appSetting.create({
    data: { key: PIPELINE_SETTING_KEY, value: "v2", updatedAt: NOW },
  });
  await owner.location.create({
    data: {
      id: "loc_t",
      code: "T1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await owner.category.create({
    data: {
      id: "cat_t",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await owner.catalogModel.create({
    data: {
      id: "mdl_t",
      categoryId: "cat_t",
      name: "MacBook Pro 16 M3",
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Pro 16 M3 512GB",
      variantLabel: "18/512",
      grade: "A",
      price: 32_500_000n,
      landed: 28_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.unit.create({
    data: {
      id: "u_1",
      serial: "MBP1",
      skuId: "sku_t",
      status: "QC",
      locationId: "loc_t",
      buy: 28_000_000n,
      landed: 28_000_000n,
      grade: "A",
      intakeAt: NOW,
      version: 1,
    },
  });
  await owner.$transaction(async (tx) => {
    await appendUnitEvent(tx, {
      serial: "MBP1",
      type: "DITERIMA",
      staffId: AGENT_STAFF,
      at: NOW,
      toLocationId: "loc_t",
    });
    await appendUnitEvent(tx, {
      serial: "MBP1",
      type: "QC_SELESAI",
      staffId: AGENT_STAFF,
      at: NOW,
    });
  });
});

async function says(id: string, text: string, ago = 20_000) {
  await owner.waMessage.create({
    data: {
      waMessageId: id,
      from: FROM,
      name: "Budi",
      text,
      msgType: "text",
      ts: new Date(NOW.getTime() - ago),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

type Step = { tool: string; input: Record<string, unknown> } | string;

/** Per agent: the router's JSON, Operations' tool calls, the Advisor's reply. */
function model(router: object, ops: Step[], advisor: string) {
  let o = 0;
  const usage = { input_tokens: 800, output_tokens: 60 };
  const create = async (args: CreateArgs) => {
    if (args.output_config?.format)
      return {
        content: [
          { type: "text", text: JSON.stringify(router), citations: [] },
        ],
        usage,
      };
    if (args.tools?.some((t) => t.name === "done")) {
      const step = ops[o++] ?? { tool: "done", input: { summary: "done" } };
      const s =
        typeof step === "string"
          ? { tool: "done", input: { summary: step } }
          : step;
      return {
        content: [
          { type: "tool_use", id: `o${o}`, name: s.tool, input: s.input },
        ],
        usage,
      };
    }
    return {
      content: [{ type: "text", text: advisor, citations: [] }],
      usage,
    };
  };
  return { messages: { create } } as unknown as AgentClient;
}

const pass = (client: AgentClient) =>
  draftPass({
    db: agent,
    logger,
    anthropic: { apiKey: "sk-ant-test" },
    client,
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    capabilities: LIVE,
    agentStaffId: AGENT_STAFF,
    now: () => NOW,
  });

describe("chatbot v2 in the worker, as nusantara_agent", () => {
  it("answers a stock question, records the run and marks a likely buyer", async () => {
    await says("a.1", "kak ada macbook pro 16 m3?");
    const result = await pass(
      model(
        {
          language: "id",
          tone: "casual",
          intent: "ask_stock",
          lead_score: 75,
          needs_operations: true,
          operations_brief: "Find MacBook Pro 16 M3",
          escalate: "none",
        },
        [
          { tool: "search_stock", input: { query: "macbook pro 16 m3" } },
          "one unit",
        ],
        "Halo kak 😊 Mau dipakai untuk apa kak?",
      ),
    );
    expect(result.drafted).toBe(1);

    const run = await owner.agentRun.findFirstOrThrow({
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    expect(run).toMatchObject({
      from: FROM,
      pipeline: "v2",
      intent: "ask_stock",
      leadScore: 75,
      outcome: "REPLIED",
    });
    expect(run.costMicros).toBeGreaterThan(0n);
    expect(run.steps.map((s) => [s.agent, s.tool])).toEqual([
      ["ROUTER", null],
      ["OPERATIONS", null],
      ["OPERATIONS", "search_stock"],
      ["OPERATIONS", null],
      ["ADVISOR", null],
    ]);
    const mem = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(mem.leadScore).toBe(75);
    expect(mem.leadAt).not.toBeNull();
  });

  it("proposes a visit, then books it when the customer says yes", async () => {
    await says("b.1", "besok jam 2 saya ke toko ya, nama Budi");
    await pass(
      model(
        {
          language: "id",
          tone: "casual",
          intent: "reserve",
          lead_score: 90,
          needs_operations: true,
          operations_brief:
            "Prepare a visit for MBP1 2026-08-21 14:00 for Budi",
          escalate: "none",
        },
        [
          {
            tool: "propose_reservation",
            input: {
              serials: "MBP1",
              when: "2026-08-21T14:00",
              custName: "Budi",
            },
          },
          "proposed",
        ],
        "Baik kak Budi, MacBook Pro 16 M3 grade A, besok 21 Agustus jam 14.00 ya. Betul kak?",
      ),
    );
    expect(await owner.reservation.count()).toBe(0);
    expect(await owner.reservationProposal.count()).toBe(1);

    await says("b.2", "iya betul kak", 10_000);
    await pass(
      model(
        {
          language: "id",
          tone: "casual",
          intent: "confirm",
          lead_score: 95,
          needs_operations: false,
          operations_brief: "",
          escalate: "none",
        },
        [],
        "Terima kasih kak, sampai ketemu besok 😊",
      ),
    );

    const hold = await owner.reservation.findFirstOrThrow();
    expect(hold).toMatchObject({ status: "TERJADWAL", custName: "Budi" });
    const reply = await owner.outbox.findFirstOrThrow({
      where: { kind: "WA_REPLY" },
      orderBy: { createdAt: "desc" },
    });
    expect((reply.payload as { body: string }).body).toContain(hold.code);
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "MBP1" } }))
        .status,
    ).toBe("DIRESERVASI");
  });
});
