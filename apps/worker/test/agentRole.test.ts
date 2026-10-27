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
  isLead,
  profileKnown,
  profileLine,
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
import { followUpPass } from "../src/followUp.js";
import { watchPass } from "../src/watchPass.js";

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

  it("drops a draft when the customer wrote again meanwhile (2026-10-27)", async () => {
    await inbound("sp.1", "Hmmm kemahalan", new Date(NOW.getTime() - 30_000));
    const base = model();
    let raced = false;
    const racing = {
      messages: {
        create: async (args: CreateArgs) => {
          if (!raced) {
            raced = true;
            await inbound(
              "sp.2",
              "ada yg 15 jutaan gak ya",
              new Date(NOW.getTime() - 20_000),
            );
          }
          return base.messages.create(args as never);
        },
      },
    } as unknown as AgentClient;
    const run = (client: AgentClient) =>
      draftPass({
        db: agent,
        logger,
        anthropic: { apiKey: "sk-ant-test" },
        client,
        debounceMs: 8_000,
        maxDraftsPerTick: 5,
        now: () => NOW,
        superseded: new Map(),
      });
    expect((await run(racing)).drafted).toBe(0);
    expect(await owner.outbox.count()).toBe(0);
    expect((await run(base)).drafted).toBe(1);
    expect(await owner.outbox.count()).toBe(1);
    expect(await owner.waMessage.count({ where: { status: "BARU" } })).toBe(0);
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

  it("books a visit holding nothing, then closes it when nobody came", async () => {
    await seedUnit();
    const booked = (await dispatchTool(
      agent,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "SERX", custName: "Budi" },
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
    // A visit: the unit never left the shelf.
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "SERX" } }))
        .status,
    ).toBe("TERSEDIA");

    const result = await expirePass({
      db: agent,
      logger,
      agentStaffId: AGENT_STAFF,
      graceMs: 3_600_000,
      ttlMs: 48 * 3_600_000,
      maxPerTick: 5,
      now: () => new Date(NOW.getTime() + 3 * 86_400_000),
    });
    expect(result).toEqual({ expired: 1, released: 0, dpExpired: 0 });
    expect((await owner.reservation.findFirstOrThrow()).status).toBe("BATAL");
    expect(await owner.unitEvent.count()).toBe(2);
  });

  it("starts a tester's chat over", async () => {
    await owner.appSetting.create({
      data: { key: TESTERS_SETTING_KEY, value: FROM, updatedAt: NOW },
    });
    await inbound("x.1", "/new", new Date(NOW.getTime() - 5_000));
    const old = new Date(NOW.getTime() - 3_600_000);
    await owner.waThreadMemory.create({
      data: {
        from: FROM,
        summaryTurns: 0,
        clarifyCount: 0,
        leadAt: old,
        leadScore: 88,
        updatedAt: old,
      },
    });
    await owner.customerProfile.create({
      data: {
        from: FROM,
        name: "Michella",
        useCase: "coding",
        occupation: "programmer",
        updatedAt: old,
        facts: {
          create: [
            { kind: "USAGE", value: "coding", source: "BOT", createdAt: old },
            {
              kind: "ABOUT",
              value: "Teman owner",
              source: "STAFF",
              createdById: AGENT_STAFF,
              createdAt: old,
            },
          ],
        },
      },
    });
    const result = await resetPass({ db: agent, logger, now: () => NOW });
    expect(result.reset).toBe(1);
    // It forgets the lead and what the bot learned, as Clear chat does
    // (2026-10-27) — every write within the agent's own grants.
    expect(
      await owner.waThreadMemory.findUniqueOrThrow({ where: { from: FROM } }),
    ).toMatchObject({ leadAt: null, leadScore: null });
    const profile = await owner.customerProfile.findUniqueOrThrow({
      where: { from: FROM },
      include: { facts: { orderBy: { kind: "asc" } } },
    });
    expect(profile).toMatchObject({
      name: null,
      useCase: null,
      occupation: null,
    });
    expect(profile.facts.map((f) => [f.source, f.removedAt !== null])).toEqual([
      ["BOT", true],
      ["STAFF", false],
    ]);
  });
});

