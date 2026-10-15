/**
 * The rules-first bot in the worker (owner, 2026-10-15: AI only where rules
 * cannot answer), as production runs it: logged in as nusantara_agent, with
 * NO Anthropic credential at all, against a real database — the tools, the
 * proposal, the hold, the trace, the lead and the profile are all real.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { PIPELINE_SETTING_KEY, type AgentCapabilities } from "@nusantara/agent";
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
  await owner.appSetting.deleteMany({ where: { key: PIPELINE_SETTING_KEY } });
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

/** One customer message through the worker, no model anywhere. */
async function turn(id: string, text: string, step: number): Promise<string> {
  // Each turn a minute after the last, every one past its quiet window.
  const at = new Date(NOW.getTime() + step * 60_000);
  await owner.waMessage.create({
    data: {
      waMessageId: id,
      from: FROM,
      name: "Budi",
      text,
      msgType: "text",
      ts: new Date(at.getTime() - 20_000),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
  const result = await draftPass({
    db: agent,
    logger,
    anthropic: {},
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    capabilities: LIVE,
    agentStaffId: AGENT_STAFF,
    now: () => at,
  });
  expect(result.dormant).toBe(false);
  const row = await owner.waMessage.findFirstOrThrow({
    where: { waMessageId: id },
  });
  return row.replyText ?? "";
}

describe("the rules bot, with no AI credential at all", () => {
  it("greets, finds the unit, prices it, proposes a visit and books it on a yes", async () => {
    expect(await turn("r1", "halo kak", 0)).toMatch(/^Halo kak/);

    const list = await turn("r2", "kak ada macbook pro 16 m3?", 1);
    expect(list).toContain("MacBook Pro 16 M3");
    expect(list).toContain("32.500.000");

    const price = await turn("r3", "yang pertama berapa kak?", 2);
    expect(price).toContain("32.500.000");

    const proposal = await turn(
      "r4",
      "besok jam 2 saya ke toko, atas nama Budi",
      3,
    );
    expect(proposal).toContain("Sudah betul kak?");
    expect(await owner.reservation.count()).toBe(0);

    const booked = await turn("r5", "iya betul kak", 4);
    const hold = await owner.reservation.findFirstOrThrow();
    expect(booked).toContain(hold.code);
    expect(hold).toMatchObject({ custName: "Budi", status: "TERJADWAL" });

    // Every turn was traced, none of it cost anything.
    const runs = await owner.agentRun.findMany();
    expect(runs).toHaveLength(5);
    expect(
      runs.every((r) => r.pipeline === "rules" && r.costMicros === 0n),
    ).toBe(true);
    // And it remembered him as a likely buyer.
    const mem = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: FROM },
    });
    expect(mem.leadAt).not.toBeNull();
  });

  it("hands what no rule covers to a person, and holds the thread", async () => {
    const reply = await turn(
      "o1",
      "kak bisa kirim ke luar kota pakai kurir apa aja?",
      0,
    );
    expect(reply).toContain("admin");
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "o1" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(
      await owner.chatAction.count({ where: { from: FROM, status: "OPEN" } }),
    ).toBe(1);
  });
});
