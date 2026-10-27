/**
 * Who wrote a reply, and what a thread is called (owner report 2026-10-27):
 * the bot's own "Bentar ya kak, aku cek dulu 🙏" read as **Staff** on /chat,
 * and the header and profile panel said **"unknown"**. Against a real
 * database, logged in as `nusantara_app`.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";
import { botWroteReply } from "../src/routes/inbox.js";

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
const PHONE = "628980092978";
const HOLDING = "Bentar ya kak, aku cek dulu 🙏";
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let cookie: string;
let staffId: string;

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
  const staff = await owner.staff.create({
    data: {
      username: "labels-staff",
      name: "Rina",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  staffId = staff.id;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "labels-staff", password: PASSWORD })
    .expect(200);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;

  const t0 = Date.now() - 30 * 60_000;
  const at = (min: number) => new Date(t0 + min * 60_000);
  const row = (
    id: string,
    min: number,
    data: Partial<Parameters<PrismaClient["waMessage"]["create"]>[0]["data"]>,
  ) =>
    owner.waMessage.create({
      data: {
        waMessageId: id,
        from: PHONE,
        // What a Baileys delivery with no push name once carried.
        name: "unknown",
        text: id,
        msgType: "text",
        ts: at(min),
        direction: "IN",
        status: "BARU",
        entities: {},
        answeredByAgent: false,
        ...data,
      },
    });
  // The bot's fixed hand-over line, still waiting.
  await row("waiting", 1, {
    status: "PERLU_STAF",
    replyText: HOLDING,
    answeredAt: at(1),
    entities: { handoff: { topic: "other", summary: "Perlu dibalas" } },
  });
  // The same line on a row a colleague since closed (their id stamped on it).
  await row("closed", 2, {
    status: "DIJAWAB_STAF",
    replyText: HOLDING,
    answeredById: staffId,
    answeredAt: at(3),
  });
  // A model-written hand-over line, recorded with the hand-over, then closed.
  await row("closed-own", 4, {
    status: "DIJAWAB_STAF",
    replyText: "Untuk taksirannya aku tanyain dulu ya kak",
    answeredById: staffId,
    answeredAt: at(5),
    entities: {
      handoff: {
        topic: "trade_in",
        reply: "Untuk taksirannya aku tanyain dulu ya kak",
      },
    },
  });
  // A colleague's own reply, written over the bot's hand-over row.
  await row("staff", 6, {
    status: "DIJAWAB_STAF",
    replyText: "Halo kak, ini Rina 😊",
    answeredById: staffId,
    answeredAt: at(7),
    entities: { handoff: { topic: "price", reply: HOLDING } },
  });
  // A placeholder a model filed as the name.
  await owner.customerProfile.create({
    data: { from: PHONE, name: "unknown", updatedAt: new Date() },
  });
});

afterAll(async () => {
  await truncateAll(owner);
  await owner.$disconnect();
  await appDb.$disconnect();
});

describe("a reply's author (2026-10-27)", () => {
  it("the bot's hand-over lines are Bot, a colleague's reply is theirs", async () => {
    const res = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    const by = new Map(
      (
        res.body.messages as Array<{
          text: string;
          reply: { byAgent: boolean; by: string | null } | null;
        }>
      ).map((m) => [m.text, m.reply]),
    );
    expect(by.get("waiting")).toMatchObject({ byAgent: true, by: null });
    expect(by.get("closed")).toMatchObject({ byAgent: true, by: null });
    expect(by.get("closed-own")).toMatchObject({ byAgent: true, by: null });
    expect(by.get("staff")).toMatchObject({ byAgent: false, by: "Rina" });
  });

  it("a hand-over line can be rated like any bot reply", async () => {
    const m = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "waiting" },
    });
    await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", cookie)
      .send({ messageId: m.id, rating: "BAD" })
      .expect(201);
    const s = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "staff" },
    });
    await request(app)
      .post("/api/chat/evaluations")
      .set("Cookie", cookie)
      .send({ messageId: s.id, rating: "BAD" })
      .expect(400);
  });

  it("reads the rule without a database", () => {
    expect(botWroteReply({ replyText: null, answeredByAgent: true })).toBe(
      false,
    );
    expect(
      botWroteReply({
        replyText: "x",
        answeredByAgent: true,
        answeredById: "s",
      }),
    ).toBe(true);
    expect(
      botWroteReply({
        replyText: "x",
        answeredByAgent: false,
        answeredById: "s",
      }),
    ).toBe(false);
  });
});

describe("no placeholder names (2026-10-27)", () => {
  it("the conversation and the list fall back to nothing, so the page prints the number", async () => {
    const one = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(one.body.name).toBeNull();
    expect(one.body.profile?.name ?? null).toBeNull();
    const list = await request(app)
      .get("/api/inbox")
      .set("Cookie", cookie)
      .expect(200);
    const thread = (
      list.body.threads as Array<{
        phone: string;
        name: string | null;
        displayName: string | null;
      }>
    ).find((x) => x.phone === PHONE);
    expect(thread).toMatchObject({ name: null, displayName: null });
  });
});

describe("why the bot hands over (Evaluation, 2026-10-27)", () => {
  it("counts the last 7 days by topic and by what forced it, with the newest examples", async () => {
    const now = Date.now();
    const handed = (
      id: string,
      daysAgo: number,
      handoff: Record<string, unknown>,
    ) =>
      owner.waMessage.create({
        data: {
          waMessageId: id,
          from: "628111222333",
          text: id,
          msgType: "text",
          ts: new Date(now - daysAgo * 86_400_000),
          direction: "IN",
          status: "PERLU_STAF",
          entities: {
            handoff: {
              ...handoff,
              at: new Date(now - daysAgo * 86_400_000).toISOString(),
            },
          },
          answeredByAgent: false,
          answeredAt: new Date(now - daysAgo * 86_400_000),
          replyText: HOLDING,
        },
      });
    await handed("crypto?", 1, {
      topic: "other",
      summary: "Perlu dibalas",
      forcedBy: "no_terminal_tool",
    });
    await handed("crypto lagi?", 2, {
      topic: "other",
      summary: "Perlu dibalas",
      forcedBy: "no_terminal_tool",
    });
    await handed("nego dong", 3, { topic: "negotiation", forcedBy: "route" });
    await handed("ongkir ke medan?", 4, { topic: "shipping_quote" });
    // Outside the window.
    await handed("lama sekali", 9, { topic: "other", forcedBy: "route" });

    const res = await request(app)
      .get("/api/chat/handovers")
      .set("Cookie", cookie)
      .expect(200);
    const body = res.body as {
      days: number;
      total: number;
      reasons: Array<{
        topic: string;
        reason: string;
        count: number;
        examples: Array<{ text: string }>;
      }>;
    };
    expect(body.days).toBe(7);
    const find = (topic: string, reason: string) =>
      body.reasons.find((r) => r.topic === topic && r.reason === reason);
    expect(find("other", "no_terminal_tool")).toMatchObject({
      count: 2,
      examples: [{ text: "crypto?" }, { text: "crypto lagi?" }],
    });
    expect(find("negotiation", "route")?.count).toBe(1);
    // The model's own choice reads as "bot".
    expect(find("shipping_quote", "bot")?.count).toBe(1);
    expect(find("other", "route")).toBeUndefined();
    // The fixtures above (labels) are hand-overs too, 30 minutes old.
    expect(body.total).toBe(body.reasons.reduce((n, r) => n + r.count, 0));
  });

  it("is for signed-in staff only", async () => {
    await request(app).get("/api/chat/handovers").expect(401);
  });
});
