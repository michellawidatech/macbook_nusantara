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
  // Owner, 2026-11-12: asked for again, sent again, with a line saying they
  // are the same ones (this REVERSES 2026-11-06's "once per chat").
  it("sends the same pictures again when asked again, saying they are the same", async () => {
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
    // Photos only when asked (owner, 2026-11-16): the recommendation sends
    // none, the first ask sends them.
    await turn("p0", "kak ada macbook pro 16 m3?", 0);
    const images = () => owner.outbox.count({ where: { kind: "WA_IMAGE" } });
    expect(await images()).toBe(0);
    await turn("p1", "minta foto macbook pro 16 m3 dong", 1);
    const first = await images();
    expect(first).toBe(2);
    await turn("p2", "minta fotonya dong kak", 2);
    expect(await images()).toBe(first * 2);
    const lines = await owner.outbox.findMany({ where: { kind: "WA_REPLY" } });
    expect(
      lines.some((l) =>
        /sama kayak yang aku kirim di atas/.test(
          (l.payload as { body: string }).body,
        ),
      ),
    ).toBe(true);
  });
});

describe("the owner's asks of 2026-11-16, through the worker", () => {
  async function photograph() {
    const unit = await owner.unit.findUniqueOrThrow({
      where: { serial: "MBP1" },
    });
    await owner.unitNote.create({
      data: {
        id: "note_mbp1_b",
        unitId: unit.id,
        serial: "MBP1",
        body: "QC",
        staffId: AGENT_STAFF,
        at: NOW,
        photos: {
          create: [0, 1].map((i) => ({
            id: `ph_mbp1_b${i}`,
            url: `/p/b${i}.jpg`,
            sortOrder: i,
          })),
        },
      },
    });
  }
  const images = () => owner.outbox.count({ where: { kind: "WA_IMAGE" } });

  it("sends photos only when asked, and hands more detail to a person once they were sent", async () => {
    await photograph();
    await turn("s1", "kak ada macbook pro 16 m3?", 0);
    expect(await images()).toBe(0);
    await turn("s2", "minta fotonya dong", 1);
    expect(await images()).toBe(2);
    const more = await turn("s3", "fotonya kurang jelas kak", 2);
    expect(more).toMatch(/^Untuk foto detailnya nanti tim kami siapin ya kak/);
    expect(await images()).toBe(2);
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "s3" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(
      await owner.chatAction.findFirstOrThrow({
        where: { from: FROM, status: "OPEN" },
      }),
    ).toMatchObject({ topic: "unit_details" });
  });

  it("answers a numbered list per question, and names the warranty question once at the end (2026-11-16)", async () => {
    const reply = await turn(
      "l1",
      "Hi, aku mau tanya ya:\n1. ada macbook pro 16 m3?\n2. garansinya berapa lama?",
      0,
    );
    const [first, second] = reply.split("\n\n");
    expect(first).toMatch(/^1\. ada macbook pro 16 m3\?\n/);
    expect(first).toContain("32,5jt");
    expect(second).toBe("Untuk garansinya nanti tim kami konfirmasi ya kak");
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "l1" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(
      await owner.chatAction.findFirstOrThrow({
        where: { from: FROM, status: "OPEN" },
      }),
    ).toMatchObject({ topic: "warranty_claim" });
  });

  it("files a second hand-over of a list beside the first", async () => {
    await turn("l2", "1. bisa nego kak?\n2. bisa vc kak?", 0);
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "l2" },
    });
    expect(row.entities).toMatchObject({
      handoff: { topic: "negotiation", also: ["video_call"] },
    });
    const topics = (
      await owner.chatAction.findMany({ where: { from: FROM, status: "OPEN" } })
    )
      .map((a) => a.topic)
      .sort();
    expect(topics).toEqual(["negotiation", "video_call"]);
  });

  it("answers a delivery cost itself and asks the address, then hands the address over", async () => {
    const asked = await turn("d1", "ongkir ke bekasi brp kak?", 0);
    expect(asked).toMatch(/tim kami yang hitungkan/);
    expect(asked).toMatch(/alamat lengkapnya/);
    expect(
      (await owner.waMessage.findFirstOrThrow({ where: { waMessageId: "d1" } }))
        .status,
    ).toBe("DIJAWAB_AGEN");
    const held = await turn(
      "d2",
      "Jl. Melati No 12, Kebayoran Baru, Jaksel",
      1,
    );
    expect(held).toBe(
      "Siap kak, alamatnya aku teruskan ke tim untuk dihitung ongkirnya ya",
    );
    expect(
      await owner.chatAction.findFirstOrThrow({
        where: { from: FROM, status: "OPEN" },
      }),
    ).toMatchObject({ topic: "shipping_quote" });
  });

  it("hands a shared location over once the bot asked for the address", async () => {
    await turn("d3", "kirim ke surabaya berapa?", 0);
    const at = new Date(NOW.getTime() + 60_000);
    await owner.waMessage.create({
      data: {
        waMessageId: "d4",
        from: FROM,
        name: "Budi",
        text: null,
        msgType: "location",
        ts: new Date(at.getTime() - 20_000),
        direction: "IN",
        status: "BARU",
        entities: {},
        answeredByAgent: false,
      },
    });
    await draftPass({
      db: agent,
      logger,
      anthropic: {},
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      capabilities: LIVE,
      agentStaffId: AGENT_STAFF,
      now: () => at,
    });
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "d4" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(row.entities).toMatchObject({
      handoff: { topic: "shipping_quote" },
    });
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
    // The team confirms, once, with no question tacked on (2026-11-18).
    expect(reply).toBe("Untuk yang ini nanti tim kami konfirmasi ya kak");
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "o1" },
    });
    expect(row.status).toBe("PERLU_STAF");
    expect(
      await owner.chatAction.count({ where: { from: FROM, status: "OPEN" } }),
    ).toBe(1);
  });
});

