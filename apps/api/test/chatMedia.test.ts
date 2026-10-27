/**
 * A picture from staff's own device, sent in a /chat conversation (owner ask
 * 2026-10-27), against a real database with the API logged in as
 * `nusantara_app` — the role production gives it — so the INSERT and SELECT
 * on `ChatMedia` and the conversation delete that removes it are proved here
 * rather than on the shop's Mac mini. A fake gateway answers the unsend.
 * Fixtures and assertions go through the schema owner.
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
import { PICTURE_MAX_BYTES, decodePicture } from "../src/routes/inboxSent.js";

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
const SECRET = "gateway-secret-for-picture-tests";
const PHONE = "628980096001";
const OTHER = "628980096002";
const MIN = 60_000;
const sink = new Writable({ write: (_c, _e, cb) => cb() });

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);
const dataUrl = (type: string, b: Buffer) =>
  `data:${type};base64,${b.toString("base64")}`;

const fake = { seen: [] as Array<{ path: string; body: unknown }> };
let gateway: Server;
let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let staffCookie: string;
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
      res.writeHead(req.headers["x-wa-gateway-secret"] === SECRET ? 200 : 401, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
  const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

  owner = new PrismaClient({ datasourceUrl: URL });
  appDb = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
  await owner.$connect();
  await appDb.$connect();
  await truncateAll(owner);
  app = createApp({
    db: appDb,
    config: loadConfig({
      NODE_ENV: "test",
      SESSION_COOKIE_INSECURE: "1",
      WA_GATEWAY_URL: gatewayUrl,
      WA_GATEWAY_SECRET: SECRET,
    }),
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
  staffCookie = await login("pic-staff", "Rina", "STAFF");
  ownerCookie = await login("pic-owner", "Ersen", "OWNER");
});

afterAll(async () => {
  await truncateAll(owner);
  await appDb.$disconnect();
  await owner.$disconnect();
  await new Promise<void>((r) => gateway.close(() => r()));
});

beforeEach(async () => {
  fake.seen = [];
  await owner.outbox.deleteMany({});
  await owner.chatMedia.deleteMany({});
  await owner.waThreadMemory.deleteMany({});
  await owner.waMessage.deleteMany({});
  await owner.auditLog.deleteMany({
    where: { entity: { in: ["Outbox", "WaThread"] } },
  });
});

let seq = 0;
async function inbound(from = PHONE, agoMs = 10 * MIN) {
  seq += 1;
  return owner.waMessage.create({
    data: {
      waMessageId: `wamid.PIC.${seq}`,
      from,
      name: "Ayu",
      text: "ada fotonya kak?",
      msgType: "text",
      ts: new Date(Date.now() - agoMs),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

const send = (body: Record<string, unknown>, phone = PHONE) =>
  request(app)
    .post(`/api/inbox/${phone}/picture`)
    .set("Cookie", staffCookie)
    .send(body);

async function nothingWritten() {
  expect(await owner.chatMedia.count()).toBe(0);
  expect(await owner.outbox.count()).toBe(0);
  expect(await owner.auditLog.count({ where: { entity: "Outbox" } })).toBe(0);
}

describe("sending a picture from this device", () => {
  it("stores it, queues it and says who, in one go", async () => {
    const m = await inbound();
    const res = await send({
      image: dataUrl("image/png", PNG),
      caption: "  Ini fotonya kak  ",
    }).expect(201);
    expect(res.body).toMatchObject({
      kind: "WA_IMAGE",
      status: "PENDING",
      caption: "Ini fotonya kak",
      sentBy: "Rina",
      canEdit: false,
      canUnsend: false,
    });

    const media = await owner.chatMedia.findFirstOrThrow({});
    expect(media).toMatchObject({
      id: res.body.chatMediaId,
      from: PHONE,
      contentType: "image/png",
      size: PNG.length,
      uploadedById: ids["pic-staff"],
    });
    expect(Buffer.from(media.data)).toEqual(PNG);

    const row = await owner.outbox.findFirstOrThrow({});
    expect(row.id).toBe(res.body.id);
    expect(row.kind).toBe("WA_IMAGE");
    expect(row.payload).toEqual({
      to: PHONE,
      chatMediaId: media.id,
      caption: "Ini fotonya kak",
      inReplyTo: m.id,
    });

    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "Outbox", entityId: row.id },
    });
    expect(audit).toMatchObject({
      action: "CREATE",
      staffId: ids["pic-staff"],
    });
    expect(JSON.parse(audit.after!)).toEqual({
      to: PHONE,
      picture: media.id,
      contentType: "image/png",
      size: PNG.length,
      caption: "Ini fotonya kak",
    });
  });

  it("takes JPG and WebP too, and no caption at all", async () => {
    await inbound();
    await send({ image: dataUrl("image/jpeg", JPEG) }).expect(201);
    await send({ image: dataUrl("image/webp", WEBP) }).expect(201);
    const rows = await owner.outbox.findMany({ orderBy: { createdAt: "asc" } });
    expect(
      rows.map((r) => (r.payload as { caption?: string }).caption),
    ).toEqual([undefined, undefined]);
    expect(
      (await owner.chatMedia.findMany({ orderBy: { createdAt: "asc" } })).map(
        (x) => x.contentType,
      ),
    ).toEqual(["image/jpeg", "image/webp"]);
  });

  it("shows in the conversation, and serves its bytes to that thread only", async () => {
    await inbound();
    const { body } = await send({ image: dataUrl("image/png", PNG) });
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(conv.body.sent).toEqual([
      expect.objectContaining({
        id: body.id,
        kind: "WA_IMAGE",
        chatMediaId: body.chatMediaId,
        sentBy: "Rina",
      }),
    ]);
    const photo = await request(app)
      .get(`/api/inbox/${PHONE}/sent/${body.id}/photo`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(photo.body as Buffer)).toEqual(PNG);
    await request(app)
      .get(`/api/inbox/${OTHER}/sent/${body.id}/photo`)
      .set("Cookie", ownerCookie)
      .expect(404);
  });

  it("refuses what is not a JPG, PNG or WebP — by type and by its bytes", async () => {
    await inbound();
    const gif = await send({
      image: dataUrl("image/gif", Buffer.from("GIF89a")),
    }).expect(415);
    expect(gif.body.error.message).toMatch(/JPG, PNG atau WebP/);
    // A JPEG renamed .png is not what it claims.
    await send({ image: dataUrl("image/png", JPEG) }).expect(415);
    await send({ image: "not a data url" }).expect(415);
    await send({}).expect(400);
    await nothingWritten();
  });

  it("refuses a picture over 5 MB", async () => {
    await inbound();
    const big = Buffer.concat([PNG, Buffer.alloc(PICTURE_MAX_BYTES)]);
    const res = await send({ image: dataUrl("image/png", big) }).expect(413);
    expect(res.body.error.message).toMatch(/5 MB/);
    // Past the body limit itself: the parser's refusal, in the same words.
    const huge = Buffer.concat([PNG, Buffer.alloc(7 * 1024 * 1024)]);
    const res2 = await send({ image: dataUrl("image/png", huge) }).expect(413);
    expect(res2.body.error.message).toMatch(/5 MB/);
    await nothingWritten();
  });

  it("refuses up front once the 24-hour window has closed", async () => {
    await inbound(PHONE, 25 * 60 * MIN);
    const res = await send({ image: dataUrl("image/png", PNG) }).expect(409);
    expect(res.body.error.message).toMatch(/24 jam/);
    await nothingWritten();
  });

  it("404s a number that never wrote", async () => {
    await send({ image: dataUrl("image/png", PNG) }).expect(404);
    await nothingWritten();
  });
});

describe("taking a picture back", () => {
  it("unsends it through the linked device, and logs which picture", async () => {
    await inbound();
    const { body } = await send({ image: dataUrl("image/png", PNG) });
    // The worker sent it.
    await owner.outbox.update({
      where: { id: body.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: "3EB0PIC",
      },
    });
    const conv = await request(app)
      .get(`/api/inbox/${PHONE}`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(conv.body.sent[0]).toMatchObject({
      canUnsend: true,
      canEdit: false,
    });
    await request(app)
      .post(`/api/inbox/${PHONE}/sent/${body.id}/edit`)
      .set("Cookie", staffCookie)
      .send({ text: "x" })
      .expect(409);

    const res = await request(app)
      .post(`/api/inbox/${PHONE}/sent/${body.id}/unsend`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(res.body).toMatchObject({ retractedBy: "Rina", sentBy: "Rina" });
    expect(fake.seen).toEqual([
      { path: "/messages/revoke", body: { to: PHONE, id: "3EB0PIC" } },
    ]);
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "Outbox", entityId: body.id, action: "DELETE" },
    });
    expect(JSON.parse(audit.before!)).toEqual({
      to: PHONE,
      picture: body.chatMediaId,
      caption: null,
    });
    // Unsent, not deleted: the row and the picture stay.
    expect(await owner.chatMedia.count()).toBe(1);
  });

  it("is removed with the conversation", async () => {
    await inbound();
    await inbound(OTHER);
    await send({ image: dataUrl("image/png", PNG) }).expect(201);
    await send({ image: dataUrl("image/png", PNG) }, OTHER).expect(201);
    await request(app)
      .delete(`/api/inbox/${PHONE}`)
      .set("Cookie", ownerCookie)
      .send({ confirm: PHONE })
      .expect(200);
    expect(
      (await owner.chatMedia.findMany({ select: { from: true } })).map(
        (m) => m.from,
      ),
    ).toEqual([OTHER]);
  });
});

describe("decodePicture", () => {
  it("reads image/jpg as JPEG", () => {
    const r = decodePicture(dataUrl("image/jpg", JPEG));
    expect(r).toMatchObject({ ok: true, contentType: "image/jpeg" });
  });
});
