/**
 * Instagram in the API (2026-11-16): DM threads in /api/inbox under their own
 * channel and Instagram's window, the Comments tab's routes, and the owner's
 * settings and connection card. All as nusantara_app.
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
const IG = "ig:17841400000000444";
const WA = "628980092111";
const HOUR = 3_600_000;
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let human: Express;
let staffCookie: string;
let ownerCookie: string;

async function login(target: Express, username: string) {
  const res = await request(target)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD })
    .expect(200);
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeAll(async () => {
  owner = new PrismaClient({ datasourceUrl: URL });
  appDb = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
  const logger = createLogger({ app: "api", env: "test", destination: sink });
  app = createApp({
    db: appDb,
    config: loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" }),
    logger,
  });
  human = createApp({
    db: appDb,
    config: loadConfig({
      NODE_ENV: "test",
      SESSION_COOKIE_INSECURE: "1",
      IG_HUMAN_AGENT: "1",
    }),
    logger,
  });
});

afterAll(async () => {
  await truncateAll(owner);
  await appDb.$disconnect();
  await owner.$disconnect();
});

beforeEach(async () => {
  await truncateAll(owner);
  for (const [username, role] of [
    ["ig-staff", "STAFF"],
    ["ig-owner", "OWNER"],
  ] as const)
    await owner.staff.create({
      data: {
        username,
        name: username,
        role,
        passwordHash: await hashPassword(PASSWORD),
        active: true,
        canApprove: false,
        createdAt: new Date(),
      },
    });
  staffCookie = await login(app, "ig-staff");
  ownerCookie = await login(app, "ig-owner");
});

async function inbound(from: string, agoMs = 60_000, id = Math.random()) {
  return owner.waMessage.create({
    data: {
      waMessageId: `${from.startsWith("ig:") ? "ig:mid" : "wamid"}.${id}`,
      from,
      text: "halo kak",
      msgType: "text",
      ts: new Date(Date.now() - agoMs),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

describe("Instagram DMs in /api/inbox", () => {
  it("lists them under their own channel, and WhatsApp's list is unchanged", async () => {
    await inbound(WA);
    await inbound(IG);
    await owner.igContact.create({
      data: {
        igsid: "17841400000000444",
        username: "budi.mac",
        name: "Budi",
        fetchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const wa = await request(app)
      .get("/api/inbox")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(wa.body.threads.map((t: { phone: string }) => t.phone)).toEqual([
      WA,
    ]);
    expect(wa.body.threads[0].channel).toBe("WHATSAPP");
    const ig = await request(app)
      .get("/api/inbox?channel=instagram")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(ig.body.threads).toHaveLength(1);
    expect(ig.body.threads[0]).toMatchObject({
      phone: IG,
      channel: "INSTAGRAM",
      username: "budi.mac",
      humanAgentOnly: false,
    });
    expect(ig.body.threads[0].windowClosesAt).not.toBeNull();

    const one = await request(app)
      .get(`/api/inbox/${encodeURIComponent(IG)}`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(one.body).toMatchObject({
      channel: "INSTAGRAM",
      username: "budi.mac",
    });
  });

  it("queues a staff reply as IG_DM inside 24 hours", async () => {
    await inbound(IG);
    await request(app)
      .post(`/api/inbox/${encodeURIComponent(IG)}/reply`)
      .set("Cookie", staffCookie)
      .send({ text: "Ada kak" })
      .expect(201);
    const out = await owner.outbox.findFirstOrThrow();
    expect(out.kind).toBe("IG_DM");
    expect(out.payload).toMatchObject({ to: IG, body: "Ada kak" });
    expect((out.payload as { tag?: string }).tag).toBeUndefined();
  });

  it("refuses after 24 hours, unless the Human Agent feature is on — then tags it", async () => {
    await inbound(IG, 30 * HOUR);
    const refused = await request(app)
      .post(`/api/inbox/${encodeURIComponent(IG)}/reply`)
      .set("Cookie", staffCookie)
      .send({ text: "Maaf telat kak" })
      .expect(409);
    expect(refused.body.error.message).toContain("Instagram");
    expect(await owner.outbox.count()).toBe(0);

    const cookie = await login(human, "ig-staff");
    const list = await request(human)
      .get("/api/inbox?channel=instagram")
      .set("Cookie", cookie)
      .expect(200);
    expect(list.body.threads[0].humanAgentOnly).toBe(true);
    await request(human)
      .post(`/api/inbox/${encodeURIComponent(IG)}/reply`)
      .set("Cookie", cookie)
      .send({ text: "Maaf telat kak" })
      .expect(201);
    expect((await owner.outbox.findFirstOrThrow()).payload).toMatchObject({
      tag: "HUMAN_AGENT",
    });

    // Past seven days nobody may write.
    await owner.waMessage.updateMany({
      data: { ts: new Date(Date.now() - 8 * 24 * HOUR) },
    });
    await request(human)
      .post(`/api/inbox/${encodeURIComponent(IG)}/reply`)
      .set("Cookie", cookie)
      .send({ text: "x" })
      .expect(409);
  });

  it("shows a sent Instagram item that can be neither edited nor unsent", async () => {
    const m = await inbound(IG);
    await owner.outbox.create({
      data: {
        kind: "IG_DM",
        payload: { to: IG, body: "Ada kak", inReplyTo: m.id },
        status: "SENT",
        attempts: 1,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        sentAt: new Date(),
        providerMessageId: "mid.x",
      },
    });
    const one = await request(app)
      .get(`/api/inbox/${encodeURIComponent(IG)}`)
      .set("Cookie", staffCookie)
      .expect(200);
    expect(one.body.sent).toHaveLength(1);
    expect(one.body.sent[0]).toMatchObject({
      kind: "WA_REPLY",
      channel: "INSTAGRAM",
      body: "Ada kak",
      canEdit: false,
      canUnsend: false,
    });
  });

  it("lets the owner delete an Instagram conversation, confirmed by its @username", async () => {
    await inbound(IG);
    await owner.igContact.create({
      data: {
        igsid: "17841400000000444",
        username: "budi.mac",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const del = (confirm: string) =>
      request(app)
        .delete(`/api/inbox/${encodeURIComponent(IG)}`)
        .set("Cookie", ownerCookie)
        .send({ confirm });
    await del("6281234").expect(400);
    await del("@Budi.Mac").expect(200);
    expect(await owner.waMessage.count({ where: { from: IG } })).toBe(0);
  });

  it("refuses a malformed thread key", async () => {
    await request(app)
      .get("/api/inbox/ig%3Aabc")
      .set("Cookie", staffCookie)
      .expect(400);
  });

  it("counts NEW comments and Instagram threads in the waiting notice", async () => {
    await owner.waThreadMemory.create({
      data: {
        from: IG,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: new Date(),
        autoReply: false,
      },
    });
    await inbound(IG);
    const media = await owner.igMedia.create({
      data: { igMediaId: "m1", fetchedAt: new Date(0) },
    });
    await owner.igComment.create({
      data: {
        igCommentId: "c1",
        mediaId: media.id,
        fromId: "555",
        ts: new Date(),
        status: "NEW",
        repliedByAgent: false,
      },
    });
    const plain = await request(app)
      .get("/api/inbox/waiting")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(plain.body).toEqual({ count: 1, oldest: IG });
    const res = await request(app)
      .get("/api/inbox/waiting?instagram=1")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(res.body).toMatchObject({ count: 1, instagram: 1, comments: 1 });
  });
});

describe("/api/instagram/comments", () => {
  async function comment(
    over: { ts?: Date; status?: "NEW" | "DMED"; dmSentAt?: Date } = {},
  ) {
    const media = await owner.igMedia.upsert({
      where: { igMediaId: "m1" },
      create: {
        igMediaId: "m1",
        caption: "MacBook Air M2 mulus",
        permalink: "https://instagram.com/p/x",
        thumbnailUrl: "https://cdn/x.jpg",
        fetchedAt: new Date(),
      },
      update: {},
    });
    return owner.igComment.create({
      data: {
        igCommentId: `c.${Math.random()}`,
        mediaId: media.id,
        fromId: "555",
        fromUsername: "sari",
        text: "harga kak?",
        ts: over.ts ?? new Date(),
        status: over.status ?? "NEW",
        repliedByAgent: false,
        ...(over.dmSentAt ? { dmText: "x", dmSentAt: over.dmSentAt } : {}),
      },
    });
  }
  const post = (path: string, body: unknown, cookie = staffCookie) =>
    request(app)
      .post(`/api/instagram/comments${path}`)
      .set("Cookie", cookie)
      .send(body as object);

  it("lists newest first with the post, filters and searches", async () => {
    const older = await comment({ ts: new Date(Date.now() - HOUR) });
    const newer = await comment();
    const all = await request(app)
      .get("/api/instagram/comments")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(all.body.comments.map((c: { id: string }) => c.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(all.body.comments[0]).toMatchObject({
      username: "sari",
      status: "NEW",
      canPrivateReply: true,
      media: {
        caption: "MacBook Air M2 mulus",
        permalink: "https://instagram.com/p/x",
      },
    });
    expect(all.body.counts.NEW).toBe(2);
    const found = await request(app)
      .get("/api/instagram/comments?q=air%20m2")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(found.body.comments).toHaveLength(2);
    const none = await request(app)
      .get("/api/instagram/comments?status=DONE")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(none.body.comments).toHaveLength(0);
    const media = await request(app)
      .get("/api/instagram/media")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(media.body.media[0]).toMatchObject({ comments: 2 });
    await request(app)
      .get("/api/instagram/comments?status=NOPE")
      .set("Cookie", staffCookie)
      .expect(400);
  });

  it("replies publicly: the comment, an IG_REPLY and an audit line together", async () => {
    const c = await comment();
    const res = await post(`/${c.id}/reply`, { text: "Cek DM ya kak" }).expect(
      201,
    );
    expect(res.body).toMatchObject({
      status: "REPLIED",
      reply: { text: "Cek DM ya kak", by: "ig-staff", byAgent: false },
    });
    const out = await owner.outbox.findFirstOrThrow();
    expect(out.kind).toBe("IG_REPLY");
    expect(out.payload).toMatchObject({
      commentId: c.igCommentId,
      body: "Cek DM ya kak",
    });
    expect(
      await owner.auditLog.count({
        where: { entity: "IgComment", entityId: c.id },
      }),
    ).toBe(1);
    await post(`/${c.id}/reply`, { text: "" }).expect(400);
  });

  it("sends one private reply, within seven days", async () => {
    const c = await comment();
    const res = await post(`/${c.id}/private-reply`, {
      text: "Halo kak",
    }).expect(201);
    expect(res.body).toMatchObject({
      status: "DMED",
      canPrivateReply: false,
      dm: { text: "Halo kak" },
    });
    expect((await owner.outbox.findFirstOrThrow()).kind).toBe(
      "IG_PRIVATE_REPLY",
    );
    await post(`/${c.id}/private-reply`, { text: "lagi" }).expect(409);
    const old = await comment({ ts: new Date(Date.now() - 8 * 24 * HOUR) });
    const late = await post(`/${old.id}/private-reply`, {
      text: "Halo",
    }).expect(409);
    expect(late.body.error.message).toContain("7 hari");
  });

  it("hides and shows again, back to what was done to it", async () => {
    const c = await comment({ status: "DMED", dmSentAt: new Date() });
    expect(
      (await post(`/${c.id}/hide`, { hidden: true }).expect(200)).body.status,
    ).toBe("HIDDEN");
    await post(`/${c.id}/done`, {}).expect(409);
    expect(
      (await post(`/${c.id}/hide`, { hidden: false }).expect(200)).body.status,
    ).toBe("DMED");
    const kinds = (
      await owner.outbox.findMany({ orderBy: { createdAt: "asc" } })
    ).map((o) => [o.kind, (o.payload as { hidden: boolean }).hidden]);
    expect(kinds).toEqual([
      ["IG_HIDE", true],
      ["IG_HIDE", false],
    ]);
  });

  it("marks one done and reopens it", async () => {
    const c = await comment();
    expect((await post(`/${c.id}/done`, {}).expect(200)).body.status).toBe(
      "DONE",
    );
    expect(
      (await post(`/${c.id}/done`, { done: false }).expect(200)).body.status,
    ).toBe("NEW");
    await post(`/nope/done`, {}).expect(404);
  });

  it("is for signed-in staff only", async () => {
    await request(app).get("/api/instagram/comments").expect(401);
  });
});

describe("the owner's Instagram card", () => {
  it("reads the defaults, and only the owner may change them", async () => {
    const def = await request(app)
      .get("/api/instagram/settings")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(def.body).toMatchObject({
      autoReply: false,
      replyTemplate: "Cek DM ya kak 😊",
    });
    const body = {
      autoReply: true,
      replyTemplate: "Cek DM ya kak",
      dmTemplate: "Halo kak",
    };
    await request(app)
      .put("/api/instagram/settings")
      .set("Cookie", staffCookie)
      .send(body)
      .expect(403);
    await request(app)
      .put("/api/instagram/settings")
      .set("Cookie", ownerCookie)
      .send(body)
      .expect(200);
    expect(
      await owner.igSettings.findUniqueOrThrow({ where: { id: "singleton" } }),
    ).toMatchObject(body);
    await request(app)
      .put("/api/instagram/settings")
      .set("Cookie", ownerCookie)
      .send({ ...body, replyTemplate: "" })
      .expect(400);
    expect(
      await owner.auditLog.count({ where: { entity: "IgSettings" } }),
    ).toBe(1);
  });

  it("shows the connection the worker last saw, to the owner", async () => {
    await request(app)
      .get("/api/instagram/connection")
      .set("Cookie", staffCookie)
      .expect(403);
    const empty = await request(app)
      .get("/api/instagram/connection")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(empty.body).toMatchObject({
      connected: false,
      account: null,
      lastEventAt: null,
    });
    const exp = new Date(Date.now() + 50 * 24 * HOUR);
    await owner.igConnection.create({
      data: {
        id: "singleton",
        username: "macbooknusantara",
        checkedAt: new Date(),
        tokenExpiresAt: exp,
        updatedAt: new Date(),
      },
    });
    await owner.igRawEvent.create({
      data: { payload: {}, signatureOk: true, receivedAt: new Date() },
    });
    const res = await request(app)
      .get("/api/instagram/connection")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(res.body).toMatchObject({
      connected: true,
      account: {
        username: "macbooknusantara",
        tokenExpiresAt: exp.toISOString(),
      },
    });
    expect(res.body.lastEventAt).not.toBeNull();
  });
});
