/**
 * Unsend and edit from the inbox (owner ask 2026-10-23), against a real
 * database and a FAKE gateway — a real HTTP server on loopback answering as
 * apps/wa-gateway does — so every refusal is proved to happen BEFORE the
 * gateway is asked, and the happy paths to write the row, the reply text and
 * the audit line only after it said yes.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const PASSWORD = "rahasia-sekali";
const SECRET = "gateway-secret-for-inbox-tests";
const PHONE = "628980092978";
const OTHER = "628111000999";
const MIN = 60_000;
const sink = new Writable({ write: (_c, _e, cb) => cb() });
const logger = createLogger({ app: "api", env: "test", destination: sink });

/** What the fake gateway was asked, and what it answers next. */
const fake = {
  status: 200,
  seen: [] as Array<{ path: string; body: unknown }>,
};
let gateway: Server;
let gatewayUrl: string;

let db: PrismaClient;
let app: Express;
let cloudApp: Express;
let cookie: string;
let photoId: string;

function appWith(env: Record<string, string>): Express {
  return createApp({
    db,
    config: loadConfig({
      NODE_ENV: "test",
      SESSION_COOKIE_INSECURE: "1",
      ...env,
    }),
    logger,
  });
}

beforeAll(async () => {
  gateway = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      fake.seen.push({
        path: req.url ?? "",
        body: raw ? (JSON.parse(raw) as unknown) : null,
      });
      res.writeHead(
        req.headers["x-wa-gateway-secret"] === SECRET ? fake.status : 401,
        { "content-type": "application/json" },
      );
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  await truncateAll(db);
  const now = new Date();
  await db.staff.create({
    data: {
      id: "st_inbox_sent",
      username: "sent-test",
      name: "Sent Tester",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: now,
    },
  });
  // One unit with one uploaded QC photo, for the photo endpoint.
  await db.location.create({
    data: {
      id: "loc_s",
      code: "S1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_s",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: now,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "mdl_s",
      categoryId: "cat_s",
      name: "MacBook Air M2",
      archived: false,
      createdAt: now,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_s",
      modelId: "mdl_s",
      code: "SKU-S1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: now,
    },
  });
  await db.unit.create({
    data: {
      id: "u_s",
      serial: "SPHOTO1",
      skuId: "sku_s",
      status: "QC",
      locationId: "loc_s",
      buy: 12_000_000n,
      landed: 12_000_000n,
      grade: "A",
      intakeAt: now,
      version: 1,
    },
  });
  const note = await db.unitNote.create({
    data: {
      unitId: "u_s",
      serial: "SPHOTO1",
      body: "QC",
      staffId: "st_inbox_sent",
      at: now,
    },
  });
  photoId = (
    await db.unitNotePhoto.create({
      data: {
        noteId: note.id,
        url: "",
        sortOrder: 0,
        data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        contentType: "image/jpeg",
      },
    })
  ).id;

  app = appWith({ WA_GATEWAY_URL: gatewayUrl, WA_GATEWAY_SECRET: SECRET });
  cloudApp = appWith({});
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "sent-test", password: PASSWORD });
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
});

afterAll(async () => {
  await truncateAll(db);
  await db.$disconnect();
  await new Promise<void>((r) => gateway.close(() => r()));
});

let inboundId: string;

beforeEach(async () => {
  fake.status = 200;
  fake.seen = [];
  await db.outbox.deleteMany({});
  await db.auditLog.deleteMany({ where: { entity: "Outbox" } });
  await db.chatMemoryChunk.deleteMany({});
  await db.waMessage.deleteMany({});
  const m = await db.waMessage.create({
    data: {
      waMessageId: "wamid.IN1",
      from: PHONE,
      name: "Michella",
      text: "Air M2 berapa kak?",
      msgType: "text",
      ts: new Date(Date.now() - 5 * MIN),
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      replyText: "Rp 15.500.000 kak",
      answeredByAgent: true,
      answeredAt: new Date(Date.now() - 4 * MIN),
    },
  });
  inboundId = m.id;
});

