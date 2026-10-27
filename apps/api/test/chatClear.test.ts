/**
 * Clear chat, Delete conversation and taking a rating back (owner asks
 * 2026-10-27), against a real database — and with the API logged in as
 * `nusantara_app`, the role production gives it, so every grant the three
 * need (the two clear columns, `wa_thread_delete`, DELETE on
 * `AgentEvaluation`) is proved here rather than on the shop's Mac mini.
 * Fixtures and assertions go through the schema owner.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { resetPointFor } from "@nusantara/agent";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};
const PASSWORD = "rahasia-sekali";
const PHONE = "628980095001";
const OTHER = "628980095002";
const MIN = 60_000;
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let staffCookie: string;
let otherCookie: string;
let ownerCookie: string;
const ids: Record<string, string> = {};

async function login(username: string, name: string, role: "OWNER" | "STAFF") {
  const row = await owner.staff.create({
    data: {
      username,
      name,
      role,
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  ids[username] = row.id;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD })
    .expect(200);
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

async function clean() {
  await owner.reservationProposalItem.deleteMany({});
  await owner.reservationProposal.deleteMany({});
  await owner.outbox.deleteMany({});
  await owner.waRawEvent.deleteMany({});
  await owner.agentEvaluation.deleteMany({});
  await owner.agentCorrection.deleteMany({});
  await owner.agentRunStep.deleteMany({});
  await owner.agentRun.deleteMany({});
  await owner.chatAction.deleteMany({});
  await owner.customerProfileFact.deleteMany({});
  await owner.customerProfile.deleteMany({});
  await owner.waThreadMemory.deleteMany({});
  await owner.chatMemoryChunk.deleteMany({});
  await owner.waMessage.deleteMany({});
  await owner.customer.deleteMany({});
  await owner.auditLog.deleteMany({
    where: { entity: { in: ["WaThread", "AgentEvaluation"] } },
  });
}

beforeAll(async () => {
  owner = new PrismaClient({ datasourceUrl: URL });
  appDb = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
  await owner.$connect();
  await appDb.$connect();
  await truncateAll(owner);
  app = createApp({
    db: appDb,
    config: loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" }),
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  staffCookie = await login("clear-staff", "Rina", "STAFF");
  otherCookie = await login("clear-other", "Budi", "STAFF");
  ownerCookie = await login("clear-owner", "Ersen", "OWNER");

  // One unit, for a booking proposal's line.
  const now = new Date();
  await owner.location.create({
    data: {
      id: "loc_c",
      code: "C1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await owner.category.create({
    data: {
      id: "cat_c",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: now,
    },
  });
  await owner.catalogModel.create({
    data: {
      id: "mdl_c",
      categoryId: "cat_c",
      name: "MacBook Air M2",
      archived: false,
      createdAt: now,
    },
  });
  await owner.sku.create({
    data: {
      id: "sku_c",
      modelId: "mdl_c",
      code: "SKU-C1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: now,
    },
  });
  await owner.unit.create({
    data: {
      id: "u_c",
      serial: "SCLEAR1",
      skuId: "sku_c",
      status: "TERSEDIA",
      locationId: "loc_c",
      buy: 12_000_000n,
      landed: 12_000_000n,
      grade: "A",
      intakeAt: now,
      version: 1,
    },
  });
});

afterAll(async () => {
  await truncateAll(owner);
  await appDb.$disconnect();
  await owner.$disconnect();
});

beforeEach(clean);

let seq = 0;
/** A customer line; answered when `reply` is given, else waiting. */
async function message(
  from: string,
  text: string,
  over: {
    reply?: string;
    agoMs?: number;
    status?: "BARU" | "PERLU_STAF" | "DIJAWAB_AGEN" | "DIJAWAB_STAF";
  } = {},
) {
  seq += 1;
  const ts = new Date(Date.now() - (over.agoMs ?? 10 * MIN));
  return owner.waMessage.create({
    data: {
      waMessageId: `wamid.CLR.${seq}`,
      from,
      name: "Ayu",
      text,
      msgType: "text",
      ts,
      direction: "IN",
      status: over.status ?? (over.reply ? "DIJAWAB_AGEN" : "BARU"),
      entities: {},
      replyText: over.reply ?? null,
      answeredByAgent: Boolean(over.reply),
      answeredAt: over.reply ? new Date(ts.getTime() + 5_000) : null,
    },
  });
}

