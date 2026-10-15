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
  // Before the messages: `WaThreadMemory.coveredThroughId` is an FK to
  // WaMessage with onDelete Restrict, and `from` is unique, so a leftover row
  // would both block the delete and collide with the next test's fixture.
  await db.waThreadMemory.deleteMany({});
  // ChatAction points at WaMessage, Unit and Customer (2026-09-29).
  await db.chatAction.deleteMany({});
  await db.customerProfileFact.deleteMany({});
  await db.customerProfile.deleteMany({});
  // AgentRun points at the message it answered (chatbot v2).
  await db.agentRunStep.deleteMany({});
  await db.agentRun.deleteMany({});
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

/**
 * What the staff context panel reads.
 *
 * All of it comes from rows the system already keeps: the agent's own rolling
 * note in `WaThreadMemory`, and `Customer` matched on the number. Nothing here
 * is composed in the browser and nothing is inferred — an unknown number has
 * to come back as unknown, because a plausible-looking empty profile is worse
 * than an honest blank.
 */
describe("GET /api/inbox/:phone — the context panel", () => {
  const PHONE = "628111000424";

  it("returns no summary and no customer for a number the shop has never seen", async () => {
    await inbound({ id: "ctx.1", from: PHONE, text: "halo" });

    const res = await get(`/${PHONE}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeNull();
    expect(res.body.customer).toBeNull();
    expect(res.body.directive).toBeNull();
  });

  it("returns the note the agent wrote, and when it wrote it", async () => {
    await inbound({ id: "ctx.2", from: PHONE, text: "mau macbook" });
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        summary: "Cari MacBook buat kuliah. Budget belum disebut.",
        summaryAt: new Date("2026-08-20T03:00:00.000Z"),
        summaryTurns: 3,
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });

    const res = await get(`/${PHONE}`);

    expect(res.body.summary.text).toContain("Budget belum disebut");
    expect(res.body.summary.at).toBe("2026-08-20T03:00:00.000Z");
  });

  it("finds the customer from the bare number even though the shop stores E.164", async () => {
    await inbound({ id: "ctx.3", from: PHONE, text: "halo" });
    await db.customer.create({
      data: {
        id: "cust_ctx",
        name: "Budi",
        phone: `+${PHONE}`,
        createdAt: new Date("2025-03-14T00:00:00.000Z"),
      },
    });

    const res = await get(`/${PHONE}`);

    expect(res.body.customer).toMatchObject({
      name: "Budi",
      phone: `+${PHONE}`,
      orderCount: 0,
      openReservations: 0,
      lastOrder: null,
    });
    expect(res.body.customer.since).toBe("2025-03-14T00:00:00.000Z");

    await db.customer.deleteMany({ where: { id: "cust_ctx" } });
  });

  it("never returns a customer's address, email or internal note", async () => {
    // A WhatsApp number changes hands, and the panel is read by whoever is on
    // shift. Name and history only.
    await inbound({ id: "ctx.4", from: PHONE, text: "halo" });
    await db.customer.create({
      data: {
        id: "cust_pii",
        name: "Budi",
        phone: `+${PHONE}`,
        email: "rahasia@example.com",
        street: "Jalan Rahasia No 1",
        note: "catatan internal staf",
        createdAt: new Date(),
      },
    });

    const body = JSON.stringify((await get(`/${PHONE}`)).body);

    expect(body).not.toContain("rahasia@example.com");
    expect(body).not.toContain("Jalan Rahasia");
    expect(body).not.toContain("catatan internal staf");

    await db.customer.deleteMany({ where: { id: "cust_pii" } });
  });

  it("carries a staff directive through, so the panel can show what the bot was told", async () => {
    await inbound({ id: "ctx.5", from: PHONE, text: "boleh nego?" });
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        directive: "kasih diskon 200rb kalau nawar",
        directiveAt: new Date(),
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });

    expect((await get(`/${PHONE}`)).body.directive).toBe(
      "kasih diskon 200rb kalau nawar",
    );
  });

  it("still answers the conversation when there is no summary to show", async () => {
    // Summary generation must never be able to break the inbox.
    await inbound({ id: "ctx.6", from: PHONE, text: "halo" });

    const res = await get(`/${PHONE}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });
});

/**
 * The per-thread bot switch.
 *
 * `WaThreadMemory.autoReply` decides whether the worker answers this ONE
 * customer unattended. The cases worth pinning down are the ones that are
 * silently wrong rather than loudly broken: a thread with no memory row must
 * read as on (or the whole inbox reads as switched off the day this shipped),
 * flipping it must not disturb the summariser's columns, and it must not be
 * possible to create memory rows for numbers that were never customers.
 */
describe("PUT /api/inbox/:phone/auto-reply", () => {
  const put = (path: string, body: unknown) =>
    request(app)
      .put(`/api/inbox${path}`)
      .set("Cookie", cookie)
      .send(body as object);

  it("requires a session", async () => {
    const res = await request(app)
      .put(`/api/inbox/${PHONE}/auto-reply`)
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it("reads as on for a thread nobody has ruled on", async () => {
    await inbound({ id: "sw.1", from: PHONE, text: "halo" });

    const res = await get(`/${PHONE}`);

    expect(res.body.autoReply).toEqual({ enabled: true, by: null, at: null });
  });

  it("lists a thread as on when it has no memory row", async () => {
    await inbound({ id: "sw.2", from: PHONE, text: "halo" });

    const res = await get("");

    expect(res.body.threads[0].autoReply).toBe(true);
  });

  it("switches one thread off and records who did it", async () => {
    await inbound({ id: "sw.3", from: PHONE, text: "mau nego" });

    const res = await put(`/${PHONE}/auto-reply`, { enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.by).toBe("Inbox Tester");
    expect(res.body.at).toEqual(expect.any(String));

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: PHONE },
    });
    expect(memo.autoReply).toBe(false);
    expect(memo.autoReplyById).not.toBeNull();
  });

  it("shows the switch and its provenance on the conversation afterwards", async () => {
    await inbound({ id: "sw.4", from: PHONE, text: "halo" });
    await put(`/${PHONE}/auto-reply`, { enabled: false });

    const res = await get(`/${PHONE}`);

    expect(res.body.autoReply.enabled).toBe(false);
    expect(res.body.autoReply.by).toBe("Inbox Tester");
    expect((await get("")).body.threads[0].autoReply).toBe(false);
  });

  it("switches back on without losing who touched it last", async () => {
    await inbound({ id: "sw.5", from: PHONE, text: "halo" });
    await put(`/${PHONE}/auto-reply`, { enabled: false });

    const res = await put(`/${PHONE}/auto-reply`, { enabled: true });

    expect(res.body.enabled).toBe(true);
    expect(res.body.by).toBe("Inbox Tester");
  });

  it("is idempotent, so a double press is not a double flip", async () => {
    await inbound({ id: "sw.6", from: PHONE, text: "halo" });

    await put(`/${PHONE}/auto-reply`, { enabled: false });
    const second = await put(`/${PHONE}/auto-reply`, { enabled: false });

    expect(second.body.enabled).toBe(false);
    expect(await db.waThreadMemory.count({ where: { from: PHONE } })).toBe(1);
  });

  it("leaves the summariser's columns alone", async () => {
    // 08 §7: two writers, disjoint column sets. Flipping the switch must not
    // be a way for staff to blank a summary the agent wrote — the column-level
    // grants say so in the database, and this says so from the outside.
    await inbound({ id: "sw.7", from: PHONE, text: "halo" });
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        summary: "Cari MacBook buat kuliah.",
        summaryAt: new Date("2026-08-20T03:00:00.000Z"),
        summaryTurns: 3,
        clarifyCount: 2,
        updatedAt: new Date(),
      },
    });

    await put(`/${PHONE}/auto-reply`, { enabled: false });

    const memo = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: PHONE },
    });
    expect(memo.summary).toBe("Cari MacBook buat kuliah.");
    expect(memo.summaryTurns).toBe(3);
    expect(memo.clarifyCount).toBe(2);
    expect(memo.autoReply).toBe(false);
  });

  it("keeps a staff directive on the same row", async () => {
    await inbound({ id: "sw.8", from: PHONE, text: "boleh nego?" });
    await db.waThreadMemory.create({
      data: {
        from: PHONE,
        directive: "kasih diskon 200rb kalau nawar",
        directiveAt: new Date(),
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
      },
    });

    await put(`/${PHONE}/auto-reply`, { enabled: false });

    expect((await get(`/${PHONE}`)).body.directive).toBe(
      "kasih diskon 200rb kalau nawar",
    );
  });

  it("404s a number that has never written in, rather than inventing a thread", async () => {
    const res = await put("/628111000111/auto-reply", { enabled: false });

    expect(res.status).toBe(404);
    expect(await db.waThreadMemory.count()).toBe(0);
  });

  it("rejects anything that is not a wa_id", async () => {
    expect(
      (await put("/not-a-number/auto-reply", { enabled: false })).status,
    ).toBe(400);
  });

  it("rejects a body that does not say which way", async () => {
    await inbound({ id: "sw.9", from: PHONE, text: "halo" });

    expect((await put(`/${PHONE}/auto-reply`, {})).status).toBe(400);
    expect((await put(`/${PHONE}/auto-reply`, { enabled: "off" })).status).toBe(
      400,
    );
  });
});