describe("the tester's chat at night, through the worker (owner, 2026-11-16)", () => {
  /** Thursday 20 August 2026, 22:00 Jakarta — the shop closed at 20:00. */
  const NIGHT = new Date("2026-08-20T15:00:00.000Z");
  async function nightTurn(id: string, text: string, step: number) {
    const at = new Date(NIGHT.getTime() + step * 60_000);
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
    await draftPass({
      db: agent,
      logger,
      anthropic: {},
      debounceMs: 8_000,
      maxDraftsPerTick: 5,
      capabilities: LIVE,
      agentStaffId: AGENT_STAFF,
      now: () => at,
    });
    return owner.waMessage.findFirstOrThrow({ where: { waMessageId: id } });
  }

  it("says what the team confirms once, the closed line once, keeps talking, and an 'ok' is no hand-over", async () => {
    const rec = await nightTurn("n1", "kak ada macbook pro 16 m3?", 0);
    expect(rec.replyText).toContain("Gimana kakk?");

    // A list: the delivery question is the bot's, the warranty a person's —
    // named once, at the end, with the closed line once (not per item).
    const list = await nightTurn(
      "n2",
      "Tp aku ada beberapa pertanyaan\n1. Ini garansi gk ya, kalau garansi berapa lama\n2. Ongkirnya ke bekasi berapa kak",
      1,
    );
    expect(list.status).toBe("PERLU_STAF");
    expect(list.replyText).toContain("2. Ongkirnya ke bekasi berapa kak");
    expect(list.replyText).not.toContain("1. Ini garansi");
    expect(list.replyText).toMatch(
      /Untuk garansinya nanti tim kami konfirmasi ya kak\nTokonya lagi tutup kak/,
    );
    expect(list.replyText!.match(/lagi tutup/g)).toHaveLength(1);

    // Defects: a person's. Not "bentar ya", not the closed line again, and
    // no question tacked on (owner, 2026-11-18 — REVERSES 2026-11-16).
    const defect = await nightTurn("n3", "Ada defectnya/minusnya apa aja", 2);
    expect(defect.status).toBe("PERLU_STAF");
    expect(defect.replyText).toBe(
      "Untuk detail minus unitnya nanti tim kami konfirmasi ya kak",
    );

    // "Ok": answered by the bot, no new hand-over, no holding line.
    const tasks = await owner.chatAction.count({ where: { from: FROM } });
    const ok = await nightTurn("n4", "Ok", 3);
    expect(ok.status).toBe("DIJAWAB_AGEN");
    expect(ok.replyText).not.toMatch(/bentar|aku cek|tutup|aku kabari/i);
    expect(ok.replyText).not.toContain("?");
    expect(await owner.chatAction.count({ where: { from: FROM } })).toBe(tasks);

    // "Hmm": room to ask, never the same line twice.
    const hmm = await nightTurn("n5", "Hmm", 4);
    expect(hmm.status).toBe("DIJAWAB_AGEN");
    expect(hmm.replyText).toBe(
      "Santai aja kak\nKalau ada yang masih bikin ragu, tanyain aja ya",
    );

    // Nothing the bot sent ends a line with a full stop, and the closer went
    // out once.
    const bodies = (
      await owner.outbox.findMany({ where: { kind: "WA_REPLY" } })
    ).map((o) => (o.payload as { body: string }).body);
    for (const b of bodies) expect(b).not.toMatch(/[^.]\.$/m);
    expect(bodies.join("\n").match(/Gimana kakk\?/g)).toHaveLength(1);
  });
});