describe("a hand-over, read as nusantara_agent (2026-10-27)", () => {
  const pass = () =>
    draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
    });

  beforeEach(async () => {
    // A question already with a colleague: its row and its open task.
    const held = await owner.waMessage.create({
      data: {
        waMessageId: "h.1",
        from: FROM,
        name: "Test",
        text: "air m1 bisa nego?",
        msgType: "text",
        ts: new Date(NOW.getTime() - 600_000),
        direction: "IN",
        status: "PERLU_STAF",
        entities: {},
        replyText: "Admin kami cek dulu ya kak 🙏",
        answeredByAgent: false,
        answeredAt: new Date(NOW.getTime() - 590_000),
        intent: "staf:negotiation",
      },
    });
    await owner.chatAction.create({
      data: {
        from: FROM,
        kind: "NEGOTIATION",
        topic: "negotiation",
        summary: "Perlu jawab tawaran — Air M1",
        customerText: "air m1 bisa nego?",
        messageId: held.id,
        createdAt: new Date(NOW.getTime() - 590_000),
        updatedAt: new Date(NOW.getTime() - 590_000),
      },
    });
  });

  it("answers the newer message and leaves the colleague's task open", async () => {
    await inbound("h.2", "halo kak", new Date(NOW.getTime() - 20_000));
    expect((await pass()).drafted).toBe(1);
    expect(
      await owner.waMessage.findUniqueOrThrow({
        where: { waMessageId: "h.2" },
      }),
    ).toMatchObject({ status: "DIJAWAB_AGEN" });
    expect(
      await owner.chatAction.count({ where: { from: FROM, status: "OPEN" } }),
    ).toBe(1);
  });

  it("stays out while a colleague is chatting", async () => {
    await owner.staff.create({
      data: {
        id: "staff_kasir",
        username: "kasir",
        name: "Kasir",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    await owner.waMessage.update({
      where: { waMessageId: "h.1" },
      data: {
        status: "DIJAWAB_STAF",
        replyText: "Bisa kak, 7,8jt ya",
        answeredById: "staff_kasir",
        answeredAt: new Date(NOW.getTime() - 60_000),
      },
    });
    await inbound("h.3", "oke kak", new Date(NOW.getTime() - 20_000));
    expect((await pass()).drafted).toBe(0);
    expect(await owner.outbox.count()).toBe(0);
  });
});

describe("out of stock, read as nusantara_agent (2026-10-27)", () => {
  it("offers what is in stock, and the accessory it may read since 20261027150000", async () => {
    await seedUnit();
    await owner.category.create({
      data: {
        id: "cat_acc",
        name: "Accessories",
        sortOrder: 2,
        marginMode: "PCT",
        marginMin: 5n,
        marginMax: 30n,
        createdAt: NOW,
        tracksSerial: false,
      },
    });
    await owner.catalogModel.create({
      data: {
        id: "mdl_acc",
        categoryId: "cat_acc",
        name: "Charger",
        archived: false,
        createdAt: NOW,
      },
    });
    await owner.sku.create({
      data: {
        id: "sku_acc",
        modelId: "mdl_acc",
        code: "ACC-1",
        name: "Charger MacBook Air 30W",
        price: 450_000n,
        landed: 1n,
        archived: false,
        createdAt: NOW,
      },
    });
    await owner.stockMove.create({
      data: {
        skuId: "sku_acc",
        locationId: "loc_t",
        qty: 2,
        unitCost: 1n,
        type: "MASUK",
        at: NOW,
        staffId: AGENT_STAFF,
      },
    });
    const ctx = { from: FROM, now: NOW, capabilities: LIVE };
    const asAgent = (await dispatchTool(
      agent,
      "search_stock",
      { query: "macbook air m3" },
      ctx,
    )) as Record<string, unknown>;
    expect(asAgent["error"]).toBeUndefined();
    expect(JSON.stringify(asAgent["alternatives"])).toContain("SERX");
    // nusantara_agent reads StockMove now (GRANT SELECT, 20261027150000).
    expect(asAgent["accessory"]).toMatchObject({
      model: "Charger MacBook Air 30W",
    });
    // The POS's agent API runs it as nusantara_app, which may read the ledger.
    const app = new PrismaClient({
      datasources: { db: { url: asRole("nusantara_app") } },
    });
    try {
      const asApp = (await dispatchTool(
        app,
        "search_stock",
        { query: "macbook air m3" },
        ctx,
      )) as Record<string, unknown>;
      expect(asApp["accessory"]).toMatchObject({
        model: "Charger MacBook Air 30W",
      });
    } finally {
      await app.$disconnect();
    }
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

  it("does not see the lead or the profile learned before it (2026-10-27)", async () => {
    await clearedThread();
    const before = new Date(CLEARED.getTime() - 60_000);
    await owner.waThreadMemory.update({
      where: { from: FROM },
      data: { leadAt: before, leadScore: 90 },
    });
    // A clear from before forgetProfile existed: the learned columns are
    // still there, so the bot must skip them by the reset point alone.
    await owner.customerProfile.create({
      data: {
        from: FROM,
        name: "Michella",
        useCase: "coding",
        budgetMax: 25_000_000n,
        updatedAt: before,
        facts: {
          create: [
            {
              kind: "USAGE",
              value: "CODINGNEEDLE",
              source: "BOT",
              createdAt: before,
            },
          ],
        },
      },
    });
    expect(await profileLine(agent, FROM, CLEARED)).toBeNull();
    expect(await profileKnown(agent, FROM, CLEARED)).toMatchObject({
      name: null,
      usage: false,
      budget: false,
      budgetMax: null,
    });
    const memory = await agent.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(isLead(memory, CLEARED)).toBe(false);
    expect(isLead(memory, null)).toBe(true);

    const { shown, client } = recorder();
    await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client,
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
    });
    const all = shown.join("\n");
    expect(all).not.toContain("Michella");
    expect(all).not.toContain("CODINGNEEDLE");
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

describe("a picture staff sent from their own device (2026-10-27)", () => {
  const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const CREDS = {
    whatsappToken: "t",
    phoneNumberId: "1",
    graphVersion: "v25.0",
  };

  /** A ChatMedia row and the WA_IMAGE naming it, written as the API does. */
  async function queued(payload: Record<string, unknown>) {
    await owner.staff.create({
      data: {
        id: "st_pic",
        username: "dina",
        name: "Dina",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    const media = await owner.chatMedia.create({
      data: {
        from: FROM,
        data: BYTES,
        contentType: "image/png",
        size: BYTES.length,
        uploadedById: "st_pic",
      },
    });
    await owner.outbox.create({
      data: {
        kind: "WA_IMAGE",
        payload: { to: FROM, chatMediaId: media.id, ...payload },
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: NOW,
        createdAt: NOW,
      },
    });
    return media.id;
  }

  /** Graph, answering the upload and the send, keeping what it was sent. */
  function graph() {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), body: init?.body });
      const body = String(url).endsWith("/media")
        ? { id: "media-pic" }
        : { messages: [{ id: "3EB0PIC" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("reads the bytes and sends them, caption and all", async () => {
    await queued({ caption: "Ini fotonya kak" });
    const { calls, fetchImpl } = graph();
    const result = await sendPass({
      db: agent,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 5,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.sent).toBe(1);
    expect(calls).toHaveLength(2);
    const form = calls[0]!.body as FormData;
    expect(form.get("type")).toBe("image/png");
    const file = form.get("file") as Blob;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(BYTES);
    expect(JSON.parse(String(calls[1]!.body))).toMatchObject({
      to: FROM,
      type: "image",
      image: { id: "media-pic", caption: "Ini fotonya kak" },
    });
    const row = await owner.outbox.findFirstOrThrow({});
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe("3EB0PIC");
  });

  it("never sends one customer's picture to another", async () => {
    await queued({ to: "628111000999" });
    const { calls, fetchImpl } = graph();
    const result = await sendPass({
      db: agent,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 5,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.sent).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await owner.outbox.findFirstOrThrow({})).status).toBe("FAILED");
  });

  it("refuses a payload naming both a QC photo and a picture", async () => {
    await queued({ photoId: "ph_x" });
    const { calls, fetchImpl } = graph();
    await sendPass({
      db: agent,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 5,
      fetchImpl,
      now: () => NOW,
    });
    expect(calls).toHaveLength(0);
    const row = await owner.outbox.findFirstOrThrow({});
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/malformed WA_IMAGE/);
  });

  it("may read a picture and never write one", async () => {
    const id = await queued({});
    expect(
      (await agent.chatMedia.findUniqueOrThrow({ where: { id } })).size,
    ).toBe(BYTES.length);
    await expect(
      agent.chatMedia.create({
        data: {
          from: FROM,
          data: BYTES,
          contentType: "image/png",
          size: BYTES.length,
          uploadedById: "st_pic",
        },
      }),
    ).rejects.toThrow();
    await expect(agent.chatMedia.delete({ where: { id } })).rejects.toThrow();
  });
});

describe("selling, as nusantara_agent (2026-10-27)", () => {
  /** Friday 21 August 2026, 09:30 Jakarta — the visit's morning. */
  const VISIT_MORNING = new Date("2026-08-21T02:30:00.000Z");
  const toolCtx = (now = NOW) => ({
    from: FROM,
    now,
    capabilities: LIVE,
    reserve: { write: agent, staffId: AGENT_STAFF },
    profile: { write: agent },
    writesUsed: new Set<string>(),
    onError: (_t: string, e: unknown) => {
      throw e;
    },
  });

  /**
   * The turn that booked the visit answered the customer's message — a
   * follow-up is never queued while a line of theirs is still BARU.
   */
  const answeredByBot = () =>
    owner.waMessage.updateMany({
      data: {
        status: "DIJAWAB_AGEN",
        answeredByAgent: true,
        answeredAt: new Date(NOW.getTime() + 5_000),
        replyText: "siap kak",
      },
    });

  it("reminds a customer of their visit once, on its morning", async () => {
    await seedUnit();
    await inbound("v.1", "mau lihat air m2 besok jam 3", NOW);
    const booked = (await dispatchTool(
      agent,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "SERX", custName: "Budi" },
      toolCtx(),
    )) as { ok?: boolean };
    expect(booked.ok).toBe(true);
    await answeredByBot();
    const pass = (now: Date, transport: "cloud" | "baileys" = "cloud") =>
      followUpPass({ db: agent, logger, transport, now: () => now });

    // The evening before: not yet.
    expect(await pass(new Date("2026-08-20T13:00:00.000Z"))).toMatchObject({
      reminded: 0,
    });
    expect(await pass(VISIT_MORNING)).toMatchObject({ reminded: 1 });
    expect(await pass(VISIT_MORNING)).toMatchObject({ reminded: 0 });
    const rows = await owner.outbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      to: FROM,
      followUp: "visit_reminder",
      body: "Halo kak 😊 apakah kakak jadi datang ke toko kami untuk lihat MacBook Air M2 256GB 8/256? Kami tunggu ya kedatangannya 🙏",
    });
  });

  it("holds a reminder back while a line of theirs is waiting for a reply", async () => {
    await seedUnit();
    await inbound("v.w", "mau lihat air m2 besok jam 3", NOW);
    await dispatchTool(
      agent,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "SERX", custName: "Budi" },
      toolCtx(),
    );
    await answeredByBot();
    // Their morning question, not yet answered: the reply comes first.
    await inbound(
      "v.q",
      "jam berapa buka kak?",
      new Date(VISIT_MORNING.getTime() - 5_000),
    );
    const pass = () =>
      followUpPass({
        db: agent,
        logger,
        transport: "cloud",
        now: () => VISIT_MORNING,
      });
    expect(await pass()).toMatchObject({ reminded: 0 });
    expect(await owner.outbox.count()).toBe(0);
    await owner.waMessage.updateMany({
      where: { waMessageId: "v.q" },
      data: {
        status: "DIJAWAB_AGEN",
        answeredByAgent: true,
        answeredAt: VISIT_MORNING,
        replyText: "jam 10 kak",
      },
    });
    expect(await pass()).toMatchObject({ reminded: 1 });
  });

  it("sends a reminder past the 24-hour window only through the linked device", async () => {
    await seedUnit();
    await inbound("v.2", "mau lihat air m2", NOW);
    await dispatchTool(
      agent,
      "book_visit",
      { when: "2026-08-21T15:00", custName: "Budi" },
      toolCtx(),
    );
    await answeredByBot();
    // 14:00 Jakarta on the day: 28 hours after their last message.
    const late = new Date("2026-08-21T07:00:00.000Z");
    expect(
      await followUpPass({
        db: agent,
        logger,
        transport: "cloud",
        now: () => late,
      }),
    ).toMatchObject({ reminded: 0 });
    expect(
      await followUpPass({
        db: agent,
        logger,
        transport: "baileys",
        now: () => late,
      }),
    ).toMatchObject({ reminded: 1 });
    expect(
      ((await owner.outbox.findFirstOrThrow()).payload as { body: string })
        .body,
    ).toContain("untuk lihat unitnya?");
  });

  it("reads the yes to a reminder by code and leaves a colleague 'Perlu sambut'", async () => {
    await seedUnit();
    await inbound("v.3", "mau lihat air m2", NOW);
    await dispatchTool(
      agent,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "SERX", custName: "Budi" },
      toolCtx(),
    );
    await answeredByBot();
    await followUpPass({
      db: agent,
      logger,
      transport: "cloud",
      now: () => VISIT_MORNING,
    });
    const answerAt = new Date(VISIT_MORNING.getTime() + 600_000);
    await inbound("v.4", "iya jadi kak", new Date(answerAt.getTime() - 20_000));
    const result = await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      agentStaffId: AGENT_STAFF,
      now: () => answerAt,
    });
    expect(result.drafted).toBe(1);
    const task = await owner.chatAction.findFirstOrThrow();
    expect(task).toMatchObject({
      kind: "RESERVATION",
      topic: "visit",
      status: "OPEN",
    });
    expect(task.summary).toBe(
      "Perlu sambut — Budi datang Jumat 15.00 lihat MacBook Air M2 256GB 8/256",
    );
    expect((await owner.reservation.findFirstOrThrow()).status).toBe(
      "TERJADWAL",
    );
  });

  it("nudges a quiet hot lead once, about the unit they asked about", async () => {
    await seedUnit();
    const asked = new Date(NOW.getTime() - 21 * 3_600_000);
    await owner.waMessage.create({
      data: {
        waMessageId: "l.1",
        from: FROM,
        name: "Test",
        text: "air m2 ada kak?",
        msgType: "text",
        ts: asked,
        direction: "IN",
        status: "DIJAWAB_AGEN",
        entities: { units: ["SERX"] },
        replyText: "Ada kak 😊",
        answeredByAgent: true,
        answeredAt: new Date(asked.getTime() + 10_000),
      },
    });
    await owner.waThreadMemory.create({
      data: {
        from: FROM,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: asked,
        leadScore: 70,
        leadAt: asked,
      },
    });
    const pass = () =>
      followUpPass({ db: agent, logger, transport: "cloud", now: () => NOW });
    expect(await pass()).toMatchObject({ nudged: 1 });
    expect(await pass()).toMatchObject({ nudged: 0 });
    expect(
      ((await owner.outbox.findFirstOrThrow()).payload as { body: string })
        .body,
    ).toBe(
      "Halo kak 😊 MacBook Air M2 256GB 8/256 yang kemarin kakak tanyakan masih ready ya. Kalau mau lihat langsung atau ada yang mau ditanyakan, kabari kami aja kak 🙏",
    );
  });

  it("remembers a wish and leaves one task when the unit arrives", async () => {
    await seedUnit();
    await inbound("w.1", "air m2 16/512 ada?", NOW);
    expect(
      await dispatchTool(
        agent,
        "watch_stock",
        { query: "air m2 256gb" },
        toolCtx(),
      ),
    ).toMatchObject({ saved: true });
    // Nothing new on the shelf since the wish.
    expect(
      await watchPass({ db: agent, logger, now: () => NOW }),
    ).toMatchObject({ notified: 0 });
    // The unit is re-checked and put back on sale the next day.
    const later = new Date(NOW.getTime() + 86_400_000);
    await owner.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: "SERX",
        type: "DICATAT",
        staffId: AGENT_STAFF,
        at: later,
        note: "dicek ulang",
      }),
    );
    expect(
      await watchPass({ db: agent, logger, now: () => later }),
    ).toMatchObject({ notified: 1 });
    expect(
      await watchPass({ db: agent, logger, now: () => later }),
    ).toMatchObject({ notified: 0 });
    const task = await owner.chatAction.findFirstOrThrow();
    expect(task).toMatchObject({ kind: "STOCK", topic: "restock" });
    expect(task.summary).toBe(
      "Perlu kabari — MacBook Air M2 256GB 8/256 sudah ready, pelanggan minta dikabari",
    );
    expect((await owner.stockWatch.findFirstOrThrow()).notifiedAt).toEqual(
      later,
    );
  });

  it("hands a buyer to a person as a CLOSING task", async () => {
    await inbound(
      "c.1",
      "oke kak saya ambil, cara bayarnya gimana?",
      new Date(NOW.getTime() - 20_000),
    );
    await draftPass({
      db: agent,
      logger,
      anthropic: { apiKey: "sk-ant-test" },
      client: model(),
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      now: () => NOW,
    });
    expect(await owner.chatAction.findFirstOrThrow()).toMatchObject({
      kind: "CLOSING",
      topic: "closing",
    });
  });
});

