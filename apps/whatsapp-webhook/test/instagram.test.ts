/**
 * Instagram deliveries (2026-11-16): DMs onto the chat tables under
 * `ig:<IGSID>`, comments with their post's stub and the owner's auto-reply,
 * the second signing key, and the picture route Instagram fetches from.
 */
import { Writable } from "node:stream";
import { createHmac, randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { extractIgComments, extractIgMessages } from "../src/instagram.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const APP_SECRET = "test-app-secret";
const IG_SECRET = "test-ig-app-secret";
const OWN = "17841400000000999";

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});
const logger = createLogger({
  app: "whatsapp-webhook",
  env: "test",
  level: "fatal",
  destination: sink,
});

let db: PrismaClient;
let app: Express;
const run = randomUUID().slice(0, 8);
/** Senders and comment ids unique to this run. */
const igsid = (n: number) => `9${String(Date.now()).slice(-9)}${n}`;

function dm(sender: string, mid: string, message: Record<string, unknown>) {
  return {
    object: "instagram",
    entry: [
      {
        id: OWN,
        time: 1763280000,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: OWN },
            timestamp: 1763280000123,
            message: { mid, ...message },
          },
        ],
      },
    ],
  };
}

function comment(
  id: string,
  from: string,
  mediaId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    object: "instagram",
    entry: [
      {
        id: OWN,
        time: 1763280000,
        changes: [
          {
            field: "comments",
            value: {
              comment_id: id,
              text: "harga kak?",
              from: { id: from, username: "budi.mac" },
              media: { id: mediaId, media_product_type: "FEED" },
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

async function post(payload: unknown, secret: string = APP_SECRET) {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set(
      "X-Hub-Signature-256",
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    )
    .send(body);
}

async function waitFor<T>(check: () => Promise<T>, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    config: loadConfig({
      APP_SECRET,
      VERIFY_TOKEN: "v",
      IG_APP_SECRET: IG_SECRET,
    }),
    db,
    logger,
  });
});

afterAll(async () => {
  await db.waMessage.deleteMany({
    where: { waMessageId: { startsWith: `ig:mid.${run}` } },
  });
  const media = await db.igMedia.findMany({
    where: { igMediaId: { startsWith: `media.${run}` } },
    select: { id: true },
  });
  await db.igComment.deleteMany({
    where: { mediaId: { in: media.map((m) => m.id) } },
  });
  await db.igMedia.deleteMany({
    where: { id: { in: media.map((m) => m.id) } },
  });
  await db.outbox.deleteMany({
    where: { payload: { path: ["commentId"], string_starts_with: `c.${run}` } },
  });
  await db.outbox.deleteMany({
    where: { payload: { path: ["test"], equals: run } },
  });
  await db.igSettings.deleteMany({ where: { id: "singleton" } });
  await db.staff.deleteMany({ where: { username: `igtest-${run}` } });
  await db.$disconnect();
});

describe("extractIgMessages", () => {
  it("reads a customer's text under the ig: thread key, in milliseconds", () => {
    const [m] = extractIgMessages(dm("1234567", "mid.a", { text: "halo kak" }));
    expect(m).toEqual({
      waMessageId: "ig:mid.a",
      from: "ig:1234567",
      text: "halo kak",
      msgType: "text",
      ts: new Date(1763280000123),
    });
  });

  it("skips an echo, a deleted message, our own account and a bad sender", () => {
    expect(
      extractIgMessages(dm("1234567", "mid.b", { text: "x", is_echo: true })),
    ).toEqual([]);
    expect(
      extractIgMessages(dm("1234567", "mid.c", { is_deleted: true })),
    ).toEqual([]);
    expect(extractIgMessages(dm(OWN, "mid.d", { text: "x" }))).toEqual([]);
    expect(extractIgMessages(dm("abc", "mid.e", { text: "x" }))).toEqual([]);
    expect(
      extractIgMessages({ object: "whatsapp_business_account", entry: [] }),
    ).toEqual([]);
  });

  it("names a picture, an unsupported message and a tapped button", () => {
    const pic = extractIgMessages(
      dm("1234567", "mid.f", {
        attachments: [{ type: "image", payload: { url: "https://cdn/x" } }],
      }),
    )[0]!;
    expect(pic.msgType).toBe("image");
    expect(pic.text).toBeNull();
    expect(
      extractIgMessages(dm("1234567", "mid.g", { is_unsupported: true }))[0]!
        .msgType,
    ).toBe("unsupported");
    expect(extractIgMessages(dm("1234567", "mid.h", {}))[0]!.msgType).toBe(
      "unknown",
    );
    const postback = extractIgMessages({
      object: "instagram",
      entry: [
        {
          id: OWN,
          messaging: [
            {
              sender: { id: "1234567" },
              postback: { mid: "mid.p", title: "Lihat stok", payload: "x" },
            },
            { sender: { id: "1234567" }, read: { mid: "x" } } as never,
          ],
        },
      ],
    });
    expect(postback).toHaveLength(1);
    expect(postback[0]!.text).toBe("Lihat stok");
  });
});

describe("extractIgComments", () => {
  it("reads both documented shapes, and never our own reply", () => {
    const inChanges = extractIgComments(comment("c1", "555", "m1"));
    expect(inChanges).toEqual([
      {
        igCommentId: "c1",
        igMediaId: "m1",
        fromId: "555",
        fromUsername: "budi.mac",
        text: "harga kak?",
        parentId: null,
        ts: new Date(1763280000 * 1000),
      },
    ]);
    const onEntry = extractIgComments({
      object: "instagram",
      entry: [
        {
          id: OWN,
          field: "comments",
          value: {
            id: "c2",
            text: "mau",
            from: { id: "556" },
            media: { id: "m1" },
            parent_id: "c1",
          },
        },
      ],
    });
    expect(onEntry[0]).toMatchObject({
      igCommentId: "c2",
      parentId: "c1",
      fromUsername: null,
    });
    expect(extractIgComments(comment("c3", OWN, "m1"))).toEqual([]);
    expect(
      extractIgComments(comment("c4", "555", "m1", { media: undefined })),
    ).toEqual([]);
    expect(extractIgComments({ object: "page", entry: [] })).toEqual([]);
  });
});

describe("POST /webhook — Instagram", () => {
  it("stores a DM as a BARU row on the ig: thread, once", async () => {
    const sender = igsid(1);
    const mid = `mid.${run}.1`;
    const res = await post(dm(sender, mid, { text: "Air M2 ada kak?" }));
    expect(res.status).toBe(200);
    const row = await waitFor(() =>
      db.waMessage.findUnique({ where: { waMessageId: `ig:${mid}` } }),
    );
    expect(row).toMatchObject({
      from: `ig:${sender}`,
      text: "Air M2 ada kak?",
      status: "BARU",
      direction: "IN",
    });
    await post(dm(sender, mid, { text: "Air M2 ada kak?" }));
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await db.waMessage.count({ where: { waMessageId: `ig:${mid}` } }),
    ).toBe(1);
  });

  it("accepts an Instagram body signed with the Instagram app secret", async () => {
    const sender = igsid(2);
    const mid = `mid.${run}.2`;
    expect((await post(dm(sender, mid, { text: "p" }), IG_SECRET)).status).toBe(
      200,
    );
    expect(
      await waitFor(() =>
        db.waMessage.findUnique({ where: { waMessageId: `ig:${mid}` } }),
      ),
    ).not.toBeNull();
  });

  it("never lets the Instagram secret sign a WhatsApp event", async () => {
    const res = await post(
      { object: "whatsapp_business_account", entry: [] },
      IG_SECRET,
    );
    expect(res.status).toBe(401);
  });

  it("stores a comment with a stub of its post, and no reply while auto-reply is off", async () => {
    const id = `c.${run}.1`;
    await post(comment(id, "555001", `media.${run}.1`));
    const row = await waitFor(() =>
      db.igComment.findUnique({
        where: { igCommentId: id },
        include: { media: true },
      }),
    );
    expect(row?.status).toBe("NEW");
    expect(row?.repliedByAgent).toBe(false);
    expect(row?.media.permalink).toBeNull();
    expect(row?.media.fetchedAt.getTime()).toBe(0);
    expect(
      await db.outbox.count({
        where: { payload: { path: ["commentId"], equals: id } },
      }),
    ).toBe(0);
  });

  it("answers a first top-level comment with both templates when the owner switched it on", async () => {
    await db.igSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        autoReply: true,
        replyTemplate: "Cek DM ya kak 😊",
        dmTemplate: "Halo kak, ada yang bisa dibantu?",
        updatedAt: new Date(),
      },
      // Every field: a seed may have left a row with other templates.
      update: {
        autoReply: true,
        replyTemplate: "Cek DM ya kak 😊",
        dmTemplate: "Halo kak, ada yang bisa dibantu?",
      },
    });
    const first = `c.${run}.2`;
    await post(comment(first, "555002", `media.${run}.2`));
    const row = await waitFor(() =>
      db.igComment.findUnique({ where: { igCommentId: first } }),
    );
    expect(row).toMatchObject({
      status: "DMED",
      repliedByAgent: true,
      replyText: "Cek DM ya kak 😊",
      dmText: "Halo kak, ada yang bisa dibantu?",
    });
    const sent = await db.outbox.findMany({
      where: { payload: { path: ["commentId"], equals: first } },
      orderBy: { createdAt: "asc" },
    });
    expect(sent.map((s) => s.kind).sort()).toEqual([
      "IG_PRIVATE_REPLY",
      "IG_REPLY",
    ]);

    // The same person again on the same post, and a reply-to-a-reply: no.
    const second = `c.${run}.3`;
    await post(comment(second, "555002", `media.${run}.2`));
    const reply = `c.${run}.4`;
    await post(
      comment(reply, "555003", `media.${run}.2`, { parent_id: first }),
    );
    for (const id of [second, reply]) {
      const r = await waitFor(() =>
        db.igComment.findUnique({ where: { igCommentId: id } }),
      );
      expect(r?.status).toBe("NEW");
    }
  });
});

