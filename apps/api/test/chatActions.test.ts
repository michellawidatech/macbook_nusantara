/**
 * The chatbot's switches, action items and customer profile, over HTTP
 * (owner ask 2026-09-29).
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
const PHONE = "628980093001";
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

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  staffCookie = await login("chat-actions-staff", "STAFF");
  ownerCookie = await login("chat-actions-owner", "OWNER");
});

afterAll(async () => {
  await db.appSetting.deleteMany({
    where: { key: { startsWith: "chatbot." } },
  });
  await db.$disconnect();
});

beforeEach(async () => {
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
  await db.appSetting.deleteMany({
    where: { key: { startsWith: "chatbot." } },
  });
});

async function handedOver(text: string) {
  const m = await db.waMessage.create({
    data: {
      waMessageId: `wamid.CA.${Math.random()}`,
      from: PHONE,
      text,
      msgType: "text",
      ts: new Date(),
      direction: "IN",
      status: "PERLU_STAF",
      intent: "staf:negotiation",
      entities: {},
      answeredByAgent: false,
    },
  });
  const now = new Date();
  const a = await db.chatAction.create({
    data: {
      from: PHONE,
      kind: "NEGOTIATION",
      topic: "negotiation",
      summary: "Nego Air M1",
      customerText: text,
      askPrice: 7_000_000n,
      listPrice: 7_500_000n,
      messageId: m.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { message: m, action: a };
}

describe("the chatbot's switches", () => {
  it("read the POS as the source of truth until somebody presses one (2026-10-27)", async () => {
    const res = await request(app)
      .get("/api/chat/capabilities")
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    // Stock, prices and photos on; bookings wait for the owner's switch.
    expect(res.body.set).toEqual({
      stock: true,
      price: true,
      reserve: false,
      photos: true,
    });
  });

  it("are the owner's to change", async () => {
    const res = await request(app)
      .put("/api/chat/capabilities")
      .set("Cookie", staffCookie)
      .send({ stock: true });
    expect(res.status).toBe(403);
  });

  it("save one switch at a time, and report what that allows", async () => {
    const res = await request(app)
      .put("/api/chat/capabilities")
      .set("Cookie", ownerCookie)
      .send({ stock: false });
    expect(res.status).toBe(200);
    // Price is still on as set, and allows nothing while Stock is off.
    expect(res.body.set).toMatchObject({ stock: false, price: true });
    expect(res.body.effective.price).toBe(false);

    const on = await request(app)
      .put("/api/chat/capabilities")
      .set("Cookie", ownerCookie)
      .send({ stock: true });
    expect(on.body.effective).toMatchObject({ stock: true, price: true });
  });

  it("refuses a switch that does not exist", async () => {
    const res = await request(app)
      .put("/api/chat/capabilities")
      .set("Cookie", ownerCookie)
      .send({ payments: true });
    expect(res.status).toBe(400);
  });
});

describe("the tester numbers", () => {
  it("start empty, and staff may read them", async () => {
    const res = await request(app)
      .get("/api/chat/testers")
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ numbers: [] });
  });

  it("are the owner's to change", async () => {
    const res = await request(app)
      .put("/api/chat/testers")
      .set("Cookie", staffCookie)
      .send({ numbers: ["08980092978"] });
    expect(res.status).toBe(403);
  });

  it("are stored as wa_ids however they were typed, once each", async () => {
    const res = await request(app)
      .put("/api/chat/testers")
      .set("Cookie", ownerCookie)
      .send({ numbers: ["0898-0092-978", "+62 898 0092 978", "628111000888"] });
    expect(res.status).toBe(200);
    expect(res.body.numbers).toEqual(["628980092978", "628111000888"]);

    const read = await request(app)
      .get("/api/chat/testers")
      .set("Cookie", staffCookie);
    expect(read.body.numbers).toEqual(["628980092978", "628111000888"]);
  });

  it("refuse an entry that is not a number, rather than dropping it", async () => {
    const res = await request(app)
      .put("/api/chat/testers")
      .set("Cookie", ownerCookie)
      .send({ numbers: ["08980092978", "ersen"] });
    expect(res.status).toBe(400);
  });

  it("mark the message a conversation started over at", async () => {
    const at = new Date();
    await db.waMessage.create({
      data: {
        waMessageId: "wamid.CA.reset",
        from: PHONE,
        text: "/new",
        msgType: "text",
        ts: at,
        direction: "IN",
        status: "DIJAWAB_AGEN",
        intent: "sistem:reset",
        entities: {},
        answeredByAgent: true,
        answeredAt: at,
        replyText: "Chat baru dimulai",
      },
    });
    const res = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { reset: boolean }) => m.reset)).toEqual([
      true,
    ]);
  });
});

describe("action items on a conversation", () => {
  it("are listed with the figures a colleague needs, money as strings", async () => {
    await handedOver("kalau 7jt boleh kak?");
    const res = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0]).toMatchObject({
      kind: "NEGOTIATION",
      status: "OPEN",
      summary: "Nego Air M1",
      askPrice: "7000000",
      listPrice: "7500000",
    });

    const list = await request(app)
      .get("/api/inbox")
      .set("Cookie", staffCookie);
    expect(list.body.threads[0].openActions).toEqual(["NEGOTIATION"]);
  });

  it("answer a negotiation with the price and the sentence, in one go", async () => {
    const { action } = await handedOver("kalau 7jt boleh kak?");
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/actions/${action.id}/offer`)
      .set("Cookie", staffCookie)
      .send({ price: "7200000", text: "Bisa di Rp7.200.000 ya kak 😊" });
    expect(res.status).toBe(201);

    const done = await db.chatAction.findUniqueOrThrow({
      where: { id: action.id },
    });
    expect(done).toMatchObject({ status: "DONE", staffPrice: 7_200_000n });
    expect(done.resolvedById).not.toBeNull();
    // The hold lifts: nothing is waiting on a person any more.
    expect(
      await db.waMessage.count({
        where: { from: PHONE, status: "PERLU_STAF" },
      }),
    ).toBe(0);
    const out = await db.outbox.findFirstOrThrow();
    expect((out.payload as { body: string }).body).toBe(
      "Bisa di Rp7.200.000 ya kak 😊",
    );
  });

  it("refuses to answer the same negotiation twice", async () => {
    const { action } = await handedOver("7jt ya");
    const send = () =>
      request(app)
        .post(`/api/inbox/${PHONE}/actions/${action.id}/offer`)
        .set("Cookie", staffCookie)
        .send({ price: "7200000", text: "Bisa 7,2 ya kak" });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(409);
  });

  it("rejects a price that is not whole rupiah", async () => {
    const { action } = await handedOver("7jt ya");
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/actions/${action.id}/offer`)
      .set("Cookie", staffCookie)
      .send({ price: "7.2jt", text: "x" });
    expect(res.status).toBe(400);
  });

  it("closes as done without sending anything", async () => {
    const { action } = await handedOver("7jt ya");
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/actions/${action.id}/done`)
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(await db.outbox.count()).toBe(0);
    expect(
      (await db.chatAction.findUniqueOrThrow({ where: { id: action.id } }))
        .status,
    ).toBe("DONE");
  });

  it("all close when the thread is marked handled", async () => {
    await handedOver("7jt ya");
    await request(app)
      .post(`/api/inbox/${PHONE}/handled`)
      .set("Cookie", staffCookie);
    expect(await db.chatAction.count({ where: { status: "OPEN" } })).toBe(0);
  });

  it("close when a colleague answers in the chat, and only that chat's", async () => {
    // 2026-10-15: the task dialog and its Mark done are gone; the answer is
    // what settles the hand-over.
    const { action } = await handedOver("7jt ya");
    const now = new Date();
    const elsewhere = await db.chatAction.create({
      data: {
        from: "628980093999",
        kind: "PRICE",
        topic: "price",
        summary: "Harga Air M2",
        createdAt: now,
        updatedAt: now,
      },
    });
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/reply`)
      .set("Cookie", staffCookie)
      .send({ text: "Bisa kak, 7,2 ya" });
    expect(res.status).toBe(201);
    const closed = await db.chatAction.findUniqueOrThrow({
      where: { id: action.id },
    });
    expect(closed.status).toBe("DONE");
    expect(closed.resolvedById).not.toBeNull();
    expect(
      (await db.chatAction.findUniqueOrThrow({ where: { id: elsewhere.id } }))
        .status,
    ).toBe("OPEN");
  });
});

describe("the customer profile", () => {
  it("shows what the customer told the bot", async () => {
    await handedOver("halo");
    await db.customerProfile.create({
      data: {
        from: PHONE,
        name: "Budi",
        useCase: "editing video",
        budget: 15_000_000n,
        updatedAt: new Date(),
      },
    });
    const res = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie);
    // A budget saved before the range existed reads as a range of one.
    expect(res.body.profile).toMatchObject({
      name: "Budi",
      useCase: "editing video",
      budgetMin: "15000000",
      budgetMax: "15000000",
      facts: [],
    });
  });
});