/**
 * The bot's hand-overs, as the inbox shows them (2026-09-18): which threads
 * the bot gave to a person, why, and the one action that gives a thread back
 * without writing a reply.
 */
describe("a thread the bot handed to a person", () => {
  /** A batch the worker handed over, exactly as apps/worker/src/draft.ts writes it. */
  async function handedOver(text = "air m1 ready kak?") {
    const row = await inbound({ id: `wamid.H${Math.random()}`, text });
    return db.waMessage.update({
      where: { id: row.id },
      data: {
        status: "PERLU_STAF",
        intent: "staf:stock",
        replyText: "Siap kak 😊 kami cekkan dulu ya",
        answeredAt: new Date(),
        entities: {
          handoff: {
            topic: "stock",
            summary: "Tanya stok MacBook Air M1",
            forcedBy: "route",
            at: new Date().toISOString(),
          },
        },
      },
    });
  }

  it("is listed first, with the topic and the bot's note", async () => {
    await inbound({ id: "wamid.QUIET", from: "628111000999", text: "halo" });
    await handedOver();

    const res = await get("");
    expect(res.body.threads[0]).toMatchObject({
      phone: PHONE,
      handoff: {
        topic: "stock",
        summary: "Tanya stok MacBook Air M1",
        forcedBy: "route",
      },
    });
    expect(res.body.threads[1].handoff).toBeNull();
  });

  it("says so on the conversation and on the message", async () => {
    await handedOver();
    const res = await get(`/${PHONE}`);
    expect(res.body.handoff).toMatchObject({ topic: "stock" });
    expect(res.body.messages[0].handoff).toMatchObject({
      topic: "stock",
      summary: "Tanya stok MacBook Air M1",
    });
  });

  it("reads an older escalation, with no note, as a hand-over too", async () => {
    const row = await inbound({ id: "wamid.OLD", text: "halo" });
    await db.waMessage.update({
      where: { id: row.id },
      data: { status: "PERLU_STAF", intent: "perlu_staf" },
    });
    const res = await get("");
    expect(res.body.threads[0].handoff).toMatchObject({
      topic: "other",
      summary: null,
    });
  });

  it("is closed by 'handled', which sends nothing and lets the bot answer again", async () => {
    await handedOver();
    await inbound({ id: "wamid.IMPATIENT", text: "kak?" });

    const res = await request(app)
      .post(`/api/inbox/${PHONE}/handled`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.closed).toBe(2);

    expect(await db.outbox.count()).toBe(0);
    const rows = await db.waMessage.findMany({ where: { from: PHONE } });
    expect(rows.every((r) => r.status === "DIJAWAB_STAF")).toBe(true);
    const list = await get("");
    expect(list.body.threads[0]).toMatchObject({
      handoff: null,
      needsReply: false,
    });
  });

  it("refuses 'handled' for a number that was never a thread", async () => {
    const res = await request(app)
      .post("/api/inbox/628000000001/handled")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