describe("GET /webhook/media — the picture Instagram fetches", () => {
  async function imageRow(over: Record<string, unknown> = {}) {
    const staff = await db.staff.upsert({
      where: { username: `igtest-${run}` },
      create: {
        username: `igtest-${run}`,
        name: "IG test",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "x",
        createdAt: new Date(),
      },
      update: {},
      select: { id: true },
    });
    const media = await db.chatMedia.create({
      data: {
        from: "ig:1234567",
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: "image/png",
        size: 8,
        uploadedById: staff!.id,
      },
    });
    const token = "t".repeat(43);
    const row = await db.outbox.create({
      data: {
        kind: "IG_IMAGE",
        payload: {
          to: "ig:1234567",
          chatMediaId: media.id,
          mediaToken: token,
          test: run,
          ...over,
        },
        status: "SENDING",
        attempts: 1,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      },
    });
    return { row, token, media };
  }

  it("serves the bytes for the right token, and 404 for anything else", async () => {
    const { row, token, media } = await imageRow();
    const ok = await request(app).get(`/webhook/media/${row.id}/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");
    expect(
      (await request(app).get(`/webhook/media/${row.id}/${"x".repeat(43)}`))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get(`/webhook/media/${row.id}/short`)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/webhook/media/nope/${token}`)).status,
    ).toBe(404);
    await db.outbox.update({
      where: { id: row.id },
      data: { retractedAt: new Date() },
    });
    expect(
      (await request(app).get(`/webhook/media/${row.id}/${token}`)).status,
    ).toBe(404);
    // Another thread's picture is never served.
    const { row: other, token: t2 } = await imageRow({ to: "ig:7654321" });
    expect(
      (await request(app).get(`/webhook/media/${other.id}/${t2}`)).status,
    ).toBe(404);
    await db.outbox.deleteMany({
      where: { payload: { path: ["test"], equals: run } },
    });
    await db.chatMedia.deleteMany({ where: { from: "ig:1234567" } });
    await db.chatMedia.deleteMany({ where: { id: media.id } });
  });
});
