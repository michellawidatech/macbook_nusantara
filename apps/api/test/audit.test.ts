/**
 * /api/audit — the chatbot audit's dashboard (2026-11-18), against a real
 * seeded database: Widatech only, a reader plus dismiss / undo.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, seed } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const PASSWORD = "rahasia-sekali";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let cookie: string;
let ownerId: string;
let threadId: string;
let flagId: string;
let botMessageId: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  await seed(db, { referenceOnly: true });
  const owner = await db.staff.update({
    where: { username: "pemilik" },
    data: { passwordHash: await hashPassword(PASSWORD), canViewAudit: false },
  });
  ownerId = owner.id;
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "pemilik", password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;

  const at = new Date("2026-11-18T02:00:00.000Z");
  const m = await db.waMessage.create({
    data: {
      waMessageId: "audit-api-1",
      from: "628111000601",
      text: "mau cari macbook",
      msgType: "text",
      ts: at,
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      replyText: "Air 2014, 2,3jt",
      answeredByAgent: true,
      answeredAt: at,
    },
  });
  botMessageId = m.id;
  const run = await db.chatReviewRun.create({
    data: {
      startedAt: new Date(),
      finishedAt: new Date(),
      model: "claude-sonnet-5-5",
      status: "DONE",
      chats: 1,
      flags: 1,
      costMicros: 12_345n,
    },
  });
  const thread = await db.chatReviewThread.create({
    data: {
      runId: run.id,
      from: m.from,
      reviewedFrom: at,
      reviewedTo: at,
      flagCount: 1,
      createdAt: new Date(),
      flags: {
        create: [
          {
            messageId: m.id,
            category: "MISSED_SALE",
            severity: "BAD",
            quote: "Air 2014, 2,3jt",
            suggestion: "Ask what it is for first.",
            createdAt: new Date(),
          },
        ],
      },
    },
    include: { flags: true },
  });
  threadId = thread.id;
  flagId = thread.flags[0]!.id;
});

afterAll(async () => {
  await db.$disconnect();
});

const as = (method: "get" | "post", path: string) =>
  request(app)[method](path).set("Cookie", cookie);

describe("/api/audit", () => {
  it("refuses an account without the switch — the owner included", async () => {
    expect((await as("get", "/api/audit/runs")).status).toBe(403);
    expect((await as("get", "/api/audit/flags")).status).toBe(403);
    expect((await as("get", "/api/audit/model")).status).toBe(403);
    expect((await as("get", "/api/audit/run")).status).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/audit/run")
          .set("Cookie", cookie)
          .send({ days: 7 })
      ).status,
    ).toBe(403);
    const put = await request(app)
      .put("/api/audit/model")
      .set("Cookie", cookie)
      .send({ model: "claude-haiku-4-5" });
    expect(put.status).toBe(403);
  });

  it("never shows the switch on the owner's Staff accounts screen", async () => {
    const res = await as("get", "/api/staff");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("canViewAudit");
  });

  describe("with the switch on", () => {
    beforeAll(async () => {
      await db.staff.update({
        where: { id: ownerId },
        data: { canViewAudit: true },
      });
    });

    it("says so on /api/auth/me, for the menu link", async () => {
      const res = await as("get", "/api/auth/me");
      expect(res.body.staff.canViewAudit).toBe(true);
    });

    it("lists the nights with their totals and per-category counts", async () => {
      const res = await as("get", "/api/audit/runs");
      expect(res.status).toBe(200);
      expect(res.body.runs[0]).toMatchObject({
        status: "DONE",
        chats: 1,
        costMicros: "12345",
        chatsWithBad: 1,
        byCategory: { MISSED_SALE: 1, BAD: 1 },
      });
    });

    it("lists flags with filters", async () => {
      const all = await as("get", "/api/audit/flags");
      expect(all.body.flags).toHaveLength(1);
      expect(all.body.flags[0]).toMatchObject({
        id: flagId,
        category: "MISSED_SALE",
        from: "628111000601",
      });
      const tone = await as("get", "/api/audit/flags?category=TONE");
      expect(tone.body.flags).toHaveLength(0);
      expect((await as("get", "/api/audit/flags?category=NOPE")).status).toBe(
        400,
      );
    });

    it("shows the chat window a review read, with its flags", async () => {
      const res = await as("get", `/api/audit/threads/${threadId}`);
      expect(res.status).toBe(200);
      expect(res.body.lines.map((l: { who: string }) => l.who)).toEqual([
        "customer",
        "bot",
      ]);
      expect(res.body.flags[0].messageId).toBe(botMessageId);
    });

    it("dismisses a flag and takes the dismissal back", async () => {
      const d = await as("post", `/api/audit/flags/${flagId}/dismiss`);
      expect(d.status).toBe(200);
      expect(d.body.flag.dismissedAt).not.toBeNull();
      const open = await as("get", "/api/audit/flags?dismissed=no");
      expect(open.body.flags).toHaveLength(0);
      const u = await as("post", `/api/audit/flags/${flagId}/undismiss`);
      expect(u.body.flag.dismissedAt).toBeNull();
      expect((await as("post", "/api/audit/flags/nope/dismiss")).status).toBe(
        404,
      );
    });

    it("scores the period: the conversation, its bot reply and the category, a dismissed flag not counted", async () => {
      const res = await as("get", "/api/audit/score?days=7");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        days: 7,
        chats: 1,
        good: 0,
        bad: 1,
        botReplies: 1,
        flaggedReplies: 1,
      });
      expect(
        res.body.byCategory.find(
          (c: { category: string }) => c.category === "MISSED_SALE",
        ),
      ).toEqual({ category: "MISSED_SALE", flags: 1, bad: 1, chats: 1 });
      await as("post", `/api/audit/flags/${flagId}/dismiss`);
      const after = await as("get", "/api/audit/score?days=7");
      expect(after.body).toMatchObject({ good: 1, bad: 0, flaggedReplies: 0 });
      await as("post", `/api/audit/flags/${flagId}/undismiss`);
      expect((await as("get", "/api/audit/score?days=0")).status).toBe(400);
    });

    it("files a 'run the review now' request, one at a time, answered by a run that starts after it", async () => {
      expect((await as("get", "/api/audit/run")).body.pending).toBeNull();
      const post = (body: object) =>
        request(app).post("/api/audit/run").set("Cookie", cookie).send(body);
      expect((await post({ days: 0 })).status).toBe(400);
      expect((await post({ days: 91 })).status).toBe(400);
      const ok = await post({ days: 7 });
      expect(ok.status).toBe(200);
      expect(ok.body.pending.days).toBe(7);
      expect((await post({ days: 7 })).status).toBe(409);
      const log = await db.auditLog.findFirstOrThrow({
        where: { entityId: "chatbot.reviewRequest" },
      });
      expect(log.staffId).toBe(ownerId);
      // The worker's run, started after the request and ended, answers it.
      await db.chatReviewRun.create({
        data: {
          startedAt: new Date(Date.now() + 1_000),
          finishedAt: new Date(Date.now() + 2_000),
          model: "claude-haiku-4-5",
          status: "DONE",
        },
      });
      expect((await as("get", "/api/audit/run")).body.pending).toBeNull();
      expect((await post({ days: 30 })).status).toBe(200);
    });

    it("picks the reviewer model from the list only, and logs who did", async () => {
      const first = await as("get", "/api/audit/model");
      expect(first.status).toBe(200);
      expect(first.body.model).toBe("claude-sonnet-5-5");
      expect(first.body.models.map((m: { id: string }) => m.id)).toEqual([
        "claude-sonnet-5-5",
        "claude-opus-4-5",
        "claude-haiku-4-5",
      ]);
      const put = (model: unknown) =>
        request(app)
          .put("/api/audit/model")
          .set("Cookie", cookie)
          .send({ model });
      expect((await put("gpt-9")).status).toBe(400);
      expect((await put(null)).status).toBe(400);
      const ok = await put("claude-haiku-4-5");
      expect(ok.status).toBe(200);
      expect(ok.body.model).toBe("claude-haiku-4-5");
      expect((await as("get", "/api/audit/model")).body.model).toBe(
        "claude-haiku-4-5",
      );
      const log = await db.auditLog.findFirstOrThrow({
        where: { entityId: "chatbot.reviewModel" },
        orderBy: { at: "desc" },
      });
      expect(log).toMatchObject({
        staffId: ownerId,
        before: "claude-sonnet-5-5",
        after: "claude-haiku-4-5",
      });
    });
  });
});
