/**
 * /api/inbox, against a real database.
 *
 * The bug this endpoint exists to fix was invisible rather than loud: the Chat
 * page rendered the mock store, so a message the webhook had genuinely written
 * to Postgres never reached the screen. These tests assert the thing that was
 * missing — a real `WaMessage` row comes back — and then the parts around it
 * that are easy to get quietly wrong: the 24-hour window, and the fact that a
 * staff reply must commit an outbox intent in the same transaction.
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
const PHONE = "628980092978";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let cookie: string;

/** An inbound message exactly as apps/whatsapp-webhook writes one. */
async function inbound(opts: {
  id: string;
  from?: string;
  text: string;
  ts?: Date;
}) {
  return db.waMessage.create({
    data: {
      waMessageId: opts.id,
      from: opts.from ?? PHONE,
      name: "Michella",
      text: opts.text,
      msgType: "text",
      ts: opts.ts ?? new Date(),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();

  // A staff row to log in as. The seed writes unusable hashes on purpose, and
  // this suite does not need the 5 000 units the inventori suite seeds.
  await db.staff.upsert({
    where: { username: "inbox-test" },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      username: "inbox-test",
      name: "Inbox Tester",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      // Not defaulted in the schema — this build sets its timestamps explicitly.
      createdAt: new Date(),
    },
  });

  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "inbox-test", password: PASSWORD });
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.outbox.deleteMany({});
  await db.waMessage.deleteMany({});
});

const get = (path: string) =>
  request(app).get(`/api/inbox${path}`).set("Cookie", cookie);

describe("GET /api/inbox", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/inbox")).status).toBe(401);
  });

  it("returns a real inbound message as a waiting thread", async () => {
    // The exact shape of the message that went missing: stored, unanswered.
    await inbound({ id: "wamid.INBOX1", text: "hwllo" });

    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0]).toMatchObject({
      phone: PHONE,
      name: "Michella",
      lastText: "hwllo",
      needsReply: true,
      pending: 1,
    });
    // A tally, not money: it must not arrive as a string (CLAUDE.md).
    expect(typeof res.body.threads[0].pending).toBe("number");
    // Fresh message, so the window is open and the reply box stays usable.
    expect(res.body.threads[0].windowClosesAt).not.toBeNull();
  });

  it("groups several messages from one sender into one thread", async () => {
    await inbound({
      id: "wamid.A1",
      text: "halo",
      ts: new Date(Date.now() - 3_000),
    });
    await inbound({
      id: "wamid.A2",
      text: "mau tanya",
      ts: new Date(Date.now() - 2_000),
    });
    await inbound({
      id: "wamid.A3",
      text: "ada macbook?",
      ts: new Date(Date.now() - 1_000),
    });

    const res = await get("");
    expect(res.body.threads).toHaveLength(1);
    // The newest message is the one the list shows.
    expect(res.body.threads[0].lastText).toBe("ada macbook?");
    expect(res.body.threads[0].pending).toBe(3);
  });

  it("reports a closed window as null so the UI can disable the reply box", async () => {
    await inbound({
      id: "wamid.OLD",
      text: "masih ada?",
      ts: new Date(Date.now() - 48 * 60 * 60_000),
    });

    const res = await get("");
    expect(res.body.threads[0].windowClosesAt).toBeNull();
  });
});

describe("GET /api/inbox/:phone", () => {
  it("rejects anything that is not a wa_id", async () => {
    expect((await get("/+62-898")).status).toBe(400);
  });

  it("404s a conversation that does not exist", async () => {
    expect((await get("/628000000000")).status).toBe(404);
  });

  it("returns the messages oldest first, with the reply hanging off its row", async () => {
    const first = await inbound({
      id: "wamid.B1",
      text: "ada macbook?",
      ts: new Date(Date.now() - 60_000),
    });
    await db.waMessage.update({
      where: { id: first.id },
      data: {
        replyText: "ready kak",
        status: "DIJAWAB_AGEN",
        answeredByAgent: true,
        answeredAt: new Date(),
      },
    });
    await inbound({ id: "wamid.B2", text: "berapa?" });

    const res = await get(`/${PHONE}`);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "ada macbook?",
      "berapa?",
    ]);
    expect(res.body.messages[0].reply).toMatchObject({
      text: "ready kak",
      byAgent: true,
    });
    expect(res.body.messages[1].reply).toBeNull();
  });
});

describe("POST /api/inbox/:phone/reply", () => {
  it("writes the answer and the send intent in one go", async () => {
    await inbound({ id: "wamid.C1", text: "ada macbook?" });

    const res = await request(app)
      .post(`/api/inbox/${PHONE}/reply`)
      .set("Cookie", cookie)
      .send({ text: "ready kak, 15.500.000" });

    expect(res.status).toBe(201);
    // "QUEUED", not "sent": the row is committed and the worker delivers it.
    expect(res.body.status).toBe("QUEUED");

    const msg = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "wamid.C1" },
    });
    expect(msg.replyText).toBe("ready kak, 15.500.000");
    expect(msg.status).toBe("DIJAWAB_STAF");
    expect(msg.answeredByAgent).toBe(false);
    expect(msg.answeredById).not.toBeNull();

    // 08 §5: the intent commits with the answer, so a crash cannot leave a
    // reply the customer was promised but never sent.
    const outbox = await db.outbox.findFirstOrThrow({});
    expect(outbox.kind).toBe("WA_REPLY");
    expect(outbox.status).toBe("PENDING");
    expect(outbox.payload).toMatchObject({
      to: PHONE,
      body: "ready kak, 15.500.000",
    });
  });

  it("closes the earlier fragments the same answer covers", async () => {
    await inbound({
      id: "wamid.C2",
      text: "halo",
      ts: new Date(Date.now() - 3_000),
    });
    await inbound({
      id: "wamid.C3",
      text: "ada macbook?",
      ts: new Date(Date.now() - 1_000),
    });

    await request(app)
      .post(`/api/inbox/${PHONE}/reply`)
      .set("Cookie", cookie)
      .send({ text: "ready kak" })
      .expect(201);

    const rows = await db.waMessage.findMany({ where: { from: PHONE } });
    // Otherwise the thread stays red forever over a message already answered.
    expect(rows.every((r) => r.status === "DIJAWAB_STAF")).toBe(true);
  });

  it("refuses to queue a reply that cannot be delivered", async () => {
    await inbound({
      id: "wamid.C4",
      text: "masih ada?",
      ts: new Date(Date.now() - 48 * 60 * 60_000),
    });

    const res = await request(app)
      .post(`/api/inbox/${PHONE}/reply`)
      .set("Cookie", cookie)
      .send({ text: "maaf telat" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KONFLIK");
    // Nothing written: no half-answered message, no undeliverable intent.
    expect(await db.outbox.count()).toBe(0);
    const msg = await db.waMessage.findFirstOrThrow({
      where: { waMessageId: "wamid.C4" },
    });
    expect(msg.replyText).toBeNull();
  });

  it("rejects an empty reply", async () => {
    await inbound({ id: "wamid.C5", text: "halo" });
    const res = await request(app)
      .post(`/api/inbox/${PHONE}/reply`)
      .set("Cookie", cookie)
      .send({ text: "   " });
    expect(res.status).toBe(400);
  });
});
