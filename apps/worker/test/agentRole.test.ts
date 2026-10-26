/**
 * The whole worker, logged in as the role production gives it.
 *
 * Until 2026-10-15 every worker test logged in as the schema owner, which may
 * do anything — and the Mac mini's worker turned out to log in as
 * nusantara_app, under which the summary pass's updates were refused and
 * swallowed. The owner's ruling the same day: the worker runs as
 * nusantara_agent and the two roles stay separate. So this file runs every
 * pass the worker has as nusantara_agent, against fixtures the owner wrote,
 * and a grant missing for any of them fails here rather than on the shop's
 * Mac mini.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import {
  dispatchTool,
  resetPointFor,
  TESTERS_SETTING_KEY,
  type AgentCapabilities,
  type AgentClient,
  type CreateArgs,
} from "@nusantara/agent";
import { draftPass } from "../src/draft.js";
import { sendPass } from "../src/send.js";
import { summaryPass } from "../src/summarise.js";
import { memoryPass } from "../src/memoryPass.js";
import { expirePass } from "../src/expire.js";
import { resetPass } from "../src/reset.js";
import { claimThread } from "../src/lease.js";
import { checkDatabaseRole } from "../src/role.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
/**
 * The same database as another role. Parsed, not string-replaced: CI's URL
 * carries a password (`nusantara:nusantara@`), and a replace that matched
 * only `//nusantara@` left it unchanged — so every "as nusantara_agent" test
 * quietly ran as the owner and the refusals never happened. The roles log in
 * without one (trust locally and in CI).
 */
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

const logger = createLogger({
  app: "worker",
  env: "test",
  level: process.env["ROLE_DEBUG"] ? "warn" : "fatal",
});
const NOW = new Date("2026-08-20T03:00:00.000Z");
const AGENT_STAFF = "staff_agent";
const FROM = "628111000601";
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
  await owner.$connect();
  await agent.$connect();
});

afterAll(async () => {
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
});

