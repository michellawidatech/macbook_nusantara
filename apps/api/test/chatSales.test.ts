/**
 * The sales side of /chat (2026-10-27), against a real database: the funnel
 * on the Evaluation tab, and the "tell me when it's in stock" watches staff
 * close from the profile column.
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
/**
 * The same database as the API's own role, to prove the grants. Parsed, not
 * string-replaced: CI's URL carries a password, and `//nusantara@` then never
 * matches — the test ran as the owner and the refusal it expects never came.
 */
const APP_URL = (() => {
  const u = new globalThis.URL(URL);
  u.username = "nusantara_app";
  u.password = "";
  return u.toString();
})();
const PASSWORD = "rahasia-sekali";
const PHONE = "628980095001";
const OTHER = "628980095002";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });
const DAY = 86_400_000;

let db: PrismaClient;
let app: Express;
let cookie: string;
let staffId: string;
let locationId: string;

async function clean() {
  await db.stockWatch.deleteMany({});
  await db.order.deleteMany({ where: { id: { startsWith: "fn_" } } });
  await db.reservationItem.deleteMany({
    where: { reservationId: { startsWith: "fn_" } },
  });
  await db.reservation.deleteMany({ where: { id: { startsWith: "fn_" } } });
  await db.chatAction.deleteMany({});
  await db.waThreadMemory.deleteMany({});
  await db.chatMemoryChunk.deleteMany({});
  await db.waMessage.deleteMany({});
  await db.customer.deleteMany({ where: { id: { startsWith: "fn_" } } });
  await db.auditLog.deleteMany({ where: { entity: "StockWatch" } });
}

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  const staff = await db.staff.upsert({
    where: { username: "chat-sales-staff" },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      username: "chat-sales-staff",
      name: "Rina",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  staffId = staff.id;
  const loc = await db.location.upsert({
    where: { code: "FN" },
    update: {},
    create: {
      code: "FN",
      name: "Funnel shop",
      kind: "TOKO",
      active: true,
      sortOrder: 99,
    },
  });
  locationId = loc.id;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "chat-sales-staff", password: PASSWORD });
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
});

afterAll(async () => {
  await clean();
  await db.$disconnect();
});

beforeEach(clean);

const inbound = (from: string, ago: number, n = 0) =>
  db.waMessage.create({
    data: {
      waMessageId: `wamid.FN.${from}.${ago}.${n}`,
      from,
      text: "halo",
      msgType: "text",
      ts: new Date(Date.now() - ago),
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      answeredByAgent: true,
    },
  });

const order = (
  id: string,
  ago: number,
  opts: { customerId?: string; phone?: string; status?: "LUNAS" | "BATAL" },
) =>
  db.order.create({
    data: {
      id,
      ts: new Date(Date.now() - ago),
      platform: "WA",
      fulfill: "PICKUP",
      status: opts.status ?? "LUNAS",
      subtotal: 10_000_000n,
      discount: 0n,
      extra: 0n,
      total: 10_000_000n,
      paidTotal: 10_000_000n,
      cogs: 8_000_000n,
      tradeCredit: 0n,
      belowFloor: false,
      soldById: staffId,
      locationId,
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.phone ? { phone: opts.phone } : {}),
    },
  });

