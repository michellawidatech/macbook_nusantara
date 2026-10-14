/**
 * The endpoints behind chatbot v2's Chat, Evaluation and Settings tabs
 * (.context/chatbot-v2-api-contract.md), against a real database.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const PASSWORD = "rahasia-sekali";
const PHONE = "628980094001";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let staffCookie: string;
let ownerCookie: string;

async function login(username: string, role: "OWNER" | "STAFF") {
  await db.staff.upsert({
    where: { username },
    update: { passwordHash: await hashPassword(PASSWORD), active: true, role },
    create: {
      username,
      name: username,
      role,
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

async function clean() {
  await db.outbox.deleteMany({});
  await db.agentEvaluation.deleteMany({});
  await db.agentCorrection.deleteMany({});
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
  await db.chatAction.deleteMany({});
  await db.customerProfileFact.deleteMany({});
  await db.customerProfile.deleteMany({});
  await db.waThreadMemory.deleteMany({});
  await db.waMessage.deleteMany({});
  await db.persona.updateMany({ data: { agent: null } });
  await db.persona.deleteMany({
    where: { name: { endsWith: "(chatbot v2)" } },
  });
  await db.appSetting.deleteMany({
    where: { key: { startsWith: "chatbot." } },
  });
}

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  staffCookie = await login("chat-v2-staff", "STAFF");
  ownerCookie = await login("chat-v2-owner", "OWNER");
});

afterAll(async () => {
  await clean();
  await db.$disconnect();
});

beforeEach(clean);

/** A customer message the bot answered. */
async function botAnswered(text: string, reply: string, ago = 60_000) {
  return db.waMessage.create({
    data: {
      waMessageId: `wamid.V2.${Math.random()}`,
      from: PHONE,
      name: "Ayu",
      text,
      msgType: "text",
      ts: new Date(Date.now() - ago),
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      replyText: reply,
      answeredByAgent: true,
      answeredAt: new Date(Date.now() - ago + 5_000),
    },
  });
}

describe("the thread list", () => {
  it("carries unread, the three tags and the best name", async () => {
    await botAnswered("halo", "halo kak");
    await db.waMessage.create({
      data: {
        waMessageId: "wamid.V2.new",
        from: PHONE,
        name: "Ayu",
        text: "ada air m2?",
        msgType: "text",
        ts: new Date(),
        direction: "IN",
        status: "BARU",
        entities: {},
        answeredByAgent: false,
      },
    });
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        leadScore: 80,
        leadAt: new Date(),
      },
    });
    await db.customerProfile.create({
      data: { from: PHONE, name: "Ayu Lestari", updatedAt: new Date() },
    });

    const res = await request(app)
      .get("/api/inbox")
      .set("Cookie", staffCookie)
      .expect(200);
    const t = res.body.threads.find(
      (x: { phone: string }) => x.phone === PHONE,
    );
    expect(t).toMatchObject({
      displayName: "Ayu Lestari",
      unread: 1,
      tags: { lead: true, reservation: false, escalation: false },
      leadScore: 80,
    });
  });

  it("reads a thread, and counts only what came after", async () => {
    await botAnswered("halo", "halo kak", 120_000);
    await request(app)
      .post(`/api/inbox/${PHONE}/read`)
      .set("Cookie", staffCookie)
      .expect(200);
    const res = await request(app).get("/api/inbox").set("Cookie", staffCookie);
    expect(
      res.body.threads.find((x: { phone: string }) => x.phone === PHONE).unread,
    ).toBe(0);
  });

  it("lets staff set and clear the lead", async () => {
    await botAnswered("halo", "halo kak");
    await request(app)
      .put(`/api/inbox/${PHONE}/lead`)
      .set("Cookie", staffCookie)
      .send({ lead: true })
      .expect(200, { lead: true });
    const on = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(on.body.lead).toMatchObject({ on: true, by: "STAFF" });
    await request(app)
      .put(`/api/inbox/${PHONE}/lead`)
      .set("Cookie", staffCookie)
      .send({ lead: false })
      .expect(200, { lead: false });
  });
});

describe("the profile", () => {
  it("is edited in place, with a budget range and facts", async () => {
    await botAnswered("halo", "halo kak");
    const patched = await request(app)
      .patch(`/api/inbox/${PHONE}/profile`)
      .set("Cookie", staffCookie)
      .send({
        occupation: "mahasiswa DKV",
        ageEstimate: "19-22",
        budgetMin: "12000000",
        budgetMax: "15000000",
      })
      .expect(200);
    expect(patched.body).toMatchObject({
      occupation: "mahasiswa DKV",
      budgetMin: "12000000",
      budgetMax: "15000000",
    });

    const added = await request(app)
      .post(`/api/inbox/${PHONE}/profile/facts`)
      .set("Cookie", staffCookie)
      .send({ kind: "APP", value: "Photoshop" })
      .expect(201);
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(conv.body.profile.facts).toEqual([
      expect.objectContaining({
        kind: "APP",
        value: "Photoshop",
        source: "STAFF",
      }),
    ]);

    await request(app)
      .delete(`/api/inbox/${PHONE}/profile/facts/${added.body.fact.id}`)
      .set("Cookie", staffCookie)
      .expect(200);
    const after = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(after.body.profile.facts).toEqual([]);
    // Taken back, not deleted.
    expect(await db.customerProfileFact.count()).toBe(1);
  });

  it("refuses a range upside down", async () => {
    await request(app)
      .patch(`/api/inbox/${PHONE}/profile`)
      .set("Cookie", staffCookie)
      .send({ budgetMin: "20000000", budgetMax: "10000000" })
      .expect(400);
  });
});

