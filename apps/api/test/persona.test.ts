/**
 * The endpoints that give the shop's voice one home.
 *
 * Personas and corrections lived in the browser until now, and the consequence
 * was concrete: a staff member editing the voice on the Chat page changed what
 * THEY drafted and did not change one word of what the bot said unattended,
 * because the worker has no browser. These endpoints are what make the two the
 * same thing.
 *
 * The claim worth the most here is the activation ordering. A partial unique
 * index permits exactly one active persona, so activating before deactivating
 * trips the constraint — which is the good outcome, because the alternative is
 * a shop with two live voices and no way to say which one customers get.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "persona-test-password";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let cookie: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();

  await db.staff.upsert({
    where: { username: "persona-test" },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      username: "persona-test",
      name: "Persona Tester",
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
    .send({ username: "persona-test", password: PASSWORD });
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.agentCorrection.deleteMany({});
  await db.persona.deleteMany({});
});

const get = (path: string) =>
  request(app).get(`/api/chat${path}`).set("Cookie", cookie);
const post = (path: string, body: object) =>
  request(app).post(`/api/chat${path}`).set("Cookie", cookie).send(body);
const put = (path: string, body: object) =>
  request(app).put(`/api/chat${path}`).set("Cookie", cookie).send(body);

const VOICE = { name: "Ramah", blurb: "Santai", prompt: "Ngobrol santai ya." };

describe("personas", () => {
  it("starts empty, because the migration seeds no placeholder voice", async () => {
    // A placeholder row would have become the shop's actual voice the first
    // time the worker read it.
    const res = await get("/personas");
    expect(res.status).toBe(200);
    expect(res.body.personas).toEqual([]);
  });

  it("creates a persona switched off, so saving one cannot change what customers hear", async () => {
    const res = await post("/personas", VOICE);
    expect(res.status).toBe(201);
    expect(res.body.persona.active).toBe(false);
  });

  it("records who wrote it", async () => {
    await post("/personas", VOICE);
    const row = await db.persona.findFirstOrThrow({
      select: { createdBy: { select: { username: true } } },
    });
    expect(row.createdBy?.username).toBe("persona-test");
  });

  it("makes one live, and only one", async () => {
    const a = (await post("/personas", VOICE)).body.persona.id;
    const b = (await post("/personas", { ...VOICE, name: "Formal" })).body.persona.id;

    expect((await post(`/personas/${a}/activate`, {})).status).toBe(200);
    expect((await post(`/personas/${b}/activate`, {})).status).toBe(200);

    const active = await db.persona.findMany({ where: { active: true } });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(b);
  });

  it("switching voices twice in a row does not trip the one-active constraint", async () => {
    // The order inside the transaction is what makes this work: deactivate,
    // then activate. The reverse would violate the partial unique index.
    const a = (await post("/personas", VOICE)).body.persona.id;
    for (let i = 0; i < 3; i += 1) {
      expect((await post(`/personas/${a}/activate`, {})).status).toBe(200);
    }
    expect(await db.persona.count({ where: { active: true } })).toBe(1);
  });

  it("edits a persona without changing which one is live", async () => {
    const a = (await post("/personas", VOICE)).body.persona.id;
    await post(`/personas/${a}/activate`, {});

    const res = await put(`/personas/${a}`, { ...VOICE, prompt: "Lebih singkat." });

    expect(res.status).toBe(200);
    const row = await db.persona.findUniqueOrThrow({ where: { id: a } });
    expect(row.prompt).toBe("Lebih singkat.");
    expect(row.active).toBe(true);
  });

  it("refuses to edit a built-in, so the default voice always survives", async () => {
    // `builtIn` was selected by the handler and never tested, which made the
    // column decorative: the shop's default voice could be overwritten by
    // anyone signed in, and there is no compiled-in copy to fall back to.
    const builtIn = await db.persona.create({
      data: {
        name: "Bawaan",
        prompt: "Suara bawaan toko.",
        active: false,
        builtIn: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true },
    });

    const res = await put(`/personas/${builtIn.id}`, {
      ...VOICE,
      prompt: "Diubah diam-diam.",
    });

    expect(res.status).toBe(409);
    const row = await db.persona.findUniqueOrThrow({
      where: { id: builtIn.id },
    });
    expect(row.prompt).toBe("Suara bawaan toko.");
  });

  it("refuses a persona with no prompt rather than storing an empty voice", async () => {
    expect((await post("/personas", { name: "Kosong", prompt: "" })).status).toBe(400);
  });

  it("refuses two personas with the same name", async () => {
    await post("/personas", VOICE);
    expect((await post("/personas", VOICE)).status).toBeGreaterThanOrEqual(400);
  });

  it("says so rather than inventing one when the persona does not exist", async () => {
    expect((await post("/personas/nope/activate", {})).status).toBe(404);
    expect((await put("/personas/nope", VOICE)).status).toBe(404);
  });

  it("refuses everything to someone who is not logged in", async () => {
    // The voice decides what the shop says to customers. It is not public.
    expect((await request(app).get("/api/chat/personas")).status).toBe(401);
    expect((await request(app).post("/api/chat/personas").send(VOICE)).status).toBe(401);
  });
});

describe("corrections", () => {
  const FIX = {
    original: "Ready kak! Rp15.500.000",
    corrected: "Ready kakk, harganya 15.500.000",
    note: "no exclamation marks",
  };

  it("files a staff rewrite and attributes it", async () => {
    const res = await post("/corrections", FIX);
    expect(res.status).toBe(201);

    const row = await db.agentCorrection.findFirstOrThrow({
      select: { corrected: true, note: true, createdBy: { select: { username: true } } },
    });
    expect(row.corrected).toBe(FIX.corrected);
    expect(row.createdBy.username).toBe("persona-test");
  });

  it("refuses a rewrite identical to what was sent", async () => {
    // It teaches nothing and would still occupy one of the twelve slots the
    // prompt has room for.
    const res = await post("/corrections", {
      original: "Ready kak",
      corrected: "Ready kak",
    });
    expect(res.status).toBe(400);
    expect(await db.agentCorrection.count()).toBe(0);
  });

  it("lists the newest corrections first, so the latest house style wins", async () => {
    await post("/corrections", FIX);
    await post("/corrections", { original: "Halo", corrected: "Halo kak" });

    const res = await get("/corrections");
    expect(res.status).toBe(200);
    expect(res.body.corrections[0].corrected).toBe("Halo kak");
  });

  it("accepts a correction with no message behind it, for a persona preview", async () => {
    expect((await post("/corrections", FIX)).status).toBe(201);
  });

  it("refuses a correction from someone who is not logged in", async () => {
    expect((await request(app).post("/api/chat/corrections").send(FIX)).status).toBe(401);
  });
});

describe("drafting uses the stored voice", () => {
  it("no longer requires a persona in the request body", async () => {
    // The Chat page omits it deliberately, so a draft here is composed exactly
    // the way the unattended reply is. Without a credential the route answers
    // 503, which is the proof the body validated.
    const res = await post("/reply", {
      turns: [{ role: "user", text: "ada m2?" }],
    });
    expect(res.status).not.toBe(400);
  });

  it("still refuses a request with no turns at all", async () => {
    expect((await post("/reply", { turns: [] })).status).toBe(400);
  });
});
