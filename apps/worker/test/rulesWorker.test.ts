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
/** Parsed, not string-replaced: CI's URL carries a password (agentRole.test.ts). */
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

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
      // Its own sell price — the bot never reads the variant's (2026-11-05).
      price: 32_500_000n,
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

describe("a keep given one detail per message, across worker turns (2026-11-09, Task 12)", () => {
  it("files the request once the time and the name have both come", async () => {
    await turn("k1", "kak ada macbook pro 16 m3?", 0);
    await turn("k2", "mau keep yang itu kak", 1);
    await turn("k3", "besok jam 2", 2);
    expect(await owner.reservationProposal.count()).toBe(0);
    const noted = await turn("k4", "atas nama Rina", 3);
    expect(noted).toContain("aku catat");
    const req = await owner.reservationProposal.findFirstOrThrow({
      include: { items: true },
    });
    expect(req.custName).toBe("Rina");
    expect(req.items).toHaveLength(1);
  });
});

describe("emoji only at the beginning of the chat (owner, 2026-11-09)", () => {
  it("the first reply may carry one, every later reply carries none", async () => {
    const first = await turn("e1", "halo kak", 0);
    const second = await turn("e2", "kak ada macbook pro 16 m3?", 1);
    expect(
      [...first.matchAll(/\p{Extended_Pictographic}/gu)].length,
    ).toBeLessThanOrEqual(1);
    expect(second).not.toMatch(/\p{Extended_Pictographic}/u);
    const sent = await owner.outbox.findMany({
      where: { kind: "WA_REPLY" },
      orderBy: { createdAt: "asc" },
    });
    expect((sent.at(-1)!.payload as { body: string }).body).toBe(second);
  });
});

describe("a unit's photos go to a chat once (2026-11-06, W7)", () => {
  it("does not send the same pictures again, and says they were sent above", async () => {
    const unit = await owner.unit.findUniqueOrThrow({
      where: { serial: "MBP1" },
    });
    await owner.unitNote.create({
      data: {
        id: "note_mbp1",
        unitId: unit.id,
        serial: "MBP1",
        body: "QC",
        staffId: AGENT_STAFF,
        at: NOW,
        photos: {
          create: [0, 1].map((i) => ({
            id: `ph_mbp1_${i}`,
            url: `/p/${i}.jpg`,
            sortOrder: i,
          })),
        },
      },
    });
    await turn("p1", "kak ada macbook pro 16 m3?", 0);
    const images = () => owner.outbox.count({ where: { kind: "WA_IMAGE" } });
    const first = await images();
    expect(first).toBe(2);
    await turn("p2", "minta fotonya dong kak", 1);
    expect(await images()).toBe(first);
    const lines = await owner.outbox.findMany({ where: { kind: "WA_REPLY" } });
    expect(
      lines.some((l) =>
        /sudah aku kirim di atas/.test((l.payload as { body: string }).body),
      ),
    ).toBe(true);
  });
});

describe("a reservation request reaches a person (2026-11-06, B2)", () => {
  it("leaves an open RESERVATION task and alerts the staff numbers", async () => {
    await owner.appSetting.create({
      data: {
        key: "chatbot.notifyNumbers",
        value: "628999000111:Ersen",
        updatedAt: new Date(),
      },
    });
    await turn("q1", "kak ada macbook pro 16 m3?", 0);
    const noted = await turn(
      "q2",
      "besok jam 2 saya ke toko, atas nama Budi",
      1,
    );
    expect(noted).toContain("aku catat");
    const task = await owner.chatAction.findFirstOrThrow({
      where: { from: FROM, kind: "RESERVATION", status: "OPEN" },
    });
    expect(task.summary).toMatch(/^Perlu setujui reservasi/);
    const alerts = await owner.outbox.findMany({
      where: { payload: { path: ["staffAlert"], equals: true } },
    });
    expect(alerts.map((a) => (a.payload as { to: string }).to)).toEqual([
      "628999000111",
    ]);
  });

  it("never overwrites an open DP decision with the request (final review)", async () => {
    await owner.chatAction.create({
      data: {
        from: FROM,
        kind: "RESERVATION",
        topic: "dp",
        summary: "Perlu putuskan DP — Air M2",
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await turn("q3", "kak ada macbook pro 16 m3?", 0);
    await turn("q4", "besok jam 2 saya ke toko, atas nama Budi", 1);
    const open = await owner.chatAction.findMany({
      where: { from: FROM, kind: "RESERVATION", status: "OPEN" },
    });
    expect(open.map((a) => a.summary)).toEqual(["Perlu putuskan DP — Air M2"]);
  });
});

describe("the rules bot, with no AI credential at all", () => {
  it("greets, finds the unit, prices it, and files a reservation request a person approves", async () => {
    expect(await turn("r1", "halo kak", 0)).toMatch(/^Halo kak/);

    const list = await turn("r2", "kak ada macbook pro 16 m3?", 1);
    expect(list).toContain("Pro 16 M3");
    expect(list).toContain("32,5jt");

    const price = await turn("r3", "yang pertama berapa kak?", 2);
    expect(price).toContain("32,5jt");

    // A REQUEST (2026-10-27): noted, the team confirms, nothing booked.
    const noted = await turn(
      "r4",
      "besok jam 2 saya ke toko, atas nama Budi",
      3,
    );
    expect(noted).toContain("Siap kak, aku catat ya");
    expect(noted).toContain("Nanti tim kami konfirmasi");
    expect(await owner.reservation.count()).toBe(0);
    const request = await owner.reservationProposal.findFirstOrThrow({
      include: { items: true },
    });
    expect(request).toMatchObject({
      from: FROM,
      custName: "Budi",
      confirmedAt: null,
      reservationId: null,
    });
    expect(request.items).toHaveLength(1);

    // The customer's yes confirms nothing: a person does.
    const yes = await turn("r5", "iya betul kak", 4);
    expect(yes).toContain("Tinggal tunggu konfirmasi dari tim kami");
    expect(await owner.reservation.count()).toBe(0);

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
    expect(reply).toBe("Bentar ya kak, aku cek dulu 🙏");
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "o1" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(
      await owner.chatAction.count({ where: { from: FROM, status: "OPEN" } }),
    ).toBe(1);
  });
});