/** A sent row, as the worker leaves one after this release. */
async function sent(
  over: {
    kind?: "WA_REPLY" | "WA_IMAGE";
    to?: string;
    body?: string;
    status?: "SENT" | "PENDING" | "FAILED";
    sentAgoMs?: number;
    providerMessageId?: string | null;
    retracted?: boolean;
  } = {},
) {
  const kind = over.kind ?? "WA_REPLY";
  const sentAt = new Date(Date.now() - (over.sentAgoMs ?? 2 * MIN));
  const row = await db.outbox.create({
    data: {
      kind,
      payload:
        kind === "WA_REPLY"
          ? {
              to: over.to ?? PHONE,
              body: over.body ?? "Rp 15.500.000 kak",
              inReplyTo: inboundId,
            }
          : { to: over.to ?? PHONE, photoId, inReplyTo: inboundId },
      status: over.status ?? "SENT",
      attempts: 1,
      nextAttemptAt: sentAt,
      createdAt: sentAt,
      sentAt: (over.status ?? "SENT") === "SENT" ? sentAt : null,
      providerMessageId:
        over.providerMessageId === undefined
          ? "3EB0ABCDEF"
          : over.providerMessageId,
      retractedAt: over.retracted ? new Date() : null,
    },
  });
  return row.id;
}

const unsend = (id: string, a: Express = app, phone = PHONE) =>
  request(a)
    .post(`/api/inbox/${phone}/sent/${id}/unsend`)
    .set("Cookie", cookie);
const edit = (id: string, text: string, a: Express = app) =>
  request(a)
    .post(`/api/inbox/${PHONE}/sent/${id}/edit`)
    .set("Cookie", cookie)
    .send({ text });

describe("the conversation carries what was sent", () => {
  it("lists texts and photos with what can still be done, and ties the reply to its row", async () => {
    const reply = await sent({});
    const photo = await sent({ kind: "WA_IMAGE", sentAgoMs: MIN });
    await sent({ to: OTHER, body: "someone else's" });
    const res = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    const items = res.body.sent as Array<Record<string, unknown>>;
    expect(items.map((s) => s["id"])).toEqual([reply, photo]);
    expect(items[0]).toMatchObject({
      kind: "WA_REPLY",
      body: "Rp 15.500.000 kak",
      canEdit: true,
      canUnsend: true,
      retractedAt: null,
    });
    expect(items[1]).toMatchObject({
      kind: "WA_IMAGE",
      photoId,
      canEdit: false,
      canUnsend: true,
    });
    expect(res.body.messages[0].reply.outboxId).toBe(reply);
  });

  it("offers neither on the Cloud API", async () => {
    await sent({});
    const res = await request(cloudApp)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.sent[0]).toMatchObject({
      canEdit: false,
      canUnsend: false,
    });
  });

  it("serves a sent photo's bytes, and 404s one that is gone or another phone's", async () => {
    const photo = await sent({ kind: "WA_IMAGE" });
    const res = await request(app)
      .get(`/api/inbox/${PHONE}/sent/${photo}/photo`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect([...(res.body as Buffer)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    await request(app)
      .get(`/api/inbox/${OTHER}/sent/${photo}/photo`)
      .set("Cookie", cookie)
      .expect(404);
    const gone = await db.outbox.create({
      data: {
        kind: "WA_IMAGE",
        payload: { to: PHONE, photoId: "purged-at-sale" },
        status: "SENT",
        attempts: 1,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        sentAt: new Date(),
      },
    });
    await request(app)
      .get(`/api/inbox/${PHONE}/sent/${gone.id}/photo`)
      .set("Cookie", cookie)
      .expect(404);
  });
});

describe("unsend", () => {
  it("needs a session", async () => {
    const id = await sent({});
    await request(app)
      .post(`/api/inbox/${PHONE}/sent/${id}/unsend`)
      .expect(401);
  });

  it("deletes for everyone, then stamps the row and writes who", async () => {
    const id = await sent({});
    const res = await unsend(id).expect(200);
    expect(res.body).toMatchObject({
      id,
      canUnsend: false,
      canEdit: false,
      // Who, from the audit row (2026-10-27).
      retractedBy: "Sent Tester",
      editedBy: null,
    });
    expect(res.body.retractedAt).not.toBeNull();
    expect(fake.seen).toEqual([
      { path: "/messages/revoke", body: { to: PHONE, id: "3EB0ABCDEF" } },
    ]);
    const row = await db.outbox.findUniqueOrThrow({ where: { id } });
    expect(row.retractedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entity: "Outbox", entityId: id },
    });
    expect(audit).toMatchObject({
      action: "DELETE",
      staffId: "st_inbox_sent",
    });
    expect(JSON.parse(audit.before!)).toEqual({
      to: PHONE,
      text: "Rp 15.500.000 kak",
    });
  });

  it("unsends a photo too", async () => {
    const id = await sent({ kind: "WA_IMAGE" });
    await unsend(id).expect(200);
  });

  const refusals: Array<[string, Parameters<typeof sent>[0], RegExp]> = [
    ["not sent yet", { status: "PENDING" }, /belum terkirim/],
    ["sent before this release", { providerMessageId: null }, /sebelum fitur/],
    ["a Cloud API id", { providerMessageId: "wamid.HBgM" }, /sebelum fitur/],
    ["already unsent", { retracted: true }, /sudah ditarik/],
    ["past 48 hours", { sentAgoMs: 49 * 60 * MIN }, /48 jam/],
  ];
  for (const [what, over, message] of refusals) {
    it(`refuses ${what}, without asking the gateway`, async () => {
      const id = await sent(over);
      const res = await unsend(id).expect(409);
      expect(res.body.error.message).toMatch(message);
      expect(fake.seen).toEqual([]);
      expect(await db.auditLog.count({ where: { entity: "Outbox" } })).toBe(0);
    });
  }

  it("refuses another phone's row as not found", async () => {
    const id = await sent({ to: OTHER });
    await unsend(id).expect(404);
    expect(fake.seen).toEqual([]);
  });

  it("refuses on the Cloud API with 409", async () => {
    const id = await sent({});
    const res = await unsend(id, cloudApp).expect(409);
    expect(res.body.error.message).toMatch(/Cloud API/);
  });

  it("writes nothing when the gateway says no", async () => {
    fake.status = 503;
    const id = await sent({});
    await unsend(id).expect(503);
    const row = await db.outbox.findUniqueOrThrow({ where: { id } });
    expect(row.retractedAt).toBeNull();
    expect(await db.auditLog.count({ where: { entity: "Outbox" } })).toBe(0);
  });
});