describe("a DP hold, as nusantara_agent (2026-10-27)", () => {
  const HELD_UNTIL = new Date(NOW.getTime() + 7 * 86_400_000);

  /**
   * A hold staff made firm with a DP — written by the owner, as the till
   * would through the store: the reservation with `heldUntil`, its item, the
   * DP payment naming it, and the unit DIRESERVASI on the ledger.
   */
  async function firmHold() {
    await seedUnit();
    await owner.paymentMethod.create({
      data: {
        id: "pm_tf",
        code: "TRANSFER",
        label: "Transfer",
        builtIn: true,
        forPo: true,
        forSale: true,
        active: true,
        sortOrder: 1,
        createdAt: NOW,
      },
    });
    await owner.customer.create({
      data: { id: "cus_dp", name: "Budi", phone: `+${FROM}`, createdAt: NOW },
    });
    await owner.reservation.create({
      data: {
        id: "rv_dp",
        customerId: "cus_dp",
        custName: "Budi",
        phone: `+${FROM}`,
        status: "TERJADWAL",
        source: "STAF",
        createdAt: NOW,
        heldUntil: HELD_UNTIL,
        items: { create: { unitId: "u_x", skuId: "sku_t", qty: 1 } },
      },
    });
    await owner.payment.create({
      data: {
        id: "dp_x",
        reservationId: "rv_dp",
        direction: "MASUK",
        methodId: "pm_tf",
        amount: 500_000n,
        status: "LUNAS",
        paidAt: NOW,
        recordedAt: NOW,
        staffId: AGENT_STAFF,
      },
    });
    await owner.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: "SERX",
        type: "DIRESERVASI",
        staffId: AGENT_STAFF,
        at: NOW,
        reservationId: "rv_dp",
      }),
    );
  }

  const expire = (now: Date) =>
    expirePass({
      db: agent,
      logger,
      agentStaffId: AGENT_STAFF,
      graceMs: 3_600_000,
      ttlMs: 48 * 3_600_000,
      maxPerTick: 5,
      now: () => now,
    });

  it("reminds the customer once, a day before the hold runs out", async () => {
    await firmHold();
    const dayBefore = new Date(HELD_UNTIL.getTime() - 12 * 3_600_000);
    await owner.waMessage.create({
      data: {
        waMessageId: "dp.1",
        from: FROM,
        name: "Budi",
        text: "sudah transfer dp ya kak",
        msgType: "text",
        ts: new Date(dayBefore.getTime() - 3_600_000),
        direction: "IN",
        status: "DIJAWAB_AGEN",
        entities: {},
        answeredByAgent: false,
      },
    });
    const pass = (now: Date) =>
      followUpPass({ db: agent, logger, transport: "cloud", now: () => now });

    // Two days before: not yet.
    expect(
      await pass(new Date(HELD_UNTIL.getTime() - 48 * 3_600_000)),
    ).toMatchObject({ dpReminded: 0 });
    expect(await pass(dayBefore)).toMatchObject({ dpReminded: 1 });
    expect(await pass(dayBefore)).toMatchObject({ dpReminded: 0 });
    const rows = await owner.outbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      to: FROM,
      followUp: "dp_reminder",
      reservationId: "rv_dp",
      body: "Halo kak 😊 unit MacBook Air M2 256GB 8/256 masih kami tahan sampai Kamis, 27 Agu ya. Kalau mau dilunasi atau datang ambil, kabari kami aja kak 🙏",
    });
  });

  it("puts the unit back on sale when the hold runs out, leaves the DP to staff, and says so once", async () => {
    await firmHold();
    await owner.waMessage.create({
      data: {
        waMessageId: "dp.2",
        from: FROM,
        name: "Budi",
        text: "kak tolong keep ya",
        msgType: "text",
        ts: NOW,
        direction: "IN",
        status: "DIJAWAB_AGEN",
        entities: {},
        answeredByAgent: true,
      },
    });
    // Still inside the hold: nothing moves.
    expect(
      await expire(new Date(HELD_UNTIL.getTime() - 3_600_000)),
    ).toMatchObject({ dpExpired: 0 });
    const after = new Date(HELD_UNTIL.getTime() + 3_600_000);
    expect(await expire(after)).toMatchObject({ dpExpired: 1, released: 1 });
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "SERX" } }))
        .status,
    ).toBe("TERSEDIA");
    // The hold stays open, waiting on the refund / keep decision…
    expect(
      (await owner.reservation.findUniqueOrThrow({ where: { id: "rv_dp" } }))
        .status,
    ).toBe("TERJADWAL");
    // …and the money is untouched: the worker cannot write a payment.
    const money = await owner.payment.findMany();
    expect(money.map((p) => [p.id, p.orderId, p.voidedAt])).toEqual([
      ["dp_x", null, null],
    ]);
    const tasks = await owner.chatAction.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      from: FROM,
      kind: "RESERVATION",
      topic: "dp",
      status: "OPEN",
      summary:
        "Perlu putuskan DP — Budi tidak melunasi MacBook Air M2 256GB 8/256, DP Rp 500rb: kembalikan atau hangus?",
    });
    // Once: the next pass finds nothing still held.
    expect(await expire(after)).toMatchObject({ dpExpired: 0 });
    expect(await owner.chatAction.count()).toBe(1);
    expect(
      await owner.unitEvent.count({ where: { type: "RESERVASI_BATAL" } }),
    ).toBe(1);
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
