/**
 * The worker's half of `/api/agent/v1` (chatbot v2 step 3): with the agent
 * API configured, a stock lookup leaves the worker as an HTTP request whose
 * token names the thread's customer — and the knowledge search does not leave
 * at all. Without it, nothing changes (every other test in this folder).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import {
  verifyAgentToken,
  type AgentCapabilities,
  type AgentClient,
  type CreateArgs,
} from "@nusantara/agent";
import { draftPass } from "../src/draft.js";

/**
 * These tests are about the single AI agent (pipeline v1). The default is the
 * rules-first bot since 2026-10-15, so the setting is pinned here.
 */
async function pinPipelineV1(client: {
  appSetting: PrismaClient["appSetting"];
}) {
  await client.appSetting.upsert({
    where: { key: "chatbot.pipeline" },
    update: { value: "v1" },
    create: { key: "chatbot.pipeline", value: "v1", updatedAt: new Date() },
  });
}

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
const NOW = new Date("2026-08-20T03:00:00.000Z");
const SECRET = "worker-agent-api-secret";
const FROM = "628111000501";
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "chatbot.pipeline" } });
  await db.$disconnect();
});

beforeEach(async () => {
  await pinPipelineV1(db);
  await db.outbox.deleteMany({});
  await db.waThreadMemory.deleteMany({});
  await db.chatAction.deleteMany({});
  await db.customerProfileFact.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  // Chunks first: their message links are RESTRICT (20261022120000).
  await db.chatMemoryChunk.deleteMany({});
  await db.waMessage.deleteMany({});
  await db.waMessage.create({
    data: {
      waMessageId: "api.1",
      from: FROM,
      name: "Test",
      text: "halo kak",
      msgType: "text",
      ts: new Date(NOW.getTime() - 20_000),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
});

/** Looks at stock and the knowledge base, then greets. */
function model(): AgentClient {
  let n = 0;
  const create = async (_args: CreateArgs) => {
    n += 1;
    const content =
      n === 1
        ? [
            {
              type: "tool_use" as const,
              id: "t1",
              name: "search_stock",
              input: { query: "air m2", maxPrice: 15_000_000 },
            },
            {
              type: "tool_use" as const,
              id: "t2",
              name: "search_knowledge",
              input: { query: "garansi" },
            },
          ]
        : [
            {
              type: "tool_use" as const,
              id: `t${n + 1}`,
              name: "reply",
              input: { message: "halo kak", sources: "greeting" },
            },
          ];
    return { content, stop_reason: "tool_use" as const };
  };
  return { messages: { create } } as unknown as AgentClient;
}

describe("the POS tools over the agent API", () => {
  it("sends the stock lookup with this customer's token and keeps the knowledge search local", async () => {
    const calls: { url: string; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>)["authorization"]!,
      });
      return new Response(JSON.stringify({ units: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await draftPass({
      db,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      capabilities: LIVE,
      now: () => NOW,
      agentApi: {
        baseUrl: "http://127.0.0.1:4000/api/agent/v1",
        secret: SECRET,
        fetchImpl,
      },
    });

    expect(result.drafted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "http://127.0.0.1:4000/api/agent/v1/stock?query=air+m2&maxPrice=15000000",
    );
    const claims = verifyAgentToken(calls[0]!.auth.slice(7), SECRET, NOW);
    expect(claims).toMatchObject({ waId: FROM, writes: true });
  });
});