describe("edit", () => {
  it("corrects the text, the reply bubble and the log", async () => {
    const id = await sent({});
    const res = await edit(id, "Rp 14.500.000 kak, maaf").expect(200);
    expect(res.body).toMatchObject({
      id,
      body: "Rp 14.500.000 kak, maaf",
      editedBy: "Sent Tester",
      retractedBy: null,
    });
    expect(res.body.editedAt).not.toBeNull();
    expect(fake.seen).toEqual([
      {
        path: "/messages/edit",
        body: { to: PHONE, id: "3EB0ABCDEF", text: "Rp 14.500.000 kak, maaf" },
      },
    ]);
    const msg = await db.waMessage.findUniqueOrThrow({
      where: { id: inboundId },
    });
    expect(msg.replyText).toBe("Rp 14.500.000 kak, maaf");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entity: "Outbox", entityId: id },
    });
    expect(audit).toMatchObject({
      action: "UPDATE",
      field: "text",
      staffId: "st_inbox_sent",
    });
    expect(JSON.parse(audit.before!)).toEqual({ text: "Rp 15.500.000 kak" });
    expect(JSON.parse(audit.after!)).toEqual({
      text: "Rp 14.500.000 kak, maaf",
    });
    // Still tied to its bubble afterwards, and still says who.
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(conv.body.messages[0].reply.outboxId).toBe(id);
    expect(conv.body.sent[0]).toMatchObject({
      editedBy: "Sent Tester",
      retractedBy: null,
    });
  });

  it("names nobody for an edit or unsend the log never saw", async () => {
    const id = await sent({ retracted: true });
    await db.outbox.update({ where: { id }, data: { editedAt: new Date() } });
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(conv.body.sent[0]).toMatchObject({
      id,
      editedBy: null,
      retractedBy: null,
    });
    expect(conv.body.sent[0].retractedAt).not.toBeNull();
  });

  it("leaves a reply text that has since been overwritten alone", async () => {
    const id = await sent({ body: "an older bot line" });
    await edit(id, "corrected").expect(200);
    const msg = await db.waMessage.findUniqueOrThrow({
      where: { id: inboundId },
    });
    expect(msg.replyText).toBe("Rp 15.500.000 kak");
  });

  it("refuses a photo, a late edit, an empty or unchanged text", async () => {
    const photo = await sent({ kind: "WA_IMAGE" });
    expect((await edit(photo, "x").expect(409)).body.error.message).toMatch(
      /teks/,
    );
    const late = await sent({ sentAgoMs: 16 * MIN });
    expect((await edit(late, "x").expect(409)).body.error.message).toMatch(
      /15 menit/,
    );
    const ok = await sent({});
    await edit(ok, "   ").expect(400);
    await edit(ok, "Rp 15.500.000 kak").expect(400);
    expect(fake.seen).toEqual([]);
  });

  it("refuses an unsent message and the Cloud API", async () => {
    const gone = await sent({ retracted: true });
    await edit(gone, "x").expect(409);
    const id = await sent({});
    await edit(id, "x", cloudApp).expect(409);
    expect(fake.seen).toEqual([]);
  });
});