async function inbound(id: string, text: string, ts: Date, from = FROM) {
  await owner.waMessage.create({
    data: {
      waMessageId: id,
      from,
      name: "Test",
      text,
      msgType: "text",
      ts,
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

/** One sellable unit, as the ledger makes one. */
async function seedUnit(serial = "SERX") {
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
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.unit.create({
    data: {
      id: "u_x",
      serial,
      skuId: "sku_t",
      status: "QC",
      locationId: "loc_t",
      buy: 12_000_000n,
      landed: 12_000_000n,
      grade: "A",
      intakeAt: NOW,
      version: 1,
    },
  });
  await owner.$transaction(async (tx) => {
    await appendUnitEvent(tx, {
      serial,
      type: "DITERIMA",
      staffId: AGENT_STAFF,
      at: NOW,
      toLocationId: "loc_t",
    });
    await appendUnitEvent(tx, {
      serial,
      type: "QC_SELESAI",
      staffId: AGENT_STAFF,
      at: NOW,
    });
  });
}

/** A model that greets, or summarises when asked to. */
function model(): AgentClient {
  const create = async (args: CreateArgs) => {
    const tools = (args as { tools?: unknown[] }).tools;
    if (!tools || tools.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "Pelanggan menyapa.", citations: [] },
        ],
        stop_reason: "end_turn" as const,
      };
    }
    return {
      content: [
        {
          type: "tool_use" as const,
          id: "t1",
          name: "reply",
          input: { message: "halo kak", sources: "greeting" },
        },
      ],
      stop_reason: "tool_use" as const,
    };
  };
  return { messages: { create } } as unknown as AgentClient;
}

describe("the worker as nusantara_agent", () => {
  it("is who it says it is", async () => {
    expect(await checkDatabaseRole(agent, "prod", logger)).toBe(true);
  });

  it("drafts, claims the thread and queues the reply", async () => {
    await inbound("r.1", "halo kak", new Date(NOW.getTime() - 20_000));
    const result = await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      concurrency: 2,
      now: () => NOW,
    });
    expect(result.drafted).toBe(1);
    expect(await owner.outbox.count()).toBe(1);
  });

  it("sends what is queued", async () => {
    await inbound("s.1", "halo kak", new Date(NOW.getTime() - 20_000));
    await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await sendPass({
      db: agent,
      logger,
      credentials: {
        whatsappToken: "t",
        phoneNumberId: "1",
        graphVersion: "v25.0",
      },
      maxSendsPerTick: 5,
      fetchImpl,
      // The real clock: the outbox row was queued with it, and a send pass
      // in the test's August would find nothing due yet.
      now: () => new Date(Date.now() + 1_000),
    });
    expect(result.sent).toBe(1);
  });

  it("keeps the thread's note — the write production was refusing", async () => {
    for (let i = 0; i < 4; i += 1) {
      await owner.waMessage.create({
        data: {
          waMessageId: `n.${i}`,
          from: FROM,
          name: "Test",
          text: `pesan ${i}`,
          msgType: "text",
          ts: new Date(NOW.getTime() - 3_600_000 + i * 60_000),
          direction: "IN",
          status: "DIJAWAB_AGEN",
          entities: {},
          replyText: `balasan ${i}`,
          answeredByAgent: true,
          answeredAt: new Date(NOW.getTime() - 3_600_000 + i * 60_000 + 5_000),
        },
      });
    }
    // Twice, so the second is the UPDATE branch nusantara_app was denied.
    for (const at of [NOW, new Date(NOW.getTime() + 3_600_000)]) {
      await owner.waMessage.create({
        data: {
          waMessageId: `n.later.${at.getTime()}`,
          from: FROM,
          name: "Test",
          text: "lagi",
          msgType: "text",
          ts: new Date(at.getTime() - 1_800_000),
          direction: "IN",
          status: "DIJAWAB_AGEN",
          entities: {},
          replyText: "ya kak",
          answeredByAgent: true,
          answeredAt: new Date(at.getTime() - 1_790_000),
        },
      });
      await summaryPass({
        db: agent,
        logger,
        anthropic: { apiKey: "sk-ant-test" },
        client: model(),
        everyTurns: 1,
        quietMs: 60_000,
        maxPerTick: 3,
        now: () => at,
      });
    }
    const memory = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memory.summary).toMatch(/^Pelanggan menyapa/);
    expect(memory.summaryAt?.getTime()).toBe(NOW.getTime() + 3_600_000);
  });

  it("books a visit, then lets it go when nobody came", async () => {
    await seedUnit();
    const booked = (await dispatchTool(
      agent,
      "create_reservation",
      { when: "2026-08-21T15:00", serial: "SERX", custName: "Budi" },
      {
        from: FROM,
        now: NOW,
        capabilities: LIVE,
        reserve: { write: agent, staffId: AGENT_STAFF },
        writesUsed: new Set(),
        onError: (_t, e) => {
          throw e;
        },
      },
    )) as { ok?: boolean };
    expect(booked.ok).toBe(true);

    const result = await expirePass({
      db: agent,
      logger,
      agentStaffId: AGENT_STAFF,
      graceMs: 3_600_000,
      ttlMs: 48 * 3_600_000,
      maxPerTick: 5,
      now: () => new Date(NOW.getTime() + 3 * 86_400_000),
    });
    expect(result.expired).toBe(1);
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "SERX" } }))
        .status,
    ).toBe("TERSEDIA");
  });

  it("starts a tester's chat over", async () => {
    await owner.appSetting.create({
      data: { key: TESTERS_SETTING_KEY, value: FROM, updatedAt: NOW },
    });
    await inbound("x.1", "/new", new Date(NOW.getTime() - 5_000));
    const result = await resetPass({ db: agent, logger, now: () => NOW });
    expect(result.reset).toBe(1);
  });
});

