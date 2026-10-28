/**
 * Why a customer message is still waiting (2026-10-27, owner: *"improve the
 * chatbot to not get stuck"*): what GET /api/inbox/:phone tells /chat, read
 * as `nusantara_app` like production, and the two doctor lines that show a
 * stuck bot at a glance.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";
import { runDoctor } from "../src/cli/chatbot-doctor.js";

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
const PHONE = "628980096001";
const MIN = 60_000;
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let cookie: string;
let staffId: string;

async function inbound(
  id: string,
  text: string,
  ts: Date,
  extra: Record<string, unknown> = {},
) {
  await owner.waMessage.create({
    data: {
      waMessageId: id,
      from: PHONE,
      name: "Test",
      text,
      msgType: "text",
      ts,
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
      ...extra,
    },
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
  const row = await owner.staff.create({
    data: {
      username: "wait-staff",
      name: "Rina",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  staffId = row.id;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "wait-staff", password: PASSWORD })
    .expect(200);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
});

afterAll(async () => {
  await owner.$disconnect();
  await appDb.$disconnect();
});

beforeEach(async () => {
  await owner.outbox.deleteMany({});
  await owner.chatAction.deleteMany({});
  await owner.waThreadMemory.deleteMany({});
  await owner.waMessage.deleteMany({});
});

const thread = async () =>
  (
    await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200)
  ).body as {
    botWait: {
      staffActive: { by: string | null; at: string; until: string } | null;
      writing: boolean;
      staleAfterMs: number;
    };
  };

describe("botWait on a thread", () => {
  it("names the colleague whose typed reply holds the bot out", async () => {
    const at = new Date(Date.now() - 3 * MIN);
    await inbound("bw.1", "bisa nego?", new Date(Date.now() - 10 * MIN), {
      status: "DIJAWAB_STAF",
      replyText: "Bisa kak, 14jt ya",
      answeredById: staffId,
      answeredAt: at,
    });
    await inbound("bw.2", "oke", new Date(Date.now() - 2 * MIN));
    const { botWait } = await thread();
    expect(botWait.staffActive).toMatchObject({
      by: "Rina",
      at: at.toISOString(),
    });
    expect(new Date(botWait.staffActive!.until).getTime()).toBe(
      at.getTime() + 15 * MIN,
    );
    expect(botWait.staleAfterMs).toBe(3 * MIN);
  });

  it("does not count the bot's own line a colleague closed with Mark handled", async () => {
    await inbound("bw.3", "nego?", new Date(Date.now() - 10 * MIN), {
      status: "DIJAWAB_STAF",
      replyText: "Untuk nego harganya aku tanyain ke owner dulu ya kak 🙏",
      answeredById: staffId,
      answeredAt: new Date(Date.now() - MIN),
    });
    await inbound("bw.4", "halo", new Date(Date.now() - 30_000));
    expect((await thread()).botWait.staffActive).toBeNull();
  });

  it("says when a turn is writing", async () => {
    await inbound("bw.5", "halo", new Date(Date.now() - 30_000));
    await owner.waThreadMemory.create({
      data: {
        from: PHONE,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        leaseUntil: new Date(Date.now() + MIN),
        leasedBy: "worker",
      },
    });
    expect((await thread()).botWait.writing).toBe(true);
  });
});

describe("the doctor", () => {
  it("names the oldest unanswered message and a stuck outbox row", async () => {
    const now = new Date();
    await inbound("dr.1", "halo", new Date(now.getTime() - 12 * MIN));
    await owner.outbox.create({
      data: {
        kind: "WA_REPLY",
        payload: { to: PHONE, body: "x" },
        status: "SENDING",
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() - 20 * MIN),
        createdAt: new Date(now.getTime() - 20 * MIN),
      },
    });
    const checks = await runDoctor(owner, {}, now);
    const oldest = checks.find((c) => /oldest unanswered/i.test(c.title));
    expect(oldest).toMatchObject({ level: "fail" });
    expect(oldest!.title).toMatch(/12 min/);
    const stuck = checks.find((c) =>
      /claimed and never finished/i.test(c.title),
    );
    expect(stuck).toMatchObject({ level: "fail" });
  });

  it("is quiet when nothing waits", async () => {
    const checks = await runDoctor(owner, {}, new Date());
    expect(
      checks.find((c) => /oldest unanswered/i.test(c.title)),
    ).toBeUndefined();
    expect(
      checks.find((c) => /claimed and never finished/i.test(c.title)),
    ).toBeUndefined();
  });
});

describe("the doctor says who answered (2026-10-28)", () => {
  const run = (model: string, ago: number) =>
    owner.agentRun.create({
      data: {
        from: PHONE,
        pipeline: "rules",
        outcome: "REPLIED",
        createdAt: new Date(Date.now() - ago),
        steps: {
          create: [
            { sortOrder: 0, agent: "ROUTER", model: "rules", ok: true, ms: 0 },
            { sortOrder: 1, agent: "ADVISOR", model, ok: true, ms: 0 },
          ],
        },
      },
    });

  it("fails when every reply in the last day was a template, and counts the AI's", async () => {
    await owner.agentRunStep.deleteMany({});
    await owner.agentEvaluation.deleteMany({});
    await owner.agentRun.deleteMany({});
    await run("template", 60_000);
    await run("template", 120_000);
    let checks = await runDoctor(owner, {}, new Date());
    expect(
      checks.find((c) => /every one was a template/i.test(c.title)),
    ).toMatchObject({ level: "fail" });
    await run("claude-haiku-4-5", 30_000);
    checks = await runDoctor(owner, {}, new Date());
    expect(
      checks.find((c) => /The AI wrote 1 of/i.test(c.title)),
    ).toMatchObject({ level: "ok" });
  });
});