describe("evaluations", () => {
  it("rates a bot reply, and Apply turns the better answer into a correction", async () => {
    const m = await botAnswered("garansi berapa lama?", "garansi 1 tahun kak");
    const created = await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", staffCookie)
      .send({
        messageId: m.id,
        rating: "BAD",
        reason: "WRONG_FACT",
        agent: "ADVISOR",
        corrected: "Garansi toko 1 bulan ya kak 😊",
      })
      .expect(201);
    expect(created.body.evaluation).toMatchObject({
      rating: "BAD",
      status: "OPEN",
      reply: "garansi 1 tahun kak",
      phone: PHONE,
    });

    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(conv.body.messages[0].reply.evaluation).toMatchObject({
      rating: "BAD",
      status: "OPEN",
    });

    const listed = await request(app)
      .get("/api/chat/evaluations?status=OPEN&rating=BAD")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(listed.body.evaluations).toHaveLength(1);

    const applied = await request(app)
      .post(`/api/chat/evaluations/${created.body.evaluation.id}/apply`)
      .set("Cookie", staffCookie)
      .send({})
      .expect(200);
    expect(applied.body.evaluation.status).toBe("APPLIED");
    const correction = await db.agentCorrection.findFirstOrThrow();
    expect(correction).toMatchObject({
      original: "garansi 1 tahun kak",
      corrected: "Garansi toko 1 bulan ya kak 😊",
    });
    // Twice is a conflict, not a second correction.
    await request(app)
      .post(`/api/chat/evaluations/${created.body.evaluation.id}/apply`)
      .set("Cookie", staffCookie)
      .send({})
      .expect(409);
  });

  it("will not apply a 👎 with no better answer, and dismisses it instead", async () => {
    const m = await botAnswered("halo", "halo kak");
    const e = await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", staffCookie)
      .send({ messageId: m.id, rating: "BAD", reason: "WRONG_TONE" })
      .expect(201);
    await request(app)
      .post(`/api/chat/evaluations/${e.body.evaluation.id}/apply`)
      .set("Cookie", staffCookie)
      .send({})
      .expect(400);
    await request(app)
      .post(`/api/chat/evaluations/${e.body.evaluation.id}/dismiss`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(await db.agentCorrection.count()).toBe(0);
  });
});

describe("agents and settings", () => {
  it("lists the three agents, and only the owner edits one", async () => {
    const res = await request(app)
      .get("/api/chat/agents")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(res.body.agents.map((a: { agent: string }) => a.agent)).toEqual([
      "ROUTER",
      "OPERATIONS",
      "ADVISOR",
    ]);
    expect(
      res.body.agents.every((a: { isDefault: boolean }) => a.isDefault),
    ).toBe(true);

    await request(app)
      .put("/api/chat/agents/ROUTER")
      .set("Cookie", staffCookie)
      .send({ prompt: "x" })
      .expect(403);
    const saved = await request(app)
      .put("/api/chat/agents/ROUTER")
      .set("Cookie", ownerCookie)
      .send({ prompt: "Kamu resepsionis toko." })
      .expect(200);
    expect(saved.body.agent).toMatchObject({
      prompt: "Kamu resepsionis toko.",
      isDefault: false,
    });
    const reset = await request(app)
      .post("/api/chat/agents/ROUTER/reset")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(reset.body.agent.isDefault).toBe(true);
    // And saving again after a reset reuses the row rather than colliding.
    await request(app)
      .put("/api/chat/agents/ROUTER")
      .set("Cookie", ownerCookie)
      .send({ prompt: "Lagi." })
      .expect(200);
  });

  it("switches the pipeline and the lead threshold, owner only", async () => {
    await request(app)
      .get("/api/chat/settings")
      .set("Cookie", staffCookie)
      .expect(200, { pipeline: "v1", leadThreshold: 60 });
    await request(app)
      .put("/api/chat/settings")
      .set("Cookie", staffCookie)
      .send({ pipeline: "v2" })
      .expect(403);
    await request(app)
      .put("/api/chat/settings")
      .set("Cookie", ownerCookie)
      .send({ pipeline: "v2", leadThreshold: 70 })
      .expect(200, { pipeline: "v2", leadThreshold: 70 });
  });

  it("says the simulator is off without a credential", async () => {
    await request(app)
      .post("/api/chat/simulate")
      .set("Cookie", staffCookie)
      .send({ turns: [{ role: "user", text: "halo" }] })
      .expect(503);
  });
});