describe("a chat staff cleared, read as nusantara_agent (2026-10-27)", () => {
  const CLEARED = new Date(NOW.getTime() - 600_000);

  /** An old turn, a note about it, and the staff clear after both. */
  async function clearedThread() {
    await owner.waMessage.create({
      data: {
        waMessageId: "c.old",
        from: FROM,
        name: "Test",
        text: "garansinya berapa lama",
        msgType: "text",
        ts: new Date(NOW.getTime() - 3_600_000),
        direction: "IN",
        status: "DIJAWAB_AGEN",
        entities: {},
        replyText: "Garansi SATU-BULAN ya kak",
        answeredByAgent: true,
        answeredAt: new Date(NOW.getTime() - 3_590_000),
      },
    });
    await owner.waThreadMemory.create({
      data: {
        from: FROM,
        summary: "Pelanggan mencari Air M1.",
        summaryAt: new Date(NOW.getTime() - 3_000_000),
        summaryTurns: 1,
        // Behind the old turn, so only the clear keeps it out of the note.
        coveredThroughAt: new Date(NOW.getTime() - 4_000_000),
        clarifyCount: 0,
        updatedAt: CLEARED,
        // What POST /api/inbox/:phone/clear writes, as the app role.
        clearedAt: CLEARED,
        clearedById: AGENT_STAFF,
      },
    });
    await inbound("c.new", "halo lagi", new Date(NOW.getTime() - 20_000));
  }

  /** A model that records what it was shown. */
  function recorder() {
    const shown: string[] = [];
    const base = model();
    const create = async (args: CreateArgs) => {
      shown.push(JSON.stringify([args.system, args.messages]));
      return base.messages.create(args);
    };
    return {
      shown,
      client: { messages: { create } } as unknown as AgentClient,
    };
  }

  it("starts the conversation at the clear", async () => {
    await clearedThread();
    expect((await resetPointFor(agent, FROM))?.getTime()).toBe(
      CLEARED.getTime(),
    );
    const { shown, client } = recorder();
    const result = await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client,
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
    });
    expect(result.drafted).toBe(1);
    const all = shown.join("\n");
    expect(all).toContain("halo lagi");
    expect(all).not.toContain("SATU-BULAN");
    expect(all).not.toContain("Pelanggan mencari Air M1");
  });

  it("summarises and chunks only what came after it", async () => {
    await clearedThread();
    await owner.waMessage.update({
      where: { waMessageId: "c.new" },
      data: {
        status: "DIJAWAB_AGEN",
        replyText: "halo kak",
        answeredByAgent: true,
        answeredAt: new Date(NOW.getTime() - 10_000),
      },
    });
    const { shown, client } = recorder();
    const summary = await summaryPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client,
      everyTurns: 1,
      quietMs: 60_000,
      maxPerTick: 3,
      now: () => NOW,
    });
    expect(summary.refreshed).toBe(1);
    expect(shown.join("\n")).toContain("halo lagi");
    expect(shown.join("\n")).not.toContain("SATU-BULAN");
    expect(shown.join("\n")).not.toContain("Pelanggan mencari Air M1");
    const memory = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(memory.summaryTurns).toBe(1);
    expect(memory.clearedAt?.getTime()).toBe(CLEARED.getTime());

    const chunks = await memoryPass({
      db: agent,
      logger,
      voyage: null,
      maxTurns: 40,
      maxEmbeds: 32,
    });
    expect(chunks.chunked).toBe(1);
    const rows = await owner.chatMemoryChunk.findMany({
      select: { text: true },
    });
    expect(rows.map((r) => r.text).join()).not.toContain("SATU-BULAN");
  });

  it("may read the clear and never write it", async () => {
    await clearedThread();
    await expect(
      agent.waThreadMemory.update({
        where: { from: FROM },
        data: { clearedAt: null, clearedById: null },
      }),
    ).rejects.toThrow();
    await expect(
      agent.$queryRaw`SELECT wa_thread_delete(${FROM}, ${AGENT_STAFF}, now()::timestamp)`,
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the roles stay separate", () => {
  it("refuses the lease to nusantara_app", async () => {
    const app = new PrismaClient({
      datasources: { db: { url: asRole("nusantara_app") } },
    });
    try {
      await expect(claimThread(app, FROM, "w", NOW)).rejects.toThrow();
    } finally {
      await app.$disconnect();
    }
  });

  it("will not start in production as any other role", async () => {
    const app = new PrismaClient({
      datasources: { db: { url: asRole("nusantara_app") } },
    });
    try {
      expect(await checkDatabaseRole(app, "prod", logger)).toBe(false);
      // Outside production a different role is a warning, not a stop: a
      // developer's worker logs in as the schema owner.
      expect(await checkDatabaseRole(app, "dev", logger)).toBe(true);
    } finally {
      await app.$disconnect();
    }
  });
});