describe("the funnel", () => {
  it("counts chats, leads, visits, closing tasks and sales per window", async () => {
    // Two threads this week; one more three weeks ago.
    await inbound(PHONE, 3 * DAY);
    await inbound(PHONE, 2 * DAY, 1);
    await inbound(OTHER, 1 * DAY);
    await inbound("628980095003", 20 * DAY);
    // A message from long ago is nobody's chat in either window.
    await inbound("628980095004", 45 * DAY);

    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        leadScore: 80,
        leadAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await db.waThreadMemory.create({
      data: {
        from: "628980095003",
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        leadScore: 70,
        leadAt: new Date(Date.now() - 19 * DAY),
      },
    });

    const customer = await db.customer.create({
      data: {
        id: "fn_c1",
        name: "Budi",
        phone: `+${PHONE}`,
        createdAt: new Date(),
      },
    });
    // A visit the bot booked, and a staff hold that is not one.
    await db.reservation.create({
      data: {
        id: "fn_r1",
        customerId: customer.id,
        phone: `+${PHONE}`,
        scheduledFor: new Date(Date.now() + DAY),
        status: "TERJADWAL",
        source: "AGEN",
        createdAt: new Date(Date.now() - DAY),
      },
    });
    await db.reservation.create({
      data: {
        id: "fn_r2",
        customerId: customer.id,
        phone: `+${PHONE}`,
        status: "TERJADWAL",
        source: "STAF",
        createdAt: new Date(Date.now() - DAY),
      },
    });
    await db.chatAction.create({
      data: {
        from: PHONE,
        kind: "CLOSING",
        topic: "closing",
        summary: "Perlu closing — Budi siap ambil Air M2",
        createdAt: new Date(Date.now() - DAY),
        updatedAt: new Date(),
      },
    });
    // Sold to Budi a day after his first message; a cancelled one does not count.
    await order("fn_o1", 1 * DAY, { customerId: customer.id });
    await order("fn_o2", 1 * DAY, {
      customerId: customer.id,
      status: "BATAL",
    });
    // The other thread bought by its order's own number.
    await order("fn_o3", DAY / 2, { phone: OTHER });
    // A sale before the thread's first message is not the chat's.
    await order("fn_o4", 25 * DAY, { phone: "628980095003" });

    const res = await request(app)
      .get("/api/chat/funnel")
      .set("Cookie", cookie)
      .expect(200);
    const [week, month] = res.body.windows;
    expect(week).toMatchObject({
      days: 7,
      chats: 2,
      leads: 1,
      visits: 1,
      closing: 1,
      sales: 2,
    });
    expect(month).toMatchObject({
      days: 30,
      chats: 3,
      leads: 2,
      visits: 1,
      closing: 1,
      sales: 2,
    });
    // Counts only: nothing on the funnel is money.
    expect(JSON.stringify(res.body)).not.toMatch(/10000000/);
  });

  it("leaves out tester numbers and what came before a clear", async () => {
    const TESTER = "628980095009";
    await db.appSetting.upsert({
      where: { key: "chatbot.testers" },
      update: { value: TESTER, updatedAt: new Date() },
      create: { key: "chatbot.testers", value: TESTER, updatedAt: new Date() },
    });
    await inbound(TESTER, 1 * DAY);
    await db.chatAction.create({
      data: {
        from: TESTER,
        kind: "CLOSING",
        topic: "closing",
        summary: "Perlu closing — tester",
        createdAt: new Date(Date.now() - DAY),
        updatedAt: new Date(),
      },
    });
    // A cleared chat: its lead and closing task came before the clear, and
    // nothing has been written since.
    await inbound(PHONE, 3 * DAY);
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        leadScore: 80,
        leadAt: new Date(Date.now() - 3 * DAY),
        clearedAt: new Date(Date.now() - 2 * DAY),
        clearedById: staffId,
      },
    });
    await db.chatAction.create({
      data: {
        from: PHONE,
        kind: "CLOSING",
        topic: "closing",
        summary: "Perlu closing — before the clear",
        createdAt: new Date(Date.now() - 3 * DAY),
        updatedAt: new Date(),
      },
    });
    const res = await request(app)
      .get("/api/chat/funnel")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.windows[0]).toMatchObject({
      chats: 0,
      leads: 0,
      closing: 0,
    });
  });

  it("needs a signed-in member of staff", async () => {
    await request(app).get("/api/chat/funnel").expect(401);
  });
});

describe("stock watches", () => {
  const watch = (id: string, from: string, extra = {}) =>
    db.stockWatch.create({
      data: {
        id,
        from,
        query: "macbook air m3 16/512",
        budget: 20_000_000n,
        createdAt: new Date(Date.now() - DAY),
        ...extra,
      },
    });

  it("lists the thread's watches with the conversation, open ones first", async () => {
    await inbound(PHONE, 60_000);
    await watch("sw_closed", PHONE, {
      closedAt: new Date(),
      createdAt: new Date(Date.now() - DAY / 2),
    });
    await watch("sw_open", PHONE);
    await watch("sw_theirs", OTHER);

    const list = await request(app)
      .get(`/api/inbox/${PHONE}/watches`)
      .set("Cookie", cookie)
      .expect(200);
    expect(list.body.watches.map((w: { id: string }) => w.id)).toEqual([
      "sw_open",
      "sw_closed",
    ]);
    expect(list.body.watches[0]).toMatchObject({
      query: "macbook air m3 16/512",
      budget: "20000000",
      closedAt: null,
      notifiedAt: null,
    });

    const thread = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(thread.body.watches.map((w: { id: string }) => w.id)).toEqual([
      "sw_open",
      "sw_closed",
    ]);
  });

  it("closes one, audited, and never another thread's", async () => {
    await watch("sw_open", PHONE);
    await watch("sw_theirs", OTHER);

    await request(app)
      .post(`/api/inbox/${PHONE}/watches/sw_theirs/close`)
      .set("Cookie", cookie)
      .expect(404);
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/watches/sw_open/close`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.watches[0].closedAt).not.toBeNull();
    // Closing twice is a 404, not a second stamp.
    await request(app)
      .post(`/api/inbox/${PHONE}/watches/sw_open/close`)
      .set("Cookie", cookie)
      .expect(404);
    const audit = await db.auditLog.findMany({
      where: { entity: "StockWatch", entityId: "sw_open" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.staffId).toBe(staffId);
    const theirs = await db.stockWatch.findUnique({
      where: { id: "sw_theirs" },
    });
    expect(theirs!.closedAt).toBeNull();
  });

  it("is closable by the API's own role and by no wider write", async () => {
    await watch("sw_open", PHONE);
    const appDb = new PrismaClient({ datasourceUrl: APP_URL });
    try {
      const { count } = await appDb.stockWatch.updateMany({
        where: { id: "sw_open", closedAt: null },
        data: { closedAt: new Date() },
      });
      expect(count).toBe(1);
      await expect(
        appDb.stockWatch.updateMany({
          where: { id: "sw_open" },
          data: { query: "something else" },
        }),
      ).rejects.toThrow();
      await expect(
        appDb.stockWatch.deleteMany({ where: { id: "sw_open" } }),
      ).rejects.toThrow();
    } finally {
      await appDb.$disconnect();
    }
  });
});