async function outbox(to: string, body: string, agoMs = 5 * MIN) {
  return owner.outbox.create({
    data: {
      kind: "WA_REPLY",
      payload: { to, body },
      status: "SENT",
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - agoMs),
      createdAt: new Date(Date.now() - agoMs),
      sentAt: new Date(Date.now() - agoMs),
    },
  });
}

async function run(from: string, messageId: string | null) {
  return owner.agentRun.create({
    data: {
      from,
      messageId,
      pipeline: "v1",
      outcome: "REPLIED",
      createdAt: new Date(),
      steps: {
        create: {
          sortOrder: 0,
          agent: "ADVISOR",
          model: "claude-haiku-4-5",
          ok: true,
          ms: 10,
        },
      },
    },
  });
}

const threads = async (cookie = staffCookie) =>
  (
    await request(app).get("/api/inbox").set("Cookie", cookie).expect(200)
  ).body.threads.map((t: { phone: string }) => t.phone) as string[];

describe("Clear chat", () => {
  it("hides the thread, closes what waited and remembers who", async () => {
    await message(PHONE, "halo", { reply: "halo kak", agoMs: 30 * MIN });
    const waiting = await message(PHONE, "berapa harga air m2?", {
      status: "PERLU_STAF",
      agoMs: 20 * MIN,
    });
    await owner.chatAction.create({
      data: {
        from: PHONE,
        kind: "PRICE",
        topic: "price",
        summary: "minta harga",
        createdAt: new Date(Date.now() - 20 * MIN),
        updatedAt: new Date(Date.now() - 20 * MIN),
      },
    });
    await owner.waThreadMemory.create({
      data: {
        from: PHONE,
        summary: "Ayu tanya Air M2.",
        summaryAt: new Date(Date.now() - 15 * MIN),
        summaryTurns: 1,
        coveredThroughAt: new Date(Date.now() - 15 * MIN),
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });
    await outbox(PHONE, "halo kak", 29 * MIN);
    await message(OTHER, "pagi", { reply: "pagi kak" });

    expect(await threads()).toEqual(expect.arrayContaining([PHONE, OTHER]));
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/clear`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(res.body.closed).toBe(1);

    expect(await threads()).toEqual([OTHER]);
    await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie)
      .expect(404);

    const closed = await owner.waMessage.findUniqueOrThrow({
      where: { id: waiting.id },
    });
    expect(closed).toMatchObject({
      status: "DIJAWAB_STAF",
      answeredById: ids["clear-staff"],
    });
    expect(
      await owner.chatAction.count({ where: { from: PHONE, status: "OPEN" } }),
    ).toBe(0);
    const memory = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: PHONE },
    });
    expect(memory.clearedById).toBe(ids["clear-staff"]);
    expect(memory.clearedAt?.toISOString()).toBe(res.body.clearedAt);
    // Nothing deleted: every row is still there, and so is the summary the
    // app role may not touch — it is hidden instead.
    expect(await owner.waMessage.count({ where: { from: PHONE } })).toBe(2);
    expect(memory.summary).toBe("Ayu tanya Air M2.");
    // The bot's reset point moved to the clear.
    expect((await resetPointFor(owner, PHONE))?.toISOString()).toBe(
      res.body.clearedAt,
    );

    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "WaThread", entityId: PHONE },
    });
    expect(audit).toMatchObject({
      action: "ARCHIVE",
      staffId: ids["clear-staff"],
      field: "clearedAt",
    });
  });

  it("brings the thread back with only what came after", async () => {
    await message(PHONE, "halo", { reply: "halo kak", agoMs: 30 * MIN });
    await outbox(PHONE, "halo kak", 29 * MIN);
    await owner.waThreadMemory.create({
      data: {
        from: PHONE,
        summary: "Ayu menyapa.",
        summaryAt: new Date(Date.now() - 15 * MIN),
        summaryTurns: 1,
        coveredThroughAt: new Date(Date.now() - 15 * MIN),
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });
    await request(app)
      .post(`/api/inbox/${PHONE}/clear`)
      .set("Cookie", staffCookie)
      .expect(200);

    // The customer writes again: a waiting row, and the phone's clock behind.
    const fresh = await message(PHONE, "masih ada air m2?", {
      agoMs: 40 * MIN,
    });
    expect(await threads()).toEqual([PHONE]);
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(conv.body.messages.map((m: { id: string }) => m.id)).toEqual([
      fresh.id,
    ]);
    expect(conv.body.sent).toEqual([]);
    expect(conv.body.summary).toBeNull();
    const list = (
      await request(app).get("/api/inbox").set("Cookie", staffCookie)
    ).body.threads[0];
    expect(list).toMatchObject({ pending: 1, unread: 1 });
  });

  it("forgets the lead, its score and what the bot learned — keeps a colleague's note (2026-10-27)", async () => {
    await message(PHONE, "buat coding, budget 15jt", {
      reply: "siap kak",
      agoMs: 30 * MIN,
    });
    const before = new Date(Date.now() - 20 * MIN);
    await owner.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        leadAt: before,
        leadScore: 85,
        updatedAt: before,
      },
    });
    await owner.agentRun.create({
      data: {
        from: PHONE,
        pipeline: "v1",
        outcome: "REPLIED",
        leadScore: 85,
        createdAt: before,
      },
    });
    const customer = await owner.customer.create({
      data: { name: "Michella", phone: `+${PHONE}`, createdAt: before },
    });
    await owner.customerProfile.create({
      data: {
        from: PHONE,
        customerId: customer.id,
        name: "Michella",
        useCase: "coding",
        budgetMin: 15_000_000n,
        budgetMax: 15_000_000n,
        occupation: "programmer",
        ageEstimate: "20-25",
        preference: "ringan",
        updatedAt: before,
        facts: {
          create: [
            {
              kind: "USAGE",
              value: "coding",
              source: "BOT",
              createdAt: before,
            },
            { kind: "APP", value: "VS Code", source: "BOT", createdAt: before },
            {
              kind: "ABOUT",
              value: "Teman owner",
              source: "STAFF",
              createdById: ids["clear-staff"]!,
              createdAt: before,
            },
          ],
        },
      },
    });
    // The 🔥 is on before the clear.
    const lead = async () => {
      const list = (
        await request(app).get("/api/inbox").set("Cookie", staffCookie)
      ).body.threads.find((t: { phone: string }) => t.phone === PHONE);
      const conv = await request(app)
        .get(`/api/inbox/${PHONE}`)
        .set("Cookie", staffCookie)
        .expect(200);
      return { list, conv: conv.body };
    };
    const on = await lead();
    expect(on.conv.lead).toMatchObject({ on: true, score: 85 });
    expect(on.list).toMatchObject({ tags: { lead: true }, leadScore: 85 });

    const res = await request(app)
      .post(`/api/inbox/${PHONE}/clear`)
      .set("Cookie", staffCookie)
      .expect(200);

    // In the database: the learned columns are null, the bot's facts are
    // taken back (never deleted), a colleague's stays, the link stays.
    const profile = await owner.customerProfile.findUniqueOrThrow({
      where: { from: PHONE },
      include: { facts: true },
    });
    expect(profile).toMatchObject({
      customerId: customer.id,
      name: null,
      useCase: null,
      budgetMin: null,
      budgetMax: null,
      occupation: null,
      ageEstimate: null,
      preference: null,
    });
    expect(profile.facts).toHaveLength(3);
    for (const f of profile.facts)
      expect(f.removedAt === null).toBe(f.source === "STAFF");
    expect((await resetPointFor(owner, PHONE))?.toISOString()).toBe(
      res.body.clearedAt,
    );

    // The customer writes again: no 🔥, no score, nothing learned on /chat.
    await message(PHONE, "halo kak", { agoMs: 0 });
    const off = await lead();
    expect(off.conv.lead).toEqual({ on: false, score: null, by: null });
    expect(off.list).toMatchObject({ tags: { lead: false }, leadScore: null });
    expect(off.conv.profile).toMatchObject({
      name: "Michella",
      useCase: null,
      budgetMin: null,
      occupation: null,
    });
    expect(
      off.conv.profile.facts.map((f: { value: string }) => f.value),
    ).toEqual(["Teman owner"]);

    // Once the bot answers again, its score and a new lead count.
    const after = new Date(Date.now() + 1_000);
    await owner.agentRun.create({
      data: {
        from: PHONE,
        pipeline: "v1",
        outcome: "REPLIED",
        leadScore: 40,
        createdAt: after,
      },
    });
    await owner.waThreadMemory.update({
      where: { from: PHONE },
      data: { leadScore: 40 },
    });
    expect((await lead()).conv.lead).toEqual({
      on: false,
      score: 40,
      by: null,
    });
    await owner.waThreadMemory.update({
      where: { from: PHONE },
      data: { leadAt: after, leadScore: 70 },
    });
    expect((await lead()).conv.lead).toEqual({
      on: true,
      score: 70,
      by: "BOT",
    });
  });

  it("refuses a number that never wrote", async () => {
    await request(app)
      .post(`/api/inbox/${OTHER}/clear`)
      .set("Cookie", staffCookie)
      .expect(404);
    expect(await owner.waThreadMemory.count()).toBe(0);
  });
});

/** A thread with something of every kind the delete takes, and keeps. */
async function fullThread() {
  const rated = await message(PHONE, "air m2 ada?", {
    reply: "ada kak",
    agoMs: 50 * MIN,
  });
  const plain = await message(PHONE, "warna apa?", {
    reply: "silver kak",
    agoMs: 40 * MIN,
  });
  const corrected = await message(PHONE, "garansi?", {
    reply: "1 bulan",
    agoMs: 30 * MIN,
  });
  const waiting = await message(PHONE, "bisa nego?", { agoMs: 20 * MIN });
  const ratedRun = await run(PHONE, rated.id);
  const plainRun = await run(PHONE, plain.id);
  const evaluation = await owner.agentEvaluation.create({
    data: {
      messageId: rated.id,
      runId: ratedRun.id,
      rating: "GOOD",
      createdById: ids["clear-staff"]!,
      createdAt: new Date(),
    },
  });
  const correction = await owner.agentCorrection.create({
    data: {
      messageId: corrected.id,
      original: "1 bulan",
      corrected: "Garansi toko 1 bulan kak 🙏",
      createdById: ids["clear-owner"]!,
      createdAt: new Date(),
    },
  });
  await owner.chatMemoryChunk.create({
    data: {
      from: PHONE,
      fromMessageId: rated.id,
      toMessageId: rated.id,
      text: "customer: air m2 ada?\nshop: ada kak",
    },
  });
  await owner.chatMemoryChunk.create({
    data: {
      from: PHONE,
      fromMessageId: plain.id,
      toMessageId: plain.id,
      text: "customer: warna apa?\nshop: silver kak",
    },
  });
  await owner.chatAction.create({
    data: {
      from: PHONE,
      kind: "NEGOTIATION",
      topic: "negotiation",
      summary: "nego",
      messageId: waiting.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await owner.waThreadMemory.create({
    data: {
      from: PHONE,
      summary: "Ayu tanya Air M2, warna dan garansi.",
      summaryTurns: 3,
      coveredThroughAt: corrected.answeredAt,
      coveredThroughId: corrected.id,
      clarifyCount: 0,
      updatedAt: new Date(),
      autoReply: false,
    },
  });
  await outbox(PHONE, "ada kak");
  await outbox(OTHER, "pagi kak");
  const raw = (from: string) => ({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: from }],
              messages: [{ from, id: `wamid.raw.${from}`, type: "text" }],
            },
          },
        ],
      },
    ],
  });
  await owner.waRawEvent.create({
    data: { payload: raw(PHONE), signatureOk: true, receivedAt: new Date() },
  });
  await owner.waRawEvent.create({
    data: {
      payload: {
        entry: [
          {
            changes: [
              { value: { statuses: [{ recipient_id: PHONE, id: "x" }] } },
            ],
          },
        ],
      },
      signatureOk: true,
      receivedAt: new Date(),
    },
  });
  await owner.waRawEvent.create({
    data: { payload: raw(OTHER), signatureOk: true, receivedAt: new Date() },
  });
  await owner.reservationProposal.create({
    data: {
      from: PHONE,
      custName: "Ayu",
      scheduledFor: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * MIN),
      items: { create: { unitId: "u_c" } },
    },
  });
  const profile = await owner.customerProfile.create({
    data: {
      from: PHONE,
      name: "Ayu",
      updatedAt: new Date(),
      facts: {
        create: {
          kind: "USAGE",
          value: "kuliah",
          source: "BOT",
          createdAt: new Date(),
        },
      },
    },
  });
  const customer = await owner.customer.create({
    data: { name: "Ayu", phone: `+${PHONE}`, createdAt: new Date() },
  });
  await message(OTHER, "pagi", { reply: "pagi kak" });
  return {
    rated,
    plain,
    corrected,
    waiting,
    ratedRun,
    plainRun,
    evaluation,
    correction,
    profile,
    customer,
  };
}

const del = (cookie: string, confirm?: string) =>
  request(app)
    .delete(`/api/inbox/${PHONE}`)
    .set("Cookie", cookie)
    .send(confirm === undefined ? {} : { confirm });

describe("Delete conversation", () => {
  it("is the owner's, and asks for the number typed back", async () => {
    await fullThread();
    await del(staffCookie, PHONE).expect(403);
    await del(ownerCookie).expect(400);
    await del(ownerCookie, OTHER).expect(400);
    expect(await owner.waMessage.count({ where: { from: PHONE } })).toBe(4);
  });

  it("removes the conversation and keeps the profile, ratings and corrections", async () => {
    const f = await fullThread();
    const res = await del(ownerCookie, `+${PHONE}`).expect(200);

    // Kept: exactly the messages a rating or correction names, hidden.
    const left = await owner.waMessage.findMany({
      where: { from: PHONE },
      select: { id: true },
    });
    expect(left.map((m) => m.id).sort()).toEqual(
      [f.rated.id, f.corrected.id].sort(),
    );
    expect(await owner.agentEvaluation.count()).toBe(1);
    expect(await owner.agentCorrection.count()).toBe(1);
    expect(
      (await owner.agentRun.findMany({ select: { id: true } })).map(
        (r) => r.id,
      ),
    ).toEqual([f.ratedRun.id]);
    expect(await owner.agentRunStep.count()).toBe(1);
    expect(await owner.customerProfile.count({ where: { from: PHONE } })).toBe(
      1,
    );
    expect(await owner.customerProfileFact.count()).toBe(1);
    // …but not what the bot learned from the chat that went (2026-10-27).
    expect(
      await owner.customerProfile.findUniqueOrThrow({
        where: { from: PHONE },
        include: { facts: true },
      }),
    ).toMatchObject({ name: null, facts: [{ removedAt: expect.any(Date) }] });
    expect(await owner.customer.count()).toBe(1);
    expect(await owner.unit.count({ where: { id: "u_c" } })).toBe(1);

    // Removed.
    expect(await owner.chatMemoryChunk.count()).toBe(0);
    expect(await owner.chatAction.count()).toBe(0);
    expect(await owner.reservationProposal.count()).toBe(0);
    expect(await owner.reservationProposalItem.count()).toBe(0);
    const outboxLeft = await owner.outbox.findMany({
      select: { payload: true },
    });
    expect(outboxLeft.map((o) => (o.payload as { to: string }).to)).toEqual([
      OTHER,
    ]);
    expect(await owner.waRawEvent.count()).toBe(1);
    // The memory row starts over, hiding what was kept.
    const memory = await owner.waThreadMemory.findUniqueOrThrow({
      where: { from: PHONE },
    });
    expect(memory).toMatchObject({
      summary: null,
      coveredThroughId: null,
      autoReply: true,
      clearedById: ids["clear-owner"],
    });
    expect(memory.clearedAt).not.toBeNull();

    // Gone from /chat, and the other thread untouched.
    expect(await threads()).toEqual([OTHER]);
    await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", ownerCookie)
      .expect(404);
    expect(await owner.waMessage.count({ where: { from: OTHER } })).toBe(1);

    // One audit line: who and how many, never what was said.
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "WaThread", entityId: PHONE },
    });
    expect(audit).toMatchObject({
      action: "DELETE",
      staffId: ids["clear-owner"],
    });
    expect(JSON.parse(audit.after!)).toEqual({ rows: res.body.deleted });
    expect(res.body.deleted).toBeGreaterThan(10);
    expect(audit.after).not.toMatch(/silver|nego/);
  });

  it("leaves no memory row when nothing had to be kept", async () => {
    await message(PHONE, "halo", { reply: "halo kak" });
    await owner.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });
    const res = await del(ownerCookie, PHONE).expect(200);
    expect(res.body.deleted).toBe(2);
    expect(await owner.waMessage.count()).toBe(0);
    expect(await owner.waThreadMemory.count()).toBe(0);
  });

  it("404s a number with no conversation", async () => {
    await del(ownerCookie, PHONE).expect(404);
  });
});

describe("the database's door", () => {
  it("is shut to the agent role", async () => {
    const agent = new PrismaClient({
      datasourceUrl: asRole("nusantara_agent"),
    });
    try {
      await expect(
        agent.$queryRaw`SELECT wa_thread_delete(${PHONE}, ${ids["clear-owner"]!}, now()::timestamp)`,
      ).rejects.toThrow(/permission denied/);
    } finally {
      await agent.$disconnect();
    }
  });
});

describe("taking a 👍/👎 back", () => {
  async function rated(by: string, status: "OPEN" | "APPLIED" = "OPEN") {
    const m = await message(PHONE, "halo", { reply: "halo kak" });
    const correction =
      status === "APPLIED"
        ? await owner.agentCorrection.create({
            data: {
              messageId: m.id,
              original: "halo kak",
              corrected: "Halo kak 😊",
              createdById: ids[by]!,
              createdAt: new Date(),
            },
          })
        : null;
    const e = await owner.agentEvaluation.create({
      data: {
        messageId: m.id,
        rating: "BAD",
        createdById: ids[by]!,
        createdAt: new Date(),
        status,
        ...(correction
          ? {
              correctionId: correction.id,
              reviewedById: ids[by]!,
              reviewedAt: new Date(),
            }
          : {}),
      },
    });
    return { message: m, evaluation: e };
  }

  it("withdraws its author's open rating, and logs it", async () => {
    const { evaluation } = await rated("clear-staff");
    await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(await owner.agentEvaluation.count()).toBe(0);
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "AgentEvaluation", entityId: evaluation.id },
    });
    expect(audit).toMatchObject({
      action: "DELETE",
      staffId: ids["clear-staff"],
    });
  });

  it("lets an owner withdraw anybody's, and nobody else", async () => {
    const { evaluation } = await rated("clear-staff");
    await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}`)
      .set("Cookie", otherCookie)
      .expect(403);
    await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}`)
      .set("Cookie", ownerCookie)
      .expect(200);
  });

  it("refuses one that became a Knowledge Base answer", async () => {
    const { evaluation } = await rated("clear-staff", "APPLIED");
    const res = await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}`)
      .set("Cookie", staffCookie)
      .expect(409);
    expect(res.body.error.message).toMatch(/Knowledge Base/);
    expect(await owner.agentEvaluation.count()).toBe(1);
  });

  it("deletes any row from the Evaluation list, and keeps the KB answer", async () => {
    const { evaluation } = await rated("clear-staff", "APPLIED");
    await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}?any=1`)
      .set("Cookie", otherCookie)
      .expect(403);
    await request(app)
      .delete(`/api/chat/evaluations/${evaluation.id}?any=1`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(await owner.agentEvaluation.count()).toBe(0);
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "AgentEvaluation", entityId: evaluation.id },
    });
    expect(JSON.parse(audit.before ?? "{}")).toMatchObject({
      status: "APPLIED",
    });
  });

  it("replaces 👎 with 👍 in one go", async () => {
    const { message: m, evaluation } = await rated("clear-staff");
    const res = await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", staffCookie)
      .send({ messageId: m.id, rating: "GOOD", replaces: evaluation.id })
      .expect(201);
    const left = await owner.agentEvaluation.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      id: res.body.evaluation.id,
      rating: "GOOD",
    });
  });

  it("creates nothing when the one it replaces cannot go", async () => {
    const { message: m, evaluation } = await rated("clear-staff", "APPLIED");
    await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", staffCookie)
      .send({ messageId: m.id, rating: "GOOD", replaces: evaluation.id })
      .expect(409);
    expect(await owner.agentEvaluation.count()).toBe(1);
  });
});
